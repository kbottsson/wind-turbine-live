// Unit tests for the pure wind model. Run: npm test  (node --test tests/)
//
// Reference numbers come from the locked configuration in src/config.js:
//   D = 90 m, R = 45 m, lambda = 6.5, Cp = 0.40, rated power 2.5 MW
//   -> rated wind speed 11.7085 m/s, rated rotor speed 16.1489 rpm
//   -> rpm at 8 m/s = 11.0346

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseCoords,
  rpmForWind,
  powerForWind,
  rotorStateForWind,
  sampleHourly,
  easeTowards,
  slewTowardsDeg,
  advanceAngle,
  RATED_WIND_SPEED,
  RPM_RATED,
  STATE,
} from '../src/wind-model.js';

const close = (a, b, tol = 0.02) =>
  assert.ok(Math.abs(a - b) < tol, `expected ${a} to be within ${tol} of ${b}`);

// ---------- coordinate parsing ----------

test('parses decimal "lat, lon"', () => {
  assert.deepEqual(parseCoords('52.5200, 13.4050'), { lat: 52.52, lon: 13.405 });
});

test('parses decimal separated by a space', () => {
  assert.deepEqual(parseCoords('52.5200 13.4050'), { lat: 52.52, lon: 13.405 });
});

test('parses negative decimals', () => {
  assert.deepEqual(parseCoords('-33.8688, 151.2093'), { lat: -33.8688, lon: 151.2093 });
});

test('parses DMS with hemispheres', () => {
  const c = parseCoords('N52°31\'12" E13°24\'18"');
  assert.ok(c, 'expected a coordinate');
  close(c.lat, 52.52, 1e-4);
  close(c.lon, 13.405, 1e-4);
});

test('parses DMS with the hemisphere after the seconds', () => {
  const c = parseCoords('52°31\'12"S, 13°24\'18"W');
  assert.ok(c, 'expected a coordinate');
  close(c.lat, -52.52, 1e-4);
  close(c.lon, -13.405, 1e-4);
});

test('parses a Google Maps @ URL', () => {
  assert.deepEqual(parseCoords('https://www.google.com/maps/@52.5200,13.4050,12z'), {
    lat: 52.52,
    lon: 13.405,
  });
});

test('parses a Maps ?q= URL', () => {
  assert.deepEqual(parseCoords('https://maps.google.com/?q=52.5200,13.4050&z=12'), {
    lat: 52.52,
    lon: 13.405,
  });
});

test('ignores a third number after the pair', () => {
  assert.deepEqual(parseCoords('52.5200, 13.4050, 99'), { lat: 52.52, lon: 13.405 });
});

test('rejects an out-of-range latitude', () => {
  assert.equal(parseCoords('91, 0'), null);
});

test('rejects an out-of-range longitude', () => {
  assert.equal(parseCoords('55, 181'), null);
});

test('rejects nonsense without throwing', () => {
  assert.equal(parseCoords('hello'), null);
  assert.equal(parseCoords(''), null);
  assert.equal(parseCoords(null), null);
});

// ---------- the control law ----------

test('derived constants match the locked turbine', () => {
  close(RATED_WIND_SPEED, 11.7058, 0.002);
  close(RPM_RATED, 16.1463, 0.002);
});

test('below cut-in the rotor is parked', () => {
  assert.equal(rpmForWind(2), 0);
  assert.equal(powerForWind(2), 0);
  const s = rotorStateForWind(2);
  assert.equal(s.rpm, 0);
  assert.equal(s.state, STATE.PARKED);
});

test('below rated wind the rotor follows the tip-speed ratio exactly', () => {
  close(rpmForWind(8), 11.0346, 0.02);
  close(rpmForWind(6), 8.2759, 0.02);
});

test('power below rated wind follows the cube law and stays under rated power', () => {
  const p = powerForWind(6);
  assert.ok(p > 0 && p < 2.5e6, `expected 0 < ${p} < 2.5e6`);
  close(p / 1e6, 0.3367, 0.001);
});

test('above rated wind the rotor speed plateaus and power is clamped', () => {
  close(rpmForWind(15), RPM_RATED, 1e-9);
  assert.equal(rpmForWind(15), rpmForWind(20));
  assert.equal(powerForWind(20), 2.5e6);
  const s = rotorStateForWind(20);
  assert.equal(s.state, STATE.RATED);
  assert.equal(s.rpm, RPM_RATED);
});

test('at the rated wind speed the rotor is already at rated speed and power', () => {
  const s = rotorStateForWind(11.71);
  close(s.rpm, 16.1489, 0.05);
  assert.equal(s.power, 2.5e6);
});

test('at and above cut-out the rotor stops', () => {
  const s = rotorStateForWind(26);
  assert.equal(s.rpm, 0);
  assert.equal(s.power, 0);
  assert.equal(s.state, STATE.CUTOUT);
});

test('cut-out hysteresis holds the machine parked until the wind drops below the reset speed', () => {
  assert.equal(rotorStateForWind(24, { prevState: STATE.CUTOUT }).state, STATE.CUTOUT);
  assert.equal(rotorStateForWind(21, { prevState: STATE.CUTOUT }).state, STATE.RATED);
  assert.equal(rotorStateForWind(24, { prevState: STATE.RATED }).state, STATE.RATED);
});

test('missing wind data is reported as no data, not as zero wind', () => {
  for (const bad of [null, undefined, NaN, 'strong']) {
    const s = rotorStateForWind(bad);
    assert.equal(s.state, STATE.NODATA);
    assert.equal(s.rpm, 0);
  }
});

// ---------- hourly sampling ----------

const HOUR = 3600000;
const t0 = Date.UTC(2026, 8, 21, 12, 0, 0);
const series = [
  { t: t0 - HOUR, v100: 5, dir: 180, gust: 8 },
  { t: t0, v100: 7, dir: 190, gust: 11 },
  { t: t0 + HOUR, v100: 9, dir: 200, gust: 14 },
];

test('sampling inside an hour returns that hour, not an interpolation', () => {
  assert.equal(sampleHourly(series, new Date(t0 + 59 * 60000)).v100, 7);
  assert.equal(sampleHourly(series, new Date(t0)).v100, 7);
});

test('sampling rolls over exactly on the hour boundary', () => {
  assert.equal(sampleHourly(series, new Date(t0 + HOUR)).v100, 9);
});

test('sampling outside the series clamps to the nearest hour instead of returning undefined', () => {
  assert.equal(sampleHourly(series, new Date(t0 - 5 * HOUR)).v100, 5);
  assert.equal(sampleHourly(series, new Date(t0 + 5 * HOUR)).v100, 9);
});

test('hours with a null wind value are skipped', () => {
  const gappy = [
    { t: t0, v100: null, dir: 180, gust: null },
    { t: t0 + HOUR, v100: 6, dir: 185, gust: 9 },
  ];
  assert.equal(sampleHourly(gappy, new Date(t0)).v100, 6);
  assert.equal(sampleHourly([{ t: t0, v100: null }], new Date(t0)), null);
  assert.equal(sampleHourly([], new Date(t0)), null);
});

// ---------- motion maths (the animation cannot be watched in headless Chrome) ----------

test('rotor rpm approaches its target exponentially, not instantly', () => {
  // one time constant of a 4 s ease should cover 1 - 1/e of the gap
  close(easeTowards(0, 16, 4, 4), 16 * (1 - Math.exp(-1)), 1e-6);
  assert.ok(easeTowards(0, 16, 0.1, 4) < 1, 'a single frame must not jump to the target');
});

test('rotor rpm converges on the target and stays there', () => {
  let rpm = 0;
  for (let i = 0; i < 1500; i += 1) rpm = easeTowards(rpm, 16.146, 0.05, 4); // 75 s ≈ 19 time constants
  close(rpm, 16.146, 0.01);
});

test('a zero time constant snaps, and a zero dt changes nothing', () => {
  assert.equal(easeTowards(0, 16, 0.016, 0), 16);
  assert.equal(easeTowards(5, 16, 0, 4), 5);
});

test('missing numbers cannot poison the rotor speed', () => {
  assert.equal(easeTowards(NaN, 12, 0.016, 4), 12);
  assert.equal(easeTowards(5, NaN, 0.016, 4), 5);
});

test('yaw turns at the rated rate and takes the short way round the compass', () => {
  assert.equal(slewTowardsDeg(0, 90, 1, 0.5), 0.5);
  assert.equal(slewTowardsDeg(350, 10, 100, 0.5), 10); // forward through north, not back through 180
  assert.equal(slewTowardsDeg(10, 350, 100, 0.5), 350); // and back the same way
  assert.equal(slewTowardsDeg(45, 45, 1, 0.5), 45);
});

test('rotor angle advances at the right rate and never runs backwards', () => {
  close(advanceAngle(0, 60, 1), Math.PI * 2, 1e-9); // 60 rpm = one turn per second
  close(advanceAngle(0, RPM_RATED, 1), (RPM_RATED / 60) * Math.PI * 2, 1e-9);
  assert.equal(advanceAngle(1.5, 16, 0), 1.5);
  assert.equal(advanceAngle(1.5, -5, 1), 1.5);
});
