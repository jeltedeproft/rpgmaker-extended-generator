import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colourGroups, makeMask, defaultGroupSlots, outlineOrWhite, MAX_GROUPS, AUTO_SPREAD, iconMask, iconSilhouette, iconPart, isCloseUp, closeUpMask } from '../src/automask.js';
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

test('outlines and whites keep their colours; up to 8 groups, or as many as there are', () => {
  assert.ok(outlineOrWhite(0x101010) && outlineOrWhite(0xf4f4f4) && !outlineOrWhite(0x2c80cb) && !outlineOrWhite(0x808080));
  const groups = [{ rgb: 0xf6f6f6 }, { rgb: 0x2c80cb }, { rgb: 0x0c0c0c }];
  assert.deepEqual(defaultGroupSlots('Eyes', 3, groups), [null, 'eyes', null]);
  assert.deepEqual(defaultGroupSlots('Clothing', 1, [{ rgb: 0x101010 }]), ['clothing']); // only black: recoloured
  // Eyes: white, blue iris, dark pupil, black outline, pink lid: five groups.
  const img = createImage(5, 1);
  [[250, 250, 250], [40, 110, 220], [20, 30, 90], [8, 8, 8], [230, 150, 160]].forEach((c, x) => img.data.set([...c, 255], x * 4));
  assert.equal(MAX_GROUPS, 8);
  assert.equal(colourGroups([img], MAX_GROUPS).length, 5);
  assert.ok(colourGroups([img], MAX_GROUPS, AUTO_SPREAD, true).length >= 3);
  assert.equal(colourGroups([twoColours()], MAX_GROUPS, AUTO_SPREAD, true).length, 2);
});

test('a Variation icon gets the mask colours its colours have in the part', () => {
  const image = twoColours();
  const groups = colourGroups([image], 2);
  const red = groups.findIndex((g) => (g.rgb >> 16) > (g.rgb & 255));
  const mask = makeMask(image, groups, red === 0 ? ['clothing', null] : [null, 'clothing']);
  // The icon: the light red (exact), a red a bit off (drawn smaller), and the blue.
  const icon = createImage(3, 1);
  icon.data.set([220, 60, 50, 255, 214, 66, 54, 255, 50, 70, 220, 255]);
  const out = iconMask(icon, [{ image, mask }]);
  const at = (x) => (out.data[x * 4] << 16) | (out.data[x * 4 + 1] << 8) | out.data[x * 4 + 2];
  assert.equal(at(0), SLOT_BY_ID.get('clothing').rgb);
  assert.equal(at(1), SLOT_BY_ID.get('clothing').rgb);
  assert.equal(out.data[2 * 4 + 3], 0); // blue is kept as drawn in the part, so on the icon too
  assert.equal(iconMask(icon, []), null);
});

test('a part is cut out of its Variation icon and laid on the shared figure', () => {
  const icon = (pixels) => ({ width: 2, height: 2, data: new Uint8ClampedArray(pixels.flat()) });
  const grey = [90, 90, 90, 255];
  const none = [0, 0, 0, 0];
  const hair = [250, 200, 10, 255];
  const hat = [30, 30, 200, 255];
  // Three icons on the same figure (left column grey), each with its own part on the right.
  const icons = [icon([grey, hair, grey, none]), icon([grey, none, grey, hat]), icon([grey, none, grey, none])];
  const figure = iconSilhouette(icons);
  assert.deepEqual([...figure.data], [...grey, ...none, ...grey, ...none]);
  const part = iconPart(icons[0], figure);
  assert.deepEqual([...part.data], [...none, ...hair, ...none, ...none]);
  // Recoloured: the part's pixels come from the recoloured icon.
  const red = icon([[1, 1, 1, 255], [200, 0, 0, 255], [1, 1, 1, 255], none]);
  assert.deepEqual([...iconPart(icons[0], figure, red).data.slice(4, 8)], [200, 0, 0, 255]);
  assert.equal(iconPart({ width: 3, height: 1, data: new Uint8ClampedArray(12) }, figure), null);
  // Drawn on the figure, or a close-up: covering the figure, or a big picture beside it.
  assert.equal(isCloseUp(icon([grey, none, grey, none]), figure), false);
  assert.equal(isCloseUp(icon([hat, hat, hat, hat]), figure), true);
  const wide = (pixels) => ({ width: 4, height: 1, data: new Uint8ClampedArray(pixels.flat()) });
  const smallFigure = wide([grey, grey, none, none]);
  assert.equal(isCloseUp(wide([grey, grey, hat, none]), smallFigure), false); // a wing: a bit beside
  assert.equal(isCloseUp(wide([grey, grey, hat, hat]), smallFigure), true); // as big as the figure
});

test('a close-up icon keeps the face it is drawn on as drawn', () => {
  const wide = (pixels) => ({ width: 4, height: 1, data: new Uint8ClampedArray(pixels.flat()) });
  const skin = [240, 190, 160, 255];
  const glow = [200, 170, 150, 255];
  const lips = [200, 40, 60, 255];
  const slot = [249, 193, 157, 255];
  // A grey face, a skin glow every mouth icon has, and the mouth itself.
  const icon = wide([[90, 90, 90, 255], glow, lips, skin]);
  const mask = wide([slot, slot, slot, slot]);
  const backdrop = wide([[90, 90, 90, 255], glow, glow, glow]);
  const out = closeUpMask(icon, mask, backdrop);
  assert.deepEqual([0, 1, 2, 3].map((x) => out.data[x * 4 + 3]), [0, 0, 255, 255]);
  // Without a backdrop (two icons): only the greys stay as drawn.
  assert.deepEqual([0, 1, 2, 3].map((x) => closeUpMask(icon, mask, null).data[x * 4 + 3]), [0, 255, 255, 255]);
});
