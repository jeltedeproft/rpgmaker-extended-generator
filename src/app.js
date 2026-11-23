// UI controller. All heavy lifting lives in the pure modules; this file wires them to the DOM.

import { SHEET_KEYS, SLOTS, DEFAULT_SETTINGS, PART_ORDER, SHEETS, SLOT_BY_ID, REQUIRED_PARTS } from './format.js';
import { createLibrary, addPack, removePack, removeFile, restoreFile, variantLabel, variantsForPart, TEXT_FILE_RE, assignFile, buildPartName, parsePartPath, unassignFile, libraryFiles, maskPairs, fitMasks, fixWrongSheets, attachWaitingMasks, imageOfMask, restoreToAssign } from './parse.js';
import { createCustomGradient, gradientsToImage, preferredCategories, recommendColours, adjustGradient, createAdjustedGradient, customGradientToJson, customGradientFromJson, createSourceAdjust, SOURCE_SAMPLE } from './gradients.js';
import {
  composeSheet, selectedVariants, variantsToDecode, variantForSheet, partOfKey, itemColor,
  layersForSheet, drawId, moveLayer, itemOfKey, itemOnSheet, HIDDEN, pieceKeys, countPieces, piecesPerSheet, selectedItems, sheetLayers,
} from './compose.js';
import { createImage, scanMask, matchSlot, recolorLayer } from './recolor.js';
import { guessSheet, shapeProfile, rankWithName, partsInName, maskColourShare, nameWords, slotForPart } from './suggest.js';
import { PAINTED_SLOTS, paintedIndex, cellOf, cellCount, averageColour } from './vxace.js';
import { colourGroups, makeMask, defaultGroupSlots, MAX_GROUPS, AUTO_SPREAD, iconMask } from './automask.js';
import { lookalikePairs, pairLayers, findLookalikes, differenceImage, LOOKALIKE_RATIO, folderKeys, sameFolder, digestBytes, sameFileDuplicates } from './lookalike.js';
import {
  createCharacter, applyDefaults, partNames, usedSlots, randomize, resolveVariant,
  serializeCharacter, deserializeCharacter, isGeneratorSettings, itemKeys, addItem, removeItem, creditsFor, creditsText,
  makeSet, applySet, DEFAULT_RULES, wearChance,
} from './character.js';
import {
  entriesFromFileList, entriesFromDrop, packNameFromEntries, sampleKitEntries, ensureImage, pngSize, fileBytes,
  ensureVariants, loadGradients, toCanvas, downloadBlob, downloadImage,
  canRememberFolders, pickFolder, entriesFromHandle, rememberFolder, forgetFolder, rememberedFolders,
  ensureReadPermission, readText, ensureLayers, hasReadPermission, dropFolderHandles,
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
/** action: {label, run} shows a button, e.g. Undo. */
function toast(message, ms = 4000, action = null) {
  const t = $('toast');
  t.textContent = message;
  if (action) {
    const b = el('button', { type: 'button', textContent: action.label });
    b.addEventListener('click', () => {
      t.hidden = true;
      action.run();
    });
    t.append(b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

// ---------- importing ----------

// ---------- busy bar: shows that something is still loading, and when it is done ----------

const busy = { jobs: 0, started: 0, timer: 0, title: document.title };
/** Lets the page draw (the bar) before more work; setTimeout also runs in background tabs. */
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Shows what is happening; with a total, how far along it is. */
function busyStep(label, done = 0, total = 0) {
  if (!busy.jobs) return;
  $('busy').hidden = false;
  $('busy').classList.remove('done');
  $('busy-label').textContent = total ? `${label} (${done} of ${total})` : `${label}…`;
  $('busy-fill').classList.toggle('indeterminate', !total);
  $('busy-fill').style.width = total ? `${Math.round((100 * done) / total)}%` : '';
}

/** Runs a job with the busy bar shown. Jobs may overlap; the bar stays until the last one ends. */
async function withBusy(label, job) {
  if (!busy.jobs++) busy.started = performance.now();
  clearTimeout(busy.timer);
  busyStep(label);
  await nextFrame();
  try {
    return await job();
  } finally {
    if (!--busy.jobs) busyDone();
  }
}

/** The last job ended. After a slow one: "✓ Done" in the bar, and in the tab title when away. */
function busyDone() {
  if (performance.now() - busy.started < 1200) {
    $('busy').hidden = true;
    return;
  }
  $('busy').classList.add('done');
  $('busy-fill').classList.remove('indeterminate');
  $('busy-fill').style.width = '';
  $('busy-label').textContent = '✓ Done: everything is loaded';
  busy.timer = setTimeout(() => ($('busy').hidden = true), 4000);
  if (document.hidden) {
    document.title = `✓ Done · ${busy.title}`;
    document.addEventListener('visibilitychange', () => (document.title = busy.title), { once: true });
  }
}

function importEntries(entries, packName) {
  return withBusy(`Opening "${packName}"`, () => importEntriesNow(entries, packName));
}

async function importEntriesNow(entries, packName) {
  state.lastPack = null;
  const pngs = entries.filter((e) => /\.png$/i.test(e.path));
  if (!pngs.length) {
    toast('No PNG files found in that folder.');
    return 0;
  }
  // The same folder opened twice (or a copy of it) would add every part again.
  const keys = folderKeys(pngs);
  const twin = sameFolder(state.library.packs, keys);
  if (twin && !(await askOpenAgain(packName, twin))) {
    toast(`Skipped "${packName}": it has the same files as "${twin.pack.name}".`);
    return 0;
  }
  const partsBefore = state.library.variants.size;
  const gradientFilesBefore = state.library.gradientFiles.length;
  const texts = entries.filter((e) => TEXT_FILE_RE.test(e.path));
  busyStep(`Opening "${packName}": reading ${pngs.length} file names`);
  await nextFrame();
  const pack = addPack(state.library, packName, [...pngs, ...texts]);
  state.lastPack = pack;
  pack.keys = keys;
  applyRemovedParts(pack.name);
  // Character presets shipped with the pack (RPG Maker MZ generator .json files, or ours).
  pack.presets = [];
  const jsons = entries.filter((x) => /\.json$/i.test(x.path)).slice(0, 200);
  for (const [i, e] of jsons.entries()) {
    busyStep(`Opening "${packName}": reading character presets`, i, jsons.length);
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
  // Sprites named for one sheet but sized for another are read as the sheet they fit.
  busyStep(`Opening "${packName}": checking picture sizes`);
  const sprites = libraryFiles(state.library).filter((f) => f.pack === pack.name && f.role !== 'icon' && !f.layer.vxace && f.layer.sheet !== 'FG');
  await Promise.all(sprites.map(async (f) => {
    const ref = f.role === 'mask' ? f.layer.mask : f.layer.base;
    ref.size ||= await pngSize(ref.src).catch(() => null);
  }));
  state.library.warnings.push(...fixWrongSheets(state.library, pack.name));
  // A mask assigned under another variation than its image joins the image it is named after.
  for (const m of attachWaitingMasks(state.library, pack.name)) {
    state.library.warnings.push(m.text);
    const key = `${pack.name}|${m.path}`;
    if (state.settings.assignments?.[key]) {
      state.settings.assignments[key] = { readAs: m.readAs, bodyType: m.bodyType };
      saveSettings();
    }
  }
  $('open-files').disabled = false;
  const addedParts = state.library.variants.size - partsBefore;
  const addedGradientFiles = state.library.gradientFiles.length - gradientFilesBefore;

  busyStep(`Opening "${packName}": loading colours`);
  const newGradientFiles = { gradientFiles: state.library.gradientFiles.slice(state.loadedGradientFiles) };
  state.loadedGradientFiles = state.library.gradientFiles.length;
  const { gradients, errors } = await loadGradients(newGradientFiles);
  state.fileGradients.push(...gradients);
  state.problems.push(...errors);

  // Files still to assign count as something read: the folder is remembered, so after a reload
  // they are back in the "To assign" list.
  const toAssign = state.library.unrecognized.filter((u) => u.pack === pack.name).length;
  const assignNote = toAssign ? ` ${toAssign} file${toAssign > 1 ? 's' : ''} to assign: see "Files…".` : '';
  if (!addedParts) {
    toast(toAssign
      ? `No parts read from the names in "${pack.name}" yet.${assignNote}`
      : `Nothing usable in "${pack.name}": ${unsupportedHint(addedGradientFiles)} See the import report.`, 12000);
    if (state.character) renderAll();
    else {
      showApp();
      renderProblems();
    }
    return addedGradientFiles + toAssign; // colour sheets or files to assign still count
  }
  // A mask goes with the image it fits, when two images have the same name.
  const pairs = maskPairs(state.library, pack.name);
  if (pairs.length) {
    busyStep(`Opening "${packName}": matching colour masks`);
    await ensureLayers(pairs.flatMap((p) => [p.owner, p.other]));
    state.library.warnings.push(...fitMasks(pairs));
  }
  // Made colour masks last: the real ones are where they belong by now.
  for (const v of state.library.variants.values()) if (v.pack === pack.name) applyAutoMask(v);
  busyStep(`Opening "${packName}": drawing the character`);
  ensureCharacter();
  checkLookalikes(pack.name).then(() => findSameFiles(pack.name, true)).catch((e) => console.error(e));
  toast(`Added "${pack.name}": ${addedParts} parts. Now ${state.library.variants.size} parts across ${state.library.bodyTypes.size} body type(s), ${allGradients().length} colours.${assignNote}`, toAssign ? 8000 : 4000);
  showApp();
  renderAll();
  return addedParts;
}

/** Makes a first character once there are parts, and gives it colours. */
function ensureCharacter() {
  if (!state.character) {
    const bodyType = state.library.bodyTypes.has('Male') ? 'Male' : [...state.library.bodyTypes.keys()][0];
    // Parts start in the colours they are drawn in; gradients only once you pick one.
    state.character = applyDefaults(createCharacter(bodyType), state.library);
  }
}

/** Why a folder gave no parts, in words a user can act on. */
function unsupportedHint(gradientFiles) {
  if (gradientFiles) return `only colour sheets were found (${gradientFiles}); they've been added to the colour lists.`;
  return 'no files are named like MV/MZ generator parts (FG_..., TV_..., SV_...) or VX Ace ones (Face/..., Mini/...). '
    + 'Generator folders from XP and older are not supported.';
}

/** Back to the start screen: nothing is loaded. */
function showWelcome() {
  state.character = null;
  state.composites = {};
  $('app').classList.add('empty');
  $('welcome').hidden = false;
  for (const id of ['sidebar', 'editor', 'preview']) $(id).hidden = true;
  for (const id of ['randomize', 'clear-all', 'random-rules', 'save-character', 'load-character', 'open-files', 'open-gallery']) $(id).disabled = true;
  $('open-files').textContent = 'Files…';
  $('problems').hidden = true;
  $('packs').replaceChildren();
}

function showApp() {
  $('app').classList.remove('empty');
  $('welcome').hidden = true;
  for (const id of ['sidebar', 'editor', 'preview']) $(id).hidden = false;
  for (const id of ['randomize', 'clear-all', 'random-rules', 'save-character', 'load-character', 'open-files', 'open-gallery']) $(id).disabled = false;
}

// ---------- rendering ----------

function renderAll() {
  renderImageTransform();
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
      for (const piece of pieceKeys(state.character, key)) items.push([piece, `↳ piece ${piece.split('#').pop()}${linkOf(piece) ? ' ⛓' : ''}`, '']);
    }
  }
  $('part-list').replaceChildren(...items.map(([key, label, value]) => {
    const hiddenItem = state.character.hidden?.[key];
    const button = el('button', { className: (key === state.selectedPart ? 'active' : '') + (key.includes(' #') ? ' piece' : '') + (hiddenItem ? ' hidden-item' : ''), title: (value ? `${label}: ${value}` : label) + (hiddenItem ? ' (hidden)' : '') }, [
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
  $('remove-part').hidden = isColours || isPiece || !worn;
  $('pieces').hidden = !worn || isPiece;
  $('clip-box').hidden = !worn;
  if (worn) renderClip();
  $('sheet-parts-box').hidden = !worn || isPiece;
  if (worn && !isPiece) renderSheetParts();
  $('piece-note').hidden = !isPiece;

  $('variants').replaceChildren();
  $('other-variants').replaceChildren();
  $('other-bodies').hidden = true;
  if (isPiece) {
    renderOffsets();
  } else if (!isColours) {
    renderPieces();
    const { own, others } = variantsForPart(state.library, part, state.character.bodyType, state.character.parts[key]);
    // Sections per image (portrait, walk, damage, battler): the parts that have a picture for it,
    // drawn as that picture. A part with only a damage sprite shows up under Damage.
    const imagesOf = new Map([...own, ...others].map((v) => [v, SHEET_KEYS.filter((s) => sheetLayers(v, s, state.library).length)]));
    const counts = Object.fromEntries(SHEET_KEYS.map((s) => [s, [...imagesOf.values()].filter((list) => list.includes(s)).length]));
    const tab = counts[state.tileSheet] ? state.tileSheet : '';
    const shown = (v) => !tab || imagesOf.get(v).includes(tab);
    const tabs = [['', `All (${imagesOf.size})`], ...SHEET_KEYS.filter((s) => counts[s]).map((s) => [s, `${SHEET_NAMES[s]} (${counts[s]})`])];
    $('variant-tabs').hidden = tabs.length < 3;
    $('variant-tabs').replaceChildren(...tabs.map(([s, label]) => {
      const b = el('button', { type: 'button', className: s === tab ? 'active' : '', textContent: label,
        title: s ? `Only the ${part} parts that have a ${SHEET_NAMES[s].toLowerCase()} picture, shown as that picture` : `Every ${part} part` });
      b.addEventListener('click', () => {
        state.tileSheet = s;
        renderEditor();
      });
      return b;
    }));
    const sheets = tab ? [tab] : undefined;
    for (const variant of [null, ...own.filter(shown)]) $('variants').append(variantTile(key, variant, sheets));
    if (others.some(shown)) {
      $('other-bodies').hidden = false;
      // Keep it open when the current choice comes from another body type.
      if (others.some((v) => v.id === state.character.parts[key])) $('other-bodies').open = true;
      for (const variant of others.filter(shown)) $('other-variants').append(variantTile(key, variant, sheets));
    }
    renderOffsets();
  }

  // Colour slots depend on decoded masks, so decode the selected variants first.
  const token = ++state.editorToken;
  await ensureVariants(variantsToDecode(state.character, state.library));
  if (token !== state.editorToken) return;
  renderSlots();
}

/** sheets: the images to draw the tile from, best first (default: portrait, walk, battler, damage). */
function variantTile(key, variant, sheets = undefined) {
  const selected = (state.character.parts[key] || null) === (variant?.id || null);
  const label = variant ? variantLabel(state.library, variant, state.character.bodyType) : 'None';
  const tile = el('button', { className: 'variant' + (selected ? ' selected' : ''), title: variant ? `${label}
${variant.id}` : 'None' });
  const thumb = el('div', { className: 'placeholder', textContent: variant ? '?' : '∅' });
  tile.append(thumb, el('span', { textContent: label }));
  if (variant) {
    // The part's Variation icon, the picture RPG Maker's own generator shows, recoloured like the
    // part. Parts without one, and the per-image sections, are drawn from their pictures.
    let shown = thumb;
    const icon = !sheets && variant.icon;
    if (icon) tile.classList.add('has-icon');
    tile.refresh = () => (icon ? iconThumbnail(key, variant).catch(() => null) : Promise.resolve(null))
      .then((pixels) => pixels || partThumbnail(key, variant, sheets))
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
      const sheets = variant ? piecesPerSheet(state.character, state.library, key, split.gap, state.settings) : {};
      const count = Math.max(0, ...Object.values(sheets));
      if (count > 1) Object.assign(split, { count, sheets });
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
    if (!$('sheet-parts-box').hidden) renderSheetParts();
  }, 150);
}

/** Pixels drawn in a picture (not transparent). */
function drawnPixels(image) {
  let n = 0;
  for (let i = 3; i < image.data.length; i += 4) if (image.data[i] > 16) n++;
  return n;
}

/** A picture shows something: a few pixels, not just a stray dot or a sliver at the edge. */
const showsSomething = (image) => drawnPixels(image) >= Math.max(12, (image.width * image.height) / 200);

/** One frame (column, row) of a sheet image. */
function cutFrame(image, f, col, row) {
  const out = createImage(f.w, f.h);
  for (let y = 0; y < f.h; y++) {
    const start = ((row * f.h + y) * image.width + col * f.w) * 4;
    out.data.set(image.data.subarray(start, start + f.w * 4), y * f.w * 4);
  }
  return out;
}

/**
 * A tile picture: the part alone, in the current colours. Uses the portrait if it has one, else
 * the middle walk frame facing down, else the first battler frame, else the first damage frame
 * (some packs only add a damage sprite). A picture with (almost) nothing in it is skipped: then the
 * frame or image that shows the most of the part is used, e.g. a cloak's back seen from behind.
 */
/**
 * A part's Variation icon in the current colours: recoloured like the part, through a colour mask
 * read from the part's own pictures and masks. Icons of parts without any mask stay as drawn.
 */
function iconThumbnail(key, variant) {
  const colours = JSON.stringify([state.character.colors, state.character.itemColors?.[key], state.settings.templates]);
  const cacheKey = `icon|${key}|${variant.id}|${colours}`;
  if (!thumbCache.has(cacheKey)) {
    if (thumbCache.size > 600) thumbCache.clear();
    thumbCache.set(cacheKey, (async () => {
      const icon = await ensureImage(variant.icon);
      if (!icon) return null;
      variant.iconMask ||= (async () => {
        const layers = variant.layers.filter((l) => l.base && l.mask && !l.base.cells);
        if (!layers.length) return null;
        await ensureLayers(layers);
        return iconMask(icon, layers.map((l) => ({ image: l.base.pixels, mask: l.mask.pixels })));
      })();
      const mask = await variant.iconMask;
      if (!mask) return icon;
      const byId = gradientsById();
      const gradientFor = (slotId) => {
        const id = itemColor(state.character, key, slotId);
        const g = id ? byId.get(id) : null;
        if (g?.shiftSource) return (g.shiftRef ||= { shift: g.adjust });
        return g?.colors ?? null;
      };
      return recolorLayer(icon, mask, null, gradientFor, state.settings);
    })());
  }
  return thumbCache.get(cacheKey);
}

function partThumbnail(key, variant, sheets = ['FG', 'TV', 'SV', 'TVD'], source = false) {
  // source: the picture as drawn in the file, no gradients (to compare files, not colours).
  const alone = {
    ...state.character, parts: { [key]: variant.id }, offsets: {}, split: {}, clip: {}, drawOrder: {},
    sheetParts: {}, hidden: {}, sheetTransform: {}, ...(source ? { colors: {}, itemColors: {} } : {}),
  };
  const colours = source ? 'source' : JSON.stringify([state.character.colors, state.character.itemColors?.[key], state.settings.templates]);
  const cacheKey = `${key}|${variant.id}|${sheets}|${colours}`;
  if (!thumbCache.has(cacheKey)) {
    if (thumbCache.size > 600) thumbCache.clear();
    thumbCache.set(cacheKey, (async () => {
      let best = null;
      let bestCount = 0;
      for (const sheet of sheets) {
        const layers = sheetLayers(variant, sheet, state.library);
        if (!layers.length) continue;
        await ensureLayers(layers);
        const { image, frame } = composeSheet(sheet, alone, state.library, source ? new Map() : gradientsById(), state.settings);
        if (!image) continue;
        const f = frameOf(sheet, image, frame);
        // The portrait, or the middle walk frame facing down, or the first battler frame.
        const usual = sheet === 'FG' ? image : cutFrame(image, f, sheet === 'TV' && f.cols > 1 ? 1 : 0, 0);
        if (showsSomething(usual)) return usual;
        // Nothing there: the frame of this image that shows the most.
        for (let row = 0; row < f.rows; row++) {
          for (let col = 0; col < f.cols; col++) {
            const pic = f.cols * f.rows > 1 ? cutFrame(image, f, col, row) : image;
            const count = drawnPixels(pic);
            if (count > bestCount) [best, bestCount] = [pic, count];
          }
        }
      }
      return best;
    })());
  }
  return thumbCache.get(cacheKey);
}

const SHEET_NAMES = { FG: 'Portrait', TV: 'Walk', TVD: 'Damage', SV: 'Battler' };

/**
 * The "Per image" box: for each image (face, walk, damage, battler) the picture this part uses.
 * "As chosen" follows the part's own variant; another variant can stand in (an image the part
 * has no picture for, or a different linked face/body), or the part can be hidden there.
 */
function renderSheetParts() {
  const key = state.selectedPart;
  const lib = state.library;
  const variant = lib.variants.get(state.character.parts[key]);
  $('hide-item').checked = !!state.character.hidden?.[key];
  if (!variant) {
    $('sheet-parts').replaceChildren();
    return;
  }
  const rows = [];
  for (const sheet of ['FG', 'TV', 'TVD', 'SV']) {
    const { usable, choice } = sheetCandidates(key, sheet);
    const ownHas = sheetLayers(variant, sheet, lib).length > 0;
    // Images no loaded part of this kind has (VX Ace has no damage or battler sprites): no row.
    if (!ownHas && !usable.length && !choice) continue;
    const chosen = choice && choice !== HIDDEN && lib.variants.get(choice);
    const label = choice === HIDDEN ? 'Hidden'
      : chosen ? `Use ${variantLabel(lib, chosen, state.character.bodyType)}`
        : `As chosen (${variant.pid}${ownHas ? '' : ': nothing here'})`;
    const shown = itemOnSheet(state.character, key, variant, sheet, lib);
    const drawable = shown && sheetLayers(shown, sheet, lib).length;
    const thumb = el('div', { className: 'placeholder', textContent: drawable ? '…' : '∅' });
    const button = el('button', { type: 'button', className: 'sheet-pick', title: `What this part shows on the ${SHEET_NAMES[sheet].toLowerCase()} image: click to see the choices` }, [
      thumb, el('span', { textContent: `${label} ▾` }),
    ]);
    if (drawable) {
      partThumbnail(key, shown, [sheet]).then((pixels) => {
        if (pixels) thumb.replaceWith(toCanvas(pixels));
        else thumb.textContent = '∅';
      }).catch(() => (thumb.textContent = '?'));
    }
    button.addEventListener('click', () => openPickDialog(key, sheet));
    const blank = !state.character.hidden?.[key] && choice !== HIDDEN && !drawable;
    const note = blank
      ? el('span', { className: 'blank', textContent: usable.length ? '⚠ blank: pick a stand-in' : '⚠ blank, no other picture' })
      : el('span', { className: 'muted small', textContent: choice === HIDDEN ? 'hidden' : '' });
    rows.push(el('span', { textContent: SHEET_NAMES[sheet] }), button, note);
  }
  $('sheet-parts').replaceChildren(...rows);
}

/** The variants that can stand in for an item on one image, and the current choice there. */
function sheetCandidates(key, sheet) {
  const lib = state.library;
  const variant = lib.variants.get(state.character.parts[key]);
  const { own, others } = variantsForPart(lib, variant.part, state.character.bodyType);
  const choice = state.character.sheetParts?.[key]?.[sheet] || '';
  const usable = [...own, ...others].filter((v) => v.id !== variant.id && sheetLayers(v, sheet, lib).length);
  if (choice && choice !== HIDDEN && !usable.some((v) => v.id === choice) && lib.variants.get(choice)) usable.unshift(lib.variants.get(choice));
  return { variant, usable, choice };
}

async function setSheetChoice(key, sheet, value) {
  const choices = ((state.character.sheetParts ||= {})[key] ||= {});
  if (value) choices[sheet] = value;
  else delete choices[sheet];
  if (!Object.keys(choices).length) delete state.character.sheetParts[key];
  await ensureVariants(variantsToDecode(state.character, state.library));
  renderSheetParts();
  renderPreview();
}

/** The per-image choices as pictures: what the part would look like on that image. */
let picking = null;
function openPickDialog(key, sheet) {
  picking = { key, sheet };
  $('pick-title').textContent = `${key} on the ${SHEET_NAMES[sheet].toLowerCase()} image`;
  $('pick-search').value = '';
  renderPickList();
  if (!$('pick-dialog').open) $('pick-dialog').showModal();
}

function pickTile(label, title, selected, draw, value) {
  const thumb = el('div', { className: 'placeholder', textContent: '…' });
  const tile = el('button', { type: 'button', className: 'variant' + (selected ? ' selected' : ''), title }, [thumb, el('span', { textContent: label })]);
  tile.draw = () => draw().then((pixels) => {
    if (pixels) thumb.replaceWith(toCanvas(pixels));
    else thumb.textContent = '∅';
  }).catch(() => (thumb.textContent = '?'));
  tile.addEventListener('click', () => {
    const { key, sheet } = picking;
    $('pick-dialog').close();
    setSheetChoice(key, sheet, value);
  });
  return tile;
}

function renderPickList() {
  if (!picking) return;
  const { key, sheet } = picking;
  const lib = state.library;
  const { variant, usable, choice } = sheetCandidates(key, sheet);
  const query = $('pick-search').value.trim().toLowerCase();
  const ownHas = sheetLayers(variant, sheet, lib).length > 0;
  const tiles = [
    pickTile(`As chosen (${variant.pid})`, ownHas ? `${variant.id}: its own picture` : `${variant.id} has no picture here`, !choice,
      () => (ownHas ? partThumbnail(key, variant, [sheet]) : Promise.resolve(null)), ''),
    pickTile('Hidden', 'Not drawn on this image', choice === HIDDEN, () => Promise.resolve(null), HIDDEN),
    ...usable
      .filter((v) => !query || `${variantLabel(lib, v, state.character.bodyType)} ${v.id}`.toLowerCase().includes(query))
      .map((v) => pickTile(variantLabel(lib, v, state.character.bodyType), v.id, choice === v.id, () => partThumbnail(key, v, [sheet]), v.id)),
  ];
  const observer = new IntersectionObserver((seen) => {
    for (const e of seen) {
      if (!e.isIntersecting) continue;
      observer.unobserve(e.target);
      e.target.draw();
    }
  }, { root: $('pick-list') });
  for (const t of tiles) observer.observe(t);
  $('pick-list').replaceChildren(...tiles);
}
$('pick-search').addEventListener('input', renderPickList);
$('pick-dialog').addEventListener('close', () => (picking = null));

$('hide-item').addEventListener('change', () => {
  const key = state.selectedPart;
  if ($('hide-item').checked) (state.character.hidden ||= {})[key] = true;
  else delete state.character.hidden?.[key];
  renderSidebar();
  renderSheetParts();
  renderPreview();
});


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
  const SHEET_WORD = { FG: 'portrait', TV: 'walk', TVD: 'damage', SV: 'battler' };
  const perSheet = split?.sheets && Object.entries(split.sheets).map(([s, n]) => `${SHEET_WORD[s] || s} ${n}`).join(', ');
  $('pieces-status').textContent = split
    ? `Split into ${split.count} pieces${perSheet ? ` (${perSheet})` : ''}, listed under ${key} on the left. Each can be moved, turned, recoloured and reordered on its own. An image with fewer pieces keeps its whole picture in piece 1.`
    : '';
}

async function splitSelected(gap) {
  const key = state.selectedPart;
  await ensureVariants(variantsToDecode(state.character, state.library));
  const sheets = piecesPerSheet(state.character, state.library, key, gap, state.settings);
  const count = Math.max(0, ...Object.values(sheets));
  if (count < 2) {
    toast(gap > 0
      ? `${key} stays one piece with a gap of ${gap}px. Try a smaller gap.`
      : `${key} is one piece in every image (portrait, walk, damage, battler): no transparent gap separates its parts.`);
    return;
  }
  (state.character.split ||= {})[key] = { gap, count, sheets };
  renderAll();
}

/** Split all: every worn part that falls apart (transparent gaps) is split into pieces. */
async function splitAll() {
  await ensureVariants(variantsToDecode(state.character, state.library));
  const gap = Math.max(0, Math.min(8, Number($('split-gap').value) || 0));
  let split = 0;
  let whole = 0;
  for (const key of Object.keys(state.character.parts)) {
    if (!state.character.parts[key] || state.character.split?.[key]) continue;
    const sheets = piecesPerSheet(state.character, state.library, key, gap, state.settings);
    const count = Math.max(0, ...Object.values(sheets));
    if (count < 2) {
      whole++;
      continue;
    }
    (state.character.split ||= {})[key] = { gap, count, sheets };
    split++;
  }
  renderAll();
  toast(split ? `Split ${split} part${split === 1 ? '' : 's'} into pieces${whole ? `; ${whole} ${whole === 1 ? 'is' : 'are'} one piece` : ''}.` : 'Every worn part is one piece already: nothing to split.');
}

/** Join all: every split part becomes one piece again. */
function joinAll() {
  for (const key of Object.keys(state.character.split || {})) {
    for (const piece of pieceKeys(state.character, key)) {
      delete state.character.offsets?.[piece];
      delete state.character.itemColors?.[piece];
    }
    delete state.character.split[key];
  }
  if (state.selectedPart.includes('#')) state.selectedPart = itemOfKey(state.selectedPart);
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
  for (const id of SHAPE_FIELDS.map((f) => `off-face-${f}`)) $(id).disabled = !hasFace;
  for (const id of SHAPE_FIELDS.map((f) => `off-sprite-${f}`)) $(id).disabled = !hasSprite;
  $('offsets-note').textContent = !hasSprite
    ? 'This part only appears on the portrait, so it has no sprite position.'
    : !hasFace
      ? 'This part only appears on the sprites, so it has no portrait position.'
      : '';
  $('off-face-x').value = o.face?.x || 0;
  $('off-face-y').value = o.face?.y || 0;
  $('off-sprite-x').value = o.sprite?.x || 0;
  $('off-sprite-y').value = o.sprite?.y || 0;
  $('off-face-rot').value = o.face?.rot || 0;
  $('off-sprite-rot').value = o.sprite?.rot || 0;
  for (const p of ['face', 'sprite']) {
    $(`off-${p}-scale`).value = o[p]?.scale || 100;
    $(`off-${p}-flipx`).checked = !!o[p]?.flipX;
    $(`off-${p}-flipy`).checked = !!o[p]?.flipY;
  }
  $('cell-box').hidden = !hasSprite;
  if (hasSprite) renderCellOptions();
  renderLink();
}

const SHAPE_FIELDS = ['x', 'y', 'rot', 'scale', 'flipx', 'flipy'];

/** Reads one row of position fields (prefix "off-face", "off-sprite" or "image"). */
function readShape(prefix, range = 64) {
  const num = (f, lo, hi, fallback) => Math.max(lo, Math.min(hi, Math.round(Number($(`${prefix}-${f}`).value) || fallback)));
  return {
    x: num('x', -range, range, 0), y: num('y', -range, range, 0), rot: num('rot', -180, 180, 0),
    scale: num('scale', 10, 400, 100), flipX: $(`${prefix}-flipx`).checked, flipY: $(`${prefix}-flipy`).checked,
  };
}

// ---------- chained pieces: two pieces of a split part that change together ----------
// Stored on the split item: split.links = {"1": {to: 2, mode: "mirror"}, "2": {to: 1, ...}}.

function pieceInfo(key) {
  const item = itemOfKey(key);
  const split = item !== key && state.character.split?.[item];
  return split ? { item, n: Number(key.split('#').pop()), split } : null;
}

/** The piece chained to this one: {partner: "Eyes #2", mode: "mirror"|"together"}, or null. */
function linkOf(key) {
  const info = pieceInfo(key);
  const link = info?.split.links?.[info.n];
  if (!link || link.to > info.split.count || link.to === info.n) return null;
  return { partner: `${info.item} #${link.to}`, mode: link.mode };
}

/** A position for the chained piece: mirrored (x and turn the other way) or the same. */
function chained(o, mode) {
  return mode === 'mirror' ? { ...o, x: -(o.x || 0) || 0, rot: -(o.rot || 0) || 0 } : { ...o };
}

/** Gives the chained piece this piece's position (mirrored or the same). */
function syncPartner(key) {
  const link = linkOf(key);
  if (!link) return;
  const offsets = (state.character.offsets ||= {});
  const own = offsets[key];
  if (!own) {
    delete offsets[link.partner];
    return;
  }
  const next = {};
  if (own.face) next.face = chained(own.face, link.mode);
  if (own.sprite) next.sprite = chained(own.sprite, link.mode);
  if (own.cells) {
    next.cells = Object.fromEntries(Object.entries(own.cells).map(([sheet, cells]) => [
      sheet, Object.fromEntries(Object.entries(cells).map(([cell, o]) => [cell, chained(o, link.mode)])),
    ]));
  }
  offsets[link.partner] = next;
}

function setLink(key, to, mode) {
  const info = pieceInfo(key);
  if (!info) return;
  const links = (info.split.links ||= {});
  for (const n of [info.n, to]) {
    if (!n) continue;
    if (links[n]) delete links[links[n].to];
    delete links[n];
  }
  if (to) {
    links[info.n] = { to, mode };
    links[to] = { to: info.n, mode };
    syncPartner(key);
  }
  if (!Object.keys(links).length) delete info.split.links;
}

function renderLink() {
  const info = pieceInfo(state.selectedPart);
  $('link-box').hidden = !info || info.split.count < 2;
  if ($('link-box').hidden) return;
  const link = linkOf(state.selectedPart);
  const others = Array.from({ length: info.split.count }, (_, i) => i + 1).filter((n) => n !== info.n);
  $('link-to').replaceChildren(el('option', { value: '', textContent: 'nothing' }),
    ...others.map((n) => el('option', { value: n, textContent: `piece ${n}` })));
  $('link-to').value = link ? link.partner.split('#').pop() : '';
  $('link-mode').value = link?.mode || 'mirror';
}

function updateLink() {
  setLink(state.selectedPart, Number($('link-to').value) || 0, $('link-mode').value);
  renderSidebar();
  renderOffsets();
  renderPreview();
}
$('link-to').addEventListener('change', updateLink);
$('link-mode').addEventListener('change', updateLink);

// ---------- whole image: move, resize, turn, mirror or flip a whole sheet ----------

function renderImageTransform() {
  if (!state.character) return;
  const t = state.character.sheetTransform?.[$('image-sheet').value] || {};
  $('image-x').value = t.x || 0;
  $('image-y').value = t.y || 0;
  $('image-rot').value = t.rot || 0;
  $('image-scale').value = t.scale || 100;
  $('image-flipx').checked = !!t.flipX;
  $('image-flipy').checked = !!t.flipY;
  markImageTransform();
}

function markImageTransform() {
  const changed = Object.keys(state.character.sheetTransform || {}).map((s) => SHEET_NAMES[s]);
  $('image-transform-mark').textContent = changed.length ? `(changed: ${changed.join(', ')})` : '';
}

function updateImageTransform() {
  const sheet = $('image-sheet').value;
  const t = readShape('image', 400);
  const all = (state.character.sheetTransform ||= {});
  if (t.x || t.y || t.rot || t.scale !== 100 || t.flipX || t.flipY) all[sheet] = t;
  else delete all[sheet];
  markImageTransform();
  renderPreview();
}
for (const f of SHAPE_FIELDS) $(`image-${f}`).addEventListener('input', updateImageTransform);
$('image-sheet').addEventListener('change', renderImageTransform);
$('image-reset').addEventListener('click', () => {
  delete state.character.sheetTransform?.[$('image-sheet').value];
  renderImageTransform();
  renderPreview();
});

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
  syncPartner(state.selectedPart);
  showCellInPreview();
  renderCellValues();
  renderPreview();
}

function updateOffset() {
  const offsets = (state.character.offsets ||= {});
  offsets[state.selectedPart] = { ...offsets[state.selectedPart], face: readShape('off-face'), sprite: readShape('off-sprite') };
  syncPartner(state.selectedPart);
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
/** gradientId null = the source colours (the picture as drawn, no gradient). */
function setSlotColour(slotId, gradientId) {
  const key = ownColourItem();
  if (key) state.character.itemColors[key][slotId] = gradientId;
  else if (gradientId) state.character.colors[slotId] = gradientId;
  else delete state.character.colors[slotId];
}

/** Words in the names of the worn parts that use a slot ("blush", "scar"...), for colour hints. */
function slotWords(slot) {
  const words = new Set();
  for (const id of Object.values(state.character.parts)) {
    const v = id && state.library.variants.get(id);
    if (!v) continue;
    for (const l of v.layers) {
      if (l.slotId !== slot.id && !l.mask?.slots?.has?.(slot.id)) continue;
      for (const w of nameWords(`${v.pid} ${(l.base?.path || '').split('/').pop()}`)) words.add(w);
    }
  }
  return [...words];
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
  return [...SLOTS.filter((s) => ids.has(s.id)), ...PAINTED_SLOTS.filter((s) => ids.has(s.id))];
}

/**
 * VX Ace parts: their colours are painted cells, so a slot shows one swatch per cell (its main
 * colour), taken from the worn layers that use the slot.
 */
function paintedSwatches(slot) {
  const keys = state.selectedPart === ALL_COLOURS ? Object.keys(state.character.parts) : [itemOfKey(state.selectedPart)];
  const layers = keys.map((k) => state.library.variants.get(state.character.parts[k])).filter(Boolean)
    .flatMap((v) => v.layers).filter((l) => l.slotId === slot.id && l.base?.full);
  const count = Math.max(0, ...layers.map((l) => cellCount(l.base)));
  const chosen = paintedIndex(slotColour(slot.id));
  return Array.from({ length: count }, (_, i) => {
    const colour = layers.map((l) => (i < cellCount(l.base) ? averageColour(cellOf(l.base, i)) : null)).find(Boolean) || '#888888';
    const b = el('button', { className: 'swatch painted' + (i === chosen ? ' selected' : ''), title: `Painted colour ${i + 1}` });
    b.style.background = colour;
    b.addEventListener('click', () => {
      setSlotColour(slot.id, i ? `painted:${i}` : null);
      renderSlots();
      renderPreview();
      refreshTiles();
    });
    return b;
  });
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
  const auto = state.selectedPart === ALL_COLOURS ? null
    : autoMaskBox(state.library.variants.get(state.character.parts[itemOfKey(state.selectedPart)]));
  if (!slots.length) {
    const what = state.selectedPart === ALL_COLOURS ? 'The selected parts have' : 'This part has';
    box.replaceChildren(el('p', { className: 'muted', textContent: `${what} no recolourable areas.` }), ...(auto ? [auto] : []),
      ...(state.selectedPart === ALL_COLOURS ? [recolourAllToggle()] : []));
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
  } else {
    const coloured = Object.keys(state.character.colors).length || Object.keys(state.character.itemColors || {}).length;
    const reset = el('button', { className: 'small-button', textContent: 'Back to source colours', disabled: !coloured,
      title: 'Remove every gradient: all parts show the colours they are drawn in' });
    reset.addEventListener('click', () => {
      state.character.colors = {};
      state.character.itemColors = {};
      renderSlots();
      renderPreview();
      refreshTiles();
    });
    const splitButton = el('button', { className: 'small-button', textContent: 'Split all', title: 'Split every worn part into pieces where transparent gaps separate it (e.g. left and right eye)' });
    splitButton.addEventListener('click', splitAll);
    const joinButton = el('button', { className: 'small-button', textContent: 'Join all', hidden: !Object.keys(state.character.split || {}).length, title: 'Make every split part one piece again' });
    joinButton.addEventListener('click', joinAll);
    head.push(el('div', { className: 'source-reset' }, [reset, splitButton, joinButton]), recolourAllToggle());
  }
  box.replaceChildren(...head, ...(auto ? [auto] : []), ...slots.map((slot) => {
    if (slot.painted) {
      return el('div', { className: 'slot' }, [
        el('div', { className: 'slot-head' }, [el('span', { className: 'key', style: `background:#${slot.rgb.toString(16).padStart(6, '0')}` }), el('span', { textContent: `${slot.label} (VX Ace, painted)` })]),
        el('div', { className: 'swatches' }, paintedSwatches(slot)),
      ]);
    }
    const preferred = preferredCategories(slot.id);
    const recommended = recommendColours(slot.id, gradients, slotWords(slot));
    const groups = new Map();
    if (recommended) groups.set('Recommended', recommended.ids.map((id) => gradients.find((g) => g.id === id)));
    for (const g of gradients) {
      if (recommended?.ids.includes(g.id)) continue;
      const key = g.source === 'custom' ? 'Your colours' : preferred.includes(g.category) || g.category === 'all' ? 'Suggested' : 'Other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(g);
    }
    const ordered = ['Recommended', 'Suggested', 'Your colours', 'Other'].filter((k) => groups.has(k));
    const hex = '#' + slot.rgb.toString(16).padStart(6, '0');
    const wrap = el('div', { className: 'slot' }, [
      el('div', { className: 'slot-head' }, [
        el('span', { className: 'key', style: `background:${hex}` }),
        el('span', { textContent: slot.label }),
      ]),
    ]);
    const source = el('button', { className: 'swatch add source' + (slotColour(slot.id) ? '' : ' selected'), textContent: 'Source',
      title: 'The colours the part is drawn in, no gradient' });
    source.addEventListener('click', () => {
      setSlotColour(slot.id, null);
      renderSlots();
      renderPreview();
      refreshTiles();
    });
    wrap.append(el('div', { className: 'swatches', style: 'margin-bottom:5px' }, [source]));
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
        const label = key === 'Recommended' ? `Recommended for ${slot.label.toLowerCase()} (${recommended.why}); ★ = best match. Any other colour works too.` : key;
        if (ordered.length > 1) wrap.append(el('div', { className: 'swatch-group', textContent: label }));
        if (key === 'Recommended') swatches.firstChild?.classList.add('top-pick');
        wrap.append(swatches);
      }
    }
    const add = el('button', { className: 'swatch add', textContent: '+ New', title: 'Make your own gradient' });
    add.addEventListener('click', () => openGradientDialog(slot));
    const current = gradients.find((g) => g.id === slotColour(slot.id));
    const adjust = el('button', { className: 'swatch add', textContent: 'Hue · saturation · brightness…',
      title: current ? `Shift the hue, saturation or brightness of "${current.label}"` : 'Shift the hue, saturation or brightness of the colours this part is drawn in' });
    adjust.addEventListener('click', () => openAdjustDialog(slot, current || null));
    wrap.append(el('div', { className: 'swatches', style: 'margin-top:5px' }, [add, adjust]));
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
        if (!state.customGradients.some((x) => x.id === g.id)) state.customGradients.push(customGradientFromJson(g));
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
  set.customGradients = state.customGradients.filter((g) => used.has(g.id)).map(customGradientToJson);
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
  $('assign-mask-note').hidden = $('assign-mask').parentElement.hidden;
  $('assign-face-fields').hidden = !isFace;
  $('assign-result').textContent = f.part ? `${$('assign-body').value || 'Default'}/${buildPartName(f)}` : 'Pick a part name.';
}

const SHEET_WORDS = { FG: 'portrait', TV: 'walk', TVD: 'damage', SV: 'battler' };

/** What a loaded file is read as, in words: "Male · Clothing pFur01 · walk mask". */
function readingOf(file) {
  const v = file.variant;
  const what = file.role === 'icon' ? 'icon' : `${SHEET_WORDS[file.layer.sheet] || file.layer.sheet} ${file.role === 'mask' ? 'mask' : 'image'}`
    + (file.role === 'mask' && !file.layer.base ? ' (waiting for its image; not listed as a part until then)' : '');
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
  $('assign-queue').textContent = queue ? (queue.length ? `${queue.length} more after this one.` : 'This is the last one.') : '';
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
  slotChosen = false;
  // Start from what it's read as now (reassigning), else guess the sheet from the image size.
  const current = loaded && parsePartPath(`${loaded.variant.bodyType}/${nameOf(loaded)}`);
  assigningPixels = null;
  assigningGuess = null;
  $('assign-suggest').replaceChildren();
  try {
    const pixels = await drawFile($('assign-preview'), entry);
    assigningPixels = pixels;
    assigningGuess = guessSheet(pixels.width, pixels.height);
    $('assign-sheet').value = assigningGuess.sheet;
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
    slotChosen = true; // reassigning keeps the slot it has
  }
  suggestSlot();
  if (!loaded) suggestMask(entry, assigningPixels);
  else $('assign-mask-note').textContent = '';
  // A mask named after a loaded image ("X_c.png" next to "X.png"): read it like that image.
  const image = (!loaded || loaded.role === 'mask') && imageOfMask(state.library, entry.pack, entry.path);
  const imageReading = image && parsePartPath(`${image.variant.bodyType}/${nameOf(image)}`);
  if (imageReading && (!loaded || loaded.variant.id !== image.variant.id)) {
    $('assign-sheet').value = imageReading.sheet;
    $('assign-part').value = imageReading.part;
    $('assign-layer').value = imageReading.layer.slice(imageReading.part.length);
    $('assign-pid').value = imageReading.basePid.replace(/^p/, '');
    $('assign-body').value = imageReading.bodyType;
    $('assign-mask').checked = true;
    $('assign-mask-note').textContent = `Filled in as the colour mask of ${image.path.split('/').pop()} (${readingOf(image)}).`;
  }
  updateAssignPreview();
  if (!$('assign-dialog').open) $('assign-dialog').showModal();
  renderSuggestions(entry, !loaded);
}

let assigningPixels = null;
let assigningGuess = null;
const shapeRefs = new Map();

/**
 * Shapes of the loaded parts on one sheet, to compare a new file with: a few variants of every
 * part and layer (only their images are decoded). Cached until the library changes.
 */
function shapeReferences(sheet) {
  const cacheKey = `${sheet}|${state.library.variants.size}|${state.library.unrecognized.length}`;
  if (!shapeRefs.has(cacheKey)) {
    shapeRefs.set(cacheKey, (async () => {
      const perLayer = new Map();
      for (const v of state.library.variants.values()) {
        for (const l of v.layers) {
          if (l.sheet !== sheet || !l.base) continue;
          const id = `${v.part}|${l.key}`;
          const list = perLayer.get(id) || [];
          if (list.length < 4) list.push({ v, l });
          perLayer.set(id, list);
        }
      }
      const picked = [...perLayer.values()].flat();
      await Promise.all(picked.map(({ l }) => ensureImage(l.base).catch(() => null)));
      return picked.filter(({ l }) => l.base.pixels).map(({ v, l }) => ({
        part: v.part, layer: l.layer.slice(v.part.length), cell: l.key.split(':')[1], pack: v.pack, path: l.base.path,
        profile: shapeProfile(l.base.pixels, sheet),
      })).filter((r) => r.profile);
    })());
  }
  return shapeRefs.get(cacheKey);
}

/**
 * Suggestions for the file being assigned: the image (from its size and frame grid) and the
 * parts that sit in the same place. fill: put the best one in the fields if they are empty.
 */
let suggestToken = 0;
async function renderSuggestions(entry, fill = false) {
  const token = ++suggestToken;
  const box = $('assign-suggest');
  const sheet = $('assign-sheet').value;
  const pixels = assigningPixels;
  box.replaceChildren();
  if (assigningGuess) box.append(el('span', { className: 'muted', textContent: `Suggested image: ${SHEET_NAMES[assigningGuess.sheet] || 'Variation icon'} (${assigningGuess.why}).` }));
  if (!pixels || sheet === 'icon') return;
  const profile = shapeProfile(pixels, sheet);
  if (!profile) return;
  const waiting = el('span', { className: 'muted', textContent: 'Comparing with the loaded parts…' });
  box.append(waiting);
  const refs = (await shapeReferences(sheet)).filter((r) => !(r.pack === entry.pack && r.path === entry.path));
  if (token !== suggestToken || assigning !== entry) return;
  waiting.remove();
  const fileName = entry.path.split('/').pop();
  const named = partsInName(fileName, [...new Set([...PART_ORDER, ...partNames(state.library, state.character?.bodyType)])]);
  const ranked = rankWithName(profile, refs, named).filter((r) => r.score >= 0.15);
  if (!ranked.length) {
    box.append(el('span', { className: 'muted', textContent: 'No loaded part sits in the same place.' }));
    return;
  }
  box.append(el('span', { textContent: named.length ? 'By its name and where it sits:' : 'Sits where these parts sit:' }), ...ranked.map((r) => {
    const why = r.named ? `"${fileName}" names this part, and its shape is compared with the loaded ${r.part} parts` : `Sits where the loaded ${r.part} parts sit`;
    const b = el('button', { type: 'button', className: 'small-button', textContent: `${suggestionLabel(r, refs, sheet)}${r.named ? ' (name)' : ''} · ${Math.round(r.score * 100)}%`, title: `${why}. Click to use it.` });
    b.addEventListener('click', () => applySuggestion(r));
    return b;
  }));
  if (fill && !$('assign-part').value) applySuggestion(ranked[0]);
}

/**
 * A suggestion in words: "Cloak · front layer" instead of "Cloak1" (layer 1 is drawn in front of
 * layer 2). The layer is only named when that part has more than one.
 */
function suggestionLabel(r, refs, sheet) {
  const layers = new Set(refs.filter((x) => x.part === r.part).map((x) => x.layer));
  let label = r.part;
  if (layers.size > 1 && r.layer) label += r.layer === '1' ? ' · front layer' : r.layer === '2' ? ' · back layer' : ` · layer ${r.layer}`;
  if (sheet === 'FG' && r.cell) label += ` · ${r.cell}`;
  return label;
}

/**
 * Colour mask or not: a "_c" name says so; otherwise a file is read as a colour mask when it is
 * drawn in mask colours, whatever its name ("FaceMask.png" drawn normally is something worn).
 */
function suggestMask(entry, pixels) {
  const stem = entry.path.split('/').pop().replace(/\.png$/i, '');
  const note = $('assign-mask-note');
  note.textContent = '';
  if (/_c$/i.test(stem) || !pixels) return;
  const share = maskColourShare(pixels, matchSlot);
  const looksLikeMask = share >= 0.8;
  const namedMask = /mask/i.test(stem);
  $('assign-mask').checked = looksLikeMask;
  if (looksLikeMask) note.textContent = `Ticked: ${Math.round(share * 100)}% of it is in colour-mask colours.`;
  else if (namedMask) note.textContent = `Named "mask", but only ${Math.round(share * 100)}% is in colour-mask colours, so it's probably something worn, not a colour mask.`;
  updateAssignPreview();
}

function applySuggestion(r) {
  $('assign-part').value = r.part;
  $('assign-layer').value = r.layer;
  if (r.cell && [...$('assign-cell').options].some((o) => o.value === r.cell)) $('assign-cell').value = r.cell;
  suggestSlot();
  updateAssignPreview();
}

/** The colour slot was picked by hand (or kept from the file): the part no longer changes it. */
let slotChosen = false;

/**
 * Face pictures: the colour slot follows the part (FrontHair: Hair, Body: Skin...) until you pick
 * one yourself. The suggested option says so.
 */
function suggestSlot() {
  const select = $('assign-slot');
  for (const o of select.options) o.textContent = o.textContent.replace(/ \(suggested.*\)$/, '');
  const s = slotForPart($('assign-part').value.trim());
  const m = s && SLOT_BY_ID.get(s.slotId)?.m;
  if (!m) {
    if (!slotChosen) select.value = '';
    return;
  }
  const option = [...select.options].find((o) => Number(o.value) === m);
  option.textContent += ` (suggested for ${s.like})`;
  if (!slotChosen) select.value = String(m);
}
$('assign-slot').addEventListener('change', () => (slotChosen = true));
$('assign-part').addEventListener('input', suggestSlot);
$('assign-sheet').addEventListener('change', () => assigning && renderSuggestions(assigning));

/** Parts whose variant was taken away (reassigned) are taken off the character. */
function dropMissingParts() {
  if (!state.character) return;
  for (const [key, id] of Object.entries(state.character.parts)) {
    if (id && !state.library.variants.has(id)) state.character.parts[key] = null;
  }
}

function afterFilesChanged() {
  // Assigned or unassigned files can leave a picture without a colour mask, or give it one.
  for (const v of state.library.variants.values()) applyAutoMask(v);
  thumbCache.clear();
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
    if (a.removed) {
      removeFile(state.library, packName, path);
      if (a.deleted) {
        const r = state.library.removed.find((u) => u.pack === packName && u.path === path);
        if (r) r.deleted = true;
      }
      continue;
    }
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

// ---------- colour masks made by the generator, for parts drawn without one ----------

/** A picture that can't be recoloured: no colour mask and no slot (not painted VX Ace either). */
const unmasked = (l) => l.base && !l.base.cells && !l.slotId && (!l.mask || l.mask.auto);

/** The plan of a part's made colour mask: {count: 1..8 or 'auto', slots: [...] or null}, or none. */
function autoMaskPlan(variant) {
  const saved = state.settings.autoMasks?.[variant.id];
  if (saved !== undefined) return saved || null; // false: removed by you
  // Recolour all (on unless turned off): every part without a colour mask gets one.
  return state.settings.recolourAll !== false ? { count: 'auto', slots: null, automatic: true } : null;
}

/** Recolour all on or off: parts without a colour mask get one made by the generator, or not. */
function setRecolourAll(on) {
  state.settings.recolourAll = on;
  saveSettings();
  for (const v of state.library.variants.values()) applyAutoMask(v);
  thumbCache.clear();
  ensureVariants(variantsToDecode(state.character, state.library)).then(() => renderAll());
  toast(on ? 'Recolour all: parts without a colour mask now follow the colours too.' : 'Recolour all is off: parts without a colour mask keep the colours they are drawn in (unless you made them recolourable).');
}

function recolourAllToggle() {
  const box = el('input', { type: 'checkbox', className: 'recolour-all', checked: state.settings.recolourAll !== false });
  box.addEventListener('change', () => setRecolourAll(box.checked));
  return el('label', { className: 'lock', title: 'Parts drawn without a colour mask get one made by the generator, so they follow the colours like RPG Maker\'s own parts' },
    [box, ' Recolour all: make every part without a colour mask recolourable']);
}

/**
 * Gives a part's pictures without a colour mask one made by the generator, as saved in
 * settings.autoMasks[variant id] = {count, slots}: the drawn colours split into `count` groups
 * ('auto': as many as it finds), group i recoloured with slots[i] (null: keeps its colours; no
 * slots: the part's own slots, outlines and whites kept). No plan: the made masks go.
 */
function applyAutoMask(variant) {
  const plan = autoMaskPlan(variant);
  const layers = variant.layers.filter(unmasked);
  for (const l of layers) if (l.mask?.auto) l.mask = null;
  delete variant.autoGroups;
  delete variant.autoSlots;
  delete variant.iconMask;
  if (!plan || !layers.length) return;
  // One set of colour groups for all the part's pictures, so portrait and sprites match.
  let groups = null;
  variant.autoGroups = () => (groups ||= Promise.all(layers.map((l) => ensureImage(l.base)))
    .then((pictures) => (plan.count === 'auto' ? colourGroups(pictures, MAX_GROUPS, AUTO_SPREAD, true) : colourGroups(pictures, plan.count))));
  variant.autoSlots = async () => {
    const g = await variant.autoGroups();
    return plan.slots ? g.map((_, i) => plan.slots[i] ?? null) : defaultGroupSlots(variant.part, g.length, g);
  };
  for (const l of layers) {
    l.mask = {
      auto: true, src: null, pixels: null, path: `${l.base.path} (colour mask made by the generator)`,
      make: async () => makeMask(await ensureImage(l.base), await variant.autoGroups(), await variant.autoSlots()),
    };
  }
}

/** Makes (count 1..8 or 'auto') or removes (0) the colour mask of a part, and redraws. */
function setAutoMask(variant, count) {
  const masks = (state.settings.autoMasks ||= {});
  if (count) masks[variant.id] = { count, slots: null };
  else if (state.settings.recolourAll !== false) masks[variant.id] = false; // stays without one
  else delete masks[variant.id];
  saveSettings();
  applyAutoMask(variant);
  afterAutoMask(variant);
}

function afterAutoMask(variant) {
  thumbCache.clear();
  ensureVariants([variant]).then(() => {
    renderSlots();
    renderPreview();
    refreshTiles();
  });
}

/**
 * The box above the colours of a part drawn (partly) without a colour mask: make one, or change
 * the made one (how many colour groups, which slot each group uses).
 */
function autoMaskBox(variant) {
  if (!variant || !variant.layers.some(unmasked)) return null;
  const plan = autoMaskPlan(variant);
  const count = el('select', { title: 'How many colours the drawing is split into' }, [
    el('option', { value: 'auto', textContent: 'As many colour groups as it finds', selected: !plan || plan.count === 'auto' }),
    ...Array.from({ length: MAX_GROUPS }, (_, i) => el('option', { value: i + 1, textContent: i ? `${i + 1} colour groups` : '1 colour group', selected: i + 1 === plan?.count })),
  ]);
  const countValue = () => (count.value === 'auto' ? 'auto' : Number(count.value));
  const box = el('div', { className: 'automask' });
  if (!plan) {
    const make = el('button', { className: 'small-button', textContent: 'Make it recolourable' });
    make.addEventListener('click', () => setAutoMask(variant, countValue()));
    const some = variant.layers.some((l) => l.base && !unmasked(l));
    box.append(
      el('p', { className: 'muted small', textContent: `${variant.part} ${variant.pid} is drawn without a colour mask${some ? ' on some images' : ''}, so it keeps the colours it is drawn in. The generator can make a mask: it splits the drawing into colour groups (light and shade of one colour stay together) and gives each group a colour slot.` }),
      el('div', { className: 'layer-head' }, [make, count]),
      recolourAllToggle(),
    );
    return box;
  }
  count.addEventListener('change', () => setAutoMask(variant, countValue()));
  const remove = el('button', { className: 'small-button', textContent: 'Remove the made mask' });
  remove.addEventListener('click', () => setAutoMask(variant, 0));
  const rows = el('div', { className: 'automask-groups' }, [el('span', { className: 'muted small', textContent: 'Finding the colours…' })]);
  Promise.all([variant.autoGroups?.(), variant.autoSlots?.()]).then(([groups, slots]) => {
    if (!groups) return;
    rows.replaceChildren(...groups.map((g, i) => {
      const select = el('select', {}, [
        el('option', { value: '', textContent: 'keep as drawn' }),
        ...SLOTS.map((s) => el('option', { value: s.id, textContent: s.label, selected: slots[i] === s.id })),
      ]);
      if (!slots[i]) select.value = '';
      select.addEventListener('change', () => {
        const chosen = [...slots];
        chosen[i] = select.value || null;
        (state.settings.autoMasks ||= {})[variant.id] = { count: plan.count, slots: chosen };
        saveSettings();
        applyAutoMask(variant);
        afterAutoMask(variant);
      });
      return el('div', { className: 'layer-head' }, [
        el('span', { className: 'key', title: 'Drawn colour of this group', style: `background:#${g.rgb.toString(16).padStart(6, '0')}` }),
        el('span', { className: 'small', textContent: `Group ${i + 1} uses` }), select,
      ]);
    }));
  });
  // The made masks tell the editor which slots to show once decoded.
  const undecoded = variant.layers.filter((l) => l.mask?.auto && !l.mask.pixels);
  if (undecoded.length) Promise.all(undecoded.map((l) => ensureImage(l.mask, true))).then(() => renderSlots());
  box.append(
    el('p', { className: 'muted small', textContent: `${plan.automatic ? `${variant.part} ${variant.pid} is drawn without a colour mask, so the generator made one (Recolour all). ` : 'Colour mask made by the generator: '}each colour group of the drawing uses the slot picked here, in the colours picked below. Black outlines and whites keep their colours at first.` }),
    el('div', { className: 'layer-head' }, [count, remove]),
    rows,
    recolourAllToggle(),
  );
  return box;
}

// ---------- removing single parts and files (not the whole folder) ----------

/** Parts removed by you (settings.removedParts) stay out of the lists when their folder opens. */
function applyRemovedParts(packName) {
  for (const v of state.library.variants.values()) {
    const removed = v.pack === packName && state.settings.removedParts?.[v.id];
    if (removed) v.hidden = v.removed = true;
    if (removed === 'deleted') v.deleted = true;
  }
}

/** Takes the part the selected item wears out of the generator (only that part). */
function removePartByUser() {
  const key = state.selectedPart;
  const variant = state.library.variants.get(state.character.parts[key]);
  if (!variant) return;
  const before = structuredClone(state.character);
  variant.hidden = variant.removed = true;
  (state.settings.removedParts ||= {})[variant.id] = true;
  saveSettings();
  if (REQUIRED_PARTS.has(partOfKey(key))) {
    delete state.character.parts[key];
    applyDefaults(state.character, state.library);
  } else state.character.parts[key] = null;
  renderAll();
  toast(`Removed ${variant.part} ${variant.pid} (${variant.pack}). It's listed under Files… → Removed.`, 8000, {
    label: 'Undo',
    run: () => {
      putPartBack(variant, false);
      state.character = before;
      renderAll();
    },
  });
}
$('remove-part').addEventListener('click', removePartByUser);

function putPartBack(variant, render = true) {
  variant.removed = false;
  variant.hidden = state.settings.lookalikes?.[variant.id] === 'hide';
  delete state.settings.removedParts?.[variant.id];
  saveSettings();
  if (!render) return;
  toast(`${variant.part} ${variant.pid} is back.`);
  afterFilesChanged();
}

function removeFileByUser(file) {
  if (!removeFile(state.library, file.pack, file.path)) return;
  remember(file, { removed: true });
  toast(`Removed ${file.path.split('/').pop()}. It's listed under "Removed".`, 8000, { label: 'Undo', run: () => putFileBack(file) });
  afterFilesChanged();
}

/**
 * A removed file or part, to reassign: the file goes back to the "To assign" list and the assign
 * dialog opens for it. A removed part is put back and its picture opens in the assign dialog.
 */
function reassignRemoved(file) {
  if (file.removedPart) {
    putPartBack(file.variant, false);
    afterFilesChanged();
    const picture = libraryFiles(state.library).find((f) => f.variant === file.variant && f.role === 'image');
    if (picture) openAssignDialog(picture);
    return;
  }
  const entry = restoreToAssign(state.library, file.pack, file.path);
  if (!entry) return;
  delete state.settings.assignments?.[`${file.pack}|${file.path}`];
  saveSettings();
  afterFilesChanged();
  openAssignDialog(entry);
}

/**
 * Deletes a removed file or part from the Removed list: it stays out of the generator and isn't
 * listed any more (until the folder is forgotten). Undo brings it back to the list.
 */
function deleteRemoved(file) {
  const name = file.removedPart ? `${file.variant.part} ${file.variant.pid}` : file.path.split('/').pop();
  const setDeleted = (on) => {
    if (file.removedPart) {
      file.variant.deleted = on;
      state.settings.removedParts[file.variant.id] = on ? 'deleted' : true;
    } else {
      const r = state.library.removed.find((u) => u.pack === file.pack && u.path === file.path);
      if (r) r.deleted = on;
      (state.settings.assignments ||= {})[`${file.pack}|${file.path}`] = on ? { removed: true, deleted: true } : { removed: true };
    }
    saveSettings();
    renderFiles();
  };
  setDeleted(true);
  toast(`Deleted ${name} from the Removed list. It stays out of the generator; forgetting the folder brings it back.`, 8000, { label: 'Undo', run: () => setDeleted(false) });
}

function putFileBack(file) {
  if (!restoreFile(state.library, file.pack, file.path)) return;
  delete state.settings.assignments?.[`${file.pack}|${file.path}`];
  saveSettings();
  toast(`${file.path.split('/').pop()} is back.`);
  afterFilesChanged();
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
    // Reassigning an image takes its colour mask along (unassigning it would leave the mask behind).
    const mask = entry.role === 'image' && entry.layer?.mask && !entry.layer.mask.auto ? entry.layer.mask.path : null;
    const file = unassignFile(state.library, entry.pack, entry.path) || entry;
    const error = assignFile(state.library, entry.pack, entry.path, file.src, readAs, bodyType);
    if (error) {
      toast(error);
      return;
    }
    if ($('assign-remember').checked) remember(entry, { readAs, bodyType });
    const parsed = parsePartPath(`${bodyType}/${readAs}`);
    if (mask && parsed.sheet && parsed.sheet !== 'FG' && !parsed.isMask) {
      const maskAs = readAs.replace(/\.png$/i, '_c.png');
      const m = unassignFile(state.library, entry.pack, mask);
      if (m && !assignFile(state.library, entry.pack, mask, m.src, maskAs, bodyType)) {
        state.library.readAs.set(`${entry.pack}|${mask}`, { readAs: maskAs, bodyType, how: 'hand' });
        if ($('assign-remember').checked) remember({ pack: entry.pack, path: mask }, { readAs: maskAs, bodyType });
      }
    }
    toast(`${entry.path.split('/').pop()}: ${bodyType} ${f.part}${mask ? ', with its colour mask' : ''}.`);
    afterFilesChanged();
  }
  if (action === 'remove') removeFileByUser(entry);
  // One by one: on to the next file that still needs assigning.
  if (queue && (action === 'ok' || action === 'skip' || action === 'remove')) {
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
  if (tab === 'removed') {
    const parts = [...lib.variants.values()].filter((v) => v.removed).map((v) => {
      const l = v.layers.find((x) => x.base) || {};
      return { pack: v.pack, path: l.base?.path || v.id, src: l.base?.src, variant: v, removedPart: true };
    });
    return [...lib.removed.filter((f) => !f.deleted).map((f) => ({ ...f, removedFile: true })), ...parts.filter((f) => !f.variant.deleted)];
  }
  const loaded = libraryFiles(lib);
  // A VX Ace file feeds several layers (and both body types): list it once.
  const once = (files) => [...new Map(files.map((f) => [`${f.pack}|${f.path}`, f])).values()];
  if (tab === 'all') return once([...lib.unrecognized, ...loaded]);
  return loaded.filter((f) => lib.readAs.get(`${f.pack}|${f.path}`)?.how === tab);
}

function fileCard(file, observer) {
  const loaded = !!file.variant;
  const canvas = el('canvas', { width: 0, height: 0 });
  canvas.file = file;
  observer.observe(canvas);
  const buttons = [];
  let reading;
  if (file.removedFile || file.removedPart) {
    const back = el('button', { type: 'button', className: 'small-button', textContent: 'Put back', title: 'Back where it was before you removed it' });
    back.addEventListener('click', () => (file.removedPart ? putPartBack(file.variant) : putFileBack(file)));
    const reassign = el('button', { type: 'button', className: 'small-button', textContent: 'Reassign…', title: 'Put it back as another part, image or variation' });
    reassign.addEventListener('click', () => reassignRemoved(file));
    const del = el('button', { type: 'button', className: 'small-button', textContent: 'Delete', title: 'Take it off this list for good: it stays out of the generator (the file on your computer stays)' });
    del.addEventListener('click', () => deleteRemoved(file));
    buttons.push(back, reassign, del);
    reading = file.removedPart ? `${file.variant.bodyType} · ${file.variant.part} ${file.variant.pid} · part removed by you` : 'File removed by you';
  } else {
    const assign = el('button', { type: 'button', className: 'small-button', textContent: loaded ? 'Reassign…' : 'Assign…' });
    assign.addEventListener('click', () => openAssignDialog(file));
    buttons.push(assign);
    if (loaded) {
      const unassign = el('button', { type: 'button', className: 'small-button', textContent: 'Unassign', title: 'Take it out of its part and put it in the "To assign" list' });
      unassign.addEventListener('click', () => unassignByUser(file));
      buttons.push(unassign);
    }
    const remove = el('button', { type: 'button', className: 'small-button', textContent: 'Remove', title: 'Take this file out of the generator (the file on your computer stays). Put it back under "Removed"' });
    remove.addEventListener('click', () => removeFileByUser(file));
    buttons.push(remove);
    const readAs = state.library.readAs.get(`${file.pack}|${file.path}`);
    const how = readAs?.how;
    reading = loaded
      ? `${readingOf(file)}${how === 'odd' ? (readAs.bySize ? ' (read by its size: the name says another image)' : ' (guessed from the name)') : how === 'hand' ? ' (assigned by you)' : ''}`
      : file.reason;
  }
  return el('div', { className: 'file-card' }, [
    el('div', { className: 'file-thumb' }, [canvas]),
    el('div', { className: 'file-name', textContent: file.path.split('/').pop(), title: `${file.pack}: ${file.path}` }),
    el('div', { className: 'file-reading', textContent: reading }),
    el('div', { className: 'file-buttons' }, buttons),
  ]);
}

const TAB_LABELS = { queue: 'To assign', odd: 'Odd names', hand: 'Assigned by you', all: 'All files', removed: 'Removed', folders: 'Folders' };
const TAB_NOTES = {
  queue: 'Files the generator could not read from their name. Assign them one by one, or pick one.',
  odd: 'Files with unusual names, read by guessing. Reassign any that were guessed wrong.',
  hand: 'Files you assigned. Reassign or unassign them if one went wrong.',
  all: 'Every file of the opened folders. Reassign any of them, e.g. one that was read as the wrong part.',
  folders: 'The folders of the opened generator folders. Move a folder\'s parts to another body type (e.g. Kid parts to Male), or remove a folder you don\'t want. Both are remembered, and the files on your computer are never touched.',
  removed: 'Parts and files you removed. They stay out (also after a reload) until you put them back or reassign them. Delete takes one off this list for good. The files on your computer are never touched.',
};

/** What the search box looks in: the file's path and what it is read as. */
function searchText(f) {
  const v = f.variant;
  if (f.removedPart) return `${f.path} ${v.bodyType} ${v.part} ${v.pid} ${v.pack}`;
  return `${f.path} ${v && f.layer ? readingOf(f) : v ? `${v.bodyType} ${v.part} ${v.pid}` : ''}`;
}

function renderFiles() {
  const query = $('files-search').value.trim().toLowerCase();
  const matches = (f) => !query || searchText(f).toLowerCase().includes(query);
  const counts = Object.fromEntries(['queue', 'odd', 'hand', 'removed'].map((t) => [t, filesFor(t).length]));
  for (const b of $('files-tabs').children) {
    const tab = b.dataset.tab;
    b.classList.toggle('active', tab === filesTab);
    b.textContent = tab in counts ? `${TAB_LABELS[tab]} (${counts[tab]})` : TAB_LABELS[tab];
  }
  if (filesTab === 'folders') {
    $('files-start').hidden = true;
    $('files-more').hidden = true;
    $('files-note').textContent = TAB_NOTES.folders;
    const rows = folderList().filter((d) => !query || `${d.pack} ${d.dir}`.toLowerCase().includes(query));
    $('files-list').replaceChildren(...(rows.length ? rows.map(folderRow) : [el('p', { className: 'muted', textContent: 'No folder matches.' })]));
    return;
  }
  const files = filesFor(filesTab).filter(matches);
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

// ---------- Folders: a folder's parts to another body type, or the whole folder out ----------

const dirOf = (path) => path.slice(0, path.lastIndexOf('/') + 1).replace(/\/$/, '') || '(top folder)';

/** The folders of the opened packs, with their files: [{pack, dir, files, loaded, bodyTypes}]. */
function folderList() {
  const lib = state.library;
  const byDir = new Map();
  const add = (f, loaded) => {
    const key = `${f.pack}|${dirOf(f.path)}`;
    if (!byDir.has(key)) byDir.set(key, { pack: f.pack, dir: dirOf(f.path), files: new Map(), loaded: [], bodyTypes: new Set() });
    const d = byDir.get(key);
    if (d.files.has(f.path)) return; // a VX Ace file feeds several layers
    d.files.set(f.path, f);
    if (loaded) {
      d.loaded.push(f);
      d.bodyTypes.add(f.variant.bodyType);
    }
  };
  for (const f of libraryFiles(lib)) add(f, true);
  for (const f of lib.unrecognized) add(f, false);
  return [...byDir.values()].sort((a, b) => `${a.pack}|${a.dir}`.localeCompare(`${b.pack}|${b.dir}`));
}

/** The name a loaded file is read as: what it was assigned or re-read as, or its own name. */
function readAsName(file) {
  return state.library.readAs.get(`${file.pack}|${file.path}`)?.readAs || file.path.split('/').pop();
}

/** Moves the parts of a folder to another body type (remembered like assigning by hand). */
function moveFolder(d, bodyType) {
  const lib = state.library;
  const files = d.loaded.filter((f) => !f.layer?.vxace && f.variant.bodyType !== bodyType);
  // Masks first out and last in, so they go with their images.
  const order = [...files.filter((f) => f.role === 'mask'), ...files.filter((f) => f.role !== 'mask')];
  const plan = order.map((f) => ({ f, readAs: readAsName(f) }));
  for (const { f } of plan) unassignFile(lib, f.pack, f.path);
  let moved = 0;
  for (const { f, readAs } of [...plan.filter((p) => p.f.role !== 'mask'), ...plan.filter((p) => p.f.role === 'mask')]) {
    if (assignFile(lib, f.pack, f.path, f.src, readAs, bodyType)) continue;
    remember(f, { readAs, bodyType });
    moved++;
  }
  afterFilesChanged();
  toast(`Moved ${moved} file${moved === 1 ? '' : 's'} of ${d.dir} to ${bodyType}. A part that was there already is listed as a copy ("p01 (2)"): see "Look-alikes…".`, 8000);
}

/** Removes every file of a folder (they go to "Removed"); Undo puts them back. */
function removeFolder(d) {
  const removed = [];
  for (const f of d.files.values()) {
    if (!removeFile(state.library, f.pack, f.path)) continue;
    remember(f, { removed: true });
    removed.push(f);
  }
  afterFilesChanged();
  const undo = () => {
    for (const f of removed) {
      if (!restoreFile(state.library, f.pack, f.path)) continue;
      delete state.settings.assignments?.[`${f.pack}|${f.path}`];
    }
    saveSettings();
    afterFilesChanged();
  };
  toast(`Removed ${removed.length} file${removed.length === 1 ? '' : 's'} of ${d.dir}. They're listed under "Removed".`, 10000, { label: 'Undo', run: undo });
}

function folderRow(d) {
  const bodies = [...state.library.bodyTypes.keys()];
  const target = el('select', { title: 'Body type to move the parts to' }, bodies.map((b) => el('option', { value: b, textContent: b })));
  const now = [...d.bodyTypes];
  target.value = bodies.find((b) => !now.includes(b)) || bodies[0];
  const move = el('button', { type: 'button', className: 'small-button', textContent: 'Move its parts to', disabled: !d.loaded.length });
  move.addEventListener('click', () => moveFolder(d, target.value));
  const remove = el('button', { type: 'button', className: 'small-button', textContent: 'Remove folder', title: 'Take every file of this folder out of the generator. Put them back under "Removed"' });
  remove.addEventListener('click', () => removeFolder(d));
  const what = [
    `${d.files.size} file${d.files.size === 1 ? '' : 's'}`,
    now.length ? `parts for ${now.join(', ')}` : '',
    d.files.size > d.loaded.length ? `${d.files.size - d.loaded.length} to assign` : '',
  ].filter(Boolean).join(' · ');
  return el('div', { className: 'folder-row' }, [
    el('div', {}, [el('b', { textContent: d.dir }), el('span', { className: 'muted small', textContent: `  ${d.pack} · ${what}` })]),
    el('div', { className: 'file-buttons' }, [move, target, remove]),
  ]);
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

// ---------- look-alikes ----------

/** Asks whether to open a folder whose files match one already open. Resolves true to open it. */
function askOpenAgain(packName, twin) {
  const same = twin.same === twin.total ? `all ${twin.total}` : `${twin.same} of its ${twin.total}`;
  $('same-text').textContent = `"${packName}" looks like "${twin.pack.name}", which is already open: ${same} images have the same name and size.`;
  return new Promise((resolve) => {
    const dialog = $('same-dialog');
    dialog.returnValue = '';
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'open'), { once: true });
    dialog.showModal();
  });
}

state.lookalikes = []; // [{variant, other, result}], see lookalike.js

/**
 * Duplicates by their files, not their names: parts of a body type made of the very same files as
 * another part (other number, other folder, other opened folder). They are listed in Look-alikes
 * and hidden, unless you said to show them. packName: only duplicates involving that folder.
 * @returns {Promise<number>} how many were hidden now
 */
async function findSameFiles(packName = null, quiet = false) {
  const lib = state.library;
  const refs = [];
  for (const f of libraryFiles(lib)) {
    if (f.role === 'icon' || f.layer.base?.cells) continue;
    const ref = f.role === 'mask' ? f.layer.mask : f.layer.base;
    if (!ref.digest) refs.push(ref);
  }
  await Promise.all(refs.map(async (ref) => {
    ref.digest = await fileBytes(ref.src).then(digestBytes).catch(() => null);
  }));
  const pairs = sameFileDuplicates(lib, packName);
  const listed = new Set(state.lookalikes.map((f) => f.variant.id));
  const choices = state.settings.lookalikes || {};
  let hidden = 0;
  for (const pair of pairs) {
    const sheet = SHEET_KEYS.find((s) => pair.variant.layers.some((l) => l.sheet === s)) || null;
    const result = { identical: true, sameFiles: true, differ: 0, visible: 0, ratio: 0, maskDiffer: 0, sheet };
    if (listed.has(pair.variant.id)) {
      // Listed as a copy already: known to be the same files now, unless known to be identical.
      const known = state.lookalikes.find((f) => f.variant.id === pair.variant.id);
      if (!known.result.identical) Object.assign(known, { other: pair.other, result });
    } else {
      state.lookalikes.push({ ...pair, result });
    }
    const choice = choices[pair.variant.id];
    const hide = pair.variant.removed || choice !== 'show';
    if (hide && !pair.variant.hidden) hidden++;
    pair.variant.hidden = hide;
  }
  updateAlikesButton();
  if (hidden) renderEditor();
  if ($('alike-dialog').open) renderAlikes();
  if (hidden || !quiet) {
    toast(hidden
      ? `Hid ${hidden} duplicate${hidden === 1 ? '' : 's'}: parts made of the same files as another part (other number or folder). See "Look-alikes…".`
      : pairs.length
        ? `${pairs.length} duplicate${pairs.length === 1 ? '' : 's'} found (parts made of the same files as another), all hidden already. See "Look-alikes…".`
        : 'No duplicates: no part is made of the same files as another.', 8000);
  }
  return hidden;
}

/** Compares a pack's copies with their originals; hides exact duplicates unless you said not to. */
function checkLookalikes(packName) {
  if (!lookalikePairs(state.library, packName).length) return Promise.resolve();
  return withBusy('Looking for look-alikes', () => checkLookalikesNow(packName));
}

async function checkLookalikesNow(packName) {
  const pairs = lookalikePairs(state.library, packName);
  if (!pairs.length) return;
  await ensureLayers(pairs.flatMap(pairLayers), (done, total) => busyStep(`Looking for look-alikes in "${packName}"`, done, total));
  const found = findLookalikes(state.library, packName);
  const choices = state.settings.lookalikes || {};
  let autoHidden = 0;
  for (const f of found) {
    const choice = choices[f.variant.id];
    f.variant.hidden = f.variant.removed || choice === 'hide' || (choice !== 'show' && f.result.identical);
    if (!choice && f.result.identical) autoHidden++;
  }
  state.lookalikes = [...state.lookalikes.filter((f) => f.variant.pack !== packName), ...found];
  updateAlikesButton();
  const undecided = found.filter((f) => !f.result.identical && f.result.ratio <= LOOKALIKE_RATIO && !choices[f.variant.id]);
  if (autoHidden) renderEditor();
  if (undecided.length && !document.querySelector('dialog[open]')) openAlikesDialog();
  else if (undecided.length || autoHidden) {
    const parts = [];
    if (autoHidden) parts.push(`Hid ${autoHidden} exact duplicate${autoHidden > 1 ? 's' : ''}.`);
    if (undecided.length) parts.push(`${undecided.length} near copies to look at.`);
    toast(`${parts.join(' ')} See "Look-alikes…".`, 8000);
  }
}

function updateAlikesButton() {
  const listed = state.lookalikes.filter((f) => f.result.identical || f.result.ratio <= LOOKALIKE_RATIO);
  $('open-alikes').hidden = !state.lookalikes.length;
  $('open-alikes').textContent = listed.length ? `Look-alikes… (${listed.length})` : 'Look-alikes…';
}

function putPixels(canvas, pixels) {
  if (!pixels) return;
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
}

/** One copy next to the part it looks like, with a picture of where they differ. */
function alikeCard(f) {
  const { variant, other, result } = f;
  const pic = (label) => {
    const canvas = el('canvas', { width: 0, height: 0 });
    return { canvas, figure: el('figure', {}, [canvas, el('figcaption', { textContent: label })]) };
  };
  const otherName = other.pack !== variant.pack ? `${other.pid} · ${other.pack}` : other.pid;
  const a = pic(other.pack !== variant.pack ? otherName : `${other.pid} (original)`);
  const b = pic(variant.pid);
  const d = pic('differences');
  const sheets = result.sheet ? [result.sheet] : undefined;
  // The files as drawn, not recoloured: a different colour area (mask) would look like a
  // completely different picture.
  Promise.all([partThumbnail(variant.part, other, sheets, true), partThumbnail(variant.part, variant, sheets, true)]).then(([pa, pb]) => {
    putPixels(a.canvas, pa);
    putPixels(b.canvas, pb);
    if (pa && pb) putPixels(d.canvas, differenceImage(pa, pb));
  }).catch(() => {});
  const pct = Math.round(result.ratio * 1000) / 10;
  const otherWhere = `${other.bodyType !== variant.bodyType ? `${other.bodyType} ` : ''}${otherName}`;
  const verdict = result.sameFiles ? `the same files as ${otherWhere}${other.pid !== variant.pid ? ' (another number)' : ''}`
    : result.identical ? `the same pixels as ${otherName}`
    : !result.differ ? `the same picture as ${otherName}; only its colour areas (mask) differ, in ${result.maskDiffer} pixels, so it recolours differently`
      : `${pct >= 1 ? `${pct}% of its pixels` : `${result.differ} pixel${result.differ > 1 ? 's' : ''}`} differ from ${otherName}${result.maskDiffer ? ', and its colour areas differ too' : ''}`;
  const toggle = el('button', { type: 'button', className: 'small-button', textContent: variant.hidden ? 'Show it again' : `Hide ${variant.pid}` });
  toggle.style.marginTop = '0';
  toggle.addEventListener('click', () => {
    decidedNow.add(variant.id); // stays in the list until the dialog is opened again
    variant.hidden = !variant.hidden;
    (state.settings.lookalikes ||= {})[variant.id] = variant.hidden ? 'hide' : 'show';
    saveSettings();
    renderAlikes();
    renderEditor();
  });
  const where = `${variant.bodyType} ${variant.part} ${variant.pid}${state.library.packs.length > 1 ? ` · ${variant.pack}` : ''}`;
  return el('div', { className: 'alike-card' + (variant.hidden ? ' hidden-part' : '') }, [
    el('div', { className: 'alike-head' }, [
      el('span', {}, [el('b', { textContent: where }), `: ${verdict}${variant.hidden ? ' (hidden)' : ''}`]),
      toggle,
    ]),
    el('div', { className: 'alike-pics' }, [a.figure, b.figure, d.figure]),
  ]);
}

/** Look-alikes clicked "hide" or "show" in this visit of the dialog: they stay listed for now. */
const decidedNow = new Set();

/** Decided: the user hid or showed it, or it is an exact duplicate (hidden automatically). */
function alikeDecided(f) {
  return !!state.settings.lookalikes?.[f.variant.id] || f.result.identical;
}

function renderAlikes() {
  const all = $('alike-all').checked;
  const hideDecided = $('alike-hide-decided').checked;
  const listed = state.lookalikes.filter((f) => all || f.result.identical || f.result.ratio <= LOOKALIKE_RATIO || f.variant.hidden);
  const decided = listed.filter(alikeDecided);
  $('alike-decided-count').textContent = decided.length;
  const list = hideDecided ? listed.filter((f) => !alikeDecided(f) || decidedNow.has(f.variant.id)) : listed;
  const empty = hideDecided && listed.length
    ? 'Every look-alike is decided. Untick "Hide the ones already decided" to see them.'
    : 'No copy looks like another part. Tick the box above to compare them anyway.';
  $('alike-list').replaceChildren(...(list.length ? list.map(alikeCard) : [el('p', { className: 'muted', textContent: empty })]));
  updateAlikesButton();
}

function openAlikesDialog() {
  decidedNow.clear();
  $('alike-hide-decided').checked = !!state.settings.alikeHideDecided;
  renderAlikes();
  if (!$('alike-dialog').open) $('alike-dialog').showModal();
}
$('open-alikes').addEventListener('click', openAlikesDialog);
$('alike-all').addEventListener('change', renderAlikes);
$('alike-find').addEventListener('click', () => withBusy('Looking for duplicates', () => findSameFiles(null, false)));
// Hide all listed copies: every copy in the list (as filtered now) is hidden, remembered per part.
$('alike-hide-all').addEventListener('click', () => {
  const all = $('alike-all').checked;
  const listed = state.lookalikes.filter((f) => all || f.result.identical || f.result.ratio <= LOOKALIKE_RATIO);
  let hidden = 0;
  for (const f of listed) {
    if (f.variant.hidden) continue;
    f.variant.hidden = true;
    (state.settings.lookalikes ||= {})[f.variant.id] = 'hide';
    decidedNow.add(f.variant.id);
    hidden++;
  }
  saveSettings();
  renderAlikes();
  renderEditor();
  toast(hidden ? `Hid ${hidden} cop${hidden === 1 ? 'y' : 'ies'}. "Show it again" brings one back.` : 'Every listed copy is hidden already.');
});
$('alike-hide-decided').addEventListener('change', () => {
  state.settings.alikeHideDecided = $('alike-hide-decided').checked;
  saveSettings();
  decidedNow.clear();
  renderAlikes();
});


// ---------- gallery ----------
// Saved and loaded characters (kept in this browser) and the presets in your folders, as cards
// with a picture, to look through and pick from.

const GALLERY_KEY = 'xgen-gallery';

function galleryEntries() {
  try {
    return JSON.parse(localStorage.getItem(GALLERY_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveGallery(entries) {
  try {
    localStorage.setItem(GALLERY_KEY, JSON.stringify(entries));
    return true;
  } catch {
    toast('The gallery is full or blocked in this browser; the character was not kept there.');
    return false;
  }
}

/** Keeps a character in the gallery. Saving again under the same name updates it. */
function addToGallery(text, name, kind) {
  const entries = galleryEntries();
  const same = entries.findIndex((e) => e.text === text || (kind === 'saved' && e.kind === 'saved' && e.name === name));
  const entry = { id: same >= 0 ? entries[same].id : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, kind, text, at: Date.now() };
  if (same >= 0) entries.splice(same, 1);
  entries.unshift(entry);
  return saveGallery(entries);
}

const galleryPictures = new Map();
/** Face and standing walk frame of a saved character, drawn with the folders open now. */
function galleryPicture(text, fileName) {
  const cacheKey = `${state.library.variants.size}|${fileName}|${text}`;
  if (!galleryPictures.has(cacheKey)) {
    if (galleryPictures.size > 200) galleryPictures.clear();
    galleryPictures.set(cacheKey, (async () => {
      const { character, customGradients, missing } = deserializeCharacter(text, state.library, allGradients(), fileName);
      applyDefaults(character, state.library);
      return { ...(await characterPicture(character, customGradients)), missing, name: character.name };
    })());
  }
  return galleryPictures.get(cacheKey);
}

/** Face and standing walk frame of a character. */
async function characterPicture(character, customGradients = []) {
  await ensureVariants(variantsToDecode(character, state.library));
  const byId = new Map([...gradientsById(), ...customGradients.map((g) => [g.id, g])]);
  const face = composeSheet('FG', character, state.library, byId, state.settings).image;
  const walk = composeSheet('TV', character, state.library, byId, state.settings);
  let sprite = null;
  if (walk.image) {
    const f = frameOf('TV', walk.image, walk.frame);
    const x = f.cols === 3 ? f.w : 0;
    sprite = createImage(f.w, f.h);
    for (let y = 0; y < f.h; y++) {
      const start = (y * walk.image.width + x) * 4;
      sprite.data.set(walk.image.data.subarray(start, start + f.w * 4), y * f.w * 4);
    }
  }
  return { face, sprite };
}

// ---------- importing many JSON files at once ----------

/** What a JSON file is: a sets file, a character (ours or RPG Maker MZ's), or something else. */
function jsonKind(text) {
  try {
    const data = JSON.parse(text);
    if (data?.format === 'rpgmaker-xgen-sets' && Array.isArray(data.sets)) return { kind: 'sets', sets: data.sets };
    if (data?.format === 'rpgmaker-xgen-character' || isGeneratorSettings(data)) return { kind: 'character' };
  } catch { /* not JSON */ }
  return { kind: 'unknown' };
}

/** A character file as a set: all its worn items, with their colours and positions. */
function setFromCharacterFile(file) {
  const { character, customGradients } = deserializeCharacter(file.text, state.library, allGradients(), file.name);
  const keys = Object.keys(character.parts).filter((k) => character.parts[k]);
  const set = makeSet(character, state.library, character.name || file.name.replace(/\.json$/i, ''), keys, true);
  set.customGradients = customGradients.map(customGradientToJson);
  return { set, customGradients };
}

/**
 * JSON files dropped or picked together. Sets files are imported; each character file can be
 * loaded as the character (several go to the Gallery) or put on the current character as a set,
 * with a picture of both so the user picks.
 * @param {{name:string, text:string}[]} files
 */
async function importJsonFiles(files) {
  const items = files.map((f) => ({ ...f, ...jsonKind(f.text) }));
  const characters = items.filter((i) => i.kind === 'character');
  if (!state.library.variants.size) {
    for (const c of characters) addToGallery(c.text, c.name.replace(/\.json$/i, ''), 'loaded');
    importSetsFrom(items);
    toast(`${characters.length ? `${characters.length} character file(s) kept in the Gallery; open a generator folder to see them. ` : ''}${summaryOfOthers(items)}`, 8000);
    return;
  }
  if (!characters.length) {
    importSetsFrom(items);
    toast(summaryOfOthers(items) || 'No JSON files to import.', 8000);
    return;
  }
  openJsonDialog(items);
}

function importSetsFrom(items) {
  const sets = items.filter((i) => i.kind === 'sets').flatMap((i) => i.sets);
  if (!sets.length) return 0;
  (state.settings.sets ||= []).push(...sets);
  saveSettings();
  renderSets();
  return sets.length;
}

function summaryOfOthers(items) {
  const sets = items.filter((i) => i.kind === 'sets').reduce((n, i) => n + i.sets.length, 0);
  const unknown = items.filter((i) => i.kind === 'unknown');
  return [
    sets ? `Imported ${sets} set(s).` : '',
    unknown.length ? `Skipped ${unknown.length} file(s) that are not characters or sets: ${unknown.map((u) => u.name).join(', ')}.` : '',
  ].filter(Boolean).join(' ');
}

let jsonItems = [];
function openJsonDialog(items) {
  jsonItems = items;
  const characters = items.filter((i) => i.kind === 'character');
  for (const c of characters) c.choice = 'character';
  const picture = (promise) => {
    const face = el('canvas', { width: 0, height: 0, className: 'gallery-face' });
    const sprite = el('canvas', { width: 0, height: 0, className: 'gallery-sprite' });
    promise.then(({ face: f, sprite: s }) => {
      putPixels(face, f);
      putPixels(sprite, s);
    }).catch(() => {});
    return el('div', { className: 'gallery-pics' }, [face, sprite]);
  };
  const rows = items.map((item, n) => {
    if (item.kind !== 'character') {
      const text = item.kind === 'sets' ? `Sets file: its ${item.sets.length} set(s) are added to your Sets.` : 'Not a character or sets file: skipped.';
      return el('div', { className: 'json-row' }, [el('h4', { textContent: item.name }), el('span', { className: 'muted small', textContent: text })]);
    }
    let asSet = null;
    try {
      asSet = setFromCharacterFile(item);
    } catch (err) {
      item.choice = 'skip';
      return el('div', { className: 'json-row' }, [el('h4', { textContent: item.name }), el('span', { className: 'muted small', textContent: `Can't be read: ${err.message}` })]);
    }
    item.asSet = asSet;
    const option = (value, title, note, pic) => {
      const radio = el('input', { type: 'radio', name: `json-${n}`, value, checked: item.choice === value });
      radio.addEventListener('change', () => {
        item.choice = value;
        updateJsonSummary();
      });
      return el('label', { className: `json-option${value === 'skip' ? ' skip' : ''}` }, [
        el('span', {}, [radio, ` ${title}`]), ...(pic ? [pic] : []), ...(note ? [el('span', { className: 'muted', textContent: note })] : []),
      ]);
    };
    const asCharacter = galleryPicture(item.text, item.name);
    const onYours = characterPicture(applySet(state.character, asSet.set, state.library).character, asSet.customGradients);
    return el('div', { className: 'json-row' }, [
      el('h4', { textContent: item.name }),
      el('div', { className: 'json-options' }, [
        option('character', 'As a character', 'Replaces the current character (with several, they go to the Gallery).', picture(asCharacter)),
        option('both', 'As a character and a set', 'Loads it like "As a character", and also saves its parts under Sets, to put on other characters later.', picture(asCharacter)),
        option('set', 'As a set on your character', `${(n2 => `Its ${n2} part${n2 === 1 ? '' : 's'}`)(Object.keys(asSet.set.parts).length)} go${Object.keys(asSet.set.parts).length === 1 ? 'es' : ''} on your character; body type and name stay. Also saved under Sets.`, picture(onYours)),
        option('skip', 'Skip'),
      ]),
    ]);
  });
  $('json-list').replaceChildren(...rows);
  updateJsonSummary();
  $('json-dialog').showModal();
}

function updateJsonSummary() {
  const count = (c) => jsonItems.filter((i) => i.kind === 'character' && i.choice === c).length;
  const chars = count('character') + count('both');
  const parts = [
    chars === 1 ? '1 loaded as the character' : chars ? `${chars} put in the Gallery` : '',
    count('both') ? `${count('both')} also saved under Sets` : '',
    count('set') ? `${count('set')} put on as sets` : '',
    count('skip') ? `${count('skip')} skipped` : '',
  ].filter(Boolean);
  $('json-summary').textContent = parts.join(', ');
}

for (const b of document.querySelectorAll('[data-json-all]')) {
  b.addEventListener('click', () => {
    for (const item of jsonItems) if (item.kind === 'character' && (item.asSet || b.dataset.jsonAll === 'skip' || b.dataset.jsonAll === 'character')) item.choice = b.dataset.jsonAll;
    // A file that can't be read as a set can still be loaded as a character.
    for (const item of jsonItems) if (item.kind === 'character' && !item.asSet && b.dataset.jsonAll === 'both') item.choice = 'character';
    for (const r of $('json-list').querySelectorAll('input[type="radio"]')) r.checked = r.value === b.dataset.jsonAll;
    updateJsonSummary();
  });
}

$('json-apply').addEventListener('click', async () => {
  $('json-dialog').close();
  const chosen = (c) => jsonItems.filter((i) => i.kind === 'character' && i.choice === c);
  const characters = [...chosen('character'), ...chosen('both')];
  for (const c of characters) addToGallery(c.text, c.name.replace(/\.json$/i, ''), 'loaded');
  if (characters.length === 1) await loadCharacterText(characters[0].text, characters[0].name, false);
  // Both: also kept under Sets (not put on: it is the character already).
  for (const item of chosen('both')) {
    (state.settings.sets ||= []).push(item.asSet.set);
    for (const g of item.asSet.customGradients) if (!state.customGradients.some((x) => x.id === g.id)) state.customGradients.push(g);
  }
  const missing = [];
  for (const item of chosen('set')) {
    (state.settings.sets ||= []).push(item.asSet.set);
    for (const g of item.asSet.customGradients) if (!state.customGradients.some((x) => x.id === g.id)) state.customGradients.push(g);
    const result = applySet(state.character, item.asSet.set, state.library);
    state.character = result.character;
    missing.push(...result.missing);
  }
  importSetsFrom(jsonItems);
  saveSettings();
  renderSets();
  renderAll();
  const done = [
    characters.length === 1 ? `Loaded ${characters[0].name}.` : characters.length ? `${characters.length} characters are in the Gallery.` : '',
    chosen('set').length ? `Put on ${chosen('set').length} set(s).` : '',
    chosen('both').length ? `Saved ${chosen('both').length} of them under Sets too.` : '',
    missing.length ? `Missing: ${missing.join(', ')}.` : '',
    summaryOfOthers(jsonItems),
  ].filter(Boolean).join(' ');
  toast(`✓ ${done || 'Nothing imported.'}`, 8000);
});

function galleryCard(item, observer) {
  const face = el('canvas', { width: 0, height: 0, className: 'gallery-face' });
  const sprite = el('canvas', { width: 0, height: 0, className: 'gallery-sprite' });
  const note = el('span', { className: 'gallery-note muted small' });
  const pics = el('button', { type: 'button', className: 'gallery-pics', title: `Use ${item.name}` }, [face, sprite]);
  pics.item = item;
  pics.draw = () => galleryPicture(item.text, item.fileName || '').then(({ face: f, sprite: s, missing }) => {
    putPixels(face, f);
    putPixels(sprite, s);
    if (missing.length) {
      note.textContent = `${missing.length} part${missing.length > 1 ? 's' : ''} not in the open folders`;
      note.title = missing.join(', ');
    }
  }).catch((err) => {
    note.textContent = `Can't be drawn: ${err.message}`;
  });
  observer.observe(pics);
  const use = el('button', { type: 'button', className: 'small-button primary', textContent: 'Use' });
  const load = async () => {
    await loadCharacterText(item.text, item.fileName || '', false);
    $('gallery-dialog').close();
  };
  use.addEventListener('click', load);
  pics.addEventListener('click', load);
  const buttons = [use];
  if (item.id) {
    const remove = el('button', { type: 'button', className: 'small-button', textContent: 'Remove', title: 'Remove from the gallery (files on your computer stay)' });
    remove.addEventListener('click', () => {
      saveGallery(galleryEntries().filter((e) => e.id !== item.id));
      renderGallery();
    });
    buttons.push(remove);
  }
  return el('div', { className: 'gallery-card' }, [
    pics,
    el('div', { className: 'gallery-name', textContent: item.name, title: item.name }),
    el('div', { className: 'muted small', textContent: item.label }),
    note,
    el('div', { className: 'gallery-buttons' }, buttons),
  ]);
}

function renderGallery() {
  const query = $('gallery-search').value.trim().toLowerCase();
  const fmt = (t) => new Date(t).toLocaleDateString();
  const stored = galleryEntries().map((e) => ({ ...e, label: e.kind === 'saved' ? `Saved ${fmt(e.at)}` : `Loaded ${fmt(e.at)}` }));
  const presets = [...state.library.packs.values()].flatMap((p) => (p.presets || []).map((preset) => ({
    name: preset.name, text: preset.text, fileName: preset.fileName, label: `Preset · ${p.name}`,
  })));
  const match = (i) => !query || i.name.toLowerCase().includes(query) || i.label.toLowerCase().includes(query);
  const observer = new IntersectionObserver((seen) => {
    for (const e of seen) {
      if (!e.isIntersecting) continue;
      observer.unobserve(e.target);
      e.target.draw();
    }
  }, { root: $('gallery-list') });
  const sections = [];
  for (const [title, items, empty] of [
    ['Your characters', stored.filter(match), 'Characters you save, or load from a file, show up here.'],
    ['Presets in your folders', presets.filter(match), 'No presets found in the open folders.'],
  ]) {
    sections.push(el('h4', { textContent: `${title} (${items.length})` }));
    sections.push(items.length
      ? el('div', { className: 'gallery-grid' }, items.map((i) => galleryCard(i, observer)))
      : el('p', { className: 'muted small', textContent: query ? 'Nothing matches.' : empty }));
  }
  $('gallery-list').replaceChildren(...sections);
}

function openGallery() {
  renderGallery();
  if (!$('gallery-dialog').open) $('gallery-dialog').showModal();
}
$('open-gallery').addEventListener('click', openGallery);
$('gallery-search').addEventListener('input', renderGallery);
$('gallery-save').addEventListener('click', () => {
  if (addToGallery(serializeCharacter(state.character, state.customGradients), state.character.name, 'saved')) {
    toast(`Kept "${state.character.name}" in the gallery.`);
    renderGallery();
  }
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

// Adjust: hue / saturation / brightness on top of a chosen gradient, previewed live.
const ADJUST_FIELDS = ['hue', 'saturation', 'brightness'];
const ADJUSTING_ID = 'custom/adjusting';
let adjusting = null; // {slot, base, previous}

function drawGradientRow(canvasId, colors) {
  $(canvasId).getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(colors), 256, 1), 0, 0);
}

function adjustValues() {
  return Object.fromEntries(ADJUST_FIELDS.map((f) => [f, Number($(`adjust-${f}`).value) || 0]));
}

let adjustFrame = 0;
/** Adjusting the source colours: the part's own colours, no gradient. */
const SOURCE_BASE = { id: 'source', label: 'Source colours', colors: SOURCE_SAMPLE };

function updateAdjust() {
  if (!adjusting) return;
  const fromSource = adjusting.base === SOURCE_BASE;
  const temp = fromSource
    ? createSourceAdjust(ADJUSTING_ID, $('adjust-name').value, adjustValues())
    : createAdjustedGradient(ADJUSTING_ID, $('adjust-name').value, adjusting.base.id, adjustValues(), adjustGradient(adjusting.base.colors, adjustValues()));
  drawGradientRow('adjust-after', temp.colors);
  state.customGradients = [...state.customGradients.filter((g) => g.id !== ADJUSTING_ID), temp];
  setSlotColour(adjusting.slot.id, ADJUSTING_ID);
  cancelAnimationFrame(adjustFrame);
  adjustFrame = requestAnimationFrame(() => renderPreview());
}

function setAdjustValues(values) {
  for (const f of ADJUST_FIELDS) $(`adjust-${f}`).value = $(`adjust-${f}-n`).value = values[f];
}

function openAdjustDialog(slot, current) {
  // Adjusting an adjusted colour starts again from its original, with the same settings. No colour
  // chosen (source colours): the part's own colours are shifted.
  const origin = current?.shiftSource ? SOURCE_BASE : current?.from && allGradients().find((g) => g.id === current.from);
  const base = origin || current || SOURCE_BASE;
  adjusting = { slot, base, previous: current?.id ?? null };
  $('adjust-note').textContent = base === SOURCE_BASE
    ? 'Shift the colours this part is drawn in (no gradient needed). The character updates as you slide.'
    : "Shift the chosen gradient to a colour the colour sheets don't have. The character updates as you slide.";
  $('adjust-title').textContent = `Adjust ${slot.label.toLowerCase()} colour`;
  $('adjust-name').value = `${base.label} (adjusted)`;
  setAdjustValues(origin ? { hue: 0, saturation: 100, brightness: 100, ...current.adjust } : { hue: 0, saturation: 100, brightness: 100 });
  drawGradientRow('adjust-before', base.colors);
  updateAdjust();
  $('adjust-dialog').returnValue = ''; // Esc keeps the last value otherwise
  $('adjust-dialog').showModal();
}

for (const f of ADJUST_FIELDS) {
  $(`adjust-${f}`).addEventListener('input', () => { $(`adjust-${f}-n`).value = $(`adjust-${f}`).value; updateAdjust(); });
  $(`adjust-${f}-n`).addEventListener('input', () => { $(`adjust-${f}`).value = $(`adjust-${f}-n`).value; updateAdjust(); });
}
$('adjust-reset').addEventListener('click', () => {
  setAdjustValues({ hue: 0, saturation: 100, brightness: 100 });
  updateAdjust();
});
$('adjust-dialog').addEventListener('close', () => {
  if (!adjusting) return;
  const temp = state.customGradients.find((g) => g.id === ADJUSTING_ID);
  state.customGradients = state.customGradients.filter((g) => g.id !== ADJUSTING_ID);
  swatchCache.delete(ADJUSTING_ID);
  const unchanged = ADJUST_FIELDS.every((f) => adjustValues()[f] === { hue: 0, saturation: 100, brightness: 100 }[f]);
  if ($('adjust-dialog').returnValue === 'ok' && temp && !unchanged) {
    const id = `custom/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const name = $('adjust-name').value || 'Adjusted';
    state.customGradients.push(temp.shiftSource ? createSourceAdjust(id, name, temp.adjust) : createAdjustedGradient(id, name, temp.from, temp.adjust, temp.colors));
    setSlotColour(adjusting.slot.id, id);
  } else {
    const base = adjusting.base === SOURCE_BASE ? null : adjusting.base.id;
    setSlotColour(adjusting.slot.id, $('adjust-dialog').returnValue === 'ok' && unchanged ? base : adjusting.previous);
  }
  adjusting = null;
  renderSlots();
  renderPreview();
  refreshTiles();
});

// ---------- folders ----------

/** Opens a folder and, when it gave something usable, remembers it for next time. */
function importHandle(handle) {
  return withBusy(`Reading folder "${handle.name}"`, () => importHandleNow(handle));
}

async function importHandleNow(handle) {
  const added = await importEntries(await entriesFromHandle(handle), handle.name);
  const pack = state.lastPack;
  if (added && canRememberFolders) {
    // The pack knows its remembered folder, so forgetting the folder takes the pack out too.
    if (pack) pack.folderKey = await rememberFolder(handle);
    else await rememberFolder(handle);
    renderRecentFolders();
  }
  return added;
}

/**
 * Takes a pack out of what is loaded: its parts, colours, files to assign and look-alikes. A
 * character wearing its parts loses them; with nothing left the start screen comes back.
 */
function unloadPack(name) {
  removePack(state.library, name);
  state.fileGradients = state.fileGradients.filter((g) => g.pack !== name);
  state.loadedGradientFiles = state.library.gradientFiles.length;
  state.lookalikes = state.lookalikes.filter((f) => f.variant.pack !== name);
  updateAlikesButton();
  if (!state.library.packs.length) {
    showWelcome();
    return;
  }
  if (state.character) {
    dropMissingParts();
    if (!state.library.bodyTypes.has(state.character.bodyType)) state.character.bodyType = [...state.library.bodyTypes.keys()][0];
    if (state.character.bodyType) applyDefaults(state.character, state.library);
  }
  if (state.library.variants.size) {
    ensureCharacter();
    renderAll();
  } else renderProblems();
  if ($('files-dialog').open) renderFiles();
}

/**
 * Forgets what was saved for a pack: files assigned, unassigned or removed by hand, parts removed
 * and look-alike choices. Opened again, the folder is read from scratch.
 */
function forgetPackSettings(name) {
  const s = state.settings;
  const drop = (map, prefix) => {
    for (const key of Object.keys(map || {})) if (key.startsWith(prefix)) delete map[key];
  };
  drop(s.assignments, `${name}|`);
  drop(s.removedParts, `${name}/`);
  drop(s.lookalikes, `${name}/`);
  drop(s.autoMasks, `${name}/`);
  saveSettings();
}

/** Forgets a remembered folder, and what was saved for it, and takes its pack out straight away. */
async function forgetAndUnload(key) {
  await forgetFolder(key);
  const packs = state.library.packs.filter((p) => p.folderKey === key);
  for (const p of packs) {
    forgetPackSettings(p.name);
    unloadPack(p.name);
  }
  // Not open now: its pack had the folder's name.
  if (!packs.length) forgetPackSettings(key);
  return packs.length;
}

/** Opens remembered folders; asks for access where needed (only inside a click). */
async function reopenFolders(folders, ask) {
  let reopened = 0;
  for (const { handle } of folders) {
    const allowed = ask ? await ensureReadPermission(handle) : await hasReadPermission(handle);
    if (allowed && (await importHandle(handle))) reopened++;
  }
  return reopened;
}

/** On start: folders the browser still allows come back without a click. */
async function reopenGrantedFolders() {
  if (!canRememberFolders) return;
  const folders = await rememberedFolders();
  if (!folders.length) return;
  const reopened = await reopenFolders(folders, false);
  if (reopened) toast(`Reopened ${reopened} folder${reopened > 1 ? 's' : ''} from last time.`);
}

async function renderRecentFolders() {
  await renderRecentInto($('recent-folders'), $('recent-note'));
  await renderRecentInto($('recent-folders-side'), null);
}

/** "Last time" folder buttons; on the welcome screen and, once the app is open, in the sidebar. */
async function renderRecentInto(box, note) {
  note ||= { hidden: true, textContent: '' };
  if (!canRememberFolders) {
    note.hidden = false;
    note.textContent = 'This browser cannot remember folders, so you pick them again after a reload. Chrome and Edge can remember them.';
    return;
  }
  const folders = await rememberedFolders();
  box.hidden = !folders.length;
  note.hidden = !folders.length;
  note.textContent = 'Opened folders are remembered. When the browser asks, choose "Allow on every visit" and they reopen by themselves after a reload.';
  if (!folders.length) return;
  const openAll = el('button', { className: 'primary', textContent: folders.length > 1 ? `Reopen all ${folders.length}` : `Reopen ${folders[0].key}` });
  openAll.addEventListener('click', () => reopenFolders(folders, true));
  box.replaceChildren(el('span', { className: 'muted small', textContent: 'Last time:' }), openAll);
  if (folders.length > 1) {
    for (const f of folders) {
      const open = el('button', { type: 'button', textContent: f.key, title: `Open only ${f.key}` });
      open.addEventListener('click', () => reopenFolders([f], true));
      const forget = el('button', { type: 'button', className: 'forget', textContent: '×', title: `Forget ${f.key}` });
      forget.addEventListener('click', async () => {
        const removed = await forgetAndUnload(f.key);
        renderRecentFolders();
        toast(removed ? `Forgot "${f.key}" and what you assigned in it, and took its parts out.` : `Forgot "${f.key}" and what you assigned in it.`);
      });
      box.append(el('span', { className: 'folder' }, [open, forget]));
    }
  }
  const forgetAll = el('button', { className: 'forget', textContent: folders.length > 1 ? 'Forget all' : 'Forget',
    title: 'Forget these folders, and what you assigned, removed or decided about look-alikes in them' });
  forgetAll.addEventListener('click', async () => {
    let removed = 0;
    for (const f of folders) removed += await forgetAndUnload(f.key);
    renderRecentFolders();
    toast(removed ? `Forgot ${folders.length > 1 ? 'the folders' : `"${folders[0].key}"`} and what you assigned in them, and took their parts out.` : 'Forgot the folders and what you assigned in them.');
  });
  box.append(forgetAll);
}

// With the File System Access API the chosen folder is remembered for next time.
$('folder-input').parentElement.addEventListener('click', async (e) => {
  if (!canRememberFolders) return; // fall through to the plain <input webkitdirectory>
  e.preventDefault();
  try {
    await importHandle(await pickFolder());
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
  // Folders opened last time come back by themselves when the browser still allows it.
  if (!params.has('sample') && !params.has('pack')) await reopenGrantedFolders();
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
  // Both reads must start before the first await: the drop data is gone after that.
  const handles = dropFolderHandles(e.dataTransfer);
  const entries = await entriesFromDrop(e.dataTransfer);
  // Only JSON files: characters and sets, all at once.
  if (entries.length && entries.every((x) => /\.json$/i.test(x.path))) {
    await withBusy(`Reading ${entries.length} JSON file(s)`, async () => {
      await importJsonFiles(await Promise.all(entries.map(async (x) => ({ name: x.path.split('/').pop(), text: await readText(x.src) }))));
    });
    return;
  }
  const folders = await handles;
  // Dropped folders open like picked ones, so they are remembered for next time too.
  if (folders.length && entries.every((x) => folders.some((h) => x.path.startsWith(h.name + '/')))) {
    for (const h of folders) await importHandle(h);
  } else await importEntries(entries, packNameFromEntries(entries, 'Dropped files'));
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

for (const f of SHAPE_FIELDS) for (const p of ['face', 'sprite']) $(`off-${p}-${f}`).addEventListener('input', updateOffset);
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
  syncPartner(state.selectedPart);
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

// Larger preview: pointing at a part tile, a picture in the per-image picker or in Files… shows
// it big, next to it, so small and dark parts can be seen.
const bigPreview = el('div', { className: 'big-preview', hidden: true });
document.body.append(bigPreview);
const PREVIEWED = '.variant canvas, .sheet-pick canvas, .file-card canvas';
document.addEventListener('mouseover', (e) => {
  const small = e.target.closest?.(PREVIEWED);
  if (!small || !small.width || !small.height) return;
  const scale = Math.max(1, Math.min(8, Math.floor(240 / Math.max(small.width, small.height))));
  const big = el('canvas', { width: small.width, height: small.height });
  big.getContext('2d').drawImage(small, 0, 0);
  big.style.width = `${small.width * scale}px`;
  big.style.height = `${small.height * scale}px`;
  bigPreview.replaceChildren(big);
  bigPreview.hidden = false;
  const r = small.getBoundingClientRect();
  const w = small.width * scale + 18;
  const h = small.height * scale + 18;
  const left = r.right + 12 + w <= innerWidth ? r.right + 12 : Math.max(4, r.left - 12 - w);
  bigPreview.style.left = `${left}px`;
  bigPreview.style.top = `${Math.max(4, Math.min(innerHeight - h - 4, r.top + r.height / 2 - h / 2))}px`;
});
document.addEventListener('mouseout', (e) => {
  if (e.target.closest?.(PREVIEWED) && !e.relatedTarget?.closest?.(PREVIEWED)) bigPreview.hidden = true;
});
document.addEventListener('click', () => { bigPreview.hidden = true; }, true);

// Clear all: every part to None except Body and Face (and locked parts); one click undoes it.
let beforeClear = null;
let clearTimer;
$('clear-all').addEventListener('click', () => {
  clearTimeout(clearTimer);
  if (beforeClear) {
    state.character = beforeClear;
    beforeClear = null;
    $('clear-all').textContent = 'Clear all';
    renderAll();
    return;
  }
  const before = structuredClone(state.character);
  let cleared = 0;
  for (const key of Object.keys(state.character.parts)) {
    const part = partOfKey(key);
    if (REQUIRED_PARTS.has(part) || state.locked.has(key) || !state.character.parts[key]) continue;
    removeItem(state.character, key); // extra items ("AccA 2") go away completely
    if (key === part) state.character.parts[key] = null; // "None", not "pick a default"
    cleared++;
  }
  // Colours back to Source: the parts as drawn, no gradients.
  const coloured = Object.keys(state.character.colors || {}).length
    + Object.values(state.character.itemColors || {}).reduce((n, c) => n + Object.values(c).filter(Boolean).length, 0);
  state.character.colors = {};
  for (const c of Object.values(state.character.itemColors || {})) for (const slot of Object.keys(c)) c[slot] = null;
  if (!cleared && !coloured) {
    toast('Nothing to clear: only Body, Face and locked parts are worn, all in their source colours.');
    return;
  }
  if (state.selectedPart !== ALL_COLOURS && !(itemOfKey(state.selectedPart) in state.character.parts)) state.selectedPart = partOfKey(state.selectedPart);
  beforeClear = before;
  $('clear-all').textContent = 'Undo clear';
  clearTimer = setTimeout(() => {
    beforeClear = null;
    $('clear-all').textContent = 'Clear all';
  }, 10000);
  renderAll();
  toast(`Took off ${cleared} part${cleared === 1 ? '' : 's'} and set every colour back to Source. Body, Face and locked parts stay.`);
});

$('randomize').addEventListener('click', () => {
  for (const set of state.settings.sets || []) {
    for (const g of set.customGradients || []) {
      if (!state.customGradients.some((x) => x.id === g.id)) state.customGradients.push(customGradientFromJson(g));
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
  const rows = [['FG', 'Portrait'], ['TV', 'Walk'], ['TVD', 'Damage'], ['SV', 'Battler']];
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
    // Shifted source colours aren't gradients: RPG Maker can't use them.
    const exportable = state.customGradients.filter((g) => !g.shiftSource);
    if (exportable.length) await downloadImage(gradientsToImage(exportable), `${name}_custom_gradients.png`);
  }
  toast(count ? `Exported ${count} image(s).` : 'Nothing to export for this sheet: no selected part has layers for it.');
});

$('save-character').addEventListener('click', () => {
  const json = serializeCharacter(state.character, state.customGradients);
  downloadBlob(new Blob([json], { type: 'application/json' }), `${safeFileName(state.character.name)}.json`);
  if (addToGallery(json, state.character.name, 'saved')) toast(`Saved "${state.character.name}"; it's also in the Gallery.`);
});

async function loadCharacterFile(file) {
  await loadCharacterText(await readText(file), file.name || '', true);
}

/** keep: also put it in the gallery (a character file you loaded; not the folder presets). */
async function loadCharacterText(text, fileName, keep = false) {
  try {
    const { character, customGradients, missing } = deserializeCharacter(text, state.library, allGradients(), fileName);
    if (keep) addToGallery(text, character.name, 'loaded');
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
  const files = [...e.target.files];
  e.target.value = '';
  if (files.length === 1) await loadCharacterFile(files[0]);
  else if (files.length) await importJsonFiles(await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() }))));
});
