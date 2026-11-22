// UI controller. All heavy lifting lives in the pure modules; this file wires them to the DOM.

import { SHEET_KEYS, SLOTS, DEFAULT_SETTINGS, PART_ORDER, DEFAULT_SIZE, SHEETS, SLOT_BY_ID } from './format.js';
import { createLibrary, addPack, variantLabel, variantsForPart, TEXT_FILE_RE, assignFile, buildPartName, parsePartPath, unassignFile, libraryFiles } from './parse.js';
import { createCustomGradient, gradientsToImage, preferredCategory } from './gradients.js';
import {
  composeSheet, selectedVariants, variantsToDecode, variantForSheet, partOfKey, itemColor,
  layersForSheet, drawId, moveLayer, itemOfKey, pieceKeys, countPieces, selectedItems, sheetLayers,
} from './compose.js';
import { createImage, scanMask } from './recolor.js';
import {
  createCharacter, applyDefaults, partNames, usedSlots, randomize, resolveVariant,
  serializeCharacter, deserializeCharacter, isGeneratorSettings, itemKeys, addItem, removeItem, creditsFor, creditsText,
  makeSet, applySet, DEFAULT_RULES, wearChance,
} from './character.js';
import {
  entriesFromFileList, entriesFromDrop, packNameFromEntries, sampleKitEntries, ensureImage,
  ensureVariants, loadGradients, toCanvas, downloadBlob, downloadImage,
  canRememberFolders, pickFolder, entriesFromHandle, rememberFolder, forgetFolder, rememberedFolders,
  ensureReadPermission, readText, ensureLayers,
} from './loader.js';

const ALL_COLOURS = '__colours';
const SV_MOTIONS = ['Walk', 'Wait', 'Chant', 'Guard', 'Damage', 'Evade', 'Thrust', 'Swing', 'Missile',
  'Skill', 'Spell', 'Item', 'Escape', 'Victory', 'Dying', 'Abnormal', 'Sleep', 'Dead'];
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
  /** Slots whose "Other colours" list is unfolded; kept open while picking. */
  openColourLists: new Set(),
  walkDir: 0,
  svMotion: 0,
  composites: {},
  problems: [],
  renderProblems: [],
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

let toastTimer;
function toast(message, ms = 4000) {
  const t = $('toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

// ---------- importing ----------

async function importEntries(entries, packName) {
  const pngs = entries.filter((e) => /\.png$/i.test(e.path));
  if (!pngs.length) {
    toast('No PNG files found in that folder.');
    return;
  }
  const partsBefore = state.library.variants.size;
  const gradientFilesBefore = state.library.gradientFiles.length;
  const texts = entries.filter((e) => TEXT_FILE_RE.test(e.path));
  const pack = addPack(state.library, packName, [...pngs, ...texts]);
  // Character presets shipped with the pack (RPG Maker MZ generator .json files, or ours).
  pack.presets = [];
  for (const e of entries.filter((x) => /\.json$/i.test(x.path)).slice(0, 200)) {
    try {
      const text = await readText(e.src);
      const data = JSON.parse(text);
      if (isGeneratorSettings(data) || data.format === 'rpgmaker-xgen-character') {
        pack.presets.push({ name: e.path.split('/').pop().replace(/\.json$/i, ''), fileName: e.path.split('/').pop(), text });
      }
    } catch { /* not a preset */ }
  }
  // Readme / credit files, shown in the credits list.
  pack.textContents = await Promise.all(pack.texts.slice(0, 8).map(async (t) => {
    try {
      return { path: t.path, text: (await readText(t.src)).slice(0, 6000) };
    } catch {
      return { path: t.path, text: '(could not read this file)' };
    }
  }));
  applyRememberedAssignments(pack.name);
  $('open-files').disabled = false;
  const addedParts = state.library.variants.size - partsBefore;
  const addedGradientFiles = state.library.gradientFiles.length - gradientFilesBefore;

  const newGradientFiles = { gradientFiles: state.library.gradientFiles.slice(state.loadedGradientFiles) };
  state.loadedGradientFiles = state.library.gradientFiles.length;
  const { gradients, errors } = await loadGradients(newGradientFiles);
  state.fileGradients.push(...gradients);
  state.problems.push(...errors);

  if (!addedParts) {
    toast(`Nothing usable in "${pack.name}": ${unsupportedHint(addedGradientFiles)} See the import report.`, 12000);
    if (state.character) renderAll();
    else {
      showApp();
      renderProblems();
    }
    return;
  }
  ensureCharacter();
  toast(`Added "${pack.name}": ${addedParts} parts. Now ${state.library.variants.size} parts across ${state.library.bodyTypes.size} body type(s), ${allGradients().length} colours.`);
  showApp();
  renderAll();
}

/** Makes a first character once there are parts, and gives it colours. */
function ensureCharacter() {
  if (!state.character) {
    const bodyType = state.library.bodyTypes.has('Male') ? 'Male' : [...state.library.bodyTypes.keys()][0];
    state.character = applyDefaults(createCharacter(bodyType), state.library);
  }
  assignDefaultColours();
}

/** Why a folder gave no parts, in words a user can act on. */
function unsupportedHint(gradientFiles) {
  if (gradientFiles) return `only colour sheets were found (${gradientFiles}); they've been added to the colour lists.`;
  return 'no files are named like MV/MZ generator parts (FG_..., TV_..., SV_...). '
    + 'VX Ace and older generator folders use a different format that is not supported yet.';
}

/** Gives every still-uncoloured slot the first suggested gradient. */
function assignDefaultColours() {
  const gradients = allGradients();
  if (!gradients.length) return;
  for (const slot of SLOTS) {
    if (state.character.colors[slot.id]) continue;
    const preferred = gradients.filter((g) => g.category === preferredCategory(slot.id));
    // Row 0 of RPG Maker's sheets can be plain white; prefer a row with some colour in it.
    const pool = preferred.length ? preferred : gradients;
    state.character.colors[slot.id] = (pool.find((g) => !isFlat(g)) || pool[0]).id;
  }
}
function isFlat(gradient) {
  const c = gradient.colors;
  return c[0] === c[128 * 4] && c[1] === c[128 * 4 + 1] && c[2] === c[128 * 4 + 2];
}

function showApp() {
  $('app').classList.remove('empty');
  $('welcome').hidden = true;
  for (const id of ['sidebar', 'editor', 'preview']) $(id).hidden = false;
  for (const id of ['randomize', 'random-rules', 'save-character', 'load-character', 'open-files']) $(id).disabled = false;
}

// ---------- rendering ----------

function renderAll() {
  renderSidebar();
  renderEditor();
  renderPreview();
  renderProblems();
}

function renderSidebar() {
  const lib = state.library;
  const select = $('body-type');
  select.replaceChildren(...[...lib.bodyTypes.keys()].map((name) => el('option', { value: name, textContent: name })));
  select.value = state.character.bodyType;
  $('character-name').value = state.character.name;

  const items = [[ALL_COLOURS, 'All colours', '']];
  for (const part of partNames(lib, state.character.bodyType)) {
    for (const key of [part, ...itemKeys(state.character, part)]) {
      const variant = lib.variants.get(state.character.parts[key]);
      items.push([key, key, variant ? variantLabel(lib, variant, state.character.bodyType) : 'none']);
      for (const piece of pieceKeys(state.character, key)) items.push([piece, `↳ piece ${piece.split('#').pop()}`, '']);
    }
  }
  $('part-list').replaceChildren(...items.map(([key, label, value]) => {
    const button = el('button', { className: (key === state.selectedPart ? 'active' : '') + (key.includes(' #') ? ' piece' : '') }, [
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

  renderSets();
  $('packs').replaceChildren(
    el('div', { textContent: 'Packs' }),
    ...lib.packs.map((p) => el('div', { textContent: `• ${p.name} (${p.fileCount} files)` })),
  );
}

async function renderEditor() {
  const key = state.selectedPart;
  const isColours = key === ALL_COLOURS;
  const part = isColours ? null : partOfKey(key);
  const isPiece = !isColours && itemOfKey(key) !== key;
  const isExtra = !isColours && !isPiece && key !== part;
  const worn = !isColours && !!state.character.parts[itemOfKey(key)];
  $('editor-title').textContent = isColours ? 'All colours' : isPiece ? `${itemOfKey(key)}, piece ${key.split('#').pop()}` : key;
  $('lock-part').checked = state.locked.has(key);
  $('lock-part').parentElement.hidden = isColours || isPiece;
  $('offsets').hidden = !worn;
  $('add-item').hidden = isColours || isExtra || isPiece || !worn;
  $('add-item').textContent = `+ Another ${part}`;
  $('remove-item').hidden = !isExtra;
  $('pieces').hidden = !worn || isPiece;
  $('clip-box').hidden = !worn;
  if (worn) renderClip();
  $('piece-note').hidden = !isPiece;

  $('variants').replaceChildren();
  $('other-variants').replaceChildren();
  $('other-bodies').hidden = true;
  if (isPiece) {
    renderOffsets();
  } else if (!isColours) {
    renderPieces();
    const { own, others } = variantsForPart(state.library, part, state.character.bodyType);
    for (const variant of [null, ...own]) $('variants').append(variantTile(key, variant));
    if (others.length) {
      $('other-bodies').hidden = false;
      // Keep it open when the current choice comes from another body type.
      if (others.some((v) => v.id === state.character.parts[key])) $('other-bodies').open = true;
      for (const variant of others) $('other-variants').append(variantTile(key, variant));
    }
    renderOffsets();
  }

  // Colour slots depend on decoded masks, so decode the selected variants first.
  const token = ++state.editorToken;
  await ensureVariants(variantsToDecode(state.character, state.library));
  if (token !== state.editorToken) return;
  renderSlots();
}

function variantTile(key, variant) {
  const selected = (state.character.parts[key] || null) === (variant?.id || null);
  const tile = el('button', { className: 'variant' + (selected ? ' selected' : ''), title: variant ? variant.id : 'None' });
  const thumb = el('div', { className: 'placeholder', textContent: variant ? '?' : '∅' });
  tile.append(thumb, el('span', { textContent: variant ? variantLabel(state.library, variant, state.character.bodyType) : 'None' }));
  if (variant) {
    // Drawn in the current colours, so tiles follow colour changes (RPG Maker's own Variation
    // icons have fixed colours; they're only used when the part can't be drawn).
    let shown = thumb;
    tile.refresh = () => partThumbnail(key, variant)
      .then((pixels) => pixels || (variant.icon ? ensureImage(variant.icon) : null))
      .then((pixels) => {
        if (!pixels) return;
        const canvas = toCanvas(pixels);
        shown.replaceWith(canvas);
        shown = canvas;
      })
      .catch(() => {});
    tile.refresh();
  }
  tile.addEventListener('click', async () => {
    state.character.parts[key] = variant?.id || null;
    // A split part keeps its pieces if the new variant falls apart the same way.
    const split = state.character.split?.[key];
    if (split) {
      await ensureVariants(variantsToDecode(state.character, state.library));
      const count = variant ? countPieces(state.character, state.library, key, split.gap, state.settings) : 0;
      if (count > 1) split.count = count;
      else delete state.character.split[key];
    }
    renderSidebar();
    renderEditor();
    renderPreview();
  });
  return tile;
}

const thumbCache = new Map();
let thumbTimer;
/** Redraws the part tiles after a colour change (each tile caches per colour choice). */
function refreshTiles() {
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(() => {
    for (const tile of [...$('variants').children, ...$('other-variants').children]) tile.refresh?.();
  }, 150);
}

/**
 * A tile picture: the part alone, in the current colours. Uses the face if it has one, else the
 * middle walk frame facing down, else the first battler frame, else the first damage frame (some
 * packs only add a damage sprite). Only that sheet is decoded.
 */
function partThumbnail(key, variant) {
  const alone = {
    ...state.character, parts: { [key]: variant.id }, offsets: {}, split: {}, clip: {}, drawOrder: {},
  };
  const colours = JSON.stringify([state.character.colors, state.character.itemColors?.[key], state.settings.templates]);
  const cacheKey = `${key}|${variant.id}|${colours}`;
  if (!thumbCache.has(cacheKey)) {
    if (thumbCache.size > 600) thumbCache.clear();
    thumbCache.set(cacheKey, (async () => {
      for (const sheet of ['FG', 'TV', 'SV', 'TVD']) {
        const layers = sheetLayers(variant, sheet, state.library);
        if (!layers.length) continue;
        await ensureLayers(layers);
        const { image, frame } = composeSheet(sheet, alone, state.library, gradientsById(), state.settings);
        if (!image) continue;
        if (sheet === 'FG') return image;
        // The middle walk frame facing down, or the first battler frame.
        const f = frameOf(sheet, image, frame);
        const x = sheet === 'TV' && f.cols > 1 ? f.w : 0;
        const out = createImage(f.w, f.h);
        for (let y = 0; y < f.h; y++) {
          const start = (y * image.width + x) * 4;
          out.data.set(image.data.subarray(start, start + f.w * 4), y * f.w * 4);
        }
        return out;
      }
      return null;
    })());
  }
  return thumbCache.get(cacheKey);
}

/** The "Visibility" box: show this item only inside / over / outside another item. */
function renderClip() {
  const key = state.selectedPart;
  const clip = state.character.clip?.[key];
  const others = selectedItems(state.character, state.library).map((i) => i.key).filter((k) => k !== itemOfKey(key));
  $('clip-by').replaceChildren(...others.map((k) => el('option', { value: k, textContent: k })));
  $('clip-mode').value = clip?.mode || '';
  if (clip?.by && others.includes(clip.by)) $('clip-by').value = clip.by;
  $('clip-by').disabled = !others.length;
  $('clip-by').hidden = !clip?.mode;
}

function updateClip() {
  const key = state.selectedPart;
  const mode = $('clip-mode').value;
  const by = $('clip-by').value;
  const clips = (state.character.clip ||= {});
  if (mode && by) clips[key] = { mode, by };
  else delete clips[key];
  renderClip();
  renderPreview();
}

/** The "Pieces" box: split an item into islands (e.g. left and right eye), or join them again. */
function renderPieces() {
  const key = state.selectedPart;
  const split = state.character.split?.[key];
  $('split-item').hidden = !!split;
  $('unsplit-item').hidden = !split;
  $('split-gap').value = split?.gap ?? $('split-gap').value ?? 0;
  $('pieces-status').textContent = split
    ? `Split into ${split.count} pieces, listed under ${key} on the left. Each can be moved, turned, recoloured and reordered on its own.`
    : '';
}

async function splitSelected(gap) {
  const key = state.selectedPart;
  await ensureVariants(variantsToDecode(state.character, state.library));
  const count = countPieces(state.character, state.library, key, gap, state.settings);
  if (count < 2) {
    toast(gap > 0
      ? `${key} stays one piece with a gap of ${gap}px. Try a smaller gap.`
      : `${key} is one piece: no transparent gap separates its parts.`);
    return;
  }
  (state.character.split ||= {})[key] = { gap, count };
  renderAll();
}

function unsplitSelected() {
  const key = state.selectedPart;
  for (const piece of pieceKeys(state.character, key)) {
    delete state.character.offsets?.[piece];
    delete state.character.itemColors?.[piece];
  }
  delete state.character.split[key];
  renderAll();
}

function renderOffsets() {
  const o = state.character.offsets?.[state.selectedPart] || {};
  const variant = state.library.variants.get(state.character.parts[itemOfKey(state.selectedPart)]);
  const sheets = new Set(variant ? SHEET_KEYS.filter((s) => variantForSheet(variant, s, state.library)) : []);
  const hasFace = sheets.has('FG');
  const hasSprite = ['TV', 'TVD', 'SV'].some((s) => sheets.has(s));
  for (const id of ['off-face-x', 'off-face-y', 'off-face-rot']) $(id).disabled = !hasFace;
  for (const id of ['off-sprite-x', 'off-sprite-y', 'off-sprite-rot']) $(id).disabled = !hasSprite;
  $('offsets-note').textContent = !hasSprite
    ? 'This part only appears on the face, so it has no sprite position.'
    : !hasFace
      ? 'This part only appears on the sprites, so it has no face position.'
      : '';
  $('off-face-x').value = o.face?.x || 0;
  $('off-face-y').value = o.face?.y || 0;
  $('off-sprite-x').value = o.sprite?.x || 0;
  $('off-sprite-y').value = o.sprite?.y || 0;
  $('off-face-rot').value = o.face?.rot || 0;
  $('off-sprite-rot').value = o.sprite?.rot || 0;
  $('cell-box').hidden = !hasSprite;
  if (hasSprite) renderCellOptions();
}

// ---------- per-frame positions (one walk direction, battler motion or damage frame) ----------

const DIRECTIONS = ['Down', 'Left', 'Right', 'Up'];

/** The frame grid of a sprite sheet: from the current composite, else RPG Maker's. */
function gridOf(sheet) {
  const f = state.composites[sheet]?.frame;
  if (f) return { cols: f.cols, rows: f.rows };
  const d = SHEETS[sheet].frame;
  return { cols: d.cols, rows: d.rows };
}

/**
 * Groups a sheet's frames the way RPG Maker uses them: walk = one row per direction, battler =
 * 18 motions of 3 frames (2 blocks of 9 columns), damage = one row. Each group is a list of
 * "col,row" cells, in animation order.
 */
function cellGroups(sheet) {
  const { cols, rows } = gridOf(sheet);
  if (sheet === 'SV' && cols === 9 && rows === 6) {
    return SV_MOTIONS.map((name, m) => ({ name, cells: [0, 1, 2].map((k) => `${Math.floor(m / 6) * 3 + k},${m % 6}`) }));
  }
  return Array.from({ length: rows }, (_, row) => ({
    name: sheet === 'TV' && rows === 4 ? DIRECTIONS[row] : sheet === 'TVD' && rows === 1 ? 'All damage frames' : `Row ${row + 1}`,
    cells: Array.from({ length: cols }, (_, col) => `${col},${row}`),
  }));
}

function selectedCells() {
  const group = cellGroups($('cell-sheet').value)[Number($('cell-group').value)] || { cells: [] };
  const frame = $('cell-frame').value;
  return frame === 'all' ? group.cells : [group.cells[Number(frame)]].filter(Boolean);
}

function renderCellOptions() {
  const sheet = $('cell-sheet').value;
  const groups = cellGroups(sheet);
  const keepGroup = Math.min(Number($('cell-group').value) || 0, groups.length - 1);
  $('cell-group').replaceChildren(...groups.map((g, i) => el('option', { value: i, textContent: g.name })));
  $('cell-group').value = keepGroup;
  const count = groups[keepGroup]?.cells.length || 0;
  const keepFrame = $('cell-frame').value || 'all';
  $('cell-frame').replaceChildren(
    el('option', { value: 'all', textContent: count > 1 ? `all ${count} frames` : 'the frame' }),
    ...(count > 1 ? Array.from({ length: count }, (_, i) => el('option', { value: i, textContent: `frame ${i + 1} only` })) : []),
  );
  $('cell-frame').value = keepFrame === 'all' || Number(keepFrame) < count ? keepFrame : 'all';
  renderCellValues();
}

function renderCellValues() {
  const sheet = $('cell-sheet').value;
  const cells = state.character.offsets?.[state.selectedPart]?.cells?.[sheet] || {};
  const first = cells[selectedCells()[0]] || {};
  $('cell-x').value = first.x || 0;
  $('cell-y').value = first.y || 0;
  $('cell-rot').value = first.rot || 0;
  const moved = Object.keys(cells).length;
  $('cell-note').textContent = `Added on top of the Sprites position. ${moved ? `${moved} frame(s) of this sheet have their own position.` : ''}`;
}

/** Shows the chosen direction / motion in the preview, standing still on the chosen frame. */
function showCellInPreview() {
  const sheet = $('cell-sheet').value;
  const group = Number($('cell-group').value) || 0;
  if (sheet === 'TV') {
    state.walkDir = Math.min(group, 3);
    for (const b of $('dir-buttons').children) b.classList.toggle('active', Number(b.dataset.dir) === state.walkDir);
  }
  if (sheet === 'SV') {
    state.svMotion = group;
    $('sv-motion').value = group;
  }
}

function updateCellOffset() {
  const sheet = $('cell-sheet').value;
  const read = (id) => Math.max(-64, Math.min(64, Math.round(Number($(id).value) || 0)));
  const value = { x: read('cell-x'), y: read('cell-y'), rot: Math.max(-180, Math.min(180, Math.round(Number($('cell-rot').value) || 0))) };
  const offsets = (state.character.offsets ||= {});
  const item = (offsets[state.selectedPart] ||= {});
  const cells = ((item.cells ||= {})[sheet] ||= {});
  for (const cell of selectedCells()) {
    if (value.x || value.y || value.rot) cells[cell] = { ...value };
    else delete cells[cell];
  }
  if (!Object.keys(cells).length) delete item.cells[sheet];
  showCellInPreview();
  renderCellValues();
  renderPreview();
}

function updateOffset() {
  const read = (id) => Math.max(-64, Math.min(64, Math.round(Number($(id).value) || 0)));
  const angle = (id) => Math.max(-180, Math.min(180, Math.round(Number($(id).value) || 0)));
  const offsets = (state.character.offsets ||= {});
  offsets[state.selectedPart] = {
    ...offsets[state.selectedPart],
    face: { x: read('off-face-x'), y: read('off-face-y'), rot: angle('off-face-rot') },
    sprite: { x: read('off-sprite-x'), y: read('off-sprite-y'), rot: angle('off-sprite-rot') },
  };
  renderPreview();
}

/** The item whose own colours the swatches edit, or null for the character's shared colours. */
function ownColourItem() {
  const key = state.selectedPart;
  return key !== ALL_COLOURS && state.character.itemColors?.[key] ? key : null;
}
function slotColour(slotId) {
  const key = ownColourItem();
  return key ? itemColor(state.character, key, slotId) : state.character.colors[slotId];
}
function setSlotColour(slotId, gradientId) {
  const key = ownColourItem();
  if (key) state.character.itemColors[key][slotId] = gradientId;
  else state.character.colors[slotId] = gradientId;
}

function slotsForEditor() {
  if (state.selectedPart === ALL_COLOURS) return usedSlots(state.character, state.library);
  const variant = state.library.variants.get(state.character.parts[itemOfKey(state.selectedPart)]);
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
    const what = state.selectedPart === ALL_COLOURS ? 'The selected parts have' : 'This part has';
    box.replaceChildren(el('p', { className: 'muted', textContent: `${what} no recolourable areas.` }));
    return;
  }
  const gradients = allGradients();
  const head = [];
  if (state.selectedPart !== ALL_COLOURS) {
    // Own colours: this item ignores the shared colours (e.g. two accessories in different colours).
    const own = el('input', { type: 'checkbox', id: 'own-colours', checked: !!ownColourItem() });
    own.addEventListener('change', () => {
      const itemColors = (state.character.itemColors ||= {});
      if (own.checked) itemColors[state.selectedPart] = Object.fromEntries(slots.map((sl) => [sl.id, itemColor(state.character, state.selectedPart, sl.id)]));
      else delete itemColors[state.selectedPart];
      renderSlots();
      renderPreview();
    });
    head.push(el('label', { className: 'lock own-colours' }, [own, ' Own colours for this item (other parts keep the shared colours)']));
  }
  box.replaceChildren(...head, ...slots.map((slot) => {
    const preferred = preferredCategory(slot.id);
    const groups = new Map();
    for (const g of gradients) {
      const key = g.source === 'custom' ? 'Your colours' : g.category === preferred || g.category === 'all' ? 'Suggested' : 'Other';
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
      const swatches = el('div', { className: 'swatches' }, groups.get(key).map((g) => swatchButton(slot, g)));
      if (key === 'Other') {
        // Long lists (RPG Maker ships 100+ skin rows) stay folded away.
        const details = el('details', { open: state.openColourLists.has(slot.id) }, [el('summary', { className: 'swatch-group', textContent: `Other colours (${groups.get(key).length})` }), swatches]);
        details.addEventListener('toggle', () => {
          if (details.open) state.openColourLists.add(slot.id);
          else state.openColourLists.delete(slot.id);
        });
        wrap.append(details);
      } else {
        if (ordered.length > 1) wrap.append(el('div', { className: 'swatch-group', textContent: key }));
        wrap.append(swatches);
      }
    }
    const add = el('button', { className: 'swatch add', textContent: '+ New', title: 'Make your own gradient' });
    add.addEventListener('click', () => openGradientDialog(slot));
    wrap.append(el('div', { className: 'swatches', style: 'margin-top:5px' }, [add]));
    return wrap;
  }));
}

function swatchButton(slot, gradient) {
  const selected = slotColour(slot.id) === gradient.id;
  const img = el('img', { src: swatchImage(gradient), alt: gradient.label, width: 54, height: 14 });
  img.style.cssText = 'width:54px;height:14px;display:block';
  const button = el('button', { className: 'swatch' + (selected ? ' selected' : ''), title: gradient.label }, [img]);
  button.addEventListener('click', () => {
    setSlotColour(slot.id, gradient.id);
    renderSlots();
    renderPreview();
    refreshTiles();
  });
  return button;
}

async function renderPreview() {
  const token = ++state.previewToken;
  const errors = await ensureVariants(variantsToDecode(state.character, state.library));
  if (token !== state.previewToken) return;
  const byId = gradientsById();
  const problems = [...errors, ...unknownMaskColours()];
  for (const sheet of SHEET_KEYS) {
    const { image, problems: pr, ...p } = composeSheet(sheet, state.character, state.library, byId, state.settings);
    problems.push(...pr);
    state.composites[sheet] = image ? { image, canvas: toCanvas(image), frame: frameOf(sheet, image, p.frame) } : null;
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
  const dmgCanvas = $('damage-canvas');
  if (damage) {
    dmgCanvas.width = damage.image.width;
    dmgCanvas.height = damage.image.height;
  }
  const dmgCtx = dmgCanvas.getContext('2d');
  dmgCtx.clearRect(0, 0, dmgCanvas.width, dmgCanvas.height);
  if (damage) dmgCtx.drawImage(damage.canvas, 0, 0);
  // Animated previews are one frame big.
  for (const [id, key] of [['walk-canvas', 'TV'], ['sv-canvas', 'SV']]) {
    const f = state.composites[key]?.frame;
    if (f && ($(id).width !== f.w || $(id).height !== f.h)) {
      $(id).width = f.w;
      $(id).height = f.h;
    }
  }
  renderLayers();
  renderSheetView();
  renderCredits();
  renderProblems();
}

/** Credits: every pack the character uses, the parts taken from it, and the pack's readme. */
let lastCredits = '';
function renderCredits() {
  const credits = creditsFor(state.character, state.library);
  const notes = (state.settings.packCredits ||= {});
  // Rebuild only when the list changes, so open readmes and half-typed notes survive redraws.
  const signature = JSON.stringify(credits);
  if (signature === lastCredits) return;
  lastCredits = signature;
  $('copy-credits').disabled = !credits.length;
  if (!credits.length) {
    $('credit-list').replaceChildren(el('p', { className: 'muted small', textContent: 'No parts selected.' }));
    return;
  }
  $('credit-list').replaceChildren(...credits.map((c) => {
    const pack = state.library.packs.find((p) => p.name === c.pack);
    const note = el('input', { type: 'text', value: notes[c.pack] || '', placeholder: 'Author / licence, e.g. "by Someone, CC-BY 4.0"' });
    note.addEventListener('change', () => {
      notes[c.pack] = note.value;
      saveSettings();
    });
    const what = [c.parts.join(', '), c.colours ? 'colours' : ''].filter(Boolean).join('; ');
    const block = el('div', { className: 'credit' }, [
      el('div', { className: 'credit-pack', textContent: c.pack }),
      el('div', { className: 'muted small', textContent: what }),
      note,
    ]);
    for (const t of pack?.textContents || []) {
      block.append(el('details', { className: 'small' }, [
        el('summary', { textContent: t.path.split('/').pop() }),
        el('pre', { className: 'credit-text', textContent: t.text }),
      ]));
    }
    if (!pack?.textContents?.length) block.append(el('div', { className: 'muted small', textContent: 'No readme or credits file in this pack.' }));
    return block;
  }));
}

function currentCreditsText() {
  return creditsText(creditsFor(state.character, state.library), state.settings.packCredits || {});
}

/** The draw order list: every layer of the chosen sheet, top-most first, with up/down buttons. */
function renderLayers() {
  const sheet = $('layer-sheet').value;
  const topFirst = layersForSheet(sheet, state.character, state.library).reverse();
  const custom = !!state.character.drawOrder?.[sheet];
  $('layer-reset').disabled = !custom;
  if (!topFirst.length) {
    $('layer-list').replaceChildren(el('li', { className: 'muted', textContent: 'No layers on this sheet.' }));
    return;
  }
  $('layer-list').replaceChildren(...topFirst.map((draw, i) => {
    const id = drawId(draw);
    const move = (step) => {
      (state.character.drawOrder ||= {})[sheet] = moveLayer(sheet, state.character, state.library, id, step);
      renderPreview();
    };
    const up = el('button', { textContent: '↑', title: 'Draw above the layer over it', disabled: i === 0 });
    const down = el('button', { textContent: '↓', title: 'Draw below the layer under it', disabled: i === topFirst.length - 1 });
    up.addEventListener('click', () => move(1));
    down.addEventListener('click', () => move(-1));
    const name = draw.layer.key.replace(/:c\d+$/, '');
    const label = name === draw.item ? draw.item : `${draw.item} · ${draw.layer.key}`;
    return el('li', {}, [el('span', { textContent: label }), el('span', { className: 'layer-buttons' }, [up, down])]);
  }));
}

/** Mask colours in the selected parts that match no colour slot: those pixels can't be recoloured. */
function unknownMaskColours() {
  const lines = [];
  for (const variant of selectedVariants(state.character, state.library)) {
    for (const layer of variant.layers) {
      if (!layer.mask?.unknownColors?.size || !layer.base?.pixels) continue;
      // Pixels painted in the image's own colour are "keep as drawn", not a problem.
      layer.mask.realUnknown ||= scanMask(layer.mask.pixels, layer.base.pixels).unknown;
      const unknown = layer.mask.realUnknown;
      if (!unknown.size) continue;
      const colours = [...unknown].sort((a, b) => b[1] - a[1])
        .map(([rgb, n]) => `#${rgb.toString(16).padStart(6, '0')} (${n} px)`).join(', ');
      lines.push(`${layer.mask.path}: mask colour(s) that match no colour slot and not the image either (drawn as is): ${colours}`);
    }
  }
  return lines;
}

function renderProblems() {
  const lib = state.library;
  const skipped = lib.unrecognized.slice(0, 30).map((u) => {
    const assign = el('button', { className: 'small-button assign', textContent: 'Assign…', title: 'Tell the generator what this file is' });
    assign.addEventListener('click', () => openAssignDialog(u));
    return el('li', {}, [`Skipped ${u.path} (${u.reason}) `, assign]);
  });
  if (lib.unrecognized.length > 30) skipped.push(el('li', { textContent: `… and ${lib.unrecognized.length - 30} more skipped files (see Files…).` }));
  const queue = el('button', { className: 'small-button primary', textContent: `Assign skipped files (${lib.unrecognized.length})…` });
  queue.addEventListener('click', () => openFilesDialog('queue'));
  const lines = [
    ...lib.warnings,
    ...state.problems,
    ...state.renderProblems,
  ];
  const total = lib.unrecognized.length + lines.length;
  $('open-files').textContent = lib.unrecognized.length ? `Files… (${lib.unrecognized.length} to assign)` : 'Files…';
  $('problems').hidden = !total;
  $('problem-list').replaceChildren(
    el('p', { className: 'muted small', textContent: `${total} note(s). Skipped files don't stop the rest from loading; "Assign…" adds one by hand.` }),
    ...(lib.unrecognized.length ? [queue] : []),
    el('ul', {}, [...skipped, ...lines.slice(0, 500).map((l) => el('li', { textContent: l }))]),
  );
}

// ---------- character sets ----------

/** Saved sets live in the browser (settings) and can be exported/imported as a file. */
function renderPresets() {
  const presets = [...state.library.packs.values()].flatMap((p) => p.presets || []);
  $('preset-box').hidden = !presets.length;
  $('preset-list').replaceChildren(...presets.map((preset) => {
    const load = el('button', { className: 'set-apply', textContent: preset.name, title: 'Load this preset as the character' });
    load.addEventListener('click', () => loadCharacterText(preset.text, preset.fileName));
    return el('div', { className: 'set' }, [load]);
  }));
}

function renderSets() {
  renderPresets();
  const sets = state.settings.sets || [];
  $('set-list').replaceChildren(...(sets.length ? sets.map((set, i) => {
    const apply = el('button', { className: 'set-apply', textContent: set.name, title: `Put on: ${Object.keys(set.parts).join(', ')}` });
    apply.addEventListener('click', () => {
      for (const g of set.customGradients || []) {
        if (!state.customGradients.some((x) => x.id === g.id)) state.customGradients.push(createCustomGradient(g.id, g.label, g.stops));
      }
      const { character, missing } = applySet(state.character, set, state.library);
      state.character = character;
      renderAll();
      toast(missing.length ? `Put on "${set.name}", but missing: ${missing.join(', ')}` : `Put on "${set.name}".`);
    });
    const remove = el('button', { className: 'set-remove', textContent: '✕', title: 'Delete this set' });
    remove.addEventListener('click', () => {
      state.settings.sets.splice(i, 1);
      saveSettings();
      renderSets();
    });
    return el('div', { className: 'set' }, [apply, remove]);
  }) : [el('div', { className: 'muted small', textContent: 'None yet. A set is a group of parts with their colours, to put on any character.' })]));
  $('export-sets').disabled = !sets.length;
}

function openSetDialog() {
  const keys = Object.keys(state.character.parts).filter((k) => state.character.parts[k]);
  $('set-name').value = '';
  $('set-items').replaceChildren(...keys.map((k) => el('label', { className: 'lock' }, [
    el('input', { type: 'checkbox', value: k, checked: !['Body', 'Face'].includes(k) }), ` ${k}`,
  ])));
  $('set-dialog').showModal();
}

$('save-set').addEventListener('click', openSetDialog);
$('set-dialog').addEventListener('close', () => {
  if ($('set-dialog').returnValue !== 'ok') return;
  const keys = [...$('set-items').querySelectorAll('input:checked')].map((i) => i.value);
  if (!keys.length) {
    toast('Not saved: tick at least one part.');
    return;
  }
  const name = $('set-name').value.trim() || keys.join(' + ');
  const set = makeSet(state.character, state.library, name, keys, $('set-colours').checked);
  const used = new Set([...Object.values(set.colors), ...Object.values(set.itemColors).flatMap((c) => Object.values(c))]);
  set.customGradients = state.customGradients.filter((g) => used.has(g.id)).map((g) => ({ id: g.id, label: g.label, stops: g.stops }));
  (state.settings.sets ||= []).push(set);
  saveSettings();
  renderSets();
  toast(`Saved set "${name}".`);
});
$('export-sets').addEventListener('click', () => {
  const json = JSON.stringify({ format: 'rpgmaker-xgen-sets', version: 1, sets: state.settings.sets || [] }, null, 2);
  downloadBlob(new Blob([json], { type: 'application/json' }), 'character-sets.json');
});
$('import-sets').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.format !== 'rpgmaker-xgen-sets') throw new Error('not a sets file');
    (state.settings.sets ||= []).push(...data.sets);
    saveSettings();
    renderSets();
    toast(`Imported ${data.sets.length} set(s).`);
  } catch (err) {
    toast(`Could not import sets: ${err.message}`);
  }
});

// ---------- assigning unrecognised files by hand ----------

const SHEET_BY_SIZE = Object.entries(DEFAULT_SIZE).map(([sheet, s]) => ({ sheet, ...s }));

function assignFields() {
  return {
    sheet: $('assign-sheet').value,
    part: $('assign-part').value.trim(),
    layer: $('assign-layer').value.replace(/\D+/g, ''),
    pid: $('assign-pid').value.trim(),
    mask: $('assign-mask').checked,
    cell: $('assign-cell').value || 'c1',
    slotM: Number($('assign-slot').value) || null,
  };
}

function updateAssignPreview() {
  const f = assignFields();
  const isFace = f.sheet === 'FG';
  $('assign-mask').parentElement.hidden = isFace || f.sheet === 'icon';
  $('assign-face-fields').hidden = !isFace;
  $('assign-result').textContent = f.part ? `${$('assign-body').value || 'Default'}/${buildPartName(f)}` : 'Pick a part name.';
}

const SHEET_WORDS = { FG: 'face', TV: 'walk', TVD: 'damage', SV: 'battler' };

/** What a loaded file is read as, in words: "Male · Clothing pFur01 · walk mask". */
function readingOf(file) {
  const v = file.variant;
  const what = file.role === 'icon' ? 'icon' : `${SHEET_WORDS[file.layer.sheet] || file.layer.sheet} ${file.role === 'mask' ? 'mask' : 'image'}`;
  return `${v.bodyType} · ${v.part} ${v.pid} · ${what}`;
}

/** The generator name a loaded file is read as, to start the assign dialog from. */
function nameOf(file) {
  const v = file.variant;
  const pid = v.pid.replace(/\s*\(.*\)$/, '');
  if (file.role === 'icon') return buildPartName({ sheet: 'icon', part: v.part, pid });
  const l = file.layer;
  return buildPartName({
    sheet: l.sheet, part: v.part, layer: l.layer.slice(v.part.length), pid,
    mask: file.role === 'mask', cell: l.key.split(':')[1], slotM: SLOT_BY_ID.get(l.slotId)?.m,
  });
}

/** Draws a file's image into a canvas (decoded once, shared with the preview). */
async function drawFile(canvas, file) {
  file.ref ||= { src: file.src, pixels: null };
  const pixels = await ensureImage(file.ref, file.role === 'mask');
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
  return pixels;
}

let assigning = null;
/** Assigning one by one: the files still to go, in order. */
let assignQueue = null;

async function openAssignDialog(entry, queue = null) {
  assigning = entry;
  assignQueue = queue;
  const fileName = entry.path.split('/').pop();
  const stem = fileName.replace(/\.png$/i, '');
  const folders = entry.path.split('/').slice(0, -1);
  const bodies = [...state.library.bodyTypes.keys()];
  const folderBody = [...folders].reverse().find((f) => bodies.some((b) => b.toLowerCase() === f.toLowerCase()));
  const loaded = entry.variant ? entry : null;
  $('assign-title').textContent = loaded ? 'Reassign a file' : 'Assign a file';
  $('assign-ok').textContent = loaded ? 'Reassign' : 'Add';
  $('assign-current').textContent = loaded ? `Now read as: ${readingOf(loaded)}` : (entry.reason ? `Not read: ${entry.reason}` : '');
  $('assign-queue').textContent = queue ? `${queue.length} more after this one.` : '';
  $('assign-skip').hidden = !queue;
  $('assign-file').textContent = entry.path;
  $('assign-part').value = '';
  $('assign-layer').value = '';
  $('assign-pid').value = stem.replace(/[^A-Za-z0-9-]+/g, '-');
  $('assign-mask').checked = /_c$/i.test(stem);
  $('assign-body').value = folderBody ? bodies.find((b) => b.toLowerCase() === folderBody.toLowerCase()) : state.character?.bodyType || 'Male';
  $('assign-part-list').replaceChildren(...[...new Set([...PART_ORDER, ...partNames(state.library, state.character?.bodyType)])].map((p) => el('option', { value: p })));
  $('assign-body-list').replaceChildren(...bodies.map((b) => el('option', { value: b })));
  $('assign-slot').replaceChildren(el('option', { value: '', textContent: 'none (not recolourable)' }),
    ...SLOTS.filter((s) => s.m).map((s) => el('option', { value: s.m, textContent: s.label })));
  // Start from what it's read as now (reassigning), else guess the sheet from the image size.
  const current = loaded && parsePartPath(`${loaded.variant.bodyType}/${nameOf(loaded)}`);
  try {
    const pixels = await drawFile($('assign-preview'), entry);
    const guess = SHEET_BY_SIZE.find((s) => s.w === pixels.width && s.h === pixels.height);
    $('assign-sheet').value = guess ? guess.sheet : pixels.width <= 64 && pixels.height <= 64 ? 'icon' : 'TV';
    $('assign-size').textContent = `${pixels.width}×${pixels.height}px`;
  } catch {
    $('assign-size').textContent = 'could not read the image';
  }
  if (current) {
    $('assign-sheet').value = current.isIcon ? 'icon' : current.sheet;
    $('assign-part').value = current.part;
    $('assign-layer').value = current.layer.slice(current.part.length);
    $('assign-pid').value = current.basePid.replace(/^p/, '');
    $('assign-mask').checked = current.isMask;
    $('assign-body').value = current.bodyType;
    if (current.cell) $('assign-cell').value = current.cell;
    $('assign-slot').value = SLOT_BY_ID.get(current.slotId)?.m || '';
  }
  updateAssignPreview();
  if (!$('assign-dialog').open) $('assign-dialog').showModal();
}

/** Parts whose variant was taken away (reassigned) are taken off the character. */
function dropMissingParts() {
  if (!state.character) return;
  for (const [key, id] of Object.entries(state.character.parts)) {
    if (id && !state.library.variants.has(id)) state.character.parts[key] = null;
  }
}

function afterFilesChanged() {
  dropMissingParts();
  if (state.library.variants.size) {
    ensureCharacter();
    showApp();
    renderAll();
  } else {
    renderProblems();
  }
  if ($('files-dialog').open) renderFiles();
}

/**
 * Remembered per pack and file: {readAs, bodyType} to read it that way, or {readAs: null} to
 * leave it unassigned. Applied again when the same pack is opened.
 */
function applyRememberedAssignments(packName) {
  const remembered = state.settings.assignments || {};
  for (const [key, a] of Object.entries(remembered)) {
    if (!key.startsWith(`${packName}|`)) continue;
    const path = key.slice(packName.length + 1);
    const now = state.library.readAs.get(key);
    if (a.readAs === null) {
      unassignFile(state.library, packName, path, 'Unassigned by you');
      continue;
    }
    if (now && now.readAs === a.readAs && now.bodyType === (a.bodyType || 'Default')) continue;
    const file = unassignFile(state.library, packName, path);
    if (file) assignFile(state.library, packName, path, file.src, a.readAs, a.bodyType);
  }
}

function remember(entry, value) {
  (state.settings.assignments ||= {})[`${entry.pack}|${entry.path}`] = value;
  saveSettings();
}

function unassignByUser(entry) {
  unassignFile(state.library, entry.pack, entry.path, 'Unassigned by you');
  remember(entry, { readAs: null });
  toast(`${entry.path.split('/').pop()} is back in the "To assign" list.`);
  afterFilesChanged();
}

for (const id of ['assign-sheet', 'assign-part', 'assign-layer', 'assign-pid', 'assign-mask', 'assign-cell', 'assign-slot', 'assign-body']) {
  $(id).addEventListener('input', updateAssignPreview);
}
$('assign-dialog').addEventListener('close', () => {
  const action = $('assign-dialog').returnValue;
  const entry = assigning;
  const queue = assignQueue;
  assigning = null;
  assignQueue = null;
  if (!entry) return;
  if (action === 'ok') {
    const f = assignFields();
    if (!f.part) {
      toast('Not assigned: pick a part name.');
      return;
    }
    const readAs = buildPartName(f);
    const bodyType = $('assign-body').value.trim() || 'Default';
    if (!parsePartPath(`${bodyType}/${readAs}`)) {
      toast(`"${readAs}" is not a valid part name.`);
      return;
    }
    const file = unassignFile(state.library, entry.pack, entry.path) || entry;
    const error = assignFile(state.library, entry.pack, entry.path, file.src, readAs, bodyType);
    if (error) {
      toast(error);
      return;
    }
    if ($('assign-remember').checked) remember(entry, { readAs, bodyType });
    toast(`${entry.path.split('/').pop()}: ${bodyType} ${f.part}.`);
    afterFilesChanged();
  }
  // One by one: on to the next file that still needs assigning.
  if (queue && (action === 'ok' || action === 'skip')) {
    const rest = queue.filter((u) => state.library.unrecognized.includes(u));
    if (rest.length) openAssignDialog(rest[0], rest.slice(1));
    else toast('That was the last file to assign.');
  }
});

// ---------- files dialog: everything that was read, and what wasn't ----------

let filesTab = 'queue';
let filesShown = 60;

function filesFor(tab) {
  const lib = state.library;
  if (tab === 'queue') return lib.unrecognized;
  const loaded = libraryFiles(lib);
  if (tab === 'all') return [...lib.unrecognized, ...loaded];
  return loaded.filter((f) => lib.readAs.get(`${f.pack}|${f.path}`)?.how === tab);
}

function fileCard(file, observer) {
  const loaded = !!file.variant;
  const canvas = el('canvas', { width: 0, height: 0 });
  canvas.file = file;
  observer.observe(canvas);
  const buttons = [];
  const assign = el('button', { type: 'button', className: 'small-button', textContent: loaded ? 'Reassign…' : 'Assign…' });
  assign.addEventListener('click', () => openAssignDialog(file));
  buttons.push(assign);
  if (loaded) {
    const unassign = el('button', { type: 'button', className: 'small-button', textContent: 'Unassign', title: 'Take it out of its part and put it in the "To assign" list' });
    unassign.addEventListener('click', () => unassignByUser(file));
    buttons.push(unassign);
  }
  const how = state.library.readAs.get(`${file.pack}|${file.path}`)?.how;
  const reading = loaded
    ? `${readingOf(file)}${how === 'odd' ? ' (guessed from the name)' : how === 'hand' ? ' (assigned by you)' : ''}`
    : file.reason;
  return el('div', { className: 'file-card' }, [
    el('div', { className: 'file-thumb' }, [canvas]),
    el('div', { className: 'file-name', textContent: file.path.split('/').pop(), title: `${file.pack}: ${file.path}` }),
    el('div', { className: 'file-reading', textContent: reading }),
    el('div', { className: 'file-buttons' }, buttons),
  ]);
}

const TAB_LABELS = { queue: 'To assign', odd: 'Odd names', hand: 'Assigned by you', all: 'All files' };
const TAB_NOTES = {
  queue: 'Files the generator could not read from their name. Assign them one by one, or pick one.',
  odd: 'Files with unusual names, read by guessing. Reassign any that were guessed wrong.',
  hand: 'Files you assigned. Reassign or unassign them if one went wrong.',
  all: 'Every file of the opened folders. Reassign any of them, e.g. one that was read as the wrong part.',
};

function renderFiles() {
  const counts = { queue: filesFor('queue').length, odd: filesFor('odd').length, hand: filesFor('hand').length };
  for (const b of $('files-tabs').children) {
    const tab = b.dataset.tab;
    b.classList.toggle('active', tab === filesTab);
    b.textContent = tab in counts ? `${TAB_LABELS[tab]} (${counts[tab]})` : TAB_LABELS[tab];
  }
  const query = $('files-search').value.trim().toLowerCase();
  const files = filesFor(filesTab).filter((f) => !query
    || `${f.path} ${f.variant ? readingOf(f) : ''}`.toLowerCase().includes(query));
  $('files-start').hidden = filesTab !== 'queue' || !files.length;
  $('files-note').textContent = filesTab === 'queue' && !files.length ? 'Nothing left to assign.' : TAB_NOTES[filesTab];
  const observer = new IntersectionObserver((seen) => {
    for (const e of seen) {
      if (!e.isIntersecting) continue;
      observer.unobserve(e.target);
      drawFile(e.target, e.target.file).catch(() => {});
    }
  }, { root: $('files-list') });
  $('files-list').replaceChildren(...files.slice(0, filesShown).map((f) => fileCard(f, observer)));
  $('files-more').hidden = files.length <= filesShown;
  $('files-more').textContent = `Show more (${files.length - filesShown} left)`;
}

function openFilesDialog(tab = state.library.unrecognized.length ? 'queue' : 'odd') {
  filesTab = tab;
  filesShown = 60;
  renderFiles();
  if (!$('files-dialog').open) $('files-dialog').showModal();
}

$('open-files').addEventListener('click', () => openFilesDialog());
$('files-tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('button')?.dataset.tab;
  if (!tab) return;
  filesTab = tab;
  filesShown = 60;
  renderFiles();
});
$('files-search').addEventListener('input', () => {
  filesShown = 60;
  renderFiles();
});
$('files-more').addEventListener('click', () => {
  filesShown += 120;
  renderFiles();
});
$('files-start').addEventListener('click', () => {
  const queue = [...state.library.unrecognized];
  if (queue.length) openAssignDialog(queue[0], queue.slice(1));
});

// ---------- animation ----------

const PATTERN = [0, 1, 2, 1];
let tick = 0;
/** The animation grid of a composed sheet (a whole-sheet "frame" when it doesn't split). */
function frameOf(sheet, image, frame) {
  return frame || { w: image.width, h: image.height, cols: 1, rows: 1 };
}

/**
 * Column to show. RPG Maker's 3-frame walk goes 0,1,2,1, other grids loop. "Stand" shows the
 * middle frame, which is RPG Maker's standing pose.
 */
function animationColumn(cols) {
  if (state.standing) return cols === 3 ? 1 : 0;
  return cols === 3 ? PATTERN[tick % PATTERN.length] : tick % cols;
}

function animate() {
  if (!state.paused) tick = (tick + 1) % 12;

  const wctx = $('walk-canvas').getContext('2d');
  const walk = state.composites.TV;
  wctx.clearRect(0, 0, $('walk-canvas').width, $('walk-canvas').height);
  if (walk) {
    const f = walk.frame;
    const row = Math.min(state.walkDir, f.rows - 1);
    wctx.drawImage(walk.canvas, animationColumn(f.cols) * f.w, row * f.h, f.w, f.h, 0, 0, f.w, f.h);
  }
  // All four directions side by side.
  const all = $('walk-all-canvas');
  if (!all.parentElement.hidden && walk) {
    const f = walk.frame;
    if (all.width !== f.w * f.rows || all.height !== f.h) {
      all.width = f.w * f.rows;
      all.height = f.h;
    }
    const actx = all.getContext('2d');
    actx.clearRect(0, 0, all.width, all.height);
    for (let row = 0; row < f.rows; row++) {
      actx.drawImage(walk.canvas, animationColumn(f.cols) * f.w, row * f.h, f.w, f.h, row * f.w, 0, f.w, f.h);
    }
  }

  const sctx = $('sv-canvas').getContext('2d');
  const sv = state.composites.SV;
  sctx.clearRect(0, 0, $('sv-canvas').width, $('sv-canvas').height);
  if (sv) {
    const f = sv.frame;
    const m = state.svMotion;
    if (f.cols === 9 && f.rows === 6) {
      // RPG Maker's battler: 18 motions of 3 frames, in 2 blocks of 9 columns.
      const col = Math.floor(m / 6) * 3 + animationColumn(3);
      sctx.drawImage(sv.canvas, col * f.w, (m % 6) * f.h, f.w, f.h, 0, 0, f.w, f.h);
    } else {
      sctx.drawImage(sv.canvas, animationColumn(f.cols) * f.w, (m % f.rows) * f.h, f.w, f.h, 0, 0, f.w, f.h);
    }
  }
}
setInterval(animate, 180);

/** The whole composed sheet, as it will be exported. */
function renderSheetView() {
  const box = $('sheet-view');
  if (!box.open) return;
  const c = state.composites[$('sheet-view-select').value];
  const canvas = $('sheet-canvas');
  if (!c) {
    canvas.width = canvas.height = 0;
    return;
  }
  canvas.width = c.image.width;
  canvas.height = c.image.height;
  canvas.style.width = `${c.image.width * 2}px`; // 2x, shrunk to fit the panel by CSS
  canvas.getContext('2d').drawImage(c.canvas, 0, 0);
}
$('sheet-view').addEventListener('toggle', renderSheetView);
$('sheet-view-select').addEventListener('change', renderSheetView);

$('pause-anim').addEventListener('click', () => {
  state.paused = !state.paused;
  $('pause-anim').textContent = state.paused ? '▶ Play' : '⏸ Pause';
  $('pause-anim').classList.toggle('active', state.paused);
});
$('stand-anim').addEventListener('click', () => {
  state.standing = !state.standing;
  $('stand-anim').classList.toggle('active', state.standing);
});
$('walk-all').addEventListener('change', (e) => {
  $('walk-all-canvas').parentElement.hidden = !e.target.checked;
});

// ---------- custom gradients ----------

let dialogSlot = null;
/** Stops in RPG Maker's orientation: highlight at column 0, shadow at column 255. */
function dialogStops() {
  const stops = [{ pos: 0, color: $('stop-2').value }, { pos: 0.4, color: $('stop-1').value }, { pos: 1, color: $('stop-0').value }];
  return state.settings.flipGradient ? stops.map((s) => ({ ...s, pos: 1 - s.pos })) : stops;
}
function drawGradientPreview() {
  const g = createCustomGradient('preview', '', dialogStops());
  const canvas = $('gradient-preview');
  const ctx = canvas.getContext('2d');
  ctx.putImageData(new ImageData(g.colors.slice(), 256, 1), 0, 0);
  for (let y = 1; y < canvas.height; y++) ctx.drawImage(canvas, 0, 0, 256, 1, 0, y, 256, 1);
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
  state.customGradients.push(createCustomGradient(id, $('gradient-name').value || 'Custom', dialogStops()));
  setSlotColour(dialogSlot.id, id);
  renderSlots();
  renderPreview();
  refreshTiles();
});

// ---------- folders ----------

async function importHandle(handle) {
  await importEntries(await entriesFromHandle(handle), handle.name);
}

async function renderRecentFolders() {
  const box = $('recent-folders');
  if (!canRememberFolders) return;
  const handles = await rememberedFolders();
  box.hidden = !handles.length;
  if (!handles.length) return;
  const openAll = el('button', { className: 'primary', textContent: handles.length > 1 ? 'Reopen all' : `Reopen ${handles[0].name}` });
  openAll.addEventListener('click', async () => {
    for (const h of handles) {
      if (await ensureReadPermission(h)) await importHandle(h);
    }
  });
  box.replaceChildren(el('span', { className: 'muted small', textContent: 'Last time:' }), openAll);
  if (handles.length > 1) {
    for (const h of handles) {
      const b = el('button', { textContent: h.name });
      b.addEventListener('click', async () => {
        if (await ensureReadPermission(h)) await importHandle(h);
      });
      box.append(b);
    }
  }
  const forget = el('button', { className: 'forget', textContent: 'Forget', title: 'Forget these folders' });
  forget.addEventListener('click', async () => {
    for (const h of handles) await forgetFolder(h.name);
    renderRecentFolders();
  });
  box.append(forget);
}

// With the File System Access API the chosen folder is remembered for next time.
$('folder-input').parentElement.addEventListener('click', async (e) => {
  if (!canRememberFolders) return; // fall through to the plain <input webkitdirectory>
  e.preventDefault();
  try {
    const handle = await pickFolder();
    await rememberFolder(handle);
    await importHandle(handle);
  } catch (err) {
    if (err.name !== 'AbortError') toast(`Could not open the folder: ${err.message}`);
  }
});

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
// Demo link: ?sample loads the sample kit straight away.
// Dev: ?pack=<folder> loads a folder that has a manifest.json (see tools/make-manifest.mjs).
(async () => {
  const params = new URLSearchParams(location.search);
  if (params.has('sample')) await loadSampleKit();
  for (const folder of params.getAll('pack')) {
    try {
      const base = folder.replace(/\/?$/, '/');
      await importEntries(await sampleKitEntries(base), folder.split('/').filter(Boolean).pop());
    } catch (err) {
      toast(`Could not load ${folder}: ${err.message}`);
    }
  }
})();
renderRecentFolders();

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

// ---------- editor events ----------

$('body-type').addEventListener('change', (e) => {
  const bodyType = e.target.value;
  const parts = {};
  for (const [part, id] of Object.entries(state.character.parts)) {
    const variant = state.library.variants.get(id);
    // Parts from the old body type switch to the same part number in the new one, if it exists.
    // Parts deliberately borrowed from a third body type stay as they are.
    if (variant && variant.bodyType === state.character.bodyType) {
      parts[part] = resolveVariant(state.library, variant.part, `${variant.pack}/${bodyType}/${variant.part}/${variant.pid}`, bodyType) || id;
    } else {
      parts[part] = id;
    }
  }
  state.character = applyDefaults({ ...state.character, bodyType, parts }, state.library);
  renderAll();
});

$('character-name').addEventListener('input', (e) => {
  state.character.name = e.target.value;
});

$('add-item').addEventListener('click', () => {
  state.selectedPart = addItem(state.character, partOfKey(state.selectedPart));
  renderAll();
});
$('remove-item').addEventListener('click', () => {
  removeItem(state.character, state.selectedPart);
  state.locked.delete(state.selectedPart);
  state.selectedPart = partOfKey(state.selectedPart);
  renderAll();
});

$('clip-mode').addEventListener('change', updateClip);
$('clip-by').addEventListener('change', updateClip);
$('split-item').addEventListener('click', () => splitSelected(Math.max(0, Math.min(8, Number($('split-gap').value) || 0))));
$('unsplit-item').addEventListener('click', unsplitSelected);
$('split-gap').addEventListener('change', () => {
  if (state.character.split?.[state.selectedPart]) splitSelected(Math.max(0, Math.min(8, Number($('split-gap').value) || 0)));
});

$('lock-part').addEventListener('change', (e) => {
  if (e.target.checked) state.locked.add(state.selectedPart);
  else state.locked.delete(state.selectedPart);
  renderSidebar();
});

for (const id of ['off-face-x', 'off-face-y', 'off-face-rot', 'off-sprite-x', 'off-sprite-y', 'off-sprite-rot']) $(id).addEventListener('input', updateOffset);
for (const id of ['cell-x', 'cell-y', 'cell-rot']) $(id).addEventListener('input', updateCellOffset);
$('cell-sheet').addEventListener('change', () => {
  $('cell-group').value = 0;
  renderCellOptions();
  showCellInPreview();
});
$('cell-group').addEventListener('change', () => {
  renderCellOptions();
  showCellInPreview();
});
$('cell-frame').addEventListener('change', renderCellValues);
$('off-reset').addEventListener('click', () => {
  delete state.character.offsets?.[state.selectedPart];
  renderOffsets();
  renderPreview();
});

// ---------- randomize rules ----------

function rules() {
  return { ...DEFAULT_RULES, ...(state.settings.randomRules || {}) };
}

/** A small editable list of pairs: [select a] word [select b] ✕, plus an add button. */
function pairList(box, pairs, options, word, toPair, fromPair) {
  const render = () => {
    box.replaceChildren(...pairs.map((pair, i) => {
      const [a, b] = fromPair(pair);
      const select = (value) => {
        const s = el('select', {}, options.map(([v, label]) => el('option', { value: v, textContent: label })));
        s.value = value;
        return s;
      };
      const sa = select(a);
      const sb = select(b);
      const update = () => (pairs[i] = toPair(sa.value, sb.value));
      sa.addEventListener('change', update);
      sb.addEventListener('change', update);
      const remove = el('button', { className: 'set-remove', textContent: '✕', type: 'button' });
      remove.addEventListener('click', () => {
        pairs.splice(i, 1);
        render();
      });
      return el('div', { className: 'rule-row' }, [sa, el('span', { textContent: word }), sb, remove]);
    }));
  };
  render();
  return () => {
    pairs.push(toPair(options[0]?.[0], options[1]?.[0] ?? options[0]?.[0]));
    render();
  };
}

let ruleDraft = null;
function openRulesDialog() {
  ruleDraft = structuredClone(rules());
  const parts = partNames(state.library, state.character.bodyType);
  $('rule-chances').replaceChildren(...parts.map((part) => {
    const input = el('input', { type: 'number', min: 0, max: 100, step: 5, value: Math.round(wearChance(part, ruleDraft) * 100) });
    input.addEventListener('change', () => (ruleDraft.chances[part] = Math.max(0, Math.min(100, Number(input.value) || 0))));
    return el('label', { className: 'rule-chance' }, [el('span', { textContent: part }), input, '%']);
  }));
  $('rule-mix').checked = !!ruleDraft.mixBodyTypes;
  $('rule-any-colour').checked = !!ruleDraft.anyColour;
  $('rule-set-chance').value = ruleDraft.setChance || 0;
  const slotOptions = SLOTS.map((s) => [s.id, s.label]);
  const partOptions = parts.map((p) => [p, p]);
  $('rule-add-link').onclick = pairList($('rule-links'), ruleDraft.links, slotOptions, 'same colour as',
    (slot, follows) => ({ slot, follows }), (l) => [l.slot, l.follows]);
  $('rule-add-apart').onclick = pairList($('rule-apart'), ruleDraft.apart, partOptions, 'never with',
    (a, b) => [a, b], (p) => p);
  $('rules-dialog').showModal();
}

$('random-rules').addEventListener('click', openRulesDialog);
$('rules-dialog').addEventListener('close', () => {
  if ($('rules-dialog').returnValue !== 'ok' || !ruleDraft) return;
  ruleDraft.mixBodyTypes = $('rule-mix').checked;
  ruleDraft.anyColour = $('rule-any-colour').checked;
  ruleDraft.setChance = Math.max(0, Math.min(100, Number($('rule-set-chance').value) || 0));
  state.settings.randomRules = ruleDraft;
  saveSettings();
  toast('Randomize rules saved.');
});
$('rules-reset').addEventListener('click', () => {
  state.settings.randomRules = structuredClone(DEFAULT_RULES);
  saveSettings();
  $('rules-dialog').close('cancel');
  openRulesDialog();
});

$('randomize').addEventListener('click', () => {
  for (const set of state.settings.sets || []) {
    for (const g of set.customGradients || []) {
      if (!state.customGradients.some((x) => x.id === g.id)) state.customGradients.push(createCustomGradient(g.id, g.label, g.stops));
    }
  }
  state.character = randomize(state.character, state.library, allGradients(), {
    locked: state.locked, rules: rules(), sets: state.settings.sets || [],
  });
  renderAll();
});

$('copy-credits').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(currentCreditsText());
    toast('Credits copied.');
  } catch {
    toast('Could not copy: your browser blocked the clipboard.');
  }
});

$('layer-sheet').addEventListener('change', renderLayers);
$('layer-reset').addEventListener('click', () => {
  delete state.character.drawOrder?.[$('layer-sheet').value];
  renderPreview();
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

// Sheet templates: frame size and grid per sheet; blank = automatic.
function renderTemplates() {
  const rows = [['FG', 'Face'], ['TV', 'Walk'], ['TVD', 'Damage'], ['SV', 'Battler']];
  const t = state.settings.templates || {};
  $('template-grid').replaceChildren(...rows.flatMap(([sheet, label]) => {
    const input = (field, placeholder, hidden = false) => {
      const i = el('input', { type: 'number', min: 1, max: 1024, value: t[sheet]?.[field] || '', placeholder, title: placeholder });
      i.hidden = hidden;
      i.addEventListener('change', () => {
        const templates = (state.settings.templates ||= {});
        const entry = (templates[sheet] ||= {});
        entry[field] = Math.max(0, Math.min(1024, Math.round(Number(i.value) || 0))) || undefined;
        if (!Object.values(entry).some(Boolean)) delete templates[sheet];
        saveSettings();
        if (state.character) renderPreview();
      });
      return i;
    };
    const grid = sheet !== 'FG';
    return [el('span', { textContent: label }), input('fw', 'width'), input('fh', 'height'), input('cols', 'columns', !grid), input('rows', 'rows', !grid)];
  }));
}
renderTemplates();

$('flip-gradient').checked = state.settings.flipGradient;
$('flip-gradient').addEventListener('change', (e) => {
  state.settings.flipGradient = e.target.checked;
  saveSettings();
  if (state.character) renderPreview();
});

// ---------- export / save / load ----------

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
  if (sheet === 'all') {
    downloadBlob(new Blob([currentCreditsText() + '\n'], { type: 'text/plain' }), `${name}_credits.txt`);
  }
  if (sheet === 'all' && state.customGradients.length) {
    await downloadImage(gradientsToImage(state.customGradients), `${name}_custom_gradients.png`);
  }
  toast(count ? `Exported ${count} image(s).` : 'Nothing to export for this sheet: no selected part has layers for it.');
});

$('save-character').addEventListener('click', () => {
  const json = serializeCharacter(state.character, state.customGradients);
  downloadBlob(new Blob([json], { type: 'application/json' }), `${safeFileName(state.character.name)}.json`);
});

async function loadCharacterFile(file) {
  await loadCharacterText(await readText(file), file.name || '');
}

async function loadCharacterText(text, fileName) {
  try {
    const { character, customGradients, missing } = deserializeCharacter(text, state.library, allGradients(), fileName);
    for (const g of customGradients) {
      if (!state.customGradients.some((x) => x.id === g.id)) state.customGradients.push(g);
    }
    state.character = applyDefaults(character, state.library);
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
