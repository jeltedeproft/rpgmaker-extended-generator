// Suggests how to read a file whose name the generator doesn't understand: which image (sheet) it
// is from its size and frame grid, and which part from where its pixels sit compared with the
// parts already loaded (hair sits on top of the head, glasses over the eyes, a cloak behind it).

import { DEFAULT_SIZE, SHEETS, PART_ORDER } from './format.js';

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

/** Words in file names that name a part (besides the part names themselves). */
const PART_WORDS = {
  beard: 'Beard', mustache: 'Beard', moustache: 'Beard', stubble: 'Beard', goatee: 'Beard',
  hair: 'FrontHair', bangs: 'FrontHair', fringe: 'FrontHair', fronthair: 'FrontHair',
  rearhair: 'RearHair', ponytail: 'RearHair', braid: 'RearHair', braids: 'RearHair', bun: 'RearHair',
  ear: 'Ears', ears: 'Ears', beastears: 'BeastEars',
  eye: 'Eyes', eyes: 'Eyes', eyebrow: 'Eyebrows', eyebrows: 'Eyebrows', brow: 'Eyebrows', brows: 'Eyebrows',
  nose: 'Nose', mouth: 'Mouth', lips: 'Mouth',
  facialmark: 'FacialMark', scar: 'FacialMark', tattoo: 'FacialMark', freckles: 'FacialMark', blush: 'FacialMark',
  tail: 'Tail', wing: 'Wing', wings: 'Wing',
  clothing: 'Clothing', clothes: 'Clothing', outfit: 'Clothing', shirt: 'Clothing', dress: 'Clothing', robe: 'Clothing', armor: 'Clothing', armour: 'Clothing',
  cloak: 'Cloak', cape: 'Cloak', mantle: 'Cloak',
  glasses: 'Glasses', goggles: 'Glasses', monocle: 'Glasses', spectacles: 'Glasses',
  body: 'Body', face: 'Face', acca: 'AccA', accb: 'AccB',
};

/** The words of a file name: "TV_LongBeard2-dark" -> ["tv", "long", "beard", "dark"]. */
export function nameWords(fileName) {
  return fileName.replace(/\.png$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z]+/)
    .map((w) => w.toLowerCase())
    .filter(Boolean);
}

/** Two words that together name a part, in any order ("hair back", "Eye_Brow"). */
const WORD_PAIRS = [
  [['back', 'hair'], 'RearHair'], [['eye', 'brow'], 'Eyebrows'], [['face', 'mark'], 'FacialMark'],
  [['facial', 'hair'], 'Beard'], [['animal', 'ear'], 'BeastEars'], [['beast', 'ear'], 'BeastEars'],
  [['accessory', 'a'], 'AccA'], [['accessory', 'b'], 'AccB'],
];

/** The words of a part name: "FrontHair" -> ["front", "hair"], "AccA" -> ["acc", "a"]. */
export function partNameWords(part) {
  return part.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[^A-Za-z]+/).map((w) => w.toLowerCase()).filter(Boolean);
}

/** "ears" and "ear" are the same word here. */
const singular = (w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

/**
 * Part names in a list of words, however they are written: in one piece ("RearHair", "rearhair"),
 * apart ("Rear_Hair", "rear hair", "REAR-HAIR") or in any order ("hair_rear").
 * synonyms: also known other words ("cape" is a cloak, "ponytail" rear hair).
 * @returns {Map<string, Set<string>>} part -> the words it was found from
 */
export function partsInWords(words, partNames = [], synonyms = true) {
  const have = new Set(words.map(singular));
  const joined = words.join('');
  const found = new Map();
  const add = (part, ws) => {
    if (!found.has(part) || found.get(part).size < ws.length) found.set(part, new Set(ws));
  };
  if (synonyms) {
    for (const w of words) if (PART_WORDS[w]) add(PART_WORDS[w], [singular(w)]);
    for (const [ws, part] of WORD_PAIRS) if (ws.every((x) => have.has(x))) add(part, ws);
  }
  for (const part of new Set([...PART_ORDER, ...partNames])) {
    const ws = partNameWords(part).map(singular);
    if (!ws.length) continue;
    if (ws.every((x) => have.has(x)) && (ws.length > 1 || ws[0].length > 2)) add(part, ws);
    // Glued to other words ("longrearhair"): only names of two or more words, so "ponytail" isn't a tail.
    else if (ws.length > 1 && joined.includes(part.toLowerCase())) add(part, ws);
  }
  // A part found from more words wins over one found from some of them: "rear hair" is RearHair,
  // not FrontHair ("hair"); "beast ears" is BeastEars, not Ears.
  const beaten = [...found].filter(([part, ws]) => [...found].some(([other, ows]) => other !== part
    && ows.size > ws.size && [...ws].every((w) => ows.has(w))));
  for (const [part] of beaten) found.delete(part);
  return found;
}

/** Parts a file name names ("beard", "Cloak2", "cape", "hair_rear"), from known words and the given part names. */
export function partsInName(fileName, partNames = []) {
  const words = nameWords(fileName);
  const found = partsInWords(words, partNames);
  if (found.has('BeastEars')) found.delete('Ears');
  if (found.has('RearHair') && !words.includes('front')) found.delete('FrontHair');
  return [...found.keys()];
}

/**
 * How much of a picture is drawn in colour-mask colours (the flat slot colours and white of a
 * `_c` file), 0..1. A colour mask is ~1; a drawn part (even a wearable mask) is near 0.
 * @param {(rgb:number)=>string|null} matchSlot
 */
export function maskColourShare(pixels, matchSlot, ignoreRgb = 0xffffff) {
  let opaque = 0;
  let maskColoured = 0;
  const d = pixels.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    opaque++;
    const rgb = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    if (rgb === ignoreRgb || matchSlot(rgb)) maskColoured++;
  }
  return opaque ? maskColoured / opaque : 0;
}

/** Score added for a part the file name names. */
export const NAME_BONUS = 0.35;

/**
 * Shape ranking plus the file name: parts the name names score NAME_BONUS higher (capped at 1),
 * and show up even when no loaded part of that kind sits there. Each result has `named`.
 */
export function rankWithName(profile, references, named, limit = 3) {
  const ranked = rankParts(profile, references, Infinity);
  const byPart = new Map(ranked.map((r) => [r.part, { ...r, named: false }]));
  for (const part of named) {
    const r = byPart.get(part) || { part, layer: references.find((x) => x.part === part)?.layer || '', cell: undefined, score: 0 };
    byPart.set(part, { ...r, score: Math.min(1, r.score + NAME_BONUS), named: true });
  }
  return [...byPart.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
