import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLibrary, addPack } from '../src/parse.js';
import { digestBytes, sameFileDuplicates } from '../src/lookalike.js';

test('duplicates are found by their files, whatever their names', () => {
  assert.equal(digestBytes(new Uint8Array([1, 2, 3])), digestBytes(new Uint8Array([1, 2, 3])));
  assert.notEqual(digestBytes(new Uint8Array([1, 2, 3])), digestBytes(new Uint8Array([1, 2, 4])));
  const lib = createLibrary();
  addPack(lib, 'A', [
    { path: 'TV/Male/TV_Clothing1_p05.png', src: 'x' },
    { path: 'TV/Male/TV_Clothing1_p12.png', src: 'x2' },
    { path: 'TV/Male/TV_Clothing1_p13.png', src: 'y' },
    { path: 'TV/Female/TV_Clothing1_p05.png', src: 'x3' },
  ]);
  addPack(lib, 'B', [{ path: 'TV/Male/TV_Clothing1_p01.png', src: 'x4' }]);
  const print = { x: 'same', x2: 'same', x3: 'same', x4: 'same', y: 'other' };
  for (const v of lib.variants.values()) for (const l of v.layers) l.base.digest = print[l.base.src];
  const pairs = sameFileDuplicates(lib).map((p) => `${p.variant.id} = ${p.other.id}`).sort();
  // p12 repeats p05; B's p01 repeats it too; p13 differs; Female keeps its own.
  assert.deepEqual(pairs, ['A/Male/Clothing/p12 = A/Male/Clothing/p05', 'B/Male/Clothing/p01 = A/Male/Clothing/p05']);
  assert.deepEqual(sameFileDuplicates(lib, 'B').map((p) => p.variant.id), ['B/Male/Clothing/p01']);
  // A file without a print is not compared.
  lib.variants.get('A/Male/Clothing/p12').layers[0].base.digest = undefined;
  assert.equal(sameFileDuplicates(lib).length, 1);
});
