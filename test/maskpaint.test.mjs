import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImage } from '../src/recolor.js';
import { SLOT_BY_ID } from '../src/format.js';
import { codeOf, emptyEdits, hasEdits, encodeEdits, decodeEdits, paintBrush, paintLine, paintColour, applyEdits, KEEP, NOT_PAINTED } from '../src/maskpaint.js';

test('painted edits survive saving as text', () => {
  const edits = emptyEdits(6, 4);
  assert.ok(!hasEdits(edits));
  paintBrush(edits, 2, 1, 1, codeOf('hair'));
  paintLine(edits, 0, 3, 5, 3, 0, KEEP);
  assert.ok(hasEdits(edits));
  const text = encodeEdits(edits);
  assert.ok(text.length < 80, text);
  assert.deepEqual([...decodeEdits(text).codes], [...edits.codes]);
  assert.equal(decodeEdits('6x4:3*1'), null); // too short
  assert.equal(edits.codes[0], NOT_PAINTED);
});

test('painting puts slot colours over the mask, or takes them away', () => {
  const image = createImage(3, 1);
  image.data.set([200, 50, 50, 255, 0, 0, 0, 0, 202, 52, 48, 255]);
  const mask = createImage(3, 1);
  mask.data.set([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const edits = emptyEdits(3, 1);
  // All of the red: both red pixels (the middle one is not drawn).
  assert.equal(paintColour(edits, image, 0, 0, codeOf('cloak')), 2);
  let out = applyEdits(mask, edits, 3, 1);
  const rgb = SLOT_BY_ID.get('cloak').rgb;
  assert.deepEqual([...out.data.slice(0, 4)], [rgb >> 16, (rgb >> 8) & 255, rgb & 255, 255]);
  assert.equal(out.data[7], 0);
  paintBrush(edits, 2, 0, 0, KEEP);
  out = applyEdits(mask, edits, 3, 1);
  assert.equal(out.data[11], 0);
  // Nothing under it: painting alone makes the mask.
  assert.equal(applyEdits(null, edits, 3, 1).data[3], 255);
});
