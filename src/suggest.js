// Suggests how to read a file whose name the generator doesn't understand: which image (sheet) it
// is from its size and frame grid, and which part from where its pixels sit compared with the
// parts already loaded (hair sits on top of the head, glasses over the eyes, a cloak behind it).

import { DEFAULT_SIZE, SHEETS } from './format.js';

/** Side of the coarse grid a shape is compared on. */
export const PROFILE_SIZE = 12;

/**
 * The image (sheet) a file of this size probably is, with the reason in words.
 * @returns {{sheet:string, why:string}}
 */
export function guessSheet(width, height) {
  for (const [sheet, s] of Object.entries(DEFAULT_SIZE)) {
    if (s.w === width && s.h === height) return { sheet, why: `${width}×${height}px is RPG Maker's ${SHEETS[sheet].label.toLowerCase()} size` };
  }
  if (width <= 64 && height <= 64) return { sheet: 'icon', why: 'small enough for a variation icon' };
  // Not RPG Maker's size: go by the frame grid (3×4 walk, 3×1 damage, 9×6 battler, square face).
  const grids = [
    ['TV', 3, 4], ['TVD', 3, 1], ['SV', 9, 6],
  ];
  for (const [sheet, cols, rows] of grids) {
    if (width % cols || height % rows) continue;
    const fw = width / cols;
    const fh = height / rows;
    if (fw === fh) return { sheet, why: `splits into ${cols}×${rows} square frames of ${fw}px, like a ${SHEETS[sheet].label.toLowerCase()} sheet` };
  }
  if (width === height) return { sheet: 'FG', why: 'square, like a face' };
  return { sheet: 'TV', why: 'size matches no image; walk is a guess' };
}

/**
 * The part of a sheet image that is compared: the first frame (the standing frame facing down for
 * walk sheets), or the whole picture when it has no frame grid.
 */
export function sampleRegion(width, height, sheet) {
  const grid = SHEETS[sheet]?.frame;
  if (!grid || width % grid.cols || height % grid.rows) return { x: 0, y: 0, w: width, h: height };
  const w = width / grid.cols;
  const h = height / grid.rows;
  return { x: sheet === 'TV' && grid.cols === 3 ? w : 0, y: 0, w, h };
}

/**
 * Where a picture has pixels: the share of opaque pixels in each cell of a PROFILE_SIZE grid over
 * the sample region. Two parts that cover the same area get similar profiles.
 * @returns {Float32Array|null} null when the region is empty
 */
export function shapeProfile(pixels, sheet) {
  const { x: rx, y: ry, w, h } = sampleRegion(pixels.width, pixels.height, sheet);
  const n = PROFILE_SIZE;
  const counts = new Float32Array(n * n);
  const totals = new Float32Array(n * n);
  let any = false;
  for (let y = 0; y < h; y++) {
    const cy = Math.min(n - 1, Math.floor((y * n) / h));
    for (let x = 0; x < w; x++) {
      const cx = Math.min(n - 1, Math.floor((x * n) / w));
      const i = cy * n + cx;
      totals[i]++;
      if (pixels.data[((ry + y) * pixels.width + rx + x) * 4 + 3] > 16) {
        counts[i]++;
        any = true;
      }
    }
  }
  if (!any) return null;
  for (let i = 0; i < counts.length; i++) counts[i] = totals[i] ? counts[i] / totals[i] : 0;
  return counts;
}

/**
 * How alike two shapes are, 0..1: how much they overlap (cells covered by both, against cells
 * covered by either), so a small part is not "like" a big one just for sitting inside it.
 */
export function shapeSimilarity(a, b) {
  let both = 0;
  let either = 0;
  for (let i = 0; i < a.length; i++) {
    both += Math.min(a[i], b[i]);
    either += Math.max(a[i], b[i]);
  }
  return either ? both / either : 0;
}

/**
 * Ranks parts by how well a shape matches the loaded parts' shapes on the same sheet.
 * @param {Float32Array} profile the new file's shape
 * @param {{part:string, layer:string, cell?:string, profile:Float32Array}[]} references
 * @returns {{part:string, layer:string, cell?:string, score:number}[]} best first, one per part
 */
export function rankParts(profile, references, limit = 3) {
  const best = new Map();
  for (const ref of references) {
    const score = shapeSimilarity(profile, ref.profile);
    const prev = best.get(ref.part);
    if (!prev || score > prev.score) best.set(ref.part, { part: ref.part, layer: ref.layer, cell: ref.cell, score });
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
