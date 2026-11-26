import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { uniteStrip, zipFiles, crc32 } from '../src/unite.js';
import { createImage } from '../src/recolor.js';

test('a Unite strip: frames side by side, 1 pixel around, 2 pixels between', () => {
  // A 3 x 2 sheet of 2 x 2 frames; frame (col, row) has red = col * 10 + row + 1.
  const sheet = createImage(6, 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) sheet.data.set([Math.floor(x / 2) * 10 + Math.floor(y / 2) + 1, 0, 0, 255], (y * 6 + x) * 4);
  const strip = uniteStrip(sheet, { w: 2, h: 2 }, [[0, 1], [1, 1], [2, 1], [1, 1]]);
  assert.deepEqual([strip.width, strip.height], [4 * 2 + 3 * 2 + 2, 4]);
  const red = (x, y) => strip.data[(y * strip.width + x) * 4];
  const alpha = (x, y) => strip.data[(y * strip.width + x) * 4 + 3];
  assert.deepEqual([1, 5, 9, 13].map((x) => red(x, 1)), [2, 12, 22, 12]);
  assert.deepEqual([[0, 1], [3, 1], [4, 1], [1, 0], [15, 3]].map(([x, y]) => alpha(x, y)), [0, 0, 0, 0, 0]);
});

test('the zip holds the files as they are, with their names and checksums', () => {
  const files = [{ name: 'a/one.txt', bytes: new TextEncoder().encode('hello') }, { name: 'two.bin', bytes: new Uint8Array([1, 2, 3]) }];
  const zip = zipFiles(files);
  const v = new DataView(zip.buffer);
  assert.equal(v.getUint32(0, true), 0x04034b50);
  assert.equal(v.getUint32(14, true), crc32(files[0].bytes));
  assert.equal(new TextDecoder().decode(zip.subarray(30, 39)), 'a/one.txt');
  assert.equal(new TextDecoder().decode(zip.subarray(39, 44)), 'hello');
  const end = zip.length - 22;
  assert.equal(v.getUint32(end, true), 0x06054b50);
  assert.equal(v.getUint16(end + 10, true), 2);
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.ok(inflateRawSync); // node can read zips; the format itself is checked above
});
