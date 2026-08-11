#!/usr/bin/env node
/**
 * Parses the hand-authored walkability reference image
 * (`~/Downloads/walkable.png`, a COLS x ROWS grid overlay on the office floor
 * plan, where COLS/ROWS are derived from FRAME_WIDTH/FRAME_HEIGHT / CELL)
 * into a precise walkability grid, then applies a wall-ring safety backstop
 * (since the reference doesn't reliably tint room perimeter walls) and
 * writes the final grid to `src/data/officeWalkabilityGrid.ts`.
 *
 * Run from repo root:   node app/scripts/parse-walkable.cjs
 * Or from app/:         node scripts/parse-walkable.cjs
 *
 * Also renders two visual-verification overlays into the scratchpad dir:
 *   - verify-on-reference.png  — raw (pre-backstop) classification tinted
 *     back onto the ORIGINAL reference image, to sanity-check calibration.
 *   - verify-on-real-assets.png — FINAL (post-backstop) grid tinted onto a
 *     composite of the real in-app floor + room PNGs, to sanity-check that
 *     the reference image's grid maps cleanly onto our actual asset layout.
 */

const path = require("path");
const fs = require("fs");
const sharp = require("sharp");

const APP_ROOT = path.resolve(__dirname, "..");
const SCRATCH_DIR =
  "/private/tmp/claude-501/-Users-lekoffshorly-Documents-AI-Agents/f4180366-d29e-4b9e-9039-719645f82eb3/scratchpad";

const REFERENCE_PNG = "/Users/lekoffshorly/Downloads/walkable.png";
const MANIFEST_PATH = path.join(APP_ROOT, "src", "data", "office-assets-manifest.json");
const OUT_TS_PATH = path.join(APP_ROOT, "src", "data", "officeWalkabilityGrid.ts");

// COLS/ROWS derive from the real office frame size (see office-layout.ts
// FRAME_WIDTH/FRAME_HEIGHT) divided by CELL, so changing CELL alone
// re-derives the grid dimensions correctly instead of leaving them stale.
const FRAME_WIDTH = 1440;
const FRAME_HEIGHT = 1244;

// The BASELINE_CAL rect below was authored (hand-measured) against a 1x
// (frame-sized) reference export. If Bon re-exports walkable.png at a
// different resolution, resolveCalibration() rescales BASELINE_CAL by the
// actual image dimensions vs. this baseline, rather than hardcoding a fixed
// scale factor.
const REFERENCE_BASELINE_WIDTH = FRAME_WIDTH;
const REFERENCE_BASELINE_HEIGHT = FRAME_HEIGHT;

const CELL = 32;
const COLS = Math.ceil(FRAME_WIDTH / CELL);
const ROWS = Math.ceil(FRAME_HEIGHT / CELL);

// ---- Calibration rect within walkable.png (see task brief) --------------
// Adjust these if the Step-1 self-check overlay shows drift.
const BASELINE_CAL = { x0: 36, y0: 31, x1: 1264, y1: 1045 };

// ---- Legend reference colors ---------------------------------------------
const LEGEND_RGB = {
  G: [146, 197, 117], // walkable
  R: [223, 74, 76], // blocked
  B: [56, 136, 233], // interaction
  Y: [249, 205, 57], // door
  P: [150, 80, 200], // purple — stand-here
};

function rgb2hsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return [h, s, v];
}

function hueDist(h1, h2) {
  const d = Math.abs(h1 - h2) % 360;
  return d > 180 ? 360 - d : d;
}

const LEGEND_HSV = Object.fromEntries(
  Object.entries(LEGEND_RGB).map(([k, v]) => [k, rgb2hsv(...v)]),
);

// Classification thresholds. NOTE: these were arrived at empirically, not
// from the initial ~2400 squared-RGB-distance suggestion. The reference
// image applies its color tint as a semi-transparent overlay blended over
// the underlying art, which shifts blended pixels far from the pure legend
// swatch RGB whenever the underlying art is dark/saturated itself (e.g. the
// central-hub statue's dark red pedestal lands ~5800 squared-RGB-units from
// pure legend RED). A hue+saturation classifier is far more robust to this
// alpha-blend brightness shift than a fixed RGB-distance threshold:
//   - SAT_MIN excludes low-saturation grays/tans (untinted walls, wood trim,
//     pavement, the central-hub's untinted beige floor) from ever matching a
//     legend hue, no matter how close their hue happens to land.
//   - HUE_TOL is set below half the smallest gap between adjacent legend
//     hues (~47° between RED and YELLOW) so the four buckets never overlap.
const SAT_MIN = 0.3;
const HUE_TOL = 15;

function classifyPixel(rgb) {
  const [h, s] = rgb2hsv(...rgb);
  if (s < SAT_MIN) return null;
  let best = null;
  let bestDist = Infinity;
  for (const [k, hsv] of Object.entries(LEGEND_HSV)) {
    const d = hueDist(h, hsv[0]);
    if (d < bestDist) {
      bestDist = d;
      best = k;
    }
  }
  return bestDist <= HUE_TOL ? best : null;
}

// Tie-break / drown-out precedence: doors and interaction points are
// smaller, higher-signal features that must not be swamped by the
// surrounding green/red majority. Empirically, a real door can occupy well
// under half of a cell's 81 samples (e.g. executive-room's bottom door
// measured 36 Y votes vs 45 G votes — a clear, unambiguous door signal that
// a plain plurality vote would still call "green"). So precedence is applied
// as a priority scan with a significance floor, not just an exact-tie
// breaker: the highest-precedence color that clears SIGNIFICANCE_MIN wins
// outright, even if a lower-precedence color has more raw votes. Only when
// no color clears the floor do we fall back to plain plurality.
const PRECEDENCE = ["Y", "B", "P", "R", "G"];
const SIGNIFICANCE_MIN_FRACTION = 0.12; // ~10 of 81 samples

function classifyCell(samples) {
  const votes = { G: 0, R: 0, B: 0, Y: 0, P: 0 };
  let classifiedCount = 0;
  let sumRGB = 0;
  for (const rgb of samples) {
    sumRGB += rgb[0] + rgb[1] + rgb[2];
    const k = classifyPixel(rgb);
    if (k) {
      votes[k]++;
      classifiedCount++;
    }
  }
  const total = samples.length;
  const meanSum = sumRGB / total;

  if (classifiedCount / total < 0.15) {
    // Brightness fallback — mostly uncolored cell (e.g. central-hub's
    // untinted beige floor, or the outer border).
    return meanSum < 110 ? "#" : ".";
  }

  const SYMBOL = { G: ".", R: "#", B: "o", Y: "+", P: "s" };
  const significanceMin = SIGNIFICANCE_MIN_FRACTION * total;
  for (const k of PRECEDENCE) {
    if (votes[k] >= significanceMin) return SYMBOL[k];
  }

  // No color clears the significance floor — plain plurality.
  let winner = null;
  let winnerVotes = -1;
  for (const k of PRECEDENCE) {
    if (votes[k] > winnerVotes) {
      winnerVotes = votes[k];
      winner = k;
    }
  }
  return SYMBOL[winner];
}

async function loadRawRGB(pngPath) {
  const { data, info } = await sharp(pngPath).raw().toBuffer({ resolveWithObject: true });
  return { data, info };
}

function makeSampler({ data, info }) {
  const { width, height, channels } = info;
  return function samplePixel(x, y) {
    const cx = Math.min(width - 1, Math.max(0, Math.round(x)));
    const cy = Math.min(height - 1, Math.max(0, Math.round(y)));
    const idx = (cy * width + cx) * channels;
    return [data[idx], data[idx + 1], data[idx + 2]];
  };
}

function cellCenter(cx, cy, calib) {
  return {
    x: calib.CAL.x0 + (cx + 0.5) * calib.cellW,
    y: calib.CAL.y0 + (cy + 0.5) * calib.cellH,
  };
}

function linspace(lo, hi, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(lo + ((hi - lo) * i) / (n - 1));
  return out;
}

// Derives the runtime calibration rect + per-cell sampling offsets from the
// ACTUAL reference image dimensions, scaling BASELINE_CAL (authored against
// a 1x/frame-sized export) by whatever export resolution Bon actually used.
// This keeps the pipeline robust to future resolution bumps instead of
// requiring a hardcoded scale factor.
function resolveCalibration(imgWidth, imgHeight) {
  const scaleX = imgWidth / REFERENCE_BASELINE_WIDTH;
  const scaleY = imgHeight / REFERENCE_BASELINE_HEIGHT;

  console.log("Reference", `${imgWidth}x${imgHeight}`, "scaleX", scaleX, "scaleY", scaleY);

  if (Math.abs(scaleX - scaleY) / scaleX > 0.01) {
    console.warn(
      `WARNING: non-uniform scale detected (scaleX=${scaleX}, scaleY=${scaleY}). ` +
        "This may indicate a reframe or aspect-ratio change in the new reference export — verify overlays carefully.",
    );
  }

  const CAL = {
    x0: BASELINE_CAL.x0 * scaleX,
    x1: BASELINE_CAL.x1 * scaleX,
    y0: BASELINE_CAL.y0 * scaleY,
    y1: BASELINE_CAL.y1 * scaleY,
  };

  if (CAL.x1 > imgWidth || CAL.y1 > imgHeight) {
    throw new Error(
      `Calibration rect (${JSON.stringify(CAL)}) exceeds reference image bounds (${imgWidth}x${imgHeight}). ` +
        "Reference image resolution is too small to hold the scaled calibration rect.",
    );
  }

  const cellW = (CAL.x1 - CAL.x0) / COLS;
  const cellH = (CAL.y1 - CAL.y0) / ROWS;

  // Sample offsets spread across ~84% of the cell's width/height (9 steps per
  // axis => 81 samples), NOT a fixed literal 9-adjacent-pixel neighborhood.
  // Reference-image door/interaction bands are thin (observed ~15px tall
  // against a ~26px cell) and are sometimes drawn off-center or straddling a
  // cell boundary (e.g. executive-room's bottom door sits mostly in the lower
  // half of its cell) — a tight ±4px window centered exactly on the cell
  // centroid missed it almost entirely. Spreading samples across most of the
  // cell's footprint instead reliably catches off-center thin features while
  // still avoiding the very edge (grid-line/anti-aliasing) pixels.
  const DX_OFFSETS = linspace(-cellW * 0.42, cellW * 0.42, 9);
  const DY_OFFSETS = linspace(-cellH * 0.42, cellH * 0.42, 9);

  return { CAL, cellW, cellH, DX_OFFSETS, DY_OFFSETS };
}

async function classifyReferenceGrid(calib) {
  const raw = await loadRawRGB(REFERENCE_PNG);
  const sample = makeSampler(raw);

  const grid = [];
  for (let cy = 0; cy < ROWS; cy++) {
    const row = [];
    for (let cx = 0; cx < COLS; cx++) {
      const { x, y } = cellCenter(cx, cy, calib);
      const samples = [];
      for (const dy of calib.DY_OFFSETS) {
        for (const dx of calib.DX_OFFSETS) {
          samples.push(sample(x + dx, y + dy));
        }
      }
      row.push(classifyCell(samples));
    }
    grid.push(row);
  }
  return grid;
}

// ---- Step 2: hybrid wall-ring backstop ------------------------------------
//
// A literal "block the whole rect perimeter except cells Step-1 already
// classified '+'" turns out to be too narrow: measured against the actual
// reference, several rooms' yellow door markers do NOT sit exactly on the
// rect's ring — they sit 1-2 cells into the exterior corridor (matching this
// codebase's own pre-existing convention of "door point is just outside the
// room's box", see the old `walkable-zones.ts` ROOM_DOORS comment) or,
// occasionally, drift a cell inward. A literal implementation would reseal
// ai-room entirely (its only marked door lands one cell outside its rect)
// and several other rooms besides.
//
// So: for each room, gather nearby raw '+' cells (within PAD cells of the
// rect), reject any that are more than PAD cells from every wall (that's
// interior decor, not a door) or that fall inside a DIFFERENT room's own
// rect (avoids attributing a neighbor's door to this room), then project
// each survivor onto its nearest wall line and open that ring cell. When two
// rooms both consider the same candidate (their padded search windows
// overlap in a shared corridor), only the room with the smaller
// projection distance keeps it.
const DOOR_SEARCH_PAD = 2;

function computeRoomRect(room) {
  return {
    id: room.id,
    cx1: Math.floor(room.x / CELL),
    cy1: Math.floor(room.y / CELL),
    cx2: Math.floor((room.x + room.width) / CELL),
    cy2: Math.floor((room.y + room.height) / CELL),
  };
}

function projectOntoWall(rect, cx, cy) {
  const distTop = Math.abs(cy - rect.cy1);
  const distBottom = Math.abs(cy - rect.cy2);
  const distLeft = Math.abs(cx - rect.cx1);
  const distRight = Math.abs(cx - rect.cx2);
  const minDist = Math.min(distTop, distBottom, distLeft, distRight);

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  if (minDist === distTop || minDist === distBottom) {
    const carveRow = minDist === distTop ? rect.cy1 : rect.cy2;
    const carveCol = clamp(cx, rect.cx1, rect.cx2);
    return { carveRow, carveCol, minDist };
  }
  const carveCol = minDist === distLeft ? rect.cx1 : rect.cx2;
  const carveRow = clamp(cy, rect.cy1, rect.cy2);
  return { carveRow, carveCol, minDist };
}

function applyWallRingBackstop(rawGrid, manifest) {
  const g = rawGrid.map((row) => row.slice());

  // 1. Outer frame border always blocked.
  for (let cx = 0; cx < COLS; cx++) {
    g[0][cx] = "#";
    g[ROWS - 1][cx] = "#";
  }
  for (let cy = 0; cy < ROWS; cy++) {
    g[cy][0] = "#";
    g[cy][COLS - 1] = "#";
  }

  const allRooms = manifest.filter((l) => l.kind === "room");
  const ringedRooms = allRooms.filter((l) => l.id !== "central-hub").map(computeRoomRect);
  const allRects = allRooms.map(computeRoomRect);

  function insideRect(cx, cy, rect) {
    return cx >= rect.cx1 && cx <= rect.cx2 && cy >= rect.cy1 && cy <= rect.cy2;
  }

  // Resolve door-candidate ownership across all rooms: cx,cy -> { minDist }
  const doorCells = new Map(); // key "cx,cy" -> minDist of the winning claim

  for (const rect of ringedRooms) {
    const yLo = Math.max(0, rect.cy1 - DOOR_SEARCH_PAD);
    const yHi = Math.min(ROWS - 1, rect.cy2 + DOOR_SEARCH_PAD);
    const xLo = Math.max(0, rect.cx1 - DOOR_SEARCH_PAD);
    const xHi = Math.min(COLS - 1, rect.cx2 + DOOR_SEARCH_PAD);

    for (let cy = yLo; cy <= yHi; cy++) {
      for (let cx = xLo; cx <= xHi; cx++) {
        if (rawGrid[cy][cx] !== "+") continue;
        // Skip markers that belong to a different room's own interior.
        if (allRects.some((r) => r.id !== rect.id && insideRect(cx, cy, r))) continue;

        const { carveRow, carveCol, minDist } = projectOntoWall(rect, cx, cy);
        if (minDist > DOOR_SEARCH_PAD) continue; // too deep inside to be a door

        // The outer frame border (map edge) is never a real door — there is
        // nothing beyond it to walk into. A handful of rooms sit flush
        // against the building's outer edge (e.g. ai-room's left wall is
        // col 0) and their wall art sometimes contains a hue/sat match
        // (equipment icons, etc.) that reads as a false '+' there; without
        // this guard it would get carved open onto the void.
        const onOuterBorder = carveCol === 0 || carveCol === COLS - 1 || carveRow === 0 || carveRow === ROWS - 1;
        if (onOuterBorder) continue;

        const key = `${carveCol},${carveRow}`;
        const existing = doorCells.get(key);
        if (existing === undefined || minDist < existing) {
          doorCells.set(key, minDist);
        }
      }
    }
  }

  for (const key of doorCells.keys()) {
    const [cx, cy] = key.split(",").map(Number);
    g[cy][cx] = "+";
  }

  // 2. Per-room perimeter wall ring (skip central-hub, an open atrium).
  for (const rect of ringedRooms) {
    const stamp = (cx, cy) => {
      if (cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS) return;
      if (g[cy][cx] === "+" || g[cy][cx] === "s") return; // never overwrite a door or hand-painted stand cell
      g[cy][cx] = "#";
    };

    for (let cx = rect.cx1; cx <= rect.cx2; cx++) {
      stamp(cx, rect.cy1);
      stamp(cx, rect.cy2);
    }
    for (let cy = rect.cy1; cy <= rect.cy2; cy++) {
      stamp(rect.cx1, cy);
      stamp(rect.cx2, cy);
    }
  }

  // 3. Connectivity guarantee pass — a room's furniture layout can leave its
  // own door cell disconnected from its main interior floor (verified: this
  // happened for ai-room, whose right-wall door sits behind a furniture
  // column with no classified gap reaching the table area). Rather than
  // hand-tune furniture rects room by room, drill the shortest possible
  // corridor (0-1 BFS: walkable cells cost 0, blocked cells cost 1, confined
  // to the room's own rect) from each room's door(s) to its LARGEST interior
  // walkable component, converting only the blocked cells on that minimal
  // path to walkable. A no-op for rooms already connected.
  for (const rect of ringedRooms) {
    connectRoomInterior(g, rect);
  }

  // 3.5. Global door-connectivity guarantee — see connectDoorsToMainRegion
  // doc comment. Anchor is the same known-open corridor cell (world px
  // 500,790 -> cell 15,24) used by the officeGrid connectivity tests.
  connectDoorsToMainRegion(g, { cx: 15, cy: 24 });

  // 4. Re-assert the outer frame border as an absolute final rule — no door
  // detection or connectivity fix above is allowed to reopen the map edge.
  for (let cx = 0; cx < COLS; cx++) {
    g[0][cx] = "#";
    g[ROWS - 1][cx] = "#";
  }
  for (let cy = 0; cy < ROWS; cy++) {
    g[cy][0] = "#";
    g[cy][COLS - 1] = "#";
  }

  return g;
}

function connectRoomInterior(g, rect) {
  const DEBUG = process.env.DEBUG_CONNECT === rect.id;
  const key = (cx, cy) => `${cx},${cy}`;

  const doorCells = [];
  for (let cx = rect.cx1; cx <= rect.cx2; cx++) {
    if (g[rect.cy1][cx] === "+") doorCells.push([cx, rect.cy1]);
    if (g[rect.cy2][cx] === "+") doorCells.push([cx, rect.cy2]);
  }
  for (let cy = rect.cy1; cy <= rect.cy2; cy++) {
    if (g[cy][rect.cx1] === "+") doorCells.push([rect.cx1, cy]);
    if (g[cy][rect.cx2] === "+") doorCells.push([rect.cx2, cy]);
  }
  if (DEBUG) console.log(rect.id, "doorCells", doorCells);
  if (doorCells.length === 0) return; // no door found at all — nothing to bridge

  // Interior walkable cells, strictly inside the ring.
  const interior = [];
  for (let cy = rect.cy1 + 1; cy < rect.cy2; cy++) {
    for (let cx = rect.cx1 + 1; cx < rect.cx2; cx++) {
      if (g[cy][cx] === "." || g[cy][cx] === "+" || g[cy][cx] === "s") interior.push([cx, cy]);
    }
  }
  if (DEBUG) console.log(rect.id, "interior count", interior.length);
  if (interior.length === 0) return; // no floor at all — nothing to bridge to

  // Connected components among interior walkable cells only.
  const walkableSet = new Set(interior.map(([cx, cy]) => key(cx, cy)));
  const compId = new Map();
  const compSize = [];
  const dirs4 = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const [cx, cy] of interior) {
    const k = key(cx, cy);
    if (compId.has(k)) continue;
    let size = 0;
    const stack = [[cx, cy]];
    compId.set(k, compSize.length);
    while (stack.length) {
      const [x, y] = stack.pop();
      size++;
      for (const [dx, dy] of dirs4) {
        const nk = key(x + dx, y + dy);
        if (!walkableSet.has(nk) || compId.has(nk)) continue;
        compId.set(nk, compSize.length);
        stack.push([x + dx, y + dy]);
      }
    }
    compSize.push(size);
  }
  // Bridge the door(s) to EVERY significant interior floor component, not
  // just the largest one — a room can have multiple disconnected interior
  // regions (e.g. reception-room: a 94-cell region connected to the
  // corridor and a separate 61-cell region behind the counter/railing,
  // rows 27-31). Bridging only the largest left the other component's seats
  // (e.g. arisha's) in an isolated pocket unreachable from the door, which
  // findPath's old straight-line fallback then papered over with a raw line
  // through the wall. "Significant" excludes 1-2 cell classification noise.
  const MIN_SIGNIFICANT_COMPONENT = 3;
  const significantComponentIds = compSize
    .map((size, id) => ({ id, size }))
    .filter(({ size }) => size >= MIN_SIGNIFICANT_COMPONENT)
    .map(({ id }) => id);
  if (DEBUG) console.log(rect.id, "compSize", compSize, "significantComponentIds", significantComponentIds);

  const inBounds = (cx, cy) => cx >= rect.cx1 && cx <= rect.cx2 && cy >= rect.cy1 && cy <= rect.cy2;

  // Plain Dijkstra (0/1 edge weights) from the door cells to the nearest cell
  // in a given target component. Room rects are small (well under a few
  // hundred cells), so an O(n^2) scan-for-min is simple and plenty fast — no
  // need for a proper deque/heap here.
  function bridgeDoorsToComponent(targetSet) {
    const dist = new Map();
    const prev = new Map();
    const visited = new Set();
    for (const [cx, cy] of doorCells) {
      const k = key(cx, cy);
      if (!dist.has(k)) dist.set(k, 0);
    }

    let reachedKey = null;
    for (;;) {
      let curKey = null;
      let curDist = Infinity;
      for (const [k, d] of dist.entries()) {
        if (visited.has(k)) continue;
        if (d < curDist) {
          curDist = d;
          curKey = k;
        }
      }
      if (curKey === null) break; // exhausted reachable set within the rect
      visited.add(curKey);
      if (targetSet.has(curKey)) {
        reachedKey = curKey;
        break;
      }
      const [x, y] = curKey.split(",").map(Number);
      for (const [dx, dy] of dirs4) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(nx, ny)) continue;
        const nk = key(nx, ny);
        if (visited.has(nk)) continue;
        const stepCost = g[ny][nx] === "." || g[ny][nx] === "+" || g[ny][nx] === "s" ? 0 : 1;
        const nd = curDist + stepCost;
        if (!dist.has(nk) || nd < dist.get(nk)) {
          dist.set(nk, nd);
          prev.set(nk, curKey);
        }
      }
    }
    if (!reachedKey) return; // shouldn't happen — room rect is a bounded finite search

    let cur = reachedKey;
    while (prev.has(cur)) {
      const [cx, cy] = cur.split(",").map(Number);
      if (g[cy][cx] === "#" || g[cy][cx] === "o") g[cy][cx] = ".";
      cur = prev.get(cur);
    }
  }

  for (const compIdToBridge of significantComponentIds) {
    const targetSet = new Set(
      [...compId.entries()].filter(([, v]) => v === compIdToBridge).map(([k]) => k),
    );
    bridgeDoorsToComponent(targetSet);
  }
}

// ---- Step 3.5: global door-connectivity guarantee -------------------------
//
// Even after per-room interior bridging, a door cell can itself remain
// disconnected from the main floor's flood-fill region — confirmed for 13
// door ('+') cells across several rooms. This happens when the cell(s)
// immediately OUTSIDE the room's wall ring (in the shared corridor) are
// themselves blocked (e.g. another room's wall ring sits back-to-back with
// this one, or the corridor art itself classified as furniture there),
// so the door opens onto a dead pocket rather than the corridor. Rather than
// hand-diagnose each of the 13 cases, run a generic global fix: flood-fill
// from a known-open corridor anchor, then for every door cell not in that
// region, carve the shortest possible corridor (0/1-weighted Dijkstra over
// the WHOLE grid, excluding the outer border) from the door to the nearest
// cell already in the main region, converting only blocked '#' cells along
// that path to walkable. Repeats until no isolated doors remain (a single
// pass suffices in practice since each carve directly joins the main region).
function connectDoorsToMainRegion(g, anchor) {
  const key = (cx, cy) => `${cx},${cy}`;
  const dirs4 = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  function floodFillMain() {
    const seen = new Set();
    if (g[anchor.cy][anchor.cx] !== "." && g[anchor.cy][anchor.cx] !== "+" && g[anchor.cy][anchor.cx] !== "s")
      return seen;
    const stack = [[anchor.cx, anchor.cy]];
    seen.add(key(anchor.cx, anchor.cy));
    while (stack.length) {
      const [x, y] = stack.pop();
      for (const [dx, dy] of dirs4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
        const nk = key(nx, ny);
        if (seen.has(nk)) continue;
        if (g[ny][nx] !== "." && g[ny][nx] !== "+" && g[ny][nx] !== "s") continue;
        seen.add(nk);
        stack.push([nx, ny]);
      }
    }
    return seen;
  }

  for (let guard = 0; guard < 20; guard++) {
    const mainRegion = floodFillMain();
    const isolatedDoors = [];
    for (let cy = 0; cy < ROWS; cy++) {
      for (let cx = 0; cx < COLS; cx++) {
        if (g[cy][cx] === "+" && !mainRegion.has(key(cx, cy))) isolatedDoors.push([cx, cy]);
      }
    }
    if (isolatedDoors.length === 0) return;

    for (const [dcx, dcy] of isolatedDoors) {
      // 0/1 Dijkstra from this door to the nearest main-region cell, over the
      // whole grid but never touching the 1-cell outer border.
      const dist = new Map([[key(dcx, dcy), 0]]);
      const prev = new Map();
      const visited = new Set();
      let reachedKey = null;
      for (;;) {
        let curKey = null;
        let curDist = Infinity;
        for (const [k, d] of dist.entries()) {
          if (visited.has(k)) continue;
          if (d < curDist) {
            curDist = d;
            curKey = k;
          }
        }
        if (curKey === null) break;
        visited.add(curKey);
        if (mainRegion.has(curKey)) {
          reachedKey = curKey;
          break;
        }
        const [x, y] = curKey.split(",").map(Number);
        for (const [dx, dy] of dirs4) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx <= 0 || nx >= COLS - 1 || ny <= 0 || ny >= ROWS - 1) continue; // never touch outer border
          const nk = key(nx, ny);
          if (visited.has(nk)) continue;
          // '#' (furniture/wall) and 'o' (interaction marker) are both
          // carveable blocked cells here — treat both as cost-1 steps so a
          // shortest path through an 'o' cell can actually be opened below
          // (matches connectRoomInterior's carve semantics).
          const stepCost = g[ny][nx] === "." || g[ny][nx] === "+" || g[ny][nx] === "s" ? 0 : 1;
          const nd = curDist + stepCost;
          if (!dist.has(nk) || nd < dist.get(nk)) {
            dist.set(nk, nd);
            prev.set(nk, curKey);
          }
        }
      }
      if (!reachedKey) continue; // shouldn't happen on a bounded finite grid

      let cur = reachedKey;
      while (prev.has(cur)) {
        const [cx, cy] = cur.split(",").map(Number);
        if (g[cy][cx] === "#" || g[cy][cx] === "o") g[cy][cx] = ".";
        cur = prev.get(cur);
      }
    }
  }
}

function gridToRows(grid) {
  return grid.map((row) => row.join(""));
}

// ---- Overlay rendering (visual verification) ------------------------------
const OVERLAY_RGBA = {
  ".": [76, 175, 80, 102], // green, ~40% opacity (102/255)
  "#": [244, 67, 54, 102], // red
  o: [33, 150, 243, 102], // blue
  "+": [255, 193, 7, 102], // yellow/amber
  s: [156, 39, 176, 102], // purple — stand-here
};

async function renderOverlayOnReference(grid, outPath, calib) {
  const base = sharp(REFERENCE_PNG);
  const meta = await base.metadata();
  const overlays = [];
  for (let cy = 0; cy < ROWS; cy++) {
    for (let cx = 0; cx < COLS; cx++) {
      const sym = grid[cy][cx];
      const [r, g, b, a] = OVERLAY_RGBA[sym];
      const w = Math.ceil(calib.cellW);
      const h = Math.ceil(calib.cellH);
      const tile = await sharp({
        create: { width: w, height: h, channels: 4, background: { r, g, b, alpha: a / 255 } },
      })
        .png()
        .toBuffer();
      overlays.push({
        input: tile,
        left: Math.round(calib.CAL.x0 + cx * calib.cellW),
        top: Math.round(calib.CAL.y0 + cy * calib.cellH),
      });
    }
  }
  await sharp(REFERENCE_PNG)
    .ensureAlpha()
    .composite(overlays)
    .png()
    .toFile(outPath);
  return meta;
}

async function renderOverlayOnRealAssets(grid, manifest, outPath) {
  const floorPath = path.join(APP_ROOT, "src", "assets", "office", "floor.png");
  const baseCanvas = await sharp(floorPath)
    .resize(FRAME_WIDTH, FRAME_HEIGHT, { fit: "fill" })
    .ensureAlpha()
    .png()
    .toBuffer();

  const rooms = manifest.filter((l) => l.kind === "room");
  const roomComposites = [];
  for (const room of rooms) {
    const roomPath = path.join(APP_ROOT, "src", room.path.replace(/^assets\//, "assets/"));
    const fullPath = path.join(APP_ROOT, "src", room.path);
    if (!fs.existsSync(fullPath)) continue;
    const w = Math.max(1, Math.round(room.width));
    const h = Math.max(1, Math.round(room.height));
    const buf = await sharp(fullPath).resize(w, h, { fit: "fill" }).png().toBuffer();
    roomComposites.push({ input: buf, left: Math.round(room.x), top: Math.round(room.y) });
    void roomPath;
  }

  let composed = sharp(baseCanvas).composite(roomComposites);

  const overlays = [];
  for (let cy = 0; cy < ROWS; cy++) {
    for (let cx = 0; cx < COLS; cx++) {
      const sym = grid[cy][cx];
      const [r, g, b, a] = OVERLAY_RGBA[sym];
      const tile = await sharp({
        create: { width: CELL, height: CELL, channels: 4, background: { r, g, b, alpha: a / 255 } },
      })
        .png()
        .toBuffer();
      overlays.push({ input: tile, left: cx * CELL, top: cy * CELL });
    }
  }

  const composedBuf = await composed.png().toBuffer();
  await sharp(composedBuf).composite(overlays).png().toFile(outPath);
}

function writeOfficeWalkabilityGridTs(rows) {
  const lines = [];
  lines.push("// AUTO-GENERATED by app/scripts/parse-walkable.cjs — do not hand-edit.");
  lines.push("// Parsed from the hand-authored walkability reference image");
  lines.push(`// (~/Downloads/walkable.png), a ${COLS}x${ROWS} grid overlay on the office floor plan,`);
  lines.push("// with a wall-ring safety backstop applied (see parse-walkable.cjs Step 2).");
  lines.push("");
  lines.push(`export const CELL = ${CELL};`);
  lines.push(`export const COLS = ${COLS};`);
  lines.push(`export const ROWS = ${ROWS};`);
  lines.push("");
  lines.push("// '.' walkable  '#' blocked  'o' interaction  '+' door  's' stand-here");
  lines.push("export const WALK_ROWS: string[] = [");
  for (const row of rows) {
    lines.push(`  ${JSON.stringify(row)},`);
  }
  lines.push("];");
  lines.push("");
  fs.writeFileSync(OUT_TS_PATH, lines.join("\n"));
}

async function main() {
  if (!fs.existsSync(REFERENCE_PNG)) {
    throw new Error(`Reference image not found at ${REFERENCE_PNG}`);
  }
  fs.mkdirSync(SCRATCH_DIR, { recursive: true });

  const meta0 = await sharp(REFERENCE_PNG).metadata();
  const calib = resolveCalibration(meta0.width, meta0.height);

  console.log("Classifying reference grid...");
  const rawGrid = await classifyReferenceGrid(calib);

  console.log("Rendering Step-1 calibration self-check overlay...");
  await renderOverlayOnReference(rawGrid, path.join(SCRATCH_DIR, "verify-on-reference.png"), calib);

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

  console.log("Applying Step-2 wall-ring backstop...");
  const finalGrid = applyWallRingBackstop(rawGrid, manifest);

  console.log("Writing officeWalkabilityGrid.ts...");
  writeOfficeWalkabilityGridTs(gridToRows(finalGrid));

  console.log("Rendering Step-6 final-grid-on-real-assets overlay...");
  await renderOverlayOnRealAssets(
    finalGrid,
    manifest,
    path.join(SCRATCH_DIR, "verify-on-real-assets.png"),
  );

  // Stats
  let counts = { ".": 0, "#": 0, o: 0, "+": 0, s: 0 };
  for (const row of finalGrid) for (const c of row) counts[c]++;
  console.log("Final grid symbol counts:", counts);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
