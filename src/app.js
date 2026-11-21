// UI controller. All heavy lifting lives in the pure modules; this file wires them to the DOM.

import { SHEET_KEYS, SLOTS, SLOT_BY_ID, DEFAULT_SETTINGS, REQUIRED_PARTS } from './format.js';
import { createLibrary, addPack, variantLabel } from './parse.js';
import { createCustomGradient, gradientsToImage, preferredCategory } from './gradients.js';
import { composeSheet, selectedVariants } from './compose.js';
import {
  createCharacter, applyDefaults, partNames, usedSlots, randomize, resolveVariant,
  serializeCharacter, deserializeCharacter,
} from './character.js';
import {
  entriesFromFileList, entriesFromDrop, packNameFromEntries, sampleKitEntries, ensureImage,
  ensureVariants, loadGradients, toCanvas, downloadBlob, downloadImage,
} from './loader.js';

const ALL_COLOURS = '__colours';
const SV_MOTIONS = ['walk', 'wait', 'chant', 'guard', 'damage', 'evade', 'thrust', 'swing', 'missile',
  'skill', 'spell', 'item', 'escape', 'victory', 'dying', 'abnormal', 'sleep', 'dead'];
const SHEET_FILE_NAMES = {
  FG: (n) => `${n}_face.png`,
  TV: (n) => `$${n}.png`,
  TVD: (n) => `${n}_damage.png`,
  SV: (n) => `${n}.png`,
};

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

const state = {
  library: createLibrary(),
  loadedGradientFiles: 0,
  fileGradients: [],
  customGradients: [],
  character: null,
  settings: loadSettings(),
  selectedPart: ALL_COLOURS,
  locked: new Set(),
  walkDir: 0,
  svMotion: 0,
  composites: {},
  problems: [],
  editorToken: 0,
  previewToken: 0,
};

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('xgen-settings') || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
function saveSettings() {
  try {
    localStorage.setItem('xgen-settings', JSON.stringify(state.settings));
  } catch { /* storage unavailable: settings just won't persist */ }
}

function allGradients() {
  return [...state.fileGradients, ...state.customGradients];
}
function gradientsById() {
  return new Map(allGradients().map((g) => [g.id, g]));
}
function currentBody() {
  return state.character ? state.library.bodyTypes.get(state.character.bodyType) : null;
}

let toastTimer;
function toast(message) {
  const t = $('toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}

// ---------- importing ----------

async function importEntries(entries, packName) {
  const pngs = entries.filter((e) => /\.png$/i.test(e.path));
  if (!pngs.length) {
    toast('No PNG files found in that folder.');
    return;
  }
  const pack = addPack(state.library, packName, pngs);

  const newGradientFiles = { ...state.library, gradientFiles: state.library.gradientFiles.slice(state.loadedGradientFiles) };
  state.loadedGradientFiles = state.library.gradientFiles.length;
  const { gradients, errors } = await loadGradients(newGradientFiles);
  state.fileGradients.push(...gradients);
  state.problems.push(...errors);

  if (!state.library.bodyTypes.size) {
    toast('No generator parts recognised. See the import report.');
    showApp();
    renderProblems();
    return;
  }
  if (!state.character) {
    const bodyType = state.library.bodyTypes.has('Male') ? 'Male' : [...state.library.bodyTypes.keys()][0];
    state.character = applyDefaults(createCharacter(bodyType), state.library.bodyTypes.get(bodyType));
    assignDefaultColours();
  }
  const partCount = [...state.library.bodyTypes.values()].reduce((n, b) => n + [...b.parts.values()].reduce((m, v) => m + v.size, 0), 0);
  toast(`Added "${pack.name}": ${state.library.bodyTypes.size} body type(s), ${partCount} parts, ${allGradients().length} colours.`);
  showApp();
  renderAll();
}

function assignDefaultColours() {
  const gradients = allGradients();
  if (!gradients.length) return;
  for (const slot of SLOTS) {
    if (state.character.colors[slot.id]) continue;
    const preferred = gradients.filter((g) => g.category === preferredCategory(slot.id));
    state.character.colors[slot.id] = (preferred[0] || gradients[0]).id;
  }
}

function showApp() {
  $('app').classList.remove('empty');
  $('welcome').hidden = true;
  for (const id of ['sidebar', 'editor', 'preview']) $(id).hidden = false;
  for (const id of ['randomize', 'save-character', 'load-character']) $(id).disabled = false;
}

// ---------- rendering ----------

function renderAll() {
  renderSidebar();
  renderEditor();
  renderPreview();
  renderProblems();
}

function renderSidebar() {
  const body = currentBody();
  const select = $('body-type');
  select.replaceChildren(...[...state.library.bodyTypes.keys()].map((name) => el('option', { value: name, textContent: name })));
  select.value = state.character.bodyType;
  $('character-name').value = state.character.name;

  const list = $('part-list');
  const items = [[ALL_COLOURS, 'All colours', '']];
  for (const part of partNames(body)) {
    const id = state.character.parts[part];
    const variant = id && body.parts.get(part).get(id);
    items.push([part, part, variant ? variant.pid : 'none']);
  }
  list.replaceChildren(...items.map(([key, label, value]) => {
    const button = el('button', { className: key === state.selectedPart ? 'active' : '' }, [
      el('span', { textContent: label + (state.locked.has(key) ? ' 🔒' : '') }),
      el('span', { className: 'value', textContent: value }),
    ]);
    button.addEventListener('click', () => {
      state.selectedPart = key;
      renderSidebar();
      renderEditor();
    });
    return button;
  }));

  $('packs').replaceChildren(
    el('div', { textContent: 'Packs' }),
    ...state.library.packs.map((p) => el('div', { textContent: `• ${p.name} (${p.fileCount} files)` })),
  );
}

async function renderEditor() {
  const body = currentBody();
  const part = state.selectedPart;
  const isColours = part === ALL_COLOURS;
  $('editor-title').textContent = isColours ? 'All colours' : part;
  $('lock-part').checked = state.locked.has(part);
  $('lock-part').parentElement.hidden = isColours;

  const variantsBox = $('variants');
  variantsBox.replaceChildren();
  if (!isColours) {
    const variants = [...(body.parts.get(part)?.values() || [])];
    const options = REQUIRED_PARTS.has(part) ? variants : [null, ...variants];
    for (const variant of options) variantsBox.append(variantTile(part, variant));
  }

  // Slots depend on decoded masks, so make sure the relevant variants are decoded first.
  const token = ++state.editorToken;
  await ensureVariants(selectedVariants(state.character, body));
  if (token !== state.editorToken) return;
  renderSlots();
}

function variantTile(part, variant) {
  const selected = (state.character.parts[part] || null) === (variant?.id || null);
  const tile = el('button', { className: 'variant' + (selected ? ' selected' : ''), title: variant ? variant.id : 'None' });
  const thumb = el('div', { className: 'placeholder', textContent: variant ? '?' : '∅' });
  tile.append(thumb, el('span', { textContent: variant ? variantLabel(state.library, variant) : 'None' }));
  if (variant?.icon) {
    ensureImage(variant.icon).then((pixels) => thumb.replaceWith(toCanvas(pixels))).catch(() => {});
  }
  tile.addEventListener('click', () => {
    state.character.parts[part] = variant?.id || null;
    renderSidebar();
    renderEditor();
    renderPreview();
  });
  return tile;
}

function slotsForEditor() {
  const body = currentBody();
  if (state.selectedPart === ALL_COLOURS) return usedSlots(state.character, body);
  const id = state.character.parts[state.selectedPart];
  const variant = id && body.parts.get(state.selectedPart)?.get(id);
  if (!variant) return [];
  const ids = new Set();
  for (const layer of variant.layers) {
    if (layer.slotId) ids.add(layer.slotId);
    layer.mask?.slots?.forEach((s) => ids.add(s));
  }
  return SLOTS.filter((s) => ids.has(s.id));
}

const swatchCache = new Map();
function swatchImage(gradient) {
  if (!swatchCache.has(gradient.id)) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 1;
    canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(gradient.colors), 256, 1), 0, 0);
    swatchCache.set(gradient.id, canvas.toDataURL());
  }
  return swatchCache.get(gradient.id);
}

function renderSlots() {
  const box = $('slots');
  const slots = slotsForEditor();
  if (!slots.length) {
    box.replaceChildren(el('p', { className: 'muted', textContent: state.selectedPart === ALL_COLOURS ? 'The selected parts have no recolourable areas.' : 'This part has no recolourable areas.' }));
    return;
  }
  const gradients = allGradients();
  box.replaceChildren(...slots.map((slot) => {
    const preferred = preferredCategory(slot.id);
    const groups = new Map();
    for (const g of gradients) {
      const key = g.source === 'custom' ? 'Your colours' : g.category === preferred ? 'Suggested' : 'Other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(g);
    }
    const ordered = ['Suggested', 'Your colours', 'Other'].filter((k) => groups.has(k));
    const hex = '#' + slot.rgb.toString(16).padStart(6, '0');
    const wrap = el('div', { className: 'slot' }, [
      el('div', { className: 'slot-head' }, [
        el('span', { className: 'key', style: `background:${hex}` }),
        el('span', { textContent: slot.label }),
      ]),
    ]);
    for (const key of ordered) {
      if (ordered.length > 1) wrap.append(el('div', { className: 'swatch-group', textContent: key }));
      wrap.append(el('div', { className: 'swatches' }, groups.get(key).map((g) => swatchButton(slot, g))));
    }
    const add = el('button', { className: 'swatch add', textContent: '+ New', title: 'Make your own gradient' });
    add.addEventListener('click', () => openGradientDialog(slot));
    wrap.append(el('div', { className: 'swatches', style: 'margin-top:5px' }, [add]));
    return wrap;
  }));
}

function swatchButton(slot, gradient) {
  const selected = state.character.colors[slot.id] === gradient.id;
  const img = el('img', { src: swatchImage(gradient), alt: gradient.label, width: 54, height: 14 });
  img.style.cssText = 'width:54px;height:14px;display:block;image-rendering:auto';
  const button = el('button', { className: 'swatch' + (selected ? ' selected' : ''), title: gradient.label }, [img]);
  button.addEventListener('click', () => {
    state.character.colors[slot.id] = gradient.id;
    renderSlots();
    renderPreview();
  });
  return button;
}

async function renderPreview() {
  const body = currentBody();
  const token = ++state.previewToken;
  const errors = await ensureVariants(selectedVariants(state.character, body));
  if (token !== state.previewToken) return;
  const byId = gradientsById();
  const problems = [...errors];
  for (const sheet of SHEET_KEYS) {
    const { image, problems: p } = composeSheet(sheet, state.character, body, byId, state.settings);
    problems.push(...p);
    state.composites[sheet] = image ? { image, canvas: toCanvas(image) } : null;
  }
  state.renderProblems = problems;
  const face = state.composites.FG;
  const faceCanvas = $('face-canvas');
  const ctx = faceCanvas.getContext('2d');
  if (face) {
    faceCanvas.width = face.image.width;
    faceCanvas.height = face.image.height;
    ctx.drawImage(face.canvas, 0, 0);
  } else {
    ctx.clearRect(0, 0, faceCanvas.width, faceCanvas.height);
  }
  const damage = state.composites.TVD;
  const dmgCtx = $('damage-canvas').getContext('2d');
  dmgCtx.clearRect(0, 0, 144, 48);
  if (damage) dmgCtx.drawImage(damage.canvas, 0, 0);
  renderProblems();
}

function renderProblems() {
  const lib = state.library;
  const lines = [
    ...lib.unrecognized.map((u) => `Skipped ${u.path} (${u.reason})`),
    ...lib.warnings,
    ...state.problems,
    ...(state.renderProblems || []),
  ];
  $('problems').hidden = !lines.length;
  $('problem-list').replaceChildren(
    el('p', { className: 'muted small', textContent: `${lines.length} note(s). Parts that were skipped don't stop the rest from loading.` }),
    el('ul', {}, lines.slice(0, 500).map((l) => el('li', { textContent: l }))),
  );
}

// ---------- animation ----------

const PATTERN = [0, 1, 2, 1];
let tick = 0;
function animate() {
  tick = (tick + 1) % PATTERN.length;
  const frame = PATTERN[tick];

  const walk = state.composites.TV;
  const wctx = $('walk-canvas').getContext('2d');
  wctx.clearRect(0, 0, 48, 48);
  if (walk) wctx.drawImage(walk.canvas, frame * 48, state.walkDir * 48, 48, 48, 0, 0, 48, 48);

  const sv = state.composites.SV;
  const sctx = $('sv-canvas').getContext('2d');
  sctx.clearRect(0, 0, 64, 64);
  if (sv) {
    const m = state.svMotion;
    sctx.drawImage(sv.canvas, (Math.floor(m / 6) * 3 + frame) * 64, (m % 6) * 64, 64, 64, 0, 0, 64, 64);
  }
}
setInterval(animate, 180);

// ---------- custom gradients ----------

let dialogSlot = null;
function drawGradientPreview() {
  const g = createCustomGradient('preview', '', dialogStops());
  $('gradient-preview').getContext('2d').putImageData(new ImageData(g.colors.slice(), 256, 1), 0, 0);
  const ctx = $('gradient-preview').getContext('2d');
  for (let y = 1; y < 16; y++) ctx.drawImage($('gradient-preview'), 0, 0, 256, 1, 0, y, 256, 1);
}
function dialogStops() {
  const stops = [{ pos: 0, color: $('stop-0').value }, { pos: 0.6, color: $('stop-1').value }, { pos: 1, color: $('stop-2').value }];
  return state.settings.invertGradient ? stops.map((s) => ({ ...s, pos: 1 - s.pos })) : stops;
}
function openGradientDialog(slot) {
  dialogSlot = slot;
  $('gradient-name').value = `${slot.label} colour`;
  drawGradientPreview();
  $('gradient-dialog').showModal();
}
for (const id of ['stop-0', 'stop-1', 'stop-2']) $(id).addEventListener('input', drawGradientPreview);
$('gradient-dialog').addEventListener('close', () => {
  if ($('gradient-dialog').returnValue !== 'ok' || !dialogSlot) return;
  const id = `custom/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const gradient = createCustomGradient(id, $('gradient-name').value || 'Custom', dialogStops());
  state.customGradients.push(gradient);
  state.character.colors[dialogSlot.id] = id;
  renderSlots();
  renderPreview();
});

// ---------- events ----------

$('folder-input').addEventListener('change', async (e) => {
  const entries = entriesFromFileList(e.target.files);
  e.target.value = '';
  await importEntries(entries, packNameFromEntries(entries));
});

async function loadSampleKit() {
  try {
    await importEntries(await sampleKitEntries(), 'Sample kit');
  } catch (err) {
    toast(`Could not load the sample kit: ${err.message}`);
  }
}
$('sample-kit').addEventListener('click', loadSampleKit);
// Demo link: index.html?sample loads the sample kit straight away.
if (new URLSearchParams(location.search).has('sample')) loadSampleKit();

document.addEventListener('dragover', (e) => {
  e.preventDefault();
  $('app').classList.add('dragging');
});
document.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) $('app').classList.remove('dragging');
});
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  $('app').classList.remove('dragging');
  const entries = await entriesFromDrop(e.dataTransfer);
  const json = entries.find((x) => /\.json$/i.test(x.path));
  if (json && entries.length === 1) await loadCharacterFile(json.src);
  else await importEntries(entries, packNameFromEntries(entries, 'Dropped files'));
});

$('body-type').addEventListener('change', (e) => {
  const body = state.library.bodyTypes.get(e.target.value);
  const parts = {};
  for (const [part, id] of Object.entries(state.character.parts)) parts[part] = id ? resolveVariant(body, part, id) : null;
  state.character = applyDefaults({ ...state.character, bodyType: e.target.value, parts }, body);
  if (state.selectedPart !== ALL_COLOURS && !body.parts.has(state.selectedPart)) state.selectedPart = ALL_COLOURS;
  renderAll();
});

$('character-name').addEventListener('input', (e) => {
  state.character.name = e.target.value;
});

$('lock-part').addEventListener('change', (e) => {
  if (e.target.checked) state.locked.add(state.selectedPart);
  else state.locked.delete(state.selectedPart);
  renderSidebar();
});

$('randomize').addEventListener('click', () => {
  state.character = randomize(state.character, currentBody(), allGradients(), { locked: state.locked });
  renderAll();
});

$('dir-buttons').addEventListener('click', (e) => {
  const dir = e.target.dataset?.dir;
  if (dir == null) return;
  state.walkDir = Number(dir);
  for (const b of $('dir-buttons').children) b.classList.toggle('active', b.dataset.dir === dir);
});
$('dir-buttons').children[0].classList.add('active');

$('sv-motion').replaceChildren(...SV_MOTIONS.map((m, i) => el('option', { value: i, textContent: m })));
$('sv-motion').addEventListener('change', (e) => (state.svMotion = Number(e.target.value)));

$('invert-gradient').checked = state.settings.invertGradient;
$('invert-gradient').addEventListener('change', (e) => {
  state.settings.invertGradient = e.target.checked;
  saveSettings();
  if (state.character) renderPreview();
});

function safeFileName(name) {
  return (name || 'character').replace(/[\\/:*?"<>|]+/g, '').trim() || 'character';
}

document.querySelector('.export').addEventListener('click', async (e) => {
  const sheet = e.target.dataset?.export;
  if (!sheet) return;
  const name = safeFileName(state.character.name);
  const sheets = sheet === 'all' ? SHEET_KEYS : [sheet];
  let count = 0;
  for (const key of sheets) {
    const c = state.composites[key];
    if (!c) continue;
    await downloadImage(c.image, SHEET_FILE_NAMES[key](name));
    count++;
  }
  if (sheet === 'all' && state.customGradients.length) {
    await downloadImage(gradientsToImage(state.customGradients), `${name}_custom_gradients.png`);
  }
  toast(count ? `Exported ${count} image(s).` : 'Nothing to export for this sheet: no parts have layers for it.');
});

$('save-character').addEventListener('click', () => {
  const json = serializeCharacter(state.character, state.customGradients);
  downloadBlob(new Blob([json], { type: 'application/json' }), `${safeFileName(state.character.name)}.json`);
});

async function loadCharacterFile(file) {
  try {
    const { character, customGradients, missing } = deserializeCharacter(await file.text(), state.library);
    for (const g of customGradients) {
      if (!state.customGradients.some((x) => x.id === g.id)) state.customGradients.push(g);
    }
    state.character = applyDefaults(character, state.library.bodyTypes.get(character.bodyType));
    renderAll();
    toast(missing.length ? `Loaded, but missing: ${missing.join(', ')}` : `Loaded ${character.name}.`);
  } catch (err) {
    toast(`Could not load character: ${err.message}`);
  }
}

$('load-character').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) await loadCharacterFile(file);
});
