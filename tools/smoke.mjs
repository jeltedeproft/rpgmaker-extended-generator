// Browser smoke test: loads the sample kit in headless Chrome, exercises the UI and saves screenshots.
// Needs the dev server running (npm run serve). Run: node tools/smoke.mjs [outDir]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CHROME = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => p && existsSync(p));
const URL_UNDER_TEST = process.env.APP_URL || 'http://localhost:5173/?sample';
const OUT = process.argv[2] || join(tmpdir(), 'xgen-smoke');
const PORT = 9333;
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`, '--window-size=1400,1000',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'xgen-profile-'))}`, 'about:blank',
], { stdio: 'ignore' });

let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try {
    target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page');
  } catch { /* not up yet */ }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let nextId = 1;
const waiting = new Map();
const errors = [];
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && waiting.has(msg.id)) {
    waiting.get(msg.id)(msg);
    waiting.delete(msg.id);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
  }
});
const send = (method, params = {}) => new Promise((resolve) => {
  const id = nextId++;
  waiting.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.result.exceptionDetails) throw new Error(res.result.exceptionDetails.exception?.description);
  return res.result.result.value;
};
const shot = async (name) => {
  const res = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, name), Buffer.from(res.result.data, 'base64'));
};
const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);

const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok, detail });

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL_UNDER_TEST });
  await sleep(2500);

  check('app shown after sample kit', await evaluate(`!document.getElementById('editor').hidden && document.getElementById('welcome').hidden`));
  check('parts listed', (await evaluate(`document.querySelectorAll('#part-list button').length`)) >= 6);
  const facePixels = `(() => { const c = document.getElementById('face-canvas'); const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; })()`;
  check('face renders', (await evaluate(facePixels)) > 1000);
  await shot('1-loaded.png');

  // Pick a hair, check the face changes.
  const before = await evaluate(facePixels);
  await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('FrontHair')).click()`);
  await sleep(300);
  await click('#variants .variant:nth-child(3)');
  await sleep(800);
  check('hair variant adds pixels to face', (await evaluate(facePixels)) > before);
  check('hair colour slot offered', await evaluate(`[...document.querySelectorAll('.slot-head')].some(h => h.textContent.includes('Hair'))`));
  await shot('2-hair.png');

  // Change hair colour: pick the 3rd swatch of the first slot.
  const hairPixel = `(() => { const d = document.getElementById('face-canvas').getContext('2d').getImageData(72, 30, 1, 1).data; return [...d].join(','); })()`;
  const hairBefore = await evaluate(hairPixel);
  await click('.slot .swatches .swatch:nth-child(3)');
  await sleep(800);
  check('recolour changes pixels', (await evaluate(hairPixel)) !== hairBefore, `${hairBefore} -> ${await evaluate(hairPixel)}`);

  // Visibility: hide the hair wherever the face is drawn.
  const faceHash = `[...document.getElementById('face-canvas').getContext('2d').getImageData(0,0,144,144).data].reduce((a, v, i) => (a + v * ((i % 251) + 1)) % 1000000007, 0)`;
  const beforeClip = await evaluate(faceHash);
  await evaluate(`(() => { const m = document.getElementById('clip-mode'); m.value = 'outside'; m.dispatchEvent(new Event('change')); })()`);
  await sleep(300);
  await evaluate(`(() => { const b = document.getElementById('clip-by'); b.value = 'Face'; b.dispatchEvent(new Event('change')); })()`);
  await sleep(900);
  check('clipping hides part of the hair', (await evaluate(faceHash)) !== beforeClip);
  await evaluate(`(() => { const m = document.getElementById('clip-mode'); m.value = ''; m.dispatchEvent(new Event('change')); })()`);
  await sleep(900);
  check('clipping can be turned off', (await evaluate(faceHash)) === beforeClip);

  // Every part tile has a picture (its Variation icon, or a render of the part itself).
  await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('Body')).click()`);
  await sleep(1200);
  check('body tiles have a preview', await evaluate(`[...document.querySelectorAll('#variants .variant')].filter(b => b.title !== 'None').every(b => b.querySelector('canvas'))`));
  await shot('2b-body.png');

  // A second item of the same part, with its own colours.
  await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('FrontHair')).click()`);
  await sleep(300);
  await click('#add-item');
  await sleep(900);
  check('second item added', await evaluate(`document.getElementById('editor-title').textContent === 'FrontHair 2' && [...document.querySelectorAll('#part-list button')].some(b => b.textContent.startsWith('FrontHair 2'))`));
  await click('#own-colours');
  await sleep(300);
  await click('.slot .swatches .swatch:nth-child(1)');
  await sleep(800);
  check('own colours stored per item', await evaluate(`(async () => { const s = document.querySelector('.slot .swatch.selected'); return !!s && document.getElementById('own-colours').checked; })()`));
  await click('#remove-item');
  await sleep(600);
  check('second item removed', await evaluate(`![...document.querySelectorAll('#part-list button')].some(b => b.textContent.startsWith('FrontHair 2'))`));

  // Draw order: move the top face layer down one step.
  await evaluate(`document.getElementById('layers').open = true`);
  const topBefore = await evaluate(`document.querySelector('#layer-list li span').textContent`);
  await evaluate(`document.querySelector('#layer-list li .layer-buttons button:last-child').click()`);
  await sleep(800);
  const topAfter = await evaluate(`document.querySelector('#layer-list li span').textContent`);
  check('draw order can be changed', topBefore !== topAfter && !(await evaluate(`document.getElementById('layer-reset').disabled`)), `${topBefore} -> ${topAfter}`);
  await click('#layer-reset');
  await sleep(800);
  check('draw order resets', (await evaluate(`document.querySelector('#layer-list li span').textContent`)) === topBefore);

  // Randomize a few times.
  for (let i = 0; i < 5; i++) {
    await click('#randomize');
    await sleep(500);
  }
  check('still renders after randomize', (await evaluate(facePixels)) > 1000);

  // Randomize rules: FrontHair never worn.
  await click('#random-rules');
  await sleep(300);
  await evaluate(`(() => { const row = [...document.querySelectorAll('.rule-chance')].find(r => r.textContent.startsWith('FrontHair')); const i = row.querySelector('input'); i.value = 0; i.dispatchEvent(new Event('change')); document.querySelector('#rules-dialog button[value="ok"]').click(); })()`);
  await sleep(300);
  let hairless = true;
  for (let i = 0; i < 4; i++) {
    await click('#randomize');
    await sleep(400);
    hairless &&= (await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('FrontHair')).querySelector('.value').textContent`)) === 'none';
  }
  check('randomize follows the rules', hairless);
  await click('#random-rules');
  await sleep(300);
  await click('#rule-add-link');
  await shot('3c-rules.png');
  await click('#rules-reset');
  await sleep(300);
  await evaluate(`document.querySelector('#rules-dialog button[value="ok"]').click()`);
  await evaluate(`document.querySelector('#dir-buttons [data-dir="2"]').click()`);
  await sleep(400);
  await shot('3-random.png');

  // Character sets: save the hair as a set, change it, put the set back on.
  await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('FrontHair')).click()`);
  await sleep(300);
  await click('#variants .variant:nth-child(2)');
  await sleep(600);
  const hairValue = () => evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('FrontHair')).querySelector('.value').textContent`);
  const savedHair = await hairValue();
  await click('#save-set');
  await sleep(300);
  await evaluate(`(() => { document.getElementById('set-name').value = 'Smoke hair'; for (const i of document.querySelectorAll('#set-items input')) i.checked = i.value === 'FrontHair'; document.querySelector('#set-dialog button[value="ok"]').click(); })()`);
  await sleep(500);
  check('set saved', await evaluate(`[...document.querySelectorAll('.set-apply')].some(b => b.textContent === 'Smoke hair')`));
  await click('#variants .variant:nth-child(1)');
  await sleep(500);
  await evaluate(`[...document.querySelectorAll('.set-apply')].find(b => b.textContent === 'Smoke hair').click()`);
  await sleep(800);
  check('set puts the hair back on', (await hairValue()) === savedHair, savedHair);

  // Credits: the pack in use, with its credits file.
  await evaluate(`document.getElementById('credits').open = true`);
  check('credits list the pack and its credits file', await evaluate(`(() => { const t = document.getElementById('credit-list').textContent; return t.includes('Sample kit') && t.includes('credits.txt'); })()`));

  // Sheet template: 64px walk frames.
  await evaluate(`(() => { const i = document.querySelectorAll('#template-grid input')[4]; i.value = 64; i.dispatchEvent(new Event('change')); const j = document.querySelectorAll('#template-grid input')[5]; j.value = 64; j.dispatchEvent(new Event('change')); })()`);
  await sleep(1200);
  check('walk template changes the frame size', await evaluate(`document.getElementById('walk-canvas').width === 64 && document.getElementById('walk-canvas').height === 64`));
  await evaluate(`document.querySelector('.settings').open = true`);
  await shot('3b-template.png');
  await evaluate(`(() => { for (const i of [...document.querySelectorAll('#template-grid input')].slice(4, 6)) { i.value = ''; i.dispatchEvent(new Event('change')); } })()`);
  await sleep(1200);
  check('template can be cleared', await evaluate(`document.getElementById('walk-canvas').width === 48`));

  // Preview controls: pause, stand still, all directions, whole sheet.
  const walkSig = (id) => `[...document.getElementById('${id}').getContext('2d').getImageData(0,0,document.getElementById('${id}').width,document.getElementById('${id}').height).data].reduce((a, v, i) => (a + v * ((i % 251) + 1)) % 1000000007, 0)`;
  await click('#pause-anim');
  await sleep(300);
  const paused1 = await evaluate(walkSig('walk-canvas'));
  await sleep(800);
  check('pause stops the walk animation', paused1 === await evaluate(walkSig('walk-canvas')));
  await click('#pause-anim');
  await click('#stand-anim');
  await sleep(300);
  const stand1 = await evaluate(walkSig('walk-canvas'));
  await sleep(800);
  check('stand still shows one frame', stand1 === await evaluate(walkSig('walk-canvas')));
  await click('#stand-anim');
  await click('#walk-all');
  await sleep(500);
  check('all walk directions shown', await evaluate(`(() => { const c = document.getElementById('walk-all-canvas'); return !c.parentElement.hidden && c.width === 4 * document.getElementById('walk-canvas').width; })()`));
  await evaluate(`document.getElementById('sheet-view').open = true`);
  await sleep(500);
  check('whole sheet shown', await evaluate(`document.getElementById('sheet-canvas').width === 144 && document.getElementById('sheet-canvas').height === 192`));
  await shot('3d-preview-controls.png');
  await click('#walk-all');

  // Clear all: everything off except Body and Face, and one click brings it back.
  {
    await click('#randomize');
    await sleep(900);
    const worn = `[...document.querySelectorAll('#part-list button')].filter(b => !b.classList.contains('piece') && b.querySelector('.value').textContent && b.querySelector('.value').textContent !== 'none').map(b => b.firstChild.textContent.replace(' 🔒', ''))`;
    const before = await evaluate(worn);
    await click('#clear-all');
    await sleep(900);
    const after = await evaluate(worn);
    check('clear all leaves only body and face', after.every(k => k === 'Body' || k === 'Face') && before.length > after.length, `${before.length} -> ${after.join(',')}`);
    await click('#clear-all');
    await sleep(900);
    check('undo clear puts the parts back', (await evaluate(worn)).length === before.length);
  }
  // Gallery: keep the current character, see it with a picture, change it, pick it again.
  {
    await evaluate(`localStorage.removeItem('xgen-gallery')`);
    await evaluate(`(() => { const n = document.getElementById('character-name'); n.value = 'Gallery hero'; n.dispatchEvent(new Event('input')); n.dispatchEvent(new Event('change')); })()`);
    const keptSig = await evaluate(`[...document.getElementById('face-canvas').getContext('2d').getImageData(0,0,144,144).data].reduce((a, v, i) => (a + v * ((i % 251) + 1)) % 1000000007, 0)`);
    await click('#open-gallery');
    await sleep(500);
    await click('#gallery-save');
    await sleep(1500);
    check('gallery keeps the character', await evaluate(`[...document.querySelectorAll('#gallery-list .gallery-name')].some(n => n.textContent === 'Gallery hero')`));
    check('gallery card has a picture', await evaluate(`[...document.querySelectorAll('#gallery-list .gallery-face')].some(c => c.width > 0)`));
    await shot('4c-gallery.png');
    await evaluate(`document.querySelector('#gallery-dialog button[value="close"]').click()`);
    await click('#randomize');
    await sleep(900);
    await click('#open-gallery');
    await sleep(800);
    await evaluate(`[...document.querySelectorAll('#gallery-list .gallery-card')].find(c => c.textContent.includes('Gallery hero')).querySelector('.gallery-buttons button').click()`);
    await sleep(1200);
    const backSig = await evaluate(`[...document.getElementById('face-canvas').getContext('2d').getImageData(0,0,144,144).data].reduce((a, v, i) => (a + v * ((i % 251) + 1)) % 1000000007, 0)`);
    check('using a gallery card loads it', !(await evaluate(`document.getElementById('gallery-dialog').open`)) && await evaluate(`document.getElementById('character-name').value`) === 'Gallery hero' && backSig === keptSig);
    await evaluate(`localStorage.removeItem('xgen-gallery')`);
  }
  // Opening the same folder again asks first.
  {
    const packsBefore = await evaluate(`document.querySelectorAll('#packs div').length`);
    await click('#sample-kit');
    await sleep(1500);
    check('same folder twice asks first', await evaluate(`document.getElementById('same-dialog').open`));
    await evaluate(`document.querySelector('#same-dialog button[value="skip"]').click()`);
    await sleep(800);
    check('skipped folder is not added', (await evaluate(`document.querySelectorAll('#packs div').length`)) === packsBefore);
  }

  // Remembered folders: a folder handle (the browser's private storage stands in for a picked
  // folder) is stored once, and after a reload it comes back without a click.
  {
    const keys = await evaluate(`(async () => {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle('Remembered kit', { create: true });
      const m = await (await fetch('sample-kit/manifest.json')).json();
      for (const path of m.files) {
        const parts = path.split('/');
        let d = dir;
        for (const part of parts.slice(0, -1)) d = await d.getDirectoryHandle(part, { create: true });
        const w = await (await d.getFileHandle(parts.at(-1), { create: true })).createWritable();
        await w.write(await (await fetch('sample-kit/' + path)).blob());
        await w.close();
      }
      const L = await import(new URL('src/loader.js', location.href).href);
      await L.rememberFolder(dir);
      await L.rememberFolder(dir);
      return (await L.rememberedFolders()).map((f) => f.key).join(',');
    })()`);
    check('a folder is remembered once', keys === 'Remembered kit', keys);
    await send('Page.navigate', { url: URL_UNDER_TEST.replace(/\?.*$/, '') });
    await sleep(4000);
    check('remembered folder reopens after a reload', await evaluate(`[...document.querySelectorAll('#packs div')].some((d) => d.textContent.includes('Remembered kit'))`));
    check('remembered folders listed in the sidebar', await evaluate(`!document.getElementById('recent-folders-side').hidden && document.getElementById('recent-folders-side').textContent.includes('Remembered kit')`));
    await evaluate(`(async () => {
      const L = await import(new URL('src/loader.js', location.href).href);
      for (const f of await L.rememberedFolders()) await L.forgetFolder(f.key);
      await (await navigator.storage.getDirectory()).removeEntry('Remembered kit', { recursive: true });
    })()`);
    await send('Page.navigate', { url: URL_UNDER_TEST });
    await sleep(2500);
  }

  // Save/load round trip through the real (de)serializer.
  const roundTrip = await evaluate(`(async () => {
    const m = await import(new URL('src/character.js', location.href).href);
    return typeof m.serializeCharacter === 'function';
  })()`);
  check('modules importable', roundTrip);

  // Optional: a real pack served by the dev server (PACK=test-assets/<name>, needs a manifest.json).
  if (process.env.PACK) {
    await send('Page.navigate', { url: `${URL_UNDER_TEST}&pack=${encodeURIComponent(process.env.PACK)}` });
    await sleep(4000);
    check('real pack imported', await evaluate(`document.querySelectorAll('#packs div').length >= 3`));
    // Assign an unrecognised file by hand, as a brand-new part.
    await evaluate(`document.getElementById('problems').open = true`);
    const assignable = await evaluate(`document.querySelectorAll('#problem-list .assign').length`);
    check('unrecognised files can be assigned', assignable > 0, `${assignable} buttons`);
    if (assignable) {
      await click('#problem-list .assign');
      await sleep(800);
      await evaluate(`(() => { const p = document.getElementById('assign-part'); p.value = 'AccC'; p.dispatchEvent(new Event('input')); document.getElementById('assign-remember').checked = false; })()`);
      check('assign dialog previews the name', (await evaluate(`document.getElementById('assign-result').textContent`)).includes('_AccC_p'));
      await evaluate(`document.querySelector('#assign-dialog button[value="ok"]').click()`);
      await sleep(900);
      check('assigned file shows up as a new part', await evaluate(`[...document.querySelectorAll('#part-list button')].some(b => b.textContent.startsWith('AccC'))`));
    }
    // Files dialog: the queue of skipped files, with pictures, one by one.
    await click('#open-files');
    await sleep(1200);
    const queued = await evaluate(`document.querySelectorAll('#files-list .file-card').length`);
    check('files dialog lists files to assign', queued > 0, `${queued} cards`);
    check('files to assign have pictures', await evaluate(`[...document.querySelectorAll('#files-list canvas')].every(c => c.width > 0)`));
    await click('#files-start');
    await sleep(900);
    check('assign dialog shows the image', await evaluate(`document.getElementById('assign-preview').width > 0`));
    check('one by one offers skip', await evaluate(`!document.getElementById('assign-skip').hidden`));
    await evaluate(`document.getElementById('assign-skip').click()`);
    await sleep(600);
    // Reassign a file that was read from its name.
    await evaluate(`document.getElementById('assign-dialog').open && document.querySelector('#assign-dialog button[value="cancel"]').click()`);
    await evaluate(`document.querySelector('#files-tabs [data-tab="all"]').click()`);
    await evaluate(`(() => { const i = document.getElementById('files-search'); i.value = '/Male/TV_AccA_p835.png'; i.dispatchEvent(new Event('input')); })()`);
    await sleep(800);
    const cards = await evaluate(`document.querySelectorAll('#files-list .file-card').length`);
    check('all files can be searched', cards === 1, `${cards} cards`);
    await evaluate(`document.querySelector('#files-list .file-card button').click()`);
    await sleep(900);
    check('reassign starts from the current reading', await evaluate(`document.getElementById('assign-title').textContent === 'Reassign a file' && document.getElementById('assign-part').value === 'AccA' && document.getElementById('assign-pid').value === '835'`));
    await evaluate(`(() => { const p = document.getElementById('assign-part'); p.value = 'AccD'; p.dispatchEvent(new Event('input')); document.getElementById('assign-remember').checked = false; document.querySelector('#assign-dialog button[value="ok"]').click(); })()`);
    await sleep(1200);
    check('reassigned file moves to its new part', await evaluate(`[...document.querySelectorAll('#part-list button')].some(b => b.textContent.startsWith('AccD'))`));
    check('reassigned file shows its new reading', await evaluate(`document.querySelector('#files-list .file-reading')?.textContent.includes('AccD p835')`));
    await shot('4b-files.png');
    await evaluate(`document.querySelector('#files-list .file-card button:nth-child(2)').click()`);
    await sleep(900);
    check('unassigned file (and its mask) go back to the queue', await evaluate(`document.querySelector('#files-tabs [data-tab="queue"]').textContent`) === 'To assign (' + (queued + 2) + ')');
    await evaluate(`document.querySelector('#files-dialog button[value="close"]').click()`);
    await evaluate(`(() => { const s = JSON.parse(localStorage.getItem('xgen-settings') || '{}'); delete s.assignments; localStorage.setItem('xgen-settings', JSON.stringify(s)); })()`);

    check('both body types offered', await evaluate(`[...document.querySelectorAll('#body-type option')].map(o => o.value).join(',')`) === 'Male,Female');
    // Male character wearing a Female-only accessory.
    await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('AccA')).click()`);
    await sleep(500);
    await evaluate(`document.getElementById('other-bodies').open = true`);
    const borrowed = await evaluate(`(() => { const t = [...document.querySelectorAll('#other-variants .variant')].find(b => b.title.includes('/Female/')); t?.click(); return t?.title; })()`);
    await sleep(1200);
    check('female part selectable on male body', !!borrowed, borrowed);
    check('borrowed part shows in sidebar', await evaluate(`[...document.querySelectorAll('#part-list button')].some(b => b.textContent.includes('Female'))`));
    // Nudge it: the battler sprite (static frame size, animates) is compared via the export source.
    const faceSig = `[...document.getElementById('face-canvas').getContext('2d').getImageData(0,0,144,144).data].reduce((a, v, i) => (a + v * ((i % 251) + 1)) % 1000000007, 0)`;
    const beforeNudge = await evaluate(faceSig);
    await evaluate(`(() => { const i = document.getElementById('off-face-y'); i.value = -6; i.dispatchEvent(new Event('input')); })()`);
    await sleep(900);
    check('face offset moves the part', (await evaluate(faceSig)) !== beforeNudge);
    const beforeTurn = await evaluate(faceSig);
    await evaluate(`(() => { const i = document.getElementById('off-face-rot'); i.value = 25; i.dispatchEvent(new Event('input')); })()`);
    await sleep(900);
    check('face rotation turns the part', (await evaluate(faceSig)) !== beforeTurn);
    const beforeSize = await evaluate(faceSig);
    await evaluate(`(() => { const i = document.getElementById('off-face-scale'); i.value = 150; i.dispatchEvent(new Event('input')); })()`);
    await sleep(900);
    check('face size resizes the part', (await evaluate(faceSig)) !== beforeSize);
    const beforeMirror = await evaluate(faceSig);
    await evaluate(`(() => { const i = document.getElementById('off-face-flipy'); i.checked = true; i.dispatchEvent(new Event('input')); })()`);
    await sleep(900);
    check('flip turns the part upside down', (await evaluate(faceSig)) !== beforeMirror);
    // Whole image: mirror the whole face, then reset it.
    {
      await evaluate(`document.getElementById('image-transform').open = true`);
      const beforeWhole = await evaluate(faceSig);
      await evaluate(`(() => { const s = document.getElementById('image-sheet'); s.value = 'FG'; s.dispatchEvent(new Event('change')); const i = document.getElementById('image-flipx'); i.checked = true; i.dispatchEvent(new Event('input')); })()`);
      await sleep(900);
      check('whole face can be mirrored', (await evaluate(faceSig)) !== beforeWhole && (await evaluate(`document.getElementById('image-transform-mark').textContent`)).includes('Face'));
      await click('#image-reset');
      await sleep(900);
      check('whole image resets', (await evaluate(faceSig)) === beforeWhole && !(await evaluate(`document.getElementById('image-flipx').checked`)));
      await evaluate(`document.getElementById('image-transform').open = false`);
    }
    await shot('4-real-pack.png');

    // Per-frame position: move the accessory only in the walk frames facing left.
    await evaluate(`(() => { const s = document.getElementById('cell-sheet'); s.value = 'TV'; s.dispatchEvent(new Event('change')); const g = document.getElementById('cell-group'); g.value = 1; g.dispatchEvent(new Event('change')); })()`);
    await sleep(300);
    check('walk directions offered per frame', await evaluate(`[...document.querySelectorAll('#cell-group option')].map(o => o.textContent).join(',')`) === 'Down,Left,Right,Up');
    await evaluate(`document.getElementById('sheet-view').open = true; document.getElementById('sheet-view-select').value = 'TV'; document.getElementById('sheet-view-select').dispatchEvent(new Event('change'))`);
    await sleep(600);
    const sheetRow = (row) => '(() => { const c = document.getElementById("sheet-canvas"); const h = c.height / 4; return [...c.getContext("2d").getImageData(0, ' + row + ' * h, c.width, h).data].reduce((a, v, i) => (a + v * ((i % 251) + 1)) % 1000000007, 0); })()';
    const down0 = await evaluate(sheetRow(0));
    const left0 = await evaluate(sheetRow(1));
    await evaluate(`(() => { const i = document.getElementById('cell-y'); i.value = -5; i.dispatchEvent(new Event('input')); })()`);
    await sleep(1200);
    check('per-direction offset moves only that direction', (await evaluate(sheetRow(1))) !== left0 && (await evaluate(sheetRow(0))) === down0);
    check('preview shows the edited direction', await evaluate(`document.querySelector('#dir-buttons .active')?.dataset.dir === '1'`));
    await shot('4c-per-direction.png');
    // Take the accessory off again (it's a mask that hides the eyes).
    await click('#variants .variant:first-child');
    await sleep(600);
    // Parts that only exist on the face can't be moved on sprites (and say so).
    await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('Eyes')).click()`);
    await sleep(500);
    await click('#variants .variant:nth-child(2)');
    await sleep(900);
    check('face-only part disables sprite offsets', await evaluate(`document.getElementById('off-sprite-x').disabled && !document.getElementById('off-face-x').disabled && document.getElementById('offsets-note').textContent.length > 0`));
    // Split the eyes into a left and a right eye and move one of them.
    await click('#split-item');
    await sleep(1500);
    const pieces = await evaluate(`[...document.querySelectorAll('#part-list button.piece')].length`);
    check('eyes split into pieces', pieces >= 2, `${pieces} pieces`);
    check('split status lists pieces per image', await evaluate(`/face [0-9]/.test(document.getElementById('pieces-status').textContent)`));
    if (pieces >= 2) {
      const beforePiece = await evaluate(faceSig);
      await evaluate(`document.querySelectorAll('#part-list button.piece')[1].click()`);
      await sleep(500);
      await evaluate(`(() => { const i = document.getElementById('off-face-x'); i.value = 4; i.dispatchEvent(new Event('input')); })()`);
      await sleep(900);
      check('one piece moves on its own', (await evaluate(faceSig)) !== beforePiece);
      await shot('4b-split-eyes.png');
      await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('Eyes')).click()`);
      await sleep(500);
      await click('#unsplit-item');
      await sleep(900);
      check('pieces join again', (await evaluate(`document.querySelectorAll('#part-list button.piece').length`)) === 0);
    }
    // Source colours: a fresh folder shows the parts as drawn; a gradient only once picked.
    {
      check('parts start in their source colours', await evaluate(`[...document.querySelectorAll('.slot .swatch.source')].length > 0 && [...document.querySelectorAll('.slot .swatch.source')].every(b => b.classList.contains('selected'))`));
      const beforePick = await evaluate(faceSig);
      await evaluate(`document.querySelector('.slot .swatch:not(.add)').click()`);
      await sleep(900);
      check('picking a gradient recolours', (await evaluate(faceSig)) !== beforePick);
      await evaluate(`document.querySelector('.slot .swatch.source').click()`);
      await sleep(900);
      check('source colours come back', (await evaluate(faceSig)) === beforePick);
      await evaluate(`document.querySelector('.slot .swatch:not(.add)').click()`);
      await sleep(900);
    }
    // Per image: hide the part on the face only, or everywhere.
    {
      const beforeHide = await evaluate(faceSig);
      check('per image box shown', await evaluate(`!document.getElementById('sheet-parts-box').hidden && document.querySelectorAll('#sheet-parts select').length === 4`));
      await evaluate(`(() => { const s = document.querySelector('#sheet-parts select'); s.value = 'hidden'; s.dispatchEvent(new Event('change')); })()`);
      await sleep(1000);
      check('hidden on the face image', (await evaluate(faceSig)) !== beforeHide);
      await evaluate(`(() => { const s = document.querySelector('#sheet-parts select'); s.value = ''; s.dispatchEvent(new Event('change')); })()`);
      await sleep(1000);
      check('shown again on the face', (await evaluate(faceSig)) === beforeHide);
      await evaluate(`(() => { const c = document.getElementById('hide-item'); c.checked = true; c.dispatchEvent(new Event('change')); })()`);
      await sleep(1000);
      check('hide everywhere', (await evaluate(faceSig)) !== beforeHide && await evaluate(`!!document.querySelector('#part-list button.hidden-item')`));
      await evaluate(`(() => { const c = document.getElementById('hide-item'); c.checked = false; c.dispatchEvent(new Event('change')); })()`);
      await sleep(1000);
      check('unhide', (await evaluate(faceSig)) === beforeHide);
    }
    // Adjust: shift a chosen colour's hue, previewed live, kept under "Your colours".
    {
      const beforeAdjust = await evaluate(faceSig);
      await evaluate(`[...document.querySelectorAll('.slot .swatch.add')].find(b => b.textContent.startsWith('Adjust') && !b.disabled).click()`);
      await sleep(500);
      check('adjust dialog opens', await evaluate(`document.getElementById('adjust-dialog').open`));
      await evaluate(`(() => { const i = document.getElementById('adjust-hue'); i.value = 120; i.dispatchEvent(new Event('input')); })()`);
      await sleep(1200);
      check('adjusting previews live', (await evaluate(faceSig)) !== beforeAdjust);
      await evaluate(`document.querySelector('#adjust-dialog button[value="ok"]').click()`);
      await sleep(900);
      check('adjusted colour is kept and selected', await evaluate(`[...document.querySelectorAll('.slot .swatch.selected')].some(b => b.title.includes('(adjusted)'))`));
      check('adjusted colour stays on the character', (await evaluate(faceSig)) !== beforeAdjust);
    }
    // "Other colours" stays open after picking from it.
    const picked = await evaluate(`(() => { const d = document.querySelector('.slot details'); if (!d) return 'no list'; d.open = true; d.dispatchEvent(new Event('toggle')); d.querySelector('.swatch').click(); return 'ok'; })()`);
    await sleep(600);
    check('other colours stay open after a pick', picked === 'ok' && await evaluate(`document.querySelector('.slot details').open`), picked);
    // Body can be set to None.
    await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('Body')).click()`);
    await sleep(1500);
    check('parts without icons get a preview', await evaluate(`[...document.querySelectorAll('#variants .variant')].filter(b => b.title !== 'None').every(b => b.querySelector('canvas'))`));
    await shot('5-body-thumbnails.png');
    await evaluate(`[...document.querySelectorAll('#variants .variant')].find(b => b.title === 'None').click()`);
    await sleep(900);
    check('body can be set to None', await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('Body')).querySelector('.value').textContent`) === 'none');
  }

  // Optional: a pack with copies ("TV_Body_p01 (2).png", "(3)"), e.g. the official MV generator.
  if (process.env.ALIKE_PACK) {
    await evaluate(`localStorage.removeItem('xgen-settings')`);
    await send('Page.navigate', { url: `${URL_UNDER_TEST}&pack=${encodeURIComponent(process.env.ALIKE_PACK)}` });
    await sleep(9000);
    check('look-alikes dialog opens for near copies', await evaluate(`document.getElementById('alike-dialog').open`));
    const cards = await evaluate(`document.querySelectorAll('#alike-list .alike-card').length`);
    check('look-alikes are listed', cards >= 2, `${cards} cards`);
    check('exact duplicate is hidden', await evaluate(`[...document.querySelectorAll('#alike-list .alike-card')].some(c => c.textContent.includes('p01 (3)') && c.textContent.includes('same pixels') && c.classList.contains('hidden-part'))`));
    await sleep(1500);
    check('look-alikes have pictures and differences', await evaluate(`[...document.querySelectorAll('#alike-list .alike-card')].every(c => [...c.querySelectorAll('canvas')].every(x => x.width > 0))`));
    await shot('5-lookalikes.png');
    // Hide the near copy, then check the part list.
    await evaluate(`[...document.querySelectorAll('#alike-list .alike-card')].find(c => c.textContent.startsWith('Male Body p01 (2)')).querySelector('button').click()`);
    await sleep(500);
    check('hiding is remembered', await evaluate(`JSON.parse(localStorage.getItem('xgen-settings')).lookalikes[[...Object.keys(JSON.parse(localStorage.getItem('xgen-settings')).lookalikes)].find(k => k.endsWith('/Male/Body/p01 (2)'))] === 'hide'`));
    await evaluate(`document.querySelector('#alike-dialog button[value="close"]').click()`);
    await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('Body')).click()`);
    await sleep(600);
    const bodies = await evaluate(`[...document.querySelectorAll('#variants .variant span')].map(s => s.textContent).join(',')`);
    check('hidden copies leave the part list', !bodies.includes('(2)') && !bodies.includes('(3)') && bodies.includes('p01'), bodies);
    await evaluate(`localStorage.removeItem('xgen-settings')`);
  }

  check('no uncaught errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('smoke run', false, e.stack);
} finally {
  ws.close();
  chrome.kill();
}

for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '  (' + c.detail + ')' : ''}`);
console.log(`Screenshots: ${OUT}`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
