// Gradients: 256 colours used as a lookup table, indexed by pixel brightness.

import { GRADIENT_WIDTH, GRADIENT_ROW_HEIGHT } from './format.js';

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
export function adjustGradient(colors, { hue = 0, saturation = 100, brightness = 100 } = {}) {
  const out = new Uint8ClampedArray(colors);
  const s = saturation / 100;
  const v = brightness / 100;
  for (let i = 0; i < out.length; i += 4) {
    let [h, sat, val] = rgbToHsv(colors[i], colors[i + 1], colors[i + 2]);
    h = (((h + hue) % 360) + 360) % 360;
    const [r, g, b] = hsvToRgb(h, Math.min(1, sat * s), Math.min(1, val * v));
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
  }
  return out;
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
  let hex = '';
  for (let i = 0; i < g.colors.length; i += 4) {
    hex += ((g.colors[i] << 16) | (g.colors[i + 1] << 8) | g.colors[i + 2]).toString(16).padStart(6, '0');
  }
  return { id: g.id, label: g.label, from: g.from, adjust: g.adjust, colors: hex };
}

/** Reads a saved custom gradient (made from stops, or adjusted from another one). */
export function customGradientFromJson(j) {
  if (j.stops) return createCustomGradient(j.id, j.label, j.stops);
  const colors = new Uint8ClampedArray(GRADIENT_WIDTH * 4);
  for (let i = 0; i < GRADIENT_WIDTH; i++) {
    const rgb = parseInt(String(j.colors || '').slice(i * 6, i * 6 + 6) || '0', 16);
    colors.set([(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, 255], i * 4);
  }
  return createAdjustedGradient(j.id, j.label, j.from, j.adjust, colors);
}
