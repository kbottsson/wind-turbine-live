// Unit tests for lite.html, the pixel panel.
//
// Two things are being protected here.
//
// 1. PHYSICS. The lite page carries its own inline copy of the control law, because it has to run
//    without ES modules. This test evaluates that exact block out of the HTML file and compares it
//    against the canonical src/wind-model.js across a sweep of wind speeds, so the copy cannot
//    drift away from the model the README documents.
//
// 2. PORTABILITY. The whole point of the lite page is that it runs where the 3D page cannot, so
//    the features that stopped the 3D page are asserted absent.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { TURBINE } from '../src/config.js';
import {
  RATED_WIND_SPEED,
  RPM_RATED,
  STATE,
  rpmForWind,
  powerForWind,
  rotorStateForWind,
  easeTowards,
  advanceAngle,
  sampleHourly,
  msUntilNextHour,
} from '../src/wind-model.js';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'lite.html'), 'utf8');

/** Slice the marked physics block out of lite.html and evaluate it as plain JavaScript. */
function liteModel() {
  const start = html.indexOf('LITE-MODEL-START');
  const end = html.indexOf('LITE-MODEL-END');
  assert.ok(start > 0, 'lite.html must open a LITE-MODEL block');
  assert.ok(end > start, 'lite.html must close the LITE-MODEL block');
  const block = html.slice(html.indexOf('*/', start) + 2, html.lastIndexOf('/*', end));
  const build = new Function(
    `${block}
     return { TURBINE, RATED_WIND_SPEED, RPM_RATED, STATE, rpmForWind, powerForWind,
              rotorStateForWind, easeTowards, advanceAngle, paintIntervalMs, nextRetryMs, sampleHourly, msUntilNextHour,
              SCENES, SCENE_KEYS, SEASONS, PHASES, PHASE_WINDOW_MIN, seasonFor, solarEvents, phaseFor, sceneFor };`,
  );
  return build();
}

const lite = liteModel();
const close = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);

// ---------------------------------------------------------------------------
// the two implementations agree
// ---------------------------------------------------------------------------

test('the lite page carries the same turbine constants as config.js', () => {
  for (const key of Object.keys(TURBINE)) {
    if (typeof TURBINE[key] !== 'number') continue; // `label` is display text, not physics
    assert.equal(lite.TURBINE[key], TURBINE[key], `TURBINE.${key}`);
  }
  for (const key of Object.keys(lite.TURBINE)) {
    assert.ok(key in TURBINE, `lite.html has a TURBINE.${key} that config.js does not`);
  }
  close(lite.RATED_WIND_SPEED, RATED_WIND_SPEED);
  close(lite.RPM_RATED, RPM_RATED);
  assert.deepEqual(lite.STATE, JSON.parse(JSON.stringify(STATE)));
});

test('rotor speed matches the canonical model across the whole wind range', () => {
  for (let v = 0; v <= 30; v += 0.05) {
    close(lite.rpmForWind(v), rpmForWind(v), 1e-12);
  }
});

test('power matches the canonical model across the whole wind range', () => {
  for (let v = 0; v <= 30; v += 0.05) {
    close(lite.powerForWind(v), powerForWind(v), 1e-9);
  }
});

test('the state machine, including cut-out hysteresis, matches the canonical model', () => {
  const states = [null, STATE.CUTOUT, STATE.GENERATING, STATE.PARKED];
  for (const prevState of states) {
    for (let v = 0; v <= 30; v += 0.05) {
      const a = lite.rotorStateForWind(v, { prevState });
      const b = rotorStateForWind(v, { prevState });
      assert.equal(a.state, b.state, `state at ${v} m/s, prev ${prevState}`);
      close(a.rpm, b.rpm, 1e-12);
      close(a.power, b.power, 1e-9);
    }
  }
});

test('a tripped machine waits for the reset speed in the lite page too', () => {
  const tripped = lite.rotorStateForWind(24, { prevState: lite.STATE.CUTOUT });
  assert.equal(tripped.state, lite.STATE.CUTOUT);
  // 21.9 m/s is below the 22 m/s reset speed, so the machine restarts — and it is above the rated
  // wind speed, so it restarts at rated power rather than ramping.
  const reset = lite.rotorStateForWind(21.9, { prevState: lite.STATE.CUTOUT });
  assert.equal(reset.state, lite.STATE.RATED);
  close(reset.rpm, RPM_RATED, 1e-12);
});

test('missing and junk wind values are not treated as zero wind', () => {
  for (const bad of [NaN, undefined, null, 'eight', Infinity]) {
    assert.equal(lite.rotorStateForWind(bad).state, lite.STATE.NODATA);
    close(lite.rpmForWind(bad), rpmForWind(bad));
    close(lite.powerForWind(bad), powerForWind(bad));
  }
});

test('the motion maths matches: rotor easing and angle integration', () => {
  close(lite.easeTowards(0, 10, 0.5, 4), easeTowards(0, 10, 0.5, 4));
  close(lite.easeTowards(5, 10, 1 / 60, 4), easeTowards(5, 10, 1 / 60, 4));
  close(lite.easeTowards(5, 10, 1, 0), easeTowards(5, 10, 1, 0)); // tau 0 snaps
  close(lite.easeTowards(NaN, 7, 1, 4), easeTowards(NaN, 7, 1, 4));
  close(lite.advanceAngle(0, 16.15, 1), advanceAngle(0, 16.15, 1));
  close(lite.advanceAngle(1, -5, 1), advanceAngle(1, -5, 1));
  close(lite.advanceAngle(NaN, 5, 1), advanceAngle(NaN, 5, 1));
});

test('hourly sampling matches the canonical model, including clamping', () => {
  const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);
  const hours = [
    { t: t0, v100: 5 },
    { t: t0 + 3600000, v100: null },
    { t: t0 + 7200000, v100: 9 },
    { t: t0 + 10800000, v100: 2 },
  ];
  for (const offset of [-5000, 0, 1, 3599999, 3600000, 7200000, 99999999]) {
    const when = t0 + offset;
    assert.deepEqual(lite.sampleHourly(hours, when), sampleHourly(hours, when), `offset ${offset}`);
  }
  assert.equal(lite.sampleHourly([], t0), sampleHourly([], t0));
  close(lite.msUntilNextHour(t0), msUntilNextHour(t0));
  close(lite.msUntilNextHour(t0 + 1234), msUntilNextHour(t0 + 1234));
});

// ---------------------------------------------------------------------------
// the page stays portable, which is the reason it exists
// ---------------------------------------------------------------------------

test('lite.html is free of the features that keep the 3D page off old hardware', () => {
  assert.ok(!/<script[^>]*type\s*=\s*["']module["']/i.test(html), 'no ES module script tags');
  assert.ok(!/importmap/i.test(html), 'no import maps');
  assert.ok(!/^\s*import\s/m.test(html), 'no static imports');
  assert.ok(!/\bthree\b/i.test(html.replace(/three[- ]?dimensional/gi, '')), 'no three.js');
  assert.ok(!/<script[^>]+\bsrc=/i.test(html), 'no external scripts: the page is self-contained');
  assert.ok(!/<link[^>]+stylesheet/i.test(html), 'no external stylesheet');
  assert.ok(/\bXMLHttpRequest\b/.test(html), 'uses XHR, which even pre-fetch browsers have');
});

test('the panel keeps its documented pixel defaults', () => {
  assert.ok(/var\s+DEFAULT_PX\s*=\s*4\b/.test(html), 'default pixel scale is 4');
  assert.ok(/width="256"\s+height="150"/.test(html), 'framebuffer is 256x150');
  assert.ok(/image-rendering:\s*pixelated/.test(html), 'pixels are not smoothed when scaled');
});

test('the panel reads the same data source as the 3D page', () => {
  assert.ok(html.includes('wind_speed_100m,wind_direction_10m,wind_gusts_10m'), 'the same hourly vars');
  assert.ok(html.includes('wind_speed_unit=ms'), 'wind in m/s');
  assert.ok(html.includes('timeformat=unixtime'), 'unambiguous timestamps');
});

// ---------------------------------------------------------------------------
// the paint cadence never becomes "paint never again"
// ---------------------------------------------------------------------------

test('the paint cadence never becomes "paint never again"', () => {
  const cadences = { movingMs: 1000 / 12, settleMs: 1000, heartbeatMs: 60000, hiddenMs: 60000 };
  // A turning rotor is painted on the moving cadence, a parked one on the heartbeat, and the first
  // seconds after loading get the settle cadence while the first reading is still arriving.
  assert.equal(lite.paintIntervalMs({ ...cadences, turning: true, settled: true }), cadences.movingMs);
  assert.equal(lite.paintIntervalMs({ ...cadences, turning: false, settled: true }), cadences.settleMs);
  assert.equal(lite.paintIntervalMs({ ...cadences, turning: false, settled: false }), cadences.heartbeatMs);
  // Hidden means "rarely", never "never": a kiosk panel the browser wrongly calls hidden — which is
  // what a wall panel looks like from inside — must still come back.
  assert.equal(lite.paintIntervalMs({ ...cadences, turning: true, hidden: true }), cadences.hiddenMs);
  assert.equal(lite.paintIntervalMs({ ...cadences, turning: false, hidden: true }), cadences.hiddenMs);
  assert.equal(lite.paintIntervalMs(), cadences.heartbeatMs, 'no options at all still paints');
  // Junk in any slot falls back to the heartbeat rather than to a cadence that stops the panel.
  for (const junk of [undefined, null, NaN, 0, -1, Infinity, 'soon']) {
    for (const slot of ['movingMs', 'settleMs', 'heartbeatMs', 'hiddenMs']) {
      const got = lite.paintIntervalMs({ ...cadences, turning: true, [slot]: junk });
      assert.ok(Number.isFinite(got) && got > 0, `${slot}=${String(junk)} gave ${String(got)}`);
    }
  }
});

// ---------------------------------------------------------------------------
// the loop always starts, and motion is slowed rather than stopped
// ---------------------------------------------------------------------------

test('the loop always starts, and motion is slowed rather than stopped', () => {
  // Read the page's own source here on purpose: the failure being guarded is a *shape* of code — the
  // reduce-motion preference replacing the loop with an occasional redraw — and the panel's DOM cannot
  // express it. The behavioural half of this lives in scripts/panel-motion-check.mjs.
  assert.ok(!html.includes('if (reducedMotion()) {'), 'reduce motion must not swap the loop for a redraw');
  assert.ok(!html.includes('}, 10000);'), 'no ten-second redraw remains');
  assert.ok(!html.includes('if (!reducedMotion()) startLoop();'), 'the loop is not gated on the preference');
  assert.ok(
    html.includes('app.paintMovingMs = reducedMotion() ? PAINT_REDUCED_MS : PAINT_MOVING_MS'),
    'reduce motion picks the slower cadence instead',
  );
  assert.ok(html.includes('var PAINT_REDUCED_MS = 1000 / 4;'), 'the slower cadence is a real cadence');
  // Parking the rotor is something the page is asked to do, never something it falls into.
  assert.ok(html.includes('app.still = motionOff();'), 'only ?motion=off parks the rotor');
  assert.ok(html.includes("q.get('motion')"), '?motion= is read');
  assert.equal(html.split('startLoop();').length - 1, 2, 'both the demo and the live path start the loop');
});

// ---------------------------------------------------------------------------
// a failed read is retried, not fatal
// ---------------------------------------------------------------------------

test('a failed read is retried, backing off but never giving up', () => {
  const first = lite.nextRetryMs(0);
  assert.ok(first > 0 && first <= 60000, `the first retry is prompt (got ${String(first)} ms)`);
  let ms = first;
  const seen = [];
  for (let i = 0; i < 12; i += 1) {
    ms = lite.nextRetryMs(ms);
    seen.push(ms);
  }
  assert.ok(seen.every((v) => Number.isFinite(v) && v > 0), 'every delay is a real delay');
  assert.ok(seen[seen.length - 1] <= 3600000, 'the backoff stays within the hour');
  assert.equal(seen[seen.length - 1], seen[seen.length - 2], 'and it does stop growing');
  assert.equal(lite.nextRetryMs(undefined), first, 'junk falls back to the first delay');
  assert.equal(lite.nextRetryMs(NaN), first, 'NaN falls back to the first delay');
  // Scheduling the next read only on success was the bug: a panel that booted before its network came
  // up — the normal case after a power cut — never tried again and sat on NO DATA for ever.
  assert.ok(html.includes('scheduleRetry();'), 'a failed read schedules a retry');
  assert.ok(html.includes('app.retryMs = nextRetryMs(app.retryMs)'), 'the retry backoff is used');
  assert.ok(html.includes('app.retryMs = 0'), 'a clean read resets the backoff');
});

// ---------------------------------------------------------------------------
// the picture follows the season and the sun
// ---------------------------------------------------------------------------

const HEX = /^#[0-9a-f]{6}$/i;

test('every scene is complete, and every colour is a colour', () => {
  for (const season of lite.SEASONS) {
    assert.ok(lite.SCENES[season], `no scenes for ${season}`);
    for (const phase of lite.PHASES) {
      const scene = lite.SCENES[season][phase];
      assert.ok(scene, `${season}.${phase} is missing`);
      for (const key of lite.SCENE_KEYS) {
        assert.ok(key in scene, `${season}.${phase} has no ${key}`);
      }
      assert.ok(Array.isArray(scene.sky) && scene.sky.length >= 3, `${season}.${phase} needs a sky ramp`);
      for (const stop of scene.sky) assert.match(stop, HEX, `${season}.${phase} sky stop ${stop}`);
      for (const key of lite.SCENE_KEYS) {
        if (key === 'sky') continue;
        if (key === 'stars') {
          assert.ok(
            typeof scene.stars === 'number' && scene.stars >= 0 && scene.stars <= 1,
            `${season}.${phase} stars is a density between 0 and 1`,
          );
        } else {
          assert.match(scene[key], HEX, `${season}.${phase} ${key} is not a colour`);
        }
      }
      // A day scene full of stars, or a night scene without any, is a mistake a reader sees at once.
      if (phase === 'day') assert.equal(scene.stars, 0, `${season}.day should have no stars`);
      if (phase === 'night') assert.equal(scene.stars, 1, `${season}.night should be full of stars`);
    }
  }
  assert.equal(lite.SEASONS.length * lite.PHASES.length, 16, 'four seasons by four phases');
  assert.ok(!('fixed' in lite.SCENES), 'the panel\'s own palette is a fallback, not a scene');
});

test('the season is a month, not a guess', () => {
  const at = (m) => lite.seasonFor(new Date(2026, m, 15));
  assert.equal(at(0), 'winter');
  assert.equal(at(1), 'winter');
  assert.equal(at(11), 'winter');
  assert.equal(at(2), 'spring');
  assert.equal(at(4), 'spring');
  assert.equal(at(5), 'summer');
  assert.equal(at(7), 'summer');
  assert.equal(at(8), 'autumn');
  assert.equal(at(10), 'autumn');
  const seen = new Set([...Array(12).keys()].map(at));
  assert.deepEqual([...seen].sort(), ['autumn', 'spring', 'summer', 'winter'], 'all four seasons occur');
});

test('sunrise and sunset come from the coordinate, so the day length follows the season', () => {
  const CEST = 7200; // a fixed offset, so the assertions do not depend on this machine's timezone
  const LUND = [55.7047, 13.191];
  const dayHours = (lat, lon, m, d) => {
    const ev = lite.solarEvents(lat, lon, new Date(2026, m, d), CEST);
    assert.ok(ev, `no solar events for ${lat},${lon}`);
    return (ev.sunset - ev.sunrise) / 60;
  };
  const midsummer = dayHours(...LUND, 5, 21);
  const midwinter = dayHours(...LUND, 11, 21);
  const equinox = dayHours(...LUND, 2, 20);
  assert.ok(midsummer > 16.5 && midsummer < 18.5, `Lund midsummer day is ${midsummer.toFixed(2)} h`);
  assert.ok(midwinter > 6.5 && midwinter < 7.5, `Lund midwinter day is ${midwinter.toFixed(2)} h`);
  assert.ok(Math.abs(equinox - 12) < 0.5, `Lund equinox day is ${equinox.toFixed(2)} h`);
  assert.ok(midsummer > equinox && equinox > midwinter, 'the year runs winter, equinox, summer');
  // The equator barely notices the seasons; past the circle there is no sunrise to place a phase on.
  for (const [m, d] of [[5, 21], [11, 21]]) {
    const eq = dayHours(0, 13.191, m, d);
    assert.ok(Math.abs(eq - 12) < 0.5, `equator day is ${eq.toFixed(2)} h`);
  }
  assert.equal(lite.solarEvents(78.22, 15.63, new Date(2026, 5, 21), CEST), null, 'Svalbard midsummer: no sunset');
  assert.equal(lite.solarEvents(78.22, 15.63, new Date(2026, 11, 21), CEST), null, 'Svalbard midwinter: no sunrise');
  // Fifteen degrees of longitude is an hour of solar time.
  const east = lite.solarEvents(55.7047, 28.191, new Date(2026, 5, 21), CEST).sunrise;
  const west = lite.solarEvents(55.7047, 13.191, new Date(2026, 5, 21), CEST).sunrise;
  assert.ok(Math.abs(east - west + 60) < 1, `15 degrees east is an hour earlier (got ${(east - west).toFixed(1)} min)`);
  // The sun is indifferent to hemispheres and the signed latitude gets that right: Sydney's shortest
  // day is 21 June, and the equation returns it. The *season* mapping is another matter — it is
  // month-based on purpose (hard switches, no interpolation) and therefore assumes the north, so a
  // panel pointed at a southern machine would show winter in June.
  const sydney = lite.solarEvents(-33.87, 151.21, new Date(2026, 5, 21), 36000);
  assert.ok(sydney, 'a southern coordinate still has a sunrise');
  const sydneyJune = (sydney.sunset - sydney.sunrise) / 60;
  assert.ok(Math.abs(sydneyJune - 9.9) < 0.5, `Sydney's June day is ${sydneyJune.toFixed(2)} h`);
  const sydneyDecember = lite.solarEvents(-33.87, 151.21, new Date(2026, 11, 21), 36000);
  assert.ok((sydneyDecember.sunset - sydneyDecember.sunrise) / 60 > sydneyJune + 3, 'and its days lengthen in December');
  assert.ok(midsummer / sydneyJune > 1.6, 'the two hemispheres are opposite in June');
  assert.equal(lite.seasonFor(new Date(2026, 5, 21)), 'summer', 'the season mapping itself is northern');
});

test('the four phases hang off sunrise and sunset, with a clock fallback under a polar sky', () => {
  const W = lite.PHASE_WINDOW_MIN;
  assert.ok(W > 0 && W < 180, 'dawn and dusk are windows, not half the day');
  const ev = { sunrise: 300, sunset: 1200 };
  assert.equal(lite.phaseFor(300, ev), 'dawn');
  assert.equal(lite.phaseFor(300 - W, ev), 'dawn');
  assert.equal(lite.phaseFor(300 + W - 1, ev), 'dawn');
  assert.equal(lite.phaseFor(300 + W, ev), 'day');
  assert.equal(lite.phaseFor(1200 - W - 1, ev), 'day');
  assert.equal(lite.phaseFor(1200, ev), 'dusk');
  assert.equal(lite.phaseFor(1200 + W - 1, ev), 'dusk');
  assert.equal(lite.phaseFor(240, ev), 'night');
  assert.equal(lite.phaseFor(0, ev), 'night');
  // No solar events means polar day or night, which must fall back to the clock, never to no scene.
  const fallback = [[120, 'night'], [360, 'dawn'], [720, 'day'], [1140, 'dusk'], [1380, 'night']];
  for (const [minute, want] of fallback) {
    assert.equal(lite.phaseFor(minute, null), want, `clock fallback at ${minute} min`);
  }
});

test('sceneFor pairs a season with a phase, and the panel keeps its own palette by default', () => {
  const picked = lite.sceneFor(new Date(2026, 0, 15, 12, 0), 55.7047, 13.191);
  assert.equal(picked.season, 'winter');
  assert.equal(picked.phase, 'day');
  assert.equal(picked.scene, lite.SCENES.winter.day);
  const night = lite.sceneFor(new Date(2026, 6, 15, 1, 0), 55.7047, 13.191);
  assert.equal(night.season, 'summer');
  assert.equal(night.phase, 'night');
  // The seasonal look is opt-in: until it is asked for, the panel draws its original palette.
  assert.ok(html.includes("q.get('scene')"), '?scene= is read');
  assert.ok(html.includes('?scene=auto'), 'the parameter is documented in the page');
  assert.ok(html.includes('sceneKey: \'fixed\''), 'the panel starts on its own fixed palette');
  assert.ok(html.includes('scene: null,'), 'which is to say, on no scene at all');
  assert.ok(html.includes('app.scene = picked ? picked.scene : null'), 'and falls back to it');
  assert.ok(html.includes('var sc = app.scene || P;'), 'both the sky and the field read the scene');
  assert.equal(html.split('var sc = app.scene || P;').length - 1, 2, 'sky and field both read it');
});
