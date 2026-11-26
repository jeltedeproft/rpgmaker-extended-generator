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
const walkSigOf = (id) => `[...document.getElementById('${id}').getContext('2d').getImageData(0,0,document.getElementById('${id}').width,document.getElementById('${id}').height).data].reduce((a, v, i) => (a + v * ((i % 251) + 1)) % 1000000007, 0)`;
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

  // The part editor is in tabs; the checks below use "All" (every box on one page).
  await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('FrontHair')).click()`);
  await sleep(500);
  const shownIn = (id) => `getComputedStyle(document.getElementById('${id}')).display !== 'none'`;
  check('the part editor opens on the Parts tab', await evaluate(`document.getElementById('editor').dataset.tab === 'parts' && ${shownIn('variants')} && !(${shownIn('slots')}) && !document.getElementById('editor-tabs').hidden`));
  await click('#editor-tabs [data-editor-tab="colours"]');
  await sleep(300);
  check('the Colours tab shows only the colours', await evaluate(`${shownIn('slots')} && !(${shownIn('variants')})`));
  await click('#editor-tabs [data-editor-tab="all"]');
  await sleep(300);
  check('the All tab shows everything', await evaluate(`${shownIn('slots')} && ${shownIn('variants')}`));
  // A background for small, dark parts.
  await evaluate(`(() => { const s = document.getElementById('pic-bg'); s.value = 'white'; s.dispatchEvent(new Event('change')); })()`);
  check('a light background can be picked for the pictures', await evaluate(`document.documentElement.dataset.picBg === 'white' && getComputedStyle(document.documentElement).getPropertyValue('--checker-a').trim() === '#ffffff'`));
  await evaluate(`(() => { const s = document.getElementById('pic-bg'); s.value = ''; s.dispatchEvent(new Event('change')); })()`);

  // Pick a hair, check the face changes.
  const before = await evaluate(facePixels);
  await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('FrontHair')).click()`);
  await sleep(300);
  await click('#variants .variant:not(.selected)');
  await sleep(800);
  check('hair variant adds pixels to face', (await evaluate(facePixels)) > before);
  check('hair colour slot offered', await evaluate(`[...document.querySelectorAll('.slot-head')].some(h => h.textContent.includes('Hair'))`));
  await shot('2-hair.png');

  // Paint the colour mask by hand: a stroke in another slot changes the picture and is kept.
  {
    const sheetSum = `(() => { const c = document.getElementById('paint-canvas'); return [...c.getContext('2d').getImageData(0, 0, c.width, c.height).data].reduce((a, v, i) => (a + v * ((i % 251) + 1)) % 1000000007, 0); })()`;
    await click('#slots .paint-mask');
    await sleep(800);
    const before = await evaluate(sheetSum);
    check('the mask painter opens', await evaluate(`document.getElementById('paint-dialog').open && document.getElementById('paint-canvas').width > 0`));
    await evaluate(`(() => {
      [...document.querySelectorAll('.paint-slot')].find(b => b.textContent.includes('Facial mark')).click();
      document.querySelector('input[name="paint-tool"][value="colour"]').click();
      const c = document.getElementById('paint-canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let at = -1; for (let i = 3; i < d.length; i += 4) if (d[i] > 200) { at = (i - 3) / 4; break; }
      const r = c.getBoundingClientRect(); const x = (at % c.width + 0.5) / c.width, y = (Math.floor(at / c.width) + 0.5) / c.height;
      const ev = (t) => c.dispatchEvent(new PointerEvent(t, { clientX: r.left + x * r.width, clientY: r.top + y * r.height, bubbles: true, pointerId: 1 }));
      ev('pointerdown'); ev('pointerup');
    })()`);
    await sleep(1500);
    check('painting a slot is kept', await evaluate(`Object.keys(JSON.parse(localStorage.getItem('xgen-settings')).maskEdits || {}).length === 1`));
    check('the painter shows the character too', await evaluate(`document.querySelectorAll('#paint-live canvas').length === 3`));
    check('the painted bit shows in the slot colour', (await evaluate(sheetSum)) !== before);
    await click('#paint-clear');
    await sleep(1200);
    check('clearing the painting forgets it', await evaluate(`!Object.keys(JSON.parse(localStorage.getItem('xgen-settings')).maskEdits || {}).length`));
    check('and the picture is back as it was', (await evaluate(sheetSum)) === before);
    await evaluate(`document.querySelector('#paint-dialog button[value="close"]').click()`);
    await sleep(300);
  }
  // Harmonise: match the hair to another part, the adjust window opens moved towards it.
  {
    const offered = await evaluate(`(() => { const s = [...document.querySelectorAll('#slots .match-colour')][0]; if (!s || s.options.length < 2) return 0; s.value = s.options[1].value; s.dispatchEvent(new Event('change')); return s.options.length - 1; })()`);
    await sleep(1500);
    check('a colour can be matched to another part', offered > 0 && await evaluate(`document.getElementById('adjust-dialog').open && /towards the colours of/.test(document.getElementById('adjust-note').textContent)`), `${offered} parts`);
    check('the adjust window shows the character', await evaluate(`document.querySelectorAll('#adjust-live canvas').length === 3 && getComputedStyle(document.getElementById('adjust-dialog'), '::backdrop').backgroundColor === 'rgba(0, 0, 0, 0)'`));
    await evaluate(`document.querySelector('#adjust-dialog button[value="cancel"]').click()`);
    await sleep(300);
  }
  // Duplicate and delete a colour; Reset colours to default brings a deleted one back.
  {
    const hairSlot = `[...document.querySelectorAll('#slots .slot')].find(w => /^Hair$/.test(w.querySelector('.slot-head').textContent.trim()))`;
    await evaluate(`${hairSlot}.querySelector('.swatch:not(.add)').click()`);
    await sleep(800);
    const own = () => evaluate(`${hairSlot}.querySelectorAll('.swatch:not(.add)').length`);
    const before = await own();
    await evaluate(`[...${hairSlot}.querySelectorAll('.swatch.add')].find(b => b.textContent === 'Duplicate').click()`);
    await sleep(800);
    check('a colour can be duplicated', (await own()) === before + 1 && await evaluate(`${hairSlot}.textContent.includes('Your colours')`), `${before} -> ${await own()}`);
    await evaluate(`[...${hairSlot}.querySelectorAll('.swatch.add')].find(b => b.textContent === 'Delete').click()`);
    await sleep(800);
    check('your colour can be deleted', (await own()) === before && await evaluate(`${hairSlot}.querySelector('.swatch.source').classList.contains('selected')`));
    await evaluate(`${hairSlot}.querySelector('.swatch:not(.add)').click()`);
    await sleep(500);
    await evaluate(`[...${hairSlot}.querySelectorAll('.swatch.add')].find(b => b.textContent === 'Delete').click()`);
    await sleep(800);
    check('a colour of the colour sheets can be deleted', (await own()) === before - 1 && await evaluate(`/Reset colours to default/.test(${hairSlot}.textContent)`));
    await evaluate(`[...${hairSlot}.querySelectorAll('.swatch.add')].find(b => b.textContent.startsWith('Reset colours')).click()`);
    await sleep(800);
    check('reset colours to default brings it back', (await own()) === before);
  }
  // Flip gradient direction is under Colours; the sheet templates and setup are at the top.
  check('flip gradient direction is in the Colours tab', await evaluate(`!!document.querySelector('#editor .colour-options #flip-gradient')`));
  await click('#open-templates');
  await sleep(300);
  check('the sheet templates open from the top', await evaluate(`document.getElementById('templates-dialog').open && document.querySelectorAll('#template-grid input').length > 0`));
  await evaluate(`document.getElementById('templates-dialog').close()`);
  // Save, Load and Gallery are menus.
  await click('#save-menu-button');
  await sleep(200);
  check('the Save menu opens with character, setup and set', await evaluate(`(() => { const l = document.querySelector('#save-menu .menu-list'); return !l.hidden && ['save-character', 'export-setup', 'save-set'].every(id => l.contains(document.getElementById(id))); })()`));
  await click('#export-setup');
  await sleep(300);
  check('Save setup opens from the Save menu, and the menu closes', await evaluate(`document.getElementById('setup-dialog').open && document.querySelector('#save-menu .menu-list').hidden`));
  await evaluate(`document.getElementById('setup-dialog').close()`);
  check('the Load menu holds character, set, setup and sample kit', await evaluate(`['load-character', 'import-sets', 'import-setup', 'sample-kit'].every(id => document.querySelector('#load-menu .menu-list').contains(document.getElementById(id)))`));
  await click('#open-sets');
  await sleep(300);
  check('the sets are in the Gallery, with Export', await evaluate(`document.getElementById('gallery-dialog').open && !document.getElementById('gallery-sets').hidden && !!document.querySelector('#gallery-sets #export-sets')`));
  await evaluate(`document.getElementById('gallery-dialog').close()`);
  // Layers: drag one layer above another.
  {
    const names = () => evaluate(`[...document.querySelectorAll('#layer-list .layer-name')].map(b => b.textContent)`);
    const first = await names();
    check('the layers have pictures', await evaluate(`document.querySelectorAll('#layer-list .layer-thumb canvas').length > 0`));
    await evaluate(`(() => {
      const rows = document.querySelectorAll('#layer-list .layer-row');
      const from = rows[rows.length - 1], to = rows[0];
      const dt = new DataTransfer();
      from.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
      const r = to.getBoundingClientRect();
      to.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, clientY: r.top + 1, bubbles: true, cancelable: true }));
      to.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientY: r.top + 1, bubbles: true, cancelable: true }));
    })()`);
    await sleep(1200);
    const after = await names();
    check('a layer dragged to the top is drawn on top', after[0] === first[first.length - 1] && !(await evaluate(`document.getElementById('layer-reset').disabled`)), `${first[first.length - 1]} -> ${after[0]}`);
    await click('#layer-reset');
    await sleep(800);
    check('reset to RPG Maker\'s order', JSON.stringify(await names()) === JSON.stringify(first));
    // One row per part; a part's several layers fold under it as "Part 1", "Part 2".
    check('each part is listed once under Layers', await evaluate(`(() => { const n = [...document.querySelectorAll('#layer-list .layer-group')].map(r => r.dataset.item); return n.length > 0 && new Set(n).size === n.length; })()`));
    const many = `[...document.querySelectorAll('#layer-list .layer-group')].find(r => r.querySelector('.layer-count'))`;
    if (await evaluate(`!!${many}`)) {
      check("a part's layers are folded at first", await evaluate(`!document.querySelector('#layer-list .layer-sub')`));
      await evaluate(`${many}.querySelector('.layer-fold').click()`);
      await sleep(300);
      check('unfolding shows its layers as name 1, name 2', await evaluate(`(() => { const s = [...document.querySelectorAll('#layer-list .layer-sub .layer-name')].map(b => b.textContent); return s.length >= 2 && / 1$/.test(s[0]) && / 2$/.test(s[1]); })()`));
      await evaluate(`${many}.querySelector('.layer-fold').click()`);
      await sleep(300);
    }
    const hideFirst = await evaluate(`(() => { const r = document.querySelector('#layer-list .layer-group'); const item = r.dataset.item; r.querySelector('.layer-eye').click(); return item; })()`);
    await sleep(800);
    check('the eye hides a part; it keeps its place, faded', await evaluate(`(() => { const r = document.querySelector('#layer-list .layer-group'); return r.dataset.item === ${JSON.stringify(hideFirst)} && r.classList.contains('is-hidden'); })()`));
    await evaluate(`document.querySelector('#layer-list .layer-group.is-hidden .layer-eye').click()`);
    await sleep(800);
    check('and shows it again', await evaluate(`!document.querySelector('#layer-list .layer-group.is-hidden')`));
  }
  // Cut a sheet into pieces: the body's walk sheet into its four rows.
  {
    await click('#open-files');
    await sleep(500);
    await evaluate(`document.querySelector('#files-tabs [data-tab="all"]').click()`);
    await sleep(300);
    await evaluate(`(() => { const s = document.getElementById('files-search'); s.value = 'TV_Body'; s.dispatchEvent(new Event('input')); })()`);
    await sleep(500);
    await evaluate(`[...document.querySelectorAll('#files-list .file-card')].find(c => /^TV_Body_p\\d+\\.png$/.test(c.querySelector('.file-name').textContent)).querySelectorAll('.file-buttons button').forEach(b => b.textContent === 'Cut…' && b.click())`);
    await sleep(800);
    const cutOpen = await evaluate(`document.getElementById('cut-dialog').open && document.getElementById('cut-canvas').width > 0`);
    check('a sheet can be cut', cutOpen && await evaluate(`[...document.querySelectorAll('#cut-presets button')].length > 3`));
    await evaluate(`[...document.querySelectorAll('#cut-presets button')].find(b => b.textContent.startsWith('Rows')).click()`);
    await sleep(300);
    check('the cut shows how many pieces', await evaluate(`document.getElementById('cut-ok').textContent === 'Cut out 4 pieces'`), await evaluate(`document.getElementById('cut-ok').textContent`));
    await evaluate(`document.getElementById('cut-ok').click()`);
    await sleep(1500);
    check('the pieces are files to assign', await evaluate(`(() => { const s = document.getElementById('files-search'); s.value = '(row'; s.dispatchEvent(new Event('input')); return document.querySelectorAll('#files-list .file-card').length; })()`) === 4);
    await evaluate(`(() => { const s = document.getElementById('files-search'); s.value = ''; s.dispatchEvent(new Event('input')); document.getElementById('files-dialog').close(); })()`);
    await sleep(300);
  }

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
  // The other way round, set on the covering part: the face hides the hair that sticks out of it.
  await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('Face')).click()`);
  await sleep(600);
  const covered = await evaluate(`(() => { const ls = [...document.querySelectorAll('#cover-box label')]; const l = ls.find(l => l.textContent.trim() === 'FrontHair') || ls.find(l => !l.classList.contains('not-worn')); l.querySelector('input').checked = true; l.querySelector('input').dispatchEvent(new Event('change')); return l.textContent.trim(); })()`);
  await sleep(900);
  check('a part can hide what sticks out of it', (await evaluate(faceHash)) !== beforeClip, covered);
  check('parts not worn now can be ticked too', await evaluate(`document.querySelectorAll('#cover-box label.not-worn').length > 0`));
  await evaluate(`(() => { const s = document.getElementById('layer-sheet'); s.value = 'FG'; s.dispatchEvent(new Event('change')); })()`);
  await sleep(300);
  check('a part cut off by another has scissors under Layers', await evaluate(`!!document.querySelector('#layer-list .layer-clip')`));
  await evaluate(`document.querySelector('#layer-list .layer-clip').click()`);
  await sleep(900);
  check('the scissors show it whole again', (await evaluate(faceHash)) === beforeClip && !(await evaluate(`[...document.querySelectorAll('#cover-box input')].some(i => i.checked)`)));

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
  // Several JSON files at once: per file, a picture of each way to use it, then import as chosen.
  {
    const charFile = (name, pid) => JSON.stringify({ format: 'rpgmaker-xgen-character', version: 3, character: { name, bodyType: 'Male', parts: { FrontHair: `Sample kit/Male/FrontHair/${pid}` }, colors: {} } });
    const files = [['json-a.json', charFile('Json A', 'p01')], ['json-b.json', charFile('Json B', 'p02')],
      ['json-sets.json', JSON.stringify({ format: 'rpgmaker-xgen-sets', version: 1, sets: [{ name: 'Json set', parts: {}, colors: {} }] })]];
    for (const [n, t] of files) writeFileSync(join(OUT, n), t);
    const root = (await send('DOM.getDocument')).result.root.nodeId;
    const input = (await send('DOM.querySelector', { nodeId: root, selector: '#load-character' })).result.nodeId;
    await send('DOM.setFileInputFiles', { nodeId: input, files: files.map(([n]) => join(OUT, n)) });
    await sleep(2500);
    check('several JSON files: a choice with pictures', await evaluate(`document.getElementById('json-dialog').open && document.querySelectorAll('#json-list .json-row').length === 3 && [...document.querySelectorAll('#json-list canvas')].filter(c => c.width > 0).length >= 4`));
    await shot('2b-json-import.png');
    await evaluate(`document.querySelector('#json-list input[value="set"]').click()`);
    await evaluate(`document.querySelectorAll('#json-list .json-row')[1].querySelector('input[value="both"]').click()`);
    await evaluate(`document.getElementById('json-apply').click()`);
    await sleep(1500);
    const sets = await evaluate(`[...document.querySelectorAll('#set-list .set-apply')].map(b => b.textContent).join('|')`);
    check('JSON files imported as chosen', (await evaluate(`document.getElementById('character-name').value`)) === 'Json B' && sets.includes('Json A') && sets.includes('Json set'), sets);
    check('a JSON file can be a character and a set at once', sets.includes('Json B'), sets);
  }
  // Remove one part (not its folder), then undo.
  {
    await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('FrontHair')).click()`);
    await sleep(400);
    const tiles = await evaluate(`document.querySelectorAll('#variants .variant').length`);
    await click('#remove-part');
    await sleep(300);
    check('removing a part from the generator asks first', await evaluate(`document.getElementById('confirm-dialog').open && /Files… → Removed/.test(document.getElementById('confirm-text').textContent)`));
    await click('#confirm-ok');
    await sleep(900);
    check('a single part can be removed', (await evaluate(`document.querySelectorAll('#variants .variant').length`)) === tiles - 1
      && (await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('FrontHair')).querySelector('.value').textContent`)) === 'none');
    await evaluate(`document.querySelector('#toast button').click()`);
    await sleep(900);
    check('removing a part can be undone', (await evaluate(`document.querySelectorAll('#variants .variant').length`)) === tiles && await evaluate(`!Object.keys(JSON.parse(localStorage.getItem('xgen-settings')).removedParts || {}).length`));
  }

  // Draw order: move the top face layer down one step.
  const topBefore = await evaluate(`document.querySelector('#layer-list li .layer-name').textContent`);
  await evaluate(`document.querySelector('#layer-list li .layer-buttons button:last-child').click()`);
  await sleep(800);
  const topAfter = await evaluate(`document.querySelector('#layer-list li .layer-name').textContent`);
  check('draw order can be changed', topBefore !== topAfter && !(await evaluate(`document.getElementById('layer-reset').disabled`)), `${topBefore} -> ${topAfter}`);
  await click('#layer-reset');
  await sleep(800);
  check('draw order resets', (await evaluate(`document.querySelector('#layer-list li .layer-name').textContent`)) === topBefore);

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
  // A part a body type never gets: always worn, but never on this body type.
  await click('#random-rules');
  await sleep(300);
  const ruledOut = await evaluate(`(() => {
    const row = [...document.querySelectorAll('.rule-chance')].find(r => !/^(Body|Face|FrontHair)/.test(r.textContent)); const i = row.querySelector('input'); i.value = 100; i.dispatchEvent(new Event('change'));
    const name = row.querySelector('span').textContent;
    document.getElementById('rule-add-not-on').click();
    const [part, body] = document.querySelectorAll('#rule-not-on .rule-row select');
    part.value = name; part.dispatchEvent(new Event('change'));
    body.value = document.getElementById('body-type').value; body.dispatchEvent(new Event('change'));
    document.querySelector('#rules-dialog button[value="ok"]').click();
    return name;
  })()`);
  await sleep(300);
  let beardless = true;
  for (let i = 0; i < 3; i++) {
    await click('#randomize');
    await sleep(400);
    beardless &&= (await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('${ruledOut}')).querySelector('.value').textContent`)) === 'none';
  }
  check('a body type never gets a part it is ruled out for', beardless, ruledOut + ' ' + await evaluate(`JSON.stringify(JSON.parse(localStorage.getItem('xgen-settings') || '{}').randomRules?.notOn)`));
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
  await click('#variants .variant:not(.selected)');
  await sleep(600);
  const hairValue = () => evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('FrontHair')).querySelector('.value').textContent`);
  const savedHair = await hairValue();
  await click('#save-set');
  await sleep(300);
  await evaluate(`(() => { document.getElementById('set-name').value = 'Smoke hair'; for (const i of document.querySelectorAll('#set-items input')) i.checked = i.value === 'FrontHair'; document.querySelector('#set-dialog button[value="ok"]').click(); })()`);
  await sleep(500);
  check('set saved', await evaluate(`[...document.querySelectorAll('.set-apply')].some(b => b.textContent === 'Smoke hair')`));
  check('a set has a picture (or ? without Variation icons)', await evaluate(`[...document.querySelectorAll('#set-list .set')].find(s => s.textContent.includes('Smoke hair'))?.querySelector('.set-icon') != null`));
  await sleep(800);
  check('a set without Variation icons shows its portrait', await evaluate(`!![...document.querySelectorAll('#set-list .set')].find(s => s.textContent.includes('Smoke hair'))?.querySelector('.set-icon canvas')`));
  await evaluate(`[...document.querySelectorAll('#set-list .set')].find(s => s.textContent.includes('Smoke hair')).querySelector('.set-icon').click()`);
  await sleep(1500);
  check('a set opens bigger', await evaluate(`document.getElementById('set-view').open && document.querySelectorAll('#set-view-pics canvas').length >= 1`));
  await evaluate(`document.getElementById('set-view').close()`);
  await evaluate(`document.querySelector('#variants .variant.selected')?.click()`);
  await sleep(500);
  await evaluate(`[...document.querySelectorAll('.set-apply')].find(b => b.textContent === 'Smoke hair').click()`);
  await sleep(800);
  check('set puts the hair back on', (await hairValue()) === savedHair, savedHair);

  // A shared setup: its sets and options are taken over.
  {
    const setup = { format: 'rpgmaker-xgen-setup', version: 1, name: 'Smoke setup', sets: [{ name: 'From setup', parts: {}, colors: {} }], options: {}, assignments: {} };
    writeFileSync(join(OUT, 'smoke.setup.json'), JSON.stringify(setup));
    const root = (await send('DOM.getDocument')).result.root.nodeId;
    const input = (await send('DOM.querySelector', { nodeId: root, selector: '#import-setup' })).result.nodeId;
    await send('DOM.setFileInputFiles', { nodeId: input, files: [join(OUT, 'smoke.setup.json')] });
    await sleep(1500);
    check('a setup file can be imported', await evaluate(`/Using the setup "Smoke setup"/.test(document.getElementById('toast').textContent) && [...document.querySelectorAll('#set-list .set-apply')].some(b => b.textContent === 'From setup')`),
      await evaluate(`document.getElementById('toast').textContent`));
    await evaluate(`[...document.querySelectorAll('#set-list .set')].find(s => s.textContent.includes('From setup'))?.querySelector('.set-remove')?.click()`);
    await sleep(300);
  }

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
  // Make room: a part made bigger gets bigger frames instead of being cut off; smoothing redraws it.
  {
    await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('FrontHair')).click()`);
    await sleep(500);
    const setField = (id, v) => evaluate(`(() => { const i = document.getElementById('${id}'); i.value = ${v}; i.dispatchEvent(new Event('input')); })()`);
    const toggle = (id, on) => evaluate(`(() => { const c = document.getElementById('${id}'); c.checked = ${on}; c.dispatchEvent(new Event('change')); })()`);
    await setField('off-sprite-scale', 300);
    await setField('off-sprite-rot', 20);
    await sleep(900);
    const roomless = await evaluate(walkSigOf('walk-canvas'));
    await toggle('make-room', true);
    await sleep(900);
    check('make room gives bigger frames to an enlarged part', await evaluate(`document.getElementById('walk-canvas').width > 48`), await evaluate(`document.getElementById('walk-canvas').width`));
    await toggle('make-room', false);
    await toggle('smooth-pixels', true);
    await sleep(900);
    check('pixel-art smoothing redraws a turned part', (await evaluate(walkSigOf('walk-canvas'))) !== roomless);
    await toggle('smooth-pixels', false);
    await setField('off-sprite-scale', 100);
    await setField('off-sprite-rot', 0);
    await sleep(900);
    check('frames are back to 48px', await evaluate(`document.getElementById('walk-canvas').width === 48`));
  }

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
    let before = await evaluate(worn);
    // Randomize can put on only Body and Face: then there is nothing to clear, so try again.
    for (let tries = 0; tries < 5 && before.every(k => k === 'Body' || k === 'Face'); tries++) {
      await click('#randomize');
      await sleep(900);
      before = await evaluate(worn);
    }
    // Moved Body and a changed draw order go back too.
    await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('Body')).click()`);
    await sleep(400);
    await evaluate(`(() => { const i = document.getElementById('off-sprite-x'); i.value = 5; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change')); })()`);
    await sleep(400);
    await click('#clear-all');
    await sleep(900);
    const after = await evaluate(worn);
    check('clear all takes off every part, Body and Face too', after.length === 0, `${before.length} -> ${after.join(',')}`);
    await click('#clear-all');
    await sleep(900);
    check('undo clear puts the parts back', (await evaluate(worn)).length === before.length);
    await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('Body')).click()`);
    await sleep(500);
    check('undo clear puts Body back where it was moved', await evaluate(`document.getElementById('off-sprite-x').value === '5'`));
    await evaluate(`document.getElementById('off-reset').click()`);
    await sleep(400);
    await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('Body')).click()`);
    await sleep(500);
    check('the hue button fits its text', await evaluate(`(() => { const b = [...document.querySelectorAll('#slots .swatch.add')].find(x => x.textContent.startsWith('Hue')); return !!b && b.scrollWidth <= b.clientWidth + 1; })()`));
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
    // Something assigned by hand in that folder, to be forgotten with it.
    await evaluate(`(() => { const s = JSON.parse(localStorage.getItem('xgen-settings') || '{}'); (s.assignments ||= {})['Remembered kit|odd.png'] = { readAs: 'TV_Hat_p01.png', bodyType: 'Male' }; (s.assignments)['Other|odd.png'] = { readAs: null }; localStorage.setItem('xgen-settings', JSON.stringify(s)); })()`);
    await send('Page.navigate', { url: URL_UNDER_TEST.replace(/\?.*$/, '') });
    await sleep(4000);
    check('remembered folder reopens after a reload', await evaluate(`[...document.querySelectorAll('#packs div')].some((d) => d.textContent.includes('Remembered kit'))`));
    check('remembered folders listed in the sidebar', await evaluate(`!document.getElementById('recent-folders-side').hidden && document.getElementById('recent-folders-side').textContent.includes('Remembered kit')`));
    check('a long folder name stays inside the sidebar, with its ×', await evaluate(`(() => { const box = document.getElementById('recent-folders-side'); const chip = document.createElement('span'); chip.className = 'folder'; chip.innerHTML = '<button type="button">SomeNewWorkGeneratorPackExUpdate1VeryLongFolderNameThatKeepsGoing</button><button type="button" class="forget">×</button>'; box.append(chip); const b = box.getBoundingClientRect(), x = chip.querySelector('.forget').getBoundingClientRect(); chip.remove(); return x.right <= b.right + 1 && x.width > 10; })()`));
    await evaluate(`[...document.querySelectorAll('#recent-folders-side .forget')].at(-1).click()`);
    await sleep(1200);
    check('forgetting a folder takes its parts out', await evaluate(`![...document.querySelectorAll('#packs div')].some((d) => d.textContent.includes('Remembered kit')) && !document.getElementById('welcome').hidden`));
    const kept = await evaluate(`Object.keys(JSON.parse(localStorage.getItem('xgen-settings')).assignments || {}).join(',')`);
    check('forgetting a folder forgets what was assigned in it', !kept.includes('Remembered kit|') && kept.includes('Other|odd.png'), kept);
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
    await sleep(200);
    check('a loading bar shows while a pack opens', await evaluate(`document.getElementById('busy-label').textContent.startsWith('Opening')`), await evaluate(`document.getElementById('busy-label').textContent`));
    for (let i = 0; i < 40 && !(await evaluate(`document.getElementById('busy').classList.contains('done') || document.getElementById('busy').hidden`)); i++) await sleep(250);
    check('the loading bar says when it is done', await evaluate(`document.getElementById('busy').hidden || document.getElementById('busy-label').textContent.startsWith('✓')`));
    await sleep(1500);
    check('real pack imported', await evaluate(`document.querySelectorAll('#packs div').length >= 3`));
    // Assign an unrecognised file by hand, as a brand-new part.
    check('the import report is at the top', await evaluate(`!document.getElementById('open-problems').hidden && /Import report \\(\\d+\\)/.test(document.getElementById('open-problems').textContent)`));
    await click('#open-problems');
    await sleep(300);
    const assignable = await evaluate(`document.querySelectorAll('#problem-list .assign').length`);
    check('unrecognised files can be assigned', assignable > 0, `${assignable} buttons`);
    if (assignable) {
      await click('#problem-list .assign');
      await evaluate(`document.getElementById('problems').close()`);
      await sleep(800);
      await evaluate(`(() => { const p = document.getElementById('assign-part'); p.value = 'AccC'; p.dispatchEvent(new Event('input')); document.getElementById('assign-remember').checked = false; })()`);
      check('assign dialog previews the name', (await evaluate(`document.getElementById('assign-result').textContent`)).includes('_AccC_p'));
      check('a new part name is said to be new', await evaluate(`document.getElementById('assign-part-chips').textContent.includes('will be a new part')`));
      await evaluate(`(() => { const p = document.getElementById('assign-part'); p.value = ''; p.dispatchEvent(new Event('input')); })()`);
      check('every part can be clicked under the Part field', await evaluate(`document.querySelectorAll('#assign-part-chips .chip').length >= 6`));
      await evaluate(`[...document.querySelectorAll('#assign-part-chips .chip')].find(b => b.textContent === 'Cloak').click()`);
      check('clicking a part fills it in', await evaluate(`document.getElementById('assign-part').value === 'Cloak' && document.querySelector('#assign-part-chips .chip.active')?.textContent === 'Cloak'`));
      await evaluate(`(() => { const p = document.getElementById('assign-part'); p.value = 'AccC'; p.dispatchEvent(new Event('input')); })()`);
      check('assign from the import report is the quick form', await evaluate(`document.getElementById('assign-dialog').classList.contains('one-by-one')`));
      await evaluate(`document.querySelector('#assign-dialog button[value="ok"]').click()`);
      await sleep(900);
      // One by one: the next file follows.
      check('quick assign goes on to the next file', await evaluate(`document.getElementById('assign-dialog').open`));
      await evaluate(`document.querySelector('#assign-dialog button[value="cancel"]').click()`);
      await sleep(300);
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
    check('one by one shows only add, skip and cancel', (await evaluate(`[...document.querySelectorAll('#assign-dialog .dialog-actions button')].filter(b => b.offsetParent).map(b => b.value).join()`)) === 'cancel,skip,ok',
      await evaluate(`[...document.querySelectorAll('#assign-dialog .dialog-actions button')].filter(b => b.offsetParent).map(b => b.value).join()`));
    check('one by one shows only the picture, part, body type and colour slot', await evaluate(`[...document.querySelectorAll('#assign-dialog label.field')].filter(l => l.offsetParent).map(l => l.firstChild.textContent.trim().split(' ')[0]).join() === 'Part,Body,Colour'`),
      await evaluate(`[...document.querySelectorAll('#assign-dialog label.field')].filter(l => l.offsetParent).map(l => l.firstChild.textContent.trim()).join(' | ')`));
    const assignSizes = [await evaluate(`(() => { const r = document.querySelector('#assign-dialog').getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); })()`)];
    await sleep(2500);
    assignSizes.push(await evaluate(`(() => { const r = document.querySelector('#assign-dialog').getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); })()`));
    check('assign dialog suggests an image', (await evaluate(`document.getElementById('assign-suggest').textContent`)).includes('Suggested image'));
    check('assign dialog suggests parts by position', await evaluate(`document.querySelectorAll('#assign-suggest button').length > 0 && document.getElementById('assign-part').value.length > 0`), await evaluate(`document.getElementById('assign-suggest').textContent`));
    await shot('4d-assign-suggest.png');
    check('suggestions name layers in words, not as Beard1', await evaluate(`[...document.querySelectorAll('#assign-suggest button')].every(b => !/[a-z][0-9]( |$)/.test(b.textContent))`), await evaluate(`document.getElementById('assign-suggest').textContent`));
    // The colour slot follows the part (portraits), until one is picked by hand.
    const slotFor = (part) => evaluate(`(() => { const p = document.getElementById('assign-part'); p.value = '${part}'; p.dispatchEvent(new Event('input')); return document.getElementById('assign-slot').value; })()`);
    const partBefore = await evaluate(`document.getElementById('assign-part').value`);
    const slots = [await slotFor('RearHair'), await slotFor('Body'), await slotFor('Clothing')];
    check('the colour slot follows the part', slots.join(',') === '3,1,7', slots.join(','));
    check('the suggested slot says so', await evaluate(`document.getElementById('assign-slot').selectedOptions[0].textContent.includes('suggested for Clothing')`));
    await evaluate(`(() => { const s = document.getElementById('assign-slot'); s.value = '5'; s.dispatchEvent(new Event('change')); })()`);
    check('a slot picked by hand stays', (await slotFor('FrontHair')) === '5');
    await slotFor(partBefore);
    for (const sheet of ['FG', 'TV']) {
      await evaluate(`(() => { const s = document.getElementById('assign-sheet'); s.value = '${sheet}'; s.dispatchEvent(new Event('change')); })()`);
      await sleep(1500);
      assignSizes.push(await evaluate(`(() => { const r = document.querySelector('#assign-dialog').getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); })()`));
    }
    await evaluate(`document.getElementById('assign-skip').click()`);
    await sleep(2500);
    if (await evaluate(`document.getElementById('assign-dialog').open`)) assignSizes.push(await evaluate(`(() => { const r = document.querySelector('#assign-dialog').getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); })()`));
    check('the assign dialog keeps one size', new Set(assignSizes).size === 1, assignSizes.join(' '));
    // Remove a file straight from the assign dialog (one file, not one by one).
    if (await evaluate(`document.getElementById('assign-dialog').open`)) await evaluate(`document.querySelector('#assign-dialog button[value="cancel"]').click()`);
    await sleep(300);
    await evaluate(`[...document.querySelectorAll('#files-list .file-card button')].find(b => b.textContent.startsWith('Assign')).click()`);
    await sleep(1500);
    check('all options opens the full form', await evaluate(`(() => { document.getElementById('assign-more').click(); return !document.getElementById('assign-dialog').classList.contains('one-by-one') && !!document.getElementById('assign-remove').offsetParent; })()`));
    {
      const before = await evaluate(`document.querySelector('#files-tabs [data-tab="removed"]').textContent`);
      await evaluate(`document.getElementById('assign-remove').click()`);
      await sleep(1200);
      check('a file can be removed from the assign dialog', (await evaluate(`document.querySelector('#files-tabs [data-tab="removed"]').textContent`)) !== before, await evaluate(`document.querySelector('#files-tabs [data-tab="removed"]').textContent`));
      if (await evaluate(`document.getElementById('assign-dialog').open`)) await evaluate(`document.querySelector('#assign-dialog button[value="cancel"]').click()`);
      await evaluate(`document.querySelector('#files-tabs [data-tab="removed"]').click()`);
      await sleep(400);
      await evaluate(`document.querySelector('#files-list .file-card .file-buttons button').click()`);
      await sleep(800);
      await evaluate(`document.querySelector('#files-tabs [data-tab="queue"]').click()`);
      await sleep(400);
    }
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
    await evaluate(`[...document.querySelector('#files-list .file-card').querySelectorAll('.file-buttons button')].find(b => b.textContent === 'Unassign').click()`);
    await sleep(900);
    // Its colour mask goes back too, but is not listed: assigning the image assigns it.
    check('unassigned file (and its mask) go back to the queue', await evaluate(`document.querySelector('#files-tabs [data-tab="queue"]').textContent`) === 'To assign (' + (queued + 1) + ')');
    // Remove a file from the queue, see it under Removed, put it back.
    {
      await evaluate(`document.querySelector('#files-tabs [data-tab="queue"]').click()`);
      await sleep(400);
      await evaluate(`[...document.querySelectorAll('#files-list .file-card')][0].querySelectorAll('.file-buttons button').forEach(b => b.textContent === 'Remove' && b.click())`);
      await sleep(800);
      check('a file can be removed', await evaluate(`document.querySelector('#files-tabs [data-tab="queue"]').textContent`) === 'To assign (' + (queued + 1) + ')'
        && await evaluate(`document.querySelector('#files-tabs [data-tab="removed"]').textContent`) === 'Removed (1)');
      await evaluate(`document.querySelector('#files-tabs [data-tab="removed"]').click()`);
      await sleep(400);
      await evaluate(`document.querySelector('#files-list .file-card .file-buttons button').click()`);
      await sleep(800);
      check('a removed file can be put back', await evaluate(`document.querySelector('#files-tabs [data-tab="queue"]').textContent`) === 'To assign (' + (queued + 1) + ')');
      // Removed: search filters it; a removed file can be reassigned or deleted from the list.
      await evaluate(`(() => { const i = document.getElementById('files-search'); i.value = ''; i.dispatchEvent(new Event('input')); })()`);
      await evaluate(`document.querySelector('#files-tabs [data-tab="all"]').click()`);
      await sleep(400);
      const twoNames = await evaluate(`[...document.querySelectorAll('#files-list .file-card .file-name')].slice(0, 2).map((n) => n.textContent)`);
      for (const n of twoNames) {
        await evaluate(`(() => { const i = document.getElementById('files-search'); i.value = ${JSON.stringify(n)}; i.dispatchEvent(new Event('input')); })()`);
        await sleep(500);
        await evaluate(`[...document.querySelectorAll('#files-list .file-card')].find((c) => c.querySelector('.file-name').textContent === ${JSON.stringify(n)}).querySelectorAll('.file-buttons button').forEach(b => b.textContent === 'Remove' && b.click())`);
        await sleep(600);
      }
      await evaluate(`(() => { const i = document.getElementById('files-search'); i.value = ''; i.dispatchEvent(new Event('input')); })()`);
      await evaluate(`document.querySelector('#files-tabs [data-tab="removed"]').click()`);
      await sleep(500);
      const removedAll = await evaluate(`document.querySelectorAll('#files-list .file-card').length`);
      await evaluate(`(() => { const i = document.getElementById('files-search'); i.value = ${JSON.stringify(twoNames[0])}; i.dispatchEvent(new Event('input')); })()`);
      await sleep(500);
      const removedFound = await evaluate(`[...document.querySelectorAll('#files-list .file-card .file-name')].map((n) => n.textContent).join(',')`);
      check('search filters the Removed tab', removedAll >= 2 && removedFound === twoNames[0], `${removedAll} -> ${removedFound}`);
      check('removed files offer put back, reassign and delete', await evaluate(`[...document.querySelectorAll('#files-list .file-card button')].map((b) => b.textContent).join(',')`) === 'Put back,Reassign…,Delete');
      await evaluate(`[...document.querySelectorAll('#files-list .file-card button')].find((b) => b.textContent === 'Reassign…').click()`);
      await sleep(1200);
      check('reassign a removed file opens the assign dialog', await evaluate(`document.getElementById('assign-dialog').open && document.getElementById('assign-file').textContent.endsWith(${JSON.stringify(twoNames[0])})`));
      await evaluate(`document.querySelector('#assign-dialog button[value="cancel"]').click()`);
      await sleep(500);
      if (!(await evaluate(`document.getElementById('files-dialog').open`))) await evaluate(`document.getElementById('open-files').click()`);
      await evaluate(`document.querySelector('#files-tabs [data-tab="removed"]').click()`);
      await evaluate(`(() => { const i = document.getElementById('files-search'); i.value = ${JSON.stringify(twoNames[1])}; i.dispatchEvent(new Event('input')); })()`);
      await sleep(500);
      await evaluate(`[...document.querySelectorAll('#files-list .file-card button')].find((b) => b.textContent === 'Delete').click()`);
      await sleep(500);
      check('delete takes a file off the Removed list', (await evaluate(`document.querySelectorAll('#files-list .file-card').length`)) === 0
        && await evaluate(`Object.values(JSON.parse(localStorage.getItem('xgen-settings')).assignments).some((a) => a.deleted)`));
      await evaluate(`(() => { const i = document.getElementById('files-search'); i.value = ''; i.dispatchEvent(new Event('input')); })()`);
    }
    await evaluate(`document.querySelector('#files-dialog button[value="close"]').click()`);
    await evaluate(`(() => { const s = JSON.parse(localStorage.getItem('xgen-settings') || '{}'); delete s.assignments; localStorage.setItem('xgen-settings', JSON.stringify(s)); })()`);

    check('both body types offered, and All', await evaluate(`[...document.querySelectorAll('#body-type option')].map(o => o.value).join(',')`) === 'All,Male,Female');
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
      check('whole face can be mirrored', (await evaluate(faceSig)) !== beforeWhole && (await evaluate(`document.getElementById('image-transform-mark').textContent`)).includes('Portrait'));
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
    await evaluate(`document.querySelector('#variants .variant.selected, #other-variants .variant.selected').click()`);
    await sleep(600);
    // Parts that only exist on the face can't be moved on sprites (and say so).
    await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('Eyes')).click()`);
    await sleep(500);
    await click('#variants .variant:not(.selected)');
    await sleep(900);
    check('face-only part disables sprite offsets', await evaluate(`document.getElementById('off-sprite-x').disabled && !document.getElementById('off-face-x').disabled && document.getElementById('offsets-note').textContent.length > 0`));
    // Split the eyes into a left and a right eye and move one of them.
    await click('#split-item');
    await sleep(1500);
    const pieces = await evaluate(`[...document.querySelectorAll('#part-list button.piece')].length`);
    check('eyes split into pieces', pieces >= 2, `${pieces} pieces`);
    check('split status lists pieces per image', await evaluate(`/portrait [0-9]/.test(document.getElementById('pieces-status').textContent)`));
    if (pieces >= 2) {
      const beforePiece = await evaluate(faceSig);
      await evaluate(`document.querySelectorAll('#part-list button.piece')[1].click()`);
      await sleep(1200);
      check('a selected piece is shown on its own', await evaluate(`!document.getElementById('piece-preview').hidden && document.querySelectorAll('#piece-preview canvas').length >= 1`));
      await evaluate(`(() => { const i = document.getElementById('off-face-x'); i.value = 4; i.dispatchEvent(new Event('input')); })()`);
      await sleep(900);
      check('one piece moves on its own', (await evaluate(faceSig)) !== beforePiece);
      // Chain the two eyes, mirrored: moving one apart moves the other the opposite way.
      check('pieces can be chained', await evaluate(`!document.getElementById('link-box').hidden && document.querySelectorAll('#link-to option').length >= 2`));
      await evaluate(`(() => { const s = document.getElementById('link-to'); s.value = '1'; s.dispatchEvent(new Event('change')); })()`);
      await sleep(600);
      await evaluate(`(() => { const i = document.getElementById('off-face-x'); i.value = 3; i.dispatchEvent(new Event('input')); const r = document.getElementById('off-face-rot'); r.value = 10; r.dispatchEvent(new Event('input')); })()`);
      await sleep(900);
      check('chained pieces are marked', await evaluate(`[...document.querySelectorAll('#part-list button.piece')].filter(b => b.textContent.includes('⛓')).length === 2`));
      await evaluate(`document.querySelectorAll('#part-list button.piece')[0].click()`);
      await sleep(500);
      check('chained piece moves mirrored', await evaluate(`document.getElementById('off-face-x').value === '-3' && document.getElementById('off-face-rot').value === '-10'`), await evaluate(`document.getElementById('off-face-x').value + ' ' + document.getElementById('off-face-rot').value`));
      await shot('4b-split-eyes.png');
      await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('Eyes')).click()`);
      await sleep(500);
      await click('#unsplit-item');
      await sleep(900);
      check('pieces join again', (await evaluate(`document.querySelectorAll('#part-list button.piece').length`)) === 0);
      // Move two parts together: the eyes and the face.
      await sleep(600);
      await evaluate(`(() => { document.getElementById('layer-sheet').value = 'FG'; document.getElementById('layer-sheet').dispatchEvent(new Event('change')); const c = [...document.querySelectorAll('#layer-list .layer-row')].find(r => r.querySelector('.layer-name').textContent === 'Face').querySelector('input'); c.click(); })()`);
      check('a ticked layer moves together with the part', await evaluate(`document.getElementById('move-group-note').textContent.includes('Face')`));
      const eyesX = Number(await evaluate(`document.getElementById('off-face-x').value`));
      await evaluate(`(() => { const i = document.getElementById('off-face-x'); i.value = ${eyesX + 2}; i.dispatchEvent(new Event('input')); })()`);
      await sleep(600);
      await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('Face')).click()`);
      await sleep(600);
      check('parts ticked to move together move together', await evaluate(`document.getElementById('off-face-x').value === '2' && document.querySelectorAll('#layer-list input:checked:not(:disabled)').length > 0`),
        await evaluate(`document.getElementById('off-face-x').value`));
      // Back where they were: the face moved back with the eyes.
      await evaluate(`(() => { const i = document.getElementById('off-face-x'); i.value = 0; i.dispatchEvent(new Event('input')); })()`);
      await sleep(300);
      await evaluate(`[...document.querySelectorAll('#layer-list input:checked:not(:disabled)')].forEach(i => i.click())`);
    }
  // Split all / Join all, in All colours (the eyes worn here fall apart in two).
  {
    await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('All colours')).click()`);
    await sleep(500);
    await evaluate(`[...document.querySelectorAll('#slots button')].find(b => b.textContent === 'Split all').click()`);
    await sleep(2500);
    const pieces = await evaluate(`document.querySelectorAll('#part-list button.piece').length`);
    check('split all splits the worn parts', pieces > 0, `${pieces} pieces`);
    await evaluate(`[...document.querySelectorAll('#slots button')].find(b => b.textContent === 'Join all').click()`);
    await sleep(1200);
    check('join all joins them again', (await evaluate(`document.querySelectorAll('#part-list button.piece').length`)) === 0);
    // Split every part: also the parts put on later.
    await evaluate(`(() => { const b = document.querySelector('#slots .split-everything'); b.checked = true; b.dispatchEvent(new Event('change')); })()`);
    await sleep(2500);
    const before = await evaluate(`document.querySelectorAll('#part-list button.piece').length`);
    // The eyes taken off and put on again: split as soon as they are worn.
    await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('Eyes')).click()`);
    await sleep(800);
    const worn = await evaluate(`document.querySelector('#variants .variant.selected').title`).then((t) => t.split('\n').slice(0, 2).join('\n'));
    // Taken off: the worn part clicked again (there is no "None" tile).
    await evaluate(`document.querySelector('#variants .variant.selected').click()`);
    await sleep(1500);
    await evaluate(`[...document.querySelectorAll('#variants .variant')].find(b => b.title.startsWith(${JSON.stringify(worn)})).click()`);
    await sleep(2500);
    const eyesPieces = await evaluate(`(() => { const list = [...document.querySelectorAll('#part-list button')]; const i = list.findIndex(b => b.textContent.startsWith('Eyes')); return list.slice(i + 1).findIndex(b => !b.classList.contains('piece')); })()`);
    check('split every part also splits parts worn later', before > 0 && eyesPieces > 1, `${before} pieces, then ${eyesPieces} for the new eyes`);
    await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('All colours')).click()`);
    await sleep(500);
    await evaluate(`[...document.querySelectorAll('#slots button')].find(b => b.textContent === 'Join all').click()`);
    await sleep(1200);
    check('join all turns automatic splitting off', (await evaluate(`document.querySelectorAll('#part-list button.piece').length`)) === 0 && !(await evaluate(`document.querySelector('#slots .split-everything').checked`)));
    await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('Eyes')).click()`);
    await sleep(500);
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
      check('per image box shown', await evaluate(`!document.getElementById('sheet-parts-box').hidden && document.querySelectorAll('#sheet-parts .sheet-pick').length >= 1`));
      check('per image choices show a picture', await evaluate(`!!document.querySelector('#sheet-parts .sheet-pick canvas')`));
      check('the portrait image is not called Face', await evaluate(`[...document.querySelectorAll('#sheet-parts .sheet-row > span, #sheet-parts label, #sheet-parts b')].every(e => e.textContent.trim() !== 'Face') && document.getElementById('sheet-parts').textContent.includes('Portrait')`), await evaluate(`document.getElementById('sheet-parts').textContent.slice(0, 80)`));
      await click('#sheet-parts .sheet-pick');
      await sleep(1500);
      check('picture picker opens', await evaluate(`document.getElementById('pick-dialog').open && document.querySelectorAll('#pick-list .variant').length >= 2`));
      check('picture picker shows pictures', await evaluate(`[...document.querySelectorAll('#pick-list .variant')].filter(b => b.querySelector('canvas')).length >= 1`));
      await shot('4e-pick-picture.png');
      await evaluate(`[...document.querySelectorAll('#pick-list .variant')].find(b => b.title === 'Not drawn on this image').click()`);
      await sleep(1000);
      check('hidden on the face image', (await evaluate(faceSig)) !== beforeHide && !(await evaluate(`document.getElementById('pick-dialog').open`)));
      await click('#sheet-parts .sheet-pick');
      await sleep(800);
      await evaluate(`document.querySelector('#pick-list .variant').click()`);
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
      await evaluate(`[...document.querySelectorAll('.slot .swatch.add')].find(b => b.textContent.startsWith('Hue') && !b.disabled).click()`);
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
    check('there is no None tile', await evaluate(`![...document.querySelectorAll('#variants .variant')].some(b => b.title === 'None')`));
    await evaluate(`document.querySelector('#variants .variant.selected').click()`);
    await sleep(900);
    check('clicking the worn body again takes it off', await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('Body')).querySelector('.value').textContent`) === 'none');
  }

  // Optional: a pack with copies ("TV_Body_p01 (2).png", "(3)"), e.g. the official MV generator.
  if (process.env.ALIKE_PACK) {
    await evaluate(`localStorage.removeItem('xgen-settings')`);
    // A mask assigned by hand under the wrong variation (the tester's TV_FurClothes01_c case).
    await evaluate(`localStorage.setItem('xgen-settings', JSON.stringify({ assignments: { 'Generator|TV/Male/TV_FurClothes01b.png': { readAs: 'TV_Clothing_pTV-FurClothes01b_c.png', bodyType: 'Male' } } }))`);
    await send('Page.navigate', { url: `${URL_UNDER_TEST}&pack=${encodeURIComponent(process.env.ALIKE_PACK)}` });
    await sleep(9000);
    check('look-alikes dialog opens for near copies', await evaluate(`document.getElementById('alike-dialog').open`));
    const cards = await evaluate(`document.querySelectorAll('#alike-list .alike-card').length`);
    check('look-alikes are listed', cards >= 2, `${cards} cards`);
    check('exact duplicate is hidden', await evaluate(`[...document.querySelectorAll('#alike-list .alike-card')].some(c => c.textContent.includes('p01 (3)') && c.textContent.includes('same pixels') && c.classList.contains('hidden-part'))`));
    await sleep(1500);
    {
      // The larger preview opens inside the window, not behind it.
      const r = await evaluate(`(() => { const c = document.querySelector('#alike-list .alike-pics canvas'); const b = c.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r[0], y: r[1] });
      await sleep(300);
      check('the larger preview opens inside a window', await evaluate(`(() => { const p = document.querySelector('.big-preview'); return !p.hidden && !!p.closest('#alike-dialog'); })()`));
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
    }
    check('look-alikes have pictures and differences', await evaluate(`[...document.querySelectorAll('#alike-list .alike-card')].every(c => [...c.querySelectorAll('canvas')].every(x => x.width > 0))`));
    await shot('5-lookalikes.png');
    {
      // Search and part filter.
      const total = await evaluate(`document.querySelectorAll('#alike-list .alike-card').length`);
      await evaluate(`(() => { const i = document.getElementById('alike-search'); i.value = 'p01 female'; i.dispatchEvent(new Event('input')); })()`);
      await sleep(500);
      const found = await evaluate(`[...document.querySelectorAll('#alike-list .alike-card b')].map(b => b.textContent)`);
      await evaluate(`(() => { const i = document.getElementById('alike-search'); i.value = ''; i.dispatchEvent(new Event('input')); const s = document.getElementById('alike-part'); s.value = s.options[1].value; s.dispatchEvent(new Event('change')); })()`);
      await sleep(500);
      const part = await evaluate(`document.getElementById('alike-part').value`);
      const clothing = await evaluate(`[...document.querySelectorAll('#alike-list .alike-card b')].map(b => b.textContent)`);
      await evaluate(`(() => { const s = document.getElementById('alike-part'); s.value = ''; s.dispatchEvent(new Event('change')); })()`);
      await sleep(800);
      check('look-alikes can be searched and filtered by part', found.length > 0 && found.length < total && found.every((t) => t.includes('p01'))
        && clothing.length > 0 && !!part && clothing.every((t) => t.includes(` ${part} `)), `${total}: ${found.length} / ${part} ${clothing.length}`);
    }
    // Hide the near copy, then check the part list.
    await evaluate(`[...document.querySelectorAll('#alike-list .alike-card')].find(c => c.textContent.startsWith('Male Body p01 (2)')).querySelector('button').click()`);
    await sleep(500);
    {
      const shown = await evaluate(`document.querySelectorAll('#alike-list .alike-card').length`);
      await evaluate(`(() => { const c = document.getElementById('alike-hide-decided'); c.checked = true; c.dispatchEvent(new Event('change')); })()`);
      await sleep(800);
      const left = await evaluate(`document.querySelectorAll('#alike-list .alike-card').length`);
      check('decided look-alikes can be hidden from the list', left < shown && !(await evaluate(`[...document.querySelectorAll('#alike-list .alike-card')].some(c => c.textContent.includes('same pixels'))`)), `${shown} -> ${left}`);
      await evaluate(`(() => { const c = document.getElementById('alike-hide-decided'); c.checked = false; c.dispatchEvent(new Event('change')); })()`);
      await sleep(500);
    }
    // Hide all listed copies; then show again the ones that were shown before.
    {
      const before = await evaluate(`[...document.querySelectorAll('#alike-list .alike-card')].filter(c => !c.classList.contains('hidden-part')).map(c => c.querySelector('b').textContent)`);
      await evaluate(`document.getElementById('alike-hide-all').click()`);
      await sleep(800);
      check('all listed copies can be hidden at once', before.length > 0 && (await evaluate(`[...document.querySelectorAll('#alike-list .alike-card')].every(c => c.classList.contains('hidden-part'))`)), `${before.length} shown before`);
      for (const name of before) {
        await evaluate(`[...document.querySelectorAll('#alike-list .alike-card')].find(c => c.querySelector('b').textContent === ${JSON.stringify(name)})?.querySelector('button').click()`);
        await sleep(300);
      }
    }
    // Duplicates by their files: on demand, for every opened folder.
    await evaluate(`document.getElementById('alike-find').click()`);
    await sleep(6000);
    check('duplicates can be looked for by their files', await evaluate(`/duplicate/.test(document.getElementById('toast').textContent)`), await evaluate(`document.getElementById('toast').textContent`));
    check('hiding is remembered', await evaluate(`JSON.parse(localStorage.getItem('xgen-settings')).lookalikes[[...Object.keys(JSON.parse(localStorage.getItem('xgen-settings')).lookalikes)].find(k => k.endsWith('/Male/Body/p01 (2)'))] === 'hide'`));
    await evaluate(`document.querySelector('#alike-dialog button[value="close"]').click()`);
    // Reloaded: the list was seen, so it doesn't open again.
    await send('Page.navigate', { url: `${URL_UNDER_TEST}&pack=${encodeURIComponent(process.env.ALIKE_PACK)}` });
    await sleep(9000);
    check('look-alikes don\'t open again after a reload', !(await evaluate(`document.getElementById('alike-dialog').open`)));
    await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('Body')).click()`);
    await sleep(600);
    const bodies = await evaluate(`[...document.querySelectorAll('#variants .variant span')].map(s => s.textContent).join(',')`);
    check('hidden copies leave the part list', !bodies.includes('(2)') && !bodies.includes('(3)') && bodies.includes('p01'), bodies);
    // A part drawn without a colour mask can get one made by the generator.
    {
      const sheetSig = `(() => { const c = document.getElementById('sheet-canvas'); return [...c.getContext('2d').getImageData(0, 0, c.width, c.height).data].reduce((a, v, i) => (a + v * ((i % 251) + 1)) % 1000000007, 0); })()`;
      await evaluate(`(() => { const s = document.getElementById('sheet-view-select'); s.value = 'TV'; s.dispatchEvent(new Event('change')); document.getElementById('sheet-view').open = true; })()`);
      await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('Clothing')).click()`);
      await sleep(600);
      await evaluate(`[...document.querySelectorAll('#variants .variant, #other-variants .variant')].find(b => b.title.endsWith('/Clothing/pXX')).click()`);
      await sleep(1500);
      check('a part without a colour mask is recolourable straight away', await evaluate(`(() => { const s = document.querySelector('#slots .automask select'); return !!s && s.value === 'auto' && !!document.querySelector('#slots .automask .recolour-all:checked'); })()`));
      // Removing the made mask; then making one by hand, with 2 groups.
      await evaluate(`[...document.querySelectorAll('#slots .automask button')].find(b => b.textContent.startsWith('Remove')).click()`);
      await sleep(1500);
      const offered = await evaluate(`!!document.querySelector('#slots .automask button')`);
      check('a part without a colour mask offers to make one', offered, await evaluate(`[document.getElementById('editor-title').textContent, ...[...document.querySelectorAll('#variants .variant, #other-variants .variant')].filter(b => b.title.includes('pXX')).map(b => b.title.split(String.fromCharCode(10)).join(' ') + (b.classList.contains('selected') ? ' [selected]' : ''))].join(' | ')`));
      if (offered) {
      const beforeMask = await evaluate(sheetSig);
      await evaluate(`(() => { const s = document.querySelector('#slots .automask select'); s.value = '2'; [...document.querySelectorAll('#slots .automask button')].find(b => b.textContent.startsWith('Make')).click(); })()`);
      await sleep(2500);
      const groups = await evaluate(`document.querySelectorAll('#slots .automask-groups .layer-head').length`);
      check('the made mask splits the colours into groups', groups === 2, `${groups} groups`);
      check('the made mask offers colour slots', await evaluate(`[...document.querySelectorAll('.slot-head')].some(h => h.textContent.includes('Clothing main'))`));
      await evaluate(`[...document.querySelectorAll('.slot')].find(x => x.querySelector('.slot-head').textContent.includes('Clothing main')).querySelector('.swatch:not(.add)').click()`);
      await sleep(1500);
      check('a part with a made mask is recoloured', (await evaluate(sheetSig)) !== beforeMask);
      await shot('5b-automask.png');
      check('the made mask is remembered', await evaluate(`Object.keys(JSON.parse(localStorage.getItem('xgen-settings')).autoMasks || {}).some(k => k.endsWith('/Clothing/pXX'))`));
      await evaluate(`[...document.querySelectorAll('#slots .automask button')].find(b => b.textContent.startsWith('Remove')).click()`);
      await sleep(1500);
      check('the made mask can be removed', await evaluate(`!!document.querySelector('#slots .automask button') && [...document.querySelectorAll('#slots .automask button')].some(b => b.textContent.startsWith('Make'))`));
      check('a removed made mask stays removed', await evaluate(`Object.entries(JSON.parse(localStorage.getItem('xgen-settings')).autoMasks || {}).some(([k, v]) => k.endsWith('/Clothing/pXX') && v === false)`));
      }
    }
    // Hue, saturation and brightness work on the source colours too (no gradient picked).
    {
      const sheetSig = `(() => { const c = document.getElementById('sheet-canvas'); return [...c.getContext('2d').getImageData(0, 0, c.width, c.height).data].reduce((a, v, i) => (a + v * ((i % 251) + 1)) % 1000000007, 0); })()`;
      await evaluate(`(() => { const s = document.getElementById('sheet-view-select'); s.value = 'TV'; s.dispatchEvent(new Event('change')); document.getElementById('sheet-view').open = true; })()`);
      await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('Body')).click()`);
      await sleep(800);
      const beforeShift = await evaluate(sheetSig);
      check('hue, saturation and brightness are offered without a gradient', await evaluate(`[...([...document.querySelectorAll('.slot')].find(x => x.querySelector('.swatch.source.selected'))?.querySelectorAll('.swatch.add') || [])].at(-1)?.textContent.startsWith('Hue')`));
      await evaluate(`[...[...document.querySelectorAll('.slot')].find(x => x.querySelector('.swatch.source.selected')).querySelectorAll('.swatch.add')].at(-1).click()`);
      await sleep(500);
      await evaluate(`(() => { const i = document.getElementById('adjust-brightness'); i.value = 40; i.dispatchEvent(new Event('input')); })()`);
      await sleep(1200);
      check('shifting the source colours previews live', (await evaluate(sheetSig)) !== beforeShift);
      await evaluate(`document.querySelector('#adjust-dialog button[value="ok"]').click()`);
      await sleep(1000);
      check('shifted source colours are kept', (await evaluate(sheetSig)) !== beforeShift && await evaluate(`[...document.querySelectorAll('.slot .swatch.selected')].some(b => b.title.startsWith('Source colours (adjusted)'))`));
      await shot('5c-source-hsb.png');
    }
    // Every tile shows something: an empty first picture is skipped for one that shows the part.
    {
      await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('Clothing')).click()`);
      await sleep(3000);
      const empty = await evaluate(`[...document.querySelectorAll('#variants .variant canvas')].filter(c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 16) n++; return n < 12; }).length`);
      check('every part tile shows something', empty === 0, `${empty} empty tiles`);
    }
    // Variation icons: in All, a part with an icon shows it (RPG Maker MV's icons are 64x64).
    {
      await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('AccA')).click()`);
      await sleep(1500);
      const iconSig = `(() => { const c = document.querySelector('#variants .variant.has-icon canvas'); return c ? [...c.getContext('2d').getImageData(0, 0, c.width, c.height).data].reduce((a, v, i) => (a + v * ((i % 251) + 1)) % 1000000007, 0) : 0; })()`;
      await evaluate(`document.querySelector('#variants .variant.has-icon').click()`);
      await sleep(1500);
      const iconBefore = await evaluate(iconSig);
      await evaluate(`[...document.querySelectorAll('.slot')].find(x => x.querySelector('.slot-head').textContent.includes('Accessory A main'))?.querySelector('.swatch:not(.add):not(.selected)')?.click()`);
      await sleep(2000);
      check('variation icons are recoloured like their part', (await evaluate(iconSig)) !== iconBefore);
      check('tiles show the variation icon', await evaluate(`(() => { const t = document.querySelector('#variants .variant.has-icon canvas'); return !!t && t.width === 64 && t.height === 64; })()`));
    }
    // Pointing at a tile shows a large preview of it.
    {
      await evaluate(`document.querySelector('#variants .variant canvas').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`);
      await sleep(200);
      check('pointing at a tile shows a large preview', await evaluate(`(() => { const p = document.querySelector('.big-preview'); const c = p?.querySelector('canvas'); return !!c && !p.hidden && parseInt(c.style.width) >= 192; })()`));
      await evaluate(`document.querySelector('#variants .variant canvas').dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))`);
      await sleep(200);
      check('the large preview goes away', await evaluate(`document.querySelector('.big-preview').hidden`));
    }
    // All body types: every body type's parts in the main list, nothing under "other body types".
    {
      await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('Clothing')).click()`);
      await sleep(800);
      const everywhere = await evaluate(`document.querySelectorAll('#variants .variant, #other-variants .variant').length`);
      const offered = await evaluate(`[...document.getElementById('body-type').options].some(o => o.value === 'All')`);
      await evaluate(`(() => { const s = document.getElementById('body-type'); s.value = 'All'; s.dispatchEvent(new Event('change')); })()`);
      await sleep(1500);
      const main = await evaluate(`document.querySelectorAll('#variants .variant').length`);
      check('an All body types choice puts every part in the main list', offered && main === everywhere && (await evaluate(`document.getElementById('other-bodies').hidden`)), `${everywhere} -> ${main}`);
      check('switching to All body types keeps the worn parts', await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('Body')).textContent.includes('Male')`), await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('Body')).textContent`));
      await evaluate(`(() => { const s = document.getElementById('body-type'); s.value = 'Male'; s.dispatchEvent(new Event('change')); })()`);
      await sleep(1500);
    }
    // Sections per image: the damage section lists the parts with a damage picture, drawn as it.
    {
      await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('Clothing')).click()`);
      await sleep(800);
      const tabs = await evaluate(`[...document.querySelectorAll('#variant-tabs button')].map(b => b.textContent).join(',')`);
      check('parts are split into sections per image', tabs.startsWith('All (') && ['Walk (', 'Damage (', 'Battler ('].every((t) => tabs.includes(t)), tabs);
      const all = await evaluate(`document.querySelectorAll('#variants .variant, #other-variants .variant').length`);
      await evaluate(`[...document.querySelectorAll('#variant-tabs button')].find(b => b.textContent.startsWith('Damage')).click()`);
      await sleep(2500);
      const damage = await evaluate(`[...document.querySelectorAll('#variants .variant, #other-variants .variant')].map(b => b.title.split(String.fromCharCode(10)).pop())`);
      check('the damage section lists only parts with a damage picture', damage.length < all && damage.some((t) => t.endsWith('/Clothing/pMAGE')) && damage.some((t) => t.endsWith('/Clothing/pMAGE (2)')), `${all} -> ${damage.length}`);
      check('damage tiles are drawn as the damage picture', await evaluate(`(() => { const c = [...document.querySelectorAll('#variants .variant')].find(b => b.title.endsWith('/Clothing/pMAGE'))?.querySelector('canvas'); return !!c && c.width === 48 && c.height === 48; })()`));
      await shot('5d-damage-section.png');
      await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('All colours')).click()`);
      await sleep(600);
      check('All colours shows no image sections', await evaluate(`document.getElementById('variant-tabs').hidden`));
      await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('Clothing')).click()`);
      await sleep(600);
      await evaluate(`[...document.querySelectorAll('#variant-tabs button')].find(b => b.textContent.startsWith('All')).click()`);
      await sleep(500);
    }
    // TV_Clothing2_pXX_c.png is the mask of TV_Clothing2_pXX.png.png (the alternate), not of TV_Clothing2_pXX.png.
    await evaluate(`document.getElementById('open-files').click()`);
    await sleep(500);
    await evaluate(`document.querySelector('#files-tabs [data-tab="all"]').click()`);
    await evaluate(`(() => { const i = document.getElementById('files-search'); i.value = 'TV_Clothing2_pXX_c'; i.dispatchEvent(new Event('input')); })()`);
    await sleep(800);
    const maskReading = await evaluate(`document.querySelector('#files-list .file-reading')?.textContent || ''`);
    check('a mask goes with the same-named image it fits', maskReading.includes('pXX (alt)') && maskReading.includes('mask'), maskReading);
    await evaluate(`(() => { const i = document.getElementById('files-search'); i.value = 'SV_Clothing1_pXX.png'; i.dispatchEvent(new Event('input')); })()`);
    await sleep(800);
    const svReading = await evaluate(`document.querySelector('#files-list .file-reading')?.textContent || ''`);
    await evaluate(`(() => { const i = document.getElementById('files-search'); i.value = 'TV_FurClothes01b'; i.dispatchEvent(new Event('input')); })()`);
    await sleep(800);
    const furReading = await evaluate(`document.querySelector('#files-list .file-reading')?.textContent || ''`);
    check('a waiting mask joins the image it is named after', furReading.includes('Clothing pFur01') && furReading.includes('walk mask') && !furReading.includes('waiting'), furReading);
    // Reassigning the image (here: to the same reading) keeps its colour mask on it.
    await evaluate(`(() => { const i = document.getElementById('files-search'); i.value = 'TV_FurClothes01.png'; i.dispatchEvent(new Event('input')); })()`);
    await sleep(800);
    await evaluate(`document.querySelector('#files-list .file-card button').click()`);
    await sleep(1500);
    await evaluate(`document.querySelector('#assign-dialog button[value="ok"]').click()`);
    await sleep(1200);
    await evaluate(`(() => { const i = document.getElementById('files-search'); i.value = 'TV_FurClothes01b'; i.dispatchEvent(new Event('input')); })()`);
    await sleep(800);
    const afterReassign = await evaluate(`document.querySelector('#files-list .file-reading')?.textContent || ''`);
    check('reassigning an image keeps its colour mask on it', afterReassign.includes('Clothing pFur01') && afterReassign.includes('walk mask') && !afterReassign.includes('waiting'), afterReassign);
    check('the fixed mask is remembered', await evaluate(`JSON.parse(localStorage.getItem('xgen-settings')).assignments['Generator|TV/Male/TV_FurClothes01b.png'].readAs === 'TV_Clothing_pFur01_c.png'`));
    check('a battler file at walk size is read as a walk picture', svReading.includes('walk image') && svReading.includes('by its size'), svReading);
    await evaluate(`document.getElementById('files-dialog').close()`);
    await evaluate(`localStorage.removeItem('xgen-settings')`);
  }

  // FacialMark: a colour is recommended (not applied), the user can pick any.
  // Folders: move a folder's parts to another body type; remove a folder, and undo.
  if (process.env.ALIKE_PACK) {
    if (!(await evaluate(`document.getElementById('files-dialog').open`))) await evaluate(`document.getElementById('open-files').click()`);
    await sleep(400);
    await evaluate(`(() => { const i = document.getElementById('files-search'); i.value = ''; i.dispatchEvent(new Event('input')); })()`);
    await evaluate(`document.querySelector('#files-tabs [data-tab="folders"]').click()`);
    await sleep(600);
    const folders = await evaluate(`[...document.querySelectorAll('#files-list .folder-row b')].map(b => b.textContent)`);
    check('folders are listed', folders.includes('SV/Kid') && folders.includes('Face/Male'), folders.join(','));
    const row = (dir) => `[...document.querySelectorAll('#files-list .folder-row')].find(r => r.querySelector('b').textContent === ${JSON.stringify(dir)})`;
    await evaluate(`(() => { const r = ${row('SV/Kid')}; r.querySelector('select').value = 'Female'; r.querySelector('select').dispatchEvent(new Event('change')); [...r.querySelectorAll('button')].find(b => b.textContent.startsWith('Move')).click(); })()`);
    await sleep(2500);
    if (!(await evaluate(`document.getElementById('files-dialog').open`))) await evaluate(`document.getElementById('open-files').click()`);
    await evaluate(`document.querySelector('#files-tabs [data-tab="folders"]').click()`);
    await sleep(500);
    check('moving all files removes the source row and keeps the destination', await evaluate(`!${row('SV/Kid')} && !!${row('Female')}`));
    check('the move is remembered', await evaluate(`Object.entries(JSON.parse(localStorage.getItem('xgen-settings')).assignments).some(([k, v]) => k.includes('SV/Kid/') && v.bodyType === 'Female')`));
    const removedBefore = await evaluate(`parseInt(document.querySelector('#files-tabs [data-tab="removed"]').textContent.match(/\\d+/)[0])`);
    await evaluate(`[...${row('Face/Kid')}.querySelectorAll('button')].find(b => b.textContent.startsWith('Remove')).click()`);
    await sleep(1500);
    const removedAfter = await evaluate(`parseInt(document.querySelector('#files-tabs [data-tab="removed"]').textContent.match(/\\d+/)[0])`);
    check('a folder can be removed', removedAfter > removedBefore + 10 && !(await evaluate(`!!${row('Face/Kid')}`)), `${removedBefore} -> ${removedAfter}`);
    await evaluate(`[...document.querySelectorAll('#toast button')].find(b => b.textContent === 'Undo')?.click()`);
    await sleep(1500);
    check('removing a folder can be undone', (await evaluate(`parseInt(document.querySelector('#files-tabs [data-tab="removed"]').textContent.match(/\\d+/)[0])`)) === removedBefore);
    // A whole body type into another, in every folder at once.
    await evaluate(`(() => { const r = document.querySelector('#files-list .body-row'); r.querySelector('.body-from').value = 'Kid'; r.querySelector('.body-to').value = 'Male'; r.querySelector('.body-to').dispatchEvent(new Event('change')); r.querySelector('button').click(); })()`);
    await sleep(8000);
    check('a whole body type moves into another', !(await evaluate(`[...document.getElementById('body-type').options].some(o => o.value === 'Kid')`)), await evaluate(`document.getElementById('toast').textContent`));
    // The emptied folder: asked about, and removed from the lists.
    check('an emptied folder asks to be removed', await evaluate(`document.getElementById('empty-folder-dialog').open && /"Kid"/.test(document.getElementById('empty-folder-text').textContent)`));
    await evaluate(`document.querySelector('#empty-folder-dialog button[value="remove"]').click()`);
    await sleep(600);
    check('a removed empty folder is no longer offered', !(await evaluate(`[...document.querySelectorAll('#files-list .body-to option')].some(o => o.value === 'Kid')`)));
    // Remove folder next to Create folder: a created, empty folder goes.
    await evaluate(`(() => { const r = document.querySelector('#files-list .folder-new'); r.querySelector('input').value = 'Smoke folder'; [...r.querySelectorAll('button')].find(b => b.textContent === 'Create folder').click(); })()`);
    await sleep(400);
    await evaluate(`(() => { const r = [...document.querySelectorAll('#files-list .folder-new')].find(r => /Remove a body type folder/.test(r.textContent)); const s = r.querySelector('select'); s.value = 'Smoke folder'; s.dispatchEvent(new Event('change')); r.querySelector('button').click(); })()`);
    await sleep(400);
    check('an empty folder can be removed next to Create folder', !(await evaluate(`[...document.querySelectorAll('#files-list .body-to option')].some(o => o.value === 'Smoke folder')`)));
    if (await evaluate(`document.getElementById('files-dialog').open`)) await evaluate(`document.querySelector('#files-dialog button[value="close"]').click()`);
  }
  if (process.env.MARK_PACK) {
    await send('Page.navigate', { url: `${URL_UNDER_TEST.replace(/\?.*$/, '')}?pack=${encodeURIComponent(process.env.MARK_PACK)}` });
    await sleep(8000);
    await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('FacialMark')).click()`);
    await sleep(400);
    await click('#variants .variant:not(.selected)');
    await sleep(1200);
    check('facial mark gets a recommended colour', await evaluate(`!!document.querySelector('.slot .swatch.top-pick') && [...document.querySelectorAll('.swatch-group')].some(g => g.textContent.startsWith('Recommended for facial mark'))`));
    check('the recommendation is not applied by itself', await evaluate(`document.querySelector('.slot .swatch.source').classList.contains('selected')`));
    await shot('1b-facialmark.png');
    await evaluate(`document.querySelector('#variants .variant.selected')?.click()`);
    await sleep(600);
    // A look-alike whose file is removed leaves the list instead of showing an empty picture.
    {
      const alt = `[...document.querySelectorAll('#alike-list .alike-card')].find(c => c.querySelector('b').textContent.startsWith('Male FrontHair p17 (alt)'))`;
      await evaluate(`document.getElementById('open-alikes').click()`);
      await evaluate(`(() => { const c = document.getElementById('alike-all'); c.checked = true; c.dispatchEvent(new Event('change')); })()`);
      await sleep(300);
      const listed = await evaluate(`!!${alt}`);
      await evaluate(`document.getElementById('alike-dialog').close()`);
      await evaluate(`document.getElementById('open-files').click()`);
      await sleep(400);
      await evaluate(`(() => { const i = document.getElementById('files-search'); i.value = 'FG_FrontHair_p17_c1]'; i.dispatchEvent(new Event('input')); })()`);
      await sleep(800);
      await evaluate(`[...document.querySelectorAll('#files-list button')].find(b => b.textContent === 'Remove').click()`);
      await sleep(2000);
      if (await evaluate(`document.getElementById('files-dialog').open`)) await evaluate(`document.querySelector('#files-dialog button[value="close"]').click()`);
      await evaluate(`document.getElementById('open-alikes').click()`);
      await sleep(1500);
      const pictured = await evaluate(`[...document.querySelectorAll('#alike-list .alike-card')].every(c => [...c.querySelectorAll('canvas')].every(x => x.width > 0))`);
      check('a look-alike whose file is removed leaves the list', listed && !(await evaluate(`!!${alt}`)) && pictured);
      await evaluate(`document.getElementById('alike-dialog').close()`);
    }
  }
  // VX Ace generator folder: painted colours, 128px faces, 32px walk frames.
  if (process.env.VX_PACK) {
    await send('Page.navigate', { url: `${URL_UNDER_TEST.replace(/\?.*$/, '')}?pack=${encodeURIComponent(process.env.VX_PACK)}` });
    await sleep(600);
    // Locally a pack opens too fast to see the bar: show it by hand for the picture.
    await evaluate(`(() => { const b = document.getElementById('busy'); b.hidden = false; b.classList.remove('done'); document.getElementById('busy-label').textContent = 'Looking for look-alikes (120 of 300)'; document.getElementById('busy-fill').className = 'busy-fill'; document.getElementById('busy-fill').style.width = '40%'; })()`);
    await shot('6a-busy.png');
    await evaluate(`document.getElementById('busy').hidden = true`);
    await sleep(5400);
    check('VX Ace folder loads as parts', await evaluate(`[...document.querySelectorAll('#part-list button')].some(b => b.textContent.startsWith('FrontHair')) && document.getElementById('face-canvas').width === 128`));
    check('VX Ace walk frames are 32px', await evaluate(`document.getElementById('walk-canvas').width === 32`));
    await evaluate(`[...document.querySelectorAll('#part-list button')].find(b => b.textContent.startsWith('FrontHair')).click()`);
    await sleep(500);
    await click('#variants .variant:not(.selected)');
    await sleep(1500);
    const faceSig = `[...document.getElementById('face-canvas').getContext('2d').getImageData(0,0,128,128).data].reduce((a, v, i) => (a + v * ((i % 251) + 1)) % 1000000007, 0)`;
    const swatches = await evaluate(`document.querySelectorAll('.slot .swatch.painted').length`);
    check('VX Ace hair shows painted colour swatches', swatches >= 8, `${swatches} swatches`);
    const beforePaint = await evaluate(faceSig);
    await evaluate(`document.querySelectorAll('.slot .swatch.painted')[5].click()`);
    await sleep(1200);
    check('a painted colour repaints the hair', (await evaluate(faceSig)) !== beforePaint);
    await shot('6-vxace.png');
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
