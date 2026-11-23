// Gradients: 256 colours used as a lookup table, indexed by pixel brightness.

import { GRADIENT_WIDTH, GRADIENT_ROW_HEIGHT } from './format.js';

const rowKeys = new WeakMap();

/** One choice per exact colour ramp. Keep all original records for saved IDs and RPG Maker row numbers. */
export function uniqueGradients(gradients, selected, preferred = []) {
  const rows = new Map();
  for (const g of gradients) {
    let key = g.id;
    if (g.shiftSource) {
      key = 'shift:' + JSON.stringify(g.adjust);
    } else if (g.colors) {
      if (!rowKeys.has(g.colors)) rowKeys.set(g.colors, String.fromCharCode(...g.colors));
      key = rowKeys.get(g.colors);
    }
    const previous = rows.get(key);
    if (!previous || g.id === selected || (previous.id !== selected && preferred.includes(g.category) && !preferred.includes(previous.category))) {
      rows.set(key, g);
    }
  }
  return [...rows.values()];
}

/**
 * Splits a gradient sheet (256 wide, N*4 high) into gradient records.
 * @param {{width:number,height:number,data:Uint8ClampedArray}} image
 */
export function splitGradientImage(image, { pack, name, category }) {
  if (image.width < GRADIENT_WIDTH) {
    throw new Error(`${name}: gradient sheets must be ${GRADIENT_WIDTH}px wide (got ${image.width})`);
  }
  const rows = Math.floor(image.height / GRADIENT_ROW_HEIGHT);
  const gradients = [];
  for (let i = 0; i < rows; i++) {
    const y = i * GRADIENT_ROW_HEIGHT + 1; // sample inside the band, away from edges
    const colors = new Uint8ClampedArray(GRADIENT_WIDTH * 4);
    for (let x = 0; x < GRADIENT_WIDTH; x++) {
      const src = (y * image.width + x) * 4;
      colors[x * 4] = image.data[src];
      colors[x * 4 + 1] = image.data[src + 1];
      colors[x * 4 + 2] = image.data[src + 2];
      colors[x * 4 + 3] = 255;
    }
    gradients.push({ id: `${pack}/${name}#${i}`, label: `${name} ${i + 1}`, category, source: 'file', colors });
  }
  return gradients;
}

function hexToRgb(hex) {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/**
 * Builds a gradient from colour stops.
 * @param {{pos:number, color:string}[]} stops pos in 0..1, color as "#rrggbb"
 */
export function gradientFromStops(stops) {
  const sorted = [...stops].sort((a, b) => a.pos - b.pos);
  const colors = new Uint8ClampedArray(GRADIENT_WIDTH * 4);
  for (let x = 0; x < GRADIENT_WIDTH; x++) {
    const t = x / (GRADIENT_WIDTH - 1);
    let a = sorted[0];
    let b = sorted[sorted.length - 1];
    for (let i = 0; i < sorted.length - 1; i++) {
      if (t >= sorted[i].pos && t <= sorted[i + 1].pos) {
        a = sorted[i];
        b = sorted[i + 1];
        break;
      }
    }
    const span = b.pos - a.pos;
    const k = span > 0 ? Math.min(1, Math.max(0, (t - a.pos) / span)) : 0;
    const ca = hexToRgb(a.color);
    const cb = hexToRgb(b.color);
    colors[x * 4] = ca[0] + (cb[0] - ca[0]) * k;
    colors[x * 4 + 1] = ca[1] + (cb[1] - ca[1]) * k;
    colors[x * 4 + 2] = ca[2] + (cb[2] - ca[2]) * k;
    colors[x * 4 + 3] = 255;
  }
  return colors;
}

/** Creates a custom (user-made) gradient record. */
export function createCustomGradient(id, label, stops) {
  return { id, label, category: 'custom', source: 'custom', stops, colors: gradientFromStops(stops) };
}

/** Which gradient category fits a slot best (others stay selectable). */
export function preferredCategory(slotId) {
  if (slotId === 'skin') return 'skin';
  if (slotId === 'eyes') return 'eyes';
  if (slotId === 'hair' || slotId === 'hairSub') return 'hair';
  return 'common';
}

/** Categories that fit a slot, best first. Facial marks (scars, blush) often match the skin. */
export function preferredCategories(slotId) {
  return slotId === 'mark' ? ['common', 'skin'] : [preferredCategory(slotId)];
}

/** Words in part names that hint at a colour (rgb). */
const COLOUR_WORDS = [
  [['blush', 'cheek', 'cheeks', 'flush', 'rosy'], 0xe07878],
  [['scar', 'scars', 'wound', 'cut', 'stitch', 'stitches'], 0xb0605a],
  [['tattoo', 'tribal', 'rune', 'runes', 'warpaint', 'paint', 'marking', 'markings', 'sigil'], 0x3a4fa0],
  [['freckle', 'freckles', 'mole', 'spots', 'dots'], 0x8a5a3a],
  [['bruise', 'bruised'], 0x70508c],
  [['blood', 'bloody'], 0xa01818],
  [['tear', 'tears'], 0x88c4f0],
  [['heart', 'hearts', 'pink'], 0xe8709c],
  [['red', 'crimson'], 0xc83030], [['blue', 'azure'], 0x3060c8], [['green'], 0x40a040],
  [['gold', 'golden', 'yellow'], 0xe0b030], [['silver', 'grey', 'gray'], 0xa8a8b0],
  [['black', 'dark', 'shadow'], 0x303038], [['white'], 0xf0f0f0], [['purple', 'violet'], 0x8040b0],
  [['brown'], 0x80502c], [['orange'], 0xe07820],
];

/** Colour a slot leans to without any hint in the names: facial marks are mostly blush-red. */
const SLOT_COLOUR = { mark: 0xc86a62 };

/** The middle colour of a gradient (its typical tone). */
function midColour(g) {
  const c = g.colors;
  const i = Math.floor(c.length / 8) * 4; // the pixel half-way along
  return [c[i], c[i + 1], c[i + 2]];
}

/**
 * Colours recommended for a slot, best first: gradients of the fitting categories closest to the
 * colour the part's names hint at ("blush", "scar", "blue"...) or the slot leans to. Empty when
 * there is no hint at all; the user picks freely either way.
 * @returns {{target:number, why:string, ids:string[]}|null}
 */
export function recommendColours(slotId, gradients, words = [], count = 4) {
  let target = null;
  let why = '';
  for (const [names, rgb] of COLOUR_WORDS) {
    const hit = names.find((n) => words.includes(n));
    if (hit) {
      target = rgb;
      why = `"${hit}" in the name`;
      break;
    }
  }
  if (target === null && slotId in SLOT_COLOUR) {
    target = SLOT_COLOUR[slotId];
    why = 'usual colour of this slot';
  }
  if (target === null) return null;
  const cats = preferredCategories(slotId);
  const pool = gradients.filter((g) => g.source !== 'custom' && (cats.includes(g.category) || g.category === 'all'));
  const t = [(target >> 16) & 255, (target >> 8) & 255, target & 255];
  const dist = (g) => midColour(g).reduce((sum, v, i) => sum + (v - t[i]) ** 2, 0);
  const ids = pool.map((g) => ({ id: g.id, d: dist(g) })).sort((a, b) => a.d - b.d).slice(0, count).map((x) => x.id);
  return ids.length ? { target, why, ids } : null;
}

/** Renders gradients back to a 256 x (N*4) sheet, e.g. to export custom gradients for RPG Maker. */
export function gradientsToImage(gradients) {
  const height = gradients.length * GRADIENT_ROW_HEIGHT;
  const data = new Uint8ClampedArray(GRADIENT_WIDTH * height * 4);
  gradients.forEach((g, i) => {
    for (let y = 0; y < GRADIENT_ROW_HEIGHT; y++) {
      data.set(g.colors, ((i * GRADIENT_ROW_HEIGHT + y) * GRADIENT_WIDTH) * 4);
    }
  });
  return { width: GRADIENT_WIDTH, height, data };
}

/**
 * Shifts a gradient's colours: hue in degrees (-180..180), saturation and brightness in percent
 * (100 = unchanged, 0 = grey / black, 200 = double). Colours RPG Maker's sheets don't have, e.g.
 * a slightly greener version of a hair colour. Alpha is kept.
 */
export function adjustGradient(colors, adjust = {}) {
  const out = new Uint8ClampedArray(colors);
  for (let i = 0; i < out.length; i += 4) out.set(adjustRgb(colors[i], colors[i + 1], colors[i + 2], adjust), i);
  return out;
}

/** One colour shifted in hue (degrees), saturation and brightness (percent, 100 = unchanged). */
export function adjustRgb(red, green, blue, { hue = 0, saturation = 100, brightness = 100 } = {}) {
  let [h, sat, val] = rgbToHsv(red, green, blue);
  h = (((h + hue) % 360) + 360) % 360;
  return hsvToRgb(h, Math.min(1, (sat * saturation) / 100), Math.min(1, (val * brightness) / 100));
}

/** Colours shown for "the part's own colours" (a swatch of an adjusted source colour). */
export const SOURCE_SAMPLE = gradientFromStops([{ pos: 0, color: '#fff4e8' }, { pos: 0.45, color: '#c8864a' }, { pos: 1, color: '#1c1008' }]);

/**
 * A "Your colours" entry that shifts the part's own colours (no gradient): hue, saturation and
 * brightness on every pixel of the slot. `colors` is only its swatch.
 */
export function createSourceAdjust(id, label, adjust) {
  return { id, label, category: 'custom', source: 'custom', from: 'source', adjust, shiftSource: true, colors: adjustGradient(SOURCE_SAMPLE, adjust) };
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return [h * 60, max ? d / max : 0, max];
}

function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/**
 * A "Your colours" gradient made by adjusting another one. It keeps its own 256 colours, so it
 * still works when the gradient it came from isn't loaded.
 */
export function createAdjustedGradient(id, label, from, adjust, colors) {
  return { id, label, category: 'custom', source: 'custom', from, adjust, colors: new Uint8ClampedArray(colors) };
}

/** A custom gradient as saved in character files and sets. */
export function customGradientToJson(g) {
  if (g.stops) return { id: g.id, label: g.label, stops: g.stops };
  if (g.shiftSource) return { id: g.id, label: g.label, from: 'source', adjust: g.adjust };
  let hex = '';
  for (let i = 0; i < g.colors.length; i += 4) {
    hex += ((g.colors[i] << 16) | (g.colors[i + 1] << 8) | g.colors[i + 2]).toString(16).padStart(6, '0');
  }
  return { id: g.id, label: g.label, from: g.from, adjust: g.adjust, colors: hex };
}

/** Reads a saved custom gradient (made from stops, or adjusted from another one). */
export function customGradientFromJson(j) {
  if (j.stops) return createCustomGradient(j.id, j.label, j.stops);
  if (j.from === 'source') return createSourceAdjust(j.id, j.label, j.adjust);
  const colors = new Uint8ClampedArray(GRADIENT_WIDTH * 4);
  for (let i = 0; i < GRADIENT_WIDTH; i++) {
    const rgb = parseInt(String(j.colors || '').slice(i * 6, i * 6 + 6) || '0', 16);
    colors.set([(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, 255], i * 4);
  }
  return createAdjustedGradient(j.id, j.label, j.from, j.adjust, colors);
}
