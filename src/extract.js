// Extract: take a piece out of a picture (e.g. the eyes or the head of a finished character) to use
// as a part of its own. Pixels are picked by colour: of the picture itself, or of its colour mask
// (where each colour is a region: skin, eyes, hair...). What is left can have the hole filled with
// the nearest colours around it (an eyeless head).

import { createImage } from './recolor.js';

const rgbAt = (img, i) => [img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2], img.data[i * 4 + 3]];
const near = (a, b, tolerance) => Math.abs(a[0] - b[0]) <= tolerance && Math.abs(a[1] - b[1]) <= tolerance && Math.abs(a[2] - b[2]) <= tolerance;

/**
 * The pixels picked by colour: every solid pixel whose colour (in `by`, the picture or its colour
 * mask, same size) is within `tolerance` of a clicked pixel's. Touching only: just the ones
 * connected to a clicked pixel through such colours.
 * @param {{x:number, y:number}[]} seeds clicked pixels
 * @returns {Uint8Array} 1 = picked, one per pixel
 */
export function selectByColour(image, seeds, { by = image, tolerance = 0, touching = false } = {}) {
  const w = image.width;
  const n = w * image.height;
  const sel = new Uint8Array(n);
  const solid = (i) => image.data[i * 4 + 3] > 0;
  for (const s of seeds) {
    if (s.x < 0 || s.y < 0 || s.x >= w || s.y >= image.height) continue;
    const start = s.y * w + s.x;
    if (!solid(start)) continue;
    const colour = rgbAt(by, start);
    if (!touching) {
      for (let i = 0; i < n; i++) if (!sel[i] && solid(i) && near(rgbAt(by, i), colour, tolerance)) sel[i] = 1;
      continue;
    }
    const stack = [start];
    const seen = new Uint8Array(n);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop();
      sel[i] = 1;
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= n || seen[j]) continue;
        seen[j] = 1;
        if (solid(j) && near(rgbAt(by, j), colour, tolerance)) stack.push(j);
      }
    }
  }
  return sel;
}

/** The selection made bigger (or smaller, negative) by whole pixels, in 4 directions. */
export function growSelection(sel, width, height, by = 1) {
  let cur = sel;
  for (let step = 0; step < Math.abs(by); step++) {
    const next = new Uint8Array(cur);
    for (let i = 0; i < cur.length; i++) {
      const x = i % width;
      const around = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width].filter((j) => j >= 0 && j < cur.length);
      if (by > 0 && !cur[i] && around.some((j) => cur[j])) next[i] = 1;
      if (by < 0 && cur[i] && around.some((j) => !cur[j])) next[i] = 0;
    }
    cur = next;
  }
  return cur;
}

/** Only the picked pixels. */
export function keepSelected(image, sel) {
  const out = createImage(image.width, image.height);
  for (let i = 0; i < sel.length; i++) if (sel[i]) out.data.set(image.data.subarray(i * 4, i * 4 + 4), i * 4);
  return out;
}

/**
 * For each picked solid pixel, the nearest solid pixel that isn't picked (spreading out from the
 * edge of the hole, 4 directions): where its fill colour comes from. -1 where there is none.
 */
export function nearestOutside(image, sel) {
  const w = image.width;
  const n = sel.length;
  const from = new Int32Array(n).fill(-1);
  let ring = [];
  for (let i = 0; i < n; i++) {
    if (!sel[i] && image.data[i * 4 + 3] > 0) {
      from[i] = i;
      ring.push(i);
    }
  }
  while (ring.length) {
    const next = [];
    for (const i of ring) {
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= n || from[j] >= 0 || !sel[j] || image.data[j * 4 + 3] === 0) continue;
        from[j] = from[i];
        next.push(j);
      }
    }
    ring = next;
  }
  return from;
}

/**
 * What is left without the picked pixels: cleared, or (fill) given the colour of the nearest pixel
 * around the hole. `from` (nearestOutside) can be passed so a colour mask is filled the same way.
 */
export function removeSelected(image, sel, { fill = false, from = null, source = image } = {}) {
  const out = createImage(image.width, image.height);
  out.data.set(image.data);
  const map = fill ? (from || nearestOutside(source, sel)) : null;
  for (let i = 0; i < sel.length; i++) {
    if (!sel[i]) continue;
    if (map && map[i] >= 0) out.data.set(image.data.subarray(map[i] * 4, map[i] * 4 + 4), i * 4);
    else out.data.fill(0, i * 4, i * 4 + 4);
  }
  return out;
}

/** How many pixels are picked. */
export function selectedCount(sel) {
  let n = 0;
  for (const v of sel) n += v;
  return n;
}
