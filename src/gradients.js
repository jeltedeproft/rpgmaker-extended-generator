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
