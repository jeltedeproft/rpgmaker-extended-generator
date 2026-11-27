// RPG Maker Unite: character images of any size, one animation per picture with its frames side by
// side, 1 pixel of transparent space around the outside and 2 pixels between frames
// (rpgmakerunite.com, "Character Related"). Saved together as one zip (zip.js).

import { createImage } from './recolor.js';

/** Space around the strip and between frames, in pixels. */
export const UNITE_BORDER = 1;
export const UNITE_GAP = 2;

/**
 * One animation as a Unite strip: the given frames of a sheet, left to right.
 * @param {{width:number, height:number, data:Uint8ClampedArray}} image the sheet
 * @param {{w:number, h:number}} frame size of one frame
 * @param {Array<[number, number]>} cells [column, row] of each frame, in playing order
 */
export function uniteStrip(image, frame, cells) {
  const n = cells.length;
  const out = createImage(n * frame.w + (n - 1) * UNITE_GAP + 2 * UNITE_BORDER, frame.h + 2 * UNITE_BORDER);
  for (const [i, [col, row]] of cells.entries()) {
    const x0 = UNITE_BORDER + i * (frame.w + UNITE_GAP);
    for (let y = 0; y < frame.h; y++) {
      const from = ((row * frame.h + y) * image.width + col * frame.w) * 4;
      out.data.set(image.data.subarray(from, from + frame.w * 4), ((UNITE_BORDER + y) * out.width + x0) * 4);
    }
  }
  return out;
}

// The zip writer lives in zip.js (a setup is shared as a zip too).
export { zipFiles, crc32 } from './zip.js';
