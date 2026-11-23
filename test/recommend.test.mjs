import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommendColours, preferredCategories } from '../src/gradients.js';

/** A flat gradient of one colour. */
function flat(id, rgb, category = 'common') {
  const colors = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) colors.set([(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, 255], i * 4);
  return { id, label: id, category, source: 'file', colors };
}

const gradients = [flat('blue', 0x3050a0), flat('red', 0xd06a60), flat('green', 0x40a040), flat('tan', 0xe8b890, 'skin'), flat('hair', 0x3a4fa0, 'hair')];

test('facial marks get a colour recommended, from the part name or the slot', () => {
  assert.deepEqual(preferredCategories('mark'), ['common', 'skin']);
  assert.equal(recommendColours('mark', gradients, ['p03']).ids[0], 'red');
  const tattoo = recommendColours('mark', gradients, ['tattoo', 'p03']);
  assert.equal(tattoo.ids[0], 'blue');
  assert.match(tattoo.why, /tattoo/);
  // Only colours of the fitting categories: the blue hair row is not offered for a mark.
  assert.ok(!tattoo.ids.includes('hair'));
});

test('other slots are only recommended a colour when a name hints at one', () => {
  assert.equal(recommendColours('clothing', gradients, ['p01']), null);
  assert.equal(recommendColours('clothing', gradients, ['green', 'robe']).ids[0], 'green');
});
