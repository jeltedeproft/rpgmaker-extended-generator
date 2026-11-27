// Several characters in one picture, as RPG Maker's own files are: Actor1.png holds 8 walk
// sheets (4 x 2) in img/characters, and img/faces/Actor1.png their 8 faces.

import { createImage } from './recolor.js';

/** Characters across and down in one of RPG Maker's multi-character files. */
export const MULTI_COLS = 4;
export const MULTI_ROWS = 2;

/**
 * The pictures (null = empty place) in a grid of cols x rows places, read left to right, top to
 * bottom. Every place is as big as the biggest picture. A picture of frames (grid: its columns and
 * rows) is placed frame by frame: centred, standing on the bottom of the frame, so characters of
 * other sizes still walk on the same line. A picture without frames is centred.
 * @param {Array<{width:number, height:number, data:Uint8ClampedArray}|null>} images
 * @param {{cols:number, rows:number}|null} grid frames in each picture
 * @returns {{width:number, height:number, data:Uint8ClampedArray}|null}
 */
export function packCharacters(images, grid = null, cols = MULTI_COLS, rows = MULTI_ROWS) {
  const present = images.filter(Boolean);
  if (!present.length) return null;
  const fc = grid?.cols || 1;
  const fr = grid?.rows || 1;
  // One frame of a place: the biggest frame of all the pictures.
  const fw = Math.max(...present.map((img) => Math.floor(img.width / fc)));
  const fh = Math.max(...present.map((img) => Math.floor(img.height / fr)));
  const out = createImage(fw * fc * cols, fh * fr * rows);
  images.slice(0, cols * rows).forEach((img, i) => {
    if (!img) return;
    const sw = Math.floor(img.width / fc);
    const sh = Math.floor(img.height / fr);
    const dx = Math.floor((fw - sw) / 2);
    const dy = grid ? fh - sh : Math.floor((fh - sh) / 2);
    const px = (i % cols) * fw * fc;
    const py = Math.floor(i / cols) * fh * fr;
    for (let r = 0; r < fr; r++) {
      for (let c = 0; c < fc; c++) {
        for (let y = 0; y < sh; y++) {
          const from = ((r * sh + y) * img.width + c * sw) * 4;
          const to = ((py + r * fh + dy + y) * out.width + px + c * fw + dx) * 4;
          out.data.set(img.data.subarray(from, from + sw * 4), to);
        }
      }
    }
  });
  return out;
}
