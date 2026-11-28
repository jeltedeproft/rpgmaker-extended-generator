import { test } from 'node:test';
import assert from 'node:assert/strict';
import { growRegion, applyClip } from '../src/clip.js';
import { clipOf, clippedCells } from '../src/compose.js';

test('growRegion: a clip lets through pixels next to its edge, within the frame', () => {
  // 8 x 4, two frames of 4 x 4; the region is column 1 of the first frame.
  const region = new Uint8Array(32);
  for (let y = 0; y < 4; y++) region[y * 8 + 1] = 1;
  const grown = growRegion(region, 8, 4, 1, { w: 4, h: 4 });
  const row = [...grown.subarray(0, 8)];
  assert.deepEqual(row, [1, 1, 1, 0, 0, 0, 0, 0], 'grown into columns 0 and 2, not into the next frame');
  const shrunk = growRegion(grown, 8, 4, -1, { w: 4, h: 4 });
  assert.equal(shrunk[1], 1);
  assert.equal(shrunk[2], 0);
});

test('applyClip with a box changes only that frame', () => {
  const image = { width: 4, height: 1, data: new Uint8ClampedArray(16).fill(255) };
  applyClip(image, new Uint8Array(4), 'inside', { x: 2, y: 0, w: 2, h: 1 });
  assert.deepEqual([3, 7, 11, 15].map((i) => image.data[i]), [255, 255, 0, 0]);
});

test('clipOf: a frame or sheet choice goes over the one for all pictures', () => {
  const character = { clip: { Hair: { mode: 'inside', by: 'Hat', at: { TV: { mode: '' }, 'TV|1,0': { mode: 'over', by: 'Hat', grow: 1 } } } } };
  assert.equal(clipOf(character, 'Hair').mode, 'inside');
  assert.equal(clipOf(character, 'Hair', 'FG').mode, 'inside');
  assert.equal(clipOf(character, 'Hair', 'TV'), null, 'not clipped on the walk');
  assert.equal(clipOf(character, 'Hair', 'TV', '1,0').mode, 'over');
  assert.equal(clipOf(character, 'Hair', 'TV', '0,0'), null);
  assert.deepEqual(clippedCells(character, 'Hair', 'TV'), ['1,0']);
  assert.equal(clipOf(character, 'Hair #2', 'FG').by, 'Hat', 'pieces follow their item');
});
