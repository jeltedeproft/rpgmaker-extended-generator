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
