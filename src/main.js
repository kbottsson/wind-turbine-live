// Wiring: input → wind data → control law → 3D rig + HUD.
//
// Data cadence (by decision): the series is read on load and then at most once an hour.
// The rotor re-snaps at each hour boundary without interpolation. Every failure ends in a
// parked, motionless turbine with a stated reason.

import { TURBINE, MOTION, SITE } from './config.js';
import {
  parseCoords,
  rotorStateForWind,
  sampleHourly,
  msUntilNextHour,
  RATED_WIND_SPEED,
  RPM_RATED,
  ROTOR_RADIUS,
  SWEPT_AREA,
  STATE,
} from './wind-model.js';
import { fetchWind } from './api.js';
import { TurbineRig } from './turbine.js';
import { createStage, prefersReducedMotion } from './scene.js';

const REFRESH_EVERY_HOURS = 6; // re-read the forecast every 6 hours; re-sample every hour

const el = (id) => document.getElementById(id);
const dom = {
  stageBox: document.querySelector('.stage'),
  canvas: el('canvas'),
  fallback: el('stage-fallback'),
  fallbackMsg: el('fallback-msg'),
  form: el('lookup'),
  coord: el('coord'),
  formMsg: el('form-msg'),
  locate: el('locate'),
  badge: el('state-badge'),
  note: el('state-note'),
  wind: el('v-wind'),
  gust: el('v-gust'),
  dir: el('v-dir'),
  arrow: el('v-dir-arrow'),
  rpm: el('v-rpm'),
  power: el('v-power'),
  coordOut: el('v-coord'),
  timeOut: el('v-time'),
  unitToggle: el('unit-toggle'),
  refresh: el('refresh'),
  specRows: el('spec-rows'),
  explainNumbers: el('explain-numbers'),
};

const LABELS = {
  [STATE.PARKED]: ['Parked', `Below cut-in (${TURBINE.cutInSpeed.toFixed(1)} m/s) — too little wind`],
  [STATE.GENERATING]: ['Generating', 'Variable speed — rotor rpm follows the wind'],
  [STATE.RATED]: ['Rated — pitch limited', 'Rated power reached: the blades shed the extra wind'],
  [STATE.CUTOUT]: ['Storm park', `Above cut-out (${TURBINE.cutOutSpeed.toFixed(0)} m/s) — feathered and stopped`],
  [STATE.NODATA]: ['No data', 'No wind value for this hour'],
};

const app = {
  lat: null,
  lon: null,
  hours: null,
  hoursReadAt: 0,
  sample: null,
  state: null,
  prevState: null,
  unit: 'ms',
  status: 'idle',
  note: '',
};

let stage = null;
let rig = null;
let rafId = null;
let hourTimer = null;
let lastFrame = 0;

// boot() is called at the very bottom of this file: it must run only after every module-level
// binding exists, or the first synchronous HUD render hits a temporal-dead-zone error.

function boot() {
  buildSpecTable();
  wireEvents();

  try {
    stage = createStage(dom.canvas);
    rig = new TurbineRig();
    stage.scene.add(rig.group);
    rig.applyImmediate({ rpm: 0, yawDeg: 0 });
    dom.canvas.hidden = false;
    dom.fallback.hidden = true;
    window.__wtBootOk = true;
    const resize = () => {
      const rect = dom.stageBox.getBoundingClientRect();
      stage.setSize(rect.width, rect.height);
    };
    new ResizeObserver(resize).observe(dom.stageBox);
    resize();
    startLoop();
  } catch (err) {
    // No WebGL: the fallback graphic stays, the readings still work, and the reason is stated.
    showFallback(
      'This browser could not start WebGL, so the 3D turbine cannot be rendered. ' +
        'The wind readings below still work.',
    );
    setStatus('idle');
    console.warn('webgl unavailable:', err);
  }

  window.__wt = {
    app,
    lookUp,
    applyCurrentHour,
    setStatus,
    forceWind,
    rig: () => rig,
  };

  const prefill = coordFromUrl() || coordFromStorage();
  const demo = demoOverride();
  if (demo) {
    // Documented preview hook: ?wind=15&dir=200 renders a wind speed without waiting for one.
    forceWind(demo.v, demo.dir);
  } else if (prefill) {
    dom.coord.value = `${prefill.lat.toFixed(4)}, ${prefill.lon.toFixed(4)}`;
    lookUp(prefill.lat, prefill.lon, { mode: 'auto' });
  } else if (!stage) {
    formMessage('WebGL is unavailable in this browser — the readings still update.', 'error');
  } else {
    setStatus('idle');
  }
}

// ---------------------------------------------------------------------------
// events
// ---------------------------------------------------------------------------

function wireEvents() {
  dom.form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitInput();
  });

  dom.unitToggle.addEventListener('click', () => {
    app.unit = app.unit === 'ms' ? 'kmh' : 'ms';
    renderHud();
  });

  dom.refresh.addEventListener('click', () => {
    if (app.lat == null) {
      dom.formMsg.dataset.kind = 'error';
      dom.formMsg.textContent = 'Enter a coordinate first.';
      return;
    }
    lookUp(app.lat, app.lon, { mode: 'user' });
  });

  dom.locate.addEventListener('click', () => {
    if (!navigator.geolocation) {
      formMessage('This browser has no location service.', 'error');
      return;
    }
    formMessage('Asking your browser for a location…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        dom.coord.value = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
        lookUp(latitude, longitude, { mode: 'user' });
      },
      (err) => {
        formMessage(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission was refused. Type a coordinate instead.'
            : 'Your location is unavailable right now.',
          'error',
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  });

  document.addEventListener('visibilitychange', () => {
    if (!stage) return;
    if (document.hidden) {
      stopLoop();
    } else {
      startLoop();
      // the hour may have turned over while the tab was in the background
      if (app.hours && app.sample && Date.now() - app.sample.t > 3600000) applyCurrentHour();
    }
  });
}

function submitInput() {
  const parsed = parseCoords(dom.coord.value);
  if (!parsed) {
    formMessage(
      'That does not look like a coordinate. Try 52.5200, 13.4050, or paste a Maps link.',
      'error',
    );
    return;
  }
  formMessage('');
  lookUp(parsed.lat, parsed.lon, { mode: 'user' });
}

// ---------------------------------------------------------------------------
// data pipeline
// ---------------------------------------------------------------------------

async function lookUp(lat, lon, { mode = 'user' } = {}) {
  app.lat = lat;
  app.lon = lon;
  if (mode === 'user') setStatus('loading');

  const result = await fetchWind(lat, lon);

  if (result.error) {
    const cachedIsUsable = app.hours && sampleHourly(app.hours, new Date());
    if (mode === 'auto' && cachedIsUsable) {
      // A background refresh failed but the data in hand is still current: keep the machine
      // running and say so, rather than blanking a working page.
      app.note = 'Could not refresh — showing the last data read.';
      applyCurrentHour();
      renderHud();
      return;
    }
    app.hours = null;
    app.sample = null;
    app.state = null;
    setStatus('error', result.message);
    return;
  }

  app.hours = result.hours;
  app.hoursReadAt = Date.now();
  app.note = '';
  saveCoord(lat, lon);
  applyCurrentHour();
  scheduleNextHour(false);
}

function applyCurrentHour() {
  const sample = sampleHourly(app.hours, new Date());
  if (!sample) {
    app.sample = null;
    app.state = null;
    setStatus('error', 'No usable wind value for this hour.');
    return;
  }
  app.sample = sample;
  const next = rotorStateForWind(sample.v100, { prevState: app.prevState });
  app.prevState = next.state;
  app.state = next;
  if (rig) {
    rig.setTargetRpm(next.rpm);
    rig.setTargetYaw(sample.dir);
  }
  setStatus('live');
  renderHud();
}

/** Screenshot/debug path: drive the rig from a wind speed without touching the network. */
function forceWind(v, dir = 0) {
  const next = rotorStateForWind(v, { prevState: app.prevState });
  app.prevState = next.state;
  app.state = next;
  app.sample = { t: Date.now(), v100: v, dir, gust: Number.isFinite(v) ? v + 3 : null };
  app.lat = app.lat ?? 52.52;
  app.lon = app.lon ?? 13.405;
  if (rig) {
    rig.setTargetRpm(next.rpm);
    rig.applyImmediate({ rpm: next.rpm, yawDeg: dir });
  }
  setStatus('live');
  renderHud();
}

function scheduleNextHour(immediate = false) {
  clearTimeout(hourTimer);
  const delay = immediate ? 0 : msUntilNextHour(new Date()) + 3000;
  hourTimer = setTimeout(() => {
    const stale = Date.now() - app.hoursReadAt > REFRESH_EVERY_HOURS * 3600000;
    if (stale) {
      lookUp(app.lat, app.lon, { mode: 'auto' }); // re-read the model run, still ≤ 1 read/hour
    } else {
      applyCurrentHour(); // the next hour is already in the series: re-snap, no request
      scheduleNextHour(false);
    }
  }, delay);
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

function startLoop() {
  if (!stage || rafId != null) return;
  lastFrame = performance.now();
  rafId = requestAnimationFrame(frame);
}

function stopLoop() {
  if (rafId != null) cancelAnimationFrame(rafId);
  rafId = null;
}

function frame(now) {
  rafId = requestAnimationFrame(frame);
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  rig.update(dt);
  stage.render();
  if (app.state) dom.rpm.textContent = rig.rpm.toFixed(1);
}

function renderHud() {
  const sample = app.sample;
  const state = app.state;

  dom.wind.textContent = sample ? formatSpeed(sample.v100) : '—';
  dom.gust.textContent = sample && Number.isFinite(sample.gust) ? formatSpeed(sample.gust) : '—';
  dom.dir.textContent = sample ? `${Math.round(sample.dir)}° ${compassPoint(sample.dir)}` : '—';
  dom.arrow.style.transform = sample ? `rotate(${sample.dir}deg)` : 'none';
  dom.power.textContent = state ? formatPower(state.power) : '—';
  dom.rpm.textContent = state ? (rig ? rig.rpm.toFixed(1) : '—') : '0.0';
  dom.coordOut.textContent = app.lat != null ? formatCoord(app.lat, app.lon) : '—';
  dom.timeOut.textContent = sample ? formatHour(sample.t) : '—';
  dom.timeOut.title = sample ? new Date(sample.t).toISOString() : '';
  dom.unitToggle.textContent = app.unit === 'ms' ? 'm/s' : 'km/h';
  dom.unitToggle.title = app.unit === 'ms' ? 'Switch to km/h' : 'Switch to m/s';
}

function setStatus(kind, message = '') {
  app.status = kind;
  if (kind === 'idle') {
    dom.badge.textContent = 'Idle';
    dom.badge.dataset.state = 'idle';
    dom.note.textContent = 'Enter a coordinate, or use your location.';
    return;
  }
  if (kind === 'loading') {
    dom.badge.textContent = 'Loading';
    dom.badge.dataset.state = 'loading';
    dom.note.textContent = 'Reading the wind at 100 m…';
    return;
  }
  if (kind === 'error') {
    dom.badge.textContent = 'Error';
    dom.badge.dataset.state = 'error';
    dom.note.textContent = message || 'Something went wrong.';
    if (rig) {
      rig.setTargetRpm(0);
      rig.applyImmediate({ rpm: 0, yawDeg: rig.yawDeg });
    }
    renderHud();
    return;
  }
  // live
  const [label, note] = LABELS[app.state ? app.state.state : STATE.NODATA] || ['—', ''];
  dom.badge.textContent = label;
  dom.badge.dataset.state = app.state ? app.state.state : 'nodata';
  dom.note.textContent = app.note ? `${note} · ${app.note}` : note;
}

function setBadgeOnly(text, state, note) {
  dom.badge.textContent = text;
  dom.badge.dataset.state = state;
  dom.note.textContent = note;
}

function formMessage(text, kind = '') {
  dom.formMsg.textContent = text;
  if (kind) dom.formMsg.dataset.kind = kind;
  else delete dom.formMsg.dataset.kind;
}

function showFallback(text) {
  if (dom.canvas) dom.canvas.hidden = true;
  if (dom.fallback) {
    dom.fallback.hidden = false;
    dom.fallbackMsg.textContent = text;
  }
}

// ---------------------------------------------------------------------------
// formatting helpers
// ---------------------------------------------------------------------------

function formatSpeed(ms) {
  if (!Number.isFinite(ms)) return '—';
  return app.unit === 'ms' ? ms.toFixed(1) : (ms * 3.6).toFixed(0);
}

function formatPower(watts) {
  if (!Number.isFinite(watts)) return '—';
  if (watts >= 1e6) return `${(watts / 1e6).toFixed(2)} MW`;
  return `${Math.round(watts / 1000)} kW`;
}

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

function compassPoint(deg) {
  if (!Number.isFinite(deg)) return '';
  return POINTS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

function formatCoord(lat, lon) {
  const latStr = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}`;
  const lonStr = `${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`;
  return `${latStr}, ${lonStr}`;
}

function formatHour(ms) {
  return new Date(ms).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// shareable links, remembered coordinate, spec table
// ---------------------------------------------------------------------------

function coordFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('coord')) return parseCoords(params.get('coord'));
  if (params.has('lat') && params.has('lon')) {
    return parseCoords(`${params.get('lat')}, ${params.get('lon')}`);
  }
  return null;
}

/** Documented preview hook: ?wind=12.5&dir=270 shows a given wind speed with no network read. */
function demoOverride() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('wind')) return null;
  const v = Number(params.get('wind'));
  if (!Number.isFinite(v)) return null;
  const dir = Number(params.get('dir'));
  return { v, dir: Number.isFinite(dir) ? dir : 0 };
}

function coordFromStorage() {
  try {
    return parseCoords(localStorage.getItem('wt:last') || '');
  } catch {
    return null;
  }
}

function saveCoord(lat, lon) {
  try {
    localStorage.setItem('wt:last', `${lat}, ${lon}`);
  } catch {
    /* private mode: remembering the coordinate is optional */
  }
}

function buildSpecTable() {
  const tipSpeed = ((RPM_RATED / 60) * 2 * Math.PI * ROTOR_RADIUS).toFixed(0);
  const rows = [
    ['Turbine', `${TURBINE.label} (generic — not a specific real machine)`],
    ['Rotor diameter', `${TURBINE.rotorDiameter} m`],
    ['Swept area', `${Math.round(SWEPT_AREA).toLocaleString()} m²`],
    ['Hub height', `${TURBINE.hubHeight} m — the height the wind data is read at`],
    ['Blades', String(TURBINE.bladeCount)],
    ['Cut-in wind speed', `${TURBINE.cutInSpeed.toFixed(1)} m/s`],
    ['Rated wind speed', `${RATED_WIND_SPEED.toFixed(2)} m/s — where the speed curve goes flat`],
    ['Cut-out wind speed', `${TURBINE.cutOutSpeed.toFixed(0)} m/s (restarts below ${TURBINE.cutOutResetSpeed.toFixed(0)} m/s)`],
    ['Rated power', `${(TURBINE.ratedPower / 1e6).toFixed(1)} MW`],
    ['Rated rotor speed', `${RPM_RATED.toFixed(2)} rpm (tip speed ${tipSpeed} m/s)`],
    ['Tip-speed ratio', `${TURBINE.tipSpeedRatio} below rated wind`],
    ['Power coefficient', `${TURBINE.powerCoefficient} (Betz limit 0.593)`],
    ['Wind data', 'Open-Meteo hourly forecast, 100 m wind, CC BY 4.0'],
    ['Refresh', 'read on load, then at most once an hour'],
    ['Rotor easing', MOTION.rotorTau > 0 ? `${MOTION.rotorTau} s time constant` : 'instant snap'],
  ];
  if (dom.specRows) {
    dom.specRows.innerHTML = rows
      .map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`)
      .join('');
  }
  if (dom.explainNumbers) {
    dom.explainNumbers.textContent =
      `Rotated: ${RPM_RATED.toFixed(2)} rpm at ${RATED_WIND_SPEED.toFixed(2)} m/s. ` +
      `Parked below ${TURBINE.cutInSpeed.toFixed(1)} m/s and above ${TURBINE.cutOutSpeed.toFixed(0)} m/s. ` +
      `Ceiling: ${TURBINE.ratedPower / 1e6} MW.`;
  }
}

boot();
