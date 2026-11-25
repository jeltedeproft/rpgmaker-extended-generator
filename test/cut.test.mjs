import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessGrid, cellRect, cutPath, cropImage, hasPixels, drawnBounds } from '../src/cut.js';

test('the grid of a finished sheet is guessed from its size and name', () => {
  assert.deepEqual(guessGrid(576, 384, 'Actor1.png'), [4, 2]); // 8 characters of 3 x 4 frames of 48px
  assert.deepEqual(guessGrid(384, 256, 'People1.png'), [4, 2]); // VX Ace: 32px frames
  assert.deepEqual(guessGrid(144, 192, 'Hero.png'), [1, 1]);
  assert.deepEqual(guessGrid(576, 384, '$BigOne.png'), [1, 1]);
});

test('cells cover the picture with whole pixels', () => {
  assert.deepEqual(cellRect(576, 384, 4, 2, 3, 1), { x: 432, y: 192, w: 144, h: 192 });
  const widths = [0, 1, 2].map((c) => cellRect(100, 10, 3, 1, c, 0).w);
  assert.equal(widths.reduce((a, b) => a + b), 100);
});

test('cut pieces are named after the sheet and their place', () => {
  assert.equal(cutPath('chars/Actor1.png', 4, 2, 2, 1), 'chars/Actor1 (row 2, col 3).png');
  assert.equal(cutPath('Actor1.png', 1, 4, 0, 3), 'Actor1 (row 4).png');
  assert.equal(cutPath('Actor1.png', 3, 1, 1, 0), 'Actor1 (col 2).png');
});

test('a cell is cropped out, and an empty one is known', () => {
  const image = { width: 2, height: 2, data: new Uint8ClampedArray([1, 1, 1, 255, 2, 2, 2, 0, 3, 3, 3, 0, 4, 4, 4, 0]) };
  assert.deepEqual([...cropImage(image, { x: 1, y: 0, w: 1, h: 2 }).data], [2, 2, 2, 0, 4, 4, 4, 0]);
  assert.equal(hasPixels(cropImage(image, { x: 0, y: 0, w: 1, h: 1 })), true);
  assert.equal(hasPixels(cropImage(image, { x: 1, y: 0, w: 1, h: 2 })), false);
});

test('the drawn part of a picture is found', () => {
  const image = { width: 3, height: 2, data: new Uint8ClampedArray(24) };
  assert.equal(drawnBounds(image), null);
  image.data[(1 * 3 + 2) * 4 + 3] = 255;
  assert.deepEqual(drawnBounds(image), { x: 2, y: 1, w: 1, h: 1 });
});
