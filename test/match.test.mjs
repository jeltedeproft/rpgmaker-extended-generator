import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colourMean, matchAdjust, adjustRgb } from '../src/gradients.js';

test('matching moves one colour towards another, outlines barely count', () => {
  const red = [[200, 40, 40], [150, 30, 30], [10, 10, 10], [12, 8, 8]];
  const blue = [[60, 80, 200], [40, 60, 160]];
  const from = colourMean(red);
  const to = colourMean(blue);
  assert.ok(Math.abs(from.hue) < 2 || Math.abs(from.hue - 360) < 2, `${from.hue}`);
  const shift = matchAdjust(from, to);
  const moved = colourMean(red.slice(0, 2).map(([r, g, b]) => adjustRgb(r, g, b, shift)));
  assert.ok(Math.abs(moved.hue - to.hue) < 4, `${moved.hue} vs ${to.hue}`);
  assert.ok(Math.abs(moved.value - to.value) < 0.08);
  // Half way, and grey has no hue to turn.
  assert.ok(Math.abs(matchAdjust(from, to, 0.5).hue) < Math.abs(shift.hue));
  assert.equal(matchAdjust(colourMean([[128, 128, 128]]), to).hue, 0);
  assert.equal(colourMean([]), null);
});
