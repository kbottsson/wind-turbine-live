// Procedural wind turbine: tower, nacelle, hub, three lofted blades.
// No external model file, by decision — the geometry is generated from the same
// parameters that drive the physics, so the two cannot drift apart.

import * as THREE from 'three';
import { TURBINE, MOTION } from './config.js';
import { easeTowards, slewTowardsDeg, advanceAngle } from './wind-model.js';

const TAU = Math.PI * 2;
export const ROTOR_RADIUS = TURBINE.rotorDiameter / 2;
const HUB_RADIUS = 2.4;
const BLADE_ROOT_R = 1.9; // inside the hub fairing, so no visible gap at the root
const BLADE_SPAN = ROTOR_RADIUS - BLADE_ROOT_R;

const MATERIALS = {
  tower: new THREE.MeshStandardMaterial({ color: '#d5dbe2', roughness: 0.52, metalness: 0.22 }),
  nacelle: new THREE.MeshStandardMaterial({ color: '#e9eef4', roughness: 0.42, metalness: 0.2 }),
  blade: new THREE.MeshStandardMaterial({
    color: '#dfe6ee',
    roughness: 0.55,
    metalness: 0.05,
    side: THREE.DoubleSide, // the lofted surface is thin; draw both faces rather than gamble on winding
  }),
  hub: new THREE.MeshStandardMaterial({ color: '#c9d2db', roughness: 0.4, metalness: 0.35 }),
  ground: new THREE.MeshStandardMaterial({ color: '#2b3a32', roughness: 1, metalness: 0 }),
};

// ---------------------------------------------------------------------------
// blade geometry
// ---------------------------------------------------------------------------

/** NACA 4-digit half-thickness distribution, normalised so its maximum is 1. */
function thicknessShape(f) {
  const x = Math.min(Math.max(f, 0), 1);
  const yt = 5 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1015 * x ** 4);
  return Math.max(yt, 0) / 0.075; // 0.075 is the maximum of that polynomial (t = 0.15)
}

/**
 * Loft a tapered, twisted blade: a closed airfoil ring per spanwise station, stitched into
 * a surface. Span runs along +Y from the hub outward; chord along X; thickness along Z.
 */
export function bladeGeometry({
  span = BLADE_SPAN,
  stations = 18,
  profilePoints = 10,
  rootChord = 4.0,
  tipChord = 0.85,
  rootThickness = 0.32,
  tipThickness = 0.14,
  rootTwistDeg = 16,
  tipTwistDeg = 1,
} = {}) {
  const ring = 2 * profilePoints; // upper surface (n+1) + lower surface (n-1)
  const positions = [];
  const indices = [];

  for (let j = 0; j <= stations; j += 1) {
    const s = j / stations;
    const chord = rootChord + (tipChord - rootChord) * s ** 0.75;
    const thickness = rootThickness + (tipThickness - rootThickness) * s ** 0.6;
    const twist = ((rootTwistDeg + (tipTwistDeg - rootTwistDeg) * s) * Math.PI) / 180;
    const cos = Math.cos(twist);
    const sin = Math.sin(twist);
    const half = (thickness * chord) / 2;

    const push = (f, side) => {
      const xc = (f - 0.25) * chord; // pitch axis on the quarter chord
      const yc = side * half * thicknessShape(f);
      positions.push(xc * cos - yc * sin, BLADE_ROOT_R + s * span, xc * sin + yc * cos);
    };

    for (let i = 0; i <= profilePoints; i += 1) push(i / profilePoints, 1);
    for (let i = profilePoints - 1; i > 0; i -= 1) push(i / profilePoints, -1);
  }

  for (let j = 0; j < stations; j += 1) {
    for (let k = 0; k < ring; k += 1) {
      const k2 = (k + 1) % ring;
      const a = j * ring + k;
      const b = j * ring + k2;
      const c = (j + 1) * ring + k2;
      const d = (j + 1) * ring + k;
      indices.push(a, b, c, a, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// ---------------------------------------------------------------------------
// the rig
// ---------------------------------------------------------------------------

/**
 * Holds the transform state of the machine and applies it to the scene graph.
 * Rotor rpm is eased toward its target (rotor inertia) unless rotorTau is 0.
 */
export class TurbineRig {
  constructor() {
    this.group = new THREE.Group();
    this.yawGroup = new THREE.Group();
    this.rotor = new THREE.Group();

    // tower
    const tower = new THREE.Mesh(
      new THREE.CylinderGeometry(2.1, 3.6, TURBINE.hubHeight, 28),
      MATERIALS.tower,
    );
    tower.position.y = TURBINE.hubHeight / 2;
    tower.castShadow = true;
    tower.receiveShadow = true;
    this.group.add(tower);

    // foundation
    const base = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 6.4, 1.8, 28), MATERIALS.nacelle);
    base.position.y = 0.9;
    base.castShadow = true;
    base.receiveShadow = true;
    this.group.add(base);

    // yaw assembly: everything above the tower top turns together
    this.yawGroup.position.y = TURBINE.hubHeight;
    this.group.add(this.yawGroup);

    const nacelle = new THREE.Mesh(new THREE.BoxGeometry(11.5, 3.6, 3.6), MATERIALS.nacelle);
    nacelle.position.set(-1.3, 2.0, 0);
    nacelle.castShadow = true;
    nacelle.receiveShadow = true;
    this.yawGroup.add(nacelle);

    // shaft housing + spinner at the upwind end
    const hubBody = new THREE.Mesh(new THREE.CylinderGeometry(HUB_RADIUS, HUB_RADIUS, 3.4, 24), MATERIALS.hub);
    hubBody.rotation.z = -Math.PI / 2;
    hubBody.position.set(4.4, 2.0, 0);
    hubBody.castShadow = true;
    this.yawGroup.add(hubBody);

    this.rotor.position.set(5.6, 2.0, 0);
    this.rotor.castShadow = true;
    this.yawGroup.add(this.rotor);

    const spinner = new THREE.Mesh(new THREE.ConeGeometry(HUB_RADIUS * 0.95, 3.8, 24), MATERIALS.hub);
    spinner.rotation.z = -Math.PI / 2;
    spinner.position.x = 1.2;
    spinner.castShadow = true;
    this.rotor.add(spinner);

    const blade = bladeGeometry();
    for (let i = 0; i < TURBINE.bladeCount; i += 1) {
      const wedge = new THREE.Group();
      wedge.rotation.x = (i * TAU) / TURBINE.bladeCount;

      const mesh = new THREE.Mesh(blade, MATERIALS.blade);
      mesh.castShadow = true;
      wedge.add(mesh);

      // root stub fills the hub joint; tip cap closes the loft
      const stub = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 0.95, 4.6, 16), MATERIALS.blade);
      stub.position.y = BLADE_ROOT_R + 1.4;
      stub.castShadow = true;
      wedge.add(stub);

      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), MATERIALS.blade);
      tip.position.y = BLADE_ROOT_R + BLADE_SPAN;
      wedge.add(tip);

      this.rotor.add(wedge);
    }

    this.rpm = 0;
    this.rpmTarget = 0;
    this.yawDeg = 0;
    this.yawTarget = 0;
    this.rotorAngle = 0;
  }

  setTargetRpm(rpm) {
    this.rpmTarget = Number.isFinite(rpm) ? Math.min(rpm, MOTION.maxRenderRpm) : 0;
  }

  /** Meteorological direction (the bearing the wind blows FROM), in degrees. */
  setTargetYaw(deg) {
    this.yawTarget = Number.isFinite(deg) ? deg : this.yawDeg;
  }

  /** Force a state with no easing — used by screenshot verification. */
  applyImmediate({ rpm = this.rpmTarget, yawDeg = this.yawTarget, rotorAngle = 0 } = {}) {
    this.rpm = Math.min(rpm, MOTION.maxRenderRpm);
    this.rpmTarget = this.rpm;
    this.yawDeg = yawDeg;
    this.yawTarget = yawDeg;
    this.rotorAngle = rotorAngle;
    this.#apply();
  }

  update(dt) {
    this.rpm = easeTowards(this.rpm, this.rpmTarget, dt, MOTION.rotorTau);
    this.yawDeg = slewTowardsDeg(this.yawDeg, this.yawTarget, dt, MOTION.yawRateDegPerSec);
    this.rotorAngle = advanceAngle(this.rotorAngle, this.rpm, dt);
    this.#apply();
  }

  #apply() {
    this.rotor.rotation.x = this.rotorAngle;
    // Scene convention: -Z is north, so a bearing h maps to rotation.y = -h.
    this.yawGroup.rotation.y = (-this.yawDeg * Math.PI) / 180;
  }
}

export function groundMaterial() {
  return MATERIALS.ground;
}
