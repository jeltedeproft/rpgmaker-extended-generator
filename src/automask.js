// Colour masks made by the generator, for parts drawn without one. The colours a part is drawn in
// are split into a few groups (skin, cloth, metal...) and every drawn pixel gets the slot colour of
// its group, so the part recolours like RPG Maker's own parts: light and shade of one colour stay
// in one group, and the gradient follows the pixel's brightness as usual.
// Pure: no DOM.

import { SLOTS, SLOT_BY_ID, MAIN_SLOT } from './format.js';

/** Most colour groups offered. */
export const MAX_GROUPS = 8;

/** "As many as it finds": colours closer than this (in point() units) count as one group. */
export const AUTO_SPREAD = 40;

/** A colour as a point where brightness counts little: shades of one colour lie close together. */
function point(r, g, b) {
  return [r - g, (r + g) / 2 - b, ((r + g + b) / 3) * 0.35];
}

/**
 * Like point(), but the colour is measured relative to the brightness, so every shade of one
 * colour lies close together: used to count the colours ("as many as it finds").
 */
function chromaPoint(r, g, b) {
  const light = (r + g + b) / 3 + 16;
  return [((r - g) / light) * 100, (((r + g) / 2 - b) / light) * 100, light * 0.35];
}

const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** Drawn colours of some pictures, rounded and counted: [{rgb:[r,g,b], p:point, w:count}]. */
function colourCounts(images, toPoint = point) {
  const counts = new Map();
  for (const img of images) {
    if (!img) continue;
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] <= 16) continue;
      const key = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return [...counts].map(([key, w]) => {
    const rgb = [((key >> 10) & 31) * 8 + 4, ((key >> 5) & 31) * 8 + 4, (key & 31) * 8 + 4];
    return { rgb, p: toPoint(...rgb), w };
  });
}

/**
 * Splits the colours of some pictures into at most `count` groups. Always the same groups for the
 * same pictures: it starts from the most used colour, then the colour furthest from those so far.
 * @returns {{centre:number[], rgb:number}[]} rgb: the group's average colour, most used group first
 */
export function colourGroups(images, count, spread = 24, byChroma = false) {
  const colours = colourCounts(images, byChroma ? chromaPoint : point);
  if (!colours.length) return [];
  let centres = [colours.reduce((a, b) => (b.w > a.w ? b : a)).p];
  while (centres.length < count) {
    let far = null;
    let farDist = spread ** 2; // colours closer than this are one group
    for (const c of colours) {
      const d = Math.min(...centres.map((x) => dist2(x, c.p)));
      if (d > farDist) [far, farDist] = [c, d];
    }
    if (!far) break;
    centres.push(far.p);
  }
  let groups = [];
  for (let round = 0; round < 12; round++) {
    groups = centres.map(() => ({ sum: [0, 0, 0], rgb: [0, 0, 0], w: 0 }));
    for (const c of colours) {
      const g = groups[nearest(c.p, centres)];
      for (let k = 0; k < 3; k++) {
        g.sum[k] += c.p[k] * c.w;
        g.rgb[k] += c.rgb[k] * c.w;
      }
      g.w += c.w;
    }
    centres = groups.map((g, i) => (g.w ? g.sum.map((v) => v / g.w) : centres[i]));
  }
  return groups
    .map((g, i) => ({ centre: centres[i], w: g.w, rgb: g.w ? g.rgb.reduce((acc, v) => (acc << 8) | Math.round(v / g.w), 0) : 0 }))
    .filter((g) => g.w)
    .sort((a, b) => b.w - a.w)
    .map(({ centre, rgb }) => ({ centre, rgb, ...(byChroma ? { byChroma } : {}) }));
}

function nearest(p, centres) {
  let best = 0;
  for (let i = 1; i < centres.length; i++) if (dist2(p, centres[i]) < dist2(p, centres[best])) best = i;
  return best;
}

/**
 * A colour mask for a picture: each drawn pixel in the slot colour of its colour group. A group
 * whose slot is null keeps its drawn colours (left out of the mask).
 * @param {string[]} slotIds one per group
 */
export function makeMask(image, groups, slotIds) {
  const out = { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data.length) };
  const centres = groups.map((g) => g.centre);
  const toPoint = groups[0]?.byChroma ? chromaPoint : point;
  const rgbs = slotIds.map((id) => SLOT_BY_ID.get(id)?.rgb ?? null);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const rgb = rgbs[nearest(toPoint(d[i], d[i + 1], d[i + 2]), centres)];
    if (rgb == null) continue;
    out.data[i] = (rgb >> 16) & 255;
    out.data[i + 1] = (rgb >> 8) & 255;
    out.data[i + 2] = rgb & 255;
    out.data[i + 3] = 255;
  }
  return out;
}

/**
 * A colour mask for a Variation icon, from the part's own pictures and their colour masks: an icon
 * pixel gets the mask colour that its colour has in the part's pictures (the nearest colour, for
 * icons drawn smaller). Colours that are kept as drawn there stay as drawn on the icon.
 * @param {{image:object, mask:object}[]} pairs the part's pictures with their colour masks
 * @returns {object|null} the mask, or null when the pictures tell nothing
 */
export function iconMask(icon, pairs) {
  const votes = new Map();
  for (const { image, mask } of pairs) {
    if (!image || !mask || image.width !== mask.width || image.height !== mask.height) continue;
    const d = image.data;
    const m = mask.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] <= 16) continue;
      const colour = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      const kept = m[i + 3] <= 16 || (m[i] > 240 && m[i + 1] > 240 && m[i + 2] > 240);
      const vote = kept ? -1 : (m[i] << 16) | (m[i + 1] << 8) | m[i + 2];
      let v = votes.get(colour);
      if (!v) votes.set(colour, (v = new Map()));
      v.set(vote, (v.get(vote) || 0) + 1);
    }
  }
  if (!votes.size) return null;
  const best = new Map([...votes].map(([colour, v]) => [colour, [...v].reduce((a, b) => (b[1] > a[1] ? b : a))[0]]));
  if (![...best.values()].some((v) => v >= 0)) return null;
  const known = [...best.keys()];
  const near = new Map();
  const nearest = (c) => {
    if (!near.has(c)) {
      let found = -1;
      let bestDist = 40 ** 2;
      for (const k of known) {
        const d = (((k >> 16) & 255) - ((c >> 16) & 255)) ** 2 + (((k >> 8) & 255) - ((c >> 8) & 255)) ** 2 + ((k & 255) - (c & 255)) ** 2;
        if (d < bestDist) [found, bestDist] = [best.get(k), d];
      }
      near.set(c, found);
    }
    return near.get(c);
  };
  const out = { width: icon.width, height: icon.height, data: new Uint8ClampedArray(icon.data.length) };
  const d = icon.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] <= 16) continue;
    const colour = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    const v = best.has(colour) ? best.get(colour) : nearest(colour);
    if (v < 0) continue;
    out.data.set([(v >> 16) & 255, (v >> 8) & 255, v & 255, 255], i);
  }
  return out;
}

/** A second slot that goes with a main one: hair has a sub colour. */
const SECOND_SLOT = { hair: ['hairSub'] };

/** Grey that is nearly black or nearly white: outlines, the whites of eyes, shines. */
export function outlineOrWhite(rgb) {
  const c = [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255];
  const light = (c[0] + c[1] + c[2]) / 3;
  return Math.max(...c) - Math.min(...c) < 28 && (light < 56 || light > 220);
}

/**
 * Whether a colour could be skin (any skin tone, light to dark): a red to yellow hue, or nearly
 * grey. Blue, green and purple are not: on a body's walk sprite those are the eyes.
 */
export function skinLike(rgb) {
  const [r, g, b] = [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 0.2 * max || max < 40) return true;
  let hue = r === max ? ((g - b) / (max - min)) * 60 : g === max ? (2 + (b - r) / (max - min)) * 60 : (4 + (r - g) / (max - min)) * 60;
  if (hue < 0) hue += 360;
  return hue <= 65 || hue >= 335;
}

/**
 * The slots a part's colour groups use at first: the part's main slot (Body: skin), then its other
 * slots (Clothing sub 1, 2, 3; Hair sub), then the main one again. With the groups given, black
 * outlines and white (eye whites, shines) keep their drawn colours, unless that is all there is,
 * and on skin parts (body, face) a colour that can't be skin (blue, green...) is the eyes.
 */
export function defaultGroupSlots(part, count, groups = null) {
  const main = MAIN_SLOT[part] || 'clothing';
  const own = SLOTS.filter((s) => s.part === part).map((s) => s.id);
  const list = [...new Set([main, ...own, ...(SECOND_SLOT[main] || [])])];
  const keep = Array.from({ length: count }, (_, i) => !!groups?.[i] && outlineOrWhite(groups[i].rgb));
  if (keep.every(Boolean)) keep.fill(false);
  const eyes = Array.from({ length: count }, (_, i) => main === 'skin' && !keep[i] && !!groups?.[i] && i > 0 && !skinLike(groups[i].rgb));
  let next = 0;
  return keep.map((k, i) => (k ? null : eyes[i] ? 'eyes' : list[next++] || main));
}

/**
 * The figure the Variation icons of a body type are drawn on: per pixel, the colour most of the
 * icons have there (the grey silhouette; each icon adds its own part to it).
 * @param {object[]} icons decoded icons; those of another size than the first are left out
 */
export function iconSilhouette(icons) {
  const { width, height } = icons[0];
  const same = icons.filter((i) => i.width === width && i.height === height);
  const out = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  for (let i = 0; i < out.data.length; i += 4) {
    const counts = new Map();
    let best = -1;
    let bestCount = 0;
    for (const { data: d } of same) {
      const key = d[i + 3] < 16 ? -1 : (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      const n = (counts.get(key) || 0) + 1;
      counts.set(key, n);
      if (n > bestCount) [best, bestCount] = [key, n];
    }
    if (best >= 0) out.data.set([(best >> 16) & 255, (best >> 8) & 255, best & 255, 255], i);
  }
  return out;
}

const near = (a, i, b, j) => Math.abs(a[i] - b[j]) <= 24 && Math.abs(a[i + 1] - b[j + 1]) <= 24 && Math.abs(a[i + 2] - b[j + 2]) <= 24;

/**
 * A close-up icon, not drawn on the figure (see iconSilhouette): it covers the figure (a face
 * icon), or draws a big picture beside it (MZ and MV draw the ears, eyes, nose and mouth big, on
 * a face behind the figure). Wings, cloaks and long hair reach past the figure too, but much less.
 */
export function isCloseUp(icon, silhouette) {
  if (icon.width !== silhouette.width || icon.height !== silhouette.height) return true;
  const a = icon.data;
  const f = silhouette.data;
  let figure = 0;
  let shown = 0;
  let off = 0;
  for (let i = 0; i < f.length; i += 4) {
    if (f[i + 3] >= 16) {
      figure++;
      if (a[i + 3] >= 16 && near(a, i, f, i)) shown++;
    } else if (a[i + 3] >= 16) off++;
  }
  return figure > 0 && (shown / figure < 0.15 || off / figure > 0.65);
}

/**
 * The colour mask of a close-up icon (see isCloseUp) without the face it is drawn on: pixels the
 * part's other icons share (the backdrop, see iconSilhouette) and plain greys (the grey face, black
 * lines, white shines) stay as drawn. The face took the part's colours in blocks: brown squares
 * behind mouths, a yellow face behind eyes.
 * @param {object|null} backdrop most icons of the part, pixel by pixel; null when there are too few
 */
export function closeUpMask(icon, mask, backdrop) {
  const out = { width: mask.width, height: mask.height, data: new Uint8ClampedArray(mask.data) };
  const a = icon.data;
  const f = backdrop && backdrop.width === icon.width && backdrop.height === icon.height ? backdrop.data : null;
  for (let i = 0; i < a.length; i += 4) {
    const grey = Math.max(a[i], a[i + 1], a[i + 2]) - Math.min(a[i], a[i + 1], a[i + 2]) <= 6;
    const behind = f && f[i + 3] >= 16 && near(a, i, f, i);
    if (grey || behind) out.data[i + 3] = 0;
  }
  return out;
}

/**
 * A part cut out of its Variation icon: the pixels that differ from the figure (see
 * iconSilhouette), taken from `drawn` (the icon recoloured, same size). Null if the sizes differ.
 */
export function iconPart(icon, silhouette, drawn = icon) {
  if (icon.width !== silhouette.width || icon.height !== silhouette.height || drawn.width !== icon.width || drawn.height !== icon.height) return null;
  const out = { width: icon.width, height: icon.height, data: new Uint8ClampedArray(icon.data.length) };
  const a = icon.data;
  const f = silhouette.data;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] < 16) continue;
    const onFigure = f[i + 3] >= 16 && Math.abs(a[i] - f[i]) <= 24 && Math.abs(a[i + 1] - f[i + 1]) <= 24 && Math.abs(a[i + 2] - f[i + 2]) <= 24;
    if (onFigure) continue;
    out.data.set(drawn.data.subarray(i, i + 4), i);
  }
  return out;
}
