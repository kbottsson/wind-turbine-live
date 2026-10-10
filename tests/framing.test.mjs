// Unit tests for the pure camera framing maths. Run: npm test
//
// The claim being tested is the whole point of the standing view: from eye level, at the fitted
// stand-off, the topmost blade tip AND the tower base are both inside the frame, for every layout
// the page is built for. Reference numbers come from src/config.js:
//   hub height 100 m, rotor 90 m  ->  tip at 147 m
//   fov 40 deg, margin 2 deg, stand-off factor 1.06  ->  ~234 m, pitched ~17 deg up

import test from 'node:test';
import assert from 'node:assert/strict';

import { CAMERA, TURBINE } from '../src/config.js';
import {
  TIP_TOP,
  bearingVector,
  compassRingRadius,
  facingBearingDeg,
  facingRotationRad,
  frameFraction,
  halfFov,
  standingView,
  usableHalfAngle,
  viewerBearingDeg,
} from '../src/framing.js';

const ASPECTS = [
  ['desktop 16:9', 16 / 9],
  ['laptop 3:2', 3 / 2],
  ['square', 1],
  ['tablet 4:3', 4 / 3],
  ['phone portrait 3:4', 3 / 4],
  ['phone portrait 9:16', 9 / 16],
];

const close = (a, b, tol = 0.02) =>
  assert.ok(Math.abs(a - b) < tol, `expected ${a} to be within ${tol} of ${b}`);

test('the machine is 147 m to the blade tip', () => {
  close(TIP_TOP, TURBINE.hubHeight + 2 + TURBINE.rotorDiameter / 2);
  close(TIP_TOP, 147);
});

for (const [name, aspect] of ASPECTS) {
  test(`${name}: tower base and blade tip are both inside the frame`, () => {
    const base = frameFraction(0, aspect);
    const tip = frameFraction(TIP_TOP, aspect);
    assert.ok(base > -1, `base at ${base.toFixed(3)} of the half-height, outside the bottom edge`);
    assert.ok(tip < 1, `tip at ${tip.toFixed(3)} of the half-height, outside the top edge`);
  });

  test(`${name}: neither end sits hard against a frame edge`, () => {
    // 5% of the half-height of clearance at each end: the tip must not be clipped and the
    // ground below the tower base must stay visible.
    assert.ok(frameFraction(0, aspect) < -0.05, 'ground below the tower base is too tight');
    assert.ok(frameFraction(TIP_TOP, aspect) < 0.95, 'blade tip is too close to the top edge');
  });

  test(`${name}: the machine reaches into both halves of the frame`, () => {
    assert.ok(frameFraction(0, aspect) < -0.35, 'the machine does not fill the lower half');
    assert.ok(frameFraction(TIP_TOP, aspect) > 0.35, 'the blade tip does not reach the upper half');
  });

  test(`${name}: the whole machine uses most of the frame`, () => {
    const span = frameFraction(TIP_TOP, aspect) - frameFraction(0, aspect);
    assert.ok(span > 0.6, `machine spans only ${span.toFixed(3)} of the 2 half-heights`);
  });

  test(`${name}: the view is pitched up, not looking down`, () => {
    const { aim, pitch } = standingView(aspect);
    assert.ok(pitch <= usableHalfAngle() + 1e-9, 'the aim rises past the ground-in-frame limit');
    assert.ok(pitch > 0, 'the aim is above the horizon: the viewer looks up at the machine');
    assert.ok(aim > CAMERA.eyeHeight, 'aiming at the machine, not at the viewer’s own height');
  });

  test(`${name}: the ground compass ring sits outside the viewer`, () => {
    assert.ok(compassRingRadius(aspect) > standingView(aspect).distance);
  });
}

test('desktop: the fitted stand-off and pitch are the documented ones', () => {
  const { aim, distance, pitch } = standingView(16 / 9);
  close(aim, 73.5);
  close(distance, 234.2, 0.5);
  close((pitch * 180) / Math.PI, 17.0, 0.1);
});

test('a narrow frame stands further back than a wide one', () => {
  assert.ok(standingView(9 / 16).distance > standingView(16 / 9).distance);
  // ...and a very wide frame is limited by the vertical fit, not the horizontal one.
  close(standingView(16 / 9).distance, standingView(2.4).distance, 1e-6);
});

test('half-angle helpers agree with the configured fov and margin', () => {
  close((halfFov() * 180) / Math.PI, 20);
  close(((usableHalfAngle() * 180) / Math.PI), 18);
});

test('the old elevated framing is gone', () => {
  // The previous camera sat 24.9 deg above the target with the eye ~176 m up, i.e. looking down
  // on the machine. Nothing in the standing fit may be above eye height.
  for (const [, aspect] of ASPECTS) {
    const pitchDeg = (standingView(aspect).pitch * 180) / Math.PI;
    assert.ok(pitchDeg < 20, `pitch ${pitchDeg.toFixed(1)} deg is still a down-looking view`);
  }
  assert.ok(CAMERA.eyeHeight < 2, 'the eye is at standing height');
});

// ---------------------------------------------------------------------------
// the nacelle faces the wind, and the viewer stands where the rotor is visible
// ---------------------------------------------------------------------------

const WIND_BEARINGS = [0, 45, 90, 137, 180, 225, 260, 315, 359];

test('a bearing maps to a scene direction with north at -Z and east at +X', () => {
  const north = bearingVector(0);
  close(north.x, 0, 1e-9);
  close(north.z, -1, 1e-9);
  const east = bearingVector(90);
  close(east.x, 1, 1e-9);
  close(east.z, 0, 1e-9);
  const south = bearingVector(180);
  close(south.z, 1, 1e-9);
  const west = bearingVector(270);
  close(west.x, -1, 1e-9);
});

test('the nacelle nose ends up pointing at the wind, for every bearing', () => {
  for (const h of WIND_BEARINGS) {
    const t = facingRotationRad(h);
    // Rotating the model's +X nose by t about Y gives (cos t, 0, -sin t); its bearing must be h.
    const nose = { x: Math.cos(t), z: -Math.sin(t) };
    const bearing = ((Math.atan2(nose.x, -nose.z) * 180) / Math.PI + 360) % 360;
    close(bearing, h, 1e-6);
    close(facingBearingDeg(t), h, 1e-6);
  }
});

test('the nose is not 90 degrees off the wind, which is what -bearing did', () => {
  // Regression guard for the bug that made the page show the machine's back: rotation.y was set
  // to -bearing, which points the +X nose 90 deg further round. Wind 260 deg put the nose at 350.
  for (const h of WIND_BEARINGS) {
    const wrong = ((-h * Math.PI) / 180);
    if (h === 0) continue; // -0 and +0 agree; the helper is what matters for the rest
    assert.notEqual(facingBearingDeg(wrong).toFixed(3), facingBearingDeg(facingRotationRad(h)).toFixed(3));
  }
  close(facingBearingDeg((-260 * Math.PI) / 180) % 360, 350, 1e-6); // the measured bug
});

test('the viewer stands due south of the machine, looking north at it', () => {
  close(viewerBearingDeg(), 180, 1e-9);
  const where = bearingVector(viewerBearingDeg());
  close(where.x, 0, 1e-9); // no east-west offset: square on to the tower
  close(where.z, 1, 1e-9); // +Z is south
});

test('the viewpoint is a fixture: no wind direction can move it', () => {
  // The page hangs on a wall, so the camera takes no wind input at all. Passing one must not
  // budge it, otherwise the machine would stop being the thing that moves.
  for (const wind of WIND_BEARINGS) {
    close(viewerBearingDeg(wind), 180, 1e-9);
  }
});

test('a southerly wind turns the rotor square to the viewer, a northerly one turns it away', () => {
  const viewer = viewerBearingDeg();
  // Angular separation between where the rotor faces and where the viewer stands.
  const separation = (wind) =>
    Math.abs(((facingBearingDeg(facingRotationRad(wind)) - viewer + 540) % 360) - 180);
  close(separation(180), 0, 1e-6); // wind from due south: dead ahead, the rotor face
  close(separation(0), 180, 1e-6); // wind from due north: the viewer is behind the machine
  close(separation(90), 90, 1e-6); // wind from the east: the rotor seen edge-on
  // Within 90 deg of the viewer's bearing the rotor face is toward them; past that they are
  // looking at the back of the machine. Half the wind rose each way: that is the physics of a
  // fixed viewpoint on an upwind machine, not a defect.
  assert.ok(separation(135) < 90 && separation(225) < 90, 'southerly winds read as a front view');
  assert.ok(separation(45) > 90 && separation(315) > 90, 'northerly winds read as a back view');
});
