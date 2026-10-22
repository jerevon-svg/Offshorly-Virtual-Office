// underside-sheet.mjs — THE HEAD'S UNDERSIDE IS ONE SHEET (2026-10-10, universal construction rule; chibify calls it on the canonical
// underside height field before the cut uses it). ZERO CREDITS.
//
// chibify rasterises every downward-facing triangle of the canonical (Alex) head into under(x, z) and discards generated skin below
// it ("generated anatomy below the Alex head", for everything behind the neck centre). The canonical EAR has downward-facing faces too
// (its concha roof, at eye level): in the ear's columns under() read the ear, not the bottom of the head, and every employee's concha
// floor lying below Alex's was cut out — an open hole in both ears with the closure interior seen through it (2026-10-10: Kael both
// ears, Clang; the raw generated heads are closed).
//
// Rule (no name, no per-person constant): the head's underside — jaw underside, skull base, the rim of the neck opening — is ONE
// continuous sheet around the neck. Starting from the cells at the opening, a neighbouring cell belongs to the sheet when the height
// step between them is one a downward-facing triangle (the field's own test, normal.y < `down`) can make across one cell. Patches that
// never join it are a protrusion's own underside (the canonical head: exactly its two ears). They are replaced by the sheet CONTINUED
// under them (filled from the sheet cells around them, as the neck opening is filled from its rim): the cut under an ear runs at the
// height of its neighbours — the ear above it is kept whole, and no tongue of skin is left hanging below it in the ear's columns.

/** ug: Float32Array height field (cells > 8 are empty), edited in place; grid { nx, nz, c }; seed(xx, zz): a cell at the neck
 *  opening; down: the downward-facing test's normal.y bound. Returns { kept, dropped, filled } (cells; a dropped cell the sheet never
 *  reaches stays empty). With no seed the field is unchanged. */
export function keepUndersideSheet(ug, { nx, nz, c }, seed, down) {
  const step = (c * Math.sqrt(1 - down * down)) / -down, seen = new Uint8Array(ug.length), st = [];
  for (let zz = 0; zz < nz; zz++) for (let xx = 0; xx < nx; xx++) { const k = zz * nx + xx; if (ug[k] < 8 && seed(xx, zz)) { seen[k] = 1; st.push(k); } }
  if (!st.length) return { kept: 0, dropped: 0 };
  while (st.length) { const k = st.pop(), xx = k % nx, zz = (k / nx) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x2 = xx + dx, z2 = zz + dz; if (x2 < 0 || z2 < 0 || x2 >= nx || z2 >= nz) continue;
      const k2 = z2 * nx + x2; if (seen[k2] || ug[k2] > 8 || Math.abs(ug[k2] - ug[k]) > step) continue; seen[k2] = 1; st.push(k2); } }
  let kept = 0, dropped = 0; const gone = new Uint8Array(ug.length); for (let k = 0; k < ug.length; k++) { if (ug[k] > 8) continue; if (seen[k]) kept++; else { ug[k] = 9; gone[k] = 1; dropped++; } }
  let filled = 0; for (let changed = 1; changed;) { changed = 0; const next = ug.slice();
    for (let k = 0; k < ug.length; k++) { if (!gone[k] || ug[k] < 8) continue; const xx = k % nx, zz = (k / nx) | 0; let sum = 0, n = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x2 = xx + dx, z2 = zz + dz; if (x2 < 0 || z2 < 0 || x2 >= nx || z2 >= nz) continue; const v = ug[z2 * nx + x2]; if (v < 8) { sum += v; n++; } }
      if (n) { next[k] = sum / n; filled++; changed = 1; } }
    ug.set(next); }
  return { kept, dropped, filled };
}
