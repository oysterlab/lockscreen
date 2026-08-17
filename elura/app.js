/**
 * ELURA — screen state machine + motion choreography.
 *
 * Three screens live in the DOM at once; `#app[data-screen]` decides which is
 * live and `#app[data-text-mode]` decides the ink over the current scene.
 * All camera work goes through stage.js (which owns its own spring), so this
 * file never animates a frame — it only fires *targets* on a timeline.
 *
 * The premium feel is entirely in the OVERLAPS: chrome leaves fast, the next
 * chrome starts arriving while the camera is still travelling, and the camera
 * settles last. Nothing here is sequenced end-to-end on purpose.
 *
 * Two things are deliberately NOT on wall-clock timers, because both used to
 * queue behind a texture upload and land ~850ms late:
 *  - the end of a chrome exit (transitionend, timer only as a backstop)
 *  - the counter / dots / ink flip (the dissolve's own 50% frame)
 */

import { createStage } from './stage.js';
import { SCENES, HERO } from './scenes.js';

/* ---------- dom ---------- */

const app = document.getElementById('app');
const canvas = document.getElementById('stage-canvas');
const gradeEl = document.getElementById('grade');

const screens = {
  landing: document.getElementById('screen-landing'),
  gallery: document.getElementById('screen-gallery'),
  preview: document.getElementById('screen-preview'),
};

const counterEl = document.getElementById('counter');
const dotEls = Array.from(document.querySelectorAll('#dots .dot'));
const noteEl = document.getElementById('landing-note');

// Two clocks now: the landing IS a lock screen (that is what makes the first
// screen read as this app rather than as a web page), and PREVIEW strips the
// chrome off the same idea. One renderer drives both so they can never disagree.
const clockFaces = [
  {
    group: document.getElementById('landing-clock'),
    time: document.getElementById('landing-clock-time'),
    date: document.getElementById('landing-clock-date'),
  },
  {
    group: document.getElementById('clock'),
    time: document.getElementById('clock-time'),
    date: document.getElementById('clock-date'),
  },
].filter((f) => f.time && f.date);

/* ---------- motion constants (mirror elura/tokens.css) ---------- */

const T = {
  chromeOut: 420, // landing <-> gallery chrome exit
  chromeIn: 640, // any chrome entrance
  camera: 1100, // dolly / pan settle
  dissolve: 900, // scene A -> B
  settle: 900, // pan returns *through* the new scene — ends with the dissolve
  stagger: 90, // between chrome groups, reading order
  // 260, not 380: with three chrome groups the cascade ends at 260+180+640=1080,
  // which is INSIDE the camera's 1100. The brief's rule is that the camera settles
  // last; at 380 the pill was the last thing to arrive, 280ms after the world had
  // stopped, and the one core action was absent for 1.38s after the tap.
  enterAt: 260,
  previewOut: 320, // chrome exit into / out of PREVIEW (faster: it is a reveal)
  clockAt: 700, // clock arrives only once the room has opened up
  leanMs: 260, // lean into the swipe direction
  dissolveAt: 120, // dissolve starts after the lean has begun
  settleAt: 260, // pan returns *through* the new scene
  counterOut: 90, // counter fades out from the dissolve's own 50% frame…
  counterIn: 260, // …and back in behind the new number
  flipHold: 600, // how long the pill wears its costume-change dip
  // The opening shot. Nothing else in the app is this slow on purpose: it is the
  // only moment whose entire job is to prove the picture is alive. A snap to the
  // resting pose (which is what this used to be) leaves the first screen looking
  // like a still poster, because the idle drift is a 31-SECOND cycle — real, but
  // far too slow to be noticed inside a first impression.
  establish: 4000,
};

// Grade = one full-bleed vignette+veil. Its opacity is what lets text sit on the
// image with no card. LANDING dropped 0.42 -> 0.30 when the headline left: the
// clock lives inside the grade's own top band, so the extra veil was only greying
// the photograph. Nearly gone in PREVIEW.
const GRADE = { landing: 0.3, gallery: 0.22, preview: 0.06 };

// Tilt reacts more as the user goes deeper: the landing is a poster, the preview
// is a window. (Not spec'd; it is the cheapest way to make PREVIEW feel alive.)
const ORBIT = { landing: 0.72, gallery: 1.0, preview: 1.2 };

const POSE = {
  // LANDING sits back a little and looks slightly down: the clock gets clean wall
  // in the top band and the subject stays clear of it, without the frame closing in
  // the way GALLERY and PREVIEW do.
  landing: { dolly: 0.34, panY: -0.13, panX: 0 },
  // Where the opening shot STARTS: further back and off-axis, so the establishing
  // move is a slow push-in that also drifts back onto the centre line. Directional
  // and deliberate — an ambient wander does not read as "alive", a camera does.
  // dolly stays inside the plane's orbit headroom (pad 1.26) so no plate edge shows.
  landingEnter: { dolly: 1.28, panX: -0.13, panY: -0.04 },
  gallery: { dolly: -0.7, panX: 0, panY: 0.05 },
  preview: { dolly: -1.0, panX: 0, panY: 0.05 },
};

// World-space lean of the incoming scene during a swap. Bounded by the plane's own
// orbit headroom (pad 1.26 leaves ~0.23 world units before the plate edge shows).
const TRAVEL = 0.18;

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
// Reduced motion keeps the whole state machine and drops every delay to zero.
const D = (ms) => (reduceMotion.matches ? 0 : ms);

/* ---------- timeline ---------- */

let timers = [];
let fades = [];
let isTransitioning = false;

// Every choreography step goes through at(); a new transition cancels whatever
// the previous one still had pending, so rapid taps cannot interleave two moves.
function at(ms, fn) {
  const d = D(ms);
  if (d <= 0) {
    fn();
    return;
  }
  timers.push(window.setTimeout(fn, d));
}

function clearTimeline() {
  timers.forEach(window.clearTimeout);
  timers = [];
  fades.forEach((a) => a.cancel());
  fades = [];
}

/* A transition is over when BOTH the choreography timer has run out and every
 * async move it started (a dissolve waiting on textures) has settled. Releasing
 * on the timer alone let a second swipe land while the first crossfade was still
 * downloading, and the two resolved in load-completion order instead of request
 * order. `gen` invalidates everything the previous transition was still waiting on.
 */
let txGen = 0;
let txTimerDone = true;
let txWaits = 0;

function beginTransition(totalMs) {
  clearTimeline();
  const gen = ++txGen;
  isTransitioning = true;
  txTimerDone = false;
  txWaits = 0;
  at(totalMs, () => {
    txTimerDone = true;
    settleTransition(gen);
  });
  // Hard release: a load that never settles must not lock the UI for the session.
  window.setTimeout(() => {
    if (gen === txGen) {
      txWaits = 0;
      txTimerDone = true;
      settleTransition(gen);
    }
  }, D(totalMs) + 6000);
  return gen;
}

function awaitTransition(gen, promise) {
  if (!promise || typeof promise.then !== 'function') return;
  txWaits += 1;
  promise
    .catch(() => {})
    .then(() => {
      if (gen !== txGen) return;
      txWaits -= 1;
      settleTransition(gen);
    });
}

function settleTransition(gen) {
  if (gen !== txGen) return;
  if (txTimerDone && txWaits <= 0) isTransitioning = false;
}

/* ---------- chrome timing ----------
 * screens.css owns *what* moves (opacity / translateY / blur). This owns *when*:
 * inline delay+duration beat the stylesheet, so the timeline is exact no matter
 * how the CSS declares its transitions.
 */

function chromeItems(screenEl) {
  return Array.from(screenEl.querySelectorAll('[data-chrome]'));
}

function timeChrome(screenEl, delay, duration, stagger = 0) {
  screenEl.style.transitionDelay = `${D(delay)}ms`;
  screenEl.style.transitionDuration = `${D(duration)}ms`;
  for (const el of chromeItems(screenEl)) {
    const i = Number(el.dataset.chrome) || 0;
    el.style.transitionDelay = `${D(delay + i * stagger)}ms`;
    el.style.transitionDuration = `${D(duration)}ms`;
  }
}

// Last chrome group to arrive defines when the screen is "done".
function chromeSpan(screenEl, delay, duration, stagger) {
  const last = chromeItems(screenEl).reduce((m, el) => Math.max(m, Number(el.dataset.chrome) || 0), 0);
  return delay + last * stagger + duration;
}

function setGrade(value) {
  gradeEl.style.setProperty('--grade', String(value));
}

/* ---------- screen state ----------
 * #app[data-screen] is the state machine's own record and the ink key.
 * screens.css keys the chrome off data-active / data-leaving on the <section>,
 * because only the leaving screen knows it must exit UPWARD — a plain
 * "not active" state could only fall back to the entrance offset.
 *
 * The leaving flag is dropped by the exit's OWN transitionend, not by a timer.
 * A bare setTimeout(outMs + 30) left 14ms of slack on a 420ms move — a CSS
 * transition does not start until the first rendered frame after the attribute
 * change — so one dropped frame under texture upload cancelled the headline's
 * blur outright and ended it at the entrance offset (+14px, downward) instead of
 * the briefed -18px. The timer survives only as a backstop.
 */

let leaveCleanup = null;

function showScreen(next, outMs) {
  const from = current();
  leaveCleanup?.();
  app.dataset.screen = next;

  for (const [name, el] of Object.entries(screens)) {
    if (name === next) continue;
    el.removeAttribute('data-active');
    el.removeAttribute('data-leaving');
  }
  screens[next].removeAttribute('data-leaving');
  screens[next].setAttribute('data-active', '');

  if (!from || from === next) return;
  const leaving = screens[from];
  leaving.setAttribute('data-leaving', '');

  const waiting = new Set(chromeItems(leaving));
  let backstop = 0;

  const done = () => {
    leaving.removeEventListener('transitionend', onEnd);
    window.clearTimeout(backstop);
    leaving.removeAttribute('data-leaving');
    if (leaveCleanup === done) leaveCleanup = null;
  };

  const onEnd = (e) => {
    if (e.propertyName !== 'opacity') return;
    waiting.delete(e.target);
    if (waiting.size === 0) done();
  };

  leaving.addEventListener('transitionend', onEnd);
  // +250ms, not +30ms: a transition that was never presented has to be impossible
  // to truncate, not merely unlikely to be.
  backstop = window.setTimeout(done, D(outMs) + 250);
  leaveCleanup = done;
}

/* ---------- stage ---------- */

let stage = null;
let index = Math.max(0, SCENES.findIndex((s) => s.id === HERO));
let lastDir = 1; // which way the user is travelling; decides what gets warmed

// Optional stage extras, resolved once the stage exists. crossfadeTo/load both
// SHOW the scene, so a warm load is only possible if stage.js exposes one;
// without it we simply load on navigate and never block the UI on a preload.
let warmScene = null;
let dropScene = null;

function pick(names) {
  for (const n of names) {
    if (stageHas(n)) return (id) => stage[n](id);
  }
  return null;
}

function stageHas(name) {
  return Boolean(stage) && typeof stage[name] === 'function';
}

function pose(p, ms) {
  try {
    stage?.setPose(p, { ms: D(ms) });
  } catch (err) {
    console.warn('[elura] setPose failed', err);
  }
}

function orbit(g) {
  try {
    stage?.setOrbitGain(g);
  } catch (err) {
    console.warn('[elura] setOrbitGain failed', err);
  }
}

/* Boot order is the whole first impression. The chrome is painted and wired
 * BEFORE the hero's ~3MB of plates are awaited: on a phone over cellular that
 * await is 2-4 seconds of a flat sand rectangle with no wordmark, no clock and
 * no CTA — invisible on localhost, which is exactly why it survived testing. The
 * canvas fades up underneath the type when the GL scene finally resolves.
 */
function boot() {
  setGrade(GRADE.landing);
  app.dataset.textMode = SCENES[index].textMode;
  counterEl.textContent = counterLabel(index);
  setDots(index);
  timeChrome(screens.landing, 0, T.chromeIn, T.stagger);
  showScreen('landing', 0);
  // Before the stage: the landing's clock is chrome, and the whole point of the
  // boot order is that the chrome is real before the plates are.
  startClock();
  installInput();
  startStage();
}

async function startStage() {
  try {
    // onSwipe is passed as an option too — stage.js may take it here, expose a
    // registrar, or neither (then we detect the gesture ourselves).
    stage = createStage(canvas, { maxDpr: 2, fps: 60, onSwipe: handleSwipe });
    warmScene = pick(['preload', 'warm', 'prefetch']);
    dropScene = pick(['unload', 'release', 'free']);
    bindStageInput();
    await stage.load(HERO);
    stage.setIdle(true);
    stage.start();
    canvas.setAttribute('data-ready', '');

    // The chrome is live before the plates finish decoding, so the user can have
    // already left the landing by the time we get here. Whatever screen they are
    // actually on owns the camera; only the landing gets the opening shot.
    const screen = current();
    orbit(ORBIT[screen] ?? ORBIT.landing);
    if (screen !== 'landing') {
      pose(POSE[screen] ?? POSE.landing, 1);
      return;
    }

    // Seat the opening pose before the first rendered frame, then commit the push
    // on the frame after the canvas has actually presented — starting the ease in
    // the same tick as the first paint spends most of it behind the canvas fade.
    pose(POSE.landingEnter, 1);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Interruptible on purpose: tapping through the opening shot must feel like
        // impatience being honoured, not like an animation being waited out.
        // setPose re-targets from the CURRENT pose, so an interrupt is seamless.
        if (current() === 'landing') pose(POSE.landing, T.establish);
      });
    });
  } catch (err) {
    // A dead stage must not take the chrome down with it — the prototype still
    // has to be judgeable on layout and motion. Dispose first: the renderer, its
    // GL context and every listener it installed outlive a bare `stage = null`.
    console.warn('[elura] stage unavailable', err);
    try {
      stage?.dispose();
    } catch {
      /* already gone */
    }
    stage = null;
  }
}

/* ---------- screen transitions ---------- */

function current() {
  return app.dataset.screen;
}

// LANDING -> GALLERY. The camera dollies IN (the world comes toward you) while
// the landing chrome is already gone; gallery chrome lands on the moving camera.
function toGallery() {
  const total = Math.max(
    T.camera,
    chromeSpan(screens.gallery, T.enterAt, T.chromeIn, T.stagger),
  );
  beginTransition(total);

  // First, not last: the reachable neighbour then has the whole 1.1s of the
  // transition to download instead of starting after it.
  warmNeighbours(lastDir);

  timeChrome(screens.landing, 0, T.chromeOut, 0);
  timeChrome(screens.gallery, T.enterAt, T.chromeIn, T.stagger);
  showScreen('gallery', T.chromeOut);

  setGrade(GRADE.gallery);
  orbit(ORBIT.gallery);
  pose(POSE.gallery, T.camera);
}

// GALLERY -> LANDING: the exact reverse, same durations.
function toLanding() {
  const total = Math.max(
    T.camera,
    chromeSpan(screens.landing, T.enterAt, T.chromeIn, T.stagger),
  );
  beginTransition(total);

  timeChrome(screens.gallery, 0, T.chromeOut, 0);
  timeChrome(screens.landing, T.enterAt, T.chromeIn, T.stagger);
  showScreen('landing', T.chromeOut);

  setGrade(GRADE.landing);
  orbit(ORBIT.landing);
  pose(POSE.landing, T.camera);
}

// GALLERY -> PREVIEW: everything leaves, the room opens, the clock arrives late.
function toPreview() {
  const total = Math.max(T.camera, T.clockAt + T.chromeIn);
  beginTransition(total);

  timeChrome(screens.gallery, 0, T.previewOut, 0);
  timeChrome(screens.preview, T.clockAt, T.chromeIn, 0);
  showScreen('preview', T.previewOut);

  setGrade(GRADE.preview);
  orbit(ORBIT.preview);
  pose(POSE.preview, T.camera);

  startClock(); // rendered before it fades in, so it is never wrong on arrival
}

// PREVIEW -> GALLERY: mirror of the above — clock out fast, chrome back in so the
// gallery reassembles while the camera is still pulling back.
function toGalleryFromPreview() {
  const total = Math.max(
    T.camera,
    chromeSpan(screens.gallery, T.enterAt, T.chromeIn, T.stagger),
  );
  beginTransition(total);

  timeChrome(screens.preview, 0, T.previewOut, 0);
  timeChrome(screens.gallery, T.enterAt, T.chromeIn, T.stagger);
  showScreen('gallery', T.previewOut);

  setGrade(GRADE.gallery);
  orbit(ORBIT.gallery);
  pose(POSE.gallery, T.camera);

  // PREVIEW has nothing focusable, so a keyboard or switch user arrives back with
  // focus on <body>. Hand it the core action rather than the top of the document.
  at(T.enterAt, () => {
    if (current() === 'gallery') document.getElementById('btn-preview')?.focus?.();
  });
}

/* ---------- scene navigation ---------- */

let sceneToken = 0;
let flipTimer = 0;

// The counter, the dots and the ink flip are ONE callback. Fired separately off
// three timers they disagreed with each other for 366ms behind a texture upload —
// the dot bar said sample 2 while the label still read "Sample 01 / 05".
function applySceneInk(i) {
  crossfadeText(counterEl, counterLabel(i), T.counterOut, T.counterIn);
  setDots(i);

  const mode = SCENES[i].textMode;
  if (app.dataset.textMode === mode) return;
  app.dataset.textMode = mode;
  // The pill's fill and its label are complementary, so interpolating both across
  // the same 900ms crosses a mid-grey where the label vanishes into the fill
  // (measured 1.00:1). They snap together instead, at the bottom of a short dip —
  // the only frame where a costume change is invisible. data-flip owns that beat.
  app.dataset.flip = '';
  window.clearTimeout(flipTimer);
  flipTimer = window.setTimeout(() => app.removeAttribute('data-flip'), Math.max(1, D(T.flipHold)));
}

// A scene change must read as a camera move between two rooms: lean into the
// direction, dissolve mid-lean, then settle back *through* the new scene. The
// dissolve itself carries the incoming room in from the direction of travel
// (stage.js `travel`), so the midpoint is never two full frames at 50%.
function goScene(dir) {
  if (SCENES.length < 2 || !dir) return;
  const next = (index + dir + SCENES.length) % SCENES.length;
  if (next === index) return;

  const total = T.settleAt + T.camera;
  const gen = beginTransition(total);
  const token = ++sceneToken;
  index = next;
  lastDir = dir > 0 ? 1 : -1;

  pose({ panX: 0.18 * lastDir }, T.leanMs);

  let inkDone = false;
  const applyInk = () => {
    if (inkDone || token !== sceneToken) return;
    inkDone = true;
    applySceneInk(next);
  };

  at(T.dissolveAt, () => {
    if (token !== sceneToken) return;
    if (!stage) {
      applyInk(); // no GL: the shell still has to describe the scene it claims to show
      return;
    }
    try {
      const p = stage.crossfadeTo(SCENES[next].id, D(T.dissolve), {
        travel: TRAVEL * lastDir,
        onHalf: applyInk,
      });
      if (p && typeof p.then === 'function') {
        awaitTransition(gen, p);
        // Backstop for a swap that never reached its own 50% frame (superseded by a
        // faster second swipe, or a load that failed): the label must still describe
        // whatever is actually on screen.
        p.then(applyInk, (err) => {
          console.warn('[elura] crossfade failed', err);
          applyInk();
        });
      } else {
        applyInk();
      }
    } catch (err) {
      console.warn('[elura] crossfade failed', err);
      applyInk();
    }
  });

  at(T.settleAt, () => pose({ panX: 0 }, T.settle));
  at(total, () => warmNeighbours(lastDir));
}

// Transient, self-clearing, and NOT part of the resting composition — the text
// budget on the landing is still a clock and two labels.
let noteTimer = 0;
function flashNote(text) {
  if (!noteEl) return;
  noteEl.textContent = text;
  noteEl.classList.add('is-on');
  window.clearTimeout(noteTimer);
  noteTimer = window.setTimeout(() => {
    noteEl.classList.remove('is-on');
  }, 2600);
}

function counterLabel(i) {
  const pad = (n) => String(n).padStart(2, '0');
  return `Sample ${pad(i + 1)} / ${pad(SCENES.length)}`;
}

function setDots(i) {
  dotEls.forEach((dot, j) => {
    const on = j === i;
    dot.classList.toggle('is-active', on);
    dot.setAttribute('aria-current', on ? 'true' : 'false');
  });
}

// --ease is the single source of truth; only fall back if tokens.css is missing.
let cachedEase = '';
function easeToken() {
  if (!cachedEase) {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--ease').trim();
    cachedEase = v || 'cubic-bezier(0.22, 0.61, 0.16, 1)';
  }
  return cachedEase;
}

// Small self-contained crossfade for a text label; WAAPI so it cannot be
// undone by whatever the stylesheet says about this element.
function crossfadeText(el, text, outMs, inMs) {
  if (D(outMs) <= 0 || typeof el.animate !== 'function') {
    el.textContent = text;
    return;
  }
  const ease = easeToken();
  const out = el.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: outMs,
    easing: ease,
    fill: 'forwards',
  });
  fades.push(out);
  out.finished
    .then(() => {
      el.textContent = text;
      // fill backwards: the incoming fade must own opacity from the instant it is
      // created, or cancelling the outgoing one exposes the element at full
      // opacity for the frame in between — a flash exactly at the swap.
      const back = el.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: inMs,
        easing: ease,
        fill: 'backwards',
      });
      fades.push(back);
      out.cancel();
    })
    .catch(() => {});
}

// Warm ONE scene — the next one in the direction of travel — and drop everything
// else. stage.js holds two slots now (a cherry/latte/nila slot is ~27MB of texture
// and mochi is ~48MB; three resident slots peaked past 190MB during a dissolve,
// at or past a mid-range Android WebView's budget). Warming both neighbours into
// a two-slot cache only evicted one of them unused.
function warmNeighbours(dir) {
  if (!stage) return;
  const step = dir > 0 ? 1 : -1;
  const ring = (i) => (i + SCENES.length) % SCENES.length;
  const keep = new Set([index, ring(index + step)].map((i) => SCENES[i].id));

  if (warmScene) {
    for (const id of keep) {
      if (id === SCENES[index].id || stage.isLoaded?.(id)) continue;
      try {
        Promise.resolve(warmScene(id)).catch(() => {});
      } catch {
        /* preload is best-effort by definition */
      }
    }
  }

  if (!dropScene) return;
  for (const s of SCENES) {
    if (keep.has(s.id)) continue;
    if (stage.isLoaded?.(s.id) === false) continue;
    try {
      dropScene(s.id);
    } catch {
      /* ignore */
    }
  }
}

/* ---------- clock (landing + preview) ---------- */

let clockTimer = 0;

function renderClock() {
  const now = new Date();
  // Device locale, deliberately: a fixed foreign locale put "8월 17일 월요일" under
  // an all-English product, on the screens whose entire job is to look like a
  // finished lock screen. This way the clock always matches the phone judging it.
  const time = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
  const date = new Intl.DateTimeFormat(undefined, {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(now);
  const iso = now.toISOString();

  for (const face of clockFaces) {
    face.time.textContent = time;
    face.date.textContent = date;
    face.time.setAttribute('datetime', iso);
    // Announced once, on arrival, by the label — never re-announced. An aria-live
    // clock reads itself out every 15s, the opposite of what these screens sell.
    face.group?.setAttribute('aria-label', `${time}, ${date}`);
  }
}

// One interval for both faces, running for as long as the tab is visible: the
// landing carries a clock now, so there is no screen without one except GALLERY,
// and a 15s timer is not worth starting and stopping around it.
function startClock() {
  renderClock();
  if (clockTimer) return;
  clockTimer = window.setInterval(renderClock, 15000);
}

function stopClock() {
  window.clearInterval(clockTimer);
  clockTimer = 0;
}

/* ---------- input ---------- */

// iOS needs a real user gesture before it will hand over DeviceOrientation, and
// it must be requested synchronously inside the handler. Both landing actions are
// equal, so both are valid gestures — whichever the user reaches for first.
function claimSensors() {
  try {
    const r = stage?.enableSensors();
    if (r && typeof r.catch === 'function') r.catch(() => {});
  } catch {
    /* sensors are a bonus, never a requirement */
  }
}

function installInput() {
  document.getElementById('btn-try').addEventListener('click', () => {
    if (isTransitioning || current() !== 'landing') return;
    // No permission screen, and a refusal is never mentioned — drag gives the
    // same parallax.
    claimSensors();
    toGallery();
  });

  // Equal weight, but only one of the two has a destination in this prototype.
  // A dead tap on a button that looks exactly as live as its twin would read as a
  // bug and contaminate the thing being judged, so it says so — quietly, and only
  // while it is being asked.
  document.getElementById('btn-make').addEventListener('click', () => {
    if (isTransitioning || current() !== 'landing') return;
    claimSensors();
    flashNote('Upload is not in this prototype yet.');
  });

  document.getElementById('btn-back').addEventListener('click', () => {
    if (isTransitioning || current() !== 'gallery') return;
    toLanding();
  });

  document.getElementById('btn-preview').addEventListener('click', () => {
    if (isTransitioning || current() !== 'gallery') return;
    toPreview();
  });

  document.getElementById('btn-prev').addEventListener('click', () => {
    if (isTransitioning || current() !== 'gallery') return;
    goScene(-1);
  });

  document.getElementById('btn-next').addEventListener('click', () => {
    if (isTransitioning || current() !== 'gallery') return;
    goScene(1);
  });

  // The dots were a 44px inert strip that looked interactive and swallowed swipes.
  // They are the second, more precise way to reach a scene — the funnel wants that.
  dotEls.forEach((dot, j) => {
    dot.addEventListener('click', () => {
      if (isTransitioning || current() !== 'gallery' || j === index) return;
      goScene(shortestStep(index, j));
    });
  });

  // Inert in this prototype: they exist so the funnel reads correctly.
  for (const id of ['btn-apply', 'landing-account', 'gallery-account']) {
    document.getElementById(id)?.addEventListener('click', (e) => e.preventDefault());
  }

  // PREVIEW has no focusable element and its own exit is a tap on the canvas, so
  // without this a keyboard or switch-control user is trapped there for the session.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (current() === 'preview' && !isTransitioning) toGalleryFromPreview();
    else if (current() === 'gallery' && !isTransitioning) toLanding();
  });

  installSwipeAndTap();
}

// One step per call keeps the swap reading as travel; jumping the ring the short
// way is what a dot press means.
function shortestStep(from, to) {
  const n = SCENES.length;
  const fwd = (to - from + n) % n;
  return fwd <= n - fwd ? fwd : fwd - n;
}

function bindStageInput() {
  // stage.js owns pointer drag; if it also reports swipes, use its report.
  if (stageHas('onSwipe')) stage.onSwipe(handleSwipe);
  else if (stage && 'onSwipe' in stage) stage.onSwipe = handleSwipe;
}

function handleSwipe(v) {
  if (isTransitioning || current() !== 'gallery') return;
  // +1 / 'left' = finger travelled left = advance.
  const dir = typeof v === 'string' ? (v === 'left' ? 1 : -1) : Number(v) >= 0 ? 1 : -1;
  goScene(dir);
}

function installSwipeAndTap() {
  let id = null;
  let sx = 0;
  let sy = 0;
  let st = 0;
  let onCanvas = false;

  // Passive + capture: we only observe. The stage's own drag is never blocked.
  app.addEventListener(
    'pointerdown',
    (e) => {
      id = e.pointerId;
      sx = e.clientX;
      sy = e.clientY;
      st = e.timeStamp;
      onCanvas = e.target === canvas;
    },
    { passive: true, capture: true },
  );

  app.addEventListener(
    'pointerup',
    (e) => {
      if (e.pointerId !== id) return;
      id = null;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      const dt = e.timeStamp - st;

      // Tap anywhere leaves PREVIEW. Buttons are the only chrome elsewhere, and
      // this never fires on them because PREVIEW has none.
      if (current() === 'preview') {
        if (Math.hypot(dx, dy) < 12 && dt < 600 && !isTransitioning) toGalleryFromPreview();
        return;
      }

      // stage.js only sees gestures that reach the canvas. A swipe that starts on a
      // button — the dots sit in a strip right across the bottom — never got there
      // and silently did nothing. This detector covers exactly that gap, and stands
      // down for canvas gestures so one swipe can never advance the gallery twice.
      if (onCanvas && stage) return;
      if (current() !== 'gallery') return;
      if (dt > 700 || Math.abs(dx) < 44 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      handleSwipe(dx < 0 ? 1 : -1);
    },
    { passive: true, capture: true },
  );

  app.addEventListener('pointercancel', () => {
    id = null;
  }, { passive: true, capture: true });
}

/* ---------- lifecycle ---------- */

// resize/orientationchange are stage.js's own (it binds window + visualViewport +
// orientationchange). A second set here ran every setSize, updateProjectionMatrix
// and applyCover pass twice on the device that can least afford it.

// Battery: a wallpaper nobody is looking at must not render.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stage?.stop();
    stopClock();
    return;
  }
  stage?.start();
  startClock();
});

window.addEventListener('pagehide', () => stage?.stop());

boot();
