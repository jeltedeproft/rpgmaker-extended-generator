import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImage } from '../src/recolor.js';
import { selectByColour, growSelection, keepSelected, removeSelected, nearestOutside, selectedCount } from '../src/extract.js';

const SKIN = [240, 200, 170, 255];
const EYE = [20, 40, 200, 255];

/** A 6 x 3 "head": skin, with two blue eyes at (1, 1) and (4, 1), and a transparent corner. */
function head() {
  const img = createImage(6, 3);
  for (let i = 0; i < 18; i++) img.data.set(SKIN, i * 4);
  img.data.set(EYE, (1 * 6 + 1) * 4);
  img.data.set(EYE, (1 * 6 + 4) * 4);
  img.data.fill(0, 0, 4);
  return img;
}
const px = (img, x, y) => Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

test('a colour is picked everywhere, or only where it touches the clicked pixel', () => {
  const img = head();
  assert.equal(selectedCount(selectByColour(img, [{ x: 1, y: 1 }])), 2);
  assert.equal(selectedCount(selectByColour(img, [{ x: 1, y: 1 }], { touching: true })), 1);
  // Close colours with a tolerance; transparent pixels never.
  img.data.set([25, 45, 205, 255], (2 * 6 + 2) * 4);
  assert.equal(selectedCount(selectByColour(img, [{ x: 1, y: 1 }])), 2);
  assert.equal(selectedCount(selectByColour(img, [{ x: 1, y: 1 }], { tolerance: 8 })), 3);
  assert.equal(selectedCount(selectByColour(img, [{ x: 0, y: 0 }])), 0);
});

test('picking by a colour mask: the mask says which pixels are the eyes', () => {
  const img = createImage(3, 1);
  img.data.set([...SKIN, ...SKIN, ...SKIN]);
  const mask = createImage(3, 1);
  mask.data.set([255, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255]); // skin red, eye blue
  const sel = selectByColour(img, [{ x: 1, y: 0 }], { by: mask });
  assert.deepEqual(Array.from(sel), [0, 1, 0]);
});

test('extracting keeps the picked pixels; what is left can be filled from around the hole', () => {
  const img = head();
  const sel = selectByColour(img, [{ x: 1, y: 1 }]);
  const eyes = keepSelected(img, sel);
  assert.deepEqual(px(eyes, 1, 1), EYE);
  assert.equal(px(eyes, 0, 1)[3], 0);
  const holes = removeSelected(img, sel);
  assert.equal(px(holes, 4, 1)[3], 0);
  const eyeless = removeSelected(img, sel, { fill: true });
  assert.deepEqual(px(eyeless, 1, 1), SKIN);
  assert.deepEqual(px(eyeless, 4, 1), SKIN);
  assert.equal(px(eyeless, 0, 0)[3], 0); // still transparent where it was
});

test('a colour mask is filled the same way as its picture', () => {
  const img = head();
  const mask = createImage(6, 3);
  for (let i = 0; i < 18; i++) mask.data.set([255, 0, 0, 255], i * 4);
  mask.data.set([0, 0, 255, 255], (1 * 6 + 1) * 4);
  const sel = selectByColour(img, [{ x: 1, y: 1 }], { touching: true });
  const from = nearestOutside(img, sel);
  assert.deepEqual(px(removeSelected(mask, sel, { fill: true, from }), 1, 1), [255, 0, 0, 255]);
});

test('a selection grows and shrinks by whole pixels', () => {
  const sel = new Uint8Array(25);
  sel[12] = 1; // the middle of 5 x 5
  const grown = growSelection(sel, 5, 5, 1);
  assert.equal(selectedCount(grown), 5);
  assert.equal(selectedCount(growSelection(grown, 5, 5, -1)), 1);
});
