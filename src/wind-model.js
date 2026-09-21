// Pure wind model: coordinate parsing, the turbine control law, and hourly sampling.
//
// Everything here is side-effect free and DOM-free so it can be unit-tested in Node
// (tests/wind-model.test.mjs) and reused unchanged by the browser code.

import { TURBINE } from './config.js';

const TAU = Math.PI * 2;

export const ROTOR_RADIUS = TURBINE.rotorDiameter / 2; // m
export const SWEPT_AREA = Math.PI * ROTOR_RADIUS ** 2; // m^2

/**
 * The wind speed at which the aerodynamic power available equals the generator's rating.
 * Below it the machine runs variable-speed; above it the blades pitch to shed the excess,
 * which is what makes the rotor-speed curve flat rather than linear.
 */
export const RATED_WIND_SPEED = Math.cbrt(
  TURBINE.ratedPower / (0.5 * TURBINE.airDensity * SWEPT_AREA * TURBINE.powerCoefficient),
); // m/s

/** Rotor speed at the rated wind speed: constant above it. */
export const RPM_RATED = ((TURBINE.tipSpeedRatio * RATED_WIND_SPEED) / ROTOR_RADIUS) * (60 / TAU);

export const STATE = Object.freeze({
  NODATA: 'nodata',
  PARKED: 'parked',
  GENERATING: 'generating',
  RATED: 'rated',
  CUTOUT: 'cutout',
});

// ---------------------------------------------------------------------------
// coordinate parsing
// ---------------------------------------------------------------------------

const inRange = (lat, lon) =>
  Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

/**
 * Parse a coordinate from what people actually paste: decimal pairs, DMS in any
 * hemisphere style, or a Maps link. Returns {lat, lon} or null. Never throws.
 */
export function parseCoords(input) {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return null;

  const dms = parseDmsPair(raw);
  if (dms) return dms;

  // Prefer an explicitly labelled pair (Maps ?q= / ?ll= / ?query=) …
  let candidate = raw;
  const labelled = raw.match(/[?&](?:q|ll|query|center|centre|daddr|destination|latlng)=([^&\s]+)/i);
  if (labelled) {
    candidate = safeDecode(labelled[1]);
  } else {
    // … otherwise anything after the last '@' (Maps /@lat,lon,zoom).
    const at = raw.lastIndexOf('@');
    if (at !== -1) candidate = raw.slice(at + 1);
  }

  const numbers = candidate.match(/-?\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length < 2) return null;
  const lat = Number(numbers[0]);
  const lon = Number(numbers[1]);
  return inRange(lat, lon) ? { lat, lon } : null;
}

const DMS_PART =
  /([NSEW])?\s*(\d{1,3})(?:\.\d+)?\s*[°d]\s*(?:(\d{1,2}(?:\.\d+)?)\s*['′m]\s*)?(?:(\d{1,2}(?:\.\d+)?)\s*["″s]\s*)?([NSEW])?/gi;

function parseDmsPair(text) {
  const parts = [];
  for (const m of text.matchAll(DMS_PART)) {
    const hemi = (m[1] || m[5] || '').toUpperCase() || null;
    const deg = Number(m[2]);
    const min = m[3] ? Number(m[3]) : 0;
    const sec = m[4] ? Number(m[4]) : 0;
    if (min >= 60 || sec >= 60) return null;
    const magnitude = deg + min / 60 + sec / 3600;
    parts.push({ hemi, value: hemi === 'S' || hemi === 'W' ? -magnitude : magnitude });
  }
  if (parts.length !== 2) return null;

  const [a, b] = parts;
  let lat;
  let lon;
  if (a.hemi === 'N' || a.hemi === 'S' || b.hemi === 'E' || b.hemi === 'W') {
    [lat, lon] = [a.value, b.value];
  } else if (a.hemi === 'E' || a.hemi === 'W' || b.hemi === 'N' || b.hemi === 'S') {
    [lat, lon] = [b.value, a.value];
  } else {
    [lat, lon] = [a.value, b.value];
  }
  return inRange(lat, lon) ? { lat, lon } : null;
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// ---------------------------------------------------------------------------
// the control law
// ---------------------------------------------------------------------------

/**
 * Rotor speed for a wind speed. Proportional to wind below the rated speed (constant
 * tip-speed ratio), flat at the rated speed above it, and zero outside the operating range.
 */
export function rpmForWind(v, { cutOutSpeed = TURBINE.cutOutSpeed } = {}) {
  if (!Number.isFinite(v)) return 0;
  if (v < TURBINE.cutInSpeed || v >= cutOutSpeed) return 0;
  const rpm = ((TURBINE.tipSpeedRatio * v) / ROTOR_RADIUS) * (60 / TAU);
  return Math.min(rpm, RPM_RATED);
}

/** Electrical power: the cube law below the rating, clamped to the rating above it. */
export function powerForWind(v, { cutOutSpeed = TURBINE.cutOutSpeed } = {}) {
  if (!Number.isFinite(v)) return 0;
  if (v < TURBINE.cutInSpeed || v >= cutOutSpeed) return 0;
  const p = 0.5 * TURBINE.airDensity * SWEPT_AREA * v ** 3 * TURBINE.powerCoefficient;
  return Math.min(p, TURBINE.ratedPower);
}

/**
 * Full state for the UI and the animation, including cut-out hysteresis: a machine that
 * has tripped on high wind stays parked until the wind falls to the reset speed, so it
 * cannot chatter on and off at the boundary.
 */
export function rotorStateForWind(v, { prevState = null } = {}) {
  if (!Number.isFinite(v)) {
    return { rpm: 0, power: 0, state: STATE.NODATA };
  }
  const cutOutSpeed =
    prevState === STATE.CUTOUT ? TURBINE.cutOutResetSpeed : TURBINE.cutOutSpeed;

  if (v >= cutOutSpeed) {
    return { rpm: 0, power: 0, state: STATE.CUTOUT };
  }
  if (v < TURBINE.cutInSpeed) {
    return { rpm: 0, power: 0, state: STATE.PARKED };
  }
  return {
    rpm: rpmForWind(v),
    power: powerForWind(v),
    state: v < RATED_WIND_SPEED ? STATE.GENERATING : STATE.RATED,
  };
}

// ---------------------------------------------------------------------------
// hourly sampling
// ---------------------------------------------------------------------------

/**
 * The hourly sample in force at `when`: the last hour at or before it (no interpolation —
 * the rotor re-snaps once an hour by decision). Clamps at both ends and skips hours whose
 * wind value is missing. Returns null when there is nothing usable.
 */
export function sampleHourly(hours, when = new Date()) {
  if (!Array.isArray(hours) || hours.length === 0) return null;
  const t = when instanceof Date ? when.getTime() : Number(when);
  if (!Number.isFinite(t)) return null;

  const usable = hours
    .filter((h) => h && Number.isFinite(h.t) && Number.isFinite(h.v100))
    .sort((a, b) => a.t - b.t);
  if (usable.length === 0) return null;

  let pick = usable[0];
  for (const h of usable) {
    if (h.t <= t) pick = h;
    else break;
  }
  return pick;
}

/** Milliseconds until the next whole hour — when the data is re-read. */
export function msUntilNextHour(when = new Date()) {
  const t = when instanceof Date ? when.getTime() : Number(when);
  return 3600000 - (t % 3600000);
}

// ---------------------------------------------------------------------------
// motion maths
// ---------------------------------------------------------------------------
// Kept here, next to the control law, so the animation is covered by tests even though
// headless Chrome renders single frames and cannot be used to watch it move.

/** Exponential approach to a target — rotor inertia. tau <= 0 snaps instead. */
export function easeTowards(current, target, dt, tau) {
  if (!Number.isFinite(current)) return Number.isFinite(target) ? target : 0;
  if (!Number.isFinite(target)) return current;
  if (!(tau > 0)) return target;
  if (!(dt > 0)) return current;
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

/** Rate-limited turn toward a compass bearing, always the short way round. */
export function slewTowardsDeg(currentDeg, targetDeg, dt, rateDegPerSec) {
  if (!Number.isFinite(currentDeg)) return Number.isFinite(targetDeg) ? targetDeg : 0;
  if (!Number.isFinite(targetDeg) || !(rateDegPerSec > 0) || !(dt > 0)) return currentDeg;
  const delta = ((((targetDeg - currentDeg) % 360) + 540) % 360) - 180;
  const maxStep = rateDegPerSec * dt;
  const step = Math.max(-maxStep, Math.min(maxStep, delta));
  return (currentDeg + step + 360) % 360;
}

/** Rotor angle for one frame: rpm -> revolutions per minute -> radians. */
export function advanceAngle(angle, rpm, dt) {
  if (!Number.isFinite(angle) || !(dt > 0)) return angle || 0;
  const safeRpm = Number.isFinite(rpm) ? Math.max(rpm, 0) : 0;
  return angle + (safeRpm / 60) * TAU * dt;
}
