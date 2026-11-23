// Runs against real generator packs in test-assets/ (git-ignored, not redistributable).
// Skipped when the folder is missing, e.g. on a fresh clone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from '../tools/png.mjs';
import { createLibrary, addPack } from '../src/parse.js';
import { splitGradientImage } from '../src/gradients.js';
import { composeSheet } from '../src/compose.js';
import { maskPalette } from '../src/recolor.js';
import { cellOf } from '../src/vxace.js';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-assets');
const packs = existsSync(ASSETS) ? readdirSync(ASSETS).filter((n) => statSync(join(ASSETS, n)).isDirectory()) : [];
const skip = packs.length ? false : 'no packs in test-assets/';
// Packs in another format, with their own test below (see docs/FORMAT.md).
const UNSUPPORTED = new Set(['vxace']);

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function loadPack(name) {
  const root = join(ASSETS, name);
  const entries = walk(root).map((p) => ({ path: relative(root, p).replaceAll('\\', '/'), src: p }));
  const lib = createLibrary();
  addPack(lib, name, entries);
  const decode = (ref) => {
    if (!ref || ref.pixels) return;
    const pixels = decodePng(readFileSync(ref.src));
    if (ref.cells) {
      ref.full = pixels;
      ref.pixels = cellOf(ref, 0);
    } else ref.pixels = pixels;
  };
  for (const v of lib.variants.values()) {
    for (const l of v.layers) {
      decode(l.base);
      decode(l.mask);
    }
  }
  const gradients = lib.gradientFiles.flatMap((g) =>
    splitGradientImage(decodePng(readFileSync(g.src)), { pack: name, name: g.path, category: g.category }));
  return { lib, gradients };
}

for (const name of packs.length ? packs.filter((n) => !UNSUPPORTED.has(n)) : ['(none)']) {
  test(`${name}: every part file is recognised and every mask colour is a known slot`, { skip }, () => {
    const { lib } = loadPack(name);
    const unrecognised = lib.unrecognized.map((u) => u.path).filter((p) => /(^|\/)(Face|TV|TVD|SV|Variation)\//i.test(p))
      // Names without a part number (user files like "TV_ClothingEric.png") can't be placed by name.
      .filter((p) => /_p[A-Za-z0-9-]+(_|\.| \()/i.test(p.split('/').pop()) && !/\.png\.png$|\]/i.test(p));
    assert.deepEqual(unrecognised, []);
    // RPG Maker's own masks have a few stray pixels (e.g. 148 of ~2 million in MV), so allow a
    // tiny share of unknown colours but nothing systematic.
    let known = 0;
    let unknown = 0;
    for (const v of lib.variants.values()) {
      for (const l of v.layers) {
        if (!l.mask) continue;
        const d = l.mask.pixels.data;
        const palette = maskPalette(l.mask.pixels);
        for (let i = 0; i < d.length; i += 4) {
          if (!d[i + 3]) continue;
          const id = palette.get((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
          if (id === undefined) unknown++;
          else if (id) known++;
        }
      }
    }
    assert.ok(unknown <= known * 0.001, `${unknown} unknown vs ${known} known mask pixels`);
  });

  test(`${name}: gradients run light to dark`, { skip }, () => {
    const { gradients } = loadPack(name);
    if (!gradients.length) return;
    const lum = (c, x) => 0.299 * c[x * 4] + 0.587 * c[x * 4 + 1] + 0.114 * c[x * 4 + 2];
    const lightLeft = gradients.filter((g) => lum(g.colors, 0) > lum(g.colors, 255)).length;
    assert.ok(lightLeft / gradients.length > 0.9, `${lightLeft}/${gradients.length} gradients are light on the left`);
  });

  test(`${name}: renders a character mixing parts from two body types`, { skip }, () => {
    const { lib, gradients } = loadPack(name);
    const bodyTypes = [...lib.bodyTypes.keys()];
    const character = { bodyType: bodyTypes[0], parts: {}, colors: {}, offsets: {} };
    // One variant per part, alternating body types, preferring variants with sprite layers.
    let i = 0;
    for (const v of lib.variants.values()) {
      if (character.parts[v.part] || v.bodyType !== bodyTypes[i++ % bodyTypes.length]) continue;
      if (v.layers.some((l) => l.sheet === 'TV')) character.parts[v.part] = v.id;
    }
    for (const g of gradients.slice(0, 1)) for (const id of ['skin', 'hair', 'eyes', 'accA', 'beastEars', 'clothing', 'mark']) character.colors[id] = g.id;
    const byId = new Map(gradients.map((g) => [g.id, g]));
    for (const sheet of ['FG', 'TV', 'TVD', 'SV']) {
      const { image, problems } = composeSheet(sheet, character, lib, byId, { flipGradient: false });
      assert.deepEqual(problems, [], sheet);
      if (!image) continue;
      if (sheet === 'FG') assert.deepEqual([image.width, image.height], [144, 144]);
      let opaque = 0;
      for (let k = 3; k < image.data.length; k += 4) if (image.data[k]) opaque++;
      assert.ok(opaque > 0, `${sheet} rendered nothing`);
    }
  });
}

test('vxace: every VX Ace generator file is read, and painted colours pick cells', { skip: packs.includes('vxace') ? false : 'no vxace pack' }, () => {
  const { lib } = loadPack('vxace');
  assert.deepEqual(lib.unrecognized.map((u) => u.path), []);
  assert.equal(lib.packs[0].format, 'vxace');
  assert.deepEqual([...lib.bodyTypes.keys()].sort(), ['Female', 'Male']);
  const id = (part, pid) => `vxace/Male/${part}/${pid}`;
  // Shared files reach both body types; Mini/Eyes.png gives every eye shape its walking eyes.
  assert.ok(lib.variants.get('vxace/Female/Glasses/p01'));
  assert.ok(lib.variants.get(id('Eyes', 'p03')).layers.some((l) => l.sheet === 'TV'));
  const character = {
    bodyType: 'Male',
    parts: { Body: id('Body', 'p01'), Face: id('Face', 'p01'), FrontHair: id('FrontHair', 'p01'), RearHair: id('RearHair', 'p01'), Eyes: id('Eyes', 'p01'), Clothing: id('Clothing', 'p01') },
    colors: {},
  };
  const face = composeSheet('FG', character, lib, new Map(), {}).image;
  const walk = composeSheet('TV', character, lib, new Map(), {});
  assert.deepEqual([face.width, face.height], [128, 128]);
  assert.deepEqual([walk.image.width, walk.image.height, walk.frame.w, walk.frame.h], [96, 128, 32, 32]);
  const sig = (img) => img.data.reduce((a, v, i) => (a + v * ((i % 251) + 1)) % 1000000007, 0);
  const red = composeSheet('FG', { ...character, colors: { 'vx:hair': 'painted:5' } }, lib, new Map(), {}).image;
  assert.notEqual(sig(red), sig(face));
  const darkSkin = composeSheet('TV', { ...character, colors: { 'vx:skin': 'painted:3' } }, lib, new Map(), {}).image;
  assert.notEqual(sig(darkSkin), sig(walk.image));
});
