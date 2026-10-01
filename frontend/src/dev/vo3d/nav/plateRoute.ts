// vo3d nav — A ROUTE ACROSS A PLATE THAT IS NOT ON THE V1 LATTICE.
//
// planWalk is welded to V1's 90 x 78 grid, and nothing off the ground floor has a cell in it. Floor 2
// used to answer with a single straight leg, which was honest while it was an empty slab; a floor of
// glass rooms needs a real route — round a table, through a doorway, down a corridor.
//
// So: a fixed-pitch occupancy grid sampled ONCE from the plate's own stand test (the same function
// PLAYER's keyboard movement is held by, so a route and a walk can never disagree), A* over it, then
// the path pulled tight with line-of-sight checks against that same stand test.
import type { Rect, Vec2 } from "../core/coords";

export interface PlateRouter {
  /** waypoints from `from` to `to`, excluding `from`; null when no route exists */
  route(from: Vec2, to: Vec2): Vec2[] | null;
  /** re-sample the grid on the next route — something that stops a body has changed (a door shut) */
  invalidate(): void;
}

export function makePlateRouter(bounds: Rect, stand: (p: Vec2) => boolean, cell = 8): PlateRouter {
  const cols = Math.floor(bounds.w / cell), rows = Math.floor(bounds.d / cell);
  let open: Uint8Array | null = null; // sampled on the first route, never before: the plate may be unvisited
  const centre = (i: number, j: number): Vec2 => ({ x: bounds.x + (i + 0.5) * cell, z: bounds.z + (j + 0.5) * cell });
  const grid = (): Uint8Array => {
    if (open) return open;
    open = new Uint8Array(cols * rows);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) open[j * cols + i] = stand(centre(i, j)) ? 1 : 0;
    return open;
  };
  const cellOf = (p: Vec2): [number, number] => [Math.floor((p.x - bounds.x) / cell), Math.floor((p.z - bounds.z) / cell)];
  const ok = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < cols && j < rows && grid()[j * cols + i] === 1;
  /** the open cell nearest `p`, searching outward a few rings */
  const snap = (p: Vec2): number | null => {
    const [ci, cj] = cellOf(p);
    let best: number | null = null, bestD = Infinity;
    for (let r = 0; r <= 3 && best === null; r++)
      for (let j = cj - r; j <= cj + r; j++)
        for (let i = ci - r; i <= ci + r; i++) {
          if (!ok(i, j)) continue;
          const c = centre(i, j), d = (c.x - p.x) ** 2 + (c.z - p.z) ** 2;
          if (d < bestD) { bestD = d; best = j * cols + i; }
        }
    return best;
  };
  const clearLine = (a: Vec2, b: Vec2): boolean => {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 4));
    for (let k = 1; k <= n; k++) if (!stand({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n })) return false;
    return true;
  };

  return {
    invalidate() { open = null; },
    route(from, to) {
      if (!stand(to)) return null;
      if (clearLine(from, to)) return [{ ...to }];
      const s = snap(from), g = snap(to);
      if (s === null || g === null) return null;
      const n = cols * rows;
      const gCost = new Float32Array(n).fill(Infinity);
      const parent = new Int32Array(n).fill(-1);
      const closed = new Uint8Array(n);
      const gi = g % cols, gj = Math.floor(g / cols);
      const h = (k: number): number => {
        const dx = Math.abs((k % cols) - gi), dz = Math.abs(Math.floor(k / cols) - gj);
        return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
      };
      // a binary min-heap on f, as two parallel arrays
      const hf: number[] = [], hk: number[] = [];
      const swap = (x: number, y: number): void => {
        [hf[x], hf[y]] = [hf[y], hf[x]];
        [hk[x], hk[y]] = [hk[y], hk[x]];
      };
      const push = (f: number, k: number): void => {
        hf.push(f); hk.push(k);
        for (let c = hf.length - 1; c > 0; ) {
          const p = (c - 1) >> 1;
          if (hf[p] <= hf[c]) break;
          swap(p, c); c = p;
        }
      };
      const pop = (): number => {
        const top = hk[0];
        const lf = hf.pop()!, lk = hk.pop()!;
        if (hf.length) {
          hf[0] = lf; hk[0] = lk;
          for (let c = 0; ; ) {
            const l = 2 * c + 1, r = l + 1;
            let m = c;
            if (l < hf.length && hf[l] < hf[m]) m = l;
            if (r < hf.length && hf[r] < hf[m]) m = r;
            if (m === c) break;
            swap(m, c); c = m;
          }
        }
        return top;
      };
      gCost[s] = 0;
      push(h(s), s);
      let found = false;
      while (hf.length) {
        const k = pop();
        if (closed[k]) continue;
        closed[k] = 1;
        if (k === g) { found = true; break; }
        const i = k % cols, j = Math.floor(k / cols);
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            if (!di && !dj) continue;
            const ni = i + di, nj = j + dj;
            if (!ok(ni, nj)) continue;
            if (di && dj && (!ok(i + di, j) || !ok(i, j + dj))) continue; // no corner cutting
            const nk = nj * cols + ni;
            if (closed[nk]) continue;
            const c = gCost[k] + (di && dj ? Math.SQRT2 : 1);
            if (c < gCost[nk]) { gCost[nk] = c; parent[nk] = k; push(c + h(nk), nk); }
          }
      }
      if (!found) return null;
      const cells: Vec2[] = [];
      for (let k = g; k !== -1 && k !== s; k = parent[k]) cells.push(centre(k % cols, Math.floor(k / cols)));
      cells.reverse();
      if (cells.length === 0) return [{ ...to }];
      cells[cells.length - 1] = { ...to }; // end exactly where asked, not on the cell centre
      // PULL THE STRING: from each anchor, jump to the farthest waypoint still in clear line of sight.
      const out: Vec2[] = [];
      let anchor = from, idx = 0;
      while (idx < cells.length) {
        let far = idx;
        for (let k = cells.length - 1; k > idx; k--) if (clearLine(anchor, cells[k])) { far = k; break; }
        out.push(cells[far]);
        anchor = cells[far];
        idx = far + 1;
      }
      return out;
    },
  };
}
