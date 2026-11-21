import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePartPath, parseGradientPath, createLibrary, addPack } from '../src/parse.js';

test('parses a walking layer and its mask', () => {
  const base = parsePartPath('Generator/TV/Male/TV_Clothing1_p03.png');
  assert.equal(base.sheet, 'TV');
  assert.equal(base.part, 'Clothing');
  assert.equal(base.layer, 'Clothing1');
  assert.equal(base.pid, 'p03');
  assert.equal(base.bodyType, 'Male');
  assert.equal(base.isMask, false);

  const mask = parsePartPath('Generator/TV/Male/TV_Clothing1_p03_c.png');
  assert.equal(mask.isMask, true);
});

test('parses face cells and colour numbers', () => {
  const p = parsePartPath('Face/Female/FG_RearHair1_p12_c2_m003.png');
  assert.equal(p.sheet, 'FG');
  assert.equal(p.layer, 'RearHair1');
  assert.equal(p.cell, 'c2');
  assert.equal(p.slotId, 'hair');
  assert.equal(p.isMask, false);
});

test('accepts non-standard variation ids and is case-insensitive', () => {
  assert.equal(parsePartPath('tv/kid/tv_Glasses_p5001.png').pid, 'p5001');
  assert.equal(parsePartPath('TV/Kid/TV_Glasses_pMV01.png').pid, 'pMV01');
  assert.equal(parsePartPath('tv/kid/tv_Glasses_p01.png').bodyType, 'Kid');
});

test('icons and gradients', () => {
  const icon = parsePartPath('Variation/Male/icon_Glasses_p02.png');
  assert.equal(icon.isIcon, true);
  assert.equal(icon.part, 'Glasses');
  assert.deepEqual(parseGradientPath('Generator/gradients.png'), { category: 'all' });
  assert.deepEqual(parseGradientPath('generator/grad_skin.png'), { category: 'skin' });
});

test('rejects files that do not follow the convention', () => {
  assert.equal(parsePartPath('TV/Male/my cool hat.png'), null);
  assert.equal(parsePartPath('TV/Male/TV_Hat.png'), null);
});

test('two packs with the same part numbers never overwrite each other', () => {
  const lib = createLibrary();
  addPack(lib, 'Base', [{ path: 'TV/Male/TV_FrontHair1_p01.png', src: 'a' }]);
  addPack(lib, 'Base', [{ path: 'TV/Male/TV_FrontHair1_p01.png', src: 'b' }]);
  const variants = lib.bodyTypes.get('Male').parts.get('FrontHair');
  assert.equal(variants.size, 2);
  assert.deepEqual([...variants.keys()], ['Base/Male/FrontHair/p01', 'Base (2)/Male/FrontHair/p01']);
});

test('mask and base end up on the same layer; orphan masks are reported', () => {
  const lib = createLibrary();
  addPack(lib, 'P', [
    { path: 'TV/Male/TV_Body_p01.png', src: 'base' },
    { path: 'TV/Male/TV_Body_p01_c.png', src: 'mask' },
    { path: 'TV/Male/TV_Tail1_p01_c.png', src: 'orphan' },
    { path: 'TV/Male/readme.png', src: 'x' },
  ]);
  const body = lib.variants.get('P/Male/Body/p01');
  assert.equal(body.part, 'Body');
  assert.equal(body.layers.length, 1);
  assert.equal(body.layers[0].base.src, 'base');
  assert.equal(body.layers[0].mask.src, 'mask');
  assert.equal(lib.bodyTypes.get('Male').parts.get('Tail').get('P/Male/Tail/p01').layers.length, 0);
  assert.ok(lib.warnings.some((w) => w.includes('TV_Tail1_p01_c.png')));
  assert.equal(lib.unrecognized.length, 1);
});

test('variants from different body types are separate and all indexed', () => {
  const lib = createLibrary();
  addPack(lib, 'P', [
    { path: 'TV/Male/TV_AccA_p835.png', src: 'm' },
    { path: 'TV/Female/TV_AccA_p835.png', src: 'f' },
  ]);
  assert.equal(lib.variants.get('P/Male/AccA/p835').bodyType, 'Male');
  assert.equal(lib.variants.get('P/Female/AccA/p835').layers[0].base.src, 'f');
});

test('face cells without a colour number are kept as uncoloured layers', () => {
  const p = parsePartPath('Face/Female/FG_Eyes_p2002_c2.png');
  assert.equal(p.cell, 'c2');
  assert.equal(p.slotId, null);
  assert.deepEqual(p.unknownSuffixes, []);
});
