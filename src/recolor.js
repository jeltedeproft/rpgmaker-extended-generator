// Pixel-level recolouring and blending. Images are {width, height, data: Uint8ClampedArray RGBA}.

import { SLOTS, SLOT_BY_RGB, MASK_IGNORE_RGB, MASK_TOLERANCE } from './format.js';

export function createImage(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function luminance(r, g, b) {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

const slotMatchCache = new Map();

/** Maps a mask pixel colour to a slot id, tolerating small deviations. null = not recolourable. */
export function matchSlot(rgb) {
  if (rgb === MASK_IGNORE_RGB) return null;
  const exact = SLOT_BY_RGB.get(rgb);
  if (exact) return exact.id;
  if (slotMatchCache.has(rgb)) return slotMatchCache.get(rgb);
  const r = (rgb >> 16) & 255;
  const g = (rgb >> 8) & 255;
  const b = rgb & 255;
  let best = null;
  let bestDistance = Infinity;
  for (const slot of SLOTS) {
    const dr = Math.abs(((slot.rgb >> 16) & 255) - r);
    const dg = Math.abs(((slot.rgb >> 8) & 255) - g);
    const db = Math.abs((slot.rgb & 255) - b);
    const d = Math.max(dr, dg, db);
    if (d <= MASK_TOLERANCE && d < bestDistance) {
      best = slot.id;
      bestDistance = d;
    }
  }
  slotMatchCache.set(rgb, best);
  return best;
}

/** Unknown mask colours this close (max channel difference) to a slot the mask uses join it. */
export const MASK_NEAR_DISTANCE = 64;
const paletteCache = new WeakMap();

/**
 * Maps every colour in a mask to a slot id (or null = keep the original colour).
 * Exact slot colours (with a small tolerance) come first. RPG Maker's own masks also contain
 * near-misses, e.g. MZ's TV_Body masks mark part of each eye #1380f8 instead of #2c80cb. Those
 * join the closest slot that this same mask already uses, or white (keep) when that is closer.
 * @returns {Map<number,string|null>}
 */
export function maskPalette(mask) {
  if (paletteCache.has(mask)) return paletteCache.get(mask);
  const palette = new Map();
  const d = mask.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const rgb = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    if (!palette.has(rgb)) palette.set(rgb, matchSlot(rgb));
  }
  const used = new Set([...palette.values()].filter(Boolean));
  const candidates = [{ id: null, rgb: MASK_IGNORE_RGB }, ...SLOTS.filter((s) => used.has(s.id))];
  for (const [rgb, id] of palette) {
    if (id || rgb === MASK_IGNORE_RGB) continue;
    let best;
    let bestDistance = MASK_NEAR_DISTANCE + 1;
    for (const c of candidates) {
      const dist = Math.max(
        Math.abs(((c.rgb >> 16) & 255) - ((rgb >> 16) & 255)),
        Math.abs(((c.rgb >> 8) & 255) - ((rgb >> 8) & 255)),
        Math.abs((c.rgb & 255) - (rgb & 255)),
      );
      if (dist < bestDistance) {
        best = c;
        bestDistance = dist;
      }
    }
    palette.set(rgb, best ? best.id : undefined);
  }
  paletteCache.set(mask, palette);
  return palette;
}

/**
 * Which slots a mask uses, plus colours that match no slot even approximately (those pixels keep
 * their original colour).
 * @returns {{slots:Set<string>, unknown:Map<number,number>}} unknown: rgb -> pixel count
 */
export function scanMask(mask) {
  const palette = maskPalette(mask);
  const slots = new Set([...palette.values()].filter(Boolean));
  const unknown = new Map();
  const d = mask.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const rgb = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    if (palette.get(rgb) === undefined) unknown.set(rgb, (unknown.get(rgb) || 0) + 1);
  }
  return { slots, unknown };
}

/**
 * Recolours one layer.
 * - With `mask`: each pixel uses the slot its mask colour marks (TV/TVD/SV `_c` files).
 * - With `slotId`: the whole layer uses that slot (FG `_mNNN` files).
 * Pixels without an assigned gradient keep their original colour.
 * @param {object} base image
 * @param {object|null} mask image of the same size
 * @param {string|null} slotId
 * @param {(slotId:string)=>Uint8ClampedArray|null} gradientFor
 * @param {{flipGradient:boolean}} settings
 */
export function recolorLayer(base, mask, slotId, gradientFor, settings) {
  const out = { width: base.width, height: base.height, data: new Uint8ClampedArray(base.data) };
  if (!mask && !slotId) return out;

  const src = base.data;
  const dst = out.data;
  const flip = settings.flipGradient;
  const wholeLayerGradient = slotId ? gradientFor(slotId) : null;
  if (!mask && !wholeLayerGradient) return out;

  const maskUsable = mask && mask.width === base.width && mask.height === base.height;
  const palette = maskUsable ? maskPalette(mask) : null;
  const perSlot = new Map();

  for (let i = 0; i < src.length; i += 4) {
    if (src[i + 3] === 0) continue;
    let gradient = wholeLayerGradient;
    if (maskUsable) {
      const m = mask.data;
      if (m[i + 3] === 0) continue;
      const id = palette.get((m[i] << 16) | (m[i + 1] << 8) | m[i + 2]);
      if (!id) continue;
      if (!perSlot.has(id)) perSlot.set(id, gradientFor(id));
      gradient = perSlot.get(id);
    }
    if (!gradient) continue;
    // Gradients run highlight (column 0) -> shadow (column 255).
    let index = 255 - luminance(src[i], src[i + 1], src[i + 2]);
    if (flip) index = 255 - index;
    dst[i] = gradient[index * 4];
    dst[i + 1] = gradient[index * 4 + 1];
    dst[i + 2] = gradient[index * 4 + 2];
  }
  return out;
}

/**
 * Source-over blends `top` onto `target` in place, with top offset by (ox, oy).
 * With `frame` ({w, h}), pixels never move into a neighbouring animation frame: anything shifted
 * past its frame's edge is clipped.
 */
export function blendOver(target, top, ox = 0, oy = 0, frame = null) {
  const t = target.data;
  const s = top.data;
  for (let y = 0; y < top.height; y++) {
    const ty = y + oy;
    if (ty < 0 || ty >= target.height) continue;
    if (frame && Math.floor(y / frame.h) !== Math.floor(ty / frame.h)) continue;
    for (let x = 0; x < top.width; x++) {
      const tx = x + ox;
      if (tx < 0 || tx >= target.width) continue;
      if (frame && Math.floor(x / frame.w) !== Math.floor(tx / frame.w)) continue;
      const si = (y * top.width + x) * 4;
      const sa = s[si + 3];
      if (sa === 0) continue;
      const ti = (ty * target.width + tx) * 4;
      if (sa === 255) {
        t[ti] = s[si];
        t[ti + 1] = s[si + 1];
        t[ti + 2] = s[si + 2];
        t[ti + 3] = 255;
        continue;
      }
      const a = sa / 255;
      const da = t[ti + 3] / 255;
      const outA = a + da * (1 - a);
      t[ti] = (s[si] * a + t[ti] * da * (1 - a)) / outA;
      t[ti + 1] = (s[si + 1] * a + t[ti + 1] * da * (1 - a)) / outA;
      t[ti + 2] = (s[si + 2] * a + t[ti + 2] * da * (1 - a)) / outA;
      t[ti + 3] = outA * 255;
    }
  }
  return target;
}
