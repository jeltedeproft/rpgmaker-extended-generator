import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packCharacters } from '../src/multi.js';
import { createImage } from '../src/recolor.js';

const filled = (w, h, red) => {
  const img = createImage(w, h);
  for (let i = 0; i < w * h; i++) img.data.set([red, 0, 0, 255], i * 4);
  return img;
};

test('8 characters in one picture: 4 across, 2 down, in reading order', () => {
  const sheets = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => filled(6, 8, n)); // 3 x 4 frames of 2 x 2
  const out = packCharacters(sheets, { cols: 3, rows: 4 });
  assert.deepEqual([out.width, out.height], [24, 16]);
  const red = (x, y) => out.data[(y * out.width + x) * 4];
  assert.deepEqual([red(0, 0), red(6, 0), red(18, 7), red(0, 8), red(23, 15)], [1, 2, 4, 5, 8]);
});

test('a smaller character stands on the bottom of each frame, centred; empty places stay empty', () => {
  const big = filled(12, 16, 9); // frames of 4 x 4
  const small = filled(6, 8, 5); // frames of 2 x 2
  const out = packCharacters([big, small], { cols: 3, rows: 4 });
  const at = (x, y) => [out.data[(y * out.width + x) * 4], out.data[(y * out.width + x) * 4 + 3]];
  // Second place starts at x = 12; its first frame is 4 x 4 with the 2 x 2 frame at (1, 2).
  assert.deepEqual(at(13, 2), [5, 255]);
  assert.deepEqual(at(13, 1), [0, 0]);
  assert.deepEqual(at(12, 3), [0, 0]);
  assert.deepEqual(at(30, 20), [0, 0]);
  assert.equal(packCharacters([null, null]), null);
});
