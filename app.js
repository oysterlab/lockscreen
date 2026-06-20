/**
 * Cat Depth Lock — 3D-photo (depth-mesh) renderer.
 *
 * Two depth-displaced meshes rendered with a perspective camera (the
 * "3D Photography using Layered Depth Inpainting" technique):
 *  - the FRONT mesh is the plate displaced per-vertex by its depth, so it has a
 *    real continuous 3D shape. Triangles that span a depth "cliff" (object
 *    silhouettes) are discarded instead of stretched.
 *  - the BACK mesh is a LaMa-inpainted plate (foreground + cliffs filled in) so
 *    the discarded holes reveal sharp, plausible background, not a smear.
 * Tilt/pointer orbits the camera, producing true parallax with no stretching,
 * no ghosting and no flat-sticker look. The clock is drawn live.
 */

import * as THREE from "three";

// ?scene=d2 loads assets/photo3d_d2/ (a different diorama); default is the main scene
const sceneParam = new URLSearchParams(location.search).get("scene");
const P3D = sceneParam ? `./assets/photo3d_${sceneParam}/` : "./assets/photo3d/";
const ASSETS = {
  fgColor: P3D + "fg_color.png",
  fgDepth: P3D + "fg_depth.png",
  protect: P3D + "protect.png",
  bgColor: P3D + "bg_color.png",
  bgDepth: P3D + "bg_depth.png",
};

let IMG_ASPECT = 864 / 1536; // updated from the loaded plate so any aspect cover-fits

const VIEW = {
  camZ: 6,
  fov: 36,
  depthScale: 1.45, // foreground relief amount (strong 3D pop on the near subject)
  farScale: 0.42, // far band moves this fraction as much (keeps distant thin edges calm)
  focus: 0.34, // still plane: lower than v1 (0.42) for a bit more midground depth,
  //              but kept high enough that the foreground tree edge doesn't smear.
  //              (Going to ~0.24 spreads background depth more but smears the tree —
  //              that needs real multi-view data, not a single-photo depth guess.)
  orbit: 0.38, // camera xy travel at full tilt (a bit more travel for stronger motion)
  cutLow: 0.04, // cut threshold for the scene (cut tree/sky edges -> no smear)
  cutHigh: 0.14, // cut threshold inside the protected cat region (don't cut -> no stipple)
  overscan: 0.08, // texture zoom so cliffs/edges never expose the frame border
  pad: 1.15, // plane oversize beyond the view, for camera-orbit headroom
  springFreq: 8.5, // critically-damped spring frequency — natural inertia / weight
  idleAmp: 0.26,
  idleSpeed: 0.0002,
};

// smaller ranges => a small phone tilt reaches full parallax (much more responsive)
const SENSOR = { betaRange: 13, gammaRange: 13, gravityRange: 3.2, deadZone: 0.025 };

const canvas = document.querySelector("#scene");
const timeEl = document.querySelector("#time");
const dateEl = document.querySelector("#date");
const statusEl = document.querySelector("#status");
const motionButton = document.querySelector("#motionButton");
const fullscreenButton = document.querySelector("#fullscreenButton");
const resetButton = document.querySelector("#resetButton");

window.addEventListener("load", () => window.lucide?.createIcons());

const target = { x: 0, y: 0 };
const current = { x: 0, y: 0 };
const vel = { x: 0, y: 0 };
let lastFrame = typeof performance !== "undefined" ? performance.now() : 0;
let lastInputAt = 0;
const state = {
  motionEnabled: false,
  hasSensorReading: false,
  pointerActive: false,
  ready: false,
  startTime: typeof performance !== "undefined" ? performance.now() : 0,
};
const sensor = { baseBeta: null, baseGamma: null, baseGX: null, baseGY: null };

const params = new URLSearchParams(location.search);
const debug = { freeze: params.has("ox") || params.has("oy") };
if (debug.freeze) {
  target.x = clamp(parseFloat(params.get("ox") || "0"), -1, 1);
  target.y = clamp(parseFloat(params.get("oy") || "0"), -1, 1);
}
// URL-tunable knobs for QA sweeps: ?ct=&cth=&ds=&ob=&fc=focus&fs=farScale
const tune = {
  cutLow: params.has("ct") ? parseFloat(params.get("ct")) : VIEW.cutLow,
  cutHigh: params.has("cth") ? parseFloat(params.get("cth")) : VIEW.cutHigh,
  depthScale: params.has("ds") ? parseFloat(params.get("ds")) : VIEW.depthScale,
  orbit: params.has("ob") ? parseFloat(params.get("ob")) : VIEW.orbit,
  focus: params.has("fc") ? parseFloat(params.get("fc")) : VIEW.focus,
  farScale: params.has("fs") ? parseFloat(params.get("fs")) : VIEW.farScale,
};

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // ShaderMaterial passthrough
renderer.setClearColor(0x2a1a0e, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(VIEW.fov, 1, 0.1, 100);
camera.position.set(0, 0, VIEW.camZ);

const VERT = `
  uniform sampler2D uDepth;
  uniform float uDepthScale;
  uniform float uFarScale;
  uniform float uFocus;
  uniform float uZBias;
  uniform vec2 uCover;
  varying vec2 vUv;
  void main() {
    vec2 tuv = (uv - 0.5) * uCover + 0.5;
    vUv = tuv;
    float d = texture2D(uDepth, tuv).r;
    vec3 p = position;
    // asymmetric relief: push the foreground hard (3D pop) but compress the far
    // band so distant thin edges (wires, twigs) barely move and stay artifact-free.
    float rel = d - uFocus;
    float s = rel < 0.0 ? uFarScale : 1.0;
    p.z += rel * uDepthScale * s + uZBias;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;

const FRAG_FRONT = `
  uniform sampler2D uColor;
  uniform sampler2D uDepth;
  uniform sampler2D uProtect;
  uniform vec2 uTexel;
  uniform float uCutLow;
  uniform float uCutHigh;
  varying vec2 vUv;
  void main() {
    // pixel-precise cliff cut on a steep depth wall (a stretched seam between
    // foreground and background). Feathered: the wall fades out over the gradient
    // so any residual fringe blends softly into the inpainted back layer.
    float l = texture2D(uDepth, vUv - vec2(uTexel.x, 0.0)).r;
    float r = texture2D(uDepth, vUv + vec2(uTexel.x, 0.0)).r;
    float u = texture2D(uDepth, vUv - vec2(0.0, uTexel.y)).r;
    float d = texture2D(uDepth, vUv + vec2(0.0, uTexel.y)).r;
    float grad = max(abs(r - l), abs(d - u));
    // spatially-varying threshold: high inside the cat (its moderate edges are NOT
    // cut, so no stippled noise line) and low elsewhere (tree/sky edges ARE cut).
    float cut = mix(uCutLow, uCutHigh, texture2D(uProtect, vUv).r);
    float a = 1.0 - smoothstep(cut * 0.82, cut * 1.08, grad);
    if (a < 0.004) discard;
    gl_FragColor = vec4(texture2D(uColor, vUv).rgb, a);
  }`;

const FRAG_BACK = `
  uniform sampler2D uColor;
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D(uColor, vUv);
  }`;

const cover = new THREE.Vector2(1, 1);
let frontMat, backMat, frontMesh, backMesh, geometry;

const loader = new THREE.TextureLoader();

Promise.all(Object.values(ASSETS).map(loadTexture))
  .then(([fgColor, fgDepth, protect, bgColor, bgDepth]) => {
    // textures are passed through unchanged (ShaderMaterial does no colour-space
    // conversion), so keep them raw — decoding to linear without re-encoding darkens.
    const tw = fgDepth.image?.width || 864;
    const th = fgDepth.image?.height || 1536;
    const texel = new THREE.Vector2(1.6 / tw, 1.6 / th);
    if (fgColor.image?.width) IMG_ASPECT = fgColor.image.width / fgColor.image.height;

    backMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: bgColor },
        uDepth: { value: bgDepth },
        uDepthScale: { value: tune.depthScale },
        uFarScale: { value: tune.farScale },
        uFocus: { value: tune.focus },
        uZBias: { value: -0.04 },
        uCover: { value: cover },
      },
      vertexShader: VERT,
      fragmentShader: FRAG_BACK,
    });
    frontMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: fgColor },
        uDepth: { value: fgDepth },
        uTexel: { value: texel },
        uProtect: { value: protect },
        uCutLow: { value: tune.cutLow },
        uCutHigh: { value: tune.cutHigh },
        uDepthScale: { value: tune.depthScale },
        uFarScale: { value: tune.farScale },
        uFocus: { value: tune.focus },
        uZBias: { value: 0.0 },
        uCover: { value: cover },
      },
      vertexShader: VERT,
      fragmentShader: FRAG_FRONT,
      transparent: true,
      depthWrite: false,
    });

    backMesh = new THREE.Mesh(new THREE.BufferGeometry(), backMat);
    frontMesh = new THREE.Mesh(new THREE.BufferGeometry(), frontMat);
    backMesh.renderOrder = 0;
    frontMesh.renderOrder = 1;
    scene.add(backMesh, frontMesh);

    resize();
    state.ready = true;
    startPassiveMotion();
    renderer.setAnimationLoop(loop);
  })
  .catch(() => showStatus("3D 레이어를 불러오지 못했습니다.", false));

updateClock();
setInterval(updateClock, 15_000);

window.addEventListener("resize", resize);
window.visualViewport?.addEventListener("resize", resize);
window.addEventListener("pointermove", handlePointerMove, { passive: true });
window.addEventListener("pointerdown", handlePointerDown, { passive: true });
window.addEventListener("pointerup", handlePointerUp, { passive: true });
window.addEventListener("pointercancel", handlePointerUp, { passive: true });
motionButton.addEventListener("click", enableMotion);
fullscreenButton.addEventListener("click", toggleFullscreen);
resetButton.addEventListener("click", resetView);
document.addEventListener("fullscreenchange", () =>
  fullscreenButton.classList.toggle("is-active", Boolean(document.fullscreenElement)),
);

function loop() {
  if (!state.ready) return;
  const now = performance.now();
  const dt = Math.min((now - lastFrame) / 1000, 0.05); // clamp for stability
  lastFrame = now;

  // desktop polish: when the pointer leaves / goes idle, ease back to centre
  // (gyro keeps its held tilt — that is the user's intent)
  if (!state.hasSensorReading && !state.pointerActive && now - lastInputAt > 500) {
    target.x *= 0.9;
    target.y *= 0.9;
  }

  if (debug.freeze) {
    current.x = target.x;
    current.y = target.y;
    vel.x = vel.y = 0;
  } else {
    // critically-damped spring: gives weight/inertia instead of a flat lerp
    const w = VIEW.springFreq;
    const ax = (target.x - current.x) * w * w - vel.x * 2 * w;
    const ay = (target.y - current.y) * w * w - vel.y * 2 * w;
    vel.x += ax * dt;
    vel.y += ay * dt;
    current.x += vel.x * dt;
    current.y += vel.y * dt;
  }

  let ox = current.x;
  let oy = current.y;
  if (!debug.freeze && !state.pointerActive && !state.hasSensorReading) {
    const t = (now - state.startTime) * VIEW.idleSpeed;
    ox += Math.sin(t) * VIEW.idleAmp;
    oy += Math.cos(t * 0.8) * VIEW.idleAmp * 0.5;
  }

  camera.position.x = ox * tune.orbit;
  camera.position.y = oy * tune.orbit;
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);
}

/* ---------- geometry / sizing ---------- */

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  // plane that fills the camera view at z=0 (+ overscan), so the texture covers
  const halfH = VIEW.camZ * Math.tan((VIEW.fov * Math.PI) / 360);
  const halfW = halfH * camera.aspect;
  const planeW = halfW * 2 * VIEW.pad;
  const planeH = halfH * 2 * VIEW.pad;

  // cover-fit the image into the view, then scale by pad so the view shows the
  // full cover image and the padded margin maps to image beyond it (orbit room).
  const screenAspect = w / h;
  if (screenAspect < IMG_ASPECT) {
    cover.set(screenAspect / IMG_ASPECT, 1);
  } else {
    cover.set(1, IMG_ASPECT / screenAspect);
  }
  cover.multiplyScalar((1 - VIEW.overscan) * VIEW.pad);

  const segX = Math.max(140, Math.round(planeW * 150));
  const segY = Math.max(140, Math.round(planeH * 150));
  const next = new THREE.PlaneGeometry(planeW, planeH, segX, segY);
  geometry?.dispose();
  geometry = next;
  if (frontMesh) frontMesh.geometry = geometry;
  if (backMesh) backMesh.geometry = geometry;
}

/* ---------- input ---------- */

function setTargetFromNormalized(nx, ny) {
  target.x = clamp(nx, -1, 1);
  target.y = clamp(ny, -1, 1);
}

function handlePointerDown(event) {
  if (debug.freeze || event.target.closest(".controls")) return;
  state.pointerActive = true;
  handlePointerMove(event);
}

function handlePointerMove(event) {
  if (debug.freeze || state.hasSensorReading) return;
  const nx = (event.clientX / window.innerWidth - 0.5) * 2;
  const ny = (event.clientY / window.innerHeight - 0.5) * 2;
  setTargetFromNormalized(nx, -ny);
  lastInputAt = performance.now();
}

function handlePointerUp() {
  state.pointerActive = false;
}

async function enableMotion() {
  try {
    const hasMotion =
      typeof DeviceOrientationEvent !== "undefined" || typeof DeviceMotionEvent !== "undefined";
    if (!hasMotion) {
      showStatus("이 기기에서는 움직임 센서를 찾을 수 없습니다.", true);
      return;
    }
    const o = await requestSensorPermission(DeviceOrientationEvent);
    const m = await requestSensorPermission(DeviceMotionEvent);
    if (o === "denied" || m === "denied") {
      showStatus("움직임 권한이 필요합니다.", true);
      return;
    }
    startMotion(true);
  } catch {
    showStatus("이 브라우저에서는 움직임을 켤 수 없습니다.", true);
  }
}

function requestSensorPermission(sensorEvent) {
  if (typeof sensorEvent === "undefined" || typeof sensorEvent.requestPermission !== "function") {
    return Promise.resolve("granted");
  }
  return sensorEvent.requestPermission();
}

function startPassiveMotion() {
  const needsTap =
    typeof DeviceOrientationEvent !== "undefined" &&
    typeof DeviceOrientationEvent.requestPermission === "function";
  if (
    !needsTap &&
    (typeof DeviceOrientationEvent !== "undefined" || typeof DeviceMotionEvent !== "undefined")
  ) {
    startMotion(false);
  }
}

function startMotion(userInitiated) {
  if (!state.motionEnabled) {
    window.addEventListener("deviceorientation", handleOrientation, { passive: true });
    window.addEventListener("deviceorientationabsolute", handleOrientation, { passive: true });
    window.addEventListener("devicemotion", handleDeviceMotion, { passive: true });
  }
  state.motionEnabled = true;
  motionButton.classList.add("is-active");
  if (userInitiated) showStatus("움직임 켜짐", true);
}

function handleOrientation(event) {
  if (debug.freeze || !state.motionEnabled || event.beta == null || event.gamma == null) return;
  if (sensor.baseBeta == null) {
    sensor.baseBeta = event.beta;
    sensor.baseGamma = event.gamma;
  }
  const dBeta = clamp(event.beta - sensor.baseBeta, -SENSOR.betaRange, SENSOR.betaRange);
  const dGamma = clamp(event.gamma - sensor.baseGamma, -SENSOR.gammaRange, SENSOR.gammaRange);
  state.hasSensorReading = true;
  setTargetFromNormalized(deadZone(dGamma / SENSOR.gammaRange), deadZone(-dBeta / SENSOR.betaRange));
}

function handleDeviceMotion(event) {
  if (debug.freeze || !state.motionEnabled || state.hasSensorReading) return;
  const g = event.accelerationIncludingGravity;
  if (!g || g.x == null || g.y == null) return;
  if (sensor.baseGX == null) {
    sensor.baseGX = g.x;
    sensor.baseGY = g.y;
  }
  const dx = clamp(g.x - sensor.baseGX, -SENSOR.gravityRange, SENSOR.gravityRange);
  const dy = clamp(g.y - sensor.baseGY, -SENSOR.gravityRange, SENSOR.gravityRange);
  state.hasSensorReading = true;
  setTargetFromNormalized(deadZone(dx / SENSOR.gravityRange), deadZone(dy / SENSOR.gravityRange));
}

/* ---------- chrome ---------- */

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
  state.hasSensorReading = false;
  state.pointerActive = false;
  sensor.baseBeta = sensor.baseGamma = sensor.baseGX = sensor.baseGY = null;
  target.x = target.y = 0;
  showStatus("정면으로 재설정됨", true);
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

/* ---------- helpers ---------- */

function loadTexture(url) {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (t) => {
        t.minFilter = THREE.LinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.generateMipmaps = false;
        t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
        resolve(t);
      },
      undefined,
      reject,
    );
  });
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function deadZone(v) {
  const m = Math.abs(v);
  if (m <= SENSOR.deadZone) return 0;
  const n = (m - SENSOR.deadZone) / (1 - SENSOR.deadZone);
  return Math.sign(v) * n;
}
