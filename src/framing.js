// Pure camera framing maths: where a person standing on the ground sees the whole machine.
//
// Kept free of three.js so the numbers can be unit tested (tests/framing.test.mjs) rather than
// judged from a screenshot.
//
// The machine spans from the ground (y = 0) to the topmost blade tip, which is
// hubHeight + 2 m of nacelle + the rotor radius. The viewer stands at eye height and aims at the
// machine's vertical centre, at the shortest stand-off that keeps both ends inside the vertical
// field of view. Standing at the machine's own scale is the point: from 230 m a 150 m turbine
// fills the frame the way it does in a photograph, and the tower base is still in shot.
//
// The same module owns the compass convention, because the camera and the nacelle have to agree
// on it: bearing 0 is north, which the scene draws as -Z, and bearing 90 is east, which is +X.

import { CAMERA, TURBINE } from './config.js';

/** Topmost blade tip above ground, m. */
export const TIP_TOP = TURBINE.hubHeight + 2 + TURBINE.rotorDiameter / 2;

/** Vertical half-angle of the frame, radians. */
export function halfFov(fovDeg = CAMERA.fovDeg) {
  return (fovDeg * Math.PI) / 360;
}

/** How far the aim may rise above the horizontal and still leave the ground in frame, radians. */
export function usableHalfAngle() {
  return halfFov() - (CAMERA.marginDeg * Math.PI) / 180;
}

/**
 * The standing view for a frame of the given aspect ratio.
 *
 * Returns:
 *   aim      - height above ground the viewer looks at, m (the machine's vertical centre)
 *   distance - horizontal stand-off from the tower, m
 *   pitch    - how far above the horizontal the view is tilted, radians
 */
export function standingView(aspect = 16 / 9) {
  const aim = TIP_TOP / 2;
  const usable = usableHalfAngle();
  // Limit 1, vertical: the aim may not rise so far that the ground drops out of the frame.
  const distanceV = (aim - CAMERA.eyeHeight) / Math.tan(usable);
  // Limit 2, horizontal: the rotor has to fit across a narrow, portrait frame as well.
  const distanceH = ((TURBINE.rotorDiameter / 2) * 1.15) / (Math.tan(usable) * aspect);
  const distance = Math.max(distanceV, distanceH) * CAMERA.standOff;
  return { aim, distance, pitch: Math.atan((aim - CAMERA.eyeHeight) / distance) };
}

/**
 * Where a height above ground lands in the frame, as a fraction of the half-height: -1 is the
 * bottom edge, 0 the centre, +1 the top edge. Everything that has to be visible — the tower base
 * at 0 m and the blade tip at TIP_TOP — must fall inside (-1, 1), with margin.
 */
export function frameFraction(height, aspect = 16 / 9) {
  const { aim, distance } = standingView(aspect);
  const angle = Math.atan((height - CAMERA.eyeHeight) / distance) - Math.atan((aim - CAMERA.eyeHeight) / distance);
  return angle / halfFov();
}

/** Radius of the ground compass ring, m: always outside the viewer's stance. */
export function compassRingRadius(aspect = 16 / 9) {
  return standingView(aspect).distance * CAMERA.compassRingFactor;
}

// ---------------------------------------------------------------------------
// compass convention: bearings in, scene directions and rotations out
// ---------------------------------------------------------------------------

/** Unit direction on the ground plane for a compass bearing: north is -Z, east is +X. */
export function bearingVector(bearingDeg) {
  const rad = (bearingDeg * Math.PI) / 180;
  return { x: Math.sin(rad), z: -Math.cos(rad) };
}

/**
 * Rotation about Y, in radians, that turns a model whose nose points along its own +X axis to
 * face the given compass bearing. Solving (cos t, 0, -sin t) = (sin h, 0, -cos h) gives
 * t = 90° - h. Note this is NOT -h: that mapping points the nose 90° off the wind.
 */
export function facingRotationRad(bearingDeg) {
  return ((90 - bearingDeg) * Math.PI) / 180;
}

/** The bearing a +X-nosed model faces, for a given rotation about Y. Inverse of the above. */
export function facingBearingDeg(rotationRad) {
  return (((90 - (rotationRad * 180) / Math.PI) % 360) + 360) % 360;
}

/** The bearing the viewer stands on: fixed, because the page hangs on a wall. */
export function viewerBearingDeg() {
  return ((CAMERA.viewAzimuthDeg % 360) + 360) % 360;
}
