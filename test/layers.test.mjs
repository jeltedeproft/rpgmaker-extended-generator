import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupLayers, topRun, moveBlock, stepBlock } from '../src/layers.js';

const itemOf = (key) => key.split(' #')[0];

test('layers of one part are grouped under it, in the order of its top-most layer', () => {
  const draws = ['Eyes', 'Hair', 'Eyes', 'Eyes #1', 'Body'].map((item) => ({ item }));
  const groups = groupLayers(draws, itemOf);
  assert.deepEqual(groups.map((g) => [g.item, g.draws.length]), [['Eyes', 3], ['Hair', 1], ['Body', 1]]);
});

test('the top block of a part is its top layer and the ones right under it', () => {
  const order = ['a1', 'a2', 'b', 'a3'];
  assert.deepEqual(topRun(order, ['a1', 'a2', 'a3']), ['a1', 'a2']);
  assert.deepEqual(topRun(order, ['b']), ['b']);
  assert.deepEqual(topRun(order, ['x']), []);
});

test('a block moves above or below another layer and keeps its order', () => {
  const order = ['h', 'e1', 'e2', 'n', 'b'];
  assert.deepEqual(moveBlock(order, ['e1', 'e2'], 'n', true), ['h', 'n', 'e1', 'e2', 'b']);
  assert.deepEqual(moveBlock(order, ['e1', 'e2'], 'h', false), ['e1', 'e2', 'h', 'n', 'b']);
  assert.deepEqual(moveBlock(order, ['e1', 'e2'], 'e2', true), order);
});

test('a block steps past the next layer that shows', () => {
  const order = ['h', 'empty', 'e1', 'e2', 'n'];
  const shown = (id) => id !== 'empty';
  assert.deepEqual(stepBlock(order, ['e1', 'e2'], 1, shown), ['e1', 'e2', 'h', 'empty', 'n']);
  assert.deepEqual(stepBlock(order, ['e1', 'e2'], -1, shown), ['h', 'empty', 'n', 'e1', 'e2']);
  assert.deepEqual(stepBlock(['e1', 'h'], ['e1'], 1), ['e1', 'h']);
});
