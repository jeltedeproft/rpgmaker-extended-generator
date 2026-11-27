import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImage } from '../src/recolor.js';
import { normalizeStretch, isStretched, stretchFrames, lineY } from '../src/stretch.js';

/** One frame w x h, row y coloured y + 1 (red), solid. */
function rowsImage(w, h) {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.data.set([y + 1, 0, 0, 255], (y * w + x) * 4);
  return img;
}
const red = (img, x, y) => img.data[(y * img.width + x) * 4];
const column = (img, x) => Array.from({ length: img.height }, (_, y) => red(img, x, y));
const spec = (t) => normalizeStretch(t);

test('older taller settings are read as one line across', () => {
  const s = spec({ neck: 3, stretch: 150, width: 120, necks: { '1,0': 4 } });
  assert.deepEqual(s.rows, [{ y: 3, scale: 150, bend: [], at: { '1,0': 4 } }]);
  assert.equal(s.top, 100);
  assert.equal(s.width, 120);
  assert.ok(isStretched(s));
  assert.ok(!isStretched(spec({ rows: [{ y: 2, scale: 100 }] })));
});

test('a band can keep its size between two stretched ones (a belt)', () => {
  // Rows 1..6: head 1-2, body 3, belt 4, legs 5-6. Body and legs doubled, head and belt kept.
  const s = spec({ rows: [{ y: 2, scale: 200 }, { y: 3, scale: 100 }, { y: 4, scale: 200 }] });
  const { image, frame } = stretchFrames(rowsImage(2, 6), { w: 2, h: 6, cols: 1, rows: 1 }, s);
  assert.equal(frame.h, 9);
  assert.deepEqual(column(image, 0), [1, 2, 3, 3, 4, 5, 5, 6, 6]);
});

test('a body can be made shorter (below 100%)', () => {
  const s = spec({ rows: [{ y: 2, scale: 50 }] });
  const { image, frame } = stretchFrames(rowsImage(2, 6), { w: 2, h: 6, cols: 1, rows: 1 }, s);
  assert.equal(frame.h, 4);
  assert.deepEqual(column(image, 1), [1, 2, 3, 5]);
  // The head can be made smaller or bigger too.
  const big = stretchFrames(rowsImage(2, 4), { w: 2, h: 4, cols: 1, rows: 1 }, spec({ top: 200, rows: [{ y: 2, scale: 100 }] }));
  assert.deepEqual(column(big.image, 0), [1, 1, 2, 2, 3, 4]);
});

test('a bent line: the shoulders above the neck line are stretched with the body', () => {
  const row = { y: 3, scale: 200, bend: [[0, -1], [1, 0], [2, 0], [3, -1]] };
  assert.equal(lineY(row, '0,0', 0), 2);
  assert.equal(lineY(row, '0,0', 1.5), 3);
  assert.equal(lineY(row, '0,0', 3), 2);
  const { image } = stretchFrames(rowsImage(4, 5), { w: 4, h: 5, cols: 1, rows: 1 }, spec({ rows: [row] }));
  // Every column grows by as much (2 rows), so the head stays put and the feet on the bottom.
  assert.equal(image.height, 7);
  assert.deepEqual(column(image, 1), [1, 2, 3, 4, 4, 5, 5]); // middle: neck at 3
  assert.deepEqual(column(image, 0)[0], 1);
  assert.equal(column(image, 0)[6], 5);
  assert.equal(column(image, 0)[2], 3); // the shoulder row (2) is in the body there, stretched
});

test('lines down make bands wider or narrower; frames keep one size, centred', () => {
  const img = createImage(4, 1);
  for (let x = 0; x < 4; x++) img.data.set([x + 1, 0, 0, 255], x * 4);
  const s = spec({ cols: [{ x: 2, scale: 200 }] });
  const { image, frame } = stretchFrames(img, { w: 4, h: 1, cols: 1, rows: 1 }, s);
  assert.equal(frame.w, 6);
  assert.deepEqual(Array.from({ length: 6 }, (_, x) => red(image, x, 0)), [1, 2, 3, 3, 4, 4]);
});

test('each frame can have its own line; shorter frames stand on the bottom', () => {
  const two = createImage(4, 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) two.data.set([y + 1, 0, 0, 255], (y * 4 + x) * 4);
  const s = spec({ rows: [{ y: 2, scale: 200, at: { '1,0': 3 } }] });
  const { image, frame } = stretchFrames(two, { w: 2, h: 4, cols: 2, rows: 1 }, s);
  assert.equal(frame.h, 6);
  assert.deepEqual(column(image, 0), [1, 2, 3, 3, 4, 4]);
  assert.deepEqual(column(image, 2), [0, 1, 2, 3, 4, 4]);
});

test('a box makes an area bigger around its middle (the eyes), or smaller', () => {
  const img = createImage(6, 6);
  img.data.set([9, 0, 0, 255], (2 * 6 + 2) * 4); // a 2 x 2 "eye" at (2, 2)
  img.data.set([9, 0, 0, 255], (2 * 6 + 3) * 4);
  img.data.set([9, 0, 0, 255], (3 * 6 + 2) * 4);
  img.data.set([9, 0, 0, 255], (3 * 6 + 3) * 4);
  const frame = { w: 6, h: 6, cols: 1, rows: 1 };
  const big = stretchFrames(img, frame, spec({ boxes: [{ x: 1, y: 1, w: 4, h: 4, sx: 200, sy: 200 }] })).image;
  const solid = (im) => { let n = 0; for (let i = 3; i < im.data.length; i += 4) if (im.data[i]) n++; return n; };
  assert.equal(solid(big), 16); // 4 x 4 now, same middle
  assert.equal(big.data[(1 * 6 + 1) * 4 + 3], 255);
  const small = stretchFrames(img, frame, spec({ boxes: [{ x: 1, y: 1, w: 4, h: 4, sx: 50, sy: 50 }] })).image;
  assert.equal(solid(small), 1);
});

test('a part file smaller than the frame is cut at the same places (shift)', () => {
  // The character's frame is 2 rows taller than this part: its line at 4 is the part's row 2.
  const s = spec({ rows: [{ y: 4, scale: 200 }] });
  const { image } = stretchFrames(rowsImage(2, 4), { w: 2, h: 4, cols: 1, rows: 1 }, s, { x: 0, y: 2 });
  assert.deepEqual(column(image, 0), [1, 2, 3, 3, 4, 4]);
});
