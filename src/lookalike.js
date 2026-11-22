// Look-alikes: copies ("p01 (2)") and alternates ("p17 (alt)") that look the same as, or almost
// the same as, their original or another copy. Pure: works on decoded layers.

import { SHEET_KEYS } from './format.js';

/** "p01 (2)" -> "p01", "p17 (alt)" -> "p17", "p01 (2, alt)" -> "p01"; null for plain pids. */
export function copyBase(pid) {
  const m = /^(.*?) \((?:\d+|alt(?: \d+)?|\d+, alt(?: \d+)?)\)$/.exec(pid);
  return m ? m[1] : null;
}

/** Below this share of differing pixels a copy counts as a look-alike. */
export const LOOKALIKE_RATIO = 0.25;

/** Pairs across folders are skipped above this many (a whole folder opened twice). */
export const CROSS_PACK_LIMIT = 300;

/**
 * Every copy paired with what it may duplicate: its original and the copies listed before it, in
 * the same pack, body type and part. With a pack name, that pack's parts are also paired with the
 * same part number in folders opened before it (the same files in two folders).
 * [{variant, other}]
 */
export function lookalikePairs(library, packName = null) {
  const pairs = [];
  const cross = [];
  const packOrder = library.packs.map((p) => p.name);
  for (const body of library.bodyTypes.values()) {
    for (const variants of body.parts.values()) {
      const list = [...variants.values()];
      list.forEach((variant, i) => {
        if (packName && variant.pack !== packName) return;
        const base = copyBase(variant.pid);
        if (base) {
          const earlier = list.filter((v, j) => v.pack === variant.pack && v !== variant
            && (v.pid === base || (copyBase(v.pid) === base && j < i)));
          for (const other of earlier) pairs.push({ variant, other });
        }
        if (packName) {
          for (const other of list) {
            if (other.pid === variant.pid && packOrder.indexOf(other.pack) < packOrder.indexOf(variant.pack)) cross.push({ variant, other });
          }
        }
      });
    }
  }
  return cross.length <= CROSS_PACK_LIMIT ? [...pairs, ...cross] : pairs;
}

/**
 * Which files a folder has, to spot one opened twice: the last three path parts
 * ("tv/male/tv_body_p01.png") plus the file size when known.
 */
export function folderKeys(entries) {
  return new Set(entries.filter((e) => /\.png$/i.test(e.path)).map((e) => {
    const tail = e.path.split('/').slice(-3).join('/').toLowerCase();
    return `${tail}|${typeof e.src?.size === 'number' ? e.src.size : ''}`;
  }));
}

/**
 * The open folder that has (nearly) the same files: {pack, same, total} when at least `share` of
 * the new folder's images match, else null.
 */
export function sameFolder(packs, keys, share = 0.9) {
  let best = null;
  for (const pack of packs) {
    if (!pack.keys || !keys.size) continue;
    let same = 0;
    for (const k of keys) if (pack.keys.has(k)) same++;
    if (same / keys.size >= share && (!best || same > best.same)) best = { pack, same, total: keys.size };
  }
  return best;
}

/** The layers of a pair to decode before comparing. */
export function pairLayers({ variant, other }) {
  return [...variant.layers, ...other.layers];
}

const sameLayer = (a) => (b) => b.sheet === a.sheet && b.key === a.key && (b.slotId || null) === (a.slotId || null);

function compareImages(a, b) {
  if (!a && !b) return { differ: 0, visible: 0 };
  if (!a || !b || a.width !== b.width || a.height !== b.height) {
    const img = a || b;
    let visible = 0;
    for (let i = 3; i < img.data.length; i += 4) if (img.data[i]) visible++;
    return { differ: visible, visible };
  }
  let differ = 0;
  let visible = 0;
  const x = a.data;
  const y = b.data;
  for (let i = 0; i < x.length; i += 4) {
    if (!x[i + 3] && !y[i + 3]) continue;
    visible++;
    if (x[i] !== y[i] || x[i + 1] !== y[i + 1] || x[i + 2] !== y[i + 2] || x[i + 3] !== y[i + 3]) differ++;
  }
  return { differ, visible };
}

/**
 * Compares the images a copy has with the same images of the other variant (a copy that lacks a
 * sheet would borrow it or show nothing, so only its own images count). Masks count too: the
 * same picture with other colour areas is a real difference.
 * @returns {{identical:boolean, differ:number, visible:number, ratio:number, maskDiffer:number, sheet:string|null}}
 *   ratio and differ count the pictures only; maskDiffer counts pixels whose colour area differs.
 *   sheet = the first sheet both have, to show side by side
 */
export function compareVariants(variant, other) {
  let differ = 0;
  let visible = 0;
  let maskDiffer = 0;
  for (const layer of variant.layers) {
    const match = other.layers.find(sameLayer(layer));
    const d = compareImages(layer.base?.pixels, match?.base?.pixels);
    differ += d.differ;
    visible += d.visible;
    maskDiffer += compareImages(layer.mask?.pixels, match?.mask?.pixels).differ;
  }
  const sheet = SHEET_KEYS.find((s) => variant.layers.some((l) => l.sheet === s) && other.layers.some((l) => l.sheet === s)) || null;
  const ratio = visible ? differ / visible : 1;
  return { identical: !!variant.layers.length && !differ && !maskDiffer, differ, visible, ratio, maskDiffer, sheet };
}

/**
 * The closest match of every copy: [{variant, other, result}], closest first. Copies identical to
 * an earlier one are the ones to hide automatically.
 */
export function findLookalikes(library, packName = null) {
  const best = new Map();
  for (const pair of lookalikePairs(library, packName)) {
    const result = compareVariants(pair.variant, pair.other);
    const known = best.get(pair.variant.id);
    if (!known || result.ratio < known.result.ratio) best.set(pair.variant.id, { ...pair, result });
  }
  return [...best.values()].sort((a, b) => a.result.ratio - b.result.ratio);
}

/** A picture of where two same-size images differ: matching pixels faded, differences magenta. */
export function differenceImage(a, b) {
  const w = Math.max(a.width, b.width);
  const h = Math.max(a.height, b.height);
  const data = new Uint8ClampedArray(w * h * 4);
  const px = (img, x, y) => (x < img.width && y < img.height ? (y * img.width + x) * 4 : -1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const ia = px(a, x, y);
      const ib = px(b, x, y);
      const ca = ia < 0 ? [0, 0, 0, 0] : a.data.subarray(ia, ia + 4);
      const cb = ib < 0 ? [0, 0, 0, 0] : b.data.subarray(ib, ib + 4);
      if (!ca[3] && !cb[3]) continue;
      const same = ca[0] === cb[0] && ca[1] === cb[1] && ca[2] === cb[2] && ca[3] === cb[3];
      if (same) data.set([ca[0], ca[1], ca[2], 70], i);
      else data.set([255, 0, 200, 255], i);
    }
  }
  return { width: w, height: h, data };
}
