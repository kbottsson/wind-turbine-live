// Single source of truth for every tunable number in this project.
// Change a value here and both the 3D model and the physics follow.

export const TURBINE = Object.freeze({
  label: 'Generic 2.5 MW class',
  rotorDiameter: 90, // m
  hubHeight: 100, // m — matches the API's 100 m wind height, so no extrapolation
  bladeCount: 3,
  tipSpeedRatio: 6.5, // lambda at the design point
  powerCoefficient: 0.4, // Cp; the Betz limit is 0.593
  airDensity: 1.225, // kg/m^3
  ratedPower: 2.5e6, // W
  cutInSpeed: 3.0, // m/s
  cutOutSpeed: 25.0, // m/s
  cutOutResetSpeed: 22.0, // m/s — hysteresis, so it cannot chatter at the cut-out boundary
});

export const MOTION = Object.freeze({
  rotorTau: 4.0, // s — RPM easing time constant. Set to 0 for a hard snap to each hourly value.
  yawRateDegPerSec: 0.5,
  yawToleranceDeg: 8,
  maxRenderRpm: 30, // clamp, so nothing strobes on high-refresh displays
  cameraAutoRotate: false,
});

// The viewer stands on the ground: eye height, aimed at the machine's vertical centre, far
// enough back that the topmost blade tip and the tower base are both in the frame. The viewpoint
// is fixed, because the page is meant to hang on a wall — the machine turns under it instead.
// The rotor faces into the wind, so the nacelle's yaw is what shows which way the wind is blowing.
export const CAMERA = Object.freeze({
  fovDeg: 40,
  eyeHeight: 1.7, // m — a standing person's eye, so the base of the tower stays in view
  marginDeg: 2, // keep the blade tip and the ground clear of the frame edge
  standOff: 1.06, // extra distance, so a strip of ground below the tower base stays in frame
  viewAzimuthDeg: 180, // the viewer stands due south of the machine, looking north at it
  compassRingFactor: 1.6, // ring radius, as a multiple of the standing distance
  compassLabelSize: 0.055, // apparent height of the N/E/S/W labels, as a fraction of frame height
});

export const SITE = Object.freeze({
  apiBase: 'https://api.open-meteo.com/v1/forecast',
  hourlyVars: ['wind_speed_100m', 'wind_direction_10m', 'wind_gusts_10m'],
  windSpeedUnit: 'ms',
  pastDays: 1,
  forecastDays: 2,
  fetchTimeoutMs: 10000,
  refreshMs: 3600000, // one fetch per hour, per D's decision
});

// three.js is pinned in the import map in index.html (CDN, no vendoring by decision).
// Current pin: three@0.186.0 via jsDelivr.
