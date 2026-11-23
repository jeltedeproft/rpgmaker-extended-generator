import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colourGroups, makeMask, defaultGroupSlots } from '../src/automask.js';
import { createImage, recolorLayer } from '../src/recolor.js';
import { SLOT_BY_ID } from '../src/format.js';

/** A picture with a light and a dark shade of red on the left, and of blue on the right. */
function twoColours() {
  const img = createImage(4, 2);
  const put = (x, y, rgb) => img.data.set([...rgb, 255], (y * 4 + x) * 4);
  put(0, 0, [220, 60, 50]);
  put(0, 1, [110, 30, 25]); // dark red
  put(1, 0, [230, 70, 60]);
  put(2, 0, [50, 70, 220]);
  put(3, 1, [25, 35, 110]); // dark blue
  return img;
}

test('colours are grouped by colour, not by brightness', () => {
  const img = twoColours();
  assert.equal(colourGroups([img], 1).length, 1);
  const groups = colourGroups([img], 2);
  assert.equal(groups.length, 2);
  const mask = makeMask(img, groups, ['clothing', 'clothingSub2']);
  const at = (x, y) => {
    const i = (y * 4 + x) * 4;
    return (mask.data[i] << 16) | (mask.data[i + 1] << 8) | mask.data[i + 2];
  };
  // Light and dark red together, light and dark blue together, in two different slots.
  assert.equal(at(0, 0), at(0, 1));
  assert.equal(at(0, 0), at(1, 0));
  assert.equal(at(2, 0), at(3, 1));
  assert.notEqual(at(0, 0), at(2, 0));
  assert.ok([SLOT_BY_ID.get('clothing').rgb, SLOT_BY_ID.get('clothingSub2').rgb].includes(at(0, 0)));
  assert.equal(mask.data[(1 * 4 + 1) * 4 + 3], 0); // transparent stays out of the mask
  // More groups than colours: no empty groups.
  assert.ok(colourGroups([img], 4).length <= 4);
  assert.deepEqual(colourGroups([createImage(2, 2)], 2), []);
});

test('a made mask recolours the part; a group without a slot keeps its colours', () => {
  const img = twoColours();
  const groups = colourGroups([img], 2);
  const red = groups.findIndex((g) => (g.rgb >> 16) > (g.rgb & 255));
  const slots = red === 0 ? ['clothing', null] : [null, 'clothing'];
  const mask = makeMask(img, groups, slots);
  const green = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) green.set([0, 255 - i, 0, 255], i * 4);
  const out = recolorLayer(img, mask, null, (id) => (id === 'clothing' ? green : null), { flipGradient: false });
  assert.equal(out.data[0], 0); // red pixel is now green
  assert.ok(out.data[1] > 0);
  assert.deepEqual([...out.data.slice(8, 12)], [50, 70, 220, 255]); // blue kept
});

test('groups start in the part\'s own slots', () => {
  assert.deepEqual(defaultGroupSlots('Body', 1), ['skin']);
  assert.deepEqual(defaultGroupSlots('Clothing', 3), ['clothing', 'clothingSub1', 'clothingSub2']);
  assert.deepEqual(defaultGroupSlots('FrontHair', 2), ['hair', 'hairSub']);
  assert.deepEqual(defaultGroupSlots('Body', 2), ['skin', 'underwear']);
  assert.deepEqual(defaultGroupSlots('Hat', 2), ['clothing', 'clothing']);
});
