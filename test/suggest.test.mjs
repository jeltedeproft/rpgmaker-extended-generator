import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImage } from '../src/recolor.js';
import { guessSheet, shapeProfile, shapeSimilarity, rankParts, sampleRegion } from '../src/suggest.js';

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
