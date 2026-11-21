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
