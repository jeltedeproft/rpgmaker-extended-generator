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
  turned: { label: 'Turned', options: { near: 0.7, far: 1.2, shift: 3, inside: 'up', faceShift: 2 } },
  more: { label: 'Turned more', options: { near: 0.6, far: 1.3, shift: 4, inside: 'up', faceShift: 3 } },
  side: { label: 'Side view', options: null },
};

/**
 * The diagonal rows of a 4-direction walk picture, made the given way (default: turned).
 * face: a part on the front of the face (eyes, mouth, nose...): it moves further toward the turn
 * than the head's outline, which is what makes a face read as turned rather than squeezed.
 */
export function diagonalsOf(walk, mode = 'turned', face = false) {
  const options = (DIAGONAL_MODES[mode] || DIAGONAL_MODES.turned).options;
  if (!options) return diagonalFallback(walk);
  return diagonalWarp(walk, face ? { ...options, shift: options.shift + (options.faceShift || 0) } : options);
}

/**
 * Diagonals by turning the front (or back) picture: the half on the side it turns to narrower, the
 * other half wider, all moved toward that side. One outline, never a second head. Up diagonals
 * (inside: 'up') also show the side picture, only within that outline: the side of the face peeks
 * out past the back of the head. Only the frame's size decides where pixels go, so parts and colour
 * masks stay together.
 * @param {{cols?:number, near?:number, far?:number, shift?:number, inside?:boolean|'up', sideShift?:number, gap?:number}} [options]
 *   near: how wide the half it turns to stays; far: how wide the other half becomes; shift: pixels
 */
export function diagonalWarp(walk, { cols, near = 0.8, far = 1.12, shift = 2, inside = false, sideShift = 3, gap = 2 } = {}) {
  if (!walk || walk.height % 4) return walk;
  const fh = walk.height / 4;
  const n = cols || (walk.width % 3 === 0 ? 3 : Math.max(1, Math.round(walk.width / fh)));
  const fw = Math.floor(walk.width / n);
  const out = createImage(walk.width, walk.height);
  const cx = fw / 2;
  // [front or back row, which way it turns: -1 left, 1 right, back?]
  const MADE = [[0, -1, false, 1], [0, 1, false, 2], [3, -1, true, 1], [3, 1, true, 2]];
  for (const [d, [main, dir, back, sideRow]] of MADE.entries()) {
    // Seen from the back, the middle of the back moves away from the side it turns to.
    const side = back ? -dir : dir;
    const mid = cx + side * shift;
    const from = [];
    for (let x = 0; x < fw; x++) {
      const u = x + 0.5 - mid;
      const sx = Math.floor(cx + (Math.sign(u) === side ? u / near : u / far));
      from.push(sx >= 0 && sx < fw ? sx : -1);
    }
    for (let c = 0; c < n; c++) {
      for (let y = 0; y < fh; y++) {
        const o = (d * fh + y) * out.width + c * fw;
        const s = (main * fh + y) * walk.width + c * fw;
        for (let x = 0; x < fw; x++) {
          if (from[x] < 0) continue;
          const si = (s + from[x]) * 4;
          if (walk.data[si + 3]) out.data.set(walk.data.subarray(si, si + 4), (o + x) * 4);
        }
        // Inside: the side picture's far half (ear, side of the hair) painted within the outline only.
        if (!(inside === true || (inside === 'up' && back))) continue;
        const ss = (sideRow * fh + y) * walk.width + c * fw;
        for (let x = 0; x < fw; x++) {
          if ((x + 0.5 - mid) * side > -gap) continue;
          const oi = (o + x) * 4;
          if (!out.data[oi + 3]) continue;
          const sx = Math.round(x + side * sideShift);
          if (sx < 0 || sx >= fw) continue;
          const si = (ss + sx) * 4;
          if (walk.data[si + 3]) out.data.set(walk.data.subarray(si, si + 4), oi);
        }
      }
    }
  }
  return out;
}
