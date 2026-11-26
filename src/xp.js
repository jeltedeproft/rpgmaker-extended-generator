// RPG Maker XP character sheets: 4 directions (down, left, right, up: the same rows as MV/MZ) and
// 4 frames each, of any frame size. XP walks frame 1 → 2 → 3 → 4 and stands on frame 1; MV/MZ has
// 3 frames (left step, standing, right step) and walks 2 → 3 → 2 → 1.

import { createImage } from './recolor.js';

/** XP frame for each MV/MZ frame (left step, standing, right step). */
const XP_TO_MV = [1, 0, 3];
/** MV/MZ frame for each XP frame (standing, step, standing, other step). */
const MV_TO_XP = [1, 0, 1, 2];

function regrid(image, fromCols, pick) {
  if (!image || image.width % fromCols || image.height % 4) return image;
  const fw = image.width / fromCols;
  const fh = image.height / 4;
  const out = createImage(fw * pick.length, image.height);
  for (let row = 0; row < 4; row++) {
    for (const [col, from] of pick.entries()) {
      for (let y = 0; y < fh; y++) {
        const src = (((row * fh + y) * image.width) + from * fw) * 4;
        out.data.set(image.data.subarray(src, src + fw * 4), (((row * fh + y) * out.width) + col * fw) * 4);
      }
    }
  }
  return out;
}

/** An XP character sheet (4 x 4 frames) as an MV/MZ walk sheet (3 x 4 frames of the same size). */
export function xpToWalk(image) {
  return regrid(image, 4, XP_TO_MV);
}

/** An MV/MZ walk sheet (3 x 4 frames) as an XP character sheet (4 x 4 frames of the same size). */
export function walkToXp(image) {
  return regrid(image, 3, MV_TO_XP);
}

/** A picture this size splits into XP's 4 x 4 frames. */
export function fitsXp(width, height) {
  return width > 0 && height > 0 && width % 4 === 0 && height % 4 === 0;
}
