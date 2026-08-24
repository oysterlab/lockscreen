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
const scenePathParam = params.get("scenePath");
const wallpaperMode = params.has("wallpaper");
const qaMode = params.has("qa");
if (wallpaperMode) document.documentElement.classList.add("wallpaper-mode");
if (qaMode) document.documentElement.classList.add("qa-mode");
const normalizeScenePath = (path) => path.endsWith("/") ? path : `${path}/`;
const P3D = scenePathParam
  ? normalizeScenePath(scenePathParam)
  : (sceneParam ? `./assets/photo3d_${sceneParam}/` : "./assets/photo3d_cherry2dio/");
// asset cache-buster: bump on any rebuilt PNG so phones don't serve a stale image
// (index.html's ?v= only refreshes the code, not these depth/colour PNGs).
const AV = location.protocol === "file:" ? "" : "?a=pet-r004-cleanref-1";
// scenes that carry an idle-flick animation (assets/photo3d_<scene>/anim/manifest.json):
// the foreground plate is swapped through a short clip every ~10s, then held.
const ANIM_SCENES = new Set(["cherry2dio", "nila2dio"]);
// core layers always present; protect.png (v2) / subject.png (v3 soft-LDI) are
// loaded optionally and decide which front-layer path runs (see below).
const ASSETS = {
  fgColor: P3D + "fg_color",        // extension picked at load time, see loadPlate
  fgDepth: P3D + "fg_depth.png" + AV,
  bgColor: P3D + "bg_color",
  bgDepth: P3D + "bg_depth.png" + AV,
};

let IMG_ASPECT = 864 / 1536; // updated from the loaded plate so any aspect cover-fits

// Depth tuning baseline for generated 9:16 diorama scenes.
const VIEW = {
  camZ: 6,
  fov: 36,
  depthScale: 1.84, // stronger foreground relief without the "inflated sticker" look
  farScale: 0.64, // opens mid/far parallax so the room reads deeper
  focus: 0.27, // lower still plane = more depth separation across the whole scene
  orbit: 0.84, // stronger horizontal camera travel at full tilt
  orbitYScale: 0.76, // allow small vertical motion to read more clearly
  //                   parallax can push a bottom/top-anchored subject off-screen
  cutLow: 0.04, // cut threshold for the scene (cut tree/sky edges -> no smear)
  cutHigh: 0.14, // cut threshold inside the protected cat region (don't cut -> no stipple)
  overscan: 0.12, // texture zoom so stronger orbit never exposes the frame border
  pad: 1.26, // plane oversize beyond the view, for camera-orbit headroom
  springFreq: 13.0, // snappier so small gyro changes register immediately
  idleAmp: 0.34,
  idleSpeed: 0.0002,
};

// Production sample scenes. New generated scenes use the default VIEW values.
const SCENE_OVERRIDES = {
  latte2dio: { depthScale: 1.84, farScale: 0.74, focus: 0.26 },
  nila2dio: { depthScale: 1.84, farScale: 0.74, focus: 0.26 },
  cherry2dio: { depthScale: 1.84, farScale: 0.74, focus: 0.26 },
};
Object.assign(VIEW, SCENE_OVERRIDES[sceneParam] || {});

// fit mode per scene. 'cover' fills the screen (crops the 9:16 plate's sides on a
// tall phone); 'width' fits the whole image width so the full composition shows —
// the top/bottom margin is filled by edge-clamp (sky extends up, ground extends
// down) so there are no black bars. URL override: ?fit=cover|width|height.
const fitMode = params.get("fit") || "cover";

// Cherry's ear tips are too thin for the full depth mesh: vertices just outside
// the matte can still be pulled by background depth, making the tip look pinned.
// Render that subject with a masked cat-only depth field instead: inside the
// matte keeps the image depth, outside/soft edges are filled with cat-average depth.
const SUBJECT_DEPTH_SCENES = new Set(["cherry2dio"]);
const SUBJECT_BASE_DEPTH = params.has("sbd") ? parseFloat(params.get("sbd")) : 0.43;
const SUBJECT_DEPTH_CONTRAST = params.has("sdc") ? parseFloat(params.get("sdc")) : 1.12;

// smaller ranges => a small phone tilt reaches full parallax (very responsive)
const SENSOR = { betaRange: 4.2, gammaRange: 4.2, gravityRange: 1.15, deadZone: 0.006 };
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
let wallpaperActive = true;
let curtainWakeGustPending = params.has("wakegust");
let curtainWakeGustStartedAt = -Infinity;
let curtainWakeGustEndsAt = -Infinity;
let curtainWakeGustSerial = 0;
const CURTAIN_WAKE_GUST_MS = 5200;
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
// URL-tunable knobs for QA sweeps: ?ct=&cth=&ds=&ob=orbit&oby=orbitYScale&fc=focus&fs=farScale
if (params.has("oby")) VIEW.orbitYScale = parseFloat(params.get("oby"));
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

// Clean layered-photo path for scenes with a reliable subject matte and an
// inpainted background.  The background stays perfectly rigid, while the subject
// sits on a nearer compensated plane.  A small amount of depth-map relief is
// allowed only *inside* the soft matte, so no triangle can tear across the
// silhouette or expose a stretched strip of texture.
const VERT_RIGID_LAYER = `
  uniform vec2 uCover;
  uniform float uLayerZ;
  uniform float uLayerScale;
  varying vec2 vUv;
  void main() {
    vUv = (uv - 0.5) * uCover + 0.5;
    vec3 p = position;
    p.xy *= uLayerScale;
    p.z += uLayerZ;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;

const VERT_SAFE_SUBJECT = `
  uniform sampler2D uDepth;
  uniform sampler2D uSubject;
  uniform vec2 uCover;
  uniform float uLayerZ;
  uniform float uLayerScale;
  uniform float uSubjectBaseDepth;
  uniform float uSubjectRelief;
  varying vec2 vUv;
  void main() {
    vec2 tuv = (uv - 0.5) * uCover + 0.5;
    vUv = tuv;
    float matte = texture2D(uSubject, tuv).r;
    float core = smoothstep(0.12, 0.72, matte);
    float rawDepth = texture2D(uDepth, tuv).r;
    float safeDepth = mix(uSubjectBaseDepth, rawDepth, core);
    vec3 p = position;
    p.xy *= uLayerScale;
    p.z += uLayerZ + (safeDepth - uSubjectBaseDepth) * uSubjectRelief;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;

// Perspective-correct depth displacement. Moving a vertex only along Z changes
// its apparent scale even at the capture camera, so the old mesh could never
// reproduce the source image at rest.  Scaling XY by (cameraZ - deltaZ) / cameraZ
// keeps every vertex at its original screen coordinate at the convergence view;
// the depth becomes visible only when the camera moves away from that view.
const VERT_COHERENT_BG = `
  uniform sampler2D uDepth;
  uniform float uDepthScale;
  uniform float uFarScale;
  uniform float uFocus;
  uniform float uCamZ;
  uniform float uZBias;
  uniform vec2 uCover;
  varying vec2 vUv;
  void main() {
    vec2 tuv = (uv - 0.5) * uCover + 0.5;
    vUv = tuv;
    float d = texture2D(uDepth, tuv).r;
    float rel = d - uFocus;
    float bandScale = rel < 0.0 ? uFarScale : 1.0;
    float dz = rel * uDepthScale * bandScale + uZBias;
    vec3 p = position;
    p.xy *= max(0.55, (uCamZ - dz) / uCamZ);
    p.z += dz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;

const VERT_COHERENT_SUBJECT = `
  uniform sampler2D uDepth;
  uniform sampler2D uSubject;
  uniform float uDepthScale;
  uniform float uFarScale;
  uniform float uFocus;
  uniform float uCamZ;
  uniform float uZBias;
  uniform float uSubjectBaseDepth;
  uniform vec2 uCover;
  varying vec2 vUv;
  void main() {
    vec2 tuv = (uv - 0.5) * uCover + 0.5;
    vUv = tuv;
    float matte = texture2D(uSubject, tuv).r;
    float core = smoothstep(0.08, 0.72, matte);
    float rawDepth = texture2D(uDepth, tuv).r;
    float d = mix(uSubjectBaseDepth, rawDepth, core);
    float rel = d - uFocus;
    float bandScale = rel < 0.0 ? uFarScale : 1.0;
    float dz = rel * uDepthScale * bandScale + uZBias;
    vec3 p = position;
    p.xy *= max(0.55, (uCamZ - dz) / uCamZ);
    p.z += dz;
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

// Layered-live path: purpose-built 2.5D rather than a globally warped depth
// mesh.  Every layer is a rigid two-triangle plane, so silhouettes cannot tear.
const VERT_LIVE_LAYER = `
  uniform vec2 uCover;
  varying vec2 vUv;
  void main() {
    vUv = (uv - 0.5) * uCover + 0.5;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

// Cloud strips are horizontally TILEABLE and scroll ONE way forever (RepeatWrapping).
// The obvious alternative — oscillating the UV with a sine so the texture edge never
// shows — reverses direction every half period and reads as wobble, not weather.
// uCoverage is a 256x1 LUT baked from the near strip: how much of the window that strip
// covers at each scroll offset. Sky, wall light and contact shadow all read that one
// number, so the wall dims BECAUSE a cloud crossed the window.
const FRAG_LIVE_SKY = `
  uniform sampler2D uSky;
  uniform sampler2D uCloudFar;
  uniform sampler2D uCloudNear;
  uniform sampler2D uCoverage;
  uniform sampler2D uNoise;
  uniform float uTime;
  uniform float uTiles;
  uniform float uNearSpeed;
  uniform float uFarSpeed;
  uniform float uFarOpacity;
  uniform float uSkyDim;
  uniform float uWarp;
  uniform float uWarpSpeed;
  uniform float uBreathe;
  uniform vec2 uBand;
  varying vec2 vUv;
  void main() {
    vec3 rgb = texture2D(uSky, vUv).rgb;
    float by = (vUv.y - uBand.x) / max(uBand.y - uBand.x, 1e-4);
    if (by > 0.0 && by < 1.0) {
      // a tiling noise field drifting at its own rate. Scrolling a strip rigidly makes
      // the clouds read as printed on glass: real ones change shape while they cross.
      vec2 nuv = vec2(vUv.x * 1.7, by * 1.1) + vec2(uTime * uWarpSpeed, uTime * uWarpSpeed * 0.35);
      float n1 = texture2D(uNoise, nuv).r;
      float n2 = texture2D(uNoise, nuv * 0.45 + vec2(0.37, 0.61) - uTime * uWarpSpeed * 0.5).r;
      vec2 warp = vec2(n1 - 0.5, n2 - 0.5) * uWarp;
      vec4 far = texture2D(uCloudFar, vec2(vUv.x / uTiles + uTime * uFarSpeed, by) + warp * 0.6);
      vec4 near = texture2D(uCloudNear, vec2(vUv.x / uTiles + uTime * uNearSpeed, by) + warp);
      float breathe = 1.0 + (n2 - 0.5) * 2.0 * uBreathe;
      rgb = mix(rgb, far.rgb, clamp(far.a * uFarOpacity * breathe, 0.0, 1.0));
      rgb = mix(rgb, near.rgb, clamp(near.a * breathe, 0.0, 1.0));
    }
    float cov = texture2D(uCoverage, vec2(fract(uTime * uNearSpeed), 0.5)).r;
    #ifdef DBG_CLOUD
      float byd = (vUv.y - uBand.x) / max(uBand.y - uBand.x, 1e-4);
      vec4 nd = texture2D(uCloudNear, vec2(vUv.x / uTiles + uTime * uNearSpeed, clamp(byd,0.0,1.0)));
      gl_FragColor = vec4(nd.a, (byd > 0.0 && byd < 1.0) ? 1.0 : 0.0, clamp(byd,0.0,1.0), 1.0);
      return;
    #endif
    gl_FragColor = vec4(rgb * (1.0 - cov * uSkyDim), 1.0);
  }`;

const FRAG_LIVE_ARCHITECTURE = `
  uniform sampler2D uColor;
  uniform sampler2D uLightMask;
  uniform sampler2D uCoverage;
  uniform float uTime;
  uniform float uNearSpeed;
  uniform float uLightIntensity;
  uniform float uRimDim;
  uniform vec3 uWarm;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(uColor, vUv);
    if (c.a < 0.004) discard;
    float cov = texture2D(uCoverage, vec2(fract(uTime * uNearSpeed), 0.5)).r;
    // R = the sunlit band as photographed, G = the same band heavily blurred, B = the rim.
    // Cloud over the sun does not move the patch, it softens its edge and drops its
    // strength; the rim is lit by the sky through the opening, so it dims with the same
    // signal instead of sitting inert while everything around it breathes.
    vec3 lm = texture2D(uLightMask, vUv).rgb;
    float light = mix(lm.r, lm.g, cov);
    c.rgb += light * uWarm * uLightIntensity * (1.0 - cov);
    c.rgb *= 1.0 - lm.b * cov * uRimDim;
    gl_FragColor = c;
  }`;

const FRAG_LIVE_HERO = `
  uniform sampler2D uColor;
  uniform sampler2D uCoverage;
  uniform float uTime;
  uniform float uNearSpeed;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(uColor, vUv);
    if (c.a < 0.004) discard;
    float cov = texture2D(uCoverage, vec2(fract(uTime * uNearSpeed), 0.5)).r;
    // only a global 1.5% — a moving light edge across fur would need the fur relit, and a
    // flat 2D mask over it reads as plastic
    c.rgb *= 1.0 - cov * 0.015;
    gl_FragColor = c;
  }`;

const FRAG_LIVE_SHADOW = `
  uniform sampler2D uColor;
  uniform sampler2D uCoverage;
  uniform float uTime;
  uniform float uNearSpeed;
  uniform float uShadowFade;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(uColor, vUv);
    if (c.a < 0.003) discard;
    float cov = texture2D(uCoverage, vec2(fract(uTime * uNearSpeed), 0.5)).r;
    c.a *= 1.0 - cov * uShadowFade;
    gl_FragColor = c;
  }`;

// Every solid layer shares ONE parallax law: travel = base + relief * (depth - pivot),
// with the pivot on the wall so the wall is the still plane. Because the room's depth and
// the hero's depth are normalised together, the podium's base and the floor it stands on
// are the same number and therefore travel by the same amount — the group stops sliding
// over the background without any per-layer tuning.
// One reference frame carries every pixel of detail; the time of day only supplies a
// low-frequency light field, and the ratio between two of those relights the reference.
// Cross-fading two real frames instead is what doubled the cat's eyes: the generated clip
// does not hold the subject still, so blending draws it twice.
const FRAG_FULLDAY = `
  uniform sampler2D uRef;
  uniform sampler2D uLowRef;
  uniform sampler2D uLowA;
  uniform sampler2D uLowB;
  uniform float uMix;
  // Indoor indirect light is authored as a registered night OFF/ON pair. Only the
  // positive difference is added to the natural light field, so moonlight remains
  // present instead of being replaced by an amber grade. The same combined light field then
  // relights the room, the swapped pet, and the moving curtain consistently.
  uniform sampler2D uIndirectOff;
  uniform sampler2D uIndirectOn;
  uniform float uIndirectGain;
  uniform float uIndirectSigned;
  uniform sampler2D uPlinthMask;
  uniform float uSubjectNightLift;
  uniform float uPlinthNightLift;
  // Shadow relief. The light maps hold the shadow the window casts on the ROOM, and every
  // surface that was in the clip already has its own correct one. The subject was not
  // there, so a flat lookup drapes the wall's shadow over it — the band runs dead straight
  // across a round cat and it reads as a decal. A point standing in front of the wall
  // intercepts the beam earlier, displaced by its depth times the shadow's own lateral
  // offset; uShift* carries that offset per slot and uRelief carries the depth, so the
  // band bends over the volume. uRelief is 0 everywhere else, which leaves the room exactly
  // as measured.
  // Environment overlays: one element's motion, stored as a multiplicative modulation of
  // the room (1.0 = untouched). They are MULTIPLIED into the day's ratio rather than
  // blended over the image, because that is what a shadow physically is — and because it
  // keeps each element's own baked lighting out of the scene, so a branch shot at noon can
  // cross a wall at 6pm. Each runs on its own clock (uOvMix carries its own phase), which
  // is the whole point: elements that move on one shared beat read as a single animation.
  uniform sampler2D uOvA;
  uniform sampler2D uOvB;
  uniform vec2 uOvOfs;        // slow sway, on periods that do not divide the flutter loop
  uniform float uOvMix;
  uniform float uOvGain;      // 0 disables; a sunlit element is faded out with the day
  uniform vec2 uOvRange;
  uniform sampler2D uShadowRelief;
  uniform vec2 uShiftA;
  uniform vec2 uShiftB;
  uniform vec2 uShiftRef;
  uniform float uHasRelief;
  // Curtain breathing. The drape is not a shadow — it is an object with a silhouette — so it
  // cannot be a multiplicative overlay: the still's curtain stays put while the clip's copy
  // slides, and the moving outline lands on top as a translucent double (measured on a clip
  // whose silhouette moved 50px; it read as a ghost curtain). Nor could five passes at a
  // generative clip hold it still: asked for motion with nothing allowed to travel, the model
  // duplicated the drape and sent the copy across the frame.
  //
  // So the motion is made here, from the still's OWN curtain. Folds are near-vertical bands,
  // which is the one thing that makes this safe: displacing along x within the drape shifts
  // the folds against one another and reads as cloth settling. The same trick fails on leaf
  // shadows, where the pattern has no grain and a warp just makes the whole mass swim.
  //
  // uCurtain = (x0, x1, feather, amplitude-in-uv). Zero amplitude disables it entirely.
  // Curtain strip. The drape is an object, not a shadow: multiplying the clip's curtain onto
  // the still's curtain paints a translucent double (the "ghost curtain"). So the strip it
  // lives in is REPLACED with the clip's pixels instead. That also removes the need for a
  // curtain-free backdrop — wherever the drape moves away from, the clip already shows what
  // is behind it. The strip carries the clip's own light in uCurLight; dividing it out and
  // multiplying the hour's light back in is the same transplant the room gets, so a curtain
  // shot at noon sits correctly in a dusk room.
  uniform sampler2D uCurA;
  uniform sampler2D uCurB;
  uniform sampler2D uCurLight;
  uniform sampler2D uCurSubject;   // the curtain passes BEHIND the subject
  uniform float uCurMix;
  uniform vec4 uCurtain;      // x1, feather, stripWidth, enabled
  varying vec2 vUv;

  void main() {
    vec3 ref = texture2D(uRef, vUv).rgb;
    float relief = uHasRelief * texture2D(uShadowRelief, vUv).r;
    vec3 lo0 = texture2D(uLowRef, vUv + uShiftRef * relief).rgb;
    vec3 lo = mix(texture2D(uLowA, vUv + uShiftA * relief).rgb,
                  texture2D(uLowB, vUv + uShiftB * relief).rgb, uMix);
    if (uIndirectGain > 0.0) {
      vec3 indirectOff = texture2D(uIndirectOff, vUv).rgb;
      vec3 indirectOn = texture2D(uIndirectOn, vUv).rgb;
      vec3 indirectDelta = indirectOn - indirectOff;
      // Legacy pairs only add a warm lamp. An authored night target also carries the
      // cooler skylight and darker balance that make it read as night, so it needs the
      // signed delta instead of silently throwing its negative channels away.
      vec3 indirect = mix(max(indirectDelta, vec3(0.0)), indirectDelta, uIndirectSigned);
      lo = clamp(lo + indirect * uIndirectGain, vec3(0.0), vec3(1.0));
    }
    // the reference's own light is divided out; clamped because a near-black reference
    // pixel would otherwise turn its own compression noise into a bright speckle
    vec3 ratio = clamp(lo / max(lo0, vec3(0.02)), vec3(0.0), vec3(4.0));
    // step, never blend, between overlay frames when they are a frame apart; uOvMix is
    // only ever non-zero when the two are adjacent in the element's own cycle
    if (uOvGain > 0.0) {
      vec2 ovUv = vUv + uOvOfs;
      float ov = mix(texture2D(uOvA, ovUv).r, texture2D(uOvB, ovUv).r, uOvMix);
      ov = uOvRange.x + ov * (uOvRange.y - uOvRange.x);
      ratio *= 1.0 + (ov - 1.0) * uOvGain;
    }
    vec3 col = ref * ratio;
    if (uCurtain.w > 0.0 && vUv.x < uCurtain.z) {
      vec2 sUv = vec2(vUv.x / uCurtain.z, vUv.y);
      vec3 cur = mix(texture2D(uCurA, sUv).rgb, texture2D(uCurB, sUv).rgb, uCurMix);
      vec3 curLo = texture2D(uCurLight, sUv).rgb;
      // the hour's light, with the clip's own divided out — same ratio the room uses
      vec3 lit = cur * clamp(lo / max(curLo, vec3(0.02)), vec3(0.0), vec3(4.0));
      // The clip's curtain sweeps across the middle of the room, which is where the subject
      // stands — and the subject is in the still, not in the clip, so replacing that strip
      // wholesale erases it. The drape hangs at the window and the subject sits on a plinth
      // in front of it, so the strip is simply held back by the subject's own matte.
      float m = smoothstep(uCurtain.x + uCurtain.y, uCurtain.x, vUv.x);
      m *= 1.0 - texture2D(uCurSubject, vUv).r;
      col = mix(col, lit, m * uCurtain.w);
    }
    // A dark-furred subject and the plinth cannot separate from a midnight wall by
    // contrast alone. This is a soft moonlight bounce, not a spotlight: the authored
    // subject/plinth mattes only open their darkest values while preserving texture and
    // the room's broad ambient gradient. It follows the same dusk/night curve as the
    // indirect-light layer and is completely absent during the day.
    if (uIndirectGain > 0.0) {
      float subjectBounce = texture2D(uCurSubject, vUv).r * uSubjectNightLift;
      float plinthBounce = texture2D(uPlinthMask, vUv).r * uPlinthNightLift;
      float bounceAmount = clamp((subjectBounce + plinthBounce) * uIndirectGain, 0.0, 0.2);
      vec3 bounce = vec3(0.62, 0.74, 1.0) * bounceAmount;
      col = vec3(1.0) - (vec3(1.0) - col) * (vec3(1.0) - bounce);
    }
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }`;

const VERT_LIVE_DEPTH = `
  uniform vec2 uCover;
  uniform sampler2D uDepth;
  uniform vec2 uRelief;
  uniform float uPivot;
  varying vec2 vUv;
  void main() {
    vUv = (uv - 0.5) * uCover + 0.5;
    float d = texture2D(uDepth, vUv).r;
    // pivot on the wall: the layer's base travel equals
    // the architecture's, so the contact line moves WITH the floor and only the parts
    // standing above it separate. Pivoting on 0.5 slides the whole group over the room.
    vec3 p = position + vec3(uRelief * (d - uPivot), 0.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;

// sprite3d: an animated cat rendered as a per-frame colour+depth sprite cropped to
// a bbox (uRect, in plate-UV). The full subject plane is reused; only the rect
// region draws. Each frame carries its OWN depth so the cat's relief animates and
// parallax stays correct mid-motion (not a flat depth-frozen sticker). Where the
// cat moves away the alpha is 0 -> the static back layer (bg_color) shows through.
const VERT_SPRITE3D = `
  uniform sampler2D uColorSprite;
  uniform sampler2D uDepthSprite;
  uniform float uDepthScale, uFarScale, uFocus, uZBias;
  uniform float uSubjectBaseDepth, uSubjectDepthContrast;
  uniform vec2 uCover;
  uniform vec4 uRect;
  varying vec2 vSprite;
  void main() {
    vec2 tuv = (uv - 0.5) * uCover + 0.5;
    vec2 sp = (tuv - uRect.xy) / (uRect.zw - uRect.xy);
    vSprite = sp;
    vec3 p = position;
    if (sp.x >= 0.0 && sp.x <= 1.0 && sp.y >= 0.0 && sp.y <= 1.0) {
      float matte = texture2D(uColorSprite, sp).a;
      float core = smoothstep(0.18, 0.62, matte);
      float rawd = texture2D(uDepthSprite, sp).r;
      float d = mix(uSubjectBaseDepth, rawd, core);
      d = clamp(uSubjectBaseDepth + (d - uSubjectBaseDepth) * uSubjectDepthContrast, 0.0, 1.0);
      float rel = d - uFocus;
      float s = rel < 0.0 ? uFarScale : 1.0;
      p.z += rel * uDepthScale * s + uZBias;
    }
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;

const FRAG_SPRITE3D = `
  uniform sampler2D uColorSprite;
  varying vec2 vSprite;
  void main() {
    if (vSprite.x < 0.0 || vSprite.x > 1.0 || vSprite.y < 0.0 || vSprite.y > 1.0) discard;
    vec4 c = texture2D(uColorSprite, vSprite);
    if (c.a < 0.02) discard;
    gl_FragColor = vec4(c.rgb, c.a);
  }`;

// video3d: the cat animation is a packed mp4 (flipY=false) whose frame stacks
// three panels — [colour | alpha | depth] — so the browser decodes one frame at a
// time (tiny GPU memory) yet colour+matte+depth stay frame-accurate. Panels are
// equal thirds; panel coordinate for an image-top-down row is (1-spriteUV.y)/3.
const VID_PANEL = `
  vec2 panelUV(vec2 sp, float idx) {
    return vec2(sp.x, (1.0 - sp.y) / 3.0 + idx / 3.0);
  }`;
const VERT_VIDEO3D = `
  uniform sampler2D uVideo;
  uniform float uDepthScale, uFarScale, uFocus, uZBias;
  uniform float uSubjectBaseDepth, uSubjectDepthContrast;
  uniform vec2 uCover;
  uniform vec4 uRect;
  varying vec2 vSprite;
  ${VID_PANEL}
  void main() {
    vec2 tuv = (uv - 0.5) * uCover + 0.5;
    vec2 sp = (tuv - uRect.xy) / (uRect.zw - uRect.xy);
    vSprite = sp;
    vec3 p = position;
    if (sp.x >= 0.0 && sp.x <= 1.0 && sp.y >= 0.0 && sp.y <= 1.0) {
      float matte = texture2D(uVideo, panelUV(sp, 1.0)).r;
      float core = smoothstep(0.18, 0.62, matte);
      float rawd = texture2D(uVideo, panelUV(sp, 2.0)).r;
      float d = mix(uSubjectBaseDepth, rawd, core);
      d = clamp(uSubjectBaseDepth + (d - uSubjectBaseDepth) * uSubjectDepthContrast, 0.0, 1.0);
      float rel = d - uFocus;
      float s = rel < 0.0 ? uFarScale : 1.0;
      p.z += rel * uDepthScale * s + uZBias;
    }
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;
const FRAG_VIDEO3D = `
  uniform sampler2D uVideo;
  varying vec2 vSprite;
  ${VID_PANEL}
  void main() {
    vec2 sp = vSprite;
    if (sp.x < 0.0 || sp.x > 1.0 || sp.y < 0.0 || sp.y > 1.0) discard;
    float a = texture2D(uVideo, panelUV(sp, 1.0)).r;
    if (a < 0.02) discard;
    vec3 rgb = texture2D(uVideo, panelUV(sp, 0.0)).rgb;
    gl_FragColor = vec4(rgb, a);
  }`;

const cover = new THREE.Vector2(1, 1);
let frontMat, backMat, subjectMat, frontMesh, backMesh, subjectMesh, geometry;
// fullday: one clip seeked to the time of day (see the render path below)
const fullDay = {
  active: false, mesh: null, hasDepth: false, basePx: 0, reliefPx: 0,
  sync: null, pause: null, resume: null, lastSync: 0,
};

const liveLayerScene = {
  active: false,
  config: null,
  meshes: {},
  materials: {},
  worldPerPixel: new THREE.Vector2(0, 0),
};

const loader = new THREE.TextureLoader();
const BLANK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
BLANK.needsUpdate = true;
const loadOpt = (url) => loadTexture(url).catch(() => null); // 404 -> null
// XHR, not fetch. The Android wallpaper loads the whole site from file:///android_asset,
// and Chromium refuses fetch() on a file:// URL no matter what the WebView allows —
// setAllowFileAccessFromFileURLs only ever governed XMLHttpRequest. Since view.json now
// decides the render mode, a silent null here meant the scene never came up at all.
const loadJsonOpt = (url) =>
  new Promise((resolve) => {
    try {
      const x = new XMLHttpRequest();
      x.open("GET", url, true);
      x.onload = () => {
        // a file:// read reports status 0 on success, so parse rather than check status
        try { resolve(JSON.parse(x.responseText)); } catch (e) { resolve(null); }
      };
      x.onerror = () => resolve(null);
      x.send();
    } catch (e) {
      resolve(null);
    }
  });

// Colour plates ship as WebP: a learned-upscaled 2x plate is ~8MB as PNG and ~0.5MB at
// q92 WebP with no visible loss at 1:1. Depth and mattes stay PNG — lossy ringing in a
// depth map turns into visible geometry. Scenes built before the upscale step only have
// .png, so the WebP request is allowed to 404 and fall back.
const loadPlate = (base) =>
  loadTexture(base + ".webp" + AV).catch(() => loadTexture(base + ".png" + AV));

// view.json is read FIRST: a layered-live scene has no fg_color/bg_color at all, so
// loading the depth-mesh plates before knowing the render mode fails the whole scene.
loadJsonOpt(P3D + "view.json" + AV)
  .then(async (viewCfg) => {
    // Per-scene auto-seated convergence/gain. build_3dphoto.py writes view.json with
    // focus (the zero-parallax "still" plane = Immersity's convergence) and depthScale
    // (relief = Immersity's gain), estimated from the scene's depth + subject. Applied
    // ONLY for generated scenes: hand-tuned SCENE_OVERRIDES stay authoritative, and the
    // URL knobs (?fc=&ds=&fs=) still win. Missing file -> defaults unchanged.
    const hasManualTune =
      sceneParam && Object.prototype.hasOwnProperty.call(SCENE_OVERRIDES, sceneParam);
    if (!hasManualTune) {
      if (viewCfg && typeof viewCfg === "object") {
        if (!params.has("fc") && Number.isFinite(viewCfg.focus)) tune.focus = viewCfg.focus;
        if (!params.has("ds") && Number.isFinite(viewCfg.depthScale)) tune.depthScale = viewCfg.depthScale;
        if (!params.has("fs") && Number.isFinite(viewCfg.farScale)) tune.farScale = viewCfg.farScale;
        if (!params.has("ob") && Number.isFinite(viewCfg.orbit)) tune.orbit = viewCfg.orbit;
        if (!params.has("oby") && Number.isFinite(viewCfg.orbitYScale)) VIEW.orbitYScale = viewCfg.orbitYScale;
      }
    }

    // A single short clip mapped onto the 24h clock: the frame on screen IS the time of
    // day. Nothing plays — the video is seeked, because 192 frames over 24 hours means one
    // frame lasts 7.5 real minutes and playback would run the day 10800x too fast.
    // One short clip stands for 24 hours, so the frame on screen IS the time of day.
    // The frames are stills, not a video: a browser only decodes a video when something
    // demands a frame, parks an offscreen one at metadata, and can sit in `seeking`
    // indefinitely — none of which a wallpaper can depend on. Two stills are loaded at a
    // time and cross-faded, which also ramps the light instead of stepping it.
    // One short clip stands for 24 hours, so the frame on screen IS the time of day.
    // What changes with the clock is only the LIGHT: see FRAG_FULLDAY for why the frames
    // themselves are never blended.
    if (viewCfg?.renderMode === "fullday") {
      const slots = Math.max(1, Math.round(Number(viewCfg.slots) || 96));
      const pat = viewCfg.lightPattern || "light/l%03d.webp";
      // slot maps are the room's light and are shared between subjects, so a swapped scene
      // points at the scene they were built from instead of carrying its own 3MB copy
      const lightBase = viewCfg.lightFrom ? `./assets/photo3d_${viewCfg.lightFrom}/` : P3D;
      const url = (p, i, base) =>
        (base || P3D) + (i == null ? p : p.replace(/%0(\d)d/, (_, w) => String(i).padStart(Number(w), "0"))) + AV;
      const prep = (t) => {
        t.minFilter = t.magFilter = THREE.LinearFilter;
        t.generateMipmaps = false;
        t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
        return t;
      };
      const indirectCfg = viewCfg.indirectLight || null;
      const [reference, lowRef] = await Promise.all([
        loadTexture(url(viewCfg.reference || "reference.webp")).then(prep),
        loadTexture(url(viewCfg.referenceLight || "light/ref.webp")).then(prep),
      ]);
      let indirectOff = null, indirectOn = null, plinthMask = null;
      if (indirectCfg?.off && indirectCfg?.on) {
        [indirectOff, indirectOn] = await Promise.all([
          loadTexture(url(indirectCfg.off, null, lightBase)).then(prep).catch(() => null),
          loadTexture(url(indirectCfg.on, null, lightBase)).then(prep).catch(() => null),
        ]);
      }
      if (indirectCfg?.plinthMask) {
        plinthMask = await loadTexture(url(indirectCfg.plinthMask, null, lightBase))
          .then(prep).catch(() => null);
      }
      if (reference.image?.width) IMG_ASPECT = reference.image.width / reference.image.height;

      const cache = new Map();
      const lightTex = (i) => {
        const k = ((i % slots) + slots) % slots;
        if (!cache.has(k)) {
          cache.set(k, loadTexture(url(pat, k, lightBase)).then(prep));
          if (cache.size > 6) cache.delete([...cache.keys()][0]);
        }
        return cache.get(k);
      };

      // ?tod=HH:MM (or a 0..1 fraction) freezes the clock and ?dayspeed=N runs it faster —
      // without those you would wait 15 real minutes to see the light move once
      const todParam = params.get("tod");
      let frozen = null;
      if (todParam != null) {
        const m = /^(\d{1,2}):(\d{2})$/.exec(todParam);
        frozen = m ? (Number(m[1]) * 60 + Number(m[2])) / 1440 : parseFloat(todParam);
        if (!Number.isFinite(frozen)) frozen = null;
      }
      const daySpeed = params.has("dayspeed") ? parseFloat(params.get("dayspeed")) : 1;
      // phaseHours rotates the clip against the clock: its first frame is not necessarily
      // meant to be midnight
      const phase = (params.has("phase") ? parseFloat(params.get("phase"))
                                         : Number(viewCfg.phaseHours) || 0) / 24;
      const dayFraction = () => {
        const base = frozen != null ? frozen : (() => {
          const d = new Date();
          return (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()
                  + d.getMilliseconds() / 1000) * daySpeed / 86400;
        })();
        return (((base + phase) % 1) + 1) % 1;
      };

      const first = await lightTex(Math.floor(dayFraction() * slots));
      // ONE depth map for the whole day. The reference frame is the only geometry that
      // ever reaches the screen — the clock changes light, not shape — so a per-slot depth
      // map would be 96 maps that have to agree, and a depth model does not agree with
      // itself frame to frame.
      const depthCfg = viewCfg.depth || {};
      const curtainCfg = viewCfg.curtain || {};
      let curMeta = null, curTex = null, curVideo = null, curRest = null;
      let curLight = null, curPhase = 0, curLast = 0;
      const subjTex = viewCfg.subject
        ? await loadTexture(url(viewCfg.subject)).then(prep).catch(() => null) : null;
      if (curtainCfg.id) {
        const cb = `./assets/curtain_${curtainCfg.id}/`;
        curMeta = await loadJsonOpt(cb + "meta.json");
        if (curMeta) {
          curLight = await loadTexture(url(curMeta.light, 0, cb)).then(prep).catch(() => null);
          if (curMeta.video) {
            curRest = await loadTexture(url(curMeta.pattern, curMeta.restIndex, cb))
              .then(prep).catch(() => null);
            const el = document.createElement("video");
            el.muted = true;
            el.loop = false;
            el.playsInline = true;
            el.preload = "auto";
            el.setAttribute("muted", "");
            el.setAttribute("playsinline", "");
            const videoReady = new Promise((resolve) => {
              const done = (ok) => {
                el.removeEventListener("loadeddata", onReady);
                el.removeEventListener("error", onError);
                resolve(ok);
              };
              const onReady = () => done(true);
              const onError = () => done(false);
              el.addEventListener("loadeddata", onReady, { once: true });
              el.addEventListener("error", onError, { once: true });
              setTimeout(() => done(el.readyState >= 2), 3500);
            });
            el.src = url(curMeta.video, null, cb);
            el.load();
            if ((await videoReady) && curRest) {
              const tex = new THREE.VideoTexture(el);
              tex.minFilter = tex.magFilter = THREE.LinearFilter;
              tex.generateMipmaps = false;
              tex.flipY = true;
              tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
              curVideo = {
                el, tex, queued: false, naturalWasActive: false,
                lastWakeSerial: curtainWakeGustSerial,
              };
              const play = (wakeTriggered = false) => {
                if (!wallpaperActive) return;
                if (!el.paused && !el.ended) {
                  if (wakeTriggered && el.currentTime > 4.0) curVideo.queued = true;
                  return;
                }
                curVideo.queued = false;
                try { el.currentTime = 0; } catch {}
                if (typeof el.requestVideoFrameCallback === "function") {
                  el.requestVideoFrameCallback(() => curVideo.bindVideo?.());
                } else {
                  setTimeout(() => {
                    if (!el.paused) curVideo.bindVideo?.();
                  }, 80);
                }
                el.play().catch(() => {});
              };
              const stopAtRest = () => {
                el.pause();
                try { el.currentTime = 0; } catch {}
                curVideo.bindRest?.();
              };
              curVideo.play = play;
              curVideo.stop = stopAtRest;
              el.addEventListener("ended", () => {
                const replay = curVideo.queued && wallpaperActive;
                curVideo.queued = false;
                stopAtRest();
                if (replay) el.play().catch(() => {});
              });
            } else {
              el.removeAttribute("src");
              el.load();
            }
          }
          if (!curVideo) {
            // Compatibility fallback for browsers that cannot decode the packed H.264.
            const pend = new Map(), rdy = new Map(), ord = [];
            const want = (i) => {
              const k = Math.max(0, Math.min(curMeta.frames - 1, i));
              if (rdy.has(k) || pend.has(k)) return;
              pend.set(k, loadTexture(url(curMeta.pattern, k, cb)).then(prep).then((t) => {
                pend.delete(k); rdy.set(k, t); ord.push(k);
                while (ord.length > 24) {
                  const d = ord.shift(); rdy.get(d)?.dispose?.(); rdy.delete(d);
                }
              }).catch(() => pend.delete(k)));
            };
            curTex = { want, ready: rdy };
            for (let i = 0; i < 8; i++) want(curMeta.restIndex + i);
          }
        }
      }
      const depthTex = viewCfg.depthMap
        ? await loadTexture(url(viewCfg.depthMap)).then(prep) : null;
      // shadow relief: per-pixel depth of the subject over what the clip recorded behind
      // it, and the per-slot lateral offset of the window shadow. Only scenes built with
      // SUBJECT_DEPTH have it; without it the shadow lands as a flat projection, which is
      // what every scene did before.
      const reliefTex = viewCfg.relief
        ? await loadTexture(url(viewCfg.relief)).then(prep).catch(() => null) : null;
      const beamShift = Array.isArray(viewCfg.beamShift) ? viewCfg.beamShift : null;
      const beamScale = params.has("bend")
        ? parseFloat(params.get("bend"))
        : (viewCfg.beamScale ?? 0.15);
      // beamShift holds the shadow's own position; the displacement is its offset from the
      // WINDOW, which is off-frame (beamOrigin, negative for a window to the left). Using
      // the raw position centred on its own median instead put the bend through zero near
      // midday and the band went straight across the cat again.
      const beamOrigin = params.has("borigin")
        ? parseFloat(params.get("borigin"))
        : (viewCfg.beamOrigin ?? 0);
      const shiftAt = (i) => (reliefTex && beamShift
        ? ((beamShift[((i % slots) + slots) % slots] || 0) - beamOrigin) * beamScale : 0);
      const refShift = shiftAt(viewCfg.referenceSlot ?? 0);
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uCover: { value: cover },
          uRef: { value: reference },
          uLowRef: { value: lowRef },
          uLowA: { value: first },
          uLowB: { value: first },
          uMix: { value: 0 },
          uIndirectOff: { value: indirectOff || BLANK },
          uIndirectOn: { value: indirectOn || BLANK },
          uIndirectGain: { value: 0 },
          uIndirectSigned: { value: params.has("lampsigned")
            ? Math.max(0, Math.min(1, Number(params.get("lampsigned")) || 0))
            : (indirectCfg?.blendMode === "signed-delta" ? 1 : 0) },
          uPlinthMask: { value: plinthMask || BLANK },
          uSubjectNightLift: { value: params.has("catlift")
            ? Math.max(0, Number(params.get("catlift")) || 0)
            : Math.max(0, Number(indirectCfg?.subjectLift ?? 0)) },
          uPlinthNightLift: { value: params.has("plinthlift")
            ? Math.max(0, Number(params.get("plinthlift")) || 0)
            : Math.max(0, Number(indirectCfg?.plinthLift ?? 0)) },
          uDepth: { value: depthTex },
          uRelief: { value: new THREE.Vector2(0, 0) },
          uPivot: { value: depthCfg.pivot ?? 0.5 },
          // never leave a sampler unbound: uHasRelief already zeroes the term, but some
          // drivers fault on sampling a null texture rather than returning black
          uShadowRelief: { value: reliefTex || BLANK },
          uShiftA: { value: new THREE.Vector2(0, 0) },
          uShiftB: { value: new THREE.Vector2(0, 0) },
          uShiftRef: { value: new THREE.Vector2(refShift, 0) },
          uHasRelief: { value: reliefTex ? 1 : 0 },
          uCurA: { value: BLANK },
          uCurB: { value: BLANK },
          uCurLight: { value: BLANK },
          uCurSubject: { value: subjTex || BLANK },
          uCurMix: { value: 0 },
          uCurtain: { value: new THREE.Vector4(0, 0.06, 1, 0) },
          uOvA: { value: BLANK },
          uOvB: { value: BLANK },
          uOvMix: { value: 0 },
          uOvOfs: { value: new THREE.Vector2(0, 0) },
          uOvGain: { value: 0 },
          uOvRange: { value: new THREE.Vector2(1, 1) },
        },
        vertexShader: depthTex ? VERT_LIVE_DEPTH : VERT_LIVE_LAYER,
        fragmentShader: FRAG_FULLDAY,
        depthTest: false,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      mesh.renderOrder = 0;
      scene.add(mesh);
      backMesh = frontMesh = mesh;
      if (curVideo && curLight && curRest) {
        mat.uniforms.uCurLight.value = curLight;
        mat.uniforms.uCurA.value = curRest;
        mat.uniforms.uCurB.value = curRest;
        mat.uniforms.uCurMix.value = 0;
        mat.uniforms.uCurtain.value.set(
          curMeta.x1, curMeta.feather, curMeta.stripWidth,
          params.has("cur") ? parseFloat(params.get("cur")) : 1);
        curVideo.bindVideo = () => {
          mat.uniforms.uCurA.value = curVideo.tex;
          mat.uniforms.uCurB.value = curVideo.tex;
        };
        curVideo.bindRest = () => {
          mat.uniforms.uCurA.value = curRest;
          mat.uniforms.uCurB.value = curRest;
        };
      }

      // ── environment overlay ────────────────────────────────────────────────────────
      // Its clock is deliberately NOT the day's. The element repeats on its own period,
      // and `?ovsec=` freezes it the way ?tod= freezes the hour.
      const ovCfg = viewCfg.overlay || null;
      const AHEAD_INIT = 12;
      let ovHaveA = -1, ovHaveB = -1;
      let ovMeta = null, ovTex = null, ovVideo = null, ovBase = "";
      let ovDecodeActive = false;
      if (ovCfg) {
        ovBase = `./assets/overlay_${ovCfg.id}/`;
        ovMeta = await loadJsonOpt(ovBase + "meta.json");
        if (ovMeta) {
          // The overlay runs at frames/periodSec — 4.2fps on the branch clip, one texture
          // every 240ms. Fetching each frame at the moment it is needed means a miss shows
          // the PREVIOUS frame while the blend has already reset to 0, and that hitch every
          // 240ms is what reads as juddering. So: keep resolved textures in `ready`, run a
          // prefetch window ahead of the playhead, and hold the last good pair until both
          // wanted frames have actually arrived. Bounded, because 192 decoded frames at
          // 540x960 RGBA would be ~400MB of GPU memory.
          const pending = new Map(), ready = new Map(), order = [];
          let generation = 0;
          const KEEP = 20, AHEAD = 8;
          const wrap = (i) => ((i % ovMeta.frames) + ovMeta.frames) % ovMeta.frames;
          const want = (i) => {
            const k = wrap(i);
            if (ready.has(k) || pending.has(k)) return;
            const requestGeneration = generation;
            pending.set(k, loadTexture(url(ovMeta.pattern, k, ovBase)).then(prep).then((t) => {
              pending.delete(k);
              if (requestGeneration !== generation) {
                t.dispose?.();
                return;
              }
              ready.set(k, t);
              order.push(k);
              while (order.length > KEEP) {
                const drop = order.shift();
                if (drop !== ovHaveA && drop !== ovHaveB) {
                  ready.get(drop)?.dispose?.();
                  ready.delete(drop);
                }
              }
            }).catch(() => pending.delete(k)));
          };
          const clear = () => {
            generation += 1;
            pending.clear();
            for (const t of ready.values()) t.dispose?.();
            ready.clear();
            order.length = 0;
            ovHaveA = ovHaveB = -1;
          };
          ovTex = { want, ready, wrap, clear, AHEAD };
          mat.uniforms.uOvRange.value.set(ovMeta.range[0], ovMeta.range[1]);
          const sunrise = Number(viewCfg.sun?.sunrise);
          const sunset = Number(viewCfg.sun?.sunset);
          const initialHour = dayFraction() * 24;
          const hasSolarWindow = Number.isFinite(sunrise)
            && Number.isFinite(sunset) && sunset > sunrise;
          ovDecodeActive = !ovMeta.sunlit || !hasSolarWindow
            || (initialHour > sunrise && initialHour < sunset);
          if (ovDecodeActive && (!ovMeta.video || params.has("ovsec"))) {
            for (let i = 0; i < AHEAD_INIT; i++) ovTex.want(i);
            await new Promise((r) => {
              const t0 = performance.now();
              const poll = () => (ovTex.ready.has(0) || performance.now() - t0 > 4000)
                ? r() : setTimeout(poll, 30);
              poll();
            });
          }
          const first = ovTex.ready.get(0) || BLANK;
          mat.uniforms.uOvA.value = first;
          mat.uniforms.uOvB.value = first;
          if (ovMeta.video && !params.has("ovsec")) {
            const el = document.createElement("video");
            el.muted = true;
            el.loop = true;
            el.playsInline = true;
            el.preload = "auto";
            el.setAttribute("muted", "");
            el.setAttribute("playsinline", "");
            const videoReady = new Promise((resolve) => {
              const done = (ok) => {
                el.removeEventListener("loadeddata", onReady);
                el.removeEventListener("error", onError);
                resolve(ok);
              };
              const onReady = () => done(true);
              const onError = () => done(false);
              el.addEventListener("loadeddata", onReady, { once: true });
              el.addEventListener("error", onError, { once: true });
              setTimeout(() => done(el.readyState >= 2), 3500);
            });
            el.src = url(ovMeta.video, null, ovBase);
            el.load();
            if (await videoReady) {
              const tex = new THREE.VideoTexture(el);
              tex.minFilter = tex.magFilter = THREE.LinearFilter;
              tex.generateMipmaps = false;
              tex.flipY = true;
              tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
              ovVideo = { el, tex, ready: false };
              ovVideo.play = () => {
                if (!wallpaperActive || !el.paused) return;
                if (typeof el.requestVideoFrameCallback === "function") {
                  el.requestVideoFrameCallback(() => {
                    ovVideo.ready = true;
                    mat.uniforms.uOvA.value = tex;
                    mat.uniforms.uOvB.value = tex;
                  });
                } else {
                  setTimeout(() => {
                    if (!el.paused) {
                      ovVideo.ready = true;
                      mat.uniforms.uOvA.value = tex;
                      mat.uniforms.uOvB.value = tex;
                    }
                  }, 80);
                }
                el.play().catch(() => {});
              };
              ovVideo.stop = () => {
                el.pause();
                try { el.currentTime = 0; } catch {}
                ovVideo.ready = false;
                mat.uniforms.uOvA.value = BLANK;
                mat.uniforms.uOvB.value = BLANK;
              };
              ovTex.clear();
              ovDecodeActive = false;
            } else {
              el.removeAttribute("src");
              el.load();
            }
          }
        }
      }
      // A sunlit element (a branch shadow) must not exist when there is no sun to cast it,
      // or the wall grows leaves at midnight. Gate it from the scene's actual sunrise and
      // sunset. beamShift describes where a beam lands; it is not a sun-presence signal
      // and can remain non-zero in dark slots.
      const beamSpan = beamShift
        ? Math.max(...beamShift.map(Math.abs)) || 1 : 1;
      const sunStrength = (frac) => {
        const sunrise = Number(viewCfg.sun?.sunrise);
        const sunset = Number(viewCfg.sun?.sunset);
        if (!Number.isFinite(sunrise) || !Number.isFinite(sunset) || sunset <= sunrise) {
          return null;
        }
        const hour = (((frac % 1) + 1) % 1) * 24;
        if (hour <= sunrise || hour >= sunset) return 0;
        return Math.sin(Math.PI * (hour - sunrise) / (sunset - sunrise));
      };
      const ovStrength = (slotPos, frac) => {
        if (!ovMeta) return 0;
        const g = ovCfg.gain ?? 1;
        if (!ovMeta.sunlit) return g;
        const solar = sunStrength(frac);
        if (solar != null) return g * solar;
        if (!beamShift) return 0;
        const i = ((Math.round(slotPos) % slots) + slots) % slots;
        return g * Math.min(1, Math.abs(beamShift[i] || 0) / beamSpan);
      };
      const ovPeriod = ovCfg?.periodSec ?? 40;
      const ovPhase = ovCfg?.phaseSec ?? 0;
      const ovFrozen = params.has("ovsec") ? parseFloat(params.get("ovsec")) : null;

      // Hidden warm room light: it comes up during dusk, stays on through the night,
      // and yields to daylight after sunrise. `?lamp=0..1` is a QA override so the same
      // fixed hour can be compared without waiting or rebuilding the scene.
      const lampOverride = params.has("lamp") ? parseFloat(params.get("lamp")) : null;
      const smooth01 = (x) => {
        x = Math.max(0, Math.min(1, x));
        return x * x * (3 - 2 * x);
      };
      const indirectStrength = (frac) => {
        if (!indirectOff || !indirectOn || !indirectCfg) return 0;
        const maxGain = Math.max(0, Number(indirectCfg.gain ?? 0.65));
        if (Number.isFinite(lampOverride)) {
          return maxGain * Math.max(0, Math.min(1, lampOverride));
        }
        const hour = (((frac % 1) + 1) % 1) * 24;
        const eveningStart = Number(indirectCfg.eveningStart ?? 18.5);
        const eveningFull = Number(indirectCfg.eveningFull ?? 20.0);
        const morningFade = Number(indirectCfg.morningFade ?? 5.0);
        const morningOff = Number(indirectCfg.morningOff ?? 6.5);
        if (hour >= eveningFull || hour < morningFade) return maxGain;
        if (hour >= eveningStart) {
          return maxGain * smooth01((hour - eveningStart) /
            Math.max(0.01, eveningFull - eveningStart));
        }
        if (hour < morningOff) {
          return maxGain * (1 - smooth01((hour - morningFade) /
            Math.max(0.01, morningOff - morningFade)));
        }
        return 0;
      };

      let haveA = -1, haveB = -1;
      // timeToSlot maps real hours onto the clip's own light curve (built by anchoring the
      // clip's darkest/brightest frames to midnight and solar noon, and its half-brightness
      // crossings to sunrise and sunset). Without it the clip plays as a colour wheel and
      // the afternoon is already dark. Stored unwrapped so this can interpolate across the
      // loop without a jump.
      const table = Array.isArray(viewCfg.timeToSlot) ? viewCfg.timeToSlot : null;
      const clipPos = (frac) => {
        if (!table) return frac * slots;
        const x = frac * (table.length - 1);
        const i = Math.min(table.length - 2, Math.floor(x));
        return table[i] + (table[i + 1] - table[i]) * (x - i);
      };
      const sync = () => {
        const nowMs = performance.now();
        const dtSec = curLast ? Math.min(0.1, (nowMs - curLast) / 1000) : 0;
        curLast = nowMs;
        const frac = dayFraction();
        const pos = clipPos(frac);
        const i0 = Math.floor(pos) % slots;
        const i1 = (i0 + 1) % slots;
        mat.uniforms.uMix.value = pos - Math.floor(pos);
        mat.uniforms.uIndirectGain.value = indirectStrength(frac);
        if (curMeta) {
          const secs = params.has("cursec")
            ? parseFloat(params.get("cursec")) : performance.now() / 1000;
          // Held at the rest pose most of the time and released occasionally: a wallpaper
          // wants "the air moved just then", not a curtain running on a treadmill. The two
          // periods share no common multiple, so the gusts never land on a countable beat.
          const per = curtainCfg.periodSec ?? 47;
          const per2 = curtainCfg.period2Sec ?? 73;
          const gust = Math.max(0, Math.sin(secs / per * 6.283)) ** 3 * 0.7
                     + Math.max(0, Math.sin(secs / per2 * 6.283 + 2.1)) ** 3 * 0.5;
          const wakeAge = (nowMs - curtainWakeGustStartedAt) / 1000;
          const wakeRemaining = (curtainWakeGustEndsAt - nowMs) / 1000;
          const wakeRise = smooth01(wakeAge / 0.65);
          const wakeFall = smooth01(wakeRemaining / 1.8);
          const wakeGust = wakeAge >= 0 && wakeRemaining > 0
            ? 0.85 * wakeRise * wakeFall : 0;
          const naturalActive = Math.min(1, gust / 0.7);
          const active = Math.max(naturalActive, wakeGust);
          if (curVideo) {
            const naturalNow = naturalActive > 0.18;
            if (naturalNow && !curVideo.naturalWasActive) curVideo.play(false);
            curVideo.naturalWasActive = naturalNow;
            if (curVideo.lastWakeSerial !== curtainWakeGustSerial) {
              curVideo.lastWakeSerial = curtainWakeGustSerial;
              curVideo.play(true);
            }
          } else if (curTex) {
            // Fallback walks through individual WebPs only when packed-video decoding is
            // unavailable. The Android wallpaper uses the continuous hardware path above.
            curPhase += (dtSec * (curMeta.sourceFps || 12) * active);
            const span = curMeta.frames - 1;
            const pos = curMeta.restIndex + (curPhase % span) * active;
            const j0 = Math.max(0, Math.min(span, Math.floor(pos)));
            const j1 = Math.min(span, j0 + 1);
            for (let k = 0; k <= 6; k++) curTex.want(j0 + k);
            curTex.want(curMeta.restIndex);
            if (curTex.ready.has(j0) && curTex.ready.has(j1) && curLight) {
              // without this the divisor stays BLANK — black — and the ratio clamps to 4,
              // blowing the whole strip to white
              mat.uniforms.uCurLight.value = curLight;
              if (subjTex) mat.uniforms.uCurSubject.value = subjTex;
              mat.uniforms.uCurA.value = curTex.ready.get(j0);
              mat.uniforms.uCurB.value = curTex.ready.get(j1);
              mat.uniforms.uCurMix.value = pos - Math.floor(pos);
              mat.uniforms.uCurtain.value.set(
                curMeta.x1, curMeta.feather, curMeta.stripWidth,
                params.has("cur") ? parseFloat(params.get("cur")) : 1);
            }
          }
        }
        mat.uniforms.uShiftA.value.x = shiftAt(i0);
        mat.uniforms.uShiftB.value.x = shiftAt(i1);
        if (ovMeta) {
          const secs = ovFrozen ?? (performance.now() / 1000);
          const f = ((secs + ovPhase) / ovPeriod) * ovMeta.frames;
          const j0 = ovTex.wrap(Math.floor(f));
          const j1 = ovTex.wrap(j0 + 1);
          const strength = ovStrength(pos, frac);
          if (strength > 0) {
            ovDecodeActive = true;
            if (ovVideo) {
              ovVideo.play();
              mat.uniforms.uOvGain.value = ovVideo.ready ? strength : 0;
              mat.uniforms.uOvMix.value = 0;
            } else {
              for (let k = 0; k <= ovTex.AHEAD; k++) ovTex.want(j0 + k);
              // BLANK is black, and black decodes to the range MINIMUM (0.35), not to the
              // neutral 1.0 — so applying gain before the first frame exists dims the whole
              // room to near-nothing. Gain stays zero until a real pair is bound.
              const ovLive = ovTex.ready.has(j0) && ovTex.ready.has(j1);
              mat.uniforms.uOvGain.value = ovLive ? strength : 0;
            }
            // The flutter loop is ~20s and that is still short enough to recognise. A branch
            // also sways on a much longer beat than its leaves flutter, so drift the whole
            // pattern on two slow periods that share no common multiple with the loop — the
            // combination then does not repeat within any session, while each part stays
            // physically plausible on its own.
            const dp = (ovCfg.driftPx ?? 26) / 1080;
            mat.uniforms.uOvOfs.value.set(
              dp * Math.sin(secs / (ovCfg.driftSec ?? 97)),
              dp * 0.45 * Math.sin(secs / (ovCfg.driftSec2 ?? 149) + 1.1));
            // advance only when BOTH ends of the blend are decoded; otherwise hold the pair
            // we are already showing, which stalls rather than stutters
            if (!ovVideo && ovTex.ready.has(j0) && ovTex.ready.has(j1)) {
              ovHaveA = j0; ovHaveB = j1;
              mat.uniforms.uOvA.value = ovTex.ready.get(j0);
              mat.uniforms.uOvB.value = ovTex.ready.get(j1);
              mat.uniforms.uOvMix.value = f - Math.floor(f);
            }
          } else {
            mat.uniforms.uOvGain.value = 0;
            if (ovDecodeActive) {
              ovDecodeActive = false;
              if (ovVideo) ovVideo.stop();
              else ovTex.clear();
              mat.uniforms.uOvA.value = BLANK;
              mat.uniforms.uOvB.value = BLANK;
              mat.uniforms.uOvMix.value = 0;
            }
          }
        }
        if (i0 !== haveA) {
          haveA = i0;
          lightTex(i0).then((t) => { if (haveA === i0) mat.uniforms.uLowA.value = t; });
        }
        if (i1 !== haveB) {
          haveB = i1;
          lightTex(i1).then((t) => { if (haveB === i1) mat.uniforms.uLowB.value = t; });
        }
      };

      // let a host page scrub the clock: the parent posts {type:"tod", value} with a 0..1
      // fraction (or null to hand the scene back to the real clock). Driving it this way
      // instead of reloading the iframe keeps the WebGL context and the loaded textures.
      const setTod = (v) => {
        frozen = v == null || !Number.isFinite(v) ? null : ((v % 1) + 1) % 1;
        sync();
      };
      window.__setTod = setTod;
      window.addEventListener("message", (e) => {
        if (e.data && e.data.type === "tod") setTod(e.data.value);
      });

      sync();
      fullDay.active = true;
      fullDay.mesh = mesh;
      fullDay.hasDepth = !!depthTex;
      fullDay.basePx = Number(depthCfg.basePx ?? viewCfg.panPx) || 0;
      fullDay.reliefPx = Number(depthCfg.reliefPx) || 0;
      fullDay.sync = sync;
      fullDay.pause = () => {
        curVideo?.stop?.();
        ovVideo?.stop?.();
      };
      fullDay.resume = () => {};

      resize();
      state.ready = true;
      startPassiveMotion();
      startRenderLoop();
      return;
    }

    if (viewCfg?.renderMode === "layered-live") {
      const L = viewCfg.layers || {};
      const cloudCfg = viewCfg.cloud || {};
      const lightCfg = viewCfg.light || {};
      const [sky, cloudFar, cloudNear, architecture, lightMask, contactShadow, hero, heroDepth, archDepth, coverage, noise] =
        await Promise.all([L.sky, L.cloudFar, L.cloudNear, L.architecture, L.lightMask,
                           L.contactShadow, L.hero, L.heroDepth, L.archDepth, L.coverage, L.noise]
          .map((f) => loadTexture(P3D + f + AV)));
      for (const t of [sky, cloudFar, cloudNear, architecture, lightMask, contactShadow, hero, heroDepth, archDepth, coverage, noise]) {
        t.minFilter = t.magFilter = THREE.LinearFilter;
        t.generateMipmaps = false;
        t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      }
      // the strips are the whole point of the format: they must wrap in x
      for (const t of [cloudFar, cloudNear]) t.wrapS = THREE.RepeatWrapping;
      noise.wrapS = noise.wrapT = THREE.RepeatWrapping;

      const tiles = cloudCfg.tiles ?? 2;
      // ?cspd= multiplies cloud speed: a full strip wrap takes ~20 min at 1x, so QA and
      // taste checks need to fast-forward it
      const cspd = params.has("cspd") ? parseFloat(params.get("cspd")) : 1;
      const nearSpeed = (cloudCfg.nearSpeed ?? 0.00085) * cspd;
      const farSpeed = (cloudCfg.farSpeed ?? 0.00034) * cspd;
      const band = cloudCfg.band ?? [0.25, 0.65];
      const depthCfg = viewCfg.depth || {};
      const timed = () => ({
        uTime: { value: 0 },
        uNearSpeed: { value: nearSpeed },
        uCoverage: { value: coverage },
      });
      // shared by every solid layer; the loop writes uRelief once per frame
      const depthUniforms = (tex) => ({
        uDepth: { value: tex },
        uRelief: { value: new THREE.Vector2(0, 0) },
        uPivot: { value: depthCfg.pivot ?? 0.5 },
      });
      const skyMat = new THREE.ShaderMaterial({
        uniforms: {
          uCover: { value: cover }, ...timed(),
          uSky: { value: sky }, uCloudFar: { value: cloudFar }, uCloudNear: { value: cloudNear },
          uTiles: { value: tiles }, uFarSpeed: { value: farSpeed },
          uFarOpacity: { value: cloudCfg.farOpacity ?? 0.85 },
          uSkyDim: { value: lightCfg.skyDim ?? 0.035 },
          uNoise: { value: noise },
          uWarp: { value: cloudCfg.warp ?? 0.006 },
          uWarpSpeed: { value: (cloudCfg.warpSpeed ?? 0.011) * cspd },
          uBreathe: { value: cloudCfg.breathe ?? 0.35 },
          uBand: { value: new THREE.Vector2(band[0], band[1]) },
        },
        vertexShader: VERT_LIVE_LAYER, fragmentShader: FRAG_LIVE_SKY,
        defines: params.has("dbg") ? { DBG_CLOUD: 1 } : {},
        depthTest: false, depthWrite: false,
      });
      const architectureMat = new THREE.ShaderMaterial({
        uniforms: {
          uCover: { value: cover }, ...timed(),
          ...depthUniforms(archDepth),
          uColor: { value: architecture }, uLightMask: { value: lightMask },
          // ?li= / ?rd= / ?sf= isolate the three coverage-driven terms while tuning
          uLightIntensity: { value: params.has("li") ? parseFloat(params.get("li")) : (lightCfg.intensity ?? 0.075) },
          uRimDim: { value: params.has("rd") ? parseFloat(params.get("rd")) : (lightCfg.rimDim ?? 0.075) },
          uWarm: { value: new THREE.Vector3(...(lightCfg.warm ?? [1.0, 0.91, 0.78])) },
        },
        vertexShader: VERT_LIVE_DEPTH, fragmentShader: FRAG_LIVE_ARCHITECTURE,
        transparent: true, depthTest: false, depthWrite: false,
      });
      const shadowMat = new THREE.ShaderMaterial({
        uniforms: {
          uCover: { value: cover }, ...timed(),
          ...depthUniforms(archDepth),
          uColor: { value: contactShadow },
          uShadowFade: { value: params.has("sf") ? parseFloat(params.get("sf")) : (lightCfg.shadowFade ?? 0.3) },
        },
        vertexShader: VERT_LIVE_DEPTH, fragmentShader: FRAG_LIVE_SHADOW,
        transparent: true, depthTest: false, depthWrite: false,
      });
      const heroMat = new THREE.ShaderMaterial({
        uniforms: {
          uCover: { value: cover }, ...timed(),
          ...depthUniforms(heroDepth),
          uColor: { value: hero },
        },
        vertexShader: VERT_LIVE_DEPTH, fragmentShader: FRAG_LIVE_HERO,
        transparent: true, depthTest: false, depthWrite: false,
      });

      const makeLayer = (material, order) => {
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
        mesh.renderOrder = order;
        scene.add(mesh);
        return mesh;
      };
      liveLayerScene.active = true;
      liveLayerScene.config = viewCfg;
      liveLayerScene.materials = { sky: skyMat, architecture: architectureMat, shadow: shadowMat, hero: heroMat };
      liveLayerScene.meshes = {
        sky: makeLayer(skyMat, 0),
        architecture: makeLayer(architectureMat, 1),
        shadow: makeLayer(shadowMat, 2),
        hero: makeLayer(heroMat, 3),
      };
      backMesh = liveLayerScene.meshes.sky;
      frontMesh = liveLayerScene.meshes.architecture;
      subjectMesh = liveLayerScene.meshes.hero;

      resize();
      state.ready = true;
      startPassiveMotion();
      startRenderLoop();
      return;
    }

    const [fgColor, fgDepth, bgColor, bgDepth] = await Promise.all([
      loadPlate(ASSETS.fgColor),
      loadTexture(ASSETS.fgDepth),
      loadPlate(ASSETS.bgColor),
      loadTexture(ASSETS.bgDepth),
    ]);

    // textures are passed through unchanged (ShaderMaterial does no colour-space
    // conversion), so keep them raw — decoding to linear without re-encoding darkens.
    const tw = fgDepth.image?.width || 864;
    const th = fgDepth.image?.height || 1536;
    const texel = new THREE.Vector2(1.6 / tw, 1.6 / th);
    if (fgColor.image?.width) IMG_ASPECT = fgColor.image.width / fgColor.image.height;

    // protect.png (v2) vs subject.png (v3 soft-LDI). If subject is present we run
    // the 3-layer path: a dedicated soft-matte subject layer on top.
    const [protect, subject, subjectDepth] = await Promise.all([
      loadOpt(P3D + "protect.png" + AV),
      loadOpt(P3D + "subject.png" + AV),
      loadOpt(P3D + "subject_depth.png" + AV),
    ]);
    const useSubject = subject !== null;

    // Coherent single-depth path: the original plate supplies the only scene
    // coordinate system.  bg_depth is merely the scale-calibrated inpaint of the
    // cat hole, while the subject keeps the original model's face/body relief.
    if (viewCfg?.renderMode === "coherent-depth" && useSubject) {
      const subjectBaseDepth = Number.isFinite(viewCfg.subjectBaseDepth)
        ? viewCfg.subjectBaseDepth
        : SUBJECT_BASE_DEPTH;
      const depthUniforms = (depthTex, zBias = 0.0) => ({
        uDepth: { value: depthTex },
        uDepthScale: { value: tune.depthScale },
        uFarScale: { value: tune.farScale },
        uFocus: { value: tune.focus },
        uCamZ: { value: VIEW.camZ },
        uZBias: { value: zBias },
        uCover: { value: cover },
      });

      backMat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: bgColor },
          ...depthUniforms(bgDepth),
        },
        vertexShader: VERT_COHERENT_BG,
        fragmentShader: FRAG_BACK,
      });
      subjectMat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: fgColor },
          uSubject: { value: subject },
          uSubjectBaseDepth: { value: subjectBaseDepth },
          ...depthUniforms(fgDepth, 0.002),
        },
        vertexShader: VERT_COHERENT_SUBJECT,
        fragmentShader: FRAG_SUBJECT,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      });

      backMesh = new THREE.Mesh(new THREE.BufferGeometry(), backMat);
      subjectMesh = new THREE.Mesh(new THREE.BufferGeometry(), subjectMat);
      backMesh.renderOrder = 0;
      subjectMesh.renderOrder = 2;
      scene.add(backMesh, subjectMesh);

      resize();
      state.ready = true;
      startPassiveMotion();
      startRenderLoop();
      return;
    }

    // Premium studio portraits are cleaner and more convincing as a safe layered
    // photo than as a cliff-cut full-frame depth mesh.  The empty background plate
    // provides real reveal pixels, and the subject's internal depth adds only a
    // restrained facial/body relief without ever cutting the image.
    if (viewCfg?.renderMode === "safe-layers" && useSubject) {
      const subjectZ = Number.isFinite(viewCfg.subjectZ) ? viewCfg.subjectZ : 1.0;
      const subjectRelief = Number.isFinite(viewCfg.subjectRelief) ? viewCfg.subjectRelief : 1.15;
      const subjectBaseDepth = Number.isFinite(viewCfg._subjectDepth)
        ? viewCfg._subjectDepth
        : SUBJECT_BASE_DEPTH;
      const subjectScale = Math.max(0.72, (VIEW.camZ - subjectZ) / VIEW.camZ);

      backMat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: bgColor },
          uCover: { value: cover },
          uLayerZ: { value: 0.0 },
          uLayerScale: { value: 1.0 },
        },
        vertexShader: VERT_RIGID_LAYER,
        fragmentShader: FRAG_BACK,
      });
      subjectMat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: fgColor },
          uDepth: { value: fgDepth },
          uSubject: { value: subject },
          uCover: { value: cover },
          uLayerZ: { value: subjectZ },
          uLayerScale: { value: subjectScale },
          uSubjectBaseDepth: { value: subjectBaseDepth },
          uSubjectRelief: { value: subjectRelief },
        },
        vertexShader: VERT_SAFE_SUBJECT,
        fragmentShader: FRAG_SUBJECT,
        transparent: true,
        depthWrite: false,
      });

      backMesh = new THREE.Mesh(new THREE.BufferGeometry(), backMat);
      subjectMesh = new THREE.Mesh(new THREE.BufferGeometry(), subjectMat);
      backMesh.renderOrder = 0;
      subjectMesh.renderOrder = 2;
      scene.add(backMesh, subjectMesh);

      resize();
      state.ready = true;
      startPassiveMotion();
      startRenderLoop();
      return;
    }

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
              // subject_depth.png (when the build emits one) is the subject's OWN depth
              // field: full sculpted relief, and extended past the silhouette so the
              // matte's soft edge is displaced by the subject's depth instead of the
              // background 1px outside it. That makes the relief mask unnecessary —
              // it would only damp exactly the volume we want — so strength drops to 0.
              ...reliefUniforms(subject, subjectDepth ? 0.0 : 0.85),
              ...(subjectDepth ? { uDepth: { value: subjectDepth } } : null),
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
    startRenderLoop();
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

function startRenderLoop() {
  if (wallpaperActive && state.ready && curtainWakeGustPending) {
    triggerCurtainWakeGust();
  }
  renderer.setAnimationLoop(wallpaperActive ? loop : null);
}

function triggerCurtainWakeGust() {
  if (!wallpaperActive || !state.ready) {
    curtainWakeGustPending = true;
    return;
  }
  curtainWakeGustPending = false;
  const now = performance.now();
  if (now >= curtainWakeGustEndsAt) curtainWakeGustStartedAt = now;
  curtainWakeGustSerial += 1;
  // A second event (unlock shortly after screen-on) extends the same gust instead of
  // snapping the curtain back to its rest frame and starting over.
  curtainWakeGustEndsAt = now + CURTAIN_WAKE_GUST_MS;
}

window.__triggerCurtainGust = function () {
  if (!wallpaperMode) return;
  triggerCurtainWakeGust();
};

// Native wallpaper visibility bridge. Visible rendering keeps the exact same DPR,
// antialiasing and 30fps target; only a wallpaper hidden behind another app is stopped.
window.__setWallpaperActive = function (active) {
  if (!wallpaperMode) return;
  const next = Boolean(active);
  if (next === wallpaperActive) return;
  wallpaperActive = next;
  if (next) {
    lastFrame = performance.now();
    lastRenderAt = 0;
    fullDay.resume?.();
    startRenderLoop();
  } else {
    fullDay.pause?.();
    renderer.setAnimationLoop(null);
  }
};

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

  if (fullDay.active) {
    camera.position.set(0, 0, VIEW.camZ);
    camera.lookAt(0, 0, 0);
    // the frame only changes every 7.5 minutes, so a check every few seconds is already
    // far more often than it can matter
    fullDay.sync();
    // travel = base + relief * (depth - pivot): the wall sits still and the podium and the
    // subject, being nearer, travel further. With no depth map it degrades to a flat pan.
    fullDay.mesh.position.x = ox * fullDay.basePx * liveLayerScene.worldPerPixel.x;
    fullDay.mesh.position.y = oy * fullDay.basePx * liveLayerScene.worldPerPixel.y;
    if (fullDay.hasDepth) {
      fullDay.mesh.material.uniforms.uRelief.value.set(
        ox * fullDay.reliefPx * liveLayerScene.worldPerPixel.x,
        oy * fullDay.reliefPx * liveLayerScene.worldPerPixel.y,
      );
    }
    tickAnim(now, dt);
    renderer.render(scene, camera);
    return;
  }

  if (liveLayerScene.active) {
    camera.position.set(0, 0, VIEW.camZ);
    camera.lookAt(0, 0, 0);
    const amounts = liveLayerScene.config?.parallaxPx || {};
    const move = (mesh, pixels) => {
      if (!mesh) return;
      mesh.position.x = ox * pixels * liveLayerScene.worldPerPixel.x;
      mesh.position.y = oy * pixels * liveLayerScene.worldPerPixel.y;
    };
    move(liveLayerScene.meshes.sky, amounts.sky ?? 1.5);
    move(liveLayerScene.meshes.architecture, amounts.architecture ?? 4.0);
    move(liveLayerScene.meshes.shadow, amounts.shadow ?? 4.5);
    move(liveLayerScene.meshes.hero, amounts.hero ?? 4.5);
    // ?tsec= freezes scene time. Headless virtual-time does not advance rAF timestamps
    // proportionally, so cloud/light QA needs an exact clock it can address.
    const liveSeconds = params.has("tsec")
      ? parseFloat(params.get("tsec"))
      : (now - state.startTime) / 1000;
    for (const m of Object.values(liveLayerScene.materials)) m.uniforms.uTime.value = liveSeconds;
    // extra travel ON TOP of the hero layer's own, proportional to the cat's depth: the
    // nose and the rump then move by different amounts, which is what makes it a volume
    const reliefPx = liveLayerScene.config?.depth?.reliefPx ?? 20.0;
    for (const k of ["architecture", "shadow", "hero"]) {
      liveLayerScene.materials[k].uniforms.uRelief.value.set(
        ox * reliefPx * liveLayerScene.worldPerPixel.x,
        oy * reliefPx * liveLayerScene.worldPerPixel.y,
      );
    }
  } else {
    camera.position.x = ox * tune.orbit;
    camera.position.y = oy * tune.orbit * VIEW.orbitYScale;
    camera.lookAt(0, 0, 0);
  }
  tickAnim(now, dt);
  renderer.render(scene, camera);
}

/* ---------- idle-flick animation ---------- */
// Holds the foreground plate on a rest frame, then every ~10s (jittered) plays a
// short clip once — a living "twitch" — by swapping the front + subject layer
// colour through the deduped frame textures, then returns to the hold frame.
// Two kinds: "plate" (cherry2dio) swaps the whole foreground plate colour; "sprite3d"
// (nila2dio) swaps a per-frame cat colour+depth sprite over the static scene, and
// picks a random clip each play. Both hold a rest frame and play on a jittered timer.
const anim = {
  enabled: false,
  kind: "plate",
  fps: 8,
  hold: 0,
  textures: [], // plate
  timeline: [],
  clips: {}, // sprite3d: name -> { color:[], depth:[], timeline:[] }
  clipNames: [],
  spriteMat: null,
  videos: {}, // video3d: name -> { el, tex }
  videoMat: null,
  curName: null,
  curClip: null,
  curTimeline: [],
  playing: false,
  slot: 0,
  slotTime: 0,
  nextPlayAt: 0,
};
let ANIM_BASE = 10000; // ms between plays
let ANIM_JITTER = 4000; // ± randomness so it never feels mechanical
const pad2 = (i) => String(i).padStart(2, "0");

function setPlateFrame(idx) {
  const tex = anim.textures[idx];
  if (!tex) return;
  if (frontMat) frontMat.uniforms.uColor.value = tex;
  if (subjectMat) subjectMat.uniforms.uColor.value = tex;
}
function setSpriteFrame(clip, idx) {
  if (!anim.spriteMat || !clip) return;
  anim.spriteMat.uniforms.uColorSprite.value = clip.color[idx];
  anim.spriteMat.uniforms.uDepthSprite.value = clip.depth[idx];
}
function applySlot(slot) {
  if (anim.kind === "sprite3d") setSpriteFrame(anim.curClip, anim.curTimeline[slot]);
  else setPlateFrame(anim.timeline[slot]);
}

function scheduleNextPlay(now) {
  anim.nextPlayAt = now + ANIM_BASE + (Math.random() * 2 - 1) * ANIM_JITTER;
}

function setupSprite3D(rect) {
  anim.spriteMat = new THREE.ShaderMaterial({
    uniforms: {
      uColorSprite: { value: BLANK },
      uDepthSprite: { value: BLANK },
      uRect: { value: new THREE.Vector4(rect[0], rect[1], rect[2], rect[3]) },
      uDepthScale: { value: tune.depthScale },
      uFarScale: { value: tune.farScale },
      uFocus: { value: tune.focus },
      uZBias: { value: 0.0 },
      uSubjectBaseDepth: { value: SUBJECT_BASE_DEPTH },
      uSubjectDepthContrast: { value: SUBJECT_DEPTH_CONTRAST },
      uCover: { value: cover },
    },
    vertexShader: VERT_SPRITE3D,
    fragmentShader: FRAG_SPRITE3D,
    transparent: true,
    depthWrite: false,
  });
  subjectMesh.material = anim.spriteMat; // resize() keeps its geometry current
}

/* ---- video3d: one packed mp4 per clip, decoded a frame at a time ---- */
function makeVideo(url) {
  const el = document.createElement("video");
  el.muted = true;
  el.loop = false;
  el.playsInline = true;
  el.preload = "auto";
  el.setAttribute("muted", "");
  el.setAttribute("playsinline", "");
  el.src = url;
  const tex = new THREE.VideoTexture(el);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.flipY = false; // packed frame is top-down: colour panel sits at v=0
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return { el, tex };
}

function setupVideo3D(rect) {
  anim.videoMat = new THREE.ShaderMaterial({
    uniforms: {
      uVideo: { value: null },
      uRect: { value: new THREE.Vector4(rect[0], rect[1], rect[2], rect[3]) },
      uDepthScale: { value: tune.depthScale },
      uFarScale: { value: tune.farScale },
      uFocus: { value: tune.focus },
      uZBias: { value: 0.0 },
      uSubjectBaseDepth: { value: SUBJECT_BASE_DEPTH },
      uSubjectDepthContrast: { value: SUBJECT_DEPTH_CONTRAST },
      uCover: { value: cover },
    },
    vertexShader: VERT_VIDEO3D,
    fragmentShader: FRAG_VIDEO3D,
    transparent: true,
    depthWrite: false,
  });
  subjectMesh.material = anim.videoMat;
}

function setVideo(name) {
  const v = anim.videos[name];
  if (!v || !anim.videoMat) return;
  anim.curName = name;
  anim.videoMat.uniforms.uVideo.value = v.tex;
}

async function initAnim() {
  try {
    const m = await loadJsonOpt(P3D + "anim/manifest.json" + AV);   // file:// safe
    if (!m) return;
    anim.kind = m.kind || "plate";
    anim.fps = m.fps || 8;
    anim.hold = m.hold || 0;
    const fast = () => { if (params.has("animfast")) { ANIM_BASE = 600; ANIM_JITTER = 200; } };

    if (anim.kind === "video3d") {
      if (!subjectMesh) return;
      for (const name of m.clips || []) {
        anim.videos[name] = makeVideo(P3D + `anim/${name}.mp4` + AV);
      }
      anim.clipNames = m.clips || [];
      if (!anim.clipNames.length) return;
      setupVideo3D(m.rect);
      // prime each decoder (muted autoplay), then hold on frame 0
      for (const name of anim.clipNames) {
        const el = anim.videos[name].el;
        try { await el.play(); el.pause(); el.currentTime = 0; } catch { /* autoplay */ }
      }
      const qaName = params.get("clip");
      const restName = qaName && anim.videos[qaName] ? qaName : anim.clipNames[0];
      setVideo(restName);
      const rv = anim.videos[restName];
      if (params.has("flick")) {
        rv.el.pause();
        rv.el.currentTime = (parseInt(params.get("flick")) || 0) / anim.fps;
        rv.tex.needsUpdate = true;
        return; // frozen for QA (loop still re-uploads the held frame)
      }
      fast();
      rv.el.pause();
      rv.el.currentTime = 0;
      anim.enabled = true;
      scheduleNextPlay(performance.now());
    } else if (anim.kind === "sprite3d") {
      if (!subjectMesh) return;
      const pad3 = (i) => String(i).padStart(3, "0");
      for (const [name, c] of Object.entries(m.clips || {})) {
        const color = await Promise.all(Array.from({ length: c.count }, (_, i) =>
          loadTexture(P3D + `anim/${name}_c${pad3(i)}.webp` + AV)));
        const depth = await Promise.all(Array.from({ length: c.count }, (_, i) =>
          loadTexture(P3D + `anim/${name}_d${pad3(i)}.png` + AV)));
        anim.clips[name] = { color, depth, timeline: c.frames };
      }
      anim.clipNames = Object.keys(anim.clips);
      if (!anim.clipNames.length) return;
      setupSprite3D(m.rect);
      // QA: ?clip=<name> selects which clip the hold/flick freeze uses
      const qaName = params.get("clip");
      const restName = qaName && anim.clips[qaName] ? qaName : anim.clipNames[0];
      const rest = anim.clips[restName];
      anim.curClip = rest;
      anim.curTimeline = rest.timeline;
      if (params.has("flick")) {
        const s = clamp(parseInt(params.get("flick")) || 0, 0, rest.timeline.length - 1);
        setSpriteFrame(rest, rest.timeline[s]);
        return; // frozen for QA
      }
      fast();
      setSpriteFrame(rest, rest.timeline[anim.hold]);
      anim.enabled = true;
      scheduleNextPlay(performance.now());
    } else {
      anim.timeline = m.frames || [];
      anim.textures = await Promise.all(Array.from({ length: m.count }, (_, i) =>
        loadTexture(P3D + `anim/u${pad2(i)}.jpg` + AV)));
      if (!anim.textures.length || !anim.timeline.length) return;
      if (params.has("flick")) {
        const s = clamp(parseInt(params.get("flick")) || 0, 0, anim.timeline.length - 1);
        setPlateFrame(anim.timeline[s]);
        return;
      }
      fast();
      setPlateFrame(anim.timeline[anim.hold]);
      anim.enabled = true;
      scheduleNextPlay(performance.now());
    }
  } catch {
    /* no animation for this scene */
  }
}

function tickAnim(now, dt) {
  // video3d plays the mp4 natively (perfect 24fps); JS only starts/ends a clip
  if (anim.kind === "video3d") {
    if (anim.videoMat && anim.curName) anim.videos[anim.curName].tex.needsUpdate = true;
    if (!anim.enabled) return;
    if (!anim.playing) {
      if (now >= anim.nextPlayAt) {
        const name = anim.clipNames[Math.floor(Math.random() * anim.clipNames.length)];
        setVideo(name);
        const el = anim.videos[name].el;
        el.currentTime = 0;
        el.play().catch(() => {});
        anim.playing = true;
      }
    } else {
      const el = anim.videos[anim.curName].el;
      if (el.ended || (el.duration && el.currentTime >= el.duration - 0.04)) {
        el.pause();
        anim.playing = false;
        scheduleNextPlay(now);
      }
    }
    return;
  }
  if (!anim.enabled) return;
  if (!anim.playing) {
    if (now >= anim.nextPlayAt) {
      if (anim.kind === "sprite3d") {
        const name = anim.clipNames[Math.floor(Math.random() * anim.clipNames.length)];
        anim.curClip = anim.clips[name];
        anim.curTimeline = anim.curClip.timeline;
      }
      anim.playing = true;
      anim.slot = 0;
      anim.slotTime = 0;
      applySlot(0);
    }
    return;
  }
  anim.slotTime += dt;
  const slotDur = 1 / anim.fps;
  const tl = anim.kind === "sprite3d" ? anim.curTimeline : anim.timeline;
  while (anim.slotTime >= slotDur) {
    anim.slotTime -= slotDur;
    anim.slot += 1;
    if (anim.slot >= tl.length) {
      anim.playing = false;
      if (anim.kind === "sprite3d") {
        const rest = anim.clips[anim.clipNames[0]];
        anim.curClip = rest;
        anim.curTimeline = rest.timeline;
        setSpriteFrame(rest, rest.timeline[anim.hold]);
      } else {
        setPlateFrame(anim.timeline[anim.hold]);
      }
      scheduleNextPlay(now);
      return;
    }
    applySlot(anim.slot);
  }
}

/* ---------- geometry / sizing ---------- */

function resize() {
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  // plane that fills the camera view at z=0 (+ overscan), so the texture covers
  const halfH = VIEW.camZ * Math.tan((VIEW.fov * Math.PI) / 360);
  const halfW = halfH * camera.aspect;
  const planeW = halfW * 2 * VIEW.pad;
  const planeH = halfH * 2 * VIEW.pad;
  liveLayerScene.worldPerPixel.set((halfW * 2) / w, (halfH * 2) / h);

  // map the image onto the plane. k carries the orbit headroom (pad) minus the
  // overscan margin. 'width' always fits by width (whole image visible, edge-clamp
  // fills the vertical margin); 'cover' fills the screen, cropping the cross axis.
  const screenAspect = w / h;
  const sceneOverscan = (liveLayerScene.active || fullDay.active) ? 0.025 : VIEW.overscan;
  const k = (1 - sceneOverscan) * VIEW.pad;
  const byWidth = () => cover.set(k, (k * IMG_ASPECT) / screenAspect);
  const byHeight = () => cover.set((k * screenAspect) / IMG_ASPECT, k);
  if (fitMode === "width") {
    byWidth();
  } else if (fitMode === "height") {
    byHeight();
  } else {
    // cover: fill the screen by matching the limiting axis, crop the other
    if (screenAspect < IMG_ASPECT) byHeight();
    else byWidth();
  }

  const flatScene = liveLayerScene.active || (fullDay.active && !fullDay.hasDepth);
  const segX = flatScene ? 1 : Math.max(140, Math.round(planeW * 150));
  const segY = flatScene ? 1 : Math.max(140, Math.round(planeH * 150));
  const next = new THREE.PlaneGeometry(planeW, planeH, segX, segY);
  geometry?.dispose();
  geometry = next;
  if (frontMesh) frontMesh.geometry = geometry;
  if (backMesh) backMesh.geometry = geometry;
  if (subjectMesh) subjectMesh.geometry = geometry;
  if (fullDay.active && fullDay.mesh) {
    if (fullDay.hasDepth) {
      fullDay.depthGeometry?.dispose();
      fullDay.depthGeometry = new THREE.PlaneGeometry(planeW, planeH, 150, 260);
      fullDay.mesh.geometry = fullDay.depthGeometry;
    } else {
      fullDay.mesh.geometry = geometry;
    }
  }
  if (liveLayerScene.active) {
    for (const mesh of Object.values(liveLayerScene.meshes)) mesh.geometry = geometry;
    // every layer is a flat card except the hero, which displaces by its own depth and
    // therefore needs real vertices to displace
    liveLayerScene.depthGeometry?.dispose();
    liveLayerScene.depthGeometry = new THREE.PlaneGeometry(planeW, planeH, 140, 250);
    for (const k of ["architecture", "shadow", "hero"]) {
      liveLayerScene.meshes[k].geometry = liveLayerScene.depthGeometry;
    }
  }
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
  const rect = canvas.getBoundingClientRect();
  const nx = ((event.clientX - rect.left) / Math.max(1, rect.width) - 0.5) * 2;
  const ny = ((event.clientY - rect.top) / Math.max(1, rect.height) - 0.5) * 2;
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
  const rect = canvas.getBoundingClientRect();
  const dx = (clientX - drag.startX) / Math.max(1, rect.width);
  const dy = (clientY - drag.startY) / Math.max(1, rect.height);
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
