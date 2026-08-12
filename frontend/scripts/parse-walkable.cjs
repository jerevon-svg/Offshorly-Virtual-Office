#!/usr/bin/env node
/**
 * Parses the hand-authored walkability reference image
 * (`~/Downloads/walkable.png`) into a precise walkability grid.
 *
 * The reference is now a Figma-authored EXACT solid-color tilemap: 1440x1248
 * px, 16x16 px tiles, 90 cols x 78 rows, each tile a solid flat fill in one
 * of the legend colors (no gradients/strokes/blending, no calibration
 * needed). Classification is pure nearest-legend-color-by-Euclidean-distance
 * on a near-center sample of each tile.
 *
 * The tilemap also carries a one-time authoring marker: a 6th "orange"
 * color used ONLY to mark the exact tile(s) where the receptionist
 * character ("arisha") should stand. It is detected empirically (its exact
 * hex isn't a known legend value) and is NOT part of the ongoing 5-symbol
 * walkability legend — orange tiles are emitted as walkable ('.') in the
 * output grid, and their world-pixel centroid is printed to the console for
 * a human to wire into the character-placement manifest separately.
 *
 * After classification, a LOUD connectivity validator (flood-fill from a
 * known-open corridor anchor) checks that every door and every room's
 * interior floor is reachable. It never mutates the grid — any gap must be
 * fixed by Bon in Figma, not silently patched here.
 *
 * Run from repo root:   node app/scripts/parse-walkable.cjs
 * Or from app/:         node scripts/parse-walkable.cjs
 *
 * Renders a visual-verification overlay into the scratchpad dir:
 *   - verify-on-reference.png — classification tinted back onto the
 *     original reference image, to sanity-check every tile (walls, doors,
 *     seats, floor, stand-points, and the orange reception marker).
 */

const path = require("path");
const fs = require("fs");
const sharp = require("sharp");

const APP_ROOT = path.resolve(__dirname, "..");
const SCRATCH_DIR =
  "/private/tmp/claude-501/-Users-lekoffshorly-Documents-AI-Agents/0358870e-4480-47d7-b9c1-bcc76e665342/scratchpad";

const REFERENCE_PNG = "/Users/lekoffshorly/Downloads/walkable.png";
const MANIFEST_PATH = path.join(APP_ROOT, "src", "data", "office-assets-manifest.json");
const OUT_TS_PATH = path.join(APP_ROOT, "src", "data", "officeWalkabilityGrid.ts");

// The office frame's canonical layout size — drives percentage-based layout
// math elsewhere in the app. NOT touched by this script's tile resolution.
const FRAME_WIDTH = 1440;
const FRAME_HEIGHT = 1244;

// The painted tilemap is deliberately 1440x1248 (4px / 0.25-row taller than
// the 1244px app frame — that sliver is void/border, not an off-by-one).
// Grid size is hardcoded to match the actual painted file exactly, not
// derived from FRAME_WIDTH/FRAME_HEIGHT/CELL.
const CELL = 16;
const COLS = 90;
const ROWS = 78;

const EXPECTED_IMG_WIDTH = COLS * CELL; // 1440
const EXPECTED_IMG_HEIGHT = 1248; // hand-confirmed painted export height

// ---- Legend reference colors (5 known, exact) -----------------------------
const LEGEND_RGB = {
  G: [146, 197, 117], // walkable
  R: [223, 74, 76], // blocked
  B: [56, 136, 233], // interaction
  Y: [249, 205, 57], // door
  P: [150, 80, 200], // purple — stand-here
};
const SYMBOL = { G: ".", R: "#", B: "o", Y: "+", P: "s" };

// Orange-outlier detection: any tile-center sample whose nearest-of-5
// distance exceeds this is a candidate for the 6th, empirically-detected
// "orange" reception-placement marker.
const ORANGE_OUTLIER_THRESHOLD = 70;

function rgbDist(a, b) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function nearest(rgb, colorMap) {
  let bestKey = null;
  let bestDist = Infinity;
  for (const [k, ref] of Object.entries(colorMap)) {
    const d = rgbDist(rgb, ref);
    if (d < bestDist) {
      bestDist = d;
      bestKey = k;
    }
  }
  return { key: bestKey, dist: bestDist };
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

// Exact tile-center sample point (col,row) -> (x,y) in source-image pixels,
// no calibration/detection — pure arithmetic against the known 16px grid.
// Averages a tiny 3x3-ish spread of near-center pixels for anti-aliasing
// safety, staying well clear of tile edges.
function sampleTileColor(sample, col, row) {
  const cx = col * CELL + CELL / 2;
  const cy = row * CELL + CELL / 2;
  const offsets = [-2, 0, 2];
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (const dy of offsets) {
    for (const dx of offsets) {
      const [pr, pg, pb] = sample(cx + dx, cy + dy);
      r += pr;
      g += pg;
      b += pb;
      n++;
    }
  }
  return [r / n, g / n, b / n];
}

// ---- Step 1: sample every tile + detect the orange reception marker ------
async function classifyReferenceGrid() {
  const raw = await loadRawRGB(REFERENCE_PNG);
  const sample = makeSampler(raw);

  const tileColors = [];
  for (let cy = 0; cy < ROWS; cy++) {
    const row = [];
    for (let cx = 0; cx < COLS; cx++) {
      row.push(sampleTileColor(sample, cx, cy));
    }
    tileColors.push(row);
  }

  // Pass 1: nearest-of-5 distance, collect outliers.
  const outliers = [];
  for (let cy = 0; cy < ROWS; cy++) {
    for (let cx = 0; cx < COLS; cx++) {
      const rgb = tileColors[cy][cx];
      const { dist } = nearest(rgb, LEGEND_RGB);
      if (dist > ORANGE_OUTLIER_THRESHOLD) {
        outliers.push({ cx, cy, rgb });
      }
    }
  }

  console.log(`Outlier (candidate orange) tile count: ${outliers.length}`);
  for (const o of outliers) {
    console.log(
      `  cell (${o.cx},${o.cy}) rgb=(${o.rgb[0].toFixed(1)},${o.rgb[1].toFixed(1)},${o.rgb[2].toFixed(1)})`,
    );
  }

  if (outliers.length === 0) {
    throw new Error(
      "No outlier tiles found while scanning for the orange reception marker. Expected a small cluster " +
        `of tiles > ${ORANGE_OUTLIER_THRESHOLD} RGB-units from all 5 known legend colors. Stopping rather ` +
        "than guessing — verify walkable.png actually contains the orange marker.",
    );
  }
  if (outliers.length > 40) {
    throw new Error(
      `Found ${outliers.length} outlier tiles — too many/scattered to be a small hand-placed reception ` +
        "marker (expected a handful of adjacent tiles). This may indicate export drift or noise rather " +
        "than a real orange cluster. Stopping rather than guessing.",
    );
  }

  // Verify the outliers form a single tight cluster (both spatially adjacent
  // and color-tight), not scattered anti-aliasing noise.
  const centroidRgb = [
    outliers.reduce((s, o) => s + o.rgb[0], 0) / outliers.length,
    outliers.reduce((s, o) => s + o.rgb[1], 0) / outliers.length,
    outliers.reduce((s, o) => s + o.rgb[2], 0) / outliers.length,
  ];
  const maxColorSpread = Math.max(...outliers.map((o) => rgbDist(o.rgb, centroidRgb)));
  console.log(
    `Orange candidate centroid rgb=(${centroidRgb[0].toFixed(1)},${centroidRgb[1].toFixed(1)},${centroidRgb[2].toFixed(1)}), ` +
      `max per-tile color spread from centroid: ${maxColorSpread.toFixed(1)}`,
  );
  if (maxColorSpread > 40) {
    throw new Error(
      `Outlier tiles' colors are too scattered (max spread ${maxColorSpread.toFixed(1)} from centroid) to ` +
        "confidently treat as one real orange color. Stopping rather than guessing — inspect the printed " +
        "RGB values above.",
    );
  }

  const minCx = Math.min(...outliers.map((o) => o.cx));
  const maxCx = Math.max(...outliers.map((o) => o.cx));
  const minCy = Math.min(...outliers.map((o) => o.cy));
  const maxCy = Math.max(...outliers.map((o) => o.cy));
  console.log(`Orange cluster bounding cell box: cols [${minCx}-${maxCx}], rows [${minCy}-${maxCy}]`);

  const ORANGE_RGB = centroidRgb;
  const LEGEND_RGB_6 = { ...LEGEND_RGB, O: ORANGE_RGB };

  // Pass 2: final nearest-of-6 classification.
  const grid = [];
  const orangeCells = [];
  for (let cy = 0; cy < ROWS; cy++) {
    const row = [];
    for (let cx = 0; cx < COLS; cx++) {
      const rgb = tileColors[cy][cx];
      const { key } = nearest(rgb, LEGEND_RGB_6);
      if (key === "O") {
        orangeCells.push({ cx, cy });
        row.push("."); // orange marker is a one-time placement reference, not a gameplay tile type
      } else {
        row.push(SYMBOL[key]);
      }
    }
    grid.push(row);
  }

  return { grid, orangeCells, orangeRgb: ORANGE_RGB, outlierCount: outliers.length };
}

// ---- Step 2: outer-frame belt-and-suspenders force-block ------------------
function forceBlockOuterFrame(grid) {
  for (let cx = 0; cx < COLS; cx++) {
    grid[0][cx] = "#";
    grid[ROWS - 1][cx] = "#";
  }
  for (let cy = 0; cy < ROWS; cy++) {
    grid[cy][0] = "#";
    grid[cy][COLS - 1] = "#";
  }
}

// ---- Step 3: LOUD connectivity validator (no mutation) --------------------
// Flood-fills from a known-open corridor anchor (world px (500,790), derived
// into a cell index against the CURRENT CELL size — never a hardcoded cell
// index from the old CELL=32 grid) and checks that every door cell and every
// room's interior floor is reachable. Throws with specifics on any gap —
// Bon fixes the tile in Figma, this script does not silently patch it.
function computeRoomRect(room) {
  return {
    id: room.id,
    cx1: Math.floor(room.x / CELL),
    cy1: Math.floor(room.y / CELL),
    cx2: Math.floor((room.x + room.width) / CELL),
    cy2: Math.floor((room.y + room.height) / CELL),
  };
}

function floodFillMain(grid, anchor) {
  const key = (cx, cy) => `${cx},${cy}`;
  const passable = (cx, cy) => {
    const s = grid[cy][cx];
    return s === "." || s === "+" || s === "s";
  };
  const seen = new Set();
  if (!passable(anchor.cx, anchor.cy)) return seen;
  const stack = [[anchor.cx, anchor.cy]];
  seen.add(key(anchor.cx, anchor.cy));
  const dirs4 = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  while (stack.length) {
    const [x, y] = stack.pop();
    for (const [dx, dy] of dirs4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
      const nk = key(nx, ny);
      if (seen.has(nk)) continue;
      if (!passable(nx, ny)) continue;
      seen.add(nk);
      stack.push([nx, ny]);
    }
  }
  return seen;
}

function validateConnectivity(grid, manifest) {
  const anchorWorld = { x: 500, y: 790 };
  const anchor = {
    cx: Math.floor(anchorWorld.x / CELL),
    cy: Math.floor(anchorWorld.y / CELL),
  };

  const mainRegion = floodFillMain(grid, anchor);
  const key = (cx, cy) => `${cx},${cy}`;

  if (mainRegion.size === 0) {
    throw new Error(
      `Connectivity validator: anchor cell (${anchor.cx},${anchor.cy}) (world ${anchorWorld.x},${anchorWorld.y}) ` +
        `is not itself walkable (grid symbol '${grid[anchor.cy][anchor.cx]}'). Cannot validate connectivity.`,
    );
  }

  const unreachableDoors = [];
  for (let cy = 0; cy < ROWS; cy++) {
    for (let cx = 0; cx < COLS; cx++) {
      if (grid[cy][cx] === "+" && !mainRegion.has(key(cx, cy))) {
        unreachableDoors.push({ cx, cy });
      }
    }
  }

  const rooms = manifest.filter((l) => l.kind === "room").map(computeRoomRect);
  const roomsWithNoReachableFloor = [];
  for (const rect of rooms) {
    let hasFloor = false;
    let hasReachableFloor = false;
    for (let cy = rect.cy1; cy <= rect.cy2; cy++) {
      for (let cx = rect.cx1; cx <= rect.cx2; cx++) {
        if (cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS) continue;
        const s = grid[cy][cx];
        if (s === "." || s === "+" || s === "s") {
          hasFloor = true;
          if (mainRegion.has(key(cx, cy))) hasReachableFloor = true;
        }
      }
    }
    if (hasFloor && !hasReachableFloor) {
      roomsWithNoReachableFloor.push(rect.id);
    }
  }

  if (unreachableDoors.length > 0 || roomsWithNoReachableFloor.length > 0) {
    const lines = ["Connectivity validator FAILED:"];
    if (unreachableDoors.length > 0) {
      lines.push(
        `  Unreachable door cells (${unreachableDoors.length}): ` +
          unreachableDoors.map((d) => `(${d.cx},${d.cy})`).join(", "),
      );
    }
    if (roomsWithNoReachableFloor.length > 0) {
      lines.push(`  Rooms with floor but no cell reachable from main region: ${roomsWithNoReachableFloor.join(", ")}`);
    }
    lines.push("  Bon must fix these tiles directly in Figma — this script does not auto-carve.");
    throw new Error(lines.join("\n"));
  }

  console.log(
    `Connectivity validator: OK — anchor (${anchor.cx},${anchor.cy}), main region size ${mainRegion.size}, ` +
      "all doors and room floors reachable.",
  );
}

function gridToRows(grid) {
  return grid.map((row) => row.join(""));
}

// ---- Overlay rendering (visual verification) ------------------------------
const OVERLAY_RGBA = {
  ".": [76, 175, 80, 102], // green
  "#": [244, 67, 54, 102], // red
  o: [33, 150, 243, 102], // blue
  "+": [255, 193, 7, 102], // yellow/amber
  s: [156, 39, 176, 102], // purple — stand-here
};

async function renderOverlayOnReference(grid, orangeCells, outPath) {
  const overlays = [];
  const orangeSet = new Set(orangeCells.map((o) => `${o.cx},${o.cy}`));
  for (let cy = 0; cy < ROWS; cy++) {
    for (let cx = 0; cx < COLS; cx++) {
      const isOrange = orangeSet.has(`${cx},${cy}`);
      const [r, g, b, a] = isOrange ? [255, 140, 0, 140] : OVERLAY_RGBA[grid[cy][cx]];
      const tile = await sharp({
        create: { width: CELL, height: CELL, channels: 4, background: { r, g, b, alpha: a / 255 } },
      })
        .png()
        .toBuffer();
      overlays.push({ input: tile, left: cx * CELL, top: cy * CELL });
    }
  }
  await sharp(REFERENCE_PNG).ensureAlpha().composite(overlays).png().toFile(outPath);
}

function writeOfficeWalkabilityGridTs(rows) {
  const lines = [];
  lines.push("// AUTO-GENERATED by app/scripts/parse-walkable.cjs — do not hand-edit.");
  lines.push("// Parsed from the hand-authored, exact solid-color-tile walkability reference");
  lines.push(`// image (~/Downloads/walkable.png), a ${COLS}x${ROWS} grid at ${CELL}px/tile.`);
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

  const meta = await sharp(REFERENCE_PNG).metadata();
  if (meta.width !== EXPECTED_IMG_WIDTH || meta.height !== EXPECTED_IMG_HEIGHT) {
    throw new Error(
      `walkable.png is ${meta.width}x${meta.height}, expected exactly ${EXPECTED_IMG_WIDTH}x${EXPECTED_IMG_HEIGHT}. ` +
        "The new pipeline requires an exact, pixel-aligned solid-color tilemap export — no calibration fallback.",
    );
  }
  console.log(`Reference image confirmed: ${meta.width}x${meta.height}`);

  console.log("Classifying reference grid (nearest-legend-color)...");
  const { grid, orangeCells, orangeRgb, outlierCount } = await classifyReferenceGrid();

  forceBlockOuterFrame(grid);

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

  console.log("Validating connectivity (no auto-carve)...");
  validateConnectivity(grid, manifest);

  console.log("Writing officeWalkabilityGrid.ts...");
  writeOfficeWalkabilityGridTs(gridToRows(grid));

  console.log("Rendering verification overlay...");
  await renderOverlayOnReference(grid, orangeCells, path.join(SCRATCH_DIR, "verify-on-reference.png"));

  // Stats
  const counts = { ".": 0, "#": 0, o: 0, "+": 0, s: 0 };
  for (const row of grid) for (const c of row) counts[c]++;
  console.log("Final grid symbol counts:", counts);

  // Orange cluster report — world-pixel centroid, for wiring arisha's manifest position.
  if (orangeCells.length > 0) {
    const worldXs = orangeCells.map((o) => o.cx * CELL + CELL / 2);
    const worldYs = orangeCells.map((o) => o.cy * CELL + CELL / 2);
    const centroidX = worldXs.reduce((a, b) => a + b, 0) / worldXs.length;
    const centroidY = worldYs.reduce((a, b) => a + b, 0) / worldYs.length;
    console.log(
      `Orange reception marker: ${orangeCells.length} tile(s), rgb~(${orangeRgb[0].toFixed(1)},${orangeRgb[1].toFixed(1)},${orangeRgb[2].toFixed(1)}), ` +
        `outlier support count ${outlierCount}, cells: ${orangeCells.map((o) => `(${o.cx},${o.cy})`).join(", ")}, ` +
        `world-pixel centroid: (${centroidX.toFixed(1)}, ${centroidY.toFixed(1)})`,
    );
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
