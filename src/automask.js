// Colour masks made by the generator, for parts drawn without one. The colours a part is drawn in
// are split into a few groups (skin, cloth, metal...) and every drawn pixel gets the slot colour of
// its group, so the part recolours like RPG Maker's own parts: light and shade of one colour stay
// in one group, and the gradient follows the pixel's brightness as usual.
// Pure: no DOM.

import { SLOTS, SLOT_BY_ID, MAIN_SLOT } from './format.js';

/** Most colour groups offered. */
export const MAX_GROUPS = 4;

/** A colour as a point where brightness counts little: shades of one colour lie close together. */
function point(r, g, b) {
  return [r - g, (r + g) / 2 - b, ((r + g + b) / 3) * 0.35];
}

const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** Drawn colours of some pictures, rounded and counted: [{rgb:[r,g,b], p:point, w:count}]. */
function colourCounts(images) {
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
    return { rgb, p: point(...rgb), w };
  });
}

/**
 * Splits the colours of some pictures into at most `count` groups. Always the same groups for the
 * same pictures: it starts from the most used colour, then the colour furthest from those so far.
 * @returns {{centre:number[], rgb:number}[]} rgb: the group's average colour, most used group first
 */
export function colourGroups(images, count) {
  const colours = colourCounts(images);
  if (!colours.length) return [];
  let centres = [colours.reduce((a, b) => (b.w > a.w ? b : a)).p];
  while (centres.length < count) {
    let far = null;
    let farDist = 24 ** 2; // colours closer than this are one group
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
    .map(({ centre, rgb }) => ({ centre, rgb }));
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
  const rgbs = slotIds.map((id) => SLOT_BY_ID.get(id)?.rgb ?? null);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const rgb = rgbs[nearest(point(d[i], d[i + 1], d[i + 2]), centres)];
    if (rgb == null) continue;
    out.data[i] = (rgb >> 16) & 255;
    out.data[i + 1] = (rgb >> 8) & 255;
    out.data[i + 2] = rgb & 255;
    out.data[i + 3] = 255;
  }
  return out;
}

/** A second slot that goes with a main one: hair has a sub colour. */
const SECOND_SLOT = { hair: ['hairSub'] };

/**
 * The slots a part's colour groups use at first: the part's main slot (Body: skin), then its other
 * slots (Clothing sub 1, 2, 3; Hair sub), then the main one again.
 */
export function defaultGroupSlots(part, count) {
  const main = MAIN_SLOT[part] || 'clothing';
  const own = SLOTS.filter((s) => s.part === part).map((s) => s.id);
  const list = [...new Set([main, ...own, ...(SECOND_SLOT[main] || [])])];
  return Array.from({ length: count }, (_, i) => list[i] || main);
}
