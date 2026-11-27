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

test('Scale2x rounds off a stair step instead of blowing up square pixels', async () => {
  const { scale2x, createImage } = await import('../src/recolor.js');
  // A 2x2 diagonal: top-left and bottom-right drawn.
  const img = createImage(2, 2);
  img.data.set([255, 0, 0, 255], 0);
  img.data.set([255, 0, 0, 255], 12);
  const up = scale2x(img);
  assert.equal(up.width, 4);
  const alpha = (x, y) => up.data[(y * 4 + x) * 4 + 3];
  // The corners of the drawn pixels stay, the diagonal is filled in between them.
  assert.equal(alpha(0, 0), 255);
  assert.equal(alpha(3, 3), 255);
  assert.equal(alpha(2, 1), 255);
  assert.equal(alpha(3, 0), 0);
});

test('smooth transforms sample the Scale2x picture; a plain flip stays exact', async () => {
  const { transformFrames, createImage } = await import('../src/recolor.js');
  const img = createImage(16, 16);
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) img.data.set([0, 0, 255, 255], (y * 16 + x) * 4);
  const turned = transformFrames(img, { rot: 30, smooth: true });
  const plain = transformFrames(img, { rot: 30 });
  const count = (i) => i.data.filter((_, k) => k % 4 === 3 && i.data[k]).length;
  assert.ok(Math.abs(count(turned) - count(plain)) < 12);
  const flipped = transformFrames(img, { flipX: true, smooth: true });
  assert.deepEqual([...flipped.data], [...transformFrames(img, { flipX: true }).data]);
});

test('make room grows sprite frames so an enlarged part is not cut off', async () => {
  const { roomNeeded } = await import('../src/compose.js');
  const frame = { w: 48, h: 48, cols: 3, rows: 4 };
  const draws = [{ item: 'FrontHair' }];
  assert.equal(roomNeeded({ offsets: {} }, draws, 'TV', frame), 0);
  assert.equal(roomNeeded({ offsets: { FrontHair: { sprite: { scale: 150 } } } }, draws, 'TV', frame), 12);
  assert.equal(roomNeeded({ offsets: { FrontHair: { sprite: { y: 5 } } } }, draws, 'TV', frame), 5);
  // Portraits have no frame grid: only "Fit into RPG Maker's size" gives them one (and room).
  assert.equal(roomNeeded({ offsets: { FrontHair: { face: { scale: 200 } } } }, draws, 'FG', null), 0);
  assert.ok(roomNeeded({ offsets: { FrontHair: { face: { y: 20 } } } }, draws, 'FG', { w: 144, h: 144, cols: 1, rows: 1 }) >= 20);
});

test('fit into RPG Maker size shrinks frames that stick out back to the frame size, feet on the bottom', async () => {
  const { fitInto } = await import('../src/compose.js');
  // 2 x 1 frames of 8x8 (grown from 4x4), into 4x4 frames: halved.
  const image = createImage(16, 8);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) image.data.set([100, 50, 0, 255], (y * 16 + x) * 4);
  const out = fitInto(image, { w: 8, h: 8, cols: 2, rows: 1 }, { w: 4, h: 4 });
  assert.equal(out.width, 8);
  assert.equal(out.height, 4);
  assert.deepEqual([...out.data.subarray(0, 4)], [100, 50, 0, 255]);
  // A frame only too tall keeps its proportions: centred, standing on the bottom.
  const tall = createImage(4, 8);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) tall.data.set([9, 9, 9, 255], (y * 4 + x) * 4);
  const fitted = fitInto(tall, { w: 4, h: 8, cols: 1, rows: 1 }, { w: 4, h: 4 });
  assert.equal(alpha(fitted, 0, 3), 0); // 2 px wide in the middle
  assert.equal(alpha(fitted, 1, 3), 255);
  assert.equal(alpha(fitted, 1, 0), 255);
});

test('a portrait with columns and rows repeats the face in every cell', async () => {
  const { composeSheet } = await import('../src/compose.js');
  const library = createLibrary();
  const face = createImage(4, 4);
  face.data.set([200, 100, 50, 255], 0);
  addPack(library, 'k', [{ path: 'Face/Male/FG_Body_p01.png', src: null }]);
  const v = [...library.variants.values()][0];
  v.layers[0].base.pixels = face;
  const character = { bodyType: 'Male', parts: { Body: v.id }, colors: {}, offsets: {}, split: {} };
  const image = composeSheet('FG', character, library, new Map(), { templates: { FG: { cols: 3, rows: 2 } } }).image;
  assert.equal(image.width, 12);
  assert.equal(image.height, 8);
  assert.equal(alpha(image, 8, 4), 255); // the face's corner pixel in the last cell
});

test('taller sprites keep the head and stretch the body below the neck, frame by frame', async () => {
  const { tallerFrames } = await import('../src/compose.js');
  // 2 x 2 frames of 2 x 4: row y of each frame is coloured y * 10 (+ 100 in the second row of frames).
  const frame = { w: 2, h: 4, cols: 2, rows: 2 };
  const image = createImage(4, 8);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) image.data.set([(y % 4) * 10 + (y >= 4 ? 100 : 0), 0, 0, 255], (y * 4 + x) * 4);
  const { image: out, frame: f } = tallerFrames(image, frame, 2, 200);
  assert.deepEqual([f.w, f.h, f.cols, f.rows], [2, 6, 2, 2]);
  assert.deepEqual([out.width, out.height], [4, 12]);
  const red = (x, y) => out.data[(y * out.width + x) * 4];
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((y) => red(0, y)), [0, 10, 20, 20, 30, 30]); // head kept, body doubled
  assert.deepEqual([6, 11].map((y) => red(3, y)), [100, 130]); // second row of frames, feet at the bottom
});

test('a whole image can be stretched: width and height sizes of their own', () => {
  const img = createImage(8, 8);
  dot(img, 5, 5);
  dot(img, 2, 2); // the drawing's middle is the frame's middle
  const wide = transformFrames(img, { scale: 100, scaleY: 50 });
  assert.ok(isTransformed({ scale: 100, scaleY: 50 }));
  assert.ok(!isTransformed({ scale: 100, scaleY: 100 }));
  // Half as tall: the dots move towards the middle row, and stay in their columns.
  const found = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (alpha(wide, x, y)) found.push([x, y]);
  assert.ok(found.some(([x, y]) => x === 5 && y === 4) && found.every(([x]) => x === 2 || x === 5), JSON.stringify(found));
});

test('make room keeps the feet on the frame bottom and only the room the drawing needs', async () => {
  const { fitRoom } = await import('../src/compose.js');
  const { createImage } = await import('../src/recolor.js');
  // 2 x 1 frames of 4x4 inside, made 3 px of room on every side: 10x10 frames.
  const frame = { w: 10, h: 10, cols: 2, rows: 1 };
  const image = createImage(20, 10);
  const dot = (x, y) => image.data.set([9, 9, 9, 255], (y * 20 + x) * 4);
  dot(3, 6); // the feet: bottom-left of the inner frame
  dot(3, 1); // a hat 2 px above the inner frame
  dot(10 + 1, 4); // in the second frame: 2 px left of the inner frame
  const { image: out, frame: f } = fitRoom(image, frame, 3, { w: 4, h: 4 });
  assert.deepEqual([f.w, f.h, f.cols, f.rows], [8, 6, 2, 1]); // sides 2 each, 2 on top, none below
  assert.equal(out.width, 16);
  assert.equal(out.height, 6);
  assert.equal(out.width % f.cols, 0);
  const alpha = (x, y) => out.data[(y * out.width + x) * 4 + 3];
  assert.equal(alpha(3 - 3 + 2, 5), 255); // the feet are on the bottom row
  assert.equal(alpha(2, 0), 255); // the hat on the top row
  assert.equal(alpha(8 + 0, 3), 255); // the second frame's dot at its left edge
});

test('taller sprites: a frame can have its own neck line, and the body can get wider', async () => {
  const { tallerFrames } = await import('../src/compose.js');
  // 2 frames of 4 x 4 side by side; row y is coloured y * 10 + 10.
  const frame = { w: 4, h: 4, cols: 2, rows: 1 };
  const image = createImage(8, 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) image.data.set([y * 10 + 10, 0, 0, 255], (y * 8 + x) * 4);
  // First frame: neck at 2 (2 body rows -> 4); second: its own neck at 3 (1 body row -> 2).
  const { image: out, frame: f } = tallerFrames(image, frame, 2, 200, { necks: { '1,0': 3 } });
  assert.equal(f.h, 6);
  const red = (x, y) => out.data[(y * out.width + x) * 4];
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((y) => red(0, y)), [10, 20, 30, 30, 40, 40]);
  // The second frame (5 rows) stands on the bottom: its top row is empty.
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((y) => red(4, y)), [0, 10, 20, 30, 40, 40]);
  // Half as wide below the neck: the body's outer columns are empty, the head keeps its width.
  const narrow = tallerFrames(image, frame, 2, 105, { width: 50 }).image;
  const alpha = (x, y) => narrow.data[(y * narrow.width + x) * 4 + 3];
  assert.deepEqual([0, 1, 2, 3].map((x) => alpha(x, 0)), [255, 255, 255, 255]);
  assert.deepEqual([0, 1, 2, 3].map((x) => alpha(x, narrow.height - 1)), [0, 255, 255, 0]);
});
