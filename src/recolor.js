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

/**
 * Recolours one layer.
 * - With `mask`: each pixel uses the slot its mask colour marks (TV/TVD/SV `_c` files).
 * - With `slotId`: the whole layer uses that slot (FG `_mNNN` files).
 * Pixels without an assigned gradient keep their original colour.
 * @param {object} base image
 * @param {object|null} mask image of the same size
 * @param {string|null} slotId
 * @param {(slotId:string)=>Uint8ClampedArray|null} gradientFor
 * @param {{invertGradient:boolean}} settings
 */
export function recolorLayer(base, mask, slotId, gradientFor, settings) {
  const out = { width: base.width, height: base.height, data: new Uint8ClampedArray(base.data) };
  if (!mask && !slotId) return out;

  const src = base.data;
  const dst = out.data;
  const invert = settings.invertGradient;
  const wholeLayerGradient = slotId ? gradientFor(slotId) : null;
  if (!mask && !wholeLayerGradient) return out;

  const maskUsable = mask && mask.width === base.width && mask.height === base.height;
  const perSlot = new Map();

  for (let i = 0; i < src.length; i += 4) {
    if (src[i + 3] === 0) continue;
    let gradient = wholeLayerGradient;
    if (maskUsable) {
      const m = mask.data;
      if (m[i + 3] === 0) continue;
      const id = matchSlot((m[i] << 16) | (m[i + 1] << 8) | m[i + 2]);
      if (!id) continue;
      if (!perSlot.has(id)) perSlot.set(id, gradientFor(id));
      gradient = perSlot.get(id);
    }
    if (!gradient) continue;
    let index = luminance(src[i], src[i + 1], src[i + 2]);
    if (invert) index = 255 - index;
    dst[i] = gradient[index * 4];
    dst[i + 1] = gradient[index * 4 + 1];
    dst[i + 2] = gradient[index * 4 + 2];
  }
  return out;
}

/** Source-over blends `top` onto `target` in place, with top offset by (ox, oy). */
export function blendOver(target, top, ox = 0, oy = 0) {
  const t = target.data;
  const s = top.data;
  for (let y = 0; y < top.height; y++) {
    const ty = y + oy;
    if (ty < 0 || ty >= target.height) continue;
    for (let x = 0; x < top.width; x++) {
      const tx = x + ox;
      if (tx < 0 || tx >= target.width) continue;
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
