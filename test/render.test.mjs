import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recolorLayer, blendOver, createImage, matchSlot } from '../src/recolor.js';
import { gradientFromStops, splitGradientImage, gradientsToImage } from '../src/gradients.js';
import { composeSheet, layersForSheet, orderIndex } from '../src/compose.js';
import { randomize, serializeCharacter, deserializeCharacter } from '../src/character.js';
import { createLibrary, addPack } from '../src/parse.js';

function solid(w, h, [r, g, b, a]) {
  const img = createImage(w, h);
  for (let i = 0; i < img.data.length; i += 4) img.data.set([r, g, b, a], i);
  return img;
}
const px = (img, x, y) => [...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];
const redToBlue = gradientFromStops([{ pos: 0, color: '#ff0000' }, { pos: 1, color: '#0000ff' }]);
const settings = { invertGradient: false };

test('gradient from stops interpolates end to end', () => {
  assert.deepEqual([...redToBlue.slice(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...redToBlue.slice(255 * 4, 256 * 4)], [0, 0, 255, 255]);
});

test('gradient sheets round-trip', () => {
  const sheet = gradientsToImage([{ colors: redToBlue }, { colors: redToBlue }]);
  assert.equal(sheet.height, 8);
  const rows = splitGradientImage(sheet, { pack: 'P', name: 'gradients', category: 'all' });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1].colors, redToBlue);
});

test('mask colours select slots, white is left alone, near-matches are tolerated', () => {
  assert.equal(matchSlot(0xffffff), null);
  assert.equal(matchSlot(0xfccb0a), 'hair');
  assert.equal(matchSlot(0xfdcb0b), 'hair');
  assert.equal(matchSlot(0x123456), null);
});

test('masked recolour uses brightness as gradient index and keeps alpha', () => {
  const base = solid(2, 1, [255, 255, 255, 200]); // white -> index 255 -> blue
  const mask = createImage(2, 1);
  mask.data.set([0xfc, 0xcb, 0x0a, 255, 255, 255, 255, 255]); // hair, ignore
  const out = recolorLayer(base, mask, null, (id) => (id === 'hair' ? redToBlue : null), settings);
  assert.deepEqual(px(out, 0, 0), [0, 0, 255, 200]);
  assert.deepEqual(px(out, 1, 0), [255, 255, 255, 200]);

  const inverted = recolorLayer(base, mask, null, () => redToBlue, { invertGradient: true });
  assert.deepEqual(px(inverted, 0, 0), [255, 0, 0, 200]);
});

test('face layers recolour as a whole via slot id', () => {
  const base = solid(1, 1, [0, 0, 0, 255]);
  const out = recolorLayer(base, null, 'skin', () => redToBlue, settings);
  assert.deepEqual(px(out, 0, 0), [255, 0, 0, 255]);
  const untouched = recolorLayer(base, null, 'skin', () => null, settings);
  assert.deepEqual(px(untouched, 0, 0), [0, 0, 0, 255]);
});

test('blendOver handles opaque and translucent pixels', () => {
  const target = solid(1, 1, [0, 0, 0, 255]);
  blendOver(target, solid(1, 1, [255, 255, 255, 128]));
  assert.deepEqual(px(target, 0, 0), [128, 128, 128, 255]);
});

test('draw order: listed top-most first, unknown parts on top', () => {
  assert.ok(orderIndex('TV', 'FrontHair1', 'FrontHair') < orderIndex('TV', 'Body', 'Body'));
  assert.ok(orderIndex('TV', 'Body', 'Body') < orderIndex('TV', 'Wing2', 'Wing'));
  assert.equal(orderIndex('TV', 'Hat', 'Hat'), 0);
  assert.equal(orderIndex('FG', 'Clothing2:c9', 'Clothing'), orderIndex('FG', 'Clothing2:c3', 'Clothing'));
});

function sampleLibrary() {
  const lib = createLibrary();
  addPack(lib, 'P', [
    { path: 'TV/Male/TV_Body_p01.png', src: 'body' },
    { path: 'TV/Male/TV_Body_p01_c.png', src: 'bodyMask' },
    { path: 'TV/Male/TV_FrontHair1_p01.png', src: 'hair' },
    { path: 'TV/Male/TV_FrontHair2_p01.png', src: 'hairBack' },
  ]);
  const pixels = {
    body: solid(2, 2, [255, 255, 255, 255]),
    bodyMask: solid(2, 2, [0xf9, 0xc1, 0x9d, 255]),
    hair: (() => { const i = createImage(2, 2); i.data.set([10, 20, 30, 255], 0); return i; })(),
    hairBack: solid(2, 2, [99, 99, 99, 255]),
  };
  for (const variants of lib.bodyTypes.get('Male').parts.values()) {
    for (const v of variants.values()) {
      for (const l of v.layers) {
        l.base.pixels = pixels[l.base.src];
        if (l.mask) l.mask.pixels = pixels[l.mask.src];
      }
    }
  }
  return lib;
}

test('composeSheet layers front hair over body over back hair, recoloured', () => {
  const lib = sampleLibrary();
  const body = lib.bodyTypes.get('Male');
  const character = { bodyType: 'Male', parts: { Body: 'P/p01', FrontHair: 'P/p01' }, colors: { skin: 'g' } };
  const keys = layersForSheet('TV', character, body).map((l) => l.key);
  assert.deepEqual(keys, ['FrontHair2', 'Body', 'FrontHair1']);

  const { image } = composeSheet('TV', character, body, new Map([['g', { colors: redToBlue }]]), settings);
  assert.deepEqual(px(image, 0, 0), [10, 20, 30, 255]); // front hair on top
  assert.deepEqual(px(image, 1, 1), [0, 0, 255, 255]); // body recoloured (white -> blue)
});

test('character save/load survives a renamed pack', () => {
  const lib = sampleLibrary();
  const character = { name: 'Hero', bodyType: 'Male', parts: { Body: 'Old name/p01', Tail: null }, colors: { skin: 'custom/1' } };
  const custom = [{ id: 'custom/1', label: 'Mine', stops: [{ pos: 0, color: '#000000' }, { pos: 1, color: '#ffffff' }] }];
  const loaded = deserializeCharacter(serializeCharacter(character, custom), lib);
  assert.equal(loaded.character.parts.Body, 'P/p01');
  assert.deepEqual(loaded.missing, []);
  assert.equal(loaded.customGradients.length, 1);
  assert.equal(loaded.customGradients[0].colors.length, 1024);
});

test('randomize keeps locked parts and always picks required parts', () => {
  const lib = sampleLibrary();
  const body = lib.bodyTypes.get('Male');
  let seed = 1;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const base = { bodyType: 'Male', parts: { FrontHair: null }, colors: {} };
  for (let i = 0; i < 20; i++) {
    const next = randomize(base, body, [{ id: 'g', category: 'all' }], { rng, locked: new Set(['FrontHair']) });
    assert.equal(next.parts.Body, 'P/p01');
    assert.equal(next.parts.FrontHair, null);
    assert.equal(next.colors.skin, 'g');
  }
});
