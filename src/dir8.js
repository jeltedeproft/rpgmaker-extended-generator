// 8-direction walk sheets (for diagonal-movement plugins): RPG Maker's 3 x 4 walk sheet with 4
// more rows under it, the diagonals: down-left, down-right, up-left, up-right.

import { createImage } from './recolor.js';

export const DIAGONALS = ['Down-left', 'Down-right', 'Up-left', 'Up-right'];
/** For a part drawn in 4 directions only: the walk row (down, left, right, up) each diagonal shows. */
const FALLBACK_ROWS = [1, 2, 1, 2];

/** The given rows of a 4-row sheet, in that order. */
function pickRows(image, pick) {
  const fh = image.height / 4;
  const out = createImage(image.width, fh * pick.length);
  const bytes = image.width * fh * 4;
  for (const [i, row] of pick.entries()) out.data.set(image.data.subarray(row * bytes, (row + 1) * bytes), i * bytes);
  return out;
}

/** An 8-row sheet as its walk sheet (rows 1-4) and its diagonals (rows 5-8), each 4 rows. */
export function split8(image) {
  if (!image || image.height % 8) return { walk: image, diagonal: null };
  const half = image.height / 2;
  const top = createImage(image.width, half);
  const bottom = createImage(image.width, half);
  const bytes = image.width * half * 4;
  top.data.set(image.data.subarray(0, bytes));
  bottom.data.set(image.data.subarray(bytes, bytes * 2));
  return { walk: top, diagonal: bottom };
}

/** Diagonals for a part drawn in 4 directions: each shows the side it faces (left or right). */
export function diagonalFallback(walk) {
  if (!walk || walk.height % 4) return walk;
  return pickRows(walk, FALLBACK_ROWS);
}

/** The walk sheet and its diagonals as one 8-row sheet. */
export function join8(walk, diagonal) {
  const out = createImage(Math.max(walk.width, diagonal.width), walk.height + diagonal.height);
  for (let y = 0; y < walk.height; y++) out.data.set(walk.data.subarray(y * walk.width * 4, (y + 1) * walk.width * 4), y * out.width * 4);
  for (let y = 0; y < diagonal.height; y++) out.data.set(diagonal.data.subarray(y * diagonal.width * 4, (y + 1) * diagonal.width * 4), (walk.height + y) * out.width * 4);
  return out;
}

// ---------- diagonals made from the 4 directions ----------

/** How the diagonals of a part drawn in 4 directions are made: turned (a little or more), or the side view. */
export const DIAGONAL_MODES = {
  turned: { label: 'Turned', options: { squeeze: 0.85, shift: 2, sideShift: 4 } },
  more: { label: 'Turned more', options: { squeeze: 0.8, shift: 3, sideShift: 5 } },
  side: { label: 'Side view', options: null },
};

/** The diagonal rows of a 4-direction walk picture, made the given way (default: turned). */
export function diagonalsOf(walk, mode = 'turned') {
  const options = (DIAGONAL_MODES[mode] || DIAGONAL_MODES.turned).options;
  return options ? diagonalLayers(walk, options) : diagonalFallback(walk);
}

/**
 * Diagonals as layers: the front (or back) picture, a little narrower and moved toward the side it
 * turns to, over the side picture moved the other way. Only the frame's size decides where pixels
 * go, so every part and colour mask moves the same way.
 * @param {{cols?:number, squeeze?:number, shift?:number, sideShift?:number}} [options]
 */
export function diagonalLayers(walk, { cols, squeeze = 0.85, shift = 2, sideShift = 3 } = {}) {
  if (!walk || walk.height % 4) return walk;
  const fh = walk.height / 4;
  const n = cols || (walk.width % 3 === 0 ? 3 : Math.max(1, Math.round(walk.width / fh)));
  const fw = Math.floor(walk.width / n);
  const out = createImage(walk.width, walk.height);
  const cx = fw / 2;
  // [front or back row, side row, which way it turns: -1 left, 1 right, back on top?]
  const MADE = [[0, 1, -1], [0, 2, 1], [3, 1, -1, true], [3, 2, 1, true]];
  for (const [d, [main, side, dir, back]] of MADE.entries()) {
    // Facing away, the back moves away from the side it turns to and the side picture toward it.
    const mainShift = (back ? -dir : dir) * shift;
    const sideMove = (back ? dir : -dir) * sideShift;
    for (let c = 0; c < n; c++) {
      for (let y = 0; y < fh; y++) {
        const o = (d * fh + y) * out.width + c * fw;
        for (let x = 0; x < fw; x++) {
          const sx = Math.round(x - sideMove);
          if (sx < 0 || sx >= fw) continue;
          const si = ((side * fh + y) * walk.width + c * fw + sx) * 4;
          if (walk.data[si + 3]) out.data.set(walk.data.subarray(si, si + 4), (o + x) * 4);
        }
        for (let x = 0; x < fw; x++) {
          const mx = Math.floor(cx + (x + 0.5 - cx - mainShift) / squeeze);
          if (mx < 0 || mx >= fw) continue;
          const mi = ((main * fh + y) * walk.width + c * fw + mx) * 4;
          if (walk.data[mi + 3]) out.data.set(walk.data.subarray(mi, mi + 4), (o + x) * 4);
        }
      }
    }
  }
  return out;
}
