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

// RPG Maker 2000/2003: 3 frames like MV/MZ, but the rows are up, right, down, left (MV/MZ: down,
// left, right, up). A charset is 288 x 256: 8 characters of 3 x 4 frames of 24 x 32.

/** 2000/2003 row for each MV/MZ row (down, left, right, up). */
const RM2K_TO_MV = [2, 3, 1, 0];
/** MV/MZ row for each 2000/2003 row (up, right, down, left). */
const MV_TO_RM2K = [3, 2, 0, 1];

function reorderRows(image, pick) {
  if (!image || image.height % 4) return image;
  const fh = image.height / 4;
  const out = createImage(image.width, image.height);
  const bytes = image.width * fh * 4;
  for (const [row, from] of pick.entries()) out.data.set(image.data.subarray(from * bytes, (from + 1) * bytes), row * bytes);
  return out;
}

/** A 2000/2003 character (3 x 4 frames, rows up, right, down, left) as an MV/MZ walk sheet. */
export function rm2kToWalk(image) {
  return reorderRows(image, RM2K_TO_MV);
}

/** An MV/MZ walk sheet as a 2000/2003 character (rows up, right, down, left). */
export function walkToRm2k(image) {
  return reorderRows(image, MV_TO_RM2K);
}

/**
 * Walk sheets of other RPG Makers, by the sheet value used in the app ("XP", "RM2K"): how a file
 * is read (layout, on the picture's ref), how it is made from a walk sheet, and its name.
 */
export const WALK_LAYOUTS = {
  XP: { layout: 'xp', toWalk: xpToWalk, fromWalk: walkToXp, label: 'Walk, RPG Maker XP', note: 'RPG Maker XP, 4 x 4 frames' },
  RM2K: { layout: 'rm2k', toWalk: rm2kToWalk, fromWalk: walkToRm2k, label: 'Walk, RPG Maker 2000/2003', note: 'RPG Maker 2000/2003, rows up, right, down, left' },
};
const BY_LAYOUT = Object.fromEntries(Object.values(WALK_LAYOUTS).map((w) => [w.layout, w]));

/** A decoded picture of a file read in another RPG Maker's layout, as an MV/MZ walk sheet. */
export function layoutToWalk(layout, image) {
  return BY_LAYOUT[layout] ? BY_LAYOUT[layout].toWalk(image) : image;
}

/** A picture this size splits into XP's 4 x 4 frames. */
export function fitsXp(width, height) {
  return width > 0 && height > 0 && width % 4 === 0 && height % 4 === 0;
}
