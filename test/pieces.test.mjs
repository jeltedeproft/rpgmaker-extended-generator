import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImage } from '../src/recolor.js';
import { composeSheet, layersForSheet, makeSplit } from '../src/compose.js';
import { encodeMask, decodeMask } from '../src/islands.js';
import { createLibrary, addPack } from '../src/parse.js';

const settings = { flipGradient: false };
const grey = [128, 128, 128, 255];

/** AccB: one band on the portrait; two horns in every walk frame. */
function accb() {
  const lib = createLibrary();
  addPack(lib, 'P', [
    { path: 'Face/Male/FG_AccB_p01_c1_m001.png', src: 'face' },
    { path: 'TV/Male/TV_AccB_p01.png', src: 'walk' },
  ]);
  const face = createImage(144, 144);
  for (let x = 40; x < 100; x++) face.data.set(grey, (20 * 144 + x) * 4);
  const walk = createImage(144, 192);
  for (let fy = 0; fy < 192; fy += 48) {
    for (let fx = 0; fx < 144; fx += 48) {
      for (const x of [10, 11, 36, 37]) walk.data.set(grey, ((fy + 5) * 144 + fx + x) * 4);
    }
  }
  const variant = lib.variants.get('P/Male/AccB/p01');
  variant.layers.find((l) => l.sheet === 'FG').base.pixels = face;
  variant.layers.find((l) => l.sheet === 'TV').base.pixels = walk;
  const character = { bodyType: 'Male', parts: { AccB: 'P/Male/AccB/p01' }, colors: {}, offsets: {}, itemColors: {} };
  return { lib, character, walk };
}

test('split: each picture its own pieces (Portrait; Walk 1 and 2), drawn only there', () => {
  const { lib, character } = accb();
  const split = makeSplit(character, lib, 'AccB', 0, false, settings);
  assert.deepEqual(split.pieces, [{ sheet: 'FG', n: 1 }, { sheet: 'TV', n: 1 }, { sheet: 'TV', n: 2 }]);
  assert.equal(split.count, 3);
  assert.equal(split.apart, true);
  character.split = { AccB: split };
  assert.deepEqual(layersForSheet('FG', character, lib).map((d) => d.item), ['AccB #1']);
  assert.deepEqual(layersForSheet('TV', character, lib).map((d) => d.item), ['AccB #2', 'AccB #3']);
  // Walk 2 moved: only the right horn moves.
  character.offsets['AccB #3'] = { sprite: { x: 2, y: 0 } };
  const { image } = composeSheet('TV', character, lib, new Map(), settings);
  const a = (x, y) => image.data[(y * image.width + x) * 4 + 3];
  assert.equal(a(10, 5), 255);
  assert.equal(a(36, 5), 0);
  assert.equal(a(38, 5), 255);
});

test('split per frame: a piece for every island of every frame, only in its frame', () => {
  const { lib, character } = accb();
  const split = makeSplit(character, lib, 'AccB', 0, true, settings);
  assert.equal(split.count, 1 + 12 * 2);
  assert.deepEqual(split.pieces[1], { sheet: 'TV', cell: '0,0', n: 1 });
  character.split = { AccB: split };
  // Only the first frame's left horn.
  const only = { ...character, only: 'AccB #2' };
  const { image } = composeSheet('TV', only, lib, new Map(), settings);
  const a = (x, y) => image.data[(y * image.width + x) * 4 + 3];
  assert.equal(a(10, 5), 255);
  assert.equal(a(36, 5), 0);
  assert.equal(a(48 + 10, 5), 0, 'not in the next frame');
});

test('a piece cut out by hand: its pixels leave the other pieces', () => {
  const { lib, character, walk } = accb();
  const sel = new Uint8Array(walk.width * walk.height);
  sel[5 * 144 + 10] = 1; // one pixel of the first frame's left horn
  assert.deepEqual([...decodeMask(encodeMask(sel), sel.length)].findIndex(Boolean), 5 * 144 + 10);
  const split = makeSplit(character, lib, 'AccB', 0, false, settings, [{ sheet: 'TV', w: 144, h: 192, rle: encodeMask(sel) }]);
  assert.equal(split.count, 4);
  character.split = { AccB: split };
  const draw = (only) => composeSheet('TV', { ...character, only }, lib, new Map(), settings).image;
  const at = (img, x, y) => img.data[(y * img.width + x) * 4 + 3];
  assert.equal(at(draw('AccB #4'), 10, 5), 255, 'the cut piece has it');
  assert.equal(at(draw('AccB #4'), 11, 5), 0, 'and nothing else');
  assert.equal(at(draw('AccB #2'), 10, 5), 0, 'Walk 1 lost it');
  assert.equal(at(draw('AccB #2'), 11, 5), 255);
});

test('hidden by hand (clip.cut): those pixels are not drawn on that picture', () => {
  const { lib, character, walk } = accb();
  const sel = new Uint8Array(walk.width * walk.height);
  sel[5 * 144 + 10] = 1;
  character.clip = { AccB: { cut: { TV: { w: 144, h: 192, rle: encodeMask(sel) } } } };
  const { image } = composeSheet('TV', character, lib, new Map(), settings);
  assert.equal(image.data[(5 * 144 + 10) * 4 + 3], 0);
  assert.equal(image.data[(5 * 144 + 11) * 4 + 3], 255);
});
