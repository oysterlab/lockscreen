import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { MeshoptDecoder } from "https://cdn.jsdelivr.net/npm/meshoptimizer@0.20.0/meshopt_decoder.module.js";

const MODEL_URL = new URL("./cat-lock-meshopt.glb", import.meta.url).href;

const canvas = document.querySelector("#scene");
const timeEl = document.querySelector("#time");
const dateEl = document.querySelector("#date");
const statusEl = document.querySelector("#status");
const motionButton = document.querySelector("#motionButton");
const fullscreenButton = document.querySelector("#fullscreenButton");
const resetButton = document.querySelector("#resetButton");

const CAMERA_HOME = {
  x: 0,
  y: 1.34,
  z: 6.4,
  lookX: 0,
  lookY: 1.1,
};

const MODEL_HOME = {
  yaw: 0,
  pitch: 0,
  roll: 0,
};

const PARALLAX = {
  sensorDeadZoneY: 0.26,
  pointerDeadZoneY: 0.08,
  sensorYMin: -0.48,
  sensorYMax: 0.16,
  pointerYMin: -0.5,
  pointerYMax: 0.24,
};

const TOUCH_CAMERA = {
  minTilt: -1,
  maxTilt: 0.55,
  sensitivity: 2.35,
};

window.addEventListener("load", () => window.lucide?.createIcons());

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xf0a762, 0.026);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: "high-performance",
});
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const pmremGenerator = new THREE.PMREMGenerator(renderer);
const roomEnvironment = new RoomEnvironment(renderer);
scene.environment = pmremGenerator.fromScene(roomEnvironment, 0.045).texture;
scene.environmentIntensity = 0.5;
roomEnvironment.dispose();

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
const world = new THREE.Group();
const backdrop = new THREE.Group();
const modelAnchor = new THREE.Group();
const clock = new THREE.Clock();
let mixer = null;

scene.add(world);
world.add(backdrop);
world.add(modelAnchor);

const target = {
  cameraX: CAMERA_HOME.x,
  cameraY: CAMERA_HOME.y,
  cameraZ: CAMERA_HOME.z,
  lookX: CAMERA_HOME.lookX,
  lookY: CAMERA_HOME.lookY,
  modelPitch: MODEL_HOME.pitch,
  modelYaw: MODEL_HOME.yaw,
  modelRoll: MODEL_HOME.roll,
  backdropYaw: 0,
};

const motion = {
  baseBeta: null,
  baseGamma: null,
  baseGravityX: null,
  baseGravityY: null,
  lastReadingAt: 0,
  probeTimer: 0,
};

const touch = {
  active: false,
  pointerId: null,
  startX: 0,
  startY: 0,
  startTilt: 0,
  tilt: 0,
};

const state = {
  motionEnabled: false,
  hasMotionReading: false,
};

setupLights();
setupDiorama();
resize();
updateClock();
setInterval(updateClock, 30_000);

loadModel();
startPassiveMotion();
requestAnimationFrame(render);

window.addEventListener("resize", resize);
window.visualViewport?.addEventListener("resize", resize);
canvas.addEventListener("pointerdown", handlePointerDown, { passive: true });
canvas.addEventListener("pointermove", handlePointerMove, { passive: true });
canvas.addEventListener("pointerup", handlePointerEnd, { passive: true });
canvas.addEventListener("pointercancel", handlePointerEnd, { passive: true });
motionButton.addEventListener("click", enableMotion);
fullscreenButton.addEventListener("click", toggleFullscreen);
resetButton.addEventListener("click", resetView);
document.addEventListener("fullscreenchange", updateFullscreenButton);

function setupLights() {
  scene.add(new THREE.HemisphereLight(0xffe2b1, 0x6c3f22, 1.78));

  const sun = new THREE.DirectionalLight(0xffad5f, 4.35);
  sun.position.set(-3.6, 6.8, 5.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -4.2;
  sun.shadow.camera.right = 4.2;
  sun.shadow.camera.top = 4.2;
  sun.shadow.camera.bottom = -4.2;
  sun.shadow.bias = -0.00018;
  scene.add(sun);

  const softSky = new THREE.DirectionalLight(0xd9e8ff, 0.55);
  softSky.position.set(3.4, 3.8, 2.8);
  scene.add(softSky);

  const stallBulb = new THREE.PointLight(0xff9f4f, 4.45, 5.2, 1.9);
  stallBulb.position.set(1.4, 1.35, 1.15);
  scene.add(stallBulb);

  const windowGlow = new THREE.PointLight(0xffc878, 3.35, 4.8, 2);
  windowGlow.position.set(-1.55, 1.05, 0.9);
  scene.add(windowGlow);
}

function setupDiorama() {
  const shadowCatcher = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 2.8),
    new THREE.ShadowMaterial({
      color: 0x4e2f1e,
      opacity: 0.24,
      transparent: true,
      depthWrite: false,
    }),
  );
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.position.set(0, 0, 0.18);
  shadowCatcher.receiveShadow = true;
  world.add(shadowCatcher);
}

function addTileLines() {
  const lineMaterial = new THREE.MeshBasicMaterial({
    color: 0x5f4630,
    transparent: true,
    opacity: 0.34,
  });

  for (let i = -4; i <= 4; i += 1) {
    const horizontal = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.006, 0.008), lineMaterial);
    horizontal.position.set(0, 0.024, i * 0.28);
    horizontal.rotation.x = -Math.PI / 2;
    world.add(horizontal);

    const vertical = new THREE.Mesh(new THREE.BoxGeometry(0.006, 3.1, 0.008), lineMaterial);
    vertical.position.set(i * 0.28, 0.025, 0);
    vertical.rotation.x = -Math.PI / 2;
    world.add(vertical);
  }
}

function addWarmBackdrop() {
  const sky = new THREE.Mesh(
    new THREE.PlaneGeometry(5.2, 5.4),
    new THREE.MeshBasicMaterial({
      color: 0xf6bd7a,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    }),
  );
  sky.position.set(0, 1.6, -1.45);
  backdrop.add(sky);

  const wallMaterial = new THREE.MeshStandardMaterial({
    color: 0x936447,
    roughness: 0.88,
    metalness: 0,
  });
  const wall = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.58, 0.08), wallMaterial);
  wall.position.set(0, 0.34, -1.15);
  wall.receiveShadow = true;
  backdrop.add(wall);

  const gateMaterial = new THREE.MeshStandardMaterial({
    color: 0x4c744b,
    roughness: 0.78,
    metalness: 0.08,
  });
  for (let i = -2; i <= 2; i += 1) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.78, 0.035), gateMaterial);
    bar.position.set(-0.56 + i * 0.18, 0.38, -1.05);
    bar.castShadow = true;
    backdrop.add(bar);
  }

  const topRail = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.045, 0.04), gateMaterial);
  topRail.position.set(-0.56, 0.73, -1.04);
  backdrop.add(topRail);
}

function addCourtyardProps() {
  const potMaterial = new THREE.MeshStandardMaterial({
    color: 0xb5673c,
    roughness: 0.82,
    metalness: 0.02,
  });
  const leafMaterial = new THREE.MeshStandardMaterial({
    color: 0x6f8d40,
    roughness: 0.76,
    metalness: 0,
  });

  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.22, 24), potMaterial);
  pot.position.set(-1.18, 0.14, -0.34);
  pot.castShadow = true;
  world.add(pot);

  for (let i = 0; i < 7; i += 1) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), leafMaterial);
    const angle = (i / 7) * Math.PI * 2;
    leaf.scale.set(1.15, 0.55, 0.75);
    leaf.position.set(-1.18 + Math.cos(angle) * 0.12, 0.28 + (i % 2) * 0.04, -0.34 + Math.sin(angle) * 0.08);
    leaf.castShadow = true;
    world.add(leaf);
  }

  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 18, 12),
    new THREE.MeshBasicMaterial({ color: 0xffdda2 }),
  );
  bulb.position.set(1.2, 0.72, -0.58);
  world.add(bulb);
}

async function loadModel() {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);

  loader.load(
    MODEL_URL,
    (gltf) => {
      const object = gltf.scene;
      object.traverse((node) => {
        if (!node.isMesh) return;
        node.castShadow = true;
        node.receiveShadow = true;
        warmMaterial(node.material);
      });

      fitModel(object);
      modelAnchor.add(object);

      if (gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(object);
        gltf.animations.forEach((clip) => mixer.clipAction(clip).play());
      }

      showStatus("");
    },
    undefined,
    () => {
      showStatus("모델을 불러오지 못했습니다.", true);
    },
  );
}

function warmMaterial(material) {
  if (Array.isArray(material)) {
    material.forEach(warmMaterial);
    return;
  }

  if (!material) return;

  if (material.map) {
    material.map.colorSpace = THREE.SRGBColorSpace;
  }

  if (material.color) {
    material.color.offsetHSL(0.025, 0.08, 0.045);
  }

  if ("roughness" in material) {
    material.roughness = THREE.MathUtils.clamp(Math.max(material.roughness ?? 0.72, 0.68), 0, 1);
  }

  if ("metalness" in material) {
    material.metalness = Math.min(material.metalness ?? 0, 0.08);
  }

  if (material.emissive) {
    material.emissive.lerp(new THREE.Color(0x2b1608), 0.18);
    material.emissiveIntensity = Math.max(material.emissiveIntensity ?? 0, 0.035);
  }

  material.envMapIntensity = 0.42;
  material.needsUpdate = true;
}

function fitModel(object) {
  const initialBox = new THREE.Box3().setFromObject(object);
  const center = initialBox.getCenter(new THREE.Vector3());
  const size = initialBox.getSize(new THREE.Vector3());
  const longestSide = Math.max(size.x, size.y, size.z) || 1;
  const desiredSize = 2.68;

  object.position.sub(center);
  object.scale.setScalar(desiredSize / longestSide);

  const fittedBox = new THREE.Box3().setFromObject(object);
  object.position.y -= fittedBox.min.y - 0.02;
  object.rotation.y = -Math.PI / 2;
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const aspect = width / height;
  const viewHeight = aspect < 0.72 ? 4.55 : 4.05;
  const viewWidth = viewHeight * aspect;

  renderer.setSize(width, height, false);
  camera.left = -viewWidth / 2;
  camera.right = viewWidth / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.position.set(target.cameraX, target.cameraY, target.cameraZ);
  camera.lookAt(target.lookX, target.lookY, 0);
  camera.updateProjectionMatrix();
}

function render() {
  const delta = clock.getDelta();
  mixer?.update(delta);

  modelAnchor.rotation.x = THREE.MathUtils.lerp(modelAnchor.rotation.x, target.modelPitch, 0.09);
  modelAnchor.rotation.y = THREE.MathUtils.lerp(modelAnchor.rotation.y, target.modelYaw, 0.09);
  modelAnchor.rotation.z = THREE.MathUtils.lerp(modelAnchor.rotation.z, target.modelRoll, 0.09);
  backdrop.rotation.y = THREE.MathUtils.lerp(backdrop.rotation.y, target.backdropYaw, 0.065);

  camera.position.x = THREE.MathUtils.lerp(camera.position.x, target.cameraX, 0.08);
  camera.position.y = THREE.MathUtils.lerp(camera.position.y, target.cameraY, 0.08);
  camera.position.z = THREE.MathUtils.lerp(camera.position.z, target.cameraZ, 0.08);
  camera.lookAt(target.lookX, target.lookY, 0);

  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

async function enableMotion() {
  try {
    const canUseMotion = typeof DeviceOrientationEvent !== "undefined" || typeof DeviceMotionEvent !== "undefined";
    if (!canUseMotion) {
      showStatus("이 기기에서는 움직임 센서를 찾을 수 없습니다.", true);
      return;
    }

    const orientationPermission = await requestSensorPermission(DeviceOrientationEvent);
    const motionPermission = await requestSensorPermission(DeviceMotionEvent);
    if (orientationPermission === "denied" || motionPermission === "denied") {
      showStatus("움직임 권한이 필요합니다.", true);
      return;
    }

    startMotion({ userInitiated: true });
  } catch {
    showStatus("이 브라우저에서는 움직임을 켤 수 없습니다.", true);
  }
}

async function requestSensorPermission(sensorEvent) {
  if (typeof sensorEvent === "undefined" || typeof sensorEvent.requestPermission !== "function") {
    return "granted";
  }

  return sensorEvent.requestPermission();
}

function startPassiveMotion() {
  const needsTap = typeof DeviceOrientationEvent !== "undefined"
    && typeof DeviceOrientationEvent.requestPermission === "function";

  if (!needsTap && (typeof DeviceOrientationEvent !== "undefined" || typeof DeviceMotionEvent !== "undefined")) {
    startMotion({ userInitiated: false });
  }
}

function startMotion({ userInitiated }) {
  if (!state.motionEnabled) {
    window.addEventListener("deviceorientation", handleOrientation, { passive: true });
    window.addEventListener("deviceorientationabsolute", handleOrientation, { passive: true });
    window.addEventListener("devicemotion", handleDeviceMotion, { passive: true });
  }

  state.motionEnabled = true;
  motionButton.classList.add("is-active");

  if (userInitiated) {
    showStatus("움직임 켜짐", true);
  }

  window.clearTimeout(motion.probeTimer);
  motion.probeTimer = window.setTimeout(() => {
    if (state.motionEnabled && Date.now() - motion.lastReadingAt > 1400) {
      showStatus("센서 신호를 기다리는 중입니다.", true);
    }
  }, 1600);
}

function handleOrientation(event) {
  if (!state.motionEnabled || event.beta == null || event.gamma == null) return;

  if (motion.baseBeta == null || motion.baseGamma == null) {
    motion.baseBeta = event.beta;
    motion.baseGamma = event.gamma;
  }

  const deltaBeta = THREE.MathUtils.clamp(event.beta - motion.baseBeta, -24, 24);
  const deltaGamma = THREE.MathUtils.clamp(event.gamma - motion.baseGamma, -24, 24);
  applyParallax(deltaGamma / 24, deltaBeta / 24, true);
}

function handleDeviceMotion(event) {
  if (!state.motionEnabled || state.hasMotionReading) return;

  const gravity = event.accelerationIncludingGravity;
  if (!gravity || gravity.x == null || gravity.y == null) return;

  if (motion.baseGravityX == null || motion.baseGravityY == null) {
    motion.baseGravityX = gravity.x;
    motion.baseGravityY = gravity.y;
  }

  const deltaX = THREE.MathUtils.clamp(gravity.x - motion.baseGravityX, -5.8, 5.8);
  const deltaY = THREE.MathUtils.clamp(gravity.y - motion.baseGravityY, -5.8, 5.8);
  applyParallax(deltaX / 5.8, -deltaY / 5.8, true);
}

function applyParallax(x, y, fromSensor) {
  const normalizedX = THREE.MathUtils.clamp(x, -1, 1);
  const deadZoneY = fromSensor ? PARALLAX.sensorDeadZoneY : PARALLAX.pointerDeadZoneY;
  const yMin = fromSensor ? PARALLAX.sensorYMin : PARALLAX.pointerYMin;
  const yMax = fromSensor ? PARALLAX.sensorYMax : PARALLAX.pointerYMax;
  const normalizedY = THREE.MathUtils.clamp(applyDeadZone(y, deadZoneY), yMin, yMax);
  const verticalY = THREE.MathUtils.clamp(
    touch.tilt + (fromSensor ? 0 : normalizedY),
    TOUCH_CAMERA.minTilt,
    TOUCH_CAMERA.maxTilt,
  );

  if (fromSensor) {
    state.hasMotionReading = true;
    motion.lastReadingAt = Date.now();
  }

  target.modelYaw = normalizedX * 0.26;
  target.modelPitch = verticalY < 0 ? -verticalY * 0.105 : -verticalY * 0.07;
  target.modelRoll = -normalizedX * 0.035;
  target.backdropYaw = -normalizedX * 0.08;
  target.cameraX = CAMERA_HOME.x + normalizedX * 0.28;
  target.cameraY = CAMERA_HOME.y - verticalY * 0.32;
  target.lookX = CAMERA_HOME.lookX + normalizedX * 0.1;
  target.lookY = CAMERA_HOME.lookY + verticalY * 0.08;
}

function applyDeadZone(value, deadZone) {
  const clamped = THREE.MathUtils.clamp(value, -1, 1);
  const magnitude = Math.abs(clamped);
  if (magnitude <= deadZone) return 0;

  const normalized = (magnitude - deadZone) / (1 - deadZone);
  return Math.sign(clamped) * Math.pow(normalized, 1.35);
}

function handlePointerDown(event) {
  touch.active = true;
  touch.pointerId = event.pointerId;
  touch.startX = event.clientX;
  touch.startY = event.clientY;
  touch.startTilt = touch.tilt;
  canvas.setPointerCapture?.(event.pointerId);
  handlePointerMove(event);
}

function handlePointerMove(event) {
  if (touch.pointerId != null && event.pointerId !== touch.pointerId) return;

  const x = (event.clientX / window.innerWidth - 0.5) * 2;
  if (touch.active) {
    const deltaY = (event.clientY - touch.startY) / window.innerHeight;
    touch.tilt = THREE.MathUtils.clamp(
      touch.startTilt + deltaY * TOUCH_CAMERA.sensitivity,
      TOUCH_CAMERA.minTilt,
      TOUCH_CAMERA.maxTilt,
    );
  }

  applyParallax(x * 0.85, 0, false);
}

function handlePointerEnd(event) {
  if (touch.pointerId != null && event.pointerId !== touch.pointerId) return;
  touch.active = false;
  touch.pointerId = null;
  canvas.releasePointerCapture?.(event.pointerId);
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    } else {
      await document.exitFullscreen();
    }
  } catch {
    showStatus("홈 화면에 추가하면 전체화면으로 열 수 있습니다.", true);
  }
}

function resetView() {
  state.hasMotionReading = false;
  motion.baseBeta = null;
  motion.baseGamma = null;
  motion.baseGravityX = null;
  motion.baseGravityY = null;
  target.cameraX = CAMERA_HOME.x;
  target.cameraY = CAMERA_HOME.y;
  target.cameraZ = CAMERA_HOME.z;
  target.lookX = CAMERA_HOME.lookX;
  target.lookY = CAMERA_HOME.lookY;
  target.modelPitch = MODEL_HOME.pitch;
  target.modelYaw = MODEL_HOME.yaw;
  target.modelRoll = MODEL_HOME.roll;
  target.backdropYaw = 0;
  touch.tilt = 0;
  touch.startTilt = 0;
  showStatus("정면으로 재설정됨", true);
}

function updateFullscreenButton() {
  fullscreenButton.classList.toggle("is-active", Boolean(document.fullscreenElement));
}

function updateClock() {
  const now = new Date();
  timeEl.textContent = new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);

  dateEl.textContent = new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(now);
}

function showStatus(message, temporary = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("is-visible", Boolean(message));
  if (!message || !temporary) return;

  window.clearTimeout(showStatus.timeout);
  showStatus.timeout = window.setTimeout(() => {
    statusEl.textContent = "";
    statusEl.classList.remove("is-visible");
  }, 2400);
}
