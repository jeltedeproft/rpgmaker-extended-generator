import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImage, matchSlot } from '../src/recolor.js';
import { guessSheet, shapeProfile, shapeSimilarity, rankParts, sampleRegion, nameWords, partsInName, maskColourShare, rankWithName, NAME_BONUS } from '../src/suggest.js';

const dot = (img, x, y, rgba = [200, 0, 0, 255]) => img.data.set(rgba, (y * img.width + x) * 4);

test('the sheet is guessed from the size, then from the frame grid', () => {
  assert.equal(guessSheet(144, 192).sheet, 'TV');
  assert.equal(guessSheet(576, 384).sheet, 'SV');
  assert.equal(guessSheet(192, 256).sheet, 'TV'); // 64px walk frames
  assert.equal(guessSheet(192, 64).sheet, 'TVD');
  assert.equal(guessSheet(864, 576).sheet, 'SV');
  assert.equal(guessSheet(160, 160).sheet, 'FG');
  assert.equal(guessSheet(32, 32).sheet, 'icon');
  assert.deepEqual(sampleRegion(144, 192, 'TV'), { x: 48, y: 0, w: 48, h: 48 });
});

test('parts are suggested by where their pixels sit', () => {
  const face = (y0, y1, x0 = 0, x1 = 144) => {
    const img = createImage(144, 144);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) dot(img, x, y);
    return img;
  };
  const refs = [
    { part: 'FrontHair', layer: '', cell: 'c1', profile: shapeProfile(face(0, 40), 'FG') },
    { part: 'Beard', layer: '', cell: 'c1', profile: shapeProfile(face(100, 140, 40, 104), 'FG') },
    { part: 'Glasses', layer: '', cell: 'c1', profile: shapeProfile(face(60, 75, 30, 114), 'FG') },
  ];
  const hat = shapeProfile(face(0, 36), 'FG');
  const ranked = rankParts(hat, refs);
  assert.equal(ranked[0].part, 'FrontHair');
  assert.ok(ranked[0].score > 0.8);
  assert.equal(rankParts(shapeProfile(face(58, 76, 28, 116), 'FG'), refs)[0].part, 'Glasses');
  assert.equal(shapeProfile(createImage(144, 144), 'FG'), null);
  assert.equal(shapeSimilarity(hat, hat), 1);
});

test('words in the file name name parts', () => {
  assert.deepEqual(nameWords('TV_LongBeard2-dark.png'), ['tv', 'long', 'beard', 'dark']);
  assert.deepEqual(partsInName('big_beard.png'), ['Beard']);
  assert.deepEqual(partsInName('RedCape.png'), ['Cloak']);
  assert.deepEqual(partsInName('fox_beastears.png', ['Ears', 'BeastEars']), ['BeastEars']);
  assert.deepEqual(partsInName('ponytail_hair.png'), ['RearHair']);
  assert.deepEqual(partsInName('face mask.png'), ['Face']); // "mask" alone names no part
  assert.deepEqual(partsInName('p05.png'), []);
});

test('a part the name names is ranked higher, even without a loaded one', () => {
  const full = new Float32Array(144).fill(1);
  const top = new Float32Array(144).fill(0).fill(1, 0, 36);
  const refs = [{ part: 'FrontHair', layer: '1', profile: top }, { part: 'Beard', layer: '1', profile: full }];
  const plain = rankWithName(top, refs, []);
  assert.equal(plain[0].part, 'FrontHair');
  const named = rankWithName(top, refs, ['Beard']);
  assert.equal(named[0].part, 'FrontHair'); // shape 1.0 still beats 0.25 + bonus
  assert.equal(named[1].part, 'Beard');
  assert.ok(named[1].named && Math.abs(named[1].score - (0.25 + NAME_BONUS)) < 1e-6);
  const unknown = rankWithName(top, refs, ['Tail']);
  assert.ok(unknown.some((r) => r.part === 'Tail' && r.score === NAME_BONUS));
});

test('colour masks are told apart from drawn parts by their colours', () => {
  const mask = createImage(4, 1);
  mask.data.set([0xfc, 0xcb, 0x0a, 255, 0xfc, 0xcb, 0x0a, 255, 255, 255, 255, 255, 0xae, 0x86, 0x82, 255]);
  assert.equal(maskColourShare(mask, matchSlot), 1);
  const drawn = createImage(4, 1);
  drawn.data.set([40, 40, 40, 255, 90, 80, 70, 255, 120, 110, 100, 255, 0, 0, 0, 0]);
  assert.equal(maskColourShare(drawn, matchSlot), 0);
  assert.equal(maskColourShare(createImage(2, 2), matchSlot), 0);
});
