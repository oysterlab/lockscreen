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
const params = new URLSearchParams(location.search);
const sceneParam = params.get("scene");
const wallpaperMode = params.has("wallpaper");
if (wallpaperMode) document.documentElement.classList.add("wallpaper-mode");
const P3D = sceneParam ? `./assets/photo3d_${sceneParam}/` : "./assets/photo3d/";
// asset cache-buster: bump on any rebuilt PNG so phones don't serve a stale image
// (index.html's ?v= only refreshes the code, not these depth/colour PNGs).
const AV = location.protocol === "file:" ? "" : "?a=dio5";
// scenes that carry an idle-flick animation (assets/photo3d_<scene>/anim/manifest.json):
// the foreground plate is swapped through a short clip every ~10s, then held.
const ANIM_SCENES = new Set(["cherry2dio"]);
// core layers always present; protect.png (v2) / subject.png (v3 soft-LDI) are
// loaded optionally and decide which front-layer path runs (see below).
const ASSETS = {
  fgColor: P3D + "fg_color.png" + AV,
  fgDepth: P3D + "fg_depth.png" + AV,
  bgColor: P3D + "bg_color.png" + AV,
  bgDepth: P3D + "bg_depth.png" + AV,
};

let IMG_ASPECT = 864 / 1536; // updated from the loaded plate so any aspect cover-fits

// Depth tuning baseline before the extra-depth pass (mesh-59, 2026-06-22):
// default: depthScale 1.72, farScale 0.58, focus 0.29, orbit 0.58, orbitYScale 0.75
// cherry2dio / latte2dio / nila2dio: depthScale 1.72, farScale 0.68, focus 0.28
const VIEW = {
  camZ: 6,
  fov: 36,
  depthScale: 1.84, // stronger foreground relief without the "inflated sticker" look
  farScale: 0.64, // opens mid/far parallax so the room reads deeper
  focus: 0.27, // lower still plane = more depth separation across the whole scene
  orbit: 0.68, // slightly more horizontal camera travel at full tilt
  orbitYScale: 0.70, // keep vertical travel tighter than horizontal; full vertical
  //                   parallax can push a bottom/top-anchored subject off-screen
  cutLow: 0.04, // cut threshold for the scene (cut tree/sky edges -> no smear)
  cutHigh: 0.14, // cut threshold inside the protected cat region (don't cut -> no stipple)
  overscan: 0.12, // texture zoom so stronger orbit never exposes the frame border
  pad: 1.26, // plane oversize beyond the view, for camera-orbit headroom
  springFreq: 9.2, // slightly snappier so motion is easier to perceive
  idleAmp: 0.34,
  idleSpeed: 0.0002,
};

// per-scene depth overrides. lab1 (v3 soft-LDI) can take a DEEPER perspective than
// the v2 default: its soft-matte + piecewise-flat layering keeps the far thin
// structures (wires, tree, tower) clean even with the far band decompressed, so we
// open up the distance (farScale up), push more midground depth (focus down) and a
// stronger near pop (depthScale up) for a richer, more separated perspective.
const SCENE_OVERRIDES = {
  lab1: { depthScale: 1.82, farScale: 0.82, focus: 0.23 },
  lab3: { depthScale: 1.55, farScale: 0.58, focus: 0.28 },
  cherry2: { depthScale: 1.72, farScale: 0.68, focus: 0.28 },
  latte2dio: { depthScale: 1.84, farScale: 0.74, focus: 0.26 },
  nila2dio: { depthScale: 1.84, farScale: 0.74, focus: 0.26 },
  cherry2dio: { depthScale: 1.84, farScale: 0.74, focus: 0.26 },
  latteval: { depthScale: 1.72, farScale: 0.68, focus: 0.28 },
};
Object.assign(VIEW, SCENE_OVERRIDES[sceneParam] || {});

// Cherry's ear tips are too thin for the full depth mesh: vertices just outside
// the matte can still be pulled by background depth, making the tip look pinned.
// Render that subject with a masked cat-only depth field instead: inside the
// matte keeps the image depth, outside/soft edges are filled with cat-average depth.
const SUBJECT_DEPTH_SCENES = new Set(["cherry2dio"]);
const SUBJECT_BASE_DEPTH = params.has("sbd") ? parseFloat(params.get("sbd")) : 0.43;
const SUBJECT_DEPTH_CONTRAST = params.has("sdc") ? parseFloat(params.get("sdc")) : 1.12;

// smaller ranges => a small phone tilt reaches full parallax (very responsive)
const SENSOR = { betaRange: 6.5, gammaRange: 6.5, gravityRange: 1.8, deadZone: 0.015 };
const TOUCH_SENS = 3.4; // drag distance (fraction of screen) -> parallax offset

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
const drag = {
  touch: false,
  pointerId: null,
  startX: 0,
  startY: 0,
  baseX: 0,
  baseY: 0,
  captureTarget: null,
};
let lastFrame = typeof performance !== "undefined" ? performance.now() : 0;
let lastRenderAt = 0;
let lastInputAt = 0;
const state = {
  motionEnabled: false,
  hasSensorReading: false,
  pointerActive: false,
  ready: false,
  startTime: typeof performance !== "undefined" ? performance.now() : 0,
};
const sensor = {
  baseBeta: null,
  baseGamma: null,
  baseGX: null,
  baseGY: null,
  lastOrientationAt: 0,
};

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

const maxDpr = params.has("dpr")
  ? parseFloat(params.get("dpr"))
  : (wallpaperMode ? 1.5 : 2);
const renderFps = params.has("fps")
  ? parseFloat(params.get("fps"))
  : (wallpaperMode ? 30 : 60);
const minRenderMs = renderFps >= 59 ? 0 : Math.max(0, 1000 / Math.max(1, renderFps) - 0.5);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
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
  uniform sampler2D uReliefMask;
  uniform float uReliefMaskStrength;
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
    float mask = smoothstep(0.04, 0.48, texture2D(uReliefMask, tuv).r);
    float edgeFollow = max(mask, 0.42);
    float maskedRelief = mix(1.0, edgeFollow, uReliefMaskStrength);
    p.z += rel * maskedRelief * uDepthScale * s + uZBias;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;

const VERT_SUBJECT_DEPTH = `
  uniform sampler2D uDepth;
  uniform sampler2D uSubject;
  uniform float uDepthScale;
  uniform float uFarScale;
  uniform float uFocus;
  uniform float uZBias;
  uniform float uSubjectBaseDepth;
  uniform float uSubjectDepthContrast;
  uniform vec2 uCover;
  varying vec2 vUv;
  void main() {
    vec2 tuv = (uv - 0.5) * uCover + 0.5;
    vUv = tuv;
    float rawDepth = texture2D(uDepth, tuv).r;
    float matte = texture2D(uSubject, tuv).r;
    float core = smoothstep(0.18, 0.62, matte);
    float d = mix(uSubjectBaseDepth, rawDepth, core);
    d = clamp(uSubjectBaseDepth + (d - uSubjectBaseDepth) * uSubjectDepthContrast, 0.0, 1.0);
    vec3 p = position;
    float rel = d - uFocus;
    float s = rel < 0.0 ? uFarScale : 1.0;
    p.z += rel * uDepthScale * s + uZBias;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;

const FRAG_FRONT = `
  uniform sampler2D uColor;
  uniform sampler2D uDepth;
  uniform sampler2D uSubject;
  uniform sampler2D uProtect;
  uniform vec2 uTexel;
  uniform float uCutLow;
  uniform float uCutHigh;
  uniform float uUseSubject;
  varying vec2 vUv;
  void main() {
    // pixel-precise cliff cut on a steep depth wall (an object silhouette). The
    // wall is discarded so it reveals the filled back layer instead of stretching;
    // feathered so any residual fringe blends softly into the back.
    float l = texture2D(uDepth, vUv - vec2(uTexel.x, 0.0)).r;
    float r = texture2D(uDepth, vUv + vec2(uTexel.x, 0.0)).r;
    float u = texture2D(uDepth, vUv - vec2(0.0, uTexel.y)).r;
    float d = texture2D(uDepth, vUv + vec2(0.0, uTexel.y)).r;
    float grad = max(abs(r - l), abs(d - u));
    float a;
    if (uUseSubject > 0.5) {
      // v3 soft-LDI: cut every silhouette uniformly, then remove the subject (it is
      // drawn by its own soft-matte layer on top) -> no stretch/stipple at the edge.
      float subjectA = texture2D(uSubject, vUv).r;
      float subjectCut = smoothstep(0.02, 0.22, subjectA);
      a = 1.0 - smoothstep(uCutLow * 0.82, uCutLow * 1.08, grad);
      a *= 1.0 - subjectCut;
    } else {
      // v2: spatially-varying threshold, high inside the protected cat region.
      float cut = mix(uCutLow, uCutHigh, texture2D(uProtect, vUv).r);
      a = 1.0 - smoothstep(cut * 0.82, cut * 1.08, grad);
    }
    if (a < 0.004) discard;
    gl_FragColor = vec4(texture2D(uColor, vUv).rgb, a);
  }`;

// the subject: a soft alpha matte over the filled back layer. Its relief is
// masked by the subject matte so thin edges are not pulled by the far background
// depth sitting just outside the silhouette.
const FRAG_SUBJECT = `
  uniform sampler2D uColor;
  uniform sampler2D uSubject;
  varying vec2 vUv;
  void main() {
    float a = texture2D(uSubject, vUv).r;
    if (a < 0.004) discard;
    gl_FragColor = vec4(texture2D(uColor, vUv).rgb, a);
  }`;

const FRAG_BACK = `
  uniform sampler2D uColor;
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D(uColor, vUv);
  }`;

// lab3: an explicit pre-cut RGBA layer (foreground/cat). Uses the texture's OWN
// alpha (no depth-gradient cut) so the layer composites exactly as authored.
const FRAG_LAYER = `
  uniform sampler2D uColor;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(uColor, vUv);
    if (c.a < 0.01) discard;
    gl_FragColor = c;
  }`;

const cover = new THREE.Vector2(1, 1);
let frontMat, backMat, subjectMat, frontMesh, backMesh, subjectMesh, geometry;

const loader = new THREE.TextureLoader();
const BLANK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
BLANK.needsUpdate = true;
const loadOpt = (url) => loadTexture(url).catch(() => null); // 404 -> null

// lab3: explicit hand-authored layers (background / foreground / cat), each its own
// RGBA texture. Background = flat skyline backdrop; foreground + cat are displaced by
// the depth map and composited by their own alpha.
function initLab3() {
  Promise.all([
    loadTexture(P3D + "bg_color.png" + AV),
    loadTexture(P3D + "fg_layer.png" + AV),
    loadTexture(P3D + "cat_layer.png" + AV),
    loadTexture(P3D + "fg_depth.png" + AV),
  ])
    .then(([bgTex, fgTex, catTex, depthTex]) => {
      if (fgTex.image?.width) IMG_ASPECT = fgTex.image.width / fgTex.image.height;
      const relief = (zb) => ({
        uDepth: { value: depthTex },
        uDepthScale: { value: tune.depthScale },
        uFarScale: { value: tune.farScale },
        uFocus: { value: tune.focus },
        uZBias: { value: zb },
        uReliefMask: { value: BLANK },
        uReliefMaskStrength: { value: 0.0 },
        uCover: { value: cover },
      });
      backMat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: bgTex },
          uDepth: { value: depthTex },
          uDepthScale: { value: 0.0 }, // flat backdrop
          uFarScale: { value: 1.0 },
          uFocus: { value: 0.0 },
          uZBias: { value: -0.7 }, // close behind so the gap stays small
          uReliefMask: { value: BLANK },
          uReliefMaskStrength: { value: 0.0 },
          uCover: { value: cover },
        },
        vertexShader: VERT,
        fragmentShader: FRAG_BACK,
      });
      frontMat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: fgTex }, ...relief(0.0) },
        vertexShader: VERT,
        fragmentShader: FRAG_LAYER,
        transparent: true,
        depthWrite: false,
      });
      subjectMat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: catTex }, ...relief(0.02) },
        vertexShader: VERT,
        fragmentShader: FRAG_LAYER,
        transparent: true,
        depthWrite: false,
      });
      backMesh = new THREE.Mesh(new THREE.BufferGeometry(), backMat);
      frontMesh = new THREE.Mesh(new THREE.BufferGeometry(), frontMat);
      subjectMesh = new THREE.Mesh(new THREE.BufferGeometry(), subjectMat);
      backMesh.renderOrder = 0;
      frontMesh.renderOrder = 1;
      subjectMesh.renderOrder = 2;
      scene.add(backMesh, frontMesh, subjectMesh);
      resize();
      state.ready = true;
      startPassiveMotion();
      renderer.setAnimationLoop(loop);
    })
    .catch(() => showStatus("3D 레이어를 불러오지 못했습니다.", false));
}

if (sceneParam === "lab3") initLab3();
else
Promise.all(Object.values(ASSETS).map(loadTexture))
  .then(async ([fgColor, fgDepth, bgColor, bgDepth]) => {
    // textures are passed through unchanged (ShaderMaterial does no colour-space
    // conversion), so keep them raw — decoding to linear without re-encoding darkens.
    const tw = fgDepth.image?.width || 864;
    const th = fgDepth.image?.height || 1536;
    const texel = new THREE.Vector2(1.6 / tw, 1.6 / th);
    if (fgColor.image?.width) IMG_ASPECT = fgColor.image.width / fgColor.image.height;

    // protect.png (v2) vs subject.png (v3 soft-LDI). If subject is present we run
    // the 3-layer path: a dedicated soft-matte subject layer on top.
    const [protect, subject] = await Promise.all([
      loadOpt(P3D + "protect.png" + AV),
      loadOpt(P3D + "subject.png" + AV),
    ]);
    const useSubject = subject !== null;

    const reliefUniforms = (reliefMask = BLANK, reliefMaskStrength = 0.0) => ({
      uDepth: { value: fgDepth },
      uDepthScale: { value: tune.depthScale },
      uFarScale: { value: tune.farScale },
      uFocus: { value: tune.focus },
      uReliefMask: { value: reliefMask },
      uReliefMaskStrength: { value: reliefMaskStrength },
      uCover: { value: cover },
    });

    backMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: bgColor },
        uDepth: { value: bgDepth },
        uDepthScale: { value: tune.depthScale },
        uFarScale: { value: tune.farScale },
        uFocus: { value: tune.focus },
        uZBias: { value: -0.04 },
        uReliefMask: { value: BLANK },
        uReliefMaskStrength: { value: 0.0 },
        uCover: { value: cover },
      },
      vertexShader: VERT,
      fragmentShader: FRAG_BACK,
    });
    frontMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: fgColor },
        uSubject: { value: subject || BLANK },
        uProtect: { value: protect || BLANK },
        uTexel: { value: texel },
        uCutLow: { value: tune.cutLow },
        uCutHigh: { value: tune.cutHigh },
        uUseSubject: { value: useSubject ? 1 : 0 },
        uZBias: { value: 0.0 },
        ...reliefUniforms(),
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

    if (useSubject) {
      const useSubjectDepth = SUBJECT_DEPTH_SCENES.has(sceneParam);
      subjectMat = new THREE.ShaderMaterial({
        uniforms: useSubjectDepth
          ? {
              uColor: { value: fgColor },
              uSubject: { value: subject },
              uDepth: { value: fgDepth },
              uDepthScale: { value: tune.depthScale },
              uFarScale: { value: tune.farScale },
              uFocus: { value: tune.focus },
              uZBias: { value: 0.0 },
              uSubjectBaseDepth: { value: SUBJECT_BASE_DEPTH },
              uSubjectDepthContrast: { value: SUBJECT_DEPTH_CONTRAST },
              uCover: { value: cover },
            }
          : {
              uColor: { value: fgColor },
              uSubject: { value: subject },
              uZBias: { value: 0.0 },
              ...reliefUniforms(subject, 0.85),
            },
        vertexShader: useSubjectDepth ? VERT_SUBJECT_DEPTH : VERT,
        fragmentShader: FRAG_SUBJECT,
        transparent: true,
        depthWrite: false,
      });
      subjectMesh = new THREE.Mesh(new THREE.BufferGeometry(), subjectMat);
      subjectMesh.renderOrder = 2;
      scene.add(subjectMesh);
    }

    resize();
    state.ready = true;
    startPassiveMotion();
    renderer.setAnimationLoop(loop);
    if (ANIM_SCENES.has(sceneParam)) initAnim();
  })
  .catch(() => showStatus("3D 레이어를 불러오지 못했습니다.", false));

updateClock();
setInterval(updateClock, 15_000);

window.addEventListener("resize", resize);
window.visualViewport?.addEventListener("resize", resize);
if (!wallpaperMode) {
  window.addEventListener("pointermove", handlePointerMove, { passive: false });
  window.addEventListener("pointerdown", handlePointerDown, { passive: false });
  window.addEventListener("pointerup", handlePointerUp, { passive: false });
  window.addEventListener("pointercancel", handlePointerUp, { passive: false });
  window.addEventListener("touchstart", handleTouchStart, { passive: false });
  window.addEventListener("touchmove", handleTouchMove, { passive: false });
  window.addEventListener("touchend", handleTouchEnd, { passive: false });
  window.addEventListener("touchcancel", handleTouchEnd, { passive: false });
  motionButton.addEventListener("click", enableMotion);
  fullscreenButton.addEventListener("click", toggleFullscreen);
  resetButton.addEventListener("click", resetView);
  document.addEventListener("fullscreenchange", () =>
    fullscreenButton.classList.toggle("is-active", Boolean(document.fullscreenElement)),
  );
}

function loop() {
  if (!state.ready) return;
  const now = performance.now();
  if (!debug.freeze && now - lastRenderAt < minRenderMs) return;
  const dt = Math.min((now - lastFrame) / 1000, 0.05); // clamp for stability
  lastRenderAt = now;
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
  camera.position.y = oy * tune.orbit * VIEW.orbitYScale;
  camera.lookAt(0, 0, 0);
  tickAnim(now, dt);
  renderer.render(scene, camera);
}

/* ---------- idle-flick animation ---------- */
// Holds the foreground plate on a rest frame, then every ~10s (jittered) plays a
// short clip once — a living "twitch" — by swapping the front + subject layer
// colour through the deduped frame textures, then returns to the hold frame.
const anim = {
  enabled: false,
  textures: [],
  timeline: [],
  fps: 8,
  hold: 0,
  playing: false,
  slot: 0,
  slotTime: 0,
  nextPlayAt: 0,
};
let ANIM_BASE = 10000; // ms between plays
let ANIM_JITTER = 4000; // ± randomness so it never feels mechanical

function setAnimFrame(uniqueIdx) {
  const tex = anim.textures[uniqueIdx];
  if (!tex) return;
  if (frontMat) frontMat.uniforms.uColor.value = tex;
  if (subjectMat) subjectMat.uniforms.uColor.value = tex;
}

function scheduleNextPlay(now) {
  anim.nextPlayAt = now + ANIM_BASE + (Math.random() * 2 - 1) * ANIM_JITTER;
}

async function initAnim() {
  try {
    const res = await fetch(P3D + "anim/manifest.json" + AV);
    if (!res.ok) return;
    const m = await res.json();
    anim.fps = m.fps || 8;
    anim.timeline = m.frames || [];
    anim.hold = m.hold || 0;
    anim.textures = await Promise.all(
      Array.from({ length: m.count }, (_, i) =>
        loadTexture(P3D + `anim/u${String(i).padStart(2, "0")}.jpg` + AV)),
    );
    anim.enabled = anim.textures.length > 0 && anim.timeline.length > 0;
    if (anim.enabled) {
      // QA: ?flick=N freezes on timeline slot N; ?animfast plays almost immediately
      if (params.has("flick")) {
        const s = clamp(parseInt(params.get("flick")) || 0, 0, anim.timeline.length - 1);
        setAnimFrame(anim.timeline[s]);
        anim.enabled = false;
        return;
      }
      if (params.has("animfast")) { ANIM_BASE = 600; ANIM_JITTER = 200; }
      setAnimFrame(anim.timeline[anim.hold]);
      scheduleNextPlay(performance.now());
    }
  } catch {
    /* no animation for this scene */
  }
}

function tickAnim(now, dt) {
  if (!anim.enabled) return;
  if (!anim.playing) {
    if (now >= anim.nextPlayAt) {
      anim.playing = true;
      anim.slot = 0;
      anim.slotTime = 0;
      setAnimFrame(anim.timeline[0]);
    }
    return;
  }
  anim.slotTime += dt;
  const slotDur = 1 / anim.fps;
  while (anim.slotTime >= slotDur) {
    anim.slotTime -= slotDur;
    anim.slot += 1;
    if (anim.slot >= anim.timeline.length) {
      anim.playing = false;
      setAnimFrame(anim.timeline[anim.hold]);
      scheduleNextPlay(now);
      return;
    }
    setAnimFrame(anim.timeline[anim.slot]);
  }
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
  if (subjectMesh) subjectMesh.geometry = geometry;
}

/* ---------- input ---------- */

function setTargetFromNormalized(nx, ny) {
  target.x = clamp(nx, -1, 1);
  target.y = clamp(ny, -1, 1);
}

// Native tilt bridge: the Android WebView live-wallpaper drives parallax from a
// native WAKEUP rotation-vector sensor (which keeps firing on the lock screen, where
// the browser's DeviceOrientation is suspended) and calls this with normalized tilt.
// Once native tilt arrives we treat it like a sensor reading so pointer-idle recentre
// and web DeviceOrientation don't fight it.
window.__nativeTilt = function (nx, ny) {
  if (debug.freeze || (!wallpaperMode && state.pointerActive)) return;
  state.hasSensorReading = true;
  setTargetFromNormalized(clamp(nx, -1, 1), clamp(ny, -1, 1));
  lastInputAt = typeof performance !== "undefined" ? performance.now() : 0;
};

function handlePointerDown(event) {
  if (wallpaperMode) return;
  if (debug.freeze || isControlTarget(event.target)) return;
  if (event.cancelable) event.preventDefault();
  state.pointerActive = true;
  drag.touch = event.pointerType === "touch";
  drag.pointerId = event.pointerId;
  drag.startX = event.clientX;
  drag.startY = event.clientY;
  // Touch should always create a visible look-around gesture. If we start from the
  // previous gyro/idle target, one direction can feel dead when that axis is already
  // near its clamp. Mouse drag keeps the current base; hover stays absolute below.
  drag.baseX = drag.touch ? 0 : target.x;
  drag.baseY = drag.touch ? 0 : target.y;
  drag.captureTarget = event.target?.setPointerCapture ? event.target : null;
  try { drag.captureTarget?.setPointerCapture(event.pointerId); } catch {}
  if (!drag.touch) handlePointerMove(event); // desktop mouse: absolute hover
}

function handlePointerMove(event) {
  if (wallpaperMode) return;
  if (debug.freeze) return;
  if (state.pointerActive) {
    if (drag.pointerId != null && event.pointerId !== drag.pointerId) return;
    if (event.cancelable) event.preventDefault();
    setTargetFromDrag(event.clientX, event.clientY);
    return;
  }
  if (state.hasSensorReading) return; // gyro drives when not dragging
  const nx = (event.clientX / window.innerWidth - 0.5) * 2;
  const ny = (event.clientY / window.innerHeight - 0.5) * 2;
  setTargetFromNormalized(nx, -ny);
  lastInputAt = performance.now();
}

function handlePointerUp() {
  if (wallpaperMode) return;
  try {
    if (drag.pointerId != null) drag.captureTarget?.releasePointerCapture(drag.pointerId);
  } catch {}
  state.pointerActive = false;
  drag.pointerId = null;
  drag.captureTarget = null;
}

function handleTouchStart(event) {
  if (wallpaperMode || debug.freeze || isControlTarget(event.target)) return;
  const touch = event.touches?.[0];
  if (!touch) return;
  if (event.cancelable) event.preventDefault();
  state.pointerActive = true;
  drag.touch = true;
  drag.pointerId = null;
  drag.captureTarget = null;
  drag.startX = touch.clientX;
  drag.startY = touch.clientY;
  drag.baseX = 0;
  drag.baseY = 0;
}

function handleTouchMove(event) {
  if (wallpaperMode || debug.freeze || !state.pointerActive || drag.pointerId != null) return;
  const touch = event.touches?.[0];
  if (!touch) return;
  if (event.cancelable) event.preventDefault();
  setTargetFromDrag(touch.clientX, touch.clientY);
}

function handleTouchEnd(event) {
  if (wallpaperMode || drag.pointerId != null) return;
  if (event.cancelable) event.preventDefault();
  state.pointerActive = false;
}

function setTargetFromDrag(clientX, clientY) {
  // drag = relative look-around; overrides gyro while the finger/mouse is down
  const dx = (clientX - drag.startX) / window.innerWidth;
  const dy = (clientY - drag.startY) / window.innerHeight;
  setTargetFromNormalized(drag.baseX + dx * TOUCH_SENS, drag.baseY - dy * TOUCH_SENS);
  lastInputAt = performance.now();
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
  if (wallpaperMode) return;
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
  if (debug.freeze || state.pointerActive || !state.motionEnabled || event.beta == null || event.gamma == null) return;
  if (sensor.baseBeta == null) {
    sensor.baseBeta = event.beta;
    sensor.baseGamma = event.gamma;
  }
  const dBeta = clamp(event.beta - sensor.baseBeta, -SENSOR.betaRange, SENSOR.betaRange);
  const dGamma = clamp(event.gamma - sensor.baseGamma, -SENSOR.gammaRange, SENSOR.gammaRange);
  state.hasSensorReading = true;
  sensor.lastOrientationAt = performance.now();
  setTargetFromNormalized(deadZone(dGamma / SENSOR.gammaRange), deadZone(-dBeta / SENSOR.betaRange));
}

function handleDeviceMotion(event) {
  if (debug.freeze || state.pointerActive || !state.motionEnabled) return;
  // Some mobile browsers expose both streams but only one is useful. Prefer fresh
  // orientation data, but let gravity fallback recover if orientation stalls.
  if (performance.now() - sensor.lastOrientationAt < 250) return;
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
  sensor.lastOrientationAt = 0;
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

function isControlTarget(target) {
  return Boolean(target?.closest?.(".controls"));
}
