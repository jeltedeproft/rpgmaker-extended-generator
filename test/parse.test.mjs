import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePartPath, parseGradientPath, createLibrary, addPack, lenientName, assignFile, buildPartName, unassignFile, libraryFiles, removePack } from '../src/parse.js';

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

test('lowercase part names map to the standard part ("SV_body" is Body)', () => {
  const p = parsePartPath('generator/SV/Male/SV_body_p01_c.png');
  assert.equal(p.part, 'Body');
  assert.equal(p.layer, 'Body');
  assert.equal(p.isMask, true);
});

test('set folders and copy suffixes become separate variants instead of duplicates', () => {
  const lib = createLibrary();
  addPack(lib, 'DLC', [
    { path: 'gen/SV/Male/SV_Body_p01.png', src: 1 },
    { path: 'gen/odd-eye_bodies/left_green/Male/SV_body_p01.png', src: 2 },
    { path: 'gen/odd-eye_bodies/left_red/Male/SV_body_p01.png', src: 3 },
    { path: 'gen/TV/Male/TV_AccB_p07 (2).png', src: 4 },
    { path: 'gen/TV/Male/TV_AccB_p07_c (2).png', src: 5 },
    { path: 'gen/TV/Male/TV_AccB_p2-2.png', src: 6 },
  ]);
  assert.deepEqual(lib.warnings, []);
  assert.deepEqual(lib.unrecognized, []);
  const pids = [...lib.variants.values()].map((v) => `${v.part} ${v.pid}`).sort();
  assert.deepEqual(pids, ['AccB p07 (2)', 'AccB p2-2', 'Body p01', 'Body p01 (left_green)', 'Body p01 (left_red)']);
  const copy = [...lib.variants.values()].find((v) => v.pid === 'p07 (2)');
  assert.equal(copy.layers[0].mask.src, 5);
});

test('names without a part number are still read (and typos are forgiven)', () => {
  assert.equal(lenientName('TV_ClothingEric.png'), 'TV_Clothing_pEric.png');
  assert.equal(lenientName('TV_Clothing2_pXX.png.png'), 'TV_Clothing2_pXX.png');
  assert.equal(lenientName('FG_FrontHair_p17_c1].png'), 'FG_FrontHair_p17_c1.png');
  assert.equal(lenientName('SV_Hat_c.png'), 'SV_Hat_p01_c.png');
  assert.equal(lenientName('hat.png'), null);
  const lib = createLibrary();
  addPack(lib, 'Mine', [{ path: 'Mine/TV/Male/TV_ClothingEric.png', src: 'e' }]);
  assert.ok(lib.variants.has('Mine/Male/Clothing/pEric'));
  assert.ok(lib.warnings.some((w) => w.includes('read as TV_Clothing_pEric.png')));
});

test('a file can be assigned by hand, as a new part and a new body type', () => {
  const lib = createLibrary();
  addPack(lib, 'Mine', [{ path: 'Mine/stuff/hat.png', src: 'h' }, { path: 'Mine/stuff/hat_mask.png', src: 'm' }]);
  assert.equal(lib.unrecognized.length, 2);
  // The mask first: it waits for its image.
  assert.equal(assignFile(lib, 'Mine', 'Mine/stuff/hat_mask.png', 'm', buildPartName({ sheet: 'TV', part: 'AccC', pid: 'hat', mask: true }), 'Elf'), null);
  assert.equal(assignFile(lib, 'Mine', 'Mine/stuff/hat.png', 'h', buildPartName({ sheet: 'TV', part: 'AccC', pid: 'hat' }), 'Elf'), null);
  assert.equal(lib.unrecognized.length, 0);
  const v = lib.variants.get('Mine/Elf/AccC/phat');
  assert.equal(v.layers.length, 1);
  assert.equal(v.layers[0].base.src, 'h');
  assert.equal(v.layers[0].mask.src, 'm');
  assert.equal(buildPartName({ sheet: 'FG', part: 'Eyes', pid: 'p02', cell: 'c2', slotM: 2 }), 'FG_Eyes_p02_c2_m002.png');
});

test('a part word anywhere in an odd name, and a "b" file as the mask', () => {
  const lib = createLibrary();
  addPack(lib, 'MV', [
    { path: 'Generator/TV/Male/TV_FurClothes01.png', src: 'fur' },
    { path: 'Generator/TV/Male/TV_FurClothes01b.png', src: 'furMask' },
    { path: 'Generator/TV/Male/TV_Clothing2_p01.png', src: 'c' },
  ]);
  assert.ok(![...lib.bodyTypes.get('Male').parts.keys()].includes('FurClothes'));
  const fur = lib.variants.get('MV/Male/Clothing/pFur01');
  assert.ok(fur, [...lib.variants.keys()].join());
  assert.equal(fur.layers.length, 1);
  assert.equal(fur.layers[0].base.src, 'fur');
  assert.equal(fur.layers[0].mask.src, 'furMask');
  assert.ok(![...lib.variants.keys()].some((k) => k.endsWith('/pb')));
});

test('files can be unassigned and reassigned', () => {
  const lib = createLibrary();
  addPack(lib, 'P', [
    { path: 'TV/Male/TV_Hat_p01.png', src: 'hat' },
    { path: 'TV/Male/TV_Hat_p01_c.png', src: 'hatMask' },
    { path: 'TV/Male/TV_ClothingEric.png', src: 'eric' },
  ]);
  assert.equal(lib.readAs.get('P|TV/Male/TV_ClothingEric.png').how, 'odd');
  // Unassigning the image takes the variant away and queues image and mask.
  unassignFile(lib, 'P', 'TV/Male/TV_Hat_p01.png');
  assert.ok(!lib.variants.has('P/Male/Hat/p01'));
  assert.ok(!lib.bodyTypes.get('Male').parts.has('Hat'));
  assert.deepEqual(lib.unrecognized.map((u) => u.src).sort(), ['hat', 'hatMask']);
  // Reassign both as AccA.
  assignFile(lib, 'P', 'TV/Male/TV_Hat_p01.png', 'hat', 'TV_AccA_p05.png', 'Male');
  assignFile(lib, 'P', 'TV/Male/TV_Hat_p01_c.png', 'hatMask', 'TV_AccA_p05_c.png', 'Male');
  const acc = lib.variants.get('P/Male/AccA/p05');
  assert.equal(acc.layers[0].base.src, 'hat');
  assert.equal(acc.layers[0].mask.src, 'hatMask');
  assert.equal(lib.unrecognized.length, 0);
  assert.equal(lib.readAs.get('P|TV/Male/TV_Hat_p01.png').how, 'hand');
  assert.equal(libraryFiles(lib).length, 3);
});

test('copies identical to another copy are found, near copies are measured', async () => {
  const { findLookalikes, copyBase } = await import('../src/lookalike.js');
  const { createImage } = await import('../src/recolor.js');
  assert.equal(copyBase('p01 (2)'), 'p01');
  assert.equal(copyBase('p17 (alt)'), 'p17');
  assert.equal(copyBase('p01 (left_green)'), null); // a set, not a copy
  const lib = createLibrary();
  addPack(lib, 'P', [
    { path: 'TV/Male/TV_Body_p01.png', src: 'a' },
    { path: 'TV/Male/TV_Body_p01 (2).png', src: 'b' },
    { path: 'TV/Male/TV_Body_p01 (3).png', src: 'c' },
  ]);
  const img = (paint) => { const i = createImage(4, 4); for (let p = 0; p < 16; p++) i.data.set([10, 10, 10, 255], p * 4); paint(i); return i; };
  const set = (id, pixels) => { lib.variants.get(id).layers[0].base.pixels = pixels; };
  set('P/Male/Body/p01', img(() => {}));
  set('P/Male/Body/p01 (2)', img((i) => i.data.set([200, 0, 0, 255], 0))); // 1 of 16 differs
  set('P/Male/Body/p01 (3)', img((i) => i.data.set([200, 0, 0, 255], 0))); // same as (2)
  const found = findLookalikes(lib);
  const three = found.find((f) => f.variant.pid === 'p01 (3)');
  assert.equal(three.other.pid, 'p01 (2)');
  assert.equal(three.result.identical, true);
  const two = found.find((f) => f.variant.pid === 'p01 (2)');
  assert.equal(two.result.identical, false);
  assert.equal(two.result.ratio, 1 / 16);
  assert.equal(two.result.sheet, 'TV');
});

test('a folder opened twice is recognised, also under another name', async () => {
  const { folderKeys, sameFolder } = await import('../src/lookalike.js');
  const files = (root, size = 10) => ['TV/Male/TV_Body_p01.png', 'Face/Male/FG_Body_p01_c1_m001.png', 'readme.txt']
    .map((p) => ({ path: `${root}/${p}`, src: { size } }));
  const open = [{ name: 'Generator', keys: folderKeys(files('Generator')) }];
  assert.equal(open[0].keys.size, 2); // images only
  const twin = sameFolder(open, folderKeys(files('Generator copy')));
  assert.equal(twin.pack.name, 'Generator');
  assert.equal(twin.same, 2);
  assert.equal(sameFolder(open, folderKeys(files('Other', 99))), null); // same names, other files
});

test('identical parts in two folders are paired across folders', async () => {
  const { findLookalikes } = await import('../src/lookalike.js');
  const { createImage } = await import('../src/recolor.js');
  const lib = createLibrary();
  addPack(lib, 'A', [{ path: 'TV/Male/TV_AccA_p05.png', src: 'a' }]);
  addPack(lib, 'B', [{ path: 'TV/Male/TV_AccA_p05.png', src: 'b' }]);
  for (const v of lib.variants.values()) v.layers[0].base.pixels = createImage(4, 4);
  for (const v of lib.variants.values()) v.layers[0].base.pixels.data.set([1, 2, 3, 255], 0);
  const found = findLookalikes(lib, 'B');
  assert.equal(found.length, 1);
  assert.equal(found[0].variant.pack, 'B');
  assert.equal(found[0].other.pack, 'A');
  assert.equal(found[0].result.identical, true);
  assert.equal(findLookalikes(lib, 'A').length, 0); // the first folder keeps its parts
});

test('same picture with other colour areas is not a picture difference', async () => {
  const { compareVariants } = await import('../src/lookalike.js');
  const { createImage } = await import('../src/recolor.js');
  const lib = createLibrary();
  addPack(lib, 'P', [
    { path: 'TV/Male/TV_Body_p01.png', src: 'a' }, { path: 'TV/Male/TV_Body_p01_c.png', src: 'am' },
    { path: 'TV/Male/TV_Body_p01 (2).png', src: 'b' }, { path: 'TV/Male/TV_Body_p01_c (2).png', src: 'bm' },
  ]);
  const solid = (rgb) => { const i = createImage(2, 2); for (let p = 0; p < 4; p++) i.data.set([...rgb, 255], p * 4); return i; };
  const [a, b] = ['P/Male/Body/p01', 'P/Male/Body/p01 (2)'].map((id) => lib.variants.get(id).layers[0]);
  a.base.pixels = solid([90, 90, 90]);
  b.base.pixels = solid([90, 90, 90]);
  a.mask.pixels = solid([255, 0, 0]);
  b.mask.pixels = solid([0, 255, 0]);
  const r = compareVariants(lib.variants.get('P/Male/Body/p01 (2)'), lib.variants.get('P/Male/Body/p01'));
  assert.equal(r.identical, false);
  assert.equal(r.differ, 0);
  assert.equal(r.maskDiffer, 4);
});

test('a pack can be taken out again, leaving the others', () => {
  const lib = createLibrary();
  addPack(lib, 'A', [{ path: 'TV/Male/TV_Body_p01.png', src: 1 }, { path: 'odd.png', src: 2 }, { path: 'grad_hair.png', src: 3 }]);
  addPack(lib, 'B', [{ path: 'TV/Male/TV_Body_p02.png', src: 4 }, { path: 'TV/Female/TV_Body_p01.png', src: 5 }]);
  removePack(lib, 'B');
  assert.deepEqual(lib.packs.map((p) => p.name), ['A']);
  assert.deepEqual([...lib.variants.keys()], ['A/Male/Body/p01']);
  assert.deepEqual([...lib.bodyTypes.keys()], ['Male']);
  removePack(lib, 'A');
  assert.equal(lib.variants.size + lib.bodyTypes.size + lib.unrecognized.length + lib.gradientFiles.length, 0);
});
