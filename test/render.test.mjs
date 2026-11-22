import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recolorLayer, blendOver, createImage, matchSlot, scanMask, rotateFrames } from '../src/recolor.js';
import { gradientFromStops, splitGradientImage, gradientsToImage } from '../src/gradients.js';
import { composeSheet, layersForSheet, orderIndex, moveLayer, countPieces, sheetLayout, placeOnSheet } from '../src/compose.js';
import { islandLabels } from '../src/islands.js';
import { solidOf, insideOutline, applyClip } from '../src/clip.js';
import { randomize, serializeCharacter, deserializeCharacter, resolveVariant, applyDefaults, createCharacter, creditsFor, creditsText, makeSet, applySet } from '../src/character.js';
import { createLibrary, addPack } from '../src/parse.js';

function solid(w, h, [r, g, b, a]) {
  const img = createImage(w, h);
  for (let i = 0; i < img.data.length; i += 4) img.data.set([r, g, b, a], i);
  return img;
}
const px = (img, x, y) => [...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];
// RPG Maker orientation: highlight on the left (column 0), shadow on the right.
const lightToDark = gradientFromStops([{ pos: 0, color: '#ff0000' }, { pos: 1, color: '#0000ff' }]);
const settings = { flipGradient: false };

test('gradient from stops interpolates end to end', () => {
  assert.deepEqual([...lightToDark.slice(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...lightToDark.slice(255 * 4, 256 * 4)], [0, 0, 255, 255]);
});

test('gradient sheets round-trip', () => {
  const sheet = gradientsToImage([{ colors: lightToDark }, { colors: lightToDark }]);
  assert.equal(sheet.height, 8);
  const rows = splitGradientImage(sheet, { pack: 'P', name: 'gradients', category: 'all' });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1].colors, lightToDark);
});

test('mask colours select slots, white is left alone, near-matches are tolerated', () => {
  assert.equal(matchSlot(0xffffff), null);
  assert.equal(matchSlot(0xfccb0a), 'hair');
  assert.equal(matchSlot(0xfdcb0b), 'hair');
  assert.equal(matchSlot(0x123456), null);
});

test('bright pixels read the left (highlight) end of the gradient; alpha is kept', () => {
  const base = solid(2, 1, [255, 255, 255, 200]);
  const mask = createImage(2, 1);
  mask.data.set([0xfc, 0xcb, 0x0a, 255, 255, 255, 255, 255]); // hair, ignore
  const out = recolorLayer(base, mask, null, (id) => (id === 'hair' ? lightToDark : null), settings);
  assert.deepEqual(px(out, 0, 0), [255, 0, 0, 200]);
  assert.deepEqual(px(out, 1, 0), [255, 255, 255, 200]);

  const flipped = recolorLayer(base, mask, null, () => lightToDark, { flipGradient: true });
  assert.deepEqual(px(flipped, 0, 0), [0, 0, 255, 200]);
});

test('face layers recolour as a whole via slot id', () => {
  const dark = solid(1, 1, [0, 0, 0, 255]);
  assert.deepEqual(px(recolorLayer(dark, null, 'skin', () => lightToDark, settings), 0, 0), [0, 0, 255, 255]);
  assert.deepEqual(px(recolorLayer(dark, null, 'skin', () => null, settings), 0, 0), [0, 0, 0, 255]);
});

test('blendOver handles translucency and clips offsets to the animation frame', () => {
  const target = solid(1, 1, [0, 0, 0, 255]);
  blendOver(target, solid(1, 1, [255, 255, 255, 128]));
  assert.deepEqual(px(target, 0, 0), [128, 128, 128, 255]);

  // Two 2px frames side by side; shifting right by 1 must not leak frame 0 into frame 1.
  const sheet = createImage(4, 1);
  const top = createImage(4, 1);
  top.data.set([10, 10, 10, 255, 20, 20, 20, 255, 30, 30, 30, 255, 40, 40, 40, 255]);
  blendOver(sheet, top, 1, 0, { w: 2, h: 1 });
  assert.deepEqual(px(sheet, 1, 0), [10, 10, 10, 255]);
  assert.deepEqual(px(sheet, 2, 0), [0, 0, 0, 0]); // frame 0's last pixel was clipped, not moved
  assert.deepEqual(px(sheet, 3, 0), [30, 30, 30, 255]);
});

test('draw order: listed top-most first, unknown parts on top', () => {
  assert.ok(orderIndex('TV', 'FrontHair1', 'FrontHair') < orderIndex('TV', 'Body', 'Body'));
  assert.ok(orderIndex('TV', 'Body', 'Body') < orderIndex('TV', 'Wing2', 'Wing'));
  assert.equal(orderIndex('TV', 'Hat', 'Hat'), 0);
  assert.ok(orderIndex('FG', 'Clothing2:c9', 'Clothing') > orderIndex('FG', 'Clothing2:c6', 'Clothing'));
  assert.ok(orderIndex('FG', 'Clothing2:c9', 'Clothing') < orderIndex('FG', 'Body:c1', 'Body'));
});

function sampleLibrary() {
  const lib = createLibrary();
  addPack(lib, 'P', [
    { path: 'TV/Male/TV_Body_p01.png', src: 'body' },
    { path: 'TV/Male/TV_Body_p01_c.png', src: 'bodyMask' },
    { path: 'TV/Male/TV_FrontHair1_p01.png', src: 'hair' },
    { path: 'TV/Male/TV_FrontHair2_p01.png', src: 'hairBack' },
    { path: 'TV/Female/TV_Body_p01.png', src: 'body' },
    { path: 'TV/Female/TV_AccA_p07.png', src: 'acc' },
  ]);
  const pixels = {
    body: solid(2, 2, [0, 0, 0, 255]), // dark -> shadow end of the gradient
    bodyMask: solid(2, 2, [0xf9, 0xc1, 0x9d, 255]),
    hair: (() => { const i = createImage(2, 2); i.data.set([10, 20, 30, 255], 0); return i; })(),
    hairBack: solid(2, 2, [99, 99, 99, 255]),
    acc: (() => { const i = createImage(2, 2); i.data.set([77, 77, 77, 255], 12); return i; })(),
  };
  for (const v of lib.variants.values()) {
    for (const l of v.layers) {
      l.base.pixels = pixels[l.base.src];
      if (l.mask) l.mask.pixels = pixels[l.mask.src];
    }
  }
  return lib;
}

test('composeSheet layers front hair over body over back hair, recoloured', () => {
  const lib = sampleLibrary();
  const character = { bodyType: 'Male', parts: { Body: 'P/Male/Body/p01', FrontHair: 'P/Male/FrontHair/p01' }, colors: { skin: 'g' } };
  assert.deepEqual(layersForSheet('TV', character, lib).map((d) => d.layer.key), ['FrontHair2', 'Body', 'FrontHair1']);

  const { image } = composeSheet('TV', character, lib, new Map([['g', { colors: lightToDark }]]), settings);
  assert.deepEqual(px(image, 0, 0), [10, 20, 30, 255]); // front hair on top
  assert.deepEqual(px(image, 1, 1), [0, 0, 255, 255]); // body recoloured (black -> shadow end)
});

test('a male character can wear a female-only part, with an offset', () => {
  const lib = sampleLibrary();
  const character = {
    bodyType: 'Male',
    parts: { Body: 'P/Male/Body/p01', AccA: 'P/Female/AccA/p07' },
    colors: {},
    offsets: { AccA: { sprite: { x: -1, y: 0 } } },
  };
  const { image } = composeSheet('TV', character, lib, new Map(), settings);
  // The accessory pixel at (1,1) moved to (0,1).
  assert.deepEqual(px(image, 0, 1), [77, 77, 77, 255]);
});

test('character save/load survives a renamed pack and keeps offsets', () => {
  const lib = sampleLibrary();
  const character = {
    name: 'Hero', bodyType: 'Male',
    parts: { Body: 'Old name/Male/Body/p01', AccA: 'Old name/Female/AccA/p07', Tail: null },
    colors: { skin: 'custom/1' },
    offsets: { AccA: { face: { x: 2, y: 3 } } },
  };
  const custom = [{ id: 'custom/1', label: 'Mine', stops: [{ pos: 0, color: '#ffffff' }, { pos: 1, color: '#000000' }] }];
  const loaded = deserializeCharacter(serializeCharacter(character, custom), lib);
  assert.equal(loaded.character.parts.Body, 'P/Male/Body/p01');
  assert.equal(loaded.character.parts.AccA, 'P/Female/AccA/p07');
  assert.deepEqual(loaded.character.offsets, character.offsets);
  assert.deepEqual(loaded.missing, []);
  assert.equal(loaded.customGradients[0].colors.length, 1024);
});

test('version 1 save files (ids without body type) still load', () => {
  const lib = sampleLibrary();
  const v1 = JSON.stringify({
    format: 'rpgmaker-xgen-character', version: 1,
    character: { name: 'Old', bodyType: 'Female', parts: { Body: 'P/p01' }, colors: {} },
  });
  assert.equal(deserializeCharacter(v1, lib).character.parts.Body, 'P/Female/Body/p01');
  assert.equal(resolveVariant(lib, 'AccA', 'Gone/p07', 'Male'), 'P/Female/AccA/p07'); // falls back to any body type
});

test('randomize keeps locked parts and always picks required parts', () => {
  const lib = sampleLibrary();
  let seed = 1;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const base = { bodyType: 'Male', parts: { FrontHair: null }, colors: {} };
  for (let i = 0; i < 20; i++) {
    const next = randomize(base, lib, [{ id: 'g', category: 'all' }], { rng, locked: new Set(['FrontHair']) });
    assert.equal(next.parts.Body, 'P/Male/Body/p01');
    assert.equal(next.parts.FrontHair, null);
    assert.equal(next.colors.skin, 'g');
  }
});

test('a body or face set to None stays empty; new characters still get one', () => {
  const lib = sampleLibrary();
  const fresh = applyDefaults(createCharacter('Male'), lib);
  assert.ok(fresh.parts.Body);
  const cleared = applyDefaults({ ...fresh, parts: { ...fresh.parts, Body: null } }, lib);
  assert.equal(cleared.parts.Body, null);
});

test('near-miss mask colours join a slot the mask uses; far-off colours are reported', () => {
  // MZ's TV_Body masks mark part of each eye #1380f8 next to the real eye colour #2c80cb.
  const mask = createImage(4, 1);
  mask.data.set([0x2c, 0x80, 0xcb, 255, 0x13, 0x80, 0xf8, 255, 0xfe, 0xfe, 0xfe, 255, 0x00, 0xff, 0x00, 255]);
  const { slots, unknown } = scanMask(mask);
  assert.deepEqual([...slots], ['eyes']);
  assert.deepEqual([...unknown], [[0x00ff00, 1]]);

  const base = solid(4, 1, [128, 128, 128, 255]);
  const red = gradientFromStops([{ pos: 0, color: '#ff0000' }, { pos: 1, color: '#ff0000' }]);
  const out = recolorLayer(base, mask, null, (id) => (id === 'eyes' ? red : null), { flipGradient: false });
  assert.deepEqual([...out.data.slice(0, 8)], [255, 0, 0, 255, 255, 0, 0, 255]); // both eye pixels
  assert.deepEqual([...out.data.slice(8, 16)], [128, 128, 128, 255, 128, 128, 128, 255]); // off-white, unknown: kept
});

test('a face cell used both fixed and recoloured gives two layers, recoloured on top', () => {
  const lib = createLibrary();
  addPack(lib, 'MZ', [
    { path: 'g/Face/Male/FG_Beard_p07_c1_m003.png', src: 'coloured' },
    { path: 'g/Face/Male/FG_Beard_p07_c1.png', src: 'fixed' },
  ]);
  assert.deepEqual(lib.warnings, []);
  const v = [...lib.variants.values()][0];
  const character = { bodyType: 'Male', parts: { Beard: v.id }, colors: {}, offsets: {} };
  assert.deepEqual(layersForSheet('FG', character, lib).map((d) => d.layer.base.src), ['fixed', 'coloured']);
});

test('a set variant (odd-eye body) borrows the sheets it lacks from the plain variant', () => {
  const lib = createLibrary();
  addPack(lib, 'MZ', [
    { path: 'g/Face/Male/FG_Body_p01_c1_m001.png', src: 'face' },
    { path: 'g/SV/Male/SV_Body_p01.png', src: 'plain' },
  ]);
  addPack(lib, 'DLC', [{ path: 'g/odd-eye_bodies/left_red/Male/SV_body_p01.png', src: 'odd' }]);
  const odd = [...lib.variants.values()].find((v) => v.pid === 'p01 (left_red)');
  const character = { bodyType: 'Male', parts: { Body: odd.id }, colors: {}, offsets: {} };
  assert.deepEqual(layersForSheet('SV', character, lib).map((d) => d.layer.base.src), ['odd']);
  assert.deepEqual(layersForSheet('FG', character, lib).map((d) => d.layer.base.src), ['face']);
});

test('two items of the same part: each has its own offset and can have its own colours', () => {
  const lib = sampleLibrary();
  const character = {
    bodyType: 'Male',
    parts: { Body: 'P/Male/Body/p01', 'Body 2': 'P/Male/Body/p01' },
    colors: { skin: 'red' },
    itemColors: { 'Body 2': { skin: 'blue' } },
    offsets: { 'Body 2': { sprite: { x: 1, y: 0 } } },
  };
  const solidGradient = (hex) => ({ colors: gradientFromStops([{ pos: 0, color: hex }, { pos: 1, color: hex }]) });
  const byId = new Map([['red', solidGradient('#ff0000')], ['blue', solidGradient('#0000ff')]]);
  assert.deepEqual(layersForSheet('TV', character, lib).map((d) => d.item), ['Body', 'Body 2']);
  const { image } = composeSheet('TV', character, lib, byId, settings);
  assert.deepEqual(px(image, 0, 0), [255, 0, 0, 255]); // first item, shared colour
  assert.deepEqual(px(image, 1, 0), [0, 0, 255, 255]); // second item on top, shifted, own colour
});

test('extra items survive save/load', () => {
  const lib = sampleLibrary();
  const character = { name: 'A', bodyType: 'Male', parts: { AccA: 'P/Female/AccA/p07', 'AccA 2': 'P/Female/AccA/p07' }, colors: {}, itemColors: { 'AccA 2': { accA: 'x' } }, offsets: {} };
  const loaded = deserializeCharacter(serializeCharacter(character, []), lib);
  assert.equal(loaded.character.parts['AccA 2'], 'P/Female/AccA/p07');
  assert.deepEqual(loaded.character.itemColors, { 'AccA 2': { accA: 'x' } });
  assert.deepEqual(loaded.missing, []);
});

test('custom draw order: moving a layer swaps it with its neighbour; new layers keep their place', () => {
  const lib = sampleLibrary();
  const character = { bodyType: 'Male', parts: { Body: 'P/Male/Body/p01', FrontHair: 'P/Male/FrontHair/p01' }, colors: {} };
  const keys = () => layersForSheet('TV', character, lib).map((d) => d.layer.key);
  assert.deepEqual(keys(), ['FrontHair2', 'Body', 'FrontHair1']);
  character.drawOrder = { TV: moveLayer('TV', character, lib, 'Body|Body', 1) };
  assert.deepEqual(keys(), ['FrontHair2', 'FrontHair1', 'Body']); // body now on top
  // AccA isn't in the custom list: it keeps its default spot (third from the bottom).
  character.parts.AccA = 'P/Female/AccA/p07';
  assert.deepEqual(keys(), ['FrontHair2', 'FrontHair1', 'AccA', 'Body']);
  assert.deepEqual(layersForSheet('FG', character, lib), []);
});

test('rotation turns each frame around its own centre and never leaks into the next frame', () => {
  // Two 3x3 frames, each with a horizontal bar through the middle row.
  const img = createImage(6, 3);
  for (const x of [0, 1, 2, 3, 4, 5]) img.data.set([200, 0, 0, 255], (1 * 6 + x) * 4);
  const out = rotateFrames(img, 90, { w: 3, h: 3 });
  const alpha = (x, y) => out.data[(y * 6 + x) * 4 + 3];
  for (const fx of [0, 3]) {
    assert.deepEqual([alpha(fx + 1, 0), alpha(fx + 1, 1), alpha(fx + 1, 2)], [255, 255, 255]); // vertical now
    assert.equal(alpha(fx, 1), 0);
  }
  assert.equal(rotateFrames(img, 0), img);
});

test('all layers of a rotated item turn around one shared centre', () => {
  const lib = sampleLibrary();
  const character = { bodyType: 'Male', parts: { FrontHair: 'P/Male/FrontHair/p01' }, colors: {}, offsets: { FrontHair: { sprite: { x: 0, y: 0, rot: 180 } } } };
  // hairBack fills the 2x2 frame, the front layer has one pixel at (0,0): a half turn around the
  // shared centre (0.5, 0.5) moves it to (1,1). Around its own centre it would stay put.
  const { image } = composeSheet('TV', character, lib, new Map(), settings);
  assert.deepEqual(px(image, 1, 1), [10, 20, 30, 255]);
});

test('islands: two eyes become two pieces, left to right; a gap setting can join them', () => {
  const img = createImage(9, 3);
  for (const x of [0, 1, 2, 6, 7, 8]) img.data.set([50, 50, 50, 255], (1 * 9 + x) * 4);
  img.data.set([50, 50, 50, 255], (0 * 9 + 4) * 4 + 0); // a 1px speck: joins the nearest eye
  const { labels, count } = islandLabels([img], null, 0);
  assert.equal(count, 2);
  assert.equal(labels[1 * 9 + 1], 1);
  assert.equal(labels[1 * 9 + 7], 2);
  assert.equal(islandLabels([img], null, 3).count, 1); // 3px gap bridged
});

test('a split item draws each piece with its own offset and colours', () => {
  const lib = createLibrary();
  addPack(lib, 'P', [{ path: 'Face/Male/FG_Eyes_p01_c1_m002.png', src: 'eyes' }]);
  const eyes = createImage(144, 144);
  for (const x of [40, 41, 100, 101]) eyes.data.set([128, 128, 128, 255], (70 * 144 + x) * 4);
  lib.variants.get('P/Male/Eyes/p01').layers[0].base.pixels = eyes;
  const character = { bodyType: 'Male', parts: { Eyes: 'P/Male/Eyes/p01' }, colors: { eyes: 'blue' }, offsets: {}, itemColors: {} };
  assert.equal(countPieces(character, lib, 'Eyes', 0), 2);
  character.split = { Eyes: { gap: 0, count: 2 } };
  character.offsets['Eyes #2'] = { face: { x: 3, y: 0 } };
  character.itemColors['Eyes #2'] = { eyes: 'red' };
  const solidGradient = (hex) => ({ colors: gradientFromStops([{ pos: 0, color: hex }, { pos: 1, color: hex }]) });
  const byId = new Map([['red', solidGradient('#ff0000')], ['blue', solidGradient('#0000ff')]]);
  assert.deepEqual(layersForSheet('FG', character, lib).map((d) => d.item), ['Eyes #1', 'Eyes #2']);
  const { image } = composeSheet('FG', character, lib, byId, settings);
  assert.deepEqual(px(image, 40, 70), [0, 0, 255, 255]); // left eye: shared colour, in place
  assert.equal(px(image, 100, 70)[3], 0); // right eye moved...
  assert.deepEqual(px(image, 103, 70), [255, 0, 0, 255]); // ...3px right, in its own colour
});

test('clipping: hair only shows inside the outline of a hood, including its open bottom', () => {
  // A 7x5 hood: an arch (top row + both sides), open at the bottom.
  const hood = createImage(7, 5);
  for (let x = 1; x <= 5; x++) hood.data.set([9, 9, 9, 255], (0 * 7 + x) * 4);
  for (let y = 0; y < 5; y++) for (const x of [1, 5]) hood.data.set([9, 9, 9, 255], (y * 7 + x) * 4);
  const inside = insideOutline(solidOf(hood), 7, 5);
  assert.equal(inside[2 * 7 + 3], 1); // the opening
  assert.equal(inside[2 * 7 + 0], 0); // beside the hood
  assert.equal(inside[2 * 7 + 6], 0);

  const hair = createImage(7, 5);
  for (let x = 0; x < 7; x++) hair.data.set([200, 0, 0, 255], (2 * 7 + x) * 4);
  applyClip(hair, inside, 'inside');
  assert.deepEqual([0, 3, 6].map((x) => hair.data[(2 * 7 + x) * 4 + 3]), [0, 255, 0]);
});

test('a clipped item is cut by the other item at its drawn position', () => {
  const lib = sampleLibrary();
  // AccA has one pixel at (1,1); clip the body to "except where AccA overlaps".
  const character = { bodyType: 'Male', parts: { Body: 'P/Male/Body/p01', AccA: 'P/Female/AccA/p07' }, colors: {}, clip: { Body: { by: 'AccA', mode: 'outside' } } };
  character.drawOrder = { TV: ['Body|Body', 'AccA|AccA'] }; // body on top, so the hole shows AccA below
  const { image } = composeSheet('TV', character, lib, new Map(), settings);
  assert.deepEqual(px(image, 1, 1), [77, 77, 77, 255]);
  assert.equal(px(image, 0, 0)[3], 255);
});

test('credits list every pack a character uses, and readme files are kept with their pack', () => {
  const lib = sampleLibrary();
  addPack(lib, 'Hats by Ann', [
    { path: 'Hats/TV/Male/TV_AccB_p01.png', src: 'acc' },
    { path: 'Hats/credits.txt', src: 'c' },
    { path: 'Hats/notes.md', src: 'n' },
  ]);
  assert.deepEqual(lib.packs[1].texts.map((t) => t.path), ['Hats/credits.txt', 'Hats/notes.md']);
  const character = { bodyType: 'Male', parts: { Body: 'P/Male/Body/p01', AccB: 'Hats by Ann/Male/AccB/p01', Tail: null }, colors: { skin: 'Hats by Ann/gradients#0' } };
  const credits = creditsFor(character, lib);
  assert.deepEqual(credits.map((c) => [c.pack, c.parts, c.colours]), [['P', ['Body p01'], false], ['Hats by Ann', ['AccB p01'], true]]);
  assert.equal(creditsText(credits, { 'Hats by Ann': 'CC-BY' }), 'P: Body p01\nHats by Ann (CC-BY): AccB p01; colours');
});

test('sheet templates: 48px walk parts go frame by frame onto a 64px template, standing on the bottom', () => {
  const part = createImage(144, 192); // RPG Maker walk sheet: 3x4 frames of 48px
  part.data.set([1, 2, 3, 255], (47 * 144 + 48) * 4); // bottom-left pixel of frame (1,0)
  const layout = sheetLayout('TV', [], { templates: { TV: { fw: 64, fh: 64 } } });
  assert.deepEqual(layout.size, { w: 192, h: 256 });
  const { image, tiled } = placeOnSheet(part, 'TV', layout);
  assert.equal(tiled, true);
  // Frame (1,0) starts at x=64; the 48px frame is centred (+8) and bottom-aligned (+16).
  assert.deepEqual(px(image, 64 + 8, 63), [1, 2, 3, 255]);
  assert.equal(sheetLayout('TV', [], {}).size.w, 144); // no template: automatic
});

test('character sets: save some items with their colours, put them on another character', () => {
  const lib = sampleLibrary();
  const source = {
    bodyType: 'Male', parts: { Body: 'P/Male/Body/p01', FrontHair: 'P/Male/FrontHair/p01' },
    colors: { hair: 'red', skin: 'pale' }, offsets: { FrontHair: { face: { x: 1, y: 0 } } }, itemColors: {}, split: {}, clip: {},
  };
  const set = makeSet(source, lib, 'Red hair', ['FrontHair']);
  assert.deepEqual(set.parts, { FrontHair: 'P/Male/FrontHair/p01' });
  assert.deepEqual(set.offsets, { FrontHair: { face: { x: 1, y: 0 } } });
  const target = { bodyType: 'Male', parts: { Body: 'P/Male/Body/p01', AccA: 'P/Female/AccA/p07' }, colors: { skin: 'dark' }, offsets: {} };
  const { character, missing } = applySet(target, set, lib);
  assert.deepEqual(missing, []);
  assert.equal(character.parts.FrontHair, 'P/Male/FrontHair/p01');
  assert.equal(character.parts.AccA, 'P/Female/AccA/p07'); // untouched
  assert.equal(character.colors.skin, 'dark'); // skin isn't used by hair: kept
  assert.deepEqual(character.offsets.FrontHair, { face: { x: 1, y: 0 } });
  assert.equal(target.parts.FrontHair, undefined); // the original isn't changed
});

test('randomize rules: wear chances, parts that never go together, colour links, sets', () => {
  const lib = sampleLibrary();
  let seed = 7;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const gradients = [{ id: 'a', category: 'hair' }, { id: 'b', category: 'hair' }, { id: 'c', category: 'common' }];
  const base = { bodyType: 'Male', parts: {}, colors: {} };
  for (let i = 0; i < 20; i++) {
    const never = randomize(base, lib, gradients, { rng, rules: { chances: { FrontHair: 0 } } });
    assert.equal(never.parts.FrontHair, null);
    const always = randomize(base, lib, gradients, { rng, rules: { chances: { FrontHair: 100 }, apart: [['FrontHair', 'Body']], links: [{ slot: 'accA', follows: 'hair' }] } });
    assert.equal(always.parts.FrontHair, 'P/Male/FrontHair/p01');
    assert.equal(always.parts.Body, null); // never together with FrontHair
    assert.equal(always.colors.accA, always.colors.hair);
    const mixed = randomize(base, lib, gradients, { rng, rules: { mixBodyTypes: true, chances: { AccA: 100 } } });
    assert.equal(mixed.parts.AccA, 'P/Female/AccA/p07'); // only the Female body type has one
  }
  const set = { name: 'Hat', parts: { AccA: 'P/Female/AccA/p07' }, colors: {} };
  const withSet = randomize(base, lib, gradients, { rng, rules: { setChance: 100 }, sets: [set] });
  assert.equal(withSet.parts.AccA, 'P/Female/AccA/p07');
});

test('face cells the draw order does not name: c1 above c2 (hair tie over the ponytail)', () => {
  assert.ok(orderIndex('FG', 'RearHair2:c1', 'RearHair') < orderIndex('FG', 'RearHair2:c2', 'RearHair'));
  assert.ok(orderIndex('FG', 'FrontHair:c1', 'FrontHair') < orderIndex('FG', 'FrontHair:c2', 'FrontHair'));
  assert.ok(orderIndex('FG', 'FrontHair:c2', 'FrontHair') < orderIndex('FG', 'Cloak1:c1', 'Cloak'));
});

test('a second image for the same layer becomes an alternate that borrows the rest', () => {
  const lib = createLibrary();
  addPack(lib, 'MZ', [
    { path: 'g/Face/Male/FG_FrontHair_p17_c1].png', src: 'band2' },
    { path: 'g/Face/Male/FG_FrontHair_p17_c1.png', src: 'band' },
    { path: 'g/Face/Male/FG_FrontHair_p17_c2_m003.png', src: 'hair' },
  ]);
  const alt = lib.variants.get('MZ/Male/FrontHair/p17 (alt)');
  assert.ok(alt, [...lib.variants.keys()].join());
  const draw = (id) => layersForSheet('FG', { bodyType: 'Male', parts: { FrontHair: id }, colors: {} }, lib).map((d) => d.layer.base.src);
  assert.deepEqual(draw('MZ/Male/FrontHair/p17'), ['hair', 'band']);
  assert.deepEqual(draw(alt.id), ['hair', 'band2']);
});

test('per-frame positions: one walk direction moves, the others stay', () => {
  const lib = createLibrary();
  addPack(lib, 'P', [{ path: 'TV/Male/TV_AccA_p01.png', src: 'hat' }]);
  const hat = createImage(6, 8); // 3x4 frames of 2x2
  for (let row = 0; row < 4; row++) for (let col = 0; col < 3; col++) hat.data.set([9, 9, 9, 255], ((row * 2) * 6 + col * 2) * 4);
  lib.variants.get('P/Male/AccA/p01').layers[0].base.pixels = hat;
  const character = {
    bodyType: 'Male', parts: { AccA: 'P/Male/AccA/p01' }, colors: {},
    // Row 1 (facing left): every frame 1px right. Frame (2,3): 1px down.
    offsets: { AccA: { cells: { TV: { '0,1': { x: 1 }, '1,1': { x: 1 }, '2,1': { x: 1 }, '2,3': { y: 1 } } } } },
  };
  const { image } = composeSheet('TV', character, lib, new Map(), settings);
  const alpha = (x, y) => image.data[(y * 6 + x) * 4 + 3];
  assert.equal(alpha(0, 0), 255); // row 0 untouched
  assert.equal(alpha(0, 2), 0); // row 1 moved right...
  assert.equal(alpha(1, 2), 255);
  assert.equal(alpha(4, 6), 0); // frame (2,3) moved down
  assert.equal(alpha(4, 7), 255);
  assert.equal(alpha(2, 6), 255); // frame (1,3) untouched
});

test('mask pixels copied from the image are not reported as unknown colours', () => {
  const base = createImage(3, 1);
  const mask = createImage(3, 1);
  base.data.set([90, 90, 90, 255, 32, 29, 26, 255, 10, 10, 10, 255]);
  // Skin slot, a dark outline copied from the image, and a colour that matches neither.
  mask.data.set([0xf9, 0xc1, 0x9d, 255, 32, 29, 26, 255, 200, 0, 200, 255]);
  assert.deepEqual([...scanMask(mask).unknown.keys()].length, 2);
  assert.deepEqual([...scanMask(mask, base).unknown.keys()], [0xc800c8]);
});

test('reads RPG Maker MZ generator presets (CharacterGeneratorSettings)', () => {
  const lib = createLibrary();
  addPack(lib, 'MZ', [
    { path: 'g/Face/Female/FG_Body_p01_c1_m001.png', src: 'b' },
    { path: 'g/Face/Female/FG_Face_p04_c1_m001.png', src: 'f' },
    { path: 'g/Face/Female/FG_FrontHair_p21_c1_m003.png', src: 'h' },
    { path: 'g/Face/Female/FG_Nose_p02_c1_m001.png', src: 'n' },
  ]);
  const grad = (category, n) => Array.from({ length: n }, (_, i) => ({ id: `MZ/grad_${category}#${i}`, category, source: 'file' }));
  const gradients = [...grad('skin', 4), ...grad('hair', 30), ...grad('common', 20)];
  const json = JSON.stringify({
    identity: 'CharacterGeneratorSettings', version: '2.0.0', gender: 'female',
    patterns: { body: 'p01', face: 'p04', fronthair: 'p21', nose: 'p02', glasses: '', beard: 'p09' },
    colors: { '#F9C19D': 2, '#FCCB0A': 23, '#AE8682': 15 },
    offsets: { nose: { x: -3, y: -1 }, eyes: { x: 0, y: 0 } },
  });
  const { character, missing } = deserializeCharacter(json, lib, gradients, 'Soldier_female.json');
  assert.equal(character.name, 'Soldier_female');
  assert.equal(character.bodyType, 'Female');
  assert.equal(character.parts.FrontHair, 'MZ/Female/FrontHair/p21');
  assert.equal(character.parts.Glasses, null);
  assert.equal(character.colors.skin, 'MZ/grad_skin#2');
  assert.equal(character.colors.hair, 'MZ/grad_hair#23');
  assert.equal(character.colors.clothing, 'MZ/grad_common#15');
  assert.deepEqual(character.offsets.Nose.face, { x: -3, y: -1, rot: 0 });
  assert.deepEqual(missing, ['Beard p09']);
});
