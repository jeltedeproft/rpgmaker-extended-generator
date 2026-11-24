// Look-alikes: copies ("p01 (2)") and alternates ("p17 (alt)") that look the same as, or almost
// the same as, their original or another copy. Pure: works on decoded layers.

import { SHEET_KEYS, SLOT_BY_RGB } from './format.js';

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

/** The colour area a mask gives a pixel: its slot, its own colour if it is no slot's, or null. */
function areaAt(mask, i) {
  if (!mask || !mask.data[i + 3]) return null;
  const rgb = (mask.data[i] << 16) | (mask.data[i + 1] << 8) | mask.data[i + 2];
  return SLOT_BY_RGB.get(rgb)?.id ?? rgb;
}

/**
 * Pixels that recolour differently: drawn in either picture, and put in another colour area by
 * the two masks. Mask pixels where nothing is drawn, or other shades of the same area, change
 * nothing you can see.
 */
function compareMasks(maskA, maskB, baseA, baseB) {
  const size = (img) => img && `${img.width}x${img.height}`;
  const sizes = new Set([maskA, maskB, baseA, baseB].filter(Boolean).map(size));
  if (sizes.size > 1) return compareImages(maskA, maskB).differ;
  let differ = 0;
  const length = (maskA || maskB || baseA || baseB)?.data.length || 0;
  for (let i = 0; i < length; i += 4) {
    if (!baseA?.data[i + 3] && !baseB?.data[i + 3]) continue;
    if (areaAt(maskA, i) !== areaAt(maskB, i)) differ++;
  }
  return differ;
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
    if (layer.mask?.pixels || match?.mask?.pixels) {
      maskDiffer += compareMasks(layer.mask?.pixels, match?.mask?.pixels, layer.base?.pixels, match?.base?.pixels);
    }
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

/** A short fingerprint of a file's bytes (FNV-1a and the length): equal files, equal prints. */
export function digestBytes(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${bytes.length}:${h.toString(16)}`;
}

/**
 * Parts made of the very same files as another part of the same body type and part, whatever
 * their names, numbers or folders: "p12" that is "p05" again, or the same part in two opened
 * folders. Needs `digest` (digestBytes) on the layers' base and mask refs; parts with a file
 * without one, and VX Ace parts, are left out. The part kept is a plain one (not a "(2)" copy),
 * from the folder opened first, with the lowest number.
 * @returns {{variant:object, other:object}[]} variant: the duplicate, other: the part it repeats
 */
export function sameFileDuplicates(library, packName = null) {
  const packOrder = library.packs.map((p) => p.name);
  const groups = new Map();
  for (const v of library.variants.values()) {
    if (v.removed || !v.layers.length) continue;
    const prints = [];
    let complete = true;
    for (const l of v.layers) {
      const mask = l.mask && !l.mask.auto ? l.mask : null;
      if (l.base?.cells || (l.base && !l.base.digest) || (mask && !mask.digest)) {
        complete = false;
        break;
      }
      prints.push(`${l.sheet}|${l.key}|${l.slotId || ''}|${l.base?.digest || ''}|${mask?.digest || ''}`);
    }
    if (!complete) continue;
    const key = `${v.bodyType}|${v.part}|${prints.sort().join(',')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(v);
  }
  const order = (a, b) => (copyBase(a.pid) ? 1 : 0) - (copyBase(b.pid) ? 1 : 0)
    || packOrder.indexOf(a.pack) - packOrder.indexOf(b.pack)
    || a.pid.localeCompare(b.pid, undefined, { numeric: true });
  const pairs = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort(order);
    const [keep, ...rest] = list;
    for (const variant of rest) if (!packName || variant.pack === packName || keep.pack === packName) pairs.push({ variant, other: keep });
  }
  return pairs;
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
