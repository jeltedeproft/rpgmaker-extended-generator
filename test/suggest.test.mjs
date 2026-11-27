import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImage, matchSlot } from '../src/recolor.js';
import { guessSheet, shapeProfile, shapeSimilarity, rankParts, sampleRegion, nameWords, partsInName, partsInPath, maskColourShare, rankWithName, NAME_BONUS, slotForPart } from '../src/suggest.js';

test('an RPG Maker XP character sheet (4 x 4 frames, any size) is suggested as XP', async () => {
  assert.equal(guessSheet(128, 192).sheet, 'XP');
  assert.equal(guessSheet(256, 384).sheet, 'XP');
  assert.equal(guessSheet(144, 192).sheet, 'TV');
  const { xpToWalk, walkToXp } = await import('../src/xp.js');
  const { createImage } = await import('../src/recolor.js');
  // 4 x 4 frames of 1 x 1: frame (col, row) has red = col * 10 + row.
  const xp = createImage(4, 4);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) xp.data.set([c * 10 + r, 0, 0, 255], (r * 4 + c) * 4);
  const walk = xpToWalk(xp);
  assert.deepEqual([walk.width, walk.height], [3, 4]);
  assert.deepEqual([0, 1, 2].map((c) => walk.data[(1 * 3 + c) * 4]), [11, 1, 31]); // step, stand, other step
  const back = walkToXp(walk);
  assert.deepEqual([back.width, back.height], [4, 4]);
  assert.deepEqual([0, 1, 2, 3].map((c) => back.data[(2 * 4 + c) * 4]), [2, 12, 2, 32]); // stand, step, stand, other step
});

test('big sprites: "$" files are one character of any size, other sheets hold 8', async () => {
  const { guessGrid } = await import('../src/cut.js');
  assert.equal(guessSheet(288, 384, '$BigMonster1.png').sheet, 'TV');
  assert.match(guessSheet(432, 384, '!$Gate1.png').why, /144×96/);
  assert.deepEqual(guessGrid(288, 384, '$BigMonster1.png'), [1, 1]);
  assert.deepEqual(guessGrid(576, 768, '!Crystal.png'), [4, 2]);
});

test('RPG Maker 2000/2003: a charset is cut into 8 characters, read with its rows turned', async () => {
  const { guessGrid } = await import('../src/cut.js');
  assert.deepEqual(guessGrid(288, 256, 'Chara1.png'), [4, 2]);
  assert.equal(guessSheet(72, 128).sheet, 'RM2K');
  const { rm2kToWalk, walkToRm2k } = await import('../src/xp.js');
  const { createImage } = await import('../src/recolor.js');
  const sheet = createImage(1, 4);
  for (let r = 0; r < 4; r++) sheet.data.set([r, 0, 0, 255], r * 4); // rows up, right, down, left
  const walk = rm2kToWalk(sheet);
  assert.deepEqual([0, 1, 2, 3].map((r) => walk.data[r * 4]), [2, 3, 1, 0]); // down, left, right, up
  assert.deepEqual([0, 1, 2, 3].map((r) => walkToRm2k(walk).data[r * 4]), [0, 1, 2, 3]);
});

test('folder names suggest a part when the file name names none, as asset packs sort them', () => {
  const cases = {
    'Body/Face/Brows/Female Brows/Female Brow 10.png': 'Eyebrows',
    'Body/Face/Mouths/Unisex Mouths Snouted/Snouted 3.png': 'Mouth',
    'Body/Face/Noses/Male Noses/Male Nose 1.png': 'Nose',
    'Body/Head/Female Head/Female Head 2.png': 'Face',
    'Body/Head/Male Ears/Male Ear 4.png': 'Ears',
    'Body/Hair/Male Facial Hair/Beard 2.png': 'Beard',
    'Body/Hair/Female Hair/Female Hair 7.png': 'FrontHair',
    'Hair/Hair Accessories/Clip 1.png': 'AccB',
    'Clothing/Headwear/Female Headwear/Witch 1.png': 'AccA',
    'Clothing/Bodywear/Male Bodywear/Male Bodywear 12.png': 'Clothing',
    'Clothing/Footwear/Female Footwear/Female Footwear 2.png': 'Clothing',
    'Clothing/Neckwear/Male Neckwear/Male Neckwear 1.png': 'AccB',
    'Face/Face Accessories/Male Face Accessories/Monocle 1.png': 'Glasses',
    'Body/Female Body/Female Body 3.png': 'Body',
  };
  for (const [path, part] of Object.entries(cases)) assert.deepEqual(partsInPath(path), [part], path);
  assert.deepEqual(partsInPath('Clothing/Headwear/Cape 1.png'), ['Cloak']); // the file name goes first
});

const dot = (img, x, y, rgba = [200, 0, 0, 255]) => img.data.set(rgba, (y * img.width + x) * 4);

test('the sheet is guessed from the size, then from the frame grid', () => {
  assert.equal(guessSheet(144, 192).sheet, 'TV');
  assert.equal(guessSheet(576, 384).sheet, 'SV');
  assert.equal(guessSheet(192, 256).sheet, 'TV'); // 64px walk frames
  assert.equal(guessSheet(192, 64).sheet, 'TVD');
  assert.equal(guessSheet(864, 576).sheet, 'SV');
  assert.equal(guessSheet(160, 160).sheet, 'FG');
  assert.equal(guessSheet(32, 32).sheet, 'icon');
  assert.deepEqual(sampleRegion(144, 192, 'TV'), { x: 48, y: 0, w: 48, h: 48 });
});

test('parts are suggested by where their pixels sit', () => {
  const face = (y0, y1, x0 = 0, x1 = 144) => {
    const img = createImage(144, 144);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) dot(img, x, y);
    return img;
  };
  const refs = [
    { part: 'FrontHair', layer: '', cell: 'c1', profile: shapeProfile(face(0, 40), 'FG') },
    { part: 'Beard', layer: '', cell: 'c1', profile: shapeProfile(face(100, 140, 40, 104), 'FG') },
    { part: 'Glasses', layer: '', cell: 'c1', profile: shapeProfile(face(60, 75, 30, 114), 'FG') },
  ];
  const hat = shapeProfile(face(0, 36), 'FG');
  const ranked = rankParts(hat, refs);
  assert.equal(ranked[0].part, 'FrontHair');
  assert.ok(ranked[0].score > 0.8);
  assert.equal(rankParts(shapeProfile(face(58, 76, 28, 116), 'FG'), refs)[0].part, 'Glasses');
  assert.equal(shapeProfile(createImage(144, 144), 'FG'), null);
  assert.equal(shapeSimilarity(hat, hat), 1);
});

test('words in the file name name parts', () => {
  assert.deepEqual(nameWords('TV_LongBeard2-dark.png'), ['tv', 'long', 'beard', 'dark']);
  assert.deepEqual(partsInName('big_beard.png'), ['Beard']);
  assert.deepEqual(partsInName('RedCape.png'), ['Cloak']);
  assert.deepEqual(partsInName('fox_beastears.png', ['Ears', 'BeastEars']), ['BeastEars']);
  assert.deepEqual(partsInName('ponytail_hair.png'), ['RearHair']);
  assert.deepEqual(partsInName('face mask.png'), ['Face']); // "mask" alone names no part
  assert.deepEqual(partsInName('p05.png'), []);
});

test('part names are found however they are written: apart, in one piece, in any order', () => {
  for (const name of ['TV_RearHair01.png', 'rear_hair.png', 'Rear_Hair.png', 'REAR-HAIR.png', 'rearhair.png',
    'hair_rear.png', 'Hair Rear 2.png', 'long hair (rear).png', 'back_hair.png']) {
    assert.deepEqual(partsInName(name), ['RearHair'], name);
  }
  for (const name of ['front_hair.png', 'HairFront.png', 'FRONTHAIR.png', 'hair.png']) assert.deepEqual(partsInName(name), ['FrontHair'], name);
  assert.deepEqual(partsInName('ears_beast.png'), ['BeastEars']);
  assert.deepEqual(partsInName('Eye_Brow_thick.png'), ['Eyebrows']);
  assert.deepEqual(partsInName('mark_facial.png'), ['FacialMark']);
  assert.deepEqual(partsInName('acc_b_ribbon.png'), ['AccB']);
});

test('a part suggests the colour slot RPG Maker uses for it, or for the part it is named like', () => {
  const slot = (part) => slotForPart(part)?.slotId ?? null;
  for (const p of ['Body', 'Face', 'Ears', 'Nose', 'Mouth']) assert.equal(slot(p), 'skin', p);
  for (const p of ['FrontHair', 'RearHair', 'Beard', 'Eyebrows', 'LongHair', 'Rear_Hair', 'Ponytail']) assert.equal(slot(p), 'hair', p);
  assert.equal(slot('Clothing'), 'clothing');
  assert.equal(slot('Cloak'), 'cloak');
  assert.equal(slot('Robe'), 'clothing');
  assert.equal(slot('Cape'), 'cloak');
  assert.equal(slot('Skin'), 'skin'); // named like a slot
  assert.equal(slot('Hat'), 'accA'); // hats are RPG Maker's AccA
});

test('a part the name names is ranked higher, even without a loaded one', () => {
  const full = new Float32Array(144).fill(1);
  const top = new Float32Array(144).fill(0).fill(1, 0, 36);
  const refs = [{ part: 'FrontHair', layer: '1', profile: top }, { part: 'Beard', layer: '1', profile: full }];
  const plain = rankWithName(top, refs, []);
  assert.equal(plain[0].part, 'FrontHair');
  const named = rankWithName(top, refs, ['Beard']);
  assert.equal(named[0].part, 'FrontHair'); // shape 1.0 still beats 0.25 + bonus
  assert.equal(named[1].part, 'Beard');
  assert.ok(named[1].named && Math.abs(named[1].score - (0.25 + NAME_BONUS)) < 1e-6);
  const unknown = rankWithName(top, refs, ['Tail']);
  assert.ok(unknown.some((r) => r.part === 'Tail' && r.score === NAME_BONUS));
});

test('colour masks are told apart from drawn parts by their colours', () => {
  const mask = createImage(4, 1);
  mask.data.set([0xfc, 0xcb, 0x0a, 255, 0xfc, 0xcb, 0x0a, 255, 255, 255, 255, 255, 0xae, 0x86, 0x82, 255]);
  assert.equal(maskColourShare(mask, matchSlot), 1);
  const drawn = createImage(4, 1);
  drawn.data.set([40, 40, 40, 255, 90, 80, 70, 255, 120, 110, 100, 255, 0, 0, 0, 0]);
  assert.equal(maskColourShare(drawn, matchSlot), 0);
  assert.equal(maskColourShare(createImage(2, 2), matchSlot), 0);
});

test('parts with other frame sizes suggest a sheet template', async () => {
  const { frameHints } = await import('../src/suggest.js');
  const sizes = [{ sheet: 'TV', w: 144, h: 192 }, { sheet: 'TV', w: 288, h: 384 }, { sheet: 'TV', w: 288, h: 384 }, { sheet: 'FG', w: 300, h: 300 }, { sheet: 'SV', w: 577, h: 384 }];
  assert.deepEqual(frameHints(sizes, { TV: { w: 48, h: 48 } }), [{ sheet: 'TV', w: 96, h: 96, cols: 3, rows: 4, count: 2 }]);
  assert.deepEqual(frameHints(sizes, { TV: { w: 48, h: 48 } }, new Set(['TV|96|96'])), []);
});

test('a picture is offered in every way it could be read, the likeliest first', async () => {
  const { readingsOf } = await import('../src/suggest.js');
  const uses = (w, h, name) => readingsOf(w, h, name).map((r) => r.use);
  assert.deepEqual(uses(144, 192, 'x.png'), ['TV', 'XP', 'FG', 'cut', 'cut']);
  assert.equal(readingsOf(144, 192)[0].best, true);
  assert.deepEqual(uses(576, 384, 'Actor1.png'), ['SV', 'FG', 'cut', 'cut']);
  assert.ok(uses(576, 384, 'Actor1.png').includes('cut'));
  assert.deepEqual(uses(128, 192, 'xp.png')[0], 'XP');
  assert.deepEqual(uses(144, 384, 'eight.png')[0], 'DIR8');
});

test('readings say which standard their frame size is, and a face set is offered', async () => {
  const { readingsOf, standardOf } = await import('../src/suggest.js');
  assert.equal(standardOf('TV', 48, 48), 'MV/MZ');
  assert.equal(standardOf('TV', 32, 32), 'VX / VX Ace');
  assert.equal(standardOf('RM2K', 24, 32), '2000/2003');
  assert.equal(standardOf('TV', 40, 40), '');
  // A VX Ace walk sheet of one character.
  assert.equal(readingsOf(96, 128, 'Hero.png').find((r) => r.use === 'TV').standard, 'VX / VX Ace');
  // A VX Ace character sheet: 8 characters of 32px frames.
  assert.equal(readingsOf(384, 256, 'Actor1.png').find((r) => r.use === 'cut' && r.cols === 4).standard, 'VX / VX Ace');
  // A VX Ace face set: 8 faces of 96 x 96.
  const face = readingsOf(384, 192, 'Actor1_face.png').find((r) => /face set/.test(r.label));
  assert.deepEqual([face.cols, face.rows, face.standard], [4, 2, 'VX / VX Ace']);
  assert.ok(!readingsOf(144, 192).some((r) => /RPG Maker/.test(r.label)));
});
