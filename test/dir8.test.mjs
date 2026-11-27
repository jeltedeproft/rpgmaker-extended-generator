import { test } from 'node:test';
import assert from 'node:assert/strict';
import { split8, diagonalFallback, join8 } from '../src/dir8.js';
import { guessSheet } from '../src/suggest.js';
import { createImage } from '../src/recolor.js';

const rowsOf = (img) => [...Array(img.height).keys()].map((y) => img.data[y * img.width * 4]);

test('an 8-direction sheet: walk rows, then diagonals; 4-direction parts face the side', () => {
  const sheet = createImage(1, 8);
  for (let r = 0; r < 8; r++) sheet.data.set([r + 1, 0, 0, 255], r * 4);
  const { walk, diagonal } = split8(sheet);
  assert.deepEqual(rowsOf(walk), [1, 2, 3, 4]);
  assert.deepEqual(rowsOf(diagonal), [5, 6, 7, 8]);
  assert.deepEqual(rowsOf(join8(walk, diagonal)), [1, 2, 3, 4, 5, 6, 7, 8]);
  // Down-left and up-left show the left row, down-right and up-right the right row.
  assert.deepEqual(rowsOf(diagonalFallback(walk)), [2, 3, 2, 3]);
  assert.equal(guessSheet(144, 384).sheet, 'DIR8');
});
