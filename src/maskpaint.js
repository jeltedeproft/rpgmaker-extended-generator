// Colour masks painted by hand: on top of a part's own mask, the one the generator made, or none.
// Painting is kept as "edits", one code per pixel: -1 not painted, 0 keep as drawn (no slot),
// k > 0 the slot SLOTS[k - 1]. Edits are saved run-length encoded, so a few strokes stay small.
// Pure: no DOM.

import { SLOTS } from './format.js';

export const NOT_PAINTED = -1;
export const KEEP = 0;

/** The edit code of a slot id ('' or null: keep as drawn). */
export function codeOf(slotId) {
  if (!slotId) return KEEP;
  const i = SLOTS.findIndex((s) => s.id === slotId);
  return i < 0 ? KEEP : i + 1;
}

/** No painting yet, for a picture of this size. */
export function emptyEdits(width, height) {
  return { width, height, codes: new Int8Array(width * height).fill(NOT_PAINTED) };
}

/** Whether anything is painted. */
export function hasEdits(edits) {
  return !!edits && edits.codes.some((c) => c !== NOT_PAINTED);
}

/** Edits as text: "w x h" and runs "count*code", e.g. "4x2:3*-1,2*5,3*-1". */
export function encodeEdits(edits) {
  const runs = [];
  const c = edits.codes;
  for (let i = 0; i < c.length;) {
    let j = i;
    while (j < c.length && c[j] === c[i]) j++;
    runs.push(`${j - i}*${c[i]}`);
    i = j;
  }
  return `${edits.width}x${edits.height}:${runs.join(',')}`;
}

/** encodeEdits back to edits; null when the text is broken. */
export function decodeEdits(text) {
  const m = /^(\d+)x(\d+):(.*)$/.exec(text || '');
  if (!m) return null;
  const edits = emptyEdits(Number(m[1]), Number(m[2]));
  let at = 0;
  for (const run of m[3].split(',')) {
    const [n, code] = run.split('*').map(Number);
    if (!Number.isFinite(n) || !Number.isFinite(code) || at + n > edits.codes.length) return null;
    edits.codes.fill(code, at, at + n);
    at += n;
  }
  return at === edits.codes.length ? edits : null;
}

/** Paints a round brush of the given radius (0: one pixel) at x, y. */
export function paintBrush(edits, x, y, radius, code) {
  const { width, height, codes } = edits;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius + radius) continue;
      const px = x + dx;
      const py = y + dy;
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      codes[py * width + px] = code;
    }
  }
}

/** Paints a line of brushes from one point to another (a mouse drag). */
export function paintLine(edits, x0, y0, x1, y1, radius, code) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let s = 0; s <= steps; s++) {
    paintBrush(edits, Math.round(x0 + ((x1 - x0) * s) / steps), Math.round(y0 + ((y1 - y0) * s) / steps), radius, code);
  }
}

/**
 * Paints every drawn pixel of the picture in (nearly) the colour of the pixel at x, y: one click
 * puts, say, all of a belt's leather in one slot. tolerance: max difference per channel.
 * @returns {number} pixels painted
 */
export function paintColour(edits, image, x, y, code, tolerance = 12) {
  const d = image.data;
  const at = (y * image.width + x) * 4;
  if (d[at + 3] <= 16) return 0;
  let n = 0;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (d[i + 3] <= 16) continue;
    if (Math.abs(d[i] - d[at]) > tolerance || Math.abs(d[i + 1] - d[at + 1]) > tolerance || Math.abs(d[i + 2] - d[at + 2]) > tolerance) continue;
    edits.codes[p] = code;
    n++;
  }
  return n;
}

/**
 * The colour mask with the painting on top: painted pixels get their slot's mask colour, or none
 * (keep as drawn); the rest stay as in `mask` (null: no mask under the painting).
 */
export function applyEdits(mask, edits, width, height) {
  const out = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  if (mask && mask.width === width && mask.height === height) out.data.set(mask.data);
  if (!edits || edits.width !== width || edits.height !== height) return out;
  const codes = edits.codes;
  for (let p = 0; p < codes.length; p++) {
    const code = codes[p];
    if (code === NOT_PAINTED) continue;
    const i = p * 4;
    if (code === KEEP) {
      out.data[i + 3] = 0;
      continue;
    }
    const rgb = SLOTS[code - 1]?.rgb;
    if (rgb == null) continue;
    out.data[i] = (rgb >> 16) & 255;
    out.data[i + 1] = (rgb >> 8) & 255;
    out.data[i + 2] = rgb & 255;
    out.data[i + 3] = 255;
  }
  return out;
}
