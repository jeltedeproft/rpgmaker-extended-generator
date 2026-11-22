// UI controller. All heavy lifting lives in the pure modules; this file wires them to the DOM.

import { SHEET_KEYS, SLOTS, DEFAULT_SETTINGS } from './format.js';
import { createLibrary, addPack, variantLabel, variantsForPart, TEXT_FILE_RE } from './parse.js';
import { createCustomGradient, gradientsToImage, preferredCategory } from './gradients.js';
import {
  composeSheet, selectedVariants, variantsToDecode, variantForSheet, partOfKey, itemColor,
  layersForSheet, drawId, moveLayer, itemOfKey, pieceKeys, countPieces, selectedItems,
} from './compose.js';
import { createImage } from './recolor.js';
import {
  createCharacter, applyDefaults, partNames, usedSlots, randomize, resolveVariant,
  serializeCharacter, deserializeCharacter, itemKeys, addItem, removeItem, creditsFor, creditsText,
} from './character.js';
import {
  entriesFromFileList, entriesFromDrop, packNameFromEntries, sampleKitEntries, ensureImage,
  ensureVariants, loadGradients, toCanvas, downloadBlob, downloadImage,
  canRememberFolders, pickFolder, entriesFromHandle, rememberFolder, forgetFolder, rememberedFolders,
  ensureReadPermission, readText,
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
  // Readme / credit files, shown in the credits list.
  pack.textContents = await Promise.all(pack.texts.slice(0, 8).map(async (t) => {
    try {
      return { path: t.path, text: (await readText(t.src)).slice(0, 6000) };
    } catch {
      return { path: t.path, text: '(could not read this file)' };
    }
  }));
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
  if (!state.character) {
    const bodyType = state.library.bodyTypes.has('Male') ? 'Male' : [...state.library.bodyTypes.keys()][0];
    state.character = applyDefaults(createCharacter(bodyType), state.library);
  }
  assignDefaultColours();
  toast(`Added "${pack.name}": ${addedParts} parts. Now ${state.library.variants.size} parts across ${state.library.bodyTypes.size} body type(s), ${allGradients().length} colours.`);
  showApp();
  renderAll();
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
  const part = partOfKey(key);
  const selected = (state.character.parts[key] || null) === (variant?.id || null);
  const tile = el('button', { className: 'variant' + (selected ? ' selected' : ''), title: variant ? variant.id : 'None' });
  const thumb = el('div', { className: 'placeholder', textContent: variant ? '?' : '∅' });
  tile.append(thumb, el('span', { textContent: variant ? variantLabel(state.library, variant, state.character.bodyType) : 'None' }));
  if (variant) {
    const thumbnail = variant.icon ? ensureImage(variant.icon) : partThumbnail(part, variant);
    thumbnail.then((pixels) => pixels && thumb.replaceWith(toCanvas(pixels))).catch(() => {});
  }
  tile.addEventListener('click', () => {
    state.character.parts[key] = variant?.id || null;
    renderSidebar();
    renderEditor();
    renderPreview();
  });
  return tile;
}

/**
 * Preview for parts without a Variation icon: the part alone, in the current colours. Uses the
 * face if it has one, else the first walk frame (facing down), else the first battler frame.
 */
async function partThumbnail(part, variant) {
  const alone = { ...state.character, parts: { [part]: variant.id }, offsets: {} };
  await ensureVariants(variantsToDecode(alone, state.library));
  for (const [sheet, frame] of [['FG', null], ['TV', { x: 48, y: 0, w: 48, h: 48 }], ['SV', { x: 0, y: 0, w: 64, h: 64 }]]) {
    const { image } = composeSheet(sheet, alone, state.library, gradientsById(), state.settings);
    if (!image) continue;
    if (!frame) return image;
    const out = createImage(frame.w, frame.h);
    for (let y = 0; y < frame.h; y++) {
      const start = ((frame.y + y) * image.width + frame.x) * 4;
      out.data.set(image.data.subarray(start, start + frame.w * 4), y * frame.w * 4);
    }
    return out;
  }
  return null;
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
  const count = countPieces(state.character, state.library, key, gap);
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
}

function updateOffset() {
  const read = (id) => Math.max(-64, Math.min(64, Math.round(Number($(id).value) || 0)));
  const angle = (id) => Math.max(-180, Math.min(180, Math.round(Number($(id).value) || 0)));
  const offsets = (state.character.offsets ||= {});
  offsets[state.selectedPart] = {
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
    const { image, problems: p } = composeSheet(sheet, state.character, state.library, byId, state.settings);
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
  const dmgCtx = $('damage-canvas').getContext('2d');
  dmgCtx.clearRect(0, 0, 144, 48);
  if (state.composites.TVD) dmgCtx.drawImage(state.composites.TVD.canvas, 0, 0);
  renderLayers();
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
      const unknown = layer.mask?.unknownColors;
      if (!unknown?.size) continue;
      const colours = [...unknown].sort((a, b) => b[1] - a[1])
        .map(([rgb, n]) => `#${rgb.toString(16).padStart(6, '0')} (${n} px)`).join(', ');
      lines.push(`${layer.mask.path}: mask colour(s) not tied to any colour slot, left unrecoloured: ${colours}`);
    }
  }
  return lines;
}

function renderProblems() {
  const lib = state.library;
  const lines = [
    ...lib.unrecognized.map((u) => `Skipped ${u.path} (${u.reason})`),
    ...lib.warnings,
    ...state.problems,
    ...state.renderProblems,
  ];
  $('problems').hidden = !lines.length;
  $('problem-list').replaceChildren(
    el('p', { className: 'muted small', textContent: `${lines.length} note(s). Skipped files don't stop the rest from loading.` }),
    el('ul', {}, lines.slice(0, 500).map((l) => el('li', { textContent: l }))),
  );
}

// ---------- animation ----------

const PATTERN = [0, 1, 2, 1];
let tick = 0;
function animate() {
  tick = (tick + 1) % PATTERN.length;
  const frame = PATTERN[tick];

  const wctx = $('walk-canvas').getContext('2d');
  wctx.clearRect(0, 0, 48, 48);
  const walk = state.composites.TV;
  if (walk) wctx.drawImage(walk.canvas, frame * 48, state.walkDir * 48, 48, 48, 0, 0, 48, 48);

  const sctx = $('sv-canvas').getContext('2d');
  sctx.clearRect(0, 0, 64, 64);
  const sv = state.composites.SV;
  if (sv) {
    const m = state.svMotion;
    sctx.drawImage(sv.canvas, (Math.floor(m / 6) * 3 + frame) * 64, (m % 6) * 64, 64, 64, 0, 0, 64, 64);
  }
}
setInterval(animate, 180);

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
$('off-reset').addEventListener('click', () => {
  delete state.character.offsets?.[state.selectedPart];
  renderOffsets();
  renderPreview();
});

$('randomize').addEventListener('click', () => {
  state.character = randomize(state.character, state.library, allGradients(), { locked: state.locked });
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
  try {
    const { character, customGradients, missing } = deserializeCharacter(await file.text(), state.library);
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
