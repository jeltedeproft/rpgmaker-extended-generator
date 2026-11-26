// Pixel-level recolouring and blending. Images are {width, height, data: Uint8ClampedArray RGBA}.

import { SLOTS, SLOT_BY_RGB, MASK_IGNORE_RGB, MASK_TOLERANCE } from './format.js';
import { adjustRgb } from './gradients.js';

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
 * their original colour). With `base`, a mask pixel painted in the image's own colour at that spot
 * counts as "keep as drawn" and isn't reported: some packs copy outlines and fixed details
 * (buckles, highlights) from the image into the mask.
 * @returns {{slots:Set<string>, unknown:Map<number,number>}} unknown: rgb -> pixel count
 */
export function scanMask(mask, base = null) {
  const sameAsBase = (i) => base && base.width === mask.width && base.height === mask.height
    && Math.abs(base.data[i] - mask.data[i]) <= 24 && Math.abs(base.data[i + 1] - mask.data[i + 1]) <= 24
    && Math.abs(base.data[i + 2] - mask.data[i + 2]) <= 24;
  const palette = maskPalette(mask);
  const slots = new Set([...palette.values()].filter(Boolean));
  const unknown = new Map();
  const d = mask.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const rgb = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    if (palette.get(rgb) === undefined && !sameAsBase(i)) unknown.set(rgb, (unknown.get(rgb) || 0) + 1);
  }
  return { slots, unknown };
}

/**
 * Recolours one layer.
 * - With `mask`: each pixel uses the slot its mask colour marks (TV/TVD/SV `_c` files).
 * - With `slotId`: the whole layer uses that slot (FG `_mNNN` files).
 * Pixels without an assigned gradient keep their original colour. A slot can also shift its own
 * colours instead ({shift: {hue, saturation, brightness}}, see createSourceAdjust).
 * @param {object} base image
 * @param {object|null} mask image of the same size
 * @param {string|null} slotId
 * @param {(slotId:string)=>Uint8ClampedArray|{shift:object}|null} gradientFor
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
    if (gradient.shift) {
      dst.set(adjustRgb(src[i], src[i + 1], src[i + 2], gradient.shift), i);
      continue;
    }
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

/**
 * Centre of the visible pixels in every frame, over several same-size images (all layers of one
 * item, so they turn together). Map "fx,fy" -> {cx, cy}.
 * @param {{w:number,h:number}|null} frame null = the whole image is one frame
 */
export function frameCentres(images, frame = null) {
  const centres = new Map();
  if (!images.length) return centres;
  const { width, height } = images[0];
  const fw = frame?.w || width;
  const fh = frame?.h || height;
  for (let fy = 0; fy + fh <= height; fy += fh) {
    for (let fx = 0; fx + fw <= width; fx += fw) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -1;
      let maxY = -1;
      for (const image of images) {
        const s = image.data;
        for (let y = fy; y < fy + fh; y++) {
          for (let x = fx; x < fx + fw; x++) {
            if (!s[(y * width + x) * 4 + 3]) continue;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX >= 0) centres.set(`${fx},${fy}`, { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 });
    }
  }
  return centres;
}

/**
 * Scale2x (EPX): doubles a pixel-art image, rounding off its stair steps instead of blowing up
 * square pixels. Twice gives the 4x picture that smooth turning and enlarging sample from.
 */
export function scale2x(image) {
  const { width: w, height: h } = image;
  const src = new Uint32Array(image.data.buffer, image.data.byteOffset, w * h);
  const out = createImage(w * 2, h * 2);
  const dst = new Uint32Array(out.data.buffer);
  const at = (x, y) => src[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const e = src[y * w + x];
      const b = at(x, y - 1);
      const d = at(x - 1, y);
      const f = at(x + 1, y);
      const hh = at(x, y + 1);
      const o = (y * 2) * w * 2 + x * 2;
      const same = b === hh || d === f;
      dst[o] = !same && d === b ? d : e;
      dst[o + 1] = !same && b === f ? f : e;
      dst[o + w * 2] = !same && d === hh ? d : e;
      dst[o + w * 2 + 1] = !same && hh === f ? f : e;
    }
  }
  return out;
}

/** The 4x Scale2x picture of an image, made once per image. */
const smoothCache = new WeakMap();
function smoothed(image) {
  if (!smoothCache.has(image)) smoothCache.set(image, scale2x(scale2x(image)));
  return smoothCache.get(image);
}

/** A transform that changes nothing. */
export const NO_TRANSFORM = Object.freeze({ rot: 0, scale: 100, flipX: false, flipY: false });

/** True when a transform ({rot, scale (%), flipX, flipY}) changes the picture. */
export function isTransformed(t) {
  return !!t && (!!t.rot || (t.scale ?? 100) !== 100 || (t.scaleY ?? t.scale ?? 100) !== (t.scale ?? 100) || !!t.flipX || !!t.flipY);
}

/**
 * Geometric frame centres (the middle of each frame, whatever is drawn in it), keyed like
 * frameCentres. Used to transform a whole image, so an animation doesn't wobble.
 */
export function gridCentres(width, height, frame = null) {
  const centres = new Map();
  const fw = frame?.w || width;
  const fh = frame?.h || height;
  for (let fy = 0; fy + fh <= height; fy += fh) {
    for (let fx = 0; fx + fw <= width; fx += fw) centres.set(`${fx},${fy}`, { cx: fx + (fw - 1) / 2, cy: fy + (fh - 1) / 2 });
  }
  return centres;
}

/**
 * Transforms the content of every frame (tile) around its centre: mirrored (flipX), flipped
 * upside down (flipY), resized (scale, percent) and turned (rot, degrees clockwise), in that
 * order. Nearest-neighbour sampling keeps pixel art crisp. Nothing moves into a neighbouring frame.
 * @param {{w:number,h:number}|null} frame null = the whole image is one frame
 * @param {object|((fx:number, fy:number)=>object)} transform one for all frames, or one per frame
 *   (by the frame's top-left pixel)
 * @param {Map} [centres] from frameCentres or gridCentres; defaults to this image's own pixels
 */
export function transformFrames(image, transform, frame = null, centres = frameCentres([image], frame)) {
  if (typeof transform !== 'function' && !isTransformed(transform)) return image;
  const fw = frame?.w || image.width;
  const fh = frame?.h || image.height;
  const out = createImage(image.width, image.height);
  const s = image.data;
  let up = null;
  for (let fy = 0; fy + fh <= image.height; fy += fh) {
    for (let fx = 0; fx + fw <= image.width; fx += fw) {
      const centre = centres.get(`${fx},${fy}`);
      if (!centre) continue;
      const t = typeof transform === 'function' ? transform(fx, fy) : transform;
      if (!isTransformed(t)) {
        // This frame isn't changed: copy it as it is.
        for (let y = fy; y < fy + fh; y++) {
          const start = (y * image.width + fx) * 4;
          out.data.set(s.subarray(start, start + fw * 4), start);
        }
        continue;
      }
      const { cx, cy } = centre;
      const rad = ((t.rot || 0) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      // scaleY: the height on its own (stretched or squashed); else the same as the width.
      const k = 100 / Math.max(1, t.scale ?? 100);
      const ky = 100 / Math.max(1, t.scaleY ?? t.scale ?? 100);
      const mx = t.flipX ? -1 : 1;
      const my = t.flipY ? -1 : 1;
      // Smooth: turned (not by a quarter) or enlarged pixel art is sampled from its 4x Scale2x
      // picture (like RotSprite), so edges stay clean lines instead of jagged blocks.
      const smooth = t.smooth && ((t.rot || 0) % 90 !== 0 || (t.scale ?? 100) > 100 || (t.scaleY ?? 100) > 100);
      if (smooth) up ||= smoothed(image);
      for (let y = fy; y < fy + fh; y++) {
        for (let x = fx; x < fx + fw; x++) {
          // Inverse mapping: which source pixel lands here (turn back, shrink back, flip back).
          const dx = x - cx;
          const dy = y - cy;
          const u = cx + (dx * cos + dy * sin) * k * mx;
          const v = cy + (-dx * sin + dy * cos) * ky * my;
          const sx = Math.round(u);
          const sy = Math.round(v);
          if (sx < fx || sx >= fx + fw || sy < fy || sy >= fy + fh) continue;
          const di = (y * image.width + x) * 4;
          if (smooth) {
            const ux = Math.min(sx * 4 + 3, Math.max(sx * 4, Math.floor((u + 0.5) * 4)));
            const uy = Math.min(sy * 4 + 3, Math.max(sy * 4, Math.floor((v + 0.5) * 4)));
            const ui = (uy * up.width + ux) * 4;
            if (!up.data[ui + 3]) continue;
            out.data.set(up.data.subarray(ui, ui + 4), di);
            continue;
          }
          const si = (sy * image.width + sx) * 4;
          if (!s[si + 3]) continue;
          out.data[di] = s[si];
          out.data[di + 1] = s[si + 1];
          out.data[di + 2] = s[si + 2];
          out.data[di + 3] = s[si + 3];
        }
      }
    }
  }
  return out;
}

/**
 * Rotates the content of every frame around its centre, by `degrees` clockwise (see
 * transformFrames).
 * @param {number|((fx:number, fy:number)=>number)} degrees one angle, or one per frame
 */
export function rotateFrames(image, degrees, frame = null, centres = frameCentres([image], frame)) {
  if (!degrees) return image;
  const t = typeof degrees === 'function' ? (fx, fy) => ({ rot: degrees(fx, fy) }) : { rot: degrees };
  return transformFrames(image, t, frame, centres);
}

/**
 * Swaps two rows of frames, e.g. the walk sheet's left- and right-facing rows: a mirrored walk
 * sprite facing left is the right-facing one.
 */
export function swapFrameRows(image, frame, a, b) {
  const out = createImage(image.width, image.height);
  out.data.set(image.data);
  const rowBytes = image.width * 4;
  for (let y = 0; y < frame.h; y++) {
    const ya = (a * frame.h + y) * rowBytes;
    const yb = (b * frame.h + y) * rowBytes;
    if (ya + rowBytes > image.data.length || yb + rowBytes > image.data.length) continue;
    out.data.set(image.data.subarray(yb, yb + rowBytes), ya);
    out.data.set(image.data.subarray(ya, ya + rowBytes), yb);
  }
  return out;
}

/**
 * Like blendOver on an animation sheet, but every frame gets its own offset, e.g. a hat moved
 * only in the walk frames facing left. Nothing moves into a neighbouring frame.
 * @param {(col:number, row:number)=>{x:number,y:number}} offsetAt
 */
export function blendFrames(target, top, frame, offsetAt) {
  const t = target.data;
  const s = top.data;
  for (let row = 0; (row + 1) * frame.h <= top.height; row++) {
    for (let col = 0; (col + 1) * frame.w <= top.width; col++) {
      const { x: ox, y: oy } = offsetAt(col, row);
      const fx = col * frame.w;
      const fy = row * frame.h;
      for (let y = fy; y < fy + frame.h; y++) {
        const ty = y + oy;
        if (ty < fy || ty >= fy + frame.h || ty >= target.height) continue;
        for (let x = fx; x < fx + frame.w; x++) {
          const tx = x + ox;
          if (tx < fx || tx >= fx + frame.w || tx >= target.width) continue;
          const si = (y * top.width + x) * 4;
          const sa = s[si + 3];
          if (sa === 0) continue;
          const ti = (ty * target.width + tx) * 4;
          const a = sa / 255;
          const da = t[ti + 3] / 255;
          const outA = a + da * (1 - a);
          t[ti] = (s[si] * a + t[ti] * da * (1 - a)) / outA;
          t[ti + 1] = (s[si + 1] * a + t[ti + 1] * da * (1 - a)) / outA;
          t[ti + 2] = (s[si + 2] * a + t[ti + 2] * da * (1 - a)) / outA;
          t[ti + 3] = outA * 255;
        }
      }
    }
  }
  return target;
}
