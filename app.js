import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const MODEL_URL = new URL("./sample (1).glb", import.meta.url).href;

const canvas = document.querySelector("#scene");
const timeEl = document.querySelector("#time");
const dateEl = document.querySelector("#date");
const statusEl = document.querySelector("#status");
const motionButton = document.querySelector("#motionButton");
const fullscreenButton = document.querySelector("#fullscreenButton");
const resetButton = document.querySelector("#resetButton");

window.addEventListener("load", () => window.lucide?.createIcons());

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
const world = new THREE.Group();
const modelAnchor = new THREE.Group();
const clock = new THREE.Clock();
let mixer = null;

scene.add(world);
world.add(modelAnchor);

const target = {
  cameraX: 0,
  cameraY: 1.08,
  cameraZ: 6.7,
  rotationX: 0,
  rotationY: 0,
  rotationZ: 0,
};

const state = {
  motionEnabled: false,
  hasMotionReading: false,
  idle: true,
};

setupLights();
setupDiorama();
resize();
updateClock();
setInterval(updateClock, 30_000);

loadModel();
requestAnimationFrame(render);

window.addEventListener("resize", resize);
window.visualViewport?.addEventListener("resize", resize);
canvas.addEventListener("pointerdown", handlePointer, { passive: true });
canvas.addEventListener("pointermove", handlePointer, { passive: true });
motionButton.addEventListener("click", enableMotion);
fullscreenButton.addEventListener("click", toggleFullscreen);
resetButton.addEventListener("click", resetView);
document.addEventListener("fullscreenchange", updateFullscreenButton);

function setupLights() {
  scene.add(new THREE.HemisphereLight(0xb9c4ff, 0x070707, 1.4));

  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(-3.2, 5.4, 4.8);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -4;
  key.shadow.camera.right = 4;
  key.shadow.camera.top = 4;
  key.shadow.camera.bottom = -4;
  scene.add(key);

  const cyan = new THREE.PointLight(0x7ff5df, 6.8, 7);
  cyan.position.set(2.8, 1.6, 2.7);
  scene.add(cyan);

  const gold = new THREE.PointLight(0xffd27a, 4.8, 6);
  gold.position.set(-2.5, 0.7, 3.5);
  scene.add(gold);
}

function setupDiorama() {
  const baseMaterial = new THREE.MeshStandardMaterial({
    color: 0x070707,
    roughness: 0.72,
    metalness: 0.28,
  });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.62, 1.72, 0.2, 96), baseMaterial);
  base.position.y = -0.1;
  base.receiveShadow = true;
  world.add(base);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(1.64, 0.018, 12, 112),
    new THREE.MeshStandardMaterial({
      color: 0x7ff5df,
      emissive: 0x184f48,
      roughness: 0.45,
      metalness: 0.35,
    }),
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.012;
  world.add(rim);

  const backing = new THREE.Mesh(
    new THREE.PlaneGeometry(4.4, 4.2),
    new THREE.MeshStandardMaterial({
      color: 0x020202,
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
  );
  backing.position.set(0, 1.05, -1.25);
  backing.receiveShadow = true;
  world.add(backing);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(1.6, 96),
    new THREE.MeshStandardMaterial({
      color: 0x050505,
      roughness: 0.9,
      metalness: 0.08,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.012;
  floor.receiveShadow = true;
  world.add(floor);
}

async function loadModel() {
  const loader = new GLTFLoader();

  loader.load(
    MODEL_URL,
    (gltf) => {
      const object = gltf.scene;
      object.traverse((node) => {
        if (!node.isMesh) return;
        node.castShadow = true;
        node.receiveShadow = true;
        if (node.material?.map) {
          node.material.map.colorSpace = THREE.SRGBColorSpace;
        }
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

function fitModel(object) {
  const initialBox = new THREE.Box3().setFromObject(object);
  const center = initialBox.getCenter(new THREE.Vector3());
  const size = initialBox.getSize(new THREE.Vector3());
  const longestSide = Math.max(size.x, size.y, size.z) || 1;
  const desiredSize = 2.35;

  object.position.sub(center);
  object.scale.setScalar(desiredSize / longestSide);

  const fittedBox = new THREE.Box3().setFromObject(object);
  object.position.y -= fittedBox.min.y - 0.018;
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const aspect = width / height;
  const viewHeight = aspect < 0.72 ? 4.95 : 4.15;
  const viewWidth = viewHeight * aspect;

  renderer.setSize(width, height, false);
  camera.left = -viewWidth / 2;
  camera.right = viewWidth / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.position.set(target.cameraX, target.cameraY, target.cameraZ);
  camera.lookAt(0, 0.86, 0);
  camera.updateProjectionMatrix();
}

function render() {
  const delta = clock.getDelta();
  const elapsed = clock.elapsedTime;
  mixer?.update(delta);

  const idleY = state.motionEnabled && state.hasMotionReading ? 0 : Math.sin(elapsed * 0.34) * 0.12;
  const idleX = state.motionEnabled && state.hasMotionReading ? 0 : Math.sin(elapsed * 0.52) * 0.025;
  world.rotation.x = THREE.MathUtils.lerp(world.rotation.x, target.rotationX + idleX, 0.055);
  world.rotation.y = THREE.MathUtils.lerp(world.rotation.y, target.rotationY + idleY, 0.055);
  world.rotation.z = THREE.MathUtils.lerp(world.rotation.z, target.rotationZ, 0.055);

  camera.position.x = THREE.MathUtils.lerp(camera.position.x, target.cameraX, 0.065);
  camera.position.y = THREE.MathUtils.lerp(camera.position.y, target.cameraY, 0.065);
  camera.position.z = THREE.MathUtils.lerp(camera.position.z, target.cameraZ, 0.065);
  camera.lookAt(0, 0.86, 0);

  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

async function enableMotion() {
  try {
    const needsPermission = typeof DeviceOrientationEvent !== "undefined"
      && typeof DeviceOrientationEvent.requestPermission === "function";

    if (needsPermission) {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== "granted") {
        showStatus("움직임 권한이 필요합니다.", true);
        return;
      }
    }

    window.addEventListener("deviceorientation", handleOrientation, true);
    state.motionEnabled = true;
    motionButton.classList.add("is-active");
    showStatus("움직임 켜짐", true);
  } catch {
    showStatus("이 브라우저에서는 움직임을 켤 수 없습니다.", true);
  }
}

function handleOrientation(event) {
  const beta = THREE.MathUtils.clamp(event.beta ?? 0, -38, 38);
  const gamma = THREE.MathUtils.clamp(event.gamma ?? 0, -34, 34);
  const normalizedX = gamma / 34;
  const normalizedY = beta / 38;

  state.hasMotionReading = true;
  target.rotationY = normalizedX * 0.42;
  target.rotationX = normalizedY * 0.18;
  target.rotationZ = -normalizedX * 0.08;
  target.cameraX = normalizedX * 0.42;
  target.cameraY = 1.08 - normalizedY * 0.22;
}

function handlePointer(event) {
  if (state.motionEnabled && state.hasMotionReading) return;
  const x = (event.clientX / window.innerWidth - 0.5) * 2;
  const y = (event.clientY / window.innerHeight - 0.5) * 2;

  target.rotationY = x * 0.36;
  target.rotationX = y * 0.1;
  target.rotationZ = -x * 0.05;
  target.cameraX = x * 0.36;
  target.cameraY = 1.08 - y * 0.12;
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
  target.cameraX = 0;
  target.cameraY = 1.08;
  target.rotationX = 0;
  target.rotationY = 0;
  target.rotationZ = 0;
  showStatus("초기화됨", true);
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
  }, 2200);
}
