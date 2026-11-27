import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cropBox, cropScale } from '../src/crop.js';
import { createImage } from '../src/recolor.js';

test('the crop box keeps the output shape and stays inside the picture', () => {
  assert.deepEqual(cropBox(null, 600, 900, 144, 144), { x: 228, y: 0, w: 144, h: 144 });
  assert.deepEqual(cropBox({ x: 500, y: 850, w: 200 }, 600, 900, 144, 144), { x: 400, y: 700, w: 200, h: 200 });
  assert.deepEqual(cropBox({ x: 0, y: 0, w: 5000 }, 600, 900, 100, 50), { x: 0, y: 0, w: 600, h: 300 });
});

test('shrinking averages the covered pixels, by their alpha; growing repeats them', () => {
  const img = createImage(4, 1);
  img.data.set([200, 0, 0, 255, 0, 0, 200, 0, 100, 100, 100, 255, 100, 100, 100, 255], 0);
  const small = cropScale(img, { x: 0, y: 0, w: 4, h: 1 }, 2, 1);
  // Left half: one red pixel and one see-through blue one: red, at half alpha.
  assert.deepEqual([...small.data.subarray(0, 4)], [200, 0, 0, 128]);
  assert.deepEqual([...small.data.subarray(4, 8)], [100, 100, 100, 255]);
  const big = cropScale(img, { x: 0, y: 0, w: 2, h: 1 }, 4, 2);
  assert.deepEqual([...big.data.subarray(0, 4)], [200, 0, 0, 255]);
  assert.deepEqual([...big.data.subarray(4, 8)], [200, 0, 0, 255]);
});
