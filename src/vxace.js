// RPG Maker VX Ace generator parts. A different system from MV/MZ: no recolouring. Every file holds
// its colours already painted, one cell per colour:
//   Face/[Male|Female/]<Part>NN[a|s].png  128x128 cells in a grid (8 colours, or 4 skin tones)
//   Mini/[Male|Female/]<Part>NN.png       96x128 cells in a row, each a 3x4 walk sheet of 32px
// Tall Mini files (Cloak, Tail, Wing, RearHair, Ears, Cloth) hold two layers: the top half is drawn
// behind the body, the bottom half in front (Cloth: the bottom half is the skin of the hands).
// Suffix "a" is a second layer of the part, "s" the half-transparent shadow it casts on the face.
// Files without a gender folder are shared by Male and Female. Mini/Head.png is the walking body
// (4 skin tones) and Mini/Eyes.png the walking eyes of every eye shape (8 eye colours).
// Pure: no DOM. See docs/FORMAT.md.

/** VX Ace file names to MV/MZ part names. */
const VX_PARTS = {
  face: 'Face', head: 'Body', fronthair: 'FrontHair', rearhair: 'RearHair', beard: 'Beard', ears: 'Ears',
  eyes: 'Eyes', eyebrows: 'Eyebrows', nose: 'Nose', mouth: 'Mouth', tattoo: 'FacialMark', kemono: 'BeastEars',
  glasses: 'Glasses', acc1: 'AccA', acc2: 'AccB', neck: 'Clothing', cloth: 'Clothing', cloak: 'Cloak',
  tail: 'Tail', wing: 'Wing',
};

/** Mini files holding a back (top half) and a front (bottom half) layer. */
const TWO_LAYER_MINI = new Set(['cloak', 'tail', 'wing', 'rearhair', 'ears', 'cloth']);

/** Shared painted-colour choices: one skin tone, hair and eye colour for every part that has them. */
const SHARED_SLOT = {
  face: 'vx:skin', head: 'vx:skin', ears: 'vx:skin', nose: 'vx:skin', mouth: 'vx:skin',
  fronthair: 'vx:hair', rearhair: 'vx:hair', beard: 'vx:hair', eyebrows: 'vx:hair', eyes: 'vx:eyes',
};

/**
 * Painted-colour "slots": a choice of cell, not a gradient. The colour id of a painted slot is
 * "painted:N" (cell N, counting from 0); no colour = the first cell.
 */
export const PAINTED_SLOTS = [
  { id: 'vx:skin', label: 'Skin tone', rgb: 0xf2c09a, count: 4 },
  { id: 'vx:hair', label: 'Hair colour', rgb: 0x8a5a30, count: 8 },
  { id: 'vx:eyes', label: 'Eye colour', rgb: 0x3060c0, count: 8 },
  ...['Clothing', 'Cloak', 'AccA', 'AccB', 'Glasses', 'BeastEars', 'FacialMark', 'Tail', 'Wing'].map((part) => ({
    id: `vx:${part}`, label: `${part} colour`, rgb: 0x9a9aa8, count: 8,
  })),
].map((s) => ({ ...s, painted: true, part: null }));
export const PAINTED_SLOT_BY_ID = new Map(PAINTED_SLOTS.map((s) => [s.id, s]));

/** The cell a painted colour id picks: "painted:3" -> 3; anything else -> 0 (the first colour). */
export function paintedIndex(colourId) {
  const m = /^painted:(\d+)$/.exec(colourId || '');
  return m ? Number(m[1]) : 0;
}

/**
 * Draw order of VX Ace layers, top-most first (like format.DRAW_ORDER). Unverified against the VX
 * Ace generator itself; worked out from where the pixels sit.
 */
export const VX_ORDER = {
  FG: [
    'vxAccB', 'vxAccA', 'vxGlasses', 'vxBeastEars', 'vxFrontHair', 'vxFrontHairShadow', 'vxRearHairA',
    'vxEyebrows', 'vxEyebrowsShadow', 'vxBeard', 'vxFacialMark', 'vxEyes', 'vxEyesShadow', 'vxNose', 'vxMouth',
    'vxClothing', 'vxEars', 'vxFace', 'vxRearHair', 'vxClothingA',
  ],
  TV: [
    'vxAccB', 'vxAccA', 'vxGlasses', 'vxBeastEars', 'vxFrontHair', 'vxEars', 'vxRearHair', 'vxBeard', 'vxEyes',
    'vxBody', 'vxCloak', 'vxWing', 'vxTail', 'vxClothingSkin', 'vxClothing', 'vxEarsBack', 'vxRearHairBack',
    'vxTailBack', 'vxWingBack', 'vxCloakBack',
  ],
};

const FILE_RE = /^([A-Za-z]+(?:\d_)?)(\d*)([as]?)\.png$/i;

/**
 * Reads a VX Ace generator path. Returns null for anything else (MV/MZ names are read first).
 * @returns {{sheet:string, part:string, pid:string|null, bodyTypes:string[]|null, layers:object[]}|null}
 *   pid null = shared by every variant of the part (Mini/Eyes.png); bodyTypes null = Male and Female.
 *   Each layer: {key, slotId, cells:{cw, ch, grid?, y0?}}.
 */
export function parseVxAcePath(path) {
  const segments = path.split(/[\\/]/).filter(Boolean);
  const name = segments.at(-1);
  let folder = segments.at(-2) || '';
  let bodyTypes = null;
  if (/^(male|female)$/i.test(folder)) {
    bodyTypes = [folder[0].toUpperCase() + folder.slice(1).toLowerCase()];
    folder = segments.at(-3) || '';
  }
  if (!/^(face|mini)$/i.test(folder)) return null;
  const m = FILE_RE.exec(name);
  if (!m) return null;
  const raw = m[1].replace(/_$/, '').toLowerCase();
  const part = VX_PARTS[raw];
  if (!part) return null;
  const number = m[2];
  const suffix = m[3].toLowerCase();
  const slotId = SHARED_SLOT[raw] || `vx:${part}`;
  const sheet = /^face$/i.test(folder) ? 'FG' : 'TV';
  const pid = number ? `p${number}` : part === 'Body' ? 'p01' : null;
  if (!number && part !== 'Body' && part !== 'Eyes') return null;
  let layers;
  if (sheet === 'FG') {
    const key = `vx${part}${suffix === 's' ? 'Shadow' : suffix === 'a' ? 'A' : ''}`;
    layers = [{ key, slotId, cells: { cw: 128, ch: 128, grid: true } }];
  } else if (TWO_LAYER_MINI.has(raw) && !suffix) {
    layers = raw === 'cloth'
      ? [{ key: 'vxClothing', slotId, cells: { cw: 96, ch: 128, y0: 0 } }, { key: 'vxClothingSkin', slotId: 'vx:skin', cells: { cw: 96, ch: 128, y0: 128 } }]
      : [{ key: `vx${part}Back`, slotId, cells: { cw: 96, ch: 128, y0: 0 } }, { key: `vx${part}`, slotId, cells: { cw: 96, ch: 128, y0: 128 } }];
  } else {
    layers = [{ key: `vx${part}${suffix === 'a' ? 'A' : ''}`, slotId, cells: { cw: 96, ch: 128, y0: 0 } }];
  }
  return { sheet, part, pid, bodyTypes, layers };
}

/** The cells of a VX Ace image: [{x, y, w, h}], in colour order. */
export function cellRects(width, height, cells) {
  const rects = [];
  const cols = Math.floor(width / cells.cw);
  if (cells.grid) {
    const rows = Math.floor(height / cells.ch);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) rects.push({ x: c * cells.cw, y: r * cells.ch, w: cells.cw, h: cells.ch });
  } else if ((cells.y0 || 0) + cells.ch <= height) {
    for (let c = 0; c < cols; c++) rects.push({ x: c * cells.cw, y: cells.y0 || 0, w: cells.cw, h: cells.ch });
  }
  return rects;
}

/** Number of painted colours in a decoded VX Ace image ref. */
export function cellCount(ref) {
  return ref.full ? cellRects(ref.full.width, ref.full.height, ref.cells).length : 0;
}

/**
 * One painted colour of a VX Ace image ref ({full, cells}): the cell cut out as its own picture,
 * cached. A colour the file doesn't have gives the first one; a file too small for the layer
 * (a Mini file without a bottom half) gives an empty cell.
 */
export function cellOf(ref, index) {
  const full = ref.full;
  if (!full) return ref.pixels;
  const rects = cellRects(full.width, full.height, ref.cells);
  const i = index < rects.length ? index : 0;
  ref.cellCache ||= new Map();
  if (!ref.cellCache.has(i)) {
    const r = rects[i] || { x: 0, y: 0, w: ref.cells.cw, h: ref.cells.ch, empty: true };
    const out = { width: r.w, height: r.h, data: new Uint8ClampedArray(r.w * r.h * 4) };
    if (!r.empty) {
      for (let y = 0; y < r.h; y++) {
        const start = ((r.y + y) * full.width + r.x) * 4;
        out.data.set(full.data.subarray(start, start + r.w * 4), y * r.w * 4);
      }
    }
    ref.cellCache.set(i, out);
  }
  return ref.cellCache.get(i);
}

/** The main colour of a picture (average of its opaque pixels), for painted-colour swatches. */
export function averageColour(pixels) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < pixels.data.length; i += 4) {
    if (pixels.data[i + 3] < 200) continue;
    r += pixels.data[i];
    g += pixels.data[i + 1];
    b += pixels.data[i + 2];
    n++;
  }
  if (!n) return null;
  const hex = (v) => Math.round(v / n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
