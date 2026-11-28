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

test('turned diagonals: the front turned toward the side, one outline, never a second head', async () => {
  const { diagonalsOf } = await import('../src/dir8.js');
  const { createImage } = await import('../src/recolor.js');
  // 1 column, 4 rows of 20 x 20: down is a red dot in the middle; left is a blue block far right,
  // where the front has nothing.
  const walk = createImage(20, 80);
  const dot = (row, x, rgb) => walk.data.set([...rgb, 255], ((row * 20 + 10) * 20 + x) * 4);
  dot(0, 10, [255, 0, 0]);
  for (let x = 15; x < 19; x++) dot(1, x, [0, 0, 255]);
  const d = diagonalsOf(walk, 'turned');
  const at = (row, x) => [...d.data.subarray(((row * 20 + 10) * 20 + x) * 4, ((row * 20 + 10) * 20 + x) * 4 + 4)];
  const red = [...Array(20).keys()].filter((x) => at(0, x)[0] === 255);
  const blue = [...Array(20).keys()].filter((x) => at(0, x)[2] === 255);
  assert.ok(red.length && red.every((x) => x < 10), `the face moves left: ${red}`);
  assert.deepEqual(blue, [], 'the side picture adds nothing outside the outline');
  // Side view: down-left is just the left picture.
  assert.deepEqual([...diagonalsOf(walk, 'side').data.subarray(0, 20 * 20 * 4)], [...walk.data.subarray(20 * 20 * 4, 2 * 20 * 20 * 4)]);
});

test('turned diagonals: face parts (eyes, mouth...) move further toward the turn than the head', async () => {
  const { diagonalsOf } = await import('../src/dir8.js');
  const { createImage } = await import('../src/recolor.js');
  const walk = createImage(20, 80);
  walk.data.set([255, 0, 0, 255], ((10) * 20 + 10) * 4);
  const leftmost = (img) => [...Array(20).keys()].find((x) => img.data[(10 * 20 + x) * 4 + 3]);
  for (const mode of ['turned', 'more']) {
    assert.ok(leftmost(diagonalsOf(walk, mode, true)) < leftmost(diagonalsOf(walk, mode)), mode);
  }
});

test('turned diagonals: going up, only head parts show their side; the body does not', async () => {
  const { diagonalsOf } = await import('../src/dir8.js');
  const { createImage } = await import('../src/recolor.js');
  // Back row: a grey block; left row: a blue block in the same place.
  const walk = createImage(20, 80);
  for (let y = 2; y < 10; y++) for (let x = 2; x < 18; x++) {
    walk.data.set([128, 128, 128, 255], ((60 + y) * 20 + x) * 4);
    walk.data.set([0, 0, 255, 255], ((20 + y) * 20 + x) * 4);
  }
  // Only the head's rows (above the neck): below it the body comes from the side picture.
  const blue = (img) => { let n = 0; for (let i = 40 * 20 * 4; i < 50 * 20 * 4; i += 4) if (img.data[i + 2] === 255 && !img.data[i]) n++; return n; };
  assert.equal(blue(diagonalsOf(walk, 'turned')), 0, 'body: just its back');
  assert.ok(blue(diagonalsOf(walk, 'turned', 'head')) > 0, 'head: its side peeks out');
});

test('turned diagonals: below the neck, the body of the side picture', async () => {
  const { diagonalsOf } = await import('../src/dir8.js');
  const { createImage } = await import('../src/recolor.js');
  const walk = createImage(20, 80);
  // The left picture: a green leg at row 16, x 6.
  walk.data.set([0, 255, 0, 255], ((20 + 16) * 20 + 6) * 4);
  const d = diagonalsOf(walk, 'turned');
  const row = [...Array(20).keys()].filter((x) => d.data[((16) * 20 + x) * 4 + 1] === 255);
  assert.equal(row.length, 1, 'down-left has the leg of the left picture');
});
