/**
 * ELURA stage — multi-scene depth-mesh renderer.
 *
 * A reusable extraction of app.js's 3D-photo renderer ("3D Photography using
 * Layered Depth Inpainting"): depth-displaced meshes under a perspective camera,
 * orbited by tilt/drag to produce true parallax. Shaders and every VIEW/SENSOR
 * constant are copied verbatim from app.js — those numbers are the product of long
 * visual tuning, not defaults to be improved.
 *
 * What is new here, and why:
 *  - SLOTS. Each loaded scene owns a THREE.Group of its own meshes/materials/textures.
 *    Up to 3 slots stay cached (LRU); the rest are disposed down to the last texture,
 *    because a phone GPU cannot hold five 2K colour+depth sets.
 *  - DISSOLVE. Every fragment shader multiplies uOpacity into its alpha, and during a
 *    dissolve every material drops depthWrite/depthTest so composition is a pure
 *    painter's algorithm driven by renderOrder = slotIndex * 10 + layerIndex — the
 *    only way two scenes can blend through each other correctly.
 *    AT REST the depth test is restored (setSlotDepth), because app.js's default and
 *    safe-layers paths depend on it: the back plate depth-WRITES and the front/subject
 *    meshes depth-TEST against it, which is what culls the front mesh wherever the two
 *    independently-estimated depth maps disagree. Dropping the test permanently is NOT
 *    a no-op — it draws the front plate where the back inpaint should show, and the two
 *    sit at different z, so silhouettes shimmer under strong orbit. The coherent-depth
 *    path is the exception: app.js runs that one with depthTest:false, so we do too.
 *  - POSE. A second, duration-based easing channel (dolly/panX/panY) on top of the
 *    tilt spring, so navigation itself can be a camera move.
 *
 * NOT ported: the idle-flick animation system (anim/ manifests, sprite3d, video3d
 * plate swapping). Out of scope for this prototype; cherry2dio and nila2dio simply
 * render their rest plate.
 */

import * as THREE from "three";

// Depth tuning baseline for generated 9:16 diorama scenes. Verbatim from app.js.
const VIEW = {
  camZ: 6,
  fov: 36,
  depthScale: 1.84, // stronger foreground relief without the "inflated sticker" look
  farScale: 0.64, // opens mid/far parallax so the room reads deeper
  focus: 0.27, // lower still plane = more depth separation across the whole scene
  orbit: 0.84, // stronger horizontal camera travel at full tilt
  orbitYScale: 0.76, // allow small vertical motion to read more clearly
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

// Cherry's ear tips are too thin for the full depth mesh: vertices just outside the
// matte can still be pulled by background depth, making the tip look pinned. Render
// that subject with a masked cat-only depth field instead.
const SUBJECT_DEPTH_SCENES = new Set(["cherry2dio"]);
const SUBJECT_BASE_DEPTH = 0.43;
const SUBJECT_DEPTH_CONTRAST = 1.12;

// smaller ranges => a small phone tilt reaches full parallax (very responsive)
const SENSOR = { betaRange: 4.2, gammaRange: 4.2, gravityRange: 1.15, deadZone: 0.006 };
const TOUCH_SENS = 3.4; // drag distance (fraction of screen) -> parallax offset

// asset cache-buster shared with viewer.html so both hit the same cache entries
const AV = location.protocol === "file:" ? "" : "?a=dio15";

// swipe hand-off: the shell owns horizontal navigation, so the stage must recognise
// that gesture and give it away instead of swallowing it as parallax.
const SWIPE_PX = 64;
const SWIPE_MS = 500;

const LAYER = { back: 0, front: 1, subject: 2 };
// A cherry/latte/nila slot is ~27MB of texture (six 864x1536 RGBA sets); mochi is
// 982x2128 and ~48MB. Three resident slots peaked past 190MB during a dissolve —
// at or beyond a mid-range Android WebView's budget, and a context loss there is
// a permanently black canvas. Two: the visible scene and the one the shell warmed
// in the direction of travel. Anything else is re-fetched from the HTTP cache.
const MAX_SLOTS = 2;

// Which OPTIONAL files each scene actually ships. Probing for them cost a
// guaranteed 404 round-trip per miss (17 per session) — each one a serialized RTT
// in front of a multi-megabyte plate on first paint, and a console error against a
// quality bar that says there are none. Unknown ids fall back to probing, so a
// newly generated scene still works before it is listed here.
const OPTIONAL = {
  atelier_parallax: { view: true, subject: true },
  mochi2dio: { view: true, subject: true, subjectDepth: true },
  cherry2dio: { subject: true },
  latte2dio: { subject: true },
  nila2dio: { subject: true },
};
const PROBE_ALL = { view: true, protect: true, subject: true, subjectDepth: true };

/* ---------- shaders (verbatim from app.js, + uOpacity in every fragment) ---------- */

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
  uniform float uOpacity;
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
    gl_FragColor = vec4(texture2D(uColor, vUv).rgb, a * uOpacity);
  }`;

// the subject: a soft alpha matte over the filled back layer. Its relief is
// masked by the subject matte so thin edges are not pulled by the far background
// depth sitting just outside the silhouette.
const FRAG_SUBJECT = `
  uniform sampler2D uColor;
  uniform sampler2D uSubject;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float a = texture2D(uSubject, vUv).r;
    if (a < 0.004) discard;
    gl_FragColor = vec4(texture2D(uColor, vUv).rgb, a * uOpacity);
  }`;

const FRAG_BACK = `
  uniform sampler2D uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    gl_FragColor = vec4(texture2D(uColor, vUv).rgb, uOpacity);
  }`;

/* ---------- helpers ---------- */

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function deadZone(v) {
  const m = Math.abs(v);
  if (m <= SENSOR.deadZone) return 0;
  const n = (m - SENSOR.deadZone) / (1 - SENSOR.deadZone);
  return Math.sign(v) * n;
}

const lerp = (a, b, t) => a + (b - a) * t;

// CSS cubic-bezier(x1,y1,x2,y2) evaluated in JS, so a pose move and the CSS chrome
// transitions that accompany it are driven by literally the same curve.
function cubicBezier(x1, y1, x2, y2) {
  const A = (a, b) => 1 - 3 * b + 3 * a;
  const B = (a, b) => 3 * b - 6 * a;
  const C = (a) => 3 * a;
  const calc = (t, a, b) => ((A(a, b) * t + B(a, b)) * t + C(a)) * t;
  const slope = (t, a, b) => 3 * A(a, b) * t * t + 2 * B(a, b) * t + C(a);
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i += 1) {
      const err = calc(t, x1, x2) - x;
      if (Math.abs(err) < 1e-6) break;
      const d = slope(t, x1, x2);
      if (Math.abs(d) < 1e-6) break;
      t = clamp(t - err / d, 0, 1);
    }
    return calc(t, y1, y2);
  };
}

const EASE = cubicBezier(0.22, 0.61, 0.16, 1); // --ease

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{maxDpr?:number, fps?:number, onSwipe?:(dir:number)=>void}} [opts]
 */
export function createStage(canvas, opts = {}) {
  const maxDpr = Number.isFinite(opts.maxDpr) ? opts.maxDpr : 2;
  const renderFps = Number.isFinite(opts.fps) ? opts.fps : 60;
  const minRenderMs = renderFps >= 59 ? 0 : Math.max(0, 1000 / Math.max(1, renderFps) - 0.5);
  // mutable: the shell may hand the callback over after construction, and it only
  // suppresses its own fallback swipe detector once it sees `onSwipe` on the stage —
  // two detectors on one gesture would advance the gallery twice.
  let swipeHandler = typeof opts.onSwipe === "function" ? opts.onSwipe : null;

  const reduceQuery =
    typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  const reduced = () => Boolean(reduceQuery?.matches);
  // reduced motion keeps the whole state machine; only the clock is collapsed
  const dur = (ms) => (reduced() ? 1 : Math.max(1, ms));

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // ShaderMaterial passthrough
  renderer.setClearColor(0x2a1a0e, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(VIEW.fov, 1, 0.1, 100);
  camera.position.set(0, 0, VIEW.camZ);

  const loader = new THREE.TextureLoader();
  const BLANK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  BLANK.needsUpdate = true;

  /** @type {Map<string, object>} loaded slots */
  const slots = new Map();
  /** @type {Map<string, Promise<object>>} in-flight loads, so a double call shares one fetch */
  const pending = new Map();
  /** @type {string[]} paint order, last entry is topmost */
  let stack = [];
  let activeId = null;
  let geometry = null;
  let planeW = 1;
  let planeH = 1;
  let disposed = false;
  let running = false;

  // `travel` is the depth-aware half of a scene change: the incoming slot enters
  // from the direction of the swipe and settles, while the outgoing one leaves the
  // other way. Without it the midpoint of a 900ms blend is two full frames at 50%
  // opacity — the double exposure a plain cross-fade always looks like.
  const dissolve = {
    active: false,
    from: null,
    to: null,
    t0: 0,
    ms: 0,
    p: 1,
    travel: 0,
    onHalf: null,
    resolve: null,
  };
  let crossToken = 0;
  let contextLost = false;

  /* ---------- camera state ---------- */

  const target = { x: 0, y: 0 }; // tilt target, -1..1
  const current = { x: 0, y: 0 };
  const vel = { x: 0, y: 0 };
  const pose = { x: 0, y: 0, dolly: 0 }; // eased pose offset, world units
  const poseTarget = { x: 0, y: 0, dolly: 0 };
  const poseFrom = { x: 0, y: 0, dolly: 0 };
  const poseAnim = { active: false, t0: 0, ms: 1 };
  let orbitGain = 1;

  let lastFrame = performance.now();
  let lastRenderAt = 0;
  let lastInputAt = 0;
  const state = {
    motionEnabled: false,
    hasSensorReading: false,
    externalTilt: false, // setTilt() has taken over; idle drift steps aside
    pointerActive: false,
    idle: true,
    startTime: performance.now(),
  };
  const sensor = { baseBeta: null, baseGamma: null, baseGX: null, baseGY: null, lastOrientationAt: 0 };
  const drag = { touch: false, pointerId: null, startX: 0, startY: 0, baseX: 0, baseY: 0, captureTarget: null };
  const gesture = { t0: 0, x0: 0, y0: 0, swiped: false };

  /* ---------- asset loading ---------- */

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

  const loadJsonOpt = (url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);

  // PNG only. The build has never written a .webp plate for any scene in this
  // catalog, so probing for one bought nothing and cost a 404 round-trip in front of
  // every multi-megabyte plate — two per scene, on the critical path of first paint.
  // If WebP plates are ever produced, declare them in OPTIONAL rather than
  // rediscovering them by failed request on every launch.
  const loadPlate = (base) => loadTexture(base + ".png" + AV);

  /* ---------- slot construction ---------- */

  // Per-scene convergence/gain. build_3dphoto.py writes view.json with focus (the
  // zero-parallax "still" plane) and depthScale (relief), estimated from the scene's
  // depth + subject. Hand-tuned SCENE_OVERRIDES stay authoritative for the scenes that
  // have them; missing file -> defaults unchanged.
  function resolveView(id, viewCfg) {
    const v = { ...VIEW, ...(SCENE_OVERRIDES[id] || {}) };
    const hasManualTune = Object.prototype.hasOwnProperty.call(SCENE_OVERRIDES, id);
    if (!hasManualTune && viewCfg && typeof viewCfg === "object") {
      if (Number.isFinite(viewCfg.focus)) v.focus = viewCfg.focus;
      if (Number.isFinite(viewCfg.depthScale)) v.depthScale = viewCfg.depthScale;
      if (Number.isFinite(viewCfg.farScale)) v.farScale = viewCfg.farScale;
      if (Number.isFinite(viewCfg.orbit)) v.orbit = viewCfg.orbit;
      if (Number.isFinite(viewCfg.orbitYScale)) v.orbitYScale = viewCfg.orbitYScale;
    }
    return v;
  }

  function buildSlot(id, parts) {
    const { fgColor, fgDepth, bgColor, bgDepth, protect, subject, subjectDepth, viewCfg } = parts;
    const view = resolveView(id, viewCfg);
    const useSubject = subject !== null;

    const slot = {
      id,
      view,
      group: new THREE.Group(),
      meshes: [],
      materials: [],
      textures: [fgColor, fgDepth, bgColor, bgDepth, protect, subject, subjectDepth].filter(Boolean),
      // plate aspect is per-scene: uCover must never be shared between slots or one
      // scene's framing leaks into the next
      imgAspect: fgColor.image?.width ? fgColor.image.width / fgColor.image.height : 864 / 1536,
      cover: new THREE.Vector2(1, 1),
      opacity: { value: 0 },
      // coherent-depth is the one path app.js itself runs without a depth test;
      // everything else wants it restored once the slot is alone on screen.
      useDepth: viewCfg?.renderMode !== "coherent-depth",
      usedAt: performance.now(),
    };
    slot.group.visible = false;

    const tw = fgDepth.image?.width || 864;
    const th = fgDepth.image?.height || 1536;
    const texel = new THREE.Vector2(1.6 / tw, 1.6 / th);

    // Materials are built in the dissolve-safe state (no depth at all); setSlotDepth
    // turns the test back on for whichever slot is alone on screen.
    const mat = (config, layer) => {
      const m = new THREE.ShaderMaterial({
        ...config,
        uniforms: { ...config.uniforms, uOpacity: slot.opacity },
        transparent: true,
        depthWrite: false,
        depthTest: false,
      });
      const mesh = new THREE.Mesh(geometry, m); // resize() built it before any load
      mesh.frustumCulled = false; // the vertex shader moves geometry the bounds don't know about
      mesh.userData.layer = layer;
      slot.materials.push(m);
      slot.meshes.push(mesh);
      slot.group.add(mesh);
      return m;
    };

    // Coherent single-depth path: the original plate supplies the only scene
    // coordinate system.  bg_depth is merely the scale-calibrated inpaint of the
    // cat hole, while the subject keeps the original model's face/body relief.
    if (viewCfg?.renderMode === "coherent-depth" && useSubject) {
      const subjectBaseDepth = Number.isFinite(viewCfg.subjectBaseDepth)
        ? viewCfg.subjectBaseDepth
        : SUBJECT_BASE_DEPTH;
      const depthUniforms = (depthTex, zBias = 0.0) => ({
        uDepth: { value: depthTex },
        uDepthScale: { value: view.depthScale },
        uFarScale: { value: view.farScale },
        uFocus: { value: view.focus },
        uCamZ: { value: VIEW.camZ }, // convergence view, NOT the dollied camera
        uZBias: { value: zBias },
        uCover: { value: slot.cover },
      });
      mat(
        {
          uniforms: { uColor: { value: bgColor }, ...depthUniforms(bgDepth) },
          vertexShader: VERT_COHERENT_BG,
          fragmentShader: FRAG_BACK,
        },
        LAYER.back,
      );
      mat(
        {
          uniforms: {
            uColor: { value: fgColor },
            uSubject: { value: subject },
            uSubjectBaseDepth: { value: subjectBaseDepth },
            ...depthUniforms(fgDepth, 0.002),
          },
          vertexShader: VERT_COHERENT_SUBJECT,
          fragmentShader: FRAG_SUBJECT,
        },
        LAYER.subject,
      );
      return slot;
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
      mat(
        {
          uniforms: {
            uColor: { value: bgColor },
            uCover: { value: slot.cover },
            uLayerZ: { value: 0.0 },
            uLayerScale: { value: 1.0 },
          },
          vertexShader: VERT_RIGID_LAYER,
          fragmentShader: FRAG_BACK,
        },
        LAYER.back,
      );
      mat(
        {
          uniforms: {
            uColor: { value: fgColor },
            uDepth: { value: fgDepth },
            uSubject: { value: subject },
            uCover: { value: slot.cover },
            uLayerZ: { value: subjectZ },
            uLayerScale: { value: subjectScale },
            uSubjectBaseDepth: { value: subjectBaseDepth },
            uSubjectRelief: { value: subjectRelief },
          },
          vertexShader: VERT_SAFE_SUBJECT,
          fragmentShader: FRAG_SUBJECT,
        },
        LAYER.subject,
      );
      return slot;
    }

    // default: cliff-cut LDI (back plate + cut front mesh + optional soft subject)
    const reliefUniforms = (reliefMask = BLANK, reliefMaskStrength = 0.0) => ({
      uDepth: { value: fgDepth },
      uDepthScale: { value: view.depthScale },
      uFarScale: { value: view.farScale },
      uFocus: { value: view.focus },
      uReliefMask: { value: reliefMask },
      uReliefMaskStrength: { value: reliefMaskStrength },
      uCover: { value: slot.cover },
    });

    mat(
      {
        uniforms: {
          uColor: { value: bgColor },
          uDepth: { value: bgDepth },
          uDepthScale: { value: view.depthScale },
          uFarScale: { value: view.farScale },
          uFocus: { value: view.focus },
          uZBias: { value: -0.04 },
          uReliefMask: { value: BLANK },
          uReliefMaskStrength: { value: 0.0 },
          uCover: { value: slot.cover },
        },
        vertexShader: VERT,
        fragmentShader: FRAG_BACK,
      },
      LAYER.back,
    );
    mat(
      {
        uniforms: {
          uColor: { value: fgColor },
          uSubject: { value: subject || BLANK },
          uProtect: { value: protect || BLANK },
          uTexel: { value: texel },
          uCutLow: { value: view.cutLow },
          uCutHigh: { value: view.cutHigh },
          uUseSubject: { value: useSubject ? 1 : 0 },
          uZBias: { value: 0.0 },
          ...reliefUniforms(),
        },
        vertexShader: VERT,
        fragmentShader: FRAG_FRONT,
      },
      LAYER.front,
    );

    if (useSubject) {
      const useSubjectDepth = SUBJECT_DEPTH_SCENES.has(id);
      mat(
        {
          uniforms: useSubjectDepth
            ? {
                uColor: { value: fgColor },
                uSubject: { value: subject },
                uDepth: { value: fgDepth },
                uDepthScale: { value: view.depthScale },
                uFarScale: { value: view.farScale },
                uFocus: { value: view.focus },
                uZBias: { value: 0.0 },
                uSubjectBaseDepth: { value: SUBJECT_BASE_DEPTH },
                uSubjectDepthContrast: { value: SUBJECT_DEPTH_CONTRAST },
                uCover: { value: slot.cover },
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
        },
        LAYER.subject,
      );
    }
    return slot;
  }

  // Promise.all rejects on the first failure and abandons its siblings mid-decode.
  // On a phone a transient failure is the normal case, not the exceptional one, and
  // three orphaned 5MB textures with no reference to dispose() is a leak that lasts
  // the session. Settle everything, then either build or clean up completely.
  const settle = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));

  async function loadParts(id) {
    const base = `./assets/photo3d_${id}/`;
    const opt = OPTIONAL[id] || PROBE_ALL;
    // protect.png is only ever read by FRAG_FRONT's uUseSubject === 0 branch, and
    // every scene in the catalog ships subject.png — so fetching it was ~5MB and one
    // request per slot for a texture that is never sampled.
    const wantProtect = Boolean(opt.protect) && !opt.subject;

    const keys = ["fgColor", "fgDepth", "bgColor", "bgDepth"];
    const jobs = [
      loadPlate(base + "fg_color"),
      loadTexture(base + "fg_depth.png" + AV),
      loadPlate(base + "bg_color"),
      loadTexture(base + "bg_depth.png" + AV),
    ];
    // Declared optionals are still *required to succeed* once declared — a scene that
    // ships subject.png renders wrong without it, and the retry above covers a blip.
    if (wantProtect) (keys.push("protect"), jobs.push(loadTexture(base + "protect.png" + AV)));
    if (opt.subject) (keys.push("subject"), jobs.push(loadTexture(base + "subject.png" + AV)));
    if (opt.subjectDepth)
      (keys.push("subjectDepth"), jobs.push(loadTexture(base + "subject_depth.png" + AV)));

    const results = await Promise.all(jobs.map(settle));
    const failed = results.find((r) => !r.ok);
    if (failed) {
      for (const r of results) if (r.ok) r.v?.dispose();
      throw failed.e || new Error(`[stage] ${id}: asset load failed`);
    }

    const parts = { protect: null, subject: null, subjectDepth: null, viewCfg: null };
    results.forEach((r, i) => {
      parts[keys[i]] = r.v;
    });
    // view.json is genuinely optional — missing it only means "use the defaults".
    if (opt.view) parts.viewCfg = await loadJsonOpt(base + "view.json" + AV);
    return parts;
  }

  function ensureSlot(id) {
    const have = slots.get(id);
    if (have) {
      have.usedAt = performance.now();
      return Promise.resolve(have);
    }
    const inFlight = pending.get(id);
    if (inFlight) return inFlight;

    const job = loadParts(id)
      // one retry: a dropped request on a phone is a blip, not a broken build, and
      // the alternative is a dead prototype from a single flaky connection
      .catch(() => loadParts(id))
      .then((parts) => {
        // disposed while the textures were in flight: drop them, resolve with nothing
        // (callers re-check `disposed`) rather than rejecting into the shell
        if (disposed) {
          for (const t of Object.values(parts)) t?.dispose?.();
          return null;
        }
        const slot = buildSlot(id, parts);
        slots.set(id, slot);
        scene.add(slot.group);
        applyGeometry(slot);
        applyCover(slot);
        return slot;
      })
      .finally(() => pending.delete(id));

    pending.set(id, job);
    return job;
  }

  function disposeSlot(slot) {
    scene.remove(slot.group);
    for (const m of slot.materials) m.dispose();
    for (const t of slot.textures) if (t && t !== BLANK) t.dispose();
    slot.meshes.length = 0;
    slot.materials.length = 0;
    slot.textures.length = 0;
    slots.delete(slot.id);
    stack = stack.filter((id) => id !== slot.id);
  }

  // keep the current scene, the one it is dissolving from, and one more; drop the rest
  function evict() {
    if (slots.size <= MAX_SLOTS) return;
    const keep = new Set([activeId, dissolve.from?.id].filter(Boolean));
    const cold = [...slots.values()]
      .filter((s) => !keep.has(s.id))
      .sort((a, b) => a.usedAt - b.usedAt);
    while (slots.size > MAX_SLOTS && cold.length) disposeSlot(cold.shift());
  }

  /* ---------- draw order ---------- */

  // renderOrder = slotIndex * 10 + layerIndex. Within a slot back(0) -> front(1) ->
  // subject(2) is app.js's own order, so at full opacity nothing changes; across slots
  // the incoming scene simply paints over the outgoing one.
  function applyRenderOrder() {
    stack.forEach((id, slotIndex) => {
      const slot = slots.get(id);
      if (!slot) return;
      for (const mesh of slot.meshes) mesh.renderOrder = slotIndex * 10 + mesh.userData.layer;
    });
  }

  function raise(slot) {
    stack = stack.filter((id) => id !== slot.id);
    stack.push(slot.id);
    applyRenderOrder();
  }

  /* ---------- depth state ---------- */

  // app.js's own configuration, restored: the back plate depth-WRITES and the front /
  // subject meshes depth-TEST against it. That test is what culls the front mesh
  // wherever fg_depth and bg_depth disagree, so the LaMa inpaint shows through instead
  // of a duplicate of the front plate sitting at a different z. Only ever enabled for a
  // slot that is alone on screen at full opacity — a depth-writing plate would punch a
  // hole through anything dissolving under it.
  function setSlotDepth(slot, on) {
    const want = Boolean(on) && slot.useDepth;
    if (slot.depthOn === want) return;
    slot.depthOn = want;
    for (const mesh of slot.meshes) {
      mesh.material.depthTest = want;
      mesh.material.depthWrite = want && mesh.userData.layer === LAYER.back;
    }
  }

  function syncDepthState() {
    const solo = dissolve.active ? null : slots.get(activeId);
    for (const slot of slots.values()) setSlotDepth(slot, slot === solo);
  }

  /* ---------- geometry / sizing ---------- */

  function applyGeometry(slot) {
    if (!geometry) return;
    for (const mesh of slot.meshes) mesh.geometry = geometry;
  }

  // map the image onto the plane. k carries the orbit headroom (pad) minus the
  // overscan margin; 'cover' fills the screen by matching the limiting axis.
  function applyCover(slot) {
    const w = renderer.domElement.width || 1;
    const h = renderer.domElement.height || 1;
    const screenAspect = w / h;
    const k = (1 - VIEW.overscan) * VIEW.pad;
    if (screenAspect < slot.imgAspect) slot.cover.set((k * screenAspect) / slot.imgAspect, k);
    else slot.cover.set(k, (k * slot.imgAspect) / screenAspect);
  }

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
    const nextW = halfW * 2 * VIEW.pad;
    const nextH = halfH * 2 * VIEW.pad;

    // one plane for every slot: they all sample the same square UV grid, only uCover differs
    if (!geometry || nextW !== planeW || nextH !== planeH) {
      planeW = nextW;
      planeH = nextH;
      const segX = Math.max(140, Math.round(planeW * 150));
      const segY = Math.max(140, Math.round(planeH * 150));
      const next = new THREE.PlaneGeometry(planeW, planeH, segX, segY);
      geometry?.dispose();
      geometry = next;
      for (const slot of slots.values()) applyGeometry(slot);
    }
    for (const slot of slots.values()) applyCover(slot);
  }

  /* ---------- pose (duration-eased) ---------- */

  function setPose(next = {}, poseOpts = {}) {
    poseFrom.x = pose.x;
    poseFrom.y = pose.y;
    poseFrom.dolly = pose.dolly;
    if (Number.isFinite(next.panX)) poseTarget.x = next.panX;
    if (Number.isFinite(next.panY)) poseTarget.y = next.panY;
    if (Number.isFinite(next.dolly)) poseTarget.dolly = next.dolly;
    poseAnim.t0 = performance.now();
    poseAnim.ms = dur(Number.isFinite(poseOpts.ms) ? poseOpts.ms : 1100);
    poseAnim.active = true;
  }

  function tickPose(now) {
    if (!poseAnim.active) return;
    const p = clamp((now - poseAnim.t0) / poseAnim.ms, 0, 1);
    const e = EASE(p);
    pose.x = lerp(poseFrom.x, poseTarget.x, e);
    pose.y = lerp(poseFrom.y, poseTarget.y, e);
    pose.dolly = lerp(poseFrom.dolly, poseTarget.dolly, e);
    if (p >= 1) poseAnim.active = false;
  }

  /* ---------- dissolve ---------- */

  function finishDissolve() {
    if (!dissolve.active) return;
    const from = dissolve.from;
    const to = dissolve.to;
    if (to) {
      to.opacity.value = 1;
      to.group.position.x = 0;
    }
    if (from && from !== to) {
      from.opacity.value = 0;
      from.group.visible = false;
      from.group.position.x = 0;
    }
    dissolve.active = false;
    dissolve.p = 1;
    dissolve.from = null;
    dissolve.to = null;
    dissolve.travel = 0;
    const half = dissolve.onHalf;
    dissolve.onHalf = null;
    const done = dissolve.resolve;
    dissolve.resolve = null;
    syncDepthState();
    evict();
    // the midpoint hook still owes the shell its call even on an interrupted swap:
    // the counter, the dots and the ink flip all hang off it, and a swap that never
    // reached 50% must not leave the label describing the previous room forever.
    half?.();
    done?.();
  }

  function tickDissolve(now) {
    if (!dissolve.active) return;
    const p = clamp((now - dissolve.t0) / dissolve.ms, 0, 1);
    // smoothstep, not --ease: a dissolve is a blend, so its visual midpoint has to
    // land on its temporal midpoint (the shell swaps the counter there). --ease is
    // front-loaded — 90% swapped at 50% of the time — which reads as a cut.
    dissolve.p = p * p * (3 - 2 * p);
    // the outgoing scene holds at full opacity while the incoming one rises over it:
    // its back plate covers the frame, so the composite never dips toward the clear
    // colour mid-way — a true dissolve with no grey hole.
    dissolve.to.opacity.value = dissolve.p;
    if (dissolve.travel) {
      // both rooms are moving, in opposite directions and at different rates: the
      // arriving one glides in from the direction of travel, the leaving one keeps
      // going. That, not the opacity ramp, is what stops the midpoint reading as a
      // double exposure of two cats in the same room.
      dissolve.to.group.position.x = dissolve.travel * (1 - dissolve.p);
      if (dissolve.from) dissolve.from.group.position.x = -dissolve.travel * 0.6 * dissolve.p;
    }
    if (dissolve.p >= 0.5 && dissolve.onHalf) {
      const half = dissolve.onHalf;
      dissolve.onHalf = null;
      half();
    }
    if (p >= 1) finishDissolve();
  }

  /* ---------- render loop ---------- */

  function loop() {
    const now = performance.now();
    if (now - lastRenderAt < minRenderMs) return;
    const dt = Math.min((now - lastFrame) / 1000, 0.05); // clamp for stability
    lastRenderAt = now;
    lastFrame = now;

    // desktop polish: when the pointer leaves / goes idle, ease back to centre
    // (gyro keeps its held tilt — that is the user's intent)
    if (!state.hasSensorReading && !state.externalTilt && !state.pointerActive && now - lastInputAt > 500) {
      target.x *= 0.9;
      target.y *= 0.9;
    }

    // critically-damped spring: gives weight/inertia instead of a flat lerp
    const w = VIEW.springFreq;
    const ax = (target.x - current.x) * w * w - vel.x * 2 * w;
    const ay = (target.y - current.y) * w * w - vel.y * 2 * w;
    vel.x += ax * dt;
    vel.y += ay * dt;
    current.x += vel.x * dt;
    current.y += vel.y * dt;

    let ox = current.x;
    let oy = current.y;
    if (state.idle && !reduced() && !state.pointerActive && !state.hasSensorReading && !state.externalTilt) {
      const t = (now - state.startTime) * VIEW.idleSpeed;
      ox += Math.sin(t) * VIEW.idleAmp;
      oy += Math.cos(t * 0.8) * VIEW.idleAmp * 0.5;
    }

    tickPose(now);
    tickDissolve(now);

    // orbit gain is per-scene, so it crosses over with the dissolve instead of
    // snapping the parallax amplitude at the swap
    const to = slots.get(activeId);
    let orbit = to ? to.view.orbit : VIEW.orbit;
    let orbitY = to ? to.view.orbitYScale : VIEW.orbitYScale;
    if (dissolve.active && dissolve.from) {
      orbit = lerp(dissolve.from.view.orbit, orbit, dissolve.p);
      orbitY = lerp(dissolve.from.view.orbitYScale, orbitY, dissolve.p);
    }

    camera.position.x = ox * orbit * orbitGain + pose.x;
    camera.position.y = oy * orbit * orbitY * orbitGain + pose.y;
    camera.position.z = VIEW.camZ + pose.dolly;
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  }

  /* ---------- input ---------- */

  function setTargetFromNormalized(nx, ny) {
    target.x = clamp(nx, -1, 1);
    target.y = clamp(ny, -1, 1);
  }

  function setTargetFromDrag(clientX, clientY) {
    // drag = relative look-around; overrides gyro while the finger/mouse is down
    const rect = canvas.getBoundingClientRect();
    const dx = (clientX - drag.startX) / Math.max(1, rect.width);
    const dy = (clientY - drag.startY) / Math.max(1, rect.height);
    setTargetFromNormalized(drag.baseX + dx * TOUCH_SENS, drag.baseY - dy * TOUCH_SENS);
    lastInputAt = performance.now();
  }

  function beginGesture(clientX, clientY) {
    gesture.t0 = performance.now();
    gesture.x0 = clientX;
    gesture.y0 = clientY;
    gesture.swiped = false;
  }

  // The shell owns left/right navigation. A decisive horizontal flick is handed over
  // and its parallax contribution is rolled back, so the gesture reads as one camera
  // move to the next room rather than a look-around plus a jump.
  function trySwipe(clientX, clientY) {
    if (!swipeHandler || gesture.swiped || !drag.touch) return false;
    const dx = clientX - gesture.x0;
    const dy = clientY - gesture.y0;
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) <= Math.abs(dy)) return false;
    if (performance.now() - gesture.t0 > SWIPE_MS) return false;
    gesture.swiped = true;
    state.pointerActive = false;
    setTargetFromNormalized(drag.baseX, drag.baseY); // cancel this drag's parallax
    swipeHandler(dx < 0 ? 1 : -1); // drag left = travel forward through the catalog
    return true;
  }

  function handlePointerDown(event) {
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
    try {
      drag.captureTarget?.setPointerCapture(event.pointerId);
    } catch {}
    beginGesture(event.clientX, event.clientY);
    if (!drag.touch) handlePointerMove(event); // desktop mouse: absolute hover
  }

  function handlePointerMove(event) {
    if (state.pointerActive) {
      if (drag.pointerId != null && event.pointerId !== drag.pointerId) return;
      if (event.cancelable) event.preventDefault();
      if (trySwipe(event.clientX, event.clientY)) return;
      setTargetFromDrag(event.clientX, event.clientY);
      return;
    }
    if (gesture.swiped) return; // rest of the flick, after the hand-off
    if (state.hasSensorReading || state.externalTilt) return; // gyro drives when not dragging
    const rect = canvas.getBoundingClientRect();
    const nx = ((event.clientX - rect.left) / Math.max(1, rect.width) - 0.5) * 2;
    const ny = ((event.clientY - rect.top) / Math.max(1, rect.height) - 0.5) * 2;
    setTargetFromNormalized(nx, -ny);
    lastInputAt = performance.now();
  }

  function handlePointerUp() {
    try {
      if (drag.pointerId != null) drag.captureTarget?.releasePointerCapture(drag.pointerId);
    } catch {}
    state.pointerActive = false;
    drag.pointerId = null;
    drag.captureTarget = null;
    gesture.swiped = false;
  }

  function handleTouchStart(event) {
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
    beginGesture(touch.clientX, touch.clientY);
  }

  function handleTouchMove(event) {
    if (!state.pointerActive || drag.pointerId != null) return;
    const touch = event.touches?.[0];
    if (!touch) return;
    if (event.cancelable) event.preventDefault();
    if (trySwipe(touch.clientX, touch.clientY)) return;
    setTargetFromDrag(touch.clientX, touch.clientY);
  }

  function handleTouchEnd(event) {
    if (drag.pointerId != null) return;
    if (event.cancelable) event.preventDefault();
    state.pointerActive = false;
    gesture.swiped = false; // the flick is over; hover/parallax may resume
  }

  // Native tilt bridge: the Android WebView live-wallpaper drives parallax from a
  // native WAKEUP rotation-vector sensor (which keeps firing on the lock screen, where
  // the browser's DeviceOrientation is suspended) and calls this with normalized tilt.
  // Once native tilt arrives we treat it like a sensor reading so pointer-idle recentre
  // and web DeviceOrientation don't fight it.
  const prevNativeTilt = window.__nativeTilt;
  window.__nativeTilt = function (nx, ny) {
    if (state.pointerActive) return;
    state.hasSensorReading = true;
    setTargetFromNormalized(clamp(nx, -1, 1), clamp(ny, -1, 1));
    lastInputAt = performance.now();
  };

  function handleOrientation(event) {
    if (state.pointerActive || !state.motionEnabled || event.beta == null || event.gamma == null) return;
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
    if (state.pointerActive || !state.motionEnabled) return;
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

  function startMotion() {
    if (!state.motionEnabled) {
      window.addEventListener("deviceorientation", handleOrientation, { passive: true });
      window.addEventListener("deviceorientationabsolute", handleOrientation, { passive: true });
      window.addEventListener("devicemotion", handleDeviceMotion, { passive: true });
    }
    state.motionEnabled = true;
  }

  function needsSensorPermission() {
    return (
      typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function"
    );
  }

  // Android/desktop hand out orientation without asking: start listening immediately
  // so the first scene already answers to the phone.
  function startPassiveMotion() {
    if (needsSensorPermission()) return;
    if (typeof DeviceOrientationEvent !== "undefined" || typeof DeviceMotionEvent !== "undefined") {
      startMotion();
    }
  }

  function requestSensorPermission(sensorEvent) {
    if (typeof sensorEvent === "undefined" || typeof sensorEvent.requestPermission !== "function") {
      return Promise.resolve("granted");
    }
    return sensorEvent.requestPermission();
  }

  // iOS needs this called from inside a user gesture — the shell calls it from the
  // first CTA tap, never from a permission screen of its own.
  async function enableSensors() {
    const hasMotion =
      typeof DeviceOrientationEvent !== "undefined" || typeof DeviceMotionEvent !== "undefined";
    if (!hasMotion) return "unsupported";
    try {
      // BOTH requests must be *issued* synchronously inside the gesture. Awaiting the
      // first one before issuing the second put the motion request in a task that runs
      // after the iOS permission sheet closed — outside the user activation Safari
      // requires — so the user tapped Allow and gyro parallax stayed dead, silently.
      const [o, m] = await Promise.all([
        requestSensorPermission(DeviceOrientationEvent).catch(() => "denied"),
        requestSensorPermission(DeviceMotionEvent).catch(() => "denied"),
      ]);
      // A partial grant is still a win: orientation alone drives the parallax.
      if (o !== "granted" && m !== "granted") return "denied";
      startMotion();
      return "granted";
    } catch {
      return "denied";
    }
  }

  /* ---------- listeners ---------- */

  // listeners live on the canvas, not window: the shell's chrome sits above it in the
  // DOM, so a tap on a button never reaches the stage and app.js's isControlTarget
  // guard is unnecessary here. Sensors stay on window — they have no target.
  const onWindowResize = () => resize();
  // orientationchange lives here too, so the shell does not have to bind a second set
  // of resize listeners that would run every setSize/applyCover pass twice.
  const onContextLost = (e) => {
    // Without preventDefault the context never comes back and the canvas is black for
    // the rest of the session — the exact failure a 100MB+ texture budget invites.
    e.preventDefault();
    contextLost = true;
    stop();
  };
  const onContextRestored = () => {
    contextLost = false;
    // every GPU-side object died with the context; rebuild from the manifest
    for (const slot of [...slots.values()]) disposeSlot(slot);
    pending.clear();
    geometry?.dispose();
    geometry = null;
    resize();
    const id = activeId;
    activeId = null;
    if (id) load(id).catch(() => {});
  };
  canvas.addEventListener("webglcontextlost", onContextLost, false);
  canvas.addEventListener("webglcontextrestored", onContextRestored, false);
  canvas.addEventListener("pointermove", handlePointerMove, { passive: false });
  canvas.addEventListener("pointerdown", handlePointerDown, { passive: false });
  canvas.addEventListener("pointerup", handlePointerUp, { passive: false });
  canvas.addEventListener("pointercancel", handlePointerUp, { passive: false });
  canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
  canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
  canvas.addEventListener("touchend", handleTouchEnd, { passive: false });
  canvas.addEventListener("touchcancel", handleTouchEnd, { passive: false });
  window.addEventListener("resize", onWindowResize);
  window.addEventListener("orientationchange", onWindowResize);
  window.visualViewport?.addEventListener("resize", onWindowResize);

  resize();

  /* ---------- public API ---------- */

  function start() {
    // a lost context renders nothing but still burns a frame budget; onContextRestored
    // is the only thing allowed to bring the loop back
    if (disposed || running || contextLost) return;
    running = true;
    lastFrame = performance.now();
    renderer.setAnimationLoop(loop);
  }

  function stop() {
    running = false;
    renderer.setAnimationLoop(null);
  }

  async function load(sceneId) {
    crossToken++; // an explicit load outranks any crossfade still waiting on textures
    const slot = await ensureSlot(sceneId);
    if (disposed || !slot) return;
    finishDissolve(); // whatever was mid-swap is resolved by an explicit load
    for (const other of slots.values()) {
      if (other === slot) continue;
      other.opacity.value = 0;
      other.group.visible = false;
      other.group.position.x = 0;
    }
    slot.usedAt = performance.now();
    slot.opacity.value = 1;
    slot.group.visible = true;
    slot.group.position.x = 0;
    activeId = sceneId;
    raise(slot);
    applyCover(slot);
    syncDepthState();
    startPassiveMotion();
    start();
    evict();
  }

  // opts.travel: world-space lean of the incoming scene, signed by swipe direction.
  // opts.onHalf: fired on the frame the blend actually passes 50%, not on a timer —
  // the shell hangs the counter, the dots and the ink flip off it, and a wall-clock
  // timer queues behind the texture upload this call is doing.
  async function crossfadeTo(sceneId, ms = 900, xopts = {}) {
    if (sceneId === activeId && !dissolve.active) return;
    const token = ++crossToken;
    const slot = await ensureSlot(sceneId);
    // A newer request was issued while this one waited on its textures. Bail: whichever
    // load finished LAST used to win the dissolve, so two quick swipes could leave the
    // picture on scene 3 while the counter, dots and ink all said scene 4 — permanently.
    if (disposed || !slot || token !== crossToken) return;
    finishDissolve(); // a new swap always resolves the previous one first
    if (sceneId === activeId) return;
    const from = slots.get(activeId) || null;
    slot.usedAt = performance.now();
    slot.opacity.value = 0;
    slot.group.visible = true;
    raise(slot);
    applyCover(slot);
    activeId = sceneId; // the incoming scene owns the camera from t=0
    dissolve.active = true;
    dissolve.from = from;
    dissolve.to = slot;
    dissolve.t0 = performance.now();
    dissolve.ms = dur(ms);
    dissolve.p = 0;
    dissolve.travel = reduced() ? 0 : Number.isFinite(xopts.travel) ? xopts.travel : 0;
    dissolve.onHalf = typeof xopts.onHalf === "function" ? xopts.onHalf : null;
    slot.group.position.x = dissolve.travel;
    syncDepthState();
    start();
    await new Promise((resolve) => {
      dissolve.resolve = resolve;
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stop();
    finishDissolve();
    canvas.removeEventListener("pointermove", handlePointerMove);
    canvas.removeEventListener("pointerdown", handlePointerDown);
    canvas.removeEventListener("pointerup", handlePointerUp);
    canvas.removeEventListener("pointercancel", handlePointerUp);
    canvas.removeEventListener("touchstart", handleTouchStart);
    canvas.removeEventListener("touchmove", handleTouchMove);
    canvas.removeEventListener("touchend", handleTouchEnd);
    canvas.removeEventListener("touchcancel", handleTouchEnd);
    canvas.removeEventListener("webglcontextlost", onContextLost);
    canvas.removeEventListener("webglcontextrestored", onContextRestored);
    window.removeEventListener("resize", onWindowResize);
    window.removeEventListener("orientationchange", onWindowResize);
    window.visualViewport?.removeEventListener("resize", onWindowResize);
    window.removeEventListener("deviceorientation", handleOrientation);
    window.removeEventListener("deviceorientationabsolute", handleOrientation);
    window.removeEventListener("devicemotion", handleDeviceMotion);
    window.__nativeTilt = prevNativeTilt;
    for (const slot of [...slots.values()]) disposeSlot(slot);
    geometry?.dispose();
    geometry = null;
    BLANK.dispose();
    renderer.dispose();
  }

  // Warm a scene without showing it. load()/crossfadeTo() both reveal, so this is the
  // only way the gallery can pay for the next room's textures before the swipe that
  // needs them. Best-effort: a failure here must never surface as a rejection.
  async function preload(sceneId) {
    if (disposed) return false;
    const cached = slots.get(sceneId);
    if (cached) {
      cached.usedAt = performance.now(); // asking for it again keeps it off the LRU block
      return true;
    }
    try {
      const slot = await ensureSlot(sceneId);
      if (!slot) return false;
      // the shell may have navigated to this very scene while it was in flight —
      // never hide what is now on screen
      if (sceneId === activeId || slot === dissolve.to || slot === dissolve.from) return true;
      slot.group.visible = false;
      slot.opacity.value = 0;
      slot.group.position.x = 0;
      if (!stack.includes(sceneId)) {
        stack.unshift(sceneId); // below everything: it is not on screen yet
        applyRenderOrder();
      }
      evict();
      return true;
    } catch {
      return false;
    }
  }

  // Drop a scene the shell knows it has walked away from. The visible scene and the
  // one it is dissolving from are never droppable.
  function unload(sceneId) {
    const slot = slots.get(sceneId);
    if (!slot || sceneId === activeId || slot === dissolve.from || slot === dissolve.to) return false;
    disposeSlot(slot);
    applyRenderOrder();
    return true;
  }

  return {
    load,
    crossfadeTo,
    preload,
    unload,
    setPose,
    setOrbitGain(g) {
      orbitGain = clamp(Number.isFinite(g) ? g : 1, 0, 1.5);
    },
    setTilt(nx, ny) {
      state.externalTilt = true;
      setTargetFromNormalized(nx, ny);
      lastInputAt = performance.now();
    },
    setIdle(on) {
      state.idle = Boolean(on);
    },
    onSwipe(fn) {
      swipeHandler = typeof fn === "function" ? fn : null;
    },
    enableSensors,
    needsSensorPermission,
    resize,
    start,
    stop,
    dispose,
    isLoaded: (sceneId) => slots.has(sceneId),
  };
}
