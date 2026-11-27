import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSetup, applySetup, isSetup } from '../src/setup.js';

test('a setup carries one folder\'s settings without the folder name, and applies to another', () => {
  const settings = {
    assignments: { 'Mine|parts/hat.png': { readAs: 'TV/Male/TV_AccA_p01.png', bodyType: 'Male' }, 'Other|x.png': { readAs: 'y' } },
    autoMasks: { 'Mine/Male/AccA/p01': { count: 3, slots: ['accA'] } },
    removedParts: { 'Mine/Male/AccA/p02': true },
    packCredits: { Mine: 'Art by me' },
    templates: { TV: { fw: 64, fh: 64 } },
    sets: [{ name: 'Hat', parts: {} }],
    makeRoom: true,
    lookalikes: { secret: true },
  };
  const setup = makeSetup(settings, ['Mine'], [{ id: 'c1', name: 'Teal' }], { name: 'Chibi', author: 'Ann' });
  assert.ok(isSetup(JSON.parse(JSON.stringify(setup))));
  assert.deepEqual(Object.keys(setup.assignments), ['parts/hat.png']);
  assert.deepEqual(Object.keys(setup.autoMasks), ['Male/AccA/p01']);
  assert.equal(setup.credits, 'Art by me');
  assert.equal(setup.options.makeRoom, true);
  assert.equal(setup.lookalikes, undefined);

  const before = { sets: [{ name: 'Hat', parts: { old: 1 } }, { name: 'Mine', parts: {} }] };
  const { settings: next, customGradients, counts } = applySetup(before, setup, ['Theirs']);
  assert.deepEqual(next.assignments['Theirs|parts/hat.png'], settings.assignments['Mine|parts/hat.png']);
  assert.ok(next.autoMasks['Theirs/Male/AccA/p01']);
  assert.ok(next.removedParts['Theirs/Male/AccA/p02']);
  assert.equal(next.packCredits.Theirs, 'Art by me');
  assert.deepEqual(next.sets.map((s) => s.name), ['Mine', 'Hat']);
  assert.deepEqual(next.sets[1].parts, {});
  assert.equal(next.makeRoom, true);
  assert.deepEqual(customGradients, [{ id: 'c1', name: 'Teal' }]);
  assert.deepEqual(counts, { files: 1, parts: 1, sets: 1 });
  assert.equal(before.assignments, undefined); // the input is not changed
  assert.throws(() => applySetup({}, { format: 'other' }, ['A']));
});

test('a setup also carries painted masks, cuts and premade characters', () => {
  const settings = {
    maskEdits: { 'Mine/Male/Hair/p01|TV|base': 'painted', 'Other/Male/Hair/p01|TV|base': 'not this' },
    cuts: { 'Mine|Actor1.png': { cols: 4, rows: 2 } },
  };
  const setup = makeSetup(settings, ['Mine'], [], { characters: [{ name: 'Hero', text: '{"a":1}', id: 'x' }] });
  assert.deepEqual(setup.maskEdits, { 'Male/Hair/p01|TV|base': 'painted' });
  assert.deepEqual(setup.characters, [{ name: 'Hero', text: '{"a":1}' }]);
  const { settings: next, characters } = applySetup({}, setup, ['Theirs']);
  assert.equal(next.maskEdits['Theirs/Male/Hair/p01|TV|base'], 'painted');
  assert.deepEqual(next.cuts['Theirs|Actor1.png'], { cols: 4, rows: 2 });
  assert.deepEqual(characters, [{ name: 'Hero', text: '{"a":1}' }]);
});
