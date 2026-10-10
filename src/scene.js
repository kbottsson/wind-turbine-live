// Renderer, camera, lights, ground, sky, compass and resize handling.
// Everything DOM/WebGL lives here; the turbine itself is in turbine.js.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAMERA, MOTION, TURBINE } from './config.js';
import { bearingVector, compassRingRadius, halfFov, standingView, viewerBearingDeg } from './framing.js';
import { groundMaterial } from './turbine.js';

const SKY_TOP = '#0a1521';
const SKY_HORIZON = '#28455f';
const SKY_BOTTOM = '#101a20';
const LABEL_HEIGHT = 22; // m — the compass labels sit just above the ground plane

export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoftShadowMap was removed in three 0.186
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(SKY_HORIZON, 620, 3200);

  const camera = new THREE.PerspectiveCamera(CAMERA.fovDeg, 1, 0.5, 5000);
  // Provisional: fitCamera() replaces this on the first setSize(), a viewer on the ground.
  camera.position.set(0, CAMERA.eyeHeight, 240);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, standingView().aim, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.enablePan = false;
  controls.minDistance = 60;
  controls.maxDistance = 900;
  // The standing view looks *up* at the machine, so the useful orbit runs past the horizontal.
  // Swinging under the ground plane is prevented in render().
  controls.maxPolarAngle = Math.PI * 0.62;
  controls.autoRotate = MOTION.cameraAutoRotate && !prefersReducedMotion();

  // Touch devices: OrbitControls swallows the vertical drag, which traps the user on the
  // canvas. The framing is auto-fitted and there is nothing to explore, so leave it off.
  if (window.matchMedia('(pointer: coarse)').matches) controls.enabled = false;

  addSky(scene);
  addLights(scene);
  addGround(scene);
  const compass = addCompass(scene);

  const state = { width: 1, height: 1 };

  /** Stand the camera on the ground at a compass bearing from the tower, aimed at the machine. */
  function placeView(bearingDeg) {
    const { aim, distance } = standingView(camera.aspect);
    const dir = bearingVector(bearingDeg);
    controls.target.set(0, aim, 0);
    camera.position.set(dir.x * distance, CAMERA.eyeHeight, dir.z * distance);
    camera.lookAt(controls.target);
  }

  /**
   * Stand the viewer on the ground at the fitted distance, aimed at the machine's vertical
   * centre, and put the compass ring outside them. Re-run on every resize, so the phone layout
   * is a genuine standing view rather than a cropped desktop framing.
   *
   * The viewpoint does not move: the bearing is fixed in config.js, and everything that changes
   * hour to hour happens to the machine — the rotor speed and the nacelle yawing into the wind.
   */
  function fitCamera() {
    placeView(viewerBearingDeg());

    const ring = compassRingRadius(camera.aspect);
    compass.ring.scale.setScalar(ring);
    for (const label of compass.labels) {
      label.position.set(label.userData.unitX * ring, LABEL_HEIGHT, label.userData.unitZ * ring);
    }
    controls.update();
  }

  function setSize(width, height) {
    if (width < 1 || height < 1) return;
    state.width = width;
    state.height = height;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    fitCamera();
    camera.updateProjectionMatrix();
  }

  function render() {
    controls.update();
    keepEyeAboveGround();
    sizeCompassLabels();
    renderer.render(scene, camera);
  }

  /**
   * The orbit is free to swing past the horizontal, which would put the camera under the ground
   * plane. Hold it at eye height instead: the viewer walks around the machine on the ground.
   */
  function keepEyeAboveGround() {
    if (camera.position.y >= CAMERA.eyeHeight) return;
    camera.position.y = CAMERA.eyeHeight;
    camera.lookAt(controls.target);
  }

  /**
   * Keep the N/E/S/W labels the same size on screen whatever their distance: the ring runs from
   * close to distant across the frame, and a compass rose is read as an overlay, not as scenery.
   */
  function sizeCompassLabels() {
    const frameHeight = 2 * Math.tan(halfFov(camera.fov));
    for (const label of compass.labels) {
      const size = CAMERA.compassLabelSize * frameHeight * label.position.distanceTo(camera.position);
      label.scale.set(size, size, 1);
    }
  }

  function dispose() {
    controls.dispose();
    renderer.dispose();
    scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        materials.forEach((m) => {
          if (m.map) m.map.dispose();
          m.dispose();
        });
      }
    });
  }

  return { renderer, scene, camera, controls, setSize, render, dispose, size: state };
}

export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function addSky(scene) {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, SKY_TOP);
  gradient.addColorStop(0.62, SKY_HORIZON);
  gradient.addColorStop(1, SKY_BOTTOM);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 2, 256);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(3600, 32, 20),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, depthWrite: false, fog: false }),
  );
  scene.add(sky);
}

function addLights(scene) {
  scene.add(new THREE.HemisphereLight('#9dc0e0', '#24322b', 1.25));

  const sun = new THREE.DirectionalLight('#fff1dd', 2.2);
  sun.position.set(-190, 300, 170);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 50;
  sun.shadow.camera.far = 900;
  sun.shadow.camera.left = -220;
  sun.shadow.camera.right = 220;
  sun.shadow.camera.top = 220;
  sun.shadow.camera.bottom = -220;
  sun.shadow.bias = -0.0006;
  sun.target.position.set(0, TURBINE.hubHeight * 0.4, 0);
  scene.add(sun, sun.target);
}

function addGround(scene) {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), groundMaterial());
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
}

/**
 * Ground compass so the nacelle's yaw into the wind is legible: -Z is north.
 * Built at unit radius; fitCamera() scales it out to compassRingRadius() and positions the
 * labels on that ring, so the ring always sits outside the viewer's stance.
 */
function addCompass(scene) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.98, 1, 128),
    new THREE.MeshBasicMaterial({
      color: '#7fa4c4',
      transparent: true,
      opacity: 0.13,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.4;
  scene.add(ring);

  const marks = [
    ['N', 0, -1],
    ['E', 1, 0],
    ['S', 0, 1],
    ['W', -1, 0],
  ];
  const labels = marks.map(([text, unitX, unitZ]) => {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: labelTexture(text),
        transparent: true,
        depthWrite: false,
        opacity: 0.5,
      }),
    );
    sprite.userData = { unitX, unitZ };
    sprite.position.set(unitX * 250, LABEL_HEIGHT, unitZ * 250); // replaced by fitCamera()
    scene.add(sprite);
    return sprite;
  });

  return { ring, labels };
}

function labelTexture(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#cfe0f0';
  ctx.font = 'bold 76px -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 68);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
