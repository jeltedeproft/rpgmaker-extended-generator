import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImage, transformFrames, swapFrameRows, isTransformed } from '../src/recolor.js';
import { composeSheet, partOffset, transformSheet } from '../src/compose.js';
import { createLibrary, addPack } from '../src/parse.js';

const alpha = (img, x, y) => img.data[(y * img.width + x) * 4 + 3];
const dot = (img, x, y, rgba = [200, 0, 0, 255]) => img.data.set(rgba, (y * img.width + x) * 4);

test('mirror and flip swap sides inside each frame, around its centre', () => {
  // Two 4x3 frames, each with a dot near the top-left and one in the middle row.
  const img = createImage(8, 3);
  for (const fx of [0, 4]) {
    dot(img, fx, 0);
    dot(img, fx + 3, 2);
  }
  const mirrored = transformFrames(img, { flipX: true });
  for (const fx of [0, 4]) {
    assert.equal(alpha(mirrored, fx + 3, 0), 255);
    assert.equal(alpha(mirrored, fx, 2), 255);
    assert.equal(alpha(mirrored, fx, 0), 0);
  }
  // Without a frame the whole image is one frame.
  assert.equal(alpha(transformFrames(img, { flipX: true }, null), 7, 0), 255);
  const framed = transformFrames(img, { flipY: true }, { w: 4, h: 3 });
  assert.equal(alpha(framed, 0, 2), 255);
  assert.equal(alpha(framed, 3, 0), 255);
});

test('resizing grows a part around its centre and keeps it inside the frame', () => {
  const img = createImage(10, 5);
  dot(img, 2, 2); // a single pixel in the middle of the first 5x5 frame
  dot(img, 7, 2); // and of the second
  const big = transformFrames(img, { scale: 300 }, { w: 5, h: 5 });
  for (const fx of [0, 5]) {
    for (let y = 1; y <= 3; y++) for (let x = fx + 1; x <= fx + 3; x++) assert.equal(alpha(big, x, y), 255, `${x},${y}`);
    assert.equal(alpha(big, fx, 0), 0);
  }
  assert.equal(transformFrames(img, { scale: 100, rot: 0 }), img);
  assert.equal(isTransformed({ scale: 100 }), false);
  assert.equal(isTransformed({ scale: 90 }), true);
});

test('swapping frame rows swaps whole rows', () => {
  const img = createImage(2, 4);
  dot(img, 0, 1);
  const out = swapFrameRows(img, { w: 2, h: 1 }, 1, 2);
  assert.equal(alpha(out, 0, 2), 255);
  assert.equal(alpha(out, 0, 1), 0);
});

function walkLibrary() {
  const lib = createLibrary();
  addPack(lib, 'P', [
    { path: 'TV/Male/TV_Body_p01.png', src: 'body' },
    { path: 'TV/Male/TV_AccA_p01.png', src: 'acc' },
  ]);
  // 3x4 frames of 2x2: the body fills every frame; the accessory is one pixel in the
  // top-left of the left-facing row (row 1) only.
  const body = createImage(6, 8);
  for (let i = 0; i < body.data.length; i += 4) body.data.set([0, 0, 0, 255], i);
  const acc = createImage(6, 8);
  for (const col of [0, 1, 2]) dot(acc, col * 2, 2);
  const pixels = { body, acc };
  for (const v of lib.variants.values()) for (const l of v.layers) l.base.pixels = pixels[l.base.src];
  return lib;
}

test('mirroring a walk part flips each frame and swaps the left and right rows', () => {
  const lib = walkLibrary();
  const character = { bodyType: 'Male', parts: { Body: 'P/Male/Body/p01', AccA: 'P/Male/AccA/p01' }, colors: {}, offsets: { AccA: { sprite: { flipX: true } } } };
  const { image } = composeSheet('TV', character, lib, new Map(), {});
  const red = (x, y) => image.data[(y * image.width + x) * 4];
  // The accessory now sits in the right-facing row (row 2, y 4..5), mirrored: top-right pixel.
  // (A one-pixel part mirrors onto itself around its own centre.)
  assert.equal(red(0, 4), 200);
  assert.equal(red(0, 2), 0);
});

test('a piece adds its item\'s position: sizes multiply, mirrors cancel out', () => {
  const character = { offsets: { Eyes: { face: { x: 1, scale: 200, flipX: true } }, 'Eyes #1': { face: { x: 2, scale: 50, flipX: true, rot: 10 } } } };
  const o = partOffset(character, 'Eyes #1', 'FG');
  assert.deepEqual(o, { x: 3, y: 0, rot: 10, scale: 100, flipX: false, flipY: false });
});

test('whole-image transforms move and mirror every frame', () => {
  const img = createImage(4, 2);
  dot(img, 0, 0);
  dot(img, 2, 0);
  const out = transformSheet(img, 'TVD', { w: 2, h: 2, rows: 1 }, { x: 0, y: 1, rot: 0, scale: 100, flipX: true, flipY: false });
  assert.equal(alpha(out, 1, 1), 255);
  assert.equal(alpha(out, 3, 1), 255);
  assert.equal(alpha(out, 0, 0), 0);
  const same = transformSheet(img, 'FG', null, { x: 0, y: 0, rot: 0, scale: 100, flipX: false, flipY: false });
  assert.equal(same, img);
});
