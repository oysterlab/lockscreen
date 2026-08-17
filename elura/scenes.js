/**
 * ELURA scene catalog.
 *
 * Assets live at ./assets/photo3d_<id>/. `textMode` is the ink the UI must use
 * over that scene — the grade veil is tuned per mode so text sits directly on
 * the image with no card behind it.
 *
 * ORDER IS THE CONTENT DECISION. The catalog is really two dioramas: a cream
 * studio alcove (atelier, mochi) and a Korean alley at golden hour (cherry,
 * latte, nila). Listed in that grouping, the first swipe — the very first TRY
 * interaction — dissolved one white cat into another white cat in the same room
 * and read as a cheap opacity fade. Alternating the two rooms means every step
 * is a visible change of place, which is what the dissolve was built to sell.
 * Five slots over two rooms forces exactly one alley->alley adjacency; it is
 * spent on latte->nila, the largest light change inside that room (golden hour
 * into evening).
 *
 * `optional` declares which non-required files that scene actually ships, so
 * stage.js requests only what exists instead of discovering it by 404.
 */

export const SCENES = [
  { id: 'atelier_parallax', title: 'Atelier',        textMode: 'dark'  },
  { id: 'cherry2dio',       title: 'Cherry Alley',   textMode: 'light' },
  { id: 'mochi2dio',        title: 'Morning Window', textMode: 'dark'  },
  { id: 'latte2dio',        title: 'Golden Hour',    textMode: 'light' },
  { id: 'nila2dio',         title: 'Evening Market', textMode: 'light' },
];

export const HERO = 'atelier_parallax';
