// RPG Maker MV/MZ character generator format knowledge.
// Everything that is NOT yet verified against real generator assets is marked UNVERIFIED.
// See docs/FORMAT.md for sources and open questions.

/** Sheet types, keyed by the filename prefix. */
export const SHEETS = {
  FG: { key: 'FG', label: 'Face', folder: 'Face', frame: null },
  TV: { key: 'TV', label: 'Walk', folder: 'TV', frame: { w: 48, h: 48, cols: 3, rows: 4 } },
  TVD: { key: 'TVD', label: 'Damage', folder: 'TVD', frame: { w: 48, h: 48, cols: 3, rows: 1 } },
  SV: { key: 'SV', label: 'Battler', folder: 'SV', frame: { w: 64, h: 64, cols: 9, rows: 6 } },
};
export const SHEET_KEYS = ['FG', 'TV', 'TVD', 'SV'];

/** Default part sizes, used only when a sheet has no layers loaded. */
export const DEFAULT_SIZE = {
  FG: { w: 144, h: 144 },
  TV: { w: 144, h: 192 },
  TVD: { w: 144, h: 48 },
  SV: { w: 576, h: 384 },
};

/**
 * Colour slots. In TV/TVD/SV the `_c` mask marks each slot with this exact RGB.
 * In FG the `_mNNN` suffix selects the slot by number.
 * Labels for some Clothing/Cloak sub-colours are UNVERIFIED (garbled in the source PDF).
 */
export const SLOTS = [
  { id: 'skin', m: 1, rgb: 0xf9c19d, label: 'Skin', part: 'Body' },
  { id: 'eyes', m: 2, rgb: 0x2c80cb, label: 'Eyes', part: 'Eyes' },
  { id: 'hair', m: 3, rgb: 0xfccb0a, label: 'Hair', part: 'FrontHair' },
  { id: 'hairSub', m: 4, rgb: 0xb892c5, label: 'Hair (sub)', part: 'RearHair' },
  { id: 'mark', m: 5, rgb: 0x009296, label: 'Facial mark', part: 'FacialMark' },
  { id: 'beastEars', m: 6, rgb: 0xd3cec7, label: 'Beast ears', part: 'BeastEars' },
  { id: 'clothing', m: 7, rgb: 0xae8682, label: 'Clothing main', part: 'Clothing' },
  { id: 'clothingSub1', m: 8, rgb: 0xfe9d1e, label: 'Clothing sub 1', part: 'Clothing' },
  { id: 'clothingSub2', m: 9, rgb: 0x1c76d0, label: 'Clothing sub 2', part: 'Clothing' },
  { id: 'clothingSub3', m: 10, rgb: 0xd9a404, label: 'Clothing sub 3', part: 'Clothing' },
  { id: 'cloak', m: 11, rgb: 0xd8ac00, label: 'Cloak main', part: 'Cloak' },
  { id: 'cloakSub', m: 12, rgb: 0xa30708, label: 'Cloak sub', part: 'Cloak' },
  { id: 'accA', m: 13, rgb: 0xd3cec2, label: 'Accessory A main', part: 'AccA' },
  { id: 'accASub1', m: 14, rgb: 0xda346e, label: 'Accessory A sub 1', part: 'AccA' },
  { id: 'accASub2', m: 15, rgb: 0xa4c911, label: 'Accessory A sub 2', part: 'AccA' },
  { id: 'accB', m: 16, rgb: 0xc78407, label: 'Accessory B main', part: 'AccB' },
  { id: 'accBSub1', m: 17, rgb: 0xc0d3d2, label: 'Accessory B sub 1', part: 'AccB' },
  { id: 'accBSub2', m: 18, rgb: 0x4155b6, label: 'Accessory B sub 2', part: 'AccB' },
  { id: 'accBSub3', m: 19, rgb: 0xba3b45, label: 'Accessory B sub 3', part: 'AccB' },
  { id: 'glasses', m: 20, rgb: 0x999999, label: 'Glasses main', part: 'Glasses' },
  { id: 'glassesSub1', m: 21, rgb: 0xccbad2, label: 'Glasses sub 1', part: 'Glasses' },
  { id: 'glassesSub2', m: 22, rgb: 0x607e4b, label: 'Glasses sub 2', part: 'Glasses' },
  // Mask-only slots (no FG m-number known).
  { id: 'underwear', m: null, rgb: 0x4f413c, label: 'Undergarment', part: 'Body' },
  { id: 'tail', m: null, rgb: 0xe6d6bd, label: 'Tail', part: 'Tail' },
  { id: 'wing', m: null, rgb: 0xa7d6d6, label: 'Wing', part: 'Wing' },
];

export const SLOT_BY_ID = new Map(SLOTS.map((s) => [s.id, s]));
export const SLOT_BY_M = new Map(SLOTS.filter((s) => s.m != null).map((s) => [s.m, s]));
export const SLOT_BY_RGB = new Map(SLOTS.map((s) => [s.rgb, s]));

/** Mask pixels in this colour mean "not recolourable". */
export const MASK_IGNORE_RGB = 0xffffff;

/** Max per-channel distance when matching a mask pixel to a slot colour (tolerates lossy re-saves). */
export const MASK_TOLERANCE = 6;

/**
 * Draw order per sheet, listed TOP-MOST FIRST (index 0 is drawn last, on top).
 * Direction is inferred (Wing2/Cloak2/RearHair2 end the lists, i.e. they sit behind the body). UNVERIFIED.
 * FG entries are `Layer:cell`.
 */
export const DRAW_ORDER = {
  FG: [
    'AccB:c1', 'AccB:c2', 'AccB:c3', 'AccB:c4',
    'Glasses:c1', 'Glasses:c2', 'Glasses:c3',
    'FrontHair:c1',
    'Cloak1:c1',
    'AccA:c1', 'AccA:c2', 'AccA:c3',
    'BeastEars:c1',
    'Beard:c1',
    'Clothing1:c1', 'Clothing1:c2',
    'Ears:c1',
    'RearHair1:c1', 'RearHair1:c2',
    'Eyebrows:c1', 'Eyebrows:c2',
    'Eyes:c1', 'Eyes:c2',
    'FacialMark:c1',
    'Nose:c1',
    'Mouth:c1', 'Mouth:c2', 'Mouth:c3',
    'Face:c1',
    'Clothing2:c3', 'Clothing2:c4', 'Clothing2:c5', 'Clothing2:c6',
    'Body:c1',
    'Cloak2:c1', 'Cloak2:c2',
    'RearHair2:c1',
  ],
  TV: [
    'Wing1', 'AccB', 'FrontHair1', 'AccA', 'RearHair1', 'Glasses', 'BeastEars', 'Cloak1', 'Tail1',
    'Clothing1', 'Beard1', 'Clothing2', 'RearHair2', 'FacialMark', 'Body', 'Beard2', 'FrontHair2',
    'Tail2', 'Cloak2', 'Wing2',
  ],
  TVD: [
    'AccB', 'FrontHair', 'AccA', 'BeastEars', 'RearHair', 'Wing', 'Glasses', 'Cloak', 'Tail', 'Beard',
    'Clothing', 'FacialMark', 'Body',
  ],
  SV: [
    'AccB', 'FrontHair', 'AccA', 'Glasses', 'BeastEars', 'Cloak1', 'Clothing1', 'Beard', 'Clothing2',
    'RearHair1', 'FacialMark', 'Body', 'Tail', 'Cloak2', 'Wing',
  ],
};

/** Parts shown in the editor, in UI order. Unknown parts found in packs are appended. */
export const PART_ORDER = [
  'Body', 'Face', 'FrontHair', 'RearHair', 'Beard', 'Ears', 'Eyes', 'Eyebrows', 'Nose', 'Mouth',
  'FacialMark', 'BeastEars', 'Tail', 'Wing', 'Clothing', 'Cloak', 'AccA', 'AccB', 'Glasses',
];

/** Parts a character always has (no "none" option). */
export const REQUIRED_PARTS = new Set(['Body', 'Face']);

/**
 * Gradient lookup: a pixel's brightness (0..255) picks a column of a 256px gradient row.
 * Verified on real MZ gradient sheets: column 0 is the highlight (white) and column 255 the
 * shadow (black), so column = 255 - brightness. `flipGradient` reverses that, for odd packs.
 * Whether RPG Maker measures brightness as luminance is UNVERIFIED: real parts contain coloured
 * (not only grey) pixels inside recolourable areas.
 */
export const DEFAULT_SETTINGS = {
  flipGradient: false,
};

export const GRADIENT_WIDTH = 256;
export const GRADIENT_ROW_HEIGHT = 4;
