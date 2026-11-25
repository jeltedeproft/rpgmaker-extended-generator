import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommendColours, preferredCategories, uniqueGradients } from '../src/gradients.js';

/** A flat gradient of one colour. */
function flat(id, rgb, category = 'common') {
  const colors = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) colors.set([(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, 255], i * 4);
  return { id, label: id, category, source: 'file', colors };
}

const gradients = [flat('blue', 0x3050a0), flat('red', 0xd06a60), flat('green', 0x40a040), flat('tan', 0xe8b890, 'skin'), flat('hair', 0x3a4fa0, 'hair')];

test('only exact gradient rows collapse, with selected IDs and suggested categories preserved', () => {
  const first = flat('Pack/grad_common#0', 0xaabbcc);
  const copy = flat('Pack2/grad_skin#2', 0xaabbcc, 'skin');
  const different = flat('Pack/grad_common#1', 0xaabbcc);
  different.colors[1022]++;
  const shift = { ...copy, id: 'source-adjust', shiftSource: true, adjust: { hue: 20 } };
  const rows = [first, copy, different, shift];
  assert.deepEqual(uniqueGradients(rows), [first, different, shift]);
  assert.deepEqual(uniqueGradients(rows, undefined, ['skin']), [copy, different, shift]);
  assert.deepEqual(uniqueGradients(rows, first.id, ['skin']), [first, different, shift]);
  assert.deepEqual(uniqueGradients(rows, copy.id), [copy, different, shift]);
  // A copy you made of a colour is not folded into it.
  const yours = { ...first, id: 'custom/x', source: 'custom' };
  assert.deepEqual(uniqueGradients([first, yours]), [first, yours]);
});

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
