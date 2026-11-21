// Generates a small, original placeholder generator kit in sample-kit/Generator, using the
// RPG Maker generator file conventions. It exists so the app can be developed and demoed without
// RPG Maker's own (licensed) assets. Run: npm run sample-kit
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './png.mjs';
import { gradientFromStops, gradientsToImage } from '../src/gradients.js';
import { SLOT_BY_ID } from '../src/format.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'sample-kit');
const GEN = join(ROOT, 'Generator');
const BODY_TYPE = 'Male';
const written = [];
rmSync(ROOT, { recursive: true, force: true });

function image(w, h) {
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
}

function save(path, img) {
  const full = join(GEN, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, encodePng(img));
  written.push(relative(ROOT, full).replaceAll('\\', '/'));
}

/** A painter that writes a greyscale base and a slot-colour mask at the same time. */
function painter(w, h) {
  const base = image(w, h);
  const mask = image(w, h);
  const paint = (x, y, gray, slotId) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    const g = Math.max(0, Math.min(255, Math.round(gray)));
    base.data.set([g, g, g, 255], i);
    if (slotId) {
      const rgb = SLOT_BY_ID.get(slotId).rgb;
      mask.data.set([(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, 255], i);
    } else {
      mask.data.set([255, 255, 255, 255], i);
    }
  };
  return { base, mask, paint };
}

/** Filled ellipse with soft shading and a dark outline. */
function ellipse(paint, cx, cy, rx, ry, slotId, { clip = () => true, outline = true } = {}) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 1 || !clip(x, y)) continue;
      const lit = Math.sqrt((dx + 0.4) ** 2 + (dy + 0.5) ** 2);
      const edge = outline && d > 1 - 1.4 / Math.min(rx, ry);
      paint(x, y, edge ? 45 : 245 - 95 * Math.min(1, lit / 1.6), edge ? null : slotId);
    }
  }
}

function rect(paint, x0, y0, x1, y1, slotId) {
  for (let y = Math.round(y0); y <= Math.round(y1); y++) {
    for (let x = Math.round(x0); x <= Math.round(x1); x++) {
      const edge = x === Math.round(x0) || x === Math.round(x1) || y === Math.round(y0) || y === Math.round(y1);
      const t = (x - x0) / Math.max(1, x1 - x0);
      paint(x, y, edge ? 45 : 235 - 80 * t, edge ? null : slotId);
    }
  }
}

// ---------- sprite parts (walk / damage / battler frames) ----------
// Each part draws into one frame at (ox, oy) with scale k, facing dir (0 down, 1 left, 2 right, 3 up).

const spriteParts = {
  Body_p01: {
    layer: 'Body',
    draw(paint, ox, oy, k, dir, step) {
      const cx = ox + 24 * k;
      // legs
      rect(paint, cx - 6 * k, oy + 35 * k + Math.max(0, step) * 2 * k, cx - 1 * k, oy + 45 * k, 'skin');
      rect(paint, cx + 1 * k, oy + 35 * k + Math.max(0, -step) * 2 * k, cx + 6 * k, oy + 45 * k, 'skin');
      // torso + arms
      rect(paint, cx - 7 * k, oy + 23 * k, cx + 7 * k, oy + 36 * k, 'underwear');
      rect(paint, cx - 10 * k, oy + 24 * k - step * k, cx - 7 * k, oy + 34 * k - step * k, 'skin');
      rect(paint, cx + 7 * k, oy + 24 * k + step * k, cx + 10 * k, oy + 34 * k + step * k, 'skin');
      // head
      ellipse(paint, cx, oy + 15 * k, 9 * k, 9 * k, 'skin');
      // eyes
      const eyes = dir === 0 ? [-4, 3] : dir === 1 ? [-6] : dir === 2 ? [5] : [];
      for (const ex of eyes) {
        for (let y = 0; y < 3 * k; y++) for (let x = 0; x < 2 * k; x++) paint(cx + ex * k + x, oy + 15 * k + y, 230, 'eyes');
      }
    },
  },
  FrontHair_p01: {
    layer: 'FrontHair1',
    draw(paint, ox, oy, k, dir) {
      const cx = ox + 24 * k;
      const cy = oy + 15 * k;
      ellipse(paint, cx, cy - 1 * k, 10 * k, 10 * k, 'hair', { clip: (x, y) => dir === 3 || y < cy - 1 * k });
    },
  },
  FrontHair_p02: {
    layer: 'FrontHair1',
    draw(paint, ox, oy, k, dir) {
      const cx = ox + 24 * k;
      const cy = oy + 15 * k;
      ellipse(paint, cx, cy - 2 * k, 11 * k, 9 * k, 'hair', { clip: (x, y) => dir === 3 || y < cy - 2 * k });
      // spikes
      for (let s = -2; s <= 2; s++) {
        for (let t = 0; t < 5 * k; t++) {
          for (let w = -t / 3; w <= t / 3; w++) paint(cx + s * 4 * k + w, cy - 15 * k + t, 210, 'hair');
        }
      }
    },
  },
  FrontHair_p02_back: {
    layer: 'FrontHair2',
    variant: 'FrontHair_p02',
    draw(paint, ox, oy, k, dir) {
      if (dir === 0) return;
      const cx = ox + 24 * k;
      rect(paint, cx - 9 * k, oy + 14 * k, cx + 9 * k, oy + 28 * k, 'hair');
    },
  },
  Clothing_p01: {
    layer: 'Clothing1',
    draw(paint, ox, oy, k) {
      const cx = ox + 24 * k;
      rect(paint, cx - 8 * k, oy + 23 * k, cx + 8 * k, oy + 37 * k, 'clothing');
      rect(paint, cx - 8 * k, oy + 32 * k, cx + 8 * k, oy + 34 * k, 'clothingSub1');
    },
  },
  Clothing_p02: {
    layer: 'Clothing1',
    draw(paint, ox, oy, k) {
      const cx = ox + 24 * k;
      for (let y = 23 * k; y <= 44 * k; y++) {
        const half = 8 * k + (y - 23 * k) * 0.25;
        for (let x = -half; x <= half; x++) {
          const edge = Math.abs(x) > half - 1 || y > 43 * k;
          paint(cx + x, oy + y, edge ? 45 : 225 - 60 * (y / (44 * k)), edge ? null : Math.abs(x) < 1.5 * k ? 'clothingSub2' : 'clothing');
        }
      }
    },
  },
  BeastEars_p01: {
    layer: 'BeastEars',
    draw(paint, ox, oy, k, dir) {
      const cx = ox + 24 * k;
      for (const side of [-1, 1]) {
        if ((dir === 1 && side === 1) || (dir === 2 && side === -1)) continue;
        for (let t = 0; t < 8 * k; t++) {
          for (let w = -t / 2.2; w <= t / 2.2; w++) paint(cx + side * 6 * k + w, oy + t - 1 * k, 200 - t * 4, 'beastEars');
        }
      }
    },
  },
};

const SHEET_LAYOUT = {
  TV: { cols: 3, rows: 4, fw: 48, fh: 48, frame: (c, r) => ({ dir: r, step: [-1, 0, 1][c] }) },
  TVD: { cols: 3, rows: 1, fw: 48, fh: 48, frame: (c) => ({ dir: [0, 1, 3][c], step: 0 }) },
  SV: { cols: 9, rows: 6, fw: 64, fh: 64, frame: (c) => ({ dir: 1, step: [-1, 0, 1][c % 3] }) },
};

function renderSpriteSheet(sheet, part) {
  const L = SHEET_LAYOUT[sheet];
  const p = painter(L.cols * L.fw, L.rows * L.fh);
  const k = L.fw / 48;
  for (let r = 0; r < L.rows; r++) {
    for (let c = 0; c < L.cols; c++) {
      const { dir, step } = L.frame(c, r);
      part.draw(p.paint, c * L.fw, r * L.fh, k, dir, step);
    }
  }
  return p;
}

for (const [key, part] of Object.entries(spriteParts)) {
  const [partName, pid] = (part.variant || key).split('_');
  for (const sheet of ['TV', 'TVD', 'SV']) {
    const layer = sheet === 'TV' ? part.layer : part.layer.replace(/\d+$/, '');
    if (sheet !== 'TV' && part.layer.endsWith('2')) continue; // back layers only exist in TV in this kit
    const { base, mask } = renderSpriteSheet(sheet, part);
    save(`${sheet}/${BODY_TYPE}/${sheet}_${layer}_${pid}.png`, base);
    save(`${sheet}/${BODY_TYPE}/${sheet}_${layer}_${pid}_c.png`, mask);
  }
  if (!part.variant) {
    // Variation icon: the part alone, front-facing, on a 64px frame.
    const p = painter(64, 64);
    part.draw(p.paint, 0, -4, 64 / 48, 0, 0);
    save(`Variation/${BODY_TYPE}/icon_${partName}_${pid}.png`, p.base);
  }
}

// ---------- face parts (144x144, one file per colour slot) ----------
const faceParts = [
  ['FG_Body_p01_c1_m001', (p) => ellipse(p, 72, 168, 60, 44, 'skin')],
  ['FG_Face_p01_c1_m001', (p) => ellipse(p, 72, 74, 38, 46, 'skin')],
  ['FG_Face_p02_c1_m001', (p) => ellipse(p, 72, 76, 42, 42, 'skin')],
  ['FG_Eyes_p01_c1_m002', (p) => { ellipse(p, 57, 78, 6, 8, 'eyes'); ellipse(p, 87, 78, 6, 8, 'eyes'); }],
  ['FG_Eyes_p02_c1_m002', (p) => { ellipse(p, 57, 80, 8, 5, 'eyes'); ellipse(p, 87, 80, 8, 5, 'eyes'); }],
  ['FG_FrontHair_p01_c1_m003', (p) => ellipse(p, 72, 58, 44, 36, 'hair', { clip: (x, y) => y < 62 })],
  ['FG_FrontHair_p02_c1_m003', (p) => {
    ellipse(p, 72, 56, 46, 34, 'hair', { clip: (x, y) => y < 58 });
    for (let s = -2; s <= 2; s++) ellipse(p, 72 + s * 17, 30, 7, 16, 'hair');
  }],
  ['FG_Clothing1_p01_c1_m007', (p) => ellipse(p, 72, 172, 64, 40, 'clothing', { clip: (x, y) => y > 136 })],
  ['FG_Clothing1_p02_c1_m007', (p) => ellipse(p, 72, 168, 66, 46, 'clothing', { clip: (x, y) => y > 128 })],
  ['FG_BeastEars_p01_c1_m006', (p) => { ellipse(p, 40, 30, 10, 20, 'beastEars'); ellipse(p, 104, 30, 10, 20, 'beastEars'); }],
];

for (const [name, draw] of faceParts) {
  const p = painter(144, 144);
  draw(p.paint);
  save(`Face/${BODY_TYPE}/${name}.png`, p.base);
}
// Face/Eyes have no sprite layers, so they need their own icons.
for (const [name] of faceParts) {
  const [, part, pid] = name.split('_');
  if (spriteParts[`${part}_${pid}`] || part === 'Clothing1') continue;
  const p = painter(64, 64);
  const src = faceParts.filter(([n]) => n.startsWith(`FG_${part}_${pid}`));
  // Downscale the face part 144 -> 64 by drawing it at reduced size.
  const big = painter(144, 144);
  src.forEach(([, d]) => d(big.paint));
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const i = (Math.floor(y * 2.25) * 144 + Math.floor(x * 2.25)) * 4;
      if (big.base.data[i + 3]) p.base.data.set(big.base.data.slice(i, i + 4), (y * 64 + x) * 4);
    }
  }
  save(`Variation/${BODY_TYPE}/icon_${part}_${pid}.png`, p.base);
}

// ---------- gradients (MZ-style, one file per category), dark -> light ----------
function ramp(hex) {
  const v = parseInt(hex.slice(1), 16);
  const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  const toHex = (rgb) => '#' + rgb.map((n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')).join('');
  return gradientFromStops([
    { pos: 0, color: toHex(c.map((n) => n * 0.18)) },
    { pos: 0.6, color: hex },
    { pos: 1, color: toHex(c.map((n) => n + (255 - n) * 0.7)) },
  ]);
}
const gradientSets = {
  skin: ['#f3c9a8', '#e0a57e', '#b97a56', '#7d4f36', '#9fc7a3'],
  hair: ['#3a2a20', '#8a5a2b', '#e0b44a', '#c43c2c', '#3b6fd6', '#e8e8f0', '#8e44c9'],
  eyes: ['#3d8fd1', '#4aa35a', '#8a5a2b', '#c43c2c', '#9b59d0'],
  common: ['#c0392b', '#2e86c1', '#27ae60', '#f1c40f', '#8e44ad', '#7f8c8d', '#d35400', '#ecf0f1'],
};
for (const [category, colors] of Object.entries(gradientSets)) {
  save(`grad_${category}.png`, gradientsToImage(colors.map((c) => ({ colors: ramp(c) }))));
}

writeFileSync(join(ROOT, 'manifest.json'), JSON.stringify({ name: 'Sample kit', files: written.sort() }, null, 2));
console.log(`Wrote ${written.length} files to ${ROOT}`);
