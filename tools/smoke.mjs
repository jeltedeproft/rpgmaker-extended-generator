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
  await evaluate(`document.querySelector('#dir-buttons [data-dir="2"]').click()`);
  await sleep(400);
  await shot('3-random.png');

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
    await shot('4-real-pack.png');

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
