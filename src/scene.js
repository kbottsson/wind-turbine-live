// Renderer, camera, lights, ground, sky, compass and resize handling.
// Everything DOM/WebGL lives here; the turbine itself is in turbine.js.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MOTION, TURBINE } from './config.js';
import { groundMaterial } from './turbine.js';

const SKY_TOP = '#0a1521';
const SKY_HORIZON = '#28455f';
const SKY_BOTTOM = '#101a20';

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

  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 5000);
  camera.position.set(130, 110, 190);

  const controls = new OrbitControls(camera, renderer.domElement);
  const tipTop = TURBINE.hubHeight + 2 + TURBINE.rotorDiameter / 2; // topmost blade tip
  controls.target.set(0, tipTop / 2, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.enablePan = false;
  controls.minDistance = 60;
  controls.maxDistance = 900;
  controls.maxPolarAngle = Math.PI / 2 - 0.03;
  controls.autoRotate = MOTION.cameraAutoRotate && !prefersReducedMotion();

  // Touch devices: OrbitControls swallows the vertical drag, which traps the user on the
  // canvas. The framing is auto-fitted and there is nothing to explore, so leave it off.
  if (window.matchMedia('(pointer: coarse)').matches) controls.enabled = false;

  addSky(scene);
  addLights(scene);
  addGround(scene);
  addCompass(scene);

  const state = { width: 1, height: 1 };

  function setSize(width, height) {
    if (width < 1 || height < 1) return;
    state.width = width;
    state.height = height;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    fitCamera(camera, controls);
    camera.updateProjectionMatrix();
  }

  function render() {
    controls.update();
    renderer.render(scene, camera);
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

/**
 * Frame the whole machine deterministically for the given aspect ratio: a fixed distance
 * along a fixed viewing direction, chosen so the 100 m tower and 45 m rotor radius both fit.
 * Re-run on every resize, so the phone layout is not a cropped desktop framing.
 */
function fitCamera(camera, controls) {
  const fov = (camera.fov * Math.PI) / 180;
  const tipTop = TURBINE.hubHeight + 2 + TURBINE.rotorDiameter / 2; // topmost blade tip, m
  const fitHeight = tipTop + 26; // the machine spans 0 … tipTop, centred on the target
  const fitWidth = TURBINE.rotorDiameter * 1.6;
  const distanceV = fitHeight / 2 / Math.tan(fov / 2);
  const distanceH = fitWidth / 2 / (Math.tan(fov / 2) * camera.aspect);
  const distance = Math.max(distanceV, distanceH) * 1.03;
  const direction = new THREE.Vector3(0.52, 0.42, 0.74).normalize();
  camera.position.copy(controls.target).addScaledVector(direction, distance);
  camera.lookAt(controls.target);
  controls.update();
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

/** Compass ring so the nacelle's yaw into the wind is legible: -Z is north. */
function addCompass(scene) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(250, 254, 128),
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

  const labels = [
    ['N', 0, -246],
    ['E', 246, 0],
    ['S', 0, 246],
    ['W', -246, 0],
  ];
  for (const [text, x, z] of labels) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: labelTexture(text),
        transparent: true,
        depthWrite: false,
        opacity: 0.5,
      }),
    );
    sprite.position.set(x, 22, z);
    sprite.scale.set(22, 22, 1);
    scene.add(sprite);
  }
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
