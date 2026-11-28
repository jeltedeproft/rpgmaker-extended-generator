// UI controller. All heavy lifting lives in the pure modules; this file wires them to the DOM.

import { makeSetup, applySetup, isSetup } from './setup.js';
import { SHEET_KEYS, SLOTS, DEFAULT_SETTINGS, PART_ORDER, SHEETS, SLOT_BY_ID, REQUIRED_PARTS, ALL_BODIES } from './format.js';
import { createLibrary, addPack, removePack, removeFile, restoreFile, variantLabel, variantsForPart, TEXT_FILE_RE, assignFile, buildPartName, parsePartPath, unassignFile, libraryFiles, addFilesToPack, maskPairs, fitMasks, fixWrongSheets, attachWaitingMasks, imageOfMask, restoreToAssign, assignCounterpart, isPairedMask, assignmentBodies, suggestedBody, newBodyName } from './parse.js';
import { colourMean, matchAdjust, createCustomGradient, gradientsToImage, preferredCategories, recommendColours, adjustGradient, createAdjustedGradient, customGradientToJson, customGradientFromJson, createSourceAdjust, SOURCE_SAMPLE, uniqueGradients } from './gradients.js';
import {
  composeSheet, selectedVariants, variantsToDecode, variantForSheet, partOffset, partOfKey, itemColor,
  layersForSheet, drawId, itemOfKey, frameFor, clipOf, itemOnSheet, HIDDEN, pieceKeys, countPieces, piecesPerSheet, makeSplit, selectedItems, sheetLayers,
} from './compose.js';
import { createImage, scanMask, matchSlot, recolorLayer, blendOver } from './recolor.js';
import { WALK_LAYOUTS } from './xp.js';
import { cropBox, cropScale } from './crop.js';
import { diagonalsOf, join8, DIAGONAL_MODES } from './dir8.js';
import { encodeMask, decodeMask } from './islands.js';
import { normalizeStretch, isStretched, stretchFrames, lineY } from './stretch.js';
import { selectByColour, growSelection, keepSelected, removeSelected, nearestOutside, selectedCount } from './extract.js';
import { packCharacters, MULTI_COLS, MULTI_ROWS } from './multi.js';
import { uniteStrip } from './unite.js';
import { zipFiles, unzip } from './zip.js';
import { guessSheet, shapeProfile, rankWithName, partsInName, partsInPath, maskColourShare, nameWords, slotForPart, NAME_BONUS, frameHints, readingsOf } from './suggest.js';
import { PAINTED_SLOTS, PAINTED_FOLLOWS, paintedIndex, cellOf, cellCount, averageColour, styleOf, ofStyle } from './vxace.js';
import { groupLayers, topRun, moveBlock, stepBlock } from './layers.js';
import { encodeGif } from './gif.js';
import { CUT_PRESETS, guessGrid, cellRect, cutPath, cropImage, hasPixels, drawnBounds } from './cut.js';
import { codeOf, emptyEdits, hasEdits, encodeEdits, decodeEdits, paintLine, paintColour, applyEdits } from './maskpaint.js';
import { colourGroups, makeMask, defaultGroupSlots, MAX_GROUPS, AUTO_SPREAD, iconMask, iconSilhouette, iconPart, isCloseUp, closeUpMask } from './automask.js';
import { lookalikePairs, pairLayers, findLookalikes, compareVariants, differenceImage, LOOKALIKE_RATIO, folderKeys, sameFolder, digestBytes, sameFileDuplicates } from './lookalike.js';
import {
  createCharacter, applyDefaults, partNames, usedSlots, randomize, resolveVariant,
  serializeCharacter, deserializeCharacter, isGeneratorSettings, itemKeys, addItem, removeItem, creditsFor, creditsText,
  makeSet, applySet, trimSet, withoutOwnParts, OWN_PARTS, DEFAULT_RULES, wearChance, shiftShape,
} from './character.js';
import {
  entriesFromFileList, entriesFromDrop, packNameFromEntries, sampleKitEntries, ensureImage, pngSize, fileBytes, decodeImage,
  ensureVariants, loadGradients, toCanvas, downloadBlob, downloadImage,
  canRememberFolders, pickFolder, entriesFromHandle, rememberFolder, forgetFolder, rememberedFolders,
  ensureReadPermission, readText, ensureLayers, hasReadPermission, dropFolderHandles, exportFolder, setExportFolder,
} from './loader.js';

const ALL_COLOURS = '__colours';
const SV_MOTIONS = ['Walk', 'Wait', 'Chant', 'Guard', 'Damage', 'Evade', 'Thrust', 'Swing', 'Missile',
  'Skill', 'Spell', 'Item', 'Escape', 'Victory', 'Dying', 'Abnormal', 'Sleep', 'Dead'];
const SHEET_FILE_NAMES = {
  FG: (n) => `${n}_face.png`,
  // "!": RPG Maker draws it without lifting it 6 pixels (objects, doors, big sprites).
  TV: (n) => `${state.settings.noShift ? '!' : ''}$${n}.png`,
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
/**
 * The sheets picked to export: 'all', or sheet keys and "extra:<id>". Declared up here: the sheet
 * list (showSheetOptions) uses it while the page starts.
 */
const exportPick = new Set(['all']);
let exportFormat = 'png';

// PixMix open in another tab: its changes to the settings (e.g. sheets added or removed) are taken
// over here, so neither tab brings back what the other changed.
window.addEventListener('storage', (e) => {
  if (e.key !== 'xgen-settings' || !e.newValue) return;
  try {
    state.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(e.newValue) };
  } catch {
    return;
  }
  tidyExtraSheets();
  renderTemplates();
  showSheetOptions();
  if (state.character) renderPreview();
});
function saveSettings() {
  try {
    localStorage.setItem('xgen-settings', JSON.stringify(state.settings));
  } catch { /* storage unavailable: settings just won't persist */ }
}

function allGradients() {
  return [...state.fileGradients, ...state.customGradients];
}
/** The colours offered in the lists and to Randomize: without the ones you deleted. */
function pickableGradients() {
  const hidden = new Set(state.settings.hiddenGradients || []);
  return hidden.size ? allGradients().filter((g) => !hidden.has(g.id)) : allGradients();
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

function importEntries(entries, packName, options = {}) {
  return withBusy(`Opening "${packName}"`, () => importEntriesNow(entries, packName, options));
}

async function importEntriesNow(entries, packName, { loose = false, ask = false } = {}) {
  state.lastPack = null;
  const pngs = entries.filter((e) => /\.png$/i.test(e.path));
  if (!pngs.length) {
    toast('No PNG files found in that folder.');
    return 0;
  }
  // The same folder opened twice (or a copy of it) would add every part again.
  const keys = folderKeys(pngs);
  // Files dropped by hand are always read (an earlier "Skip" for a folder doesn't apply to them).
  const twin = !loose && sameFolder(state.library.packs, keys);
  if (twin && !(await openAgainAnswer(packName, twin))) {
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
  // Its files as they are, to share them in a setup zip (Save setup).
  pack.entries = entries;
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
      if (isSetup(data)) pack.setup = { data, fileName: e.path.split('/').pop() };
      else if (isGeneratorSettings(data) || data.format === 'rpgmaker-xgen-character') {
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
  await applyCuts(pack.name, pngs);
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
  syncKnownBodies();
  if (pack.setup) offerSetup(pack);
  // Pictures dropped or picked by hand that aren't named like parts: show how each could be used.
  const asking = ask && toAssign > 0 && askLater(pack.name);
  if (!addedParts) {
    if (!asking) toast(toAssign
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
  offerFrameHints(pack.name);
  const gradientsShown = uniqueGradients(allGradients()).length;
  toast(`Added "${pack.name}": ${addedParts} parts. Now ${state.library.variants.size} parts across ${state.library.bodyTypes.size} body type(s), ${gradientsShown} distinct colours.${assignNote}`, toAssign ? 8000 : 4000);
  showApp();
  renderAll();
  return addedParts;
}

// ---------- shared setups (see setup.js) ----------

/** A folder with a setup file in it: ask before using it. */
function offerSetup(pack) {
  const { data, fileName } = pack.setup;
  // Asked once: the answer (and the setup, when used) stays until the folder is forgotten.
  const asked = `${fileName}|${data.name || ''}`;
  if (state.settings.setupAnswers?.[pack.name] === asked) return;
  $('setup-offer-text').textContent = `"${pack.name}" comes with ${fileName}: "${data.name || 'a setup'}"${data.author ? ` by ${data.author}` : ''}.${data.note ? ` ${data.note}` : ''}`;
  $('setup-offer').onclose = () => {
    (state.settings.setupAnswers ||= {})[pack.name] = asked;
    saveSettings();
    if ($('setup-offer').returnValue === 'apply') useSetup(data, [pack.name]);
  };
  if (!$('setup-offer').open) $('setup-offer').showModal();
}

function useSetup(data, packs) {
  keepSetup(data, 'loaded');
  const { settings, customGradients, characters, counts } = applySetup(state.settings, data, packs);
  state.settings = settings;
  tidyExtraSheets();
  saveSettings();
  for (const c of characters) addToGallery(c.text, c.name, 'loaded');
  for (const g of customGradients) {
    if (!state.customGradients.some((x) => x.id === g.id)) state.customGradients.push(customGradientFromJson(g));
  }
  for (const p of packs) {
    applyRememberedAssignments(p);
    applyRemovedParts(p);
  }
  $('flip-gradient').checked = !!state.settings.flipGradient;
  $('make-room').checked = !!state.settings.makeRoom;
  $('fit-frame').checked = !!state.settings.fitFrame;
  $('smooth-pixels').checked = !!state.settings.smoothPixels;
  renderTemplates();
  showSheetOptions();
  renderSets();
  afterFilesChanged();
  toast(`Using the setup "${data.name || 'setup'}": ${counts.files} file(s) read as set, ${counts.parts} colour mask(s), ${counts.sets} set(s)${characters.length ? `, ${characters.length} character(s) in the Gallery` : ''}.`, 8000);
}

/** The setup dialog keeps the setup in the Gallery ("keep") or downloads it ("export"). */
let setupMode = 'export';
$('save-setup').addEventListener('click', () => openSetupDialog('keep'));
$('export-setup').addEventListener('click', () => openSetupDialog('export'));
$('export-sets-menu').addEventListener('click', () => $('export-sets').click());

function openSetupDialog(mode) {
  setupMode = mode;
  $('setup-title').textContent = mode === 'keep' ? 'Save setup' : 'Export setup';
  $('setup-ok').textContent = mode === 'keep' ? 'Keep in Gallery' : 'Save file';
  $('setup-pictures-box').hidden = mode === 'keep';
  const packs = state.library.packs.map((p) => p.name);
  $('setup-packs').replaceChildren(...packs.map((name) => el('label', { className: 'lock' }, [
    el('input', { type: 'checkbox', value: name, checked: true }), ` ${name}`,
  ])));
  const characters = galleryEntries();
  $('setup-characters').replaceChildren(...(characters.length ? characters.map((c) => el('label', { className: 'lock' }, [
    el('input', { type: 'checkbox', value: c.id, checked: false }), ` ${c.name}`,
  ])) : [el('span', { className: 'muted small', textContent: 'None yet: Save → Save character adds them.' })]));
  $('setup-pictures').checked = false;
  $('setup-dialog').showModal();
}
$('setup-dialog').addEventListener('close', () => {
  if ($('setup-dialog').returnValue !== 'ok') return;
  const packs = [...$('setup-packs').querySelectorAll('input:checked')].map((i) => i.value);
  const name = $('setup-name').value.trim() || 'My setup';
  const chosen = new Set([...$('setup-characters').querySelectorAll('input:checked')].map((i) => i.value));
  const characters = galleryEntries().filter((c) => chosen.has(c.id));
  const setup = makeSetup(state.settings, packs, state.customGradients.filter((g) => g.id !== ADJUSTING_ID).map(customGradientToJson),
    { name, author: $('setup-author').value.trim(), note: $('setup-note').value.trim(), characters });
  const json = JSON.stringify(setup, null, 2);
  keepSetup(setup, 'saved');
  if (setupMode === 'keep') {
    toast(`Kept the setup "${name}" in Gallery → Setups.`, 5000, { label: 'Show', run: () => openGallery('setups') });
    return;
  }
  if (!$('setup-pictures').checked) {
    downloadBlob(new Blob([json], { type: 'application/json' }), `${safeFileName(name)}.setup.json`);
    return;
  }
  withBusy('Packing the setup', () => saveSetupZip(name, json, packs)).catch((err) => toast(`Could not save the zip: ${err.message}`));
});

/**
 * The setup with the pictures of the chosen folders, in one zip: opening it (Load → Load pack,
 * or dropping it) opens the pictures as a folder and offers the setup, as a folder with a setup does.
 */
async function saveSetupZip(name, json, packNames) {
  const entries = state.library.packs.filter((p) => packNames.includes(p.name))
    // A setup the folder came with is replaced by this one.
    .flatMap((p) => (p.entries || []).filter((e) => !(p.setup && e.path.split('/').pop() === p.setup.fileName)));
  const files = [];
  const seen = new Set();
  for (const [i, e] of entries.entries()) {
    if (seen.has(e.path)) continue;
    seen.add(e.path);
    if (i % 50 === 0) {
      busyStep('Packing the setup', i, entries.length);
      await nextFrame();
    }
    files.push({ name: e.path, bytes: await fileBytes(e.src) });
  }
  // Next to the pictures: in their folder when they all have the same one.
  const top = packNameFromEntries(entries, '');
  files.push({ name: `${top ? `${top}/` : ''}${safeFileName(name)}.setup.json`, bytes: new TextEncoder().encode(json) });
  downloadBlob(new Blob([zipFiles(files)], { type: 'application/zip' }), `${safeFileName(name)}.zip`);
  toast(`Saved ${safeFileName(name)}.zip: ${files.length - 1} file(s) and the setup. Others open it with Load → Load pack.`, 7000);
}

/** A zip (a shared setup, or a pack of parts): opened as a folder; just a setup applies to the open folders. */
async function openZip(file) {
  const files = await withBusy(`Reading ${file.name}`, async () => unzip(new Uint8Array(await file.arrayBuffer())));
  const entries = files.map((f) => ({ path: f.name, src: new File([f.bytes], f.name.split('/').pop(), { type: /\.png$/i.test(f.name) ? 'image/png' : '' }) }));
  if (!entries.some((e) => /\.png$/i.test(e.path))) {
    const setupFile = entries.find((e) => /\.json$/i.test(e.path));
    const data = setupFile && JSON.parse(await readText(setupFile.src));
    if (!isSetup(data)) throw new Error('it has no pictures and no setup');
    useSetup(data, state.library.packs.map((p) => p.name));
    return;
  }
  await importEntries(entries, packNameFromEntries(entries, file.name.replace(/\.zip$/i, '')), { loose: true });
}

$('import-setup').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!isSetup(data)) throw new Error('this is not a setup file');
    useSetup(data, state.library.packs.map((p) => p.name));
  } catch (err) {
    toast(`Could not use the setup: ${err.message}`);
  }
});

/** Makes a first character once there are parts, and gives it colours. */
function ensureCharacter() {
  if (!state.character) {
    const bodyType = state.library.bodyTypes.has('Male') ? 'Male' : [...state.library.bodyTypes.keys()][0];
    // Parts start in the colours they are drawn in; gradients only once you pick one.
    state.character = applyDefaults(createCharacter(bodyType), state.library);
  }
}

// ---------- pictures that aren't named like parts: how do you want to use them? ----------

/** Files still to ask about, after the one asked now (each finished form asks the next). */
let useQueue = [];
/** The cut form was opened from "How do you want to use it?": its pieces are asked about next. */
let cutFromAsk = false;

/** Asks about a folder's files to assign once it has opened. True when there are any. */
function askLater(packName) {
  const waiting = state.library.unrecognized.filter((u) => u.pack === packName);
  const names = new Set(waiting.map((u) => u.path.toLowerCase()));
  // A colour mask next to its picture goes with that picture.
  const files = waiting.filter((u) => !(/_c\.png$/i.test(u.path) && names.has(u.path.toLowerCase().replace(/_c\.png$/, '.png'))));
  if (!files.length) return false;
  setTimeout(() => askHowToUse(files), 0);
  return true;
}

/** The picture with the frame grid of one way to read it drawn over it. */
function gridPicture(image, cols, rows) {
  const scale = Math.min(1, 104 / image.width, 104 / image.height) * (image.width < 52 && image.height < 52 ? 2 : 1);
  const canvas = el('canvas', { width: Math.max(1, Math.round(image.width * scale)), height: Math.max(1, Math.round(image.height * scale)) });
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = scale < 1;
  ctx.drawImage(toCanvas(image), 0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(255, 211, 77, 0.9)';
  ctx.lineWidth = 1;
  for (let c = 1; c < cols; c++) {
    const x = Math.round((c * canvas.width) / cols) + 0.5;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let r = 1; r < rows; r++) {
    const y = Math.round((r * canvas.height) / rows) + 0.5;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }
  return canvas;
}

/** The first file: its picture read every way it could be, to pick one. The rest come after. */
async function askHowToUse(files) {
  const [entry, ...rest] = files;
  useQueue = rest;
  if (!entry) return;
  entry.ref ||= { src: entry.src, pixels: null };
  const image = await ensureImage(entry.ref).catch(() => null);
  if (!image) {
    toast(`Could not read ${entry.path}.`);
    askNext();
    return;
  }
  const name = entry.path.split('/').pop();
  $('use-title').textContent = `How do you want to use ${name}?`;
  $('use-note').textContent = `${image.width} × ${image.height} px. Every way it could be used; the lines show the frames. Pick one.${rest.length ? ` ${rest.length} more after this one.` : ''}`;
  $('use-skip-all').hidden = !rest.length;
  $('use-options').replaceChildren(...readingsOf(image.width, image.height, name).map((r) => {
    const option = el('button', { type: 'button', className: `use-option${r.best ? ' best' : ''}`, title: r.best ? 'Best guess, from its size' : '' }, [
      gridPicture(image, r.cols, r.rows),
      el('span', { textContent: r.label }),
      ...(r.standard || r.best ? [el('span', { className: 'use-tags' }, [
        ...(r.standard ? [el('span', { className: 'use-standard', textContent: r.standard, title: `The ${r.standard} standard size` })] : []),
        ...(r.best ? [el('span', { className: 'use-best', textContent: 'best guess' })] : []),
      ])] : []),
    ]);
    option.addEventListener('click', async () => {
      $('use-dialog').returnValue = 'picked';
      $('use-dialog').close();
      if (r.use === 'cut') {
        cutFromAsk = true;
        await openCutDialog(entry);
        if (r.cols * r.rows > 1) setCutGrid(r.cols, r.rows);
        return;
      }
      await openAssignDialog(entry);
      $('assign-sheet').value = r.use;
      $('assign-sheet').dispatchEvent(new Event('change'));
      updateAssignPreview();
    });
    return option;
  }));
  $('use-dialog').returnValue = '';
  if (!$('use-dialog').open) $('use-dialog').showModal();
}

/** The next file to ask about, once the form for this one is done. */
function askNext() {
  if (!useQueue.length) return;
  const next = useQueue;
  useQueue = [];
  // Only the ones still waiting (assigning one can take its mask or others along).
  const waiting = new Set(state.library.unrecognized.map((u) => `${u.pack}|${u.path}`));
  askHowToUse(next.filter((u) => waiting.has(`${u.pack}|${u.path}`)));
}

$('use-dialog').addEventListener('close', () => {
  // "Later" goes on to the next one; "Later for all" (or Escape) leaves them in Files → To assign.
  const answer = $('use-dialog').returnValue;
  if (answer === 'next') askNext();
  else if (answer !== 'picked') {
    if (useQueue.length) toast(`${useQueue.length + 1} file(s) left to assign: see Files → To assign.`);
    useQueue = [];
  }
});

/** Why a folder gave no parts, in words a user can act on. */
function unsupportedHint(gradientFiles) {
  if (gradientFiles) return `only colour sheets were found (${gradientFiles}); they've been added to the colour lists.`;
  return 'no files are named like MV/MZ generator parts (FG_..., TV_..., SV_...) or VX Ace ones (Face/..., Mini/...). '
    + 'XP and 2000/2003 sprites can be assigned by hand (Files → To assign); cut a 2000/2003 charset into its 8 characters first (Cut…).';
}

/** The Files menu: how many files wait to be assigned, and how many look-alikes there are. */
let toAssignCount = 0;
let alikeCount = 0;
let reportCount = 0;
/** Every note of the import report, for "Export as text file". */
let reportText = '';
function setFilesLabel(toAssign = toAssignCount) {
  toAssignCount = toAssign;
  $('open-files').textContent = toAssign ? `Files… (${toAssign} to assign)` : 'Files…';
  // The menu button stays short: a badge with the files that wait to be assigned; the counts of
  // look-alikes and notes are on their own menu items.
  const notes = [toAssign && `${toAssign} to assign`, alikeCount && `${alikeCount} look-alike${alikeCount === 1 ? '' : 's'}`, reportCount && `${reportCount} note${reportCount === 1 ? '' : 's'} in the import report`].filter(Boolean);
  $('files-menu-button').replaceChildren('Files', ...(toAssign ? [el('span', { className: 'count-badge', textContent: toAssign > 999 ? '999+' : String(toAssign) })] : []), ' ▾');
  $('files-menu-button').title = notes.length ? notes.join(', ') : 'Files, look-alikes and the import report';
}

/** Buttons that need a folder open (the Load menu works before: sample kit, sets). */
const APP_BUTTONS = ['randomize', 'clear-all', 'random-rules', 'save-menu-button', 'export-images', 'save-character', 'save-setup', 'export-sets-menu', 'open-setups', 'export-setup', 'save-set', 'open-multi',
  'load-character', 'import-setup', 'open-files', 'gallery-menu-button', 'open-gallery', 'open-sets', 'open-templates',
  'rules-menu-button', 'files-menu-button'];

/** Back to the start screen: nothing is loaded. */
function showWelcome() {
  state.character = null;
  state.composites = {};
  $('app').classList.add('empty');
  $('welcome').hidden = false;
  for (const id of ['sidebar', 'editor', 'preview']) $(id).hidden = true;
  for (const id of APP_BUTTONS) $(id).disabled = true;
  setFilesLabel(0);
  $('open-problems').hidden = true;
  $('packs').replaceChildren();
}

function showApp() {
  $('app').classList.remove('empty');
  $('welcome').hidden = true;
  for (const id of ['sidebar', 'editor', 'preview']) $(id).hidden = false;
  for (const id of APP_BUTTONS) $(id).disabled = false;
}
$('open-templates').addEventListener('click', () => {
  $('templates-dialog').showModal();
  renderFrameHints();
});

/**
 * Puts a menu's list under its button, inside the window: placed against the window (fixed), so a
 * list near the right edge opens to the left and never makes the page scroll sideways.
 */
function placeMenu(button, list) {
  const b = button.getBoundingClientRect();
  const width = document.documentElement.clientWidth;
  list.style.top = `${b.bottom + 4}px`;
  list.style.left = '0px';
  const w = list.getBoundingClientRect().width;
  list.style.left = `${Math.max(8, Math.min(b.left, width - w - 8))}px`;
}
// An open menu follows its button when the window changes size or the page scrolls.
for (const event of ['resize', 'scroll']) {
  addEventListener(event, () => {
    for (const menu of document.querySelectorAll('.menu')) {
      const list = menu.querySelector('.menu-list');
      if (!list.hidden) placeMenu(menu.querySelector('.menu-button'), list);
    }
  }, { passive: true });
}

// Enter in a search box filters (as typing already does); it doesn't close the window it is in.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches?.('input[type="search"]')) e.preventDefault();
});

// Menus in the top bar (Load, Save, Gallery): a click opens the list, a pick or a click elsewhere closes it.
function closeMenus(except = null) {
  for (const menu of document.querySelectorAll('.menu')) {
    if (menu === except) continue;
    menu.querySelector('.menu-list').hidden = true;
    menu.querySelector('.menu-button').setAttribute('aria-expanded', 'false');
  }
}
for (const menu of document.querySelectorAll('.menu')) {
  const button = menu.querySelector('.menu-button');
  const list = menu.querySelector('.menu-list');
  button.addEventListener('click', () => {
    closeMenus(menu);
    list.hidden = !list.hidden;
    button.setAttribute('aria-expanded', String(!list.hidden));
    if (!list.hidden) placeMenu(button, list);
  });
  // Picking an item closes the menu (file pickers too: their input still gets the file).
  list.addEventListener('click', (e) => {
    if (e.target.closest('.menu-item')) setTimeout(() => closeMenus(), 0);
  });
}
document.addEventListener('click', (e) => {
  if (!e.target.closest?.('.menu')) closeMenus();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMenus();
});
$('open-problems').addEventListener('click', () => $('problems').showModal());
$('export-problems').addEventListener('click', () => downloadBlob(new Blob([reportText], { type: 'text/plain' }), 'import-report.txt'));

if (state.settings.sets?.length) {
  const fixed = state.settings.sets.map(withoutOwnParts);
  if (fixed.some((s, i) => s !== state.settings.sets[i])) {
    state.settings.sets = fixed;
    saveSettings();
  }
}

/** Shows which of the three Pictures buttons is on. */
function showTilePictures() {
  const value = state.settings.tilePictures || 'auto';
  for (const b of $('tile-pictures').querySelectorAll('button')) {
    b.classList.toggle('active', b.dataset.value === value);
    b.setAttribute('aria-checked', String(b.dataset.value === value));
  }
}
for (const b of $('tile-pictures').querySelectorAll('button')) {
  b.addEventListener('click', () => {
    state.settings.tilePictures = b.dataset.value;
    saveSettings();
    showTilePictures();
    renderEditor();
  });
}

// ---------- rendering ----------

function renderAll() {
  renderImageTransform();
  renderSidebar();
  renderEditor();
  renderPreview();
  renderProblems();
}

/** Parts whose extra items and pieces are shown in the part list (folded by default). */
const openPartGroups = new Set();

/** Folded piece groups in the list on the left: "Beard|TV" (a picture) or "Beard|TV|1,0" (a frame). */
const openPieceGroups = new Set();

/**
 * The rows of a split item's pieces, nested by picture, then frame (for pieces per frame), then the
 * pieces themselves: Beard ▸ Walk ▸ Down 1 ▸ Beard - Walk Down 1 - 2.
 */
function pieceRows(key, button) {
  const split = state.character.split?.[key];
  const pieces = pieceKeys(state.character, key);
  const link = (piece) => (linkOf(piece) ? ' ⛓' : '');
  if (!split?.pieces) return pieces.map((piece) => button(piece, pieceLabel(piece) + link(piece), ''));
  const rows = [];
  const fold = (id, label, count, depth) => {
    const holds = state.selectedPart.startsWith(`${key} #`) && pieces.some((p, i) => p === state.selectedPart && `${key}|${split.pieces[i].sheet}${depth > 1 ? `|${split.pieces[i].cell}` : ''}` === id);
    // Pieces per frame are many: their groups start folded.
    const open = openPieceGroups.has(id) ? true : openPieceGroups.has(`-${id}`) ? false : holds || !split.byFrame;
    const head = el('button', { type: 'button', className: `piece-group depth-${depth}`, textContent: `${open ? '▾' : '▸'} ${label} (${count})`,
      title: `${open ? 'Fold' : 'Show'} the ${count} pieces` });
    head.addEventListener('click', () => {
      openPieceGroups.delete(id);
      openPieceGroups.delete(`-${id}`);
      openPieceGroups.add(open ? `-${id}` : id);
      openPartGroups.add(partOfKey(key));
      renderSidebar();
    });
    rows.push(head);
    return open;
  };
  const bySheet = new Map();
  split.pieces.forEach((meta, i) => {
    if (!bySheet.has(meta.sheet)) bySheet.set(meta.sheet, []);
    bySheet.get(meta.sheet).push(i);
  });
  for (const [sheet, list] of bySheet) {
    if (!fold(`${key}|${sheet}`, SHEET_NAMES[sheet] || sheet, list.length, 1)) continue;
    const byCell = new Map();
    for (const i of list) {
      const cell = split.pieces[i].rle == null ? split.pieces[i].cell || '' : '';
      if (!byCell.has(cell)) byCell.set(cell, []);
      byCell.get(cell).push(i);
    }
    for (const [cell, inCell] of byCell) {
      if (cell && !fold(`${key}|${sheet}|${cell}`, cellName(sheet, cell), inCell.length, 2)) continue;
      for (const i of inCell) {
        const b = button(pieces[i], pieceLabel(pieces[i]) + link(pieces[i]), '');
        b.classList.add(cell ? 'depth-3' : 'depth-2');
        rows.push(b);
      }
    }
  }
  return rows;
}

function renderSidebar() {
  const lib = state.library;
  const select = $('body-type');
  select.replaceChildren(
    ...(lib.bodyTypes.size > 1 && !lib.bodyTypes.has(ALL_BODIES)
      ? [el('option', { value: ALL_BODIES, textContent: 'All body types', title: 'Every body type\'s parts in one list' })] : []),
    ...[...lib.bodyTypes.keys()].map((name) => el('option', { value: name, textContent: name })),
  );
  select.value = state.character.bodyType;
  $('character-name').value = state.character.name;

  const button = (key, label, value, extra = '') => {
    const hiddenItem = state.character.hidden?.[key];
    const worn = key === ALL_COLOURS || key.includes(' #') || !!state.character.parts[key];
    const b = el('button', { className: (key === state.selectedPart ? 'active' : '') + (key.includes(' #') ? ' piece' : '') + (hiddenItem ? ' hidden-item' : '') + (worn ? ' worn' : '') + extra, title: (value ? `${label}: ${value}` : label) + (hiddenItem ? ' (hidden)' : '') }, [
      el('span', { textContent: label + (state.locked.has(key) ? ' 🔒' : '') }),
      el('span', { className: 'value', textContent: value }),
    ]);
    b.addEventListener('click', () => {
      state.selectedPart = key;
      renderSidebar();
      renderEditor();
    });
    return b;
  };
  const valueOf = (key) => {
    const variant = lib.variants.get(state.character.parts[key]);
    return variant ? variantLabel(lib, variant, state.character.bodyType) : 'none';
  };
  const rows = [button(ALL_COLOURS, 'All colours', '')];
  for (const part of partNames(lib, state.character.bodyType)) {
    // A part's extra items (AccA 2) and pieces (Eyes · 1) are folded under it.
    const inside = [];
    for (const key of [part, ...itemKeys(state.character, part)]) {
      if (key !== part) inside.push(button(key, key, valueOf(key)));
      inside.push(...pieceRows(key, button));
    }
    const selectedInside = state.selectedPart !== part && partOfKey(state.selectedPart) === part && state.selectedPart !== ALL_COLOURS;
    const head = button(part, part, valueOf(part), selectedInside ? ' holds-active' : '');
    if (!inside.length) {
      rows.push(head);
      continue;
    }
    const open = openPartGroups.has(part) || selectedInside;
    const fold = el('span', { className: 'part-fold', role: 'button', textContent: `${open ? '▾' : '▸'} ${inside.length}`,
      title: `${open ? 'Fold' : 'Show'} ${inside.length} more of ${part} (extra items and pieces)` });
    fold.addEventListener('click', (e) => {
      e.stopPropagation();
      if (openPartGroups.has(part) || selectedInside) {
        openPartGroups.delete(part);
        if (selectedInside) state.selectedPart = part;
      } else openPartGroups.add(part);
      renderSidebar();
      if (selectedInside) renderEditor();
    });
    head.append(fold);
    rows.push(el('div', { className: 'part-group' }, [head, el('div', { className: 'part-inside', hidden: !open }, inside)]));
  }
  $('part-list').replaceChildren(...rows);

  renderSets();
  const openPacks = el('button', { type: 'button', className: 'packs-head', textContent: 'Packs and Files', title: 'The packs and files you opened: take one out, or forget them all' });
  openPacks.addEventListener('click', () => openFilesDialog('packs'));
  $('packs').replaceChildren(openPacks, ...lib.packs.map((p) => el('div', { textContent: `• ${p.name} (${p.fileCount} files)` })));
}

/** The part editor's tabs: [id, label, what's in it]. "All" shows everything on one long page. */
const EDITOR_TABS = [
  ['parts', 'Parts', 'Pick the part'],
  ['colours', 'Colours', 'Colours, colour masks and matching colours'],
  ['position', 'Position', 'Move, turn, resize, mirror; move parts together'],
  ['images', 'Per image', 'Which picture the part uses on the portrait, walk, damage and battler'],
  ['visibility', 'Visibility', 'Show only inside another part, Clip Content, split into pieces'],
  ['all', 'All', 'Everything on one page'],
];

/** Shows the chosen tab of the part editor; tabs with nothing in them for this part are left out. */
function renderEditorTabs() {
  const editor = $('editor');
  const has = (tab) => tab === 'all' || tab === 'colours'
    || (tab === 'parts' ? $('variants').children.length > 0 : [...editor.querySelectorAll(`[data-tab="${tab}"]`)].some((s) => !s.hidden));
  const available = EDITOR_TABS.filter(([id]) => has(id));
  const wanted = state.settings.editorTab || 'parts';
  // A tab this part doesn't have (a piece has no part list): the first that fits.
  const active = available.some(([id]) => id === wanted) ? wanted : ['parts', 'position', 'colours'].find(has);
  editor.dataset.tab = active;
  // All colours has only colours: no tabs.
  $('editor-tabs').hidden = available.length <= 2;
  $('editor-tabs').replaceChildren(...available.map(([id, label, title]) => {
    const b = el('button', { type: 'button', role: 'tab', className: id === active ? 'active' : '', textContent: label, title });
    b.dataset.editorTab = id;
    b.setAttribute('aria-selected', String(id === active));
    b.addEventListener('click', () => {
      state.settings.editorTab = id;
      saveSettings();
      renderEditorTabs();
    });
    return b;
  }));
}

async function renderEditor() {
  const key = state.selectedPart;
  const isColours = key === ALL_COLOURS;
  const part = isColours ? null : partOfKey(key);
  const isPiece = !isColours && itemOfKey(key) !== key;
  const isExtra = !isColours && !isPiece && key !== part;
  const worn = !isColours && !!state.character.parts[itemOfKey(key)];
  $('editor-title').textContent = isColours ? 'All colours' : isPiece ? pieceLabel(key) : key;
  $('lock-part').checked = state.locked.has(key);
  $('lock-part').parentElement.hidden = isColours || isPiece;
  $('offsets').hidden = !worn;
  // Any part can have more items, as many as you like (a second body or face too).
  $('add-item').hidden = isColours || isPiece || !worn;
  $('add-item').textContent = `+ Another ${part}`;
  $('remove-item').hidden = !isExtra;
  $('remove-part').hidden = isColours || isPiece || !worn;
  $('reassign-part').hidden = isColours || isPiece || !worn;
  if (worn) {
    const v = state.library.variants.get(state.character.parts[itemOfKey(key)]);
    $('reassign-part').title = `Now read as ${v ? `${v.bodyType} ${v.part} ${v.pid}, ${styleOf(v) === 'vxace' ? 'a VX Ace part' : 'an MV/MZ part'}` : 'unknown'}. Read wrong (another part, or VX Ace instead of MV/MZ)? Tell the generator what its file is`;
  }
  $('pieces').hidden = !worn || isPiece;
  $('clip-box').hidden = !worn;
  if (worn) renderClip();
  $('sheet-parts-box').hidden = !worn || isPiece;
  if (worn && !isPiece) renderSheetParts();
  $('piece-note').hidden = !isPiece;

  $('variants').replaceChildren();
  $('other-variants').replaceChildren();
  $('other-bodies').hidden = true;
  // The image sections belong to a part's list: All colours and pieces have none.
  $('variant-tabs').hidden = true;
  if (isPiece) {
    renderOffsets();
  } else if (!isColours) {
    renderPieces();
    const listed = variantsForPart(state.library, part, state.character.bodyType, state.character.parts[key]);
    // VX Ace or MV/MZ parts only, when both kinds are open. The chosen part is not kept in the
    // other style's list: an MV/MZ part under "VX Ace" looked like it was read as VX Ace.
    const kinds = new Set([...listed.own, ...listed.others].map(styleOf));
    const style = kinds.size > 1 ? state.settings.partStyle || '' : '';
    const keep = (list) => (style ? list.filter((v) => styleOf(v) === style) : list);
    const own = keep(listed.own);
    const others = keep(listed.others);
    // Sections per image (portrait, walk, damage, battler): the parts that have a picture for it,
    // drawn as that picture. A part with only a damage sprite shows up under Damage.
    const imagesOf = new Map([...own, ...others].map((v) => [v, SHEET_KEYS.filter((s) => sheetLayers(v, s, state.library).length)]));
    const counts = Object.fromEntries(SHEET_KEYS.map((s) => [s, [...imagesOf.values()].filter((list) => list.includes(s)).length]));
    const tab = counts[state.tileSheet] ? state.tileSheet : '';
    const shown = (v) => !tab || imagesOf.get(v).includes(tab);
    const tabs = [['', `All (${imagesOf.size})`], ...SHEET_KEYS.filter((s) => counts[s]).map((s) => [s, `${SHEET_NAMES[s]} (${counts[s]})`])];
    const styleCount = (s) => [...listed.own, ...listed.others].filter((v) => styleOf(v) === s).length;
    const styleTabs = kinds.size > 1 ? [['', 'Both styles'], ['mvmz', `MV/MZ (${styleCount('mvmz')})`], ['vxace', `VX Ace (${styleCount('vxace')})`]] : [];
    $('variant-tabs').hidden = tabs.length < 3 && !styleTabs.length;
    $('variant-tabs').replaceChildren(...(tabs.length < 3 ? [] : tabs).map(([s, label]) => {
      const b = el('button', { type: 'button', className: s === tab ? 'active' : '', textContent: label,
        title: s ? `Only the ${part} parts that have a ${SHEET_NAMES[s].toLowerCase()} picture, shown as that picture` : `Every ${part} part` });
      b.addEventListener('click', () => {
        state.tileSheet = s;
        renderEditor();
      });
      return b;
    }), ...(styleTabs.length ? [el('span', { className: 'tab-gap' })] : []), ...styleTabs.map(([s, label]) => {
      const b = el('button', { type: 'button', className: 'style-tab' + (s === style ? ' active' : ''), textContent: label,
        title: s ? `Only the ${s === 'vxace' ? 'VX Ace' : 'MV/MZ'} parts (VX Ace parts are painted and drawn smaller)` : 'VX Ace and MV/MZ parts together' });
      b.addEventListener('click', () => {
        state.settings.partStyle = s;
        saveSettings();
        renderEditor();
      });
      return b;
    }));
    const sheets = tab ? [tab] : undefined;
    $('tile-pictures-box').hidden = !!tab || ![...own, ...others].some((v) => v.icon);
    showTilePictures();
    for (const variant of own.filter(shown)) $('variants').append(variantTile(key, variant, sheets));
    if (!$('variants').children.length) $('variants').append(el('p', { className: 'muted small', textContent: `No ${part} parts here${others.some(shown) ? ': see the other body types below' : ''}.` }));
    if (others.some(shown)) {
      $('other-bodies').hidden = false;
      // Folded away at first for every part; it stays open while you look at the same part.
      if (state.otherBodiesPart !== key) $('other-bodies').open = false;
      state.otherBodiesPart = key;
      const chosenThere = others.some((v) => v.id === state.character.parts[key]);
      $('other-bodies-label').textContent = `Parts from other body types (${others.filter(shown).length})${chosenThere ? ': your choice is one of these' : ''}`;
      for (const variant of others.filter(shown)) $('other-variants').append(variantTile(key, variant, sheets));
    }
    renderOffsets();
  }
  renderEditorTabs();
  renderLayers();

  // Colour slots depend on decoded masks, so decode the selected variants first.
  const token = ++state.editorToken;
  await ensureVariants(variantsToDecode(state.character, state.library));
  if (token !== state.editorToken) return;
  renderSlots();
  // The part's colour slots are known now: tiles may switch between icon and part as drawn.
  if (!isColours) refreshTiles();
}

/** Whether an item has colours other than Source: then its tiles can show the part as drawn. */
function itemRecoloured(key) {
  const worn = state.character.parts[key];
  if (!worn) return false;
  return usedSlots({ parts: { [key]: worn } }, state.library).some((s) => itemColor(state.character, key, s.id));
}

/** Tiles show the Variation icon, or the part as drawn (like the preview): see #tile-pictures. */
function tileUsesIcon(key) {
  const mode = state.settings.tilePictures || 'auto';
  return mode === 'icons' || (mode === 'auto' && !itemRecoloured(key));
}

/** sheets: the images to draw the tile from, best first (default: portrait, walk, battler, damage). */
function variantTile(key, variant, sheets = undefined) {
  const selected = (state.character.parts[key] || null) === (variant?.id || null);
  const label = variant ? variantLabel(state.library, variant, state.character.bodyType) : 'None';
  const vx = variant && styleOf(variant) === 'vxace' && state.library.packs.some((p) => p.format !== 'vxace');
  const tile = el('button', { className: 'variant' + (selected ? ' selected' : '') + (vx ? ' vx' : ''), title: variant ? `${label}${vx ? ' (VX Ace part)' : ''}
${variant.id}${selected ? '\nWorn: click again to take it off' : ''}` : 'None' });
  const thumb = el('div', { className: 'placeholder', textContent: variant ? '?' : '∅' });
  // The variant on one line, where it's from (pack, body type) on the next: neither is cut short
  // to make room for the other.
  const [name, ...from] = label.split(' · ');
  tile.append(thumb, el('span', { textContent: name }));
  if (from.length) tile.append(el('span', { className: 'from', textContent: from.join(' · ') }));
  if (variant) {
    // The part's Variation icon, the picture RPG Maker's own generator shows, recoloured like the
    // part. Parts without one, and the per-image sections, are drawn from their pictures.
    let shown = thumb;
    tile.refresh = () => {
      // Decided again on each redraw: recolouring the part switches to the part as drawn.
      const icon = !sheets && variant.icon && tileUsesIcon(key);
      tile.classList.toggle('has-icon', !!icon);
      return (icon ? iconThumbnail(key, variant).catch(() => null) : Promise.resolve(null))
      .then((pixels) => pixels || partThumbnail(key, variant, sheets))
      .then((pixels) => pixels || (variant.icon ? ensureImage(variant.icon) : null))
      .then((pixels) => {
        if (!pixels) return;
        const canvas = toCanvas(pixels);
        shown.replaceWith(canvas);
        shown = canvas;
      })
      .catch(() => {});
    };
    tile.refresh();
  }
  tile.addEventListener('click', async () => {
    // The chosen part clicked again: taken off (there is no "None" tile).
    state.character.parts[key] = selected ? null : variant?.id || null;
    // A split part keeps its pieces if the new variant falls apart the same way.
    const split = state.character.split?.[key];
    if (split) {
      await ensureVariants(variantsToDecode(state.character, state.library));
      const next = variant && makeSplit(state.character, state.library, key, split.gap, split.byFrame, state.settings, handCuts(split));
      if (next?.count > 1) state.character.split[key] = { ...next, ...(split.links ? { links: split.links } : {}) };
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
/** A mask putting all of a picture in one slot (MZ portrait layers name their slot: _m001). */
function slotMask(image, rgb) {
  const out = createImage(image.width, image.height);
  for (let i = 0; i < image.data.length; i += 4) if (image.data[i + 3] > 16) out.data.set([rgb >> 16, (rgb >> 8) & 255, rgb & 255, 255], i);
  return out;
}

function iconThumbnail(key, variant, character = state.character) {
  const colours = JSON.stringify([character.colors, character.itemColors?.[key], state.settings.templates]);
  const cacheKey = `icon|${key}|${variant.id}|${colours}`;
  if (!thumbCache.has(cacheKey)) {
    if (thumbCache.size > 600) thumbCache.clear();
    thumbCache.set(cacheKey, (async () => {
      const icon = await ensureImage(variant.icon);
      if (!icon) return null;
      variant.iconMask ||= (async () => {
        // MZ portrait layers name their slot (_m001: skin) instead of having a mask: all of the
        // picture is in that slot.
        const layers = variant.layers.filter((l) => l.base && (l.paint || l.mask || SLOT_BY_ID.has(l.slotId)) && !l.base.cells);
        if (!layers.length) return null;
        await ensureLayers(layers);
        const mask = iconMask(icon, layers.filter((l) => l.base.pixels).map((l) => ({
          image: l.base.pixels, mask: (l.paint || l.mask)?.pixels || slotMask(l.base.pixels, SLOT_BY_ID.get(l.slotId).rgb),
        })));
        // The grey figure every icon is drawn on is not part of the part: it keeps its colours
        // (a grey head took the clothing's colours, in stripes).
        const figure = mask && await silhouetteFor(variant);
        if (!mask || !figure) return mask;
        if (!isCloseUp(icon, figure)) return iconPart(icon, figure, mask) || mask;
        // A close-up: the face behind the part takes the skin colour, like the face on the
        // portrait. A face icon is that face: all of it is the part, so it follows the skin colour.
        return closeUpMask(icon, mask, variant.part === 'Face' ? null : await backdropFor(variant), SLOT_BY_ID.get('skin').rgb);
      })();
      const mask = await variant.iconMask;
      if (!mask) return icon;
      const byId = gradientsById();
      const gradientFor = (slotId) => {
        const id = itemColor(character, key, slotId);
        const g = id ? byId.get(id) : null;
        if (g?.shiftSource) return (g.shiftRef ||= { shift: g.adjust });
        return g?.colors ?? null;
      };
      return recolorLayer(icon, mask, null, gradientFor, state.settings);
    })());
  }
  return thumbCache.get(cacheKey);
}

function partThumbnail(key, variant, sheets = ['FG', 'TV', 'SV', 'TVD'], source = false, library = state.library) {
  // source: the picture as drawn in the file, no gradients (to compare files, not colours).
  // library: another view of the parts (see ownPicture).
  const alone = {
    ...state.character, parts: { [key]: variant.id }, offsets: {}, split: {}, clip: {}, drawOrder: {},
    sheetParts: {}, hidden: {}, sheetTransform: {}, taller: {}, ...(source ? { colors: {}, itemColors: {} } : {}),
  };
  const colours = source ? 'source' : JSON.stringify([state.character.colors, state.character.itemColors?.[key], state.settings.templates]);
  const cacheKey = `${key}|${variant.id}|${sheets}|${colours}`;
  if (!thumbCache.has(cacheKey)) {
    if (thumbCache.size > 600) thumbCache.clear();
    thumbCache.set(cacheKey, (async () => {
      let best = null;
      let bestCount = 0;
      for (const sheet of sheets) {
        const layers = sheetLayers(variant, sheet, library);
        if (!layers.length) continue;
        await ensureLayers(layers);
        const { image, frame } = composeSheet(sheet, alone, library, source ? new Map() : gradientsById(), state.settings);
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


// ---------- clips for all pictures, one picture, or some frames ----------

/**
 * Where the Visibility box's choices go: null = all pictures, else the keys of clip.at: a sheet
 * ("TV") or its frames ("TV|1,2").
 */
function clipScope() {
  const sheet = $('clip-sheet').value;
  if (!sheet) return null;
  if (sheet === 'FG' || $('clip-group').value === 'all') return [sheet];
  const group = cellGroups(sheet)[Number($('clip-group').value)] || { cells: [] };
  const frame = $('clip-frame').value;
  const cells = frame === 'all' ? group.cells : [group.cells[Number(frame)]].filter(Boolean);
  return cells.map((c) => `${sheet}|${c}`);
}

/** What one scope sets for an item: its own clip, or null when it follows a wider one. */
function scopedClip(entry, scope) {
  if (!scope) return entry ? { mode: entry.mode || '', by: entry.by, grow: entry.grow } : null;
  return entry?.at?.[scope[0]] || null;
}

/** The clip that applies in a scope (its own, else the sheet's, else the one for all pictures). */
function clipIn(entry, scope) {
  if (!entry) return null;
  const k = scope?.[0];
  const own = k && entry.at?.[k];
  const sheet = k && entry.at?.[k.split('|')[0]];
  return own || sheet || entry;
}

/** Sets an item's clip in a scope; value null = follow the wider one again. */
function setClipIn(key, scope, value) {
  const all = (state.character.clip ||= {});
  const entry = (all[key] ||= {});
  if (!scope) {
    for (const f of ['mode', 'by', 'grow']) delete entry[f];
    if (value?.mode) Object.assign(entry, { mode: value.mode, by: value.by }, value.grow ? { grow: value.grow } : {});
  } else {
    entry.at ||= {};
    for (const k of scope) {
      if (value) entry.at[k] = value.mode ? { mode: value.mode, by: value.by, ...(value.grow ? { grow: value.grow } : {}) } : { mode: '' };
      else delete entry.at[k];
    }
    if (!Object.keys(entry.at).length) delete entry.at;
  }
  if (!entry.mode && !entry.at && !entry.cut) delete all[key];
}

function renderClipScope() {
  const sheet = $('clip-sheet').value;
  const sprite = !!sheet && sheet !== 'FG';
  $('clip-group').hidden = !sprite;
  if (sprite) {
    const groups = cellGroups(sheet);
    const keep = $('clip-group').value;
    $('clip-group').replaceChildren(el('option', { value: 'all', textContent: 'all frames' }), ...groups.map((g, i) => el('option', { value: i, textContent: g.name })));
    $('clip-group').value = keep && keep !== 'all' && Number(keep) < groups.length ? keep : 'all';
  }
  const group = sprite && $('clip-group').value !== 'all' ? cellGroups(sheet)[Number($('clip-group').value)] : null;
  $('clip-frame').hidden = !group || group.cells.length < 2;
  if (group) {
    const keep = $('clip-frame').value || 'all';
    $('clip-frame').replaceChildren(el('option', { value: 'all', textContent: `all ${group.cells.length} frames` }),
      ...group.cells.map((_, i) => el('option', { value: i, textContent: `frame ${i + 1} only` })));
    $('clip-frame').value = keep === 'all' || Number(keep) < group.cells.length ? keep : 'all';
  }
}

const CLIP_WORDS = { inside: 'only inside the outline of', over: 'only where it overlaps', outside: 'except where it overlaps' };

/** The "Visibility" box: show this item only inside / over / outside another item. */
function renderClip() {
  const key = state.selectedPart;
  renderClipScope();
  const scope = clipScope();
  const entry = state.character.clip?.[key];
  const own = scopedClip(entry, scope);
  const shown = clipIn(entry, scope);
  const others = selectedItems(state.character, state.library).map((i) => i.key).filter((k) => k !== itemOfKey(key));
  const missing = shown?.by && !others.includes(shown.by) ? [el('option', { value: shown.by, textContent: `${shown.by} (not worn)` })] : [];
  $('clip-by').replaceChildren(...others.map((k) => el('option', { value: k, textContent: k })), ...missing);
  // A frame follows its sheet's choice, if it has one, else the one for all pictures.
  const sheetKey = scope?.[0].includes('|') && entry?.at?.[scope[0].split('|')[0]] ? scope[0].split('|')[0] : null;
  const wider = sheetKey ? entry.at[sheetKey] : entry;
  const widerName = sheetKey ? `the ${sheetLabel(sheetKey).toLowerCase()}` : 'all pictures';
  const follow = $('clip-mode').querySelector('[value="="]');
  follow.hidden = !scope;
  follow.textContent = `as for ${widerName}`;
  $('clip-mode').value = scope && !own ? '=' : own?.mode || '';
  if (shown?.by) $('clip-by').value = shown.by;
  $('clip-by').disabled = !others.length;
  const clipped = !!shown?.mode;
  $('clip-by').hidden = !clipped;
  $('clip-grow-box').hidden = !clipped;
  $('clip-grow').value = shown?.grow || 0;
  const pictures = entry?.at ? Object.keys(entry.at).length : 0;
  $('clip-note').textContent = scope && !own
    ? `As for ${widerName}${wider?.mode ? `: ${CLIP_WORDS[wider.mode]} ${wider.by}` : ': shown everywhere'}. Pick another choice to set it here only.`
    : !scope && pictures ? `${pictures} picture(s) or frame(s) have a choice of their own (For: pick one to see it).` : '';
  renderCovers(others);
}

/**
 * The other way round: this part (a hood, hat or mask) hides what sticks out of it. Each ticked
 * part only shows inside this part's outline ("only inside the outline of" set on that part).
 */
function renderCovers(worn) {
  const key = state.selectedPart;
  const clips = state.character.clip || {};
  // Every part, also ones not worn now: ticked, they're cut off once you put them on.
  const own = partOfKey(itemOfKey(key));
  const others = [...worn, ...partNames(state.library, state.character.bodyType).filter((p) => p !== own && !worn.includes(p))];
  $('cover-box').hidden = !others.length;
  $('cover-box').replaceChildren(el('span', { className: 'small', textContent: 'Clip Content (these only show inside it):' }), ...others.map((other) => {
    const scope = clipScope();
    const now = clipIn(clips[other], scope);
    const box = el('input', { type: 'checkbox', checked: now?.mode === 'inside' && now?.by === key });
    box.addEventListener('change', () => {
      if (box.checked) setClipIn(other, scope, { mode: 'inside', by: key });
      else if (clipIn(state.character.clip?.[other], scope)?.by === key) {
        // Off for this picture or frame only: a wider clip by this part stays, but not here.
        const wider = scope && clipIn(state.character.clip?.[other], null);
        setClipIn(other, scope, scope && wider?.mode === 'inside' && wider.by === key ? { mode: '' } : null);
      }
      renderClip();
      renderPreview();
    });
    const notWorn = !worn.includes(other);
    return el('label', { className: 'lock move-chip' + (notWorn ? ' not-worn' : ''), title: `${other} only shows inside the outline of ${key}${notWorn ? ' (not worn now: it is cut off once you put it on)' : ''}` }, [box, ` ${other}`]);
  }));
}

function updateClip() {
  const key = state.selectedPart;
  const mode = $('clip-mode').value;
  const by = $('clip-by').value;
  const grow = Math.max(0, Math.min(8, Math.round(Number($('clip-grow').value) || 0)));
  const scope = clipScope();
  if (mode === '=') setClipIn(key, scope, null);
  else setClipIn(key, scope, mode && by ? { mode, by, grow } : { mode: '' });
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
  if (split) $('split-frames').checked = !!split.byFrame;
  const perSheet = split?.pieces
    ? Object.entries(split.pieces.reduce((a, p) => ({ ...a, [p.sheet]: (a[p.sheet] || 0) + 1 }), {})).map(([s, n]) => `${sheetLabel(s).toLowerCase()} ${n}`).join(', ')
    : split?.sheets && Object.entries(split.sheets).map(([s, n]) => `${sheetLabel(s).toLowerCase()} ${n}`).join(', ');
  $('pieces-status').textContent = split
    ? `Split into ${split.count} pieces${perSheet ? ` (${perSheet})` : ''}, listed under ${key} on the left. Each can be moved, turned, recoloured and reordered on its own.`
    : '';
}

/** The pieces of a split item that were cut out by hand (Extract → Split off as a piece). */
const handCuts = (split) => (split?.pieces || []).filter((p) => p.rle != null);


/** A frame's name: "Down 2", "Walk 3" (battler motion), or "frame 1,2". */
function cellName(sheet, cell) {
  for (const g of cellGroups(sheet)) {
    const i = g.cells.indexOf(cell);
    if (i >= 0) return g.cells.length > 1 ? `${g.name} ${i + 1}` : g.name;
  }
  return `frame ${cell}`;
}

/**
 * A piece's name: "Beard - Walk 2", "Beard - Portrait" (one piece there), "Beard - Walk Down 1 - 2"
 * (a piece of one frame), "Beard - Walk, cut 1" (cut out by hand). Old splits: "Beard · 2".
 */
function pieceLabel(key) {
  const item = itemOfKey(key);
  const split = state.character.split?.[item];
  const i = Number(key.split('#').pop()) - 1;
  const meta = split?.pieces?.[i];
  if (!meta) return `${item} · ${i + 1}`;
  const sheet = SHEET_NAMES[meta.sheet] || meta.sheet;
  if (meta.rle != null) {
    const n = handCuts(split).filter((p) => p.sheet === meta.sheet).indexOf(meta) + 1;
    return `${item} - ${sheet}, cut ${n}`;
  }
  const alike = split.pieces.filter((p) => p.rle == null && p.sheet === meta.sheet && (p.cell || null) === (meta.cell || null)).length;
  const where = meta.cell ? `${sheet} ${cellName(meta.sheet, meta.cell)}` : sheet;
  return `${item} - ${where}${alike > 1 ? (meta.cell ? ` - ${meta.n}` : ` ${meta.n}`) : ''}`;
}

async function splitSelected(gap) {
  const key = state.selectedPart;
  await ensureVariants(variantsToDecode(state.character, state.library));
  const old = state.character.split?.[key];
  const split = makeSplit(state.character, state.library, key, gap, $('split-frames').checked, state.settings, handCuts(old));
  if (split.count < 2) {
    toast(`${key} is on one picture only, in one piece: nothing to split. Cut a piece out by hand: close up → Extract → Split off as a piece.`);
    return;
  }
  (state.character.split ||= {})[key] = { ...split, ...(old?.links ? { links: old.links } : {}) };
  renderAll();
}

/** Parts kept whole while "Split every part" is on: "key|variant id|gap", joined by you or one piece. */
const keptWhole = new Set();

/** Splits every worn part that falls apart (transparent gaps). Layers must be decoded. */
function splitWorn() {
  const gap = Math.max(0, Math.min(8, Number($('split-gap').value) || 0));
  let split = 0;
  let whole = 0;
  for (const key of Object.keys(state.character.parts)) {
    const id = state.character.parts[key];
    if (!id || state.character.split?.[key] || keptWhole.has(`${key}|${id}|${gap}`)) continue;
    // Only parts that fall apart somewhere (two eyes, horns): the others stay whole.
    const made = makeSplit(state.character, state.library, key, gap, false, state.settings);
    if (!made.apart) {
      keptWhole.add(`${key}|${id}|${gap}`);
      whole++;
      continue;
    }
    (state.character.split ||= {})[key] = made;
    split++;
  }
  return { split, whole };
}

/** Split all: every worn part that falls apart (transparent gaps) is split into pieces. */
async function splitAll() {
  await ensureVariants(variantsToDecode(state.character, state.library));
  keptWhole.clear();
  const { split, whole } = splitWorn();
  renderAll();
  toast(split ? `Split ${split} part${split === 1 ? '' : 's'} into pieces${whole ? `; ${whole} ${whole === 1 ? 'is' : 'are'} one piece` : ''}.` : 'Every worn part is one piece already: nothing to split.');
}

/**
 * "Split every part": every part is split as soon as you wear it (picked, randomized, loaded or
 * put on with a set), not only the ones worn when you click Split all.
 */
function splitEverythingToggle() {
  const box = el('input', { type: 'checkbox', className: 'split-everything', checked: !!state.settings.splitEverything });
  box.addEventListener('change', () => {
    state.settings.splitEverything = box.checked;
    saveSettings();
    if (box.checked) splitAll();
  });
  return el('label', { className: 'lock', title: 'Every part you wear is split into pieces where transparent gaps separate it, now and whenever you pick, randomize or load one. Joining a part keeps it whole.' },
    [box, ' Split every part automatically, also the ones you pick later']);
}

/** Join all: every split part becomes one piece again. */
function joinAll() {
  if (state.settings.splitEverything) {
    state.settings.splitEverything = false;
    saveSettings();
    toast('Joined every part, and turned off "Split every part automatically".');
  }
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
  // Joined by you: stays whole while "Split every part" is on.
  keptWhole.add(`${key}|${state.character.parts[key]}|${state.character.split?.[key]?.gap ?? 0}`);
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
  renderPiecePreview();
}

/**
 * A split piece on its own, on every image: which part of the picture it is, where it sits. The
 * walk and battler show one frame, the damage sprite its three frames.
 */
let piecePreviewToken = 0;
async function renderPiecePreview() {
  const key = state.selectedPart;
  const box = $('piece-preview');
  const token = ++piecePreviewToken;
  if (!pieceInfo(key)) {
    box.hidden = true;
    return;
  }
  await ensureVariants(variantsToDecode(state.character, state.library));
  if (token !== piecePreviewToken) return;
  const alone = { ...state.character, only: key };
  const pictures = [];
  for (const sheet of ['FG', 'TV', 'TVD', 'SV']) {
    const { image, frame } = composeSheet(sheet, alone, state.library, gradientsById(), state.settings);
    if (!image || !image.data.some((v, i) => i % 4 === 3 && v)) continue;
    const f = frameOf(sheet, image, frame);
    // One frame: the walk facing down (standing), the battler's first; damage and portrait whole.
    const crop = sheet === 'TV' || sheet === 'SV' ? { x: f.cols === 3 ? f.w : 0, y: 0, w: f.w, h: f.h } : { x: 0, y: 0, w: image.width, h: image.height };
    const part = createImage(crop.w, crop.h);
    for (let y = 0; y < crop.h; y++) {
      const start = ((crop.y + y) * image.width + crop.x) * 4;
      part.data.set(image.data.subarray(start, start + crop.w * 4), y * crop.w * 4);
    }
    const canvas = toCanvas(part);
    canvas.className = `piece-pic piece-${sheet}`;
    pictures.push(el('figure', {}, [canvas, el('figcaption', { className: 'muted small', textContent: SHEET_NAMES[sheet] })]));
  }
  box.replaceChildren(el('div', { className: 'small', textContent: `${key} on its own` }), el('div', { className: 'piece-pics' }, pictures));
  box.hidden = !pictures.length;
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
  const sheetOfPiece = (n) => info.split.pieces?.[n - 1]?.sheet;
  const others = Array.from({ length: info.split.count }, (_, i) => i + 1)
    .filter((n) => n !== info.n && sheetOfPiece(n) === sheetOfPiece(info.n));
  $('link-to').replaceChildren(el('option', { value: '', textContent: 'nothing' }),
    ...others.map((n) => el('option', { value: n, textContent: pieceLabel(`${info.item} #${n}`) })));
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
  $('image-keep').checked = !t.scaleY;
  $('image-scaley').value = t.scaleY || t.scale || 100;
  $('image-size').value = sizeOf(t.scale || 100, t.scaleY || t.scale || 100);
  $('image-flipx').checked = !!t.flipX;
  $('image-flipy').checked = !!t.flipY;
  markImageTransform();
}

function markImageTransform() {
  const changed = Object.keys(state.character.sheetTransform || {}).map((s) => SHEET_NAMES[s]);
  $('image-transform-mark').textContent = changed.length ? `(changed: ${changed.join(', ')})` : '';
}

/** Size: width and height together (their average). */
const sizeOf = (w, h) => Math.round((w + h) / 2);
const percent = (v) => Math.max(10, Math.min(400, Math.round(Number(v) || 100)));

function updateImageTransform(e) {
  const sheet = $('image-sheet').value;
  const keep = $('image-keep').checked;
  const changed = e?.target?.id;
  let w = percent($('image-scale').value);
  let h = percent($('image-scaley').value);
  if (changed === 'image-size') {
    // Both grow or shrink by the same share.
    const before = sizeOf(w, h);
    const size = percent($('image-size').value);
    if (keep) w = h = size;
    else {
      w = percent((w * size) / before);
      h = percent((h * size) / before);
    }
  } else if (keep) {
    if (changed === 'image-scaley') w = h;
    else h = w;
  }
  $('image-scale').value = w;
  $('image-scaley').value = h;
  if (changed !== 'image-size') $('image-size').value = sizeOf(w, h);
  const t = readShape('image', 400);
  if (h !== t.scale) t.scaleY = h;
  const all = (state.character.sheetTransform ||= {});
  if (t.x || t.y || t.rot || t.scale !== 100 || t.scaleY || t.flipX || t.flipY) all[sheet] = t;
  else delete all[sheet];
  markImageTransform();
  renderPreview();
}
for (const f of [...SHAPE_FIELDS, 'scaley', 'keep', 'size']) $(`image-${f}`).addEventListener('input', updateImageTransform);
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
  const key = state.selectedPart;
  const before = offsets[key] || {};
  offsets[key] = { ...before, face: readShape('off-face'), sprite: readShape('off-sprite') };
  syncPartner(key);
  // Parts moved together get the same change.
  if (moveGroup.has(key)) {
    for (const other of moveGroup) {
      if (other === key || !wornKeys().includes(other)) continue;
      const o = offsets[other] || {};
      offsets[other] = { ...o, face: shiftShape(o.face, before.face, offsets[key].face), sprite: shiftShape(o.sprite, before.sprite, offsets[key].sprite) };
      syncPartner(other);
    }
  }
  renderPreview();
  renderPiecePreview();
}

/**
 * Parts that move together: ticked under Position, a change to one of them (moved, turned,
 * resized, mirrored, flipped) is made to all of them. For this session.
 */
const moveGroup = new Set();
/** The worn items and split pieces, in part-list order. */
function wornKeys() {
  const keys = [];
  for (const [key, id] of Object.entries(state.character.parts)) {
    if (!id) continue;
    const pieces = state.character.split?.[key] ? pieceKeys(state.character, key) : [];
    keys.push(...(pieces.length ? pieces : [key]));
  }
  return keys;
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
      if (l.slotId !== slot.id && !(l.paint || l.mask)?.slots?.has?.(slot.id)) continue;
      for (const w of nameWords(`${v.pid} ${(l.base?.path || '').split('/').pop()}`)) words.add(w);
    }
  }
  return [...words];
}

function slotsForEditor() {
  if (state.selectedPart === ALL_COLOURS) return withFollowedSlots(usedSlots(state.character, state.library));
  const variant = state.library.variants.get(state.character.parts[itemOfKey(state.selectedPart)]);
  if (!variant) return [];
  const ids = new Set();
  for (const layer of variant.layers) {
    if (layer.slotId) ids.add(layer.slotId);
    (layer.paint || layer.mask)?.slots?.forEach((s) => ids.add(s));
  }
  return withFollowedSlots([...SLOTS.filter((s) => ids.has(s.id)), ...PAINTED_SLOTS.filter((s) => ids.has(s.id))]);
}

/** Colour sync is on, and there are VX Ace parts and MV/MZ parts to sync. */
const hasBothKinds = () => state.library.packs.some((p) => p.format === 'vxace') && state.library.packs.some((p) => p.format !== 'vxace');
const syncingColours = () => state.settings.syncColours !== false && hasBothKinds();

/** With colour sync, the MV/MZ colours that VX Ace parts follow are offered too (hair for VX hair). */
function withFollowedSlots(slots) {
  if (!syncingColours()) return slots;
  const ids = new Set(slots.map((s) => s.id));
  for (const s of slots) if (s.painted && PAINTED_FOLLOWS[s.id]) ids.add(PAINTED_FOLLOWS[s.id]);
  return [...SLOTS.filter((s) => ids.has(s.id)), ...slots.filter((s) => s.painted)];
}

/** "Sync colours": VX Ace parts follow the MV/MZ colours, unless a painted colour is picked. */
function syncColoursToggle() {
  const box = el('input', { type: 'checkbox', className: 'sync-colours', checked: state.settings.syncColours !== false });
  box.addEventListener('change', () => {
    state.settings.syncColours = box.checked;
    saveSettings();
    thumbCache.clear();
    renderAll();
    refreshTiles();
  });
  return el('label', { className: 'lock', title: 'A VX Ace part takes the colour picked for its kind (hair, skin, clothing...), gradient or hue, saturation and brightness, like the MV/MZ parts. Picking one of its painted colours keeps that colour instead.' },
    [box, ' Sync colours: VX Ace parts follow the MV/MZ colours (unless you pick a painted colour)']);
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
  // With colour sync, no painted colour = following the MV/MZ colour (its own swatch).
  const follows = syncingColours() && SLOT_BY_ID.get(PAINTED_FOLLOWS[slot.id]);
  const current = slotColour(slot.id);
  const chosen = /^painted:/.test(current || '') || !follows ? paintedIndex(current) : -1;
  const pick = (value) => {
    setSlotColour(slot.id, value);
    renderSlots();
    renderPreview();
    refreshTiles();
  };
  const followButton = follows ? [el('button', { className: 'swatch add follow' + (chosen === -1 ? ' selected' : ''), textContent: `Same as ${follows.label.toLowerCase()}`,
    title: `Take the ${follows.label.toLowerCase()} colour of the MV/MZ parts` })] : [];
  followButton[0]?.addEventListener('click', () => pick(null));
  return [...followButton, ...Array.from({ length: count }, (_, i) => {
    const colour = layers.map((l) => (i < cellCount(l.base) ? averageColour(cellOf(l.base, i)) : null)).find(Boolean) || '#888888';
    const b = el('button', { className: 'swatch painted' + (i === chosen ? ' selected' : ''), title: `Painted colour ${i + 1}` });
    b.style.background = colour;
    b.addEventListener('click', () => pick(i || follows ? `painted:${i}` : null));
    return b;
  })];
}

const swatchCache = new WeakMap();
function swatchImage(gradient) {
  if (!swatchCache.has(gradient)) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 1;
    canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(gradient.colors), 256, 1), 0, 0);
    swatchCache.set(gradient, canvas.toDataURL());
  }
  return swatchCache.get(gradient);
}

function renderSlots() {
  const box = $('slots');
  const slots = slotsForEditor();
  const auto = state.selectedPart === ALL_COLOURS ? null
    : autoMaskBox(state.library.variants.get(state.character.parts[itemOfKey(state.selectedPart)]));
  if (!slots.length) {
    const what = state.selectedPart === ALL_COLOURS ? 'The selected parts have' : 'This part has';
    const paint = paintMaskButton();
    box.replaceChildren(el('p', { className: 'muted', textContent: `${what} no recolourable areas.` }), ...(paint ? [paint] : []), ...(auto ? [auto] : []),
      ...(state.selectedPart === ALL_COLOURS ? [recolourAllToggle()] : []));
    return;
  }
  const available = pickableGradients();
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
    head.push(el('div', { className: 'source-reset' }, [reset, splitButton, joinButton]), splitEverythingToggle(), recolourAllToggle(),
      ...(hasBothKinds() ? [syncColoursToggle()] : []));
  }
  const paint = paintMaskButton();
  if (paint) head.push(paint);
  box.replaceChildren(...head, ...(auto ? [auto] : []), ...slots.map((slot) => {
    if (slot.painted) {
      return el('div', { className: 'slot' }, [
        el('div', { className: 'slot-head' }, [el('span', { className: 'key', style: `background:#${slot.rgb.toString(16).padStart(6, '0')}` }), el('span', { textContent: `${slot.label} (VX Ace, painted)` })]),
        el('div', { className: 'swatches' }, paintedSwatches(slot)),
      ]);
    }
    const preferred = preferredCategories(slot.id);
    const gradients = uniqueGradients(available, slotColour(slot.id), preferred);
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
    wrap.append(el('div', { className: 'swatches', style: 'margin-top:5px' }, [add, adjust, ...matchPicker(slot, current), ...gradientTools(slot, current)]));
    return wrap;
  }));
}

/** Duplicate or delete the chosen colour; "Reset colours to default" brings deleted ones back. */
function gradientTools(slot, current) {
  const tools = [];
  if (current && current.id !== ADJUSTING_ID) {
    const copy = el('button', { className: 'swatch add', textContent: 'Duplicate', title: `Copy "${current.label}" into Your colours, to change the copy (Hue · saturation · brightness) and keep the original` });
    copy.addEventListener('click', () => duplicateGradient(slot, current));
    const del = el('button', { className: 'swatch add', textContent: 'Delete', title: `Take "${current.label}" out of the colour lists (and off this character). "Reset colours to default" brings it back` });
    del.addEventListener('click', () => deleteGradient(current));
    tools.push(copy, del);
  }
  const deleted = state.settings.hiddenGradients?.length || 0;
  if (deleted) {
    const reset = el('button', { className: 'swatch add', textContent: 'Reset colours to default', title: 'Bring back every colour you deleted' });
    reset.addEventListener('click', () => {
      delete state.settings.hiddenGradients;
      saveSettings();
      renderSlots();
      toast('The colours you deleted are back in the lists.');
    });
    tools.push(reset);
  }
  return tools;
}

function duplicateGradient(slot, g) {
  const id = `custom/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const label = `${g.label} copy`;
  const copy = g.stops ? createCustomGradient(id, label, g.stops)
    : g.shiftSource ? createSourceAdjust(id, label, g.adjust)
      : createAdjustedGradient(id, label, g.from || g.id, g.adjust || { hue: 0, saturation: 100, brightness: 100 }, g.colors);
  state.customGradients.push(copy);
  setSlotColour(slot.id, id);
  renderSlots();
  renderPreview();
  refreshTiles();
  toast(`"${label}" is in Your colours and on the ${slot.label.toLowerCase()}.`);
}

/**
 * Deletes a colour: one of yours goes for good (Undo brings it back), one from the colour sheets
 * is left out of the lists until "Reset colours to default". Parts in it go back to Source.
 */
function deleteGradient(g) {
  const before = { colors: { ...state.character.colors }, itemColors: JSON.parse(JSON.stringify(state.character.itemColors || {})) };
  for (const [slot, id] of Object.entries(state.character.colors)) if (id === g.id) delete state.character.colors[slot];
  for (const colours of Object.values(state.character.itemColors || {})) {
    for (const [slot, id] of Object.entries(colours)) if (id === g.id) colours[slot] = null;
  }
  const own = g.source === 'custom';
  const at = state.customGradients.indexOf(g);
  // The same colours in other colour sheets (shown once) go too, or the colour would stay listed.
  const same = (x) => x.colors.length === g.colors.length && x.colors.every((v, i) => v === g.colors[i]);
  const ids = own ? [] : state.fileGradients.filter((x) => x.colors && same(x)).map((x) => x.id);
  if (own) state.customGradients = state.customGradients.filter((x) => x !== g);
  else {
    state.settings.hiddenGradients = [...new Set([...(state.settings.hiddenGradients || []), ...ids])];
    saveSettings();
  }
  const redraw = () => {
    renderSlots();
    renderPreview();
    refreshTiles();
  };
  redraw();
  toast(`Deleted "${g.label}".`, 8000, {
    label: 'Undo',
    run: () => {
      if (own) state.customGradients.splice(Math.max(0, at), 0, g);
      else {
        state.settings.hiddenGradients = (state.settings.hiddenGradients || []).filter((id) => !ids.includes(id));
        if (!state.settings.hiddenGradients.length) delete state.settings.hiddenGradients;
        saveSettings();
      }
      state.character.colors = before.colors;
      state.character.itemColors = before.itemColors;
      redraw();
    },
  });
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
  // Split every part: a part just put on is split before it is drawn.
  if (state.settings.splitEverything && splitWorn().split) {
    renderSidebar();
    if (state.selectedPart !== ALL_COLOURS && !state.selectedPart.includes(' #')) renderPieces();
  }
  const byId = gradientsById();
  const problems = [...errors, ...unknownMaskColours()];
  for (const sheet of SHEET_KEYS) {
    if (!sheetOn(sheet)) {
      state.composites[sheet] = null;
      continue;
    }
    // Made of another sheet's parts: drawn as that sheet, in this sheet's template.
    const base = sheetBase(sheet);
    const settings = base === sheet ? state.settings
      : { ...state.settings, templates: { ...(state.settings.templates || {}), [base]: state.settings.templates?.[sheet] } };
    const crop = base === 'FG' && sheetOption(sheet).crop;
    const { image, problems: pr, ...p } = crop ? croppedPortrait(crop, state.settings.templates?.[sheet], byId)
      : composeSheet(base, state.character, state.library, byId, settings);
    problems.push(...pr);
    state.composites[sheet] = image ? {
      image, canvas: toCanvas(image), frame: frameOf(base, image, p.frame),
      // Squash and stretch: the picture before it, where the lines are drawn in the close up.
      plain: p.plainImage ? { image: p.plainImage, canvas: toCanvas(p.plainImage), frame: frameOf(base, p.plainImage, p.plainFrame) } : null,
    } : null;
  }
  state.extraComposites = extraSheets().filter((x) => !x.off).map((x) => {
    // One sheet that can't be drawn doesn't stop the others (it says why in its preview).
    try {
      // 8 directions: the walk sheet, with the diagonals drawn the same way under it (or only the
      // diagonals, as a sheet of their own next to the walk).
      if (x.base === 'DIR8') {
        const settings = extraSettings({ ...x, base: 'TV', cols: 3, rows: 4 });
        const walk = composeSheet('TV', state.character, state.library, byId, settings).image;
        const diagonal = walk && composeSheet('TV', state.character, diagonalLibrary(x.diagonals), byId, settings).image;
        return { sheet: x, image: walk && diagonal && (x.onlyDiagonals ? diagonal : join8(walk, diagonal)) };
      }
      // RPG Maker XP: the walk sheet, as 4 x 4 frames.
      const other = WALK_LAYOUTS[x.base];
      if (other) {
        const { image } = composeSheet('TV', state.character, state.library, byId, extraSettings({ ...x, base: 'TV', cols: 3, rows: 4 }));
        return { sheet: x, image: image && other.fromWalk(image) };
      }
      if (x.base === 'FG' && x.crop) return { sheet: x, image: croppedPortrait(x.crop, x, byId).image };
      const { image } = composeSheet(x.base, state.character, state.library, byId, extraSettings(x));
      return { sheet: x, image };
    } catch (err) {
      console.error(err);
      problems.push(`${x.name || 'Sheet'}: could not be drawn (${err.message})`);
      return { sheet: x, image: null, error: err.message };
    }
  });
  renderExtraPreviews();
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
  if (!$('taller-panel').contains(document.activeElement)) renderTaller();
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

/** Whether an item (part or piece) moves together with the selected one. */
const movesWith = (item) => moveGroup.has(state.selectedPart) && moveGroup.has(item);

/** Ticks or unticks an item to move together with the selected part. */
function setMovesWith(item, on) {
  const key = state.selectedPart;
  if (on) {
    // Joining: this part and the ticked one are one group.
    if (!moveGroup.has(key)) moveGroup.clear();
    moveGroup.add(key);
    moveGroup.add(item);
  } else {
    moveGroup.delete(item);
    if (moveGroup.size < 2) moveGroup.clear();
  }
  renderLayers();
}

let draggedLayers = null;
/** Parts whose layers are listed one by one in the layers panel (folded by default). */
const openLayerGroups = new Set();

/** Whether a layer draws anything (an empty colour layer is left out of the list). */
const layerShows = new WeakMap();
function showsPixels(layer) {
  const pixels = layer.base?.pixels;
  if (!pixels) return true; // not read yet: count it
  if (!layerShows.has(pixels)) layerShows.set(pixels, hasPixels(pixels));
  return layerShows.get(pixels);
}

/** One layer's own picture (as drawn in its file), cut to what it shows. */
function layerPicture(layer, sheet) {
  const pixels = layer.base?.pixels;
  if (!pixels) return null;
  const f = sheet === 'FG' ? null : frameFor(sheet, { w: pixels.width, h: pixels.height });
  if (f) {
    const frame = cutFrame(pixels, f, sheet === 'TV' && f.cols > 1 ? 1 : 0, 0);
    const box = drawnBounds(frame);
    if (box) return cropImage(frame, box);
  }
  const box = drawnBounds(pixels);
  return box && cropImage(pixels, box);
}

/**
 * The layers panel beside the parts: the layers of the chosen image, top-most first, one row per
 * part with its picture. A part with several layers (colour layers, pieces) folds them under its
 * name ("Eyes 1", "Eyes 2"); layers that draw nothing are left out. Drag a row to draw it above or
 * below others; tick parts to move them together with the selected one; the eye hides a part.
 */
function renderLayers() {
  scheduleFocus();
  const sheet = $('layer-sheet').value;
  // Hidden parts keep their place in the list (faded), so they can be shown again where they were.
  // Hidden on this image only ("hidden" under Per image) counts too.
  const shownSheetParts = Object.fromEntries(Object.entries(state.character.sheetParts || {})
    .map(([k, s]) => [k, Object.fromEntries(Object.entries(s).filter(([, v]) => v !== HIDDEN))]));
  const topFirst = layersForSheet(sheet, { ...state.character, hidden: {}, sheetParts: shownSheetParts }, state.library).reverse();
  const isHidden = (item) => !!state.character.hidden?.[item] || state.character.sheetParts?.[item]?.[sheet] === HIDDEN;
  $('layer-show-all').hidden = !hiddenOrCut().length;
  const custom = !!state.character.drawOrder?.[sheet];
  $('layer-reset').disabled = !custom;
  const selected = state.selectedPart;
  const selectedItem = selected === ALL_COLOURS ? null : itemOfKey(selected);
  const canGroup = selected !== ALL_COLOURS && wornKeys().includes(selected);
  const grouped = [...moveGroup].filter((k) => k !== selected && movesWith(k));
  $('move-group-note').hidden = !grouped.length;
  $('move-group-note').textContent = grouped.length ? `Moves together with: ${grouped.join(', ')} (tick or untick them under Layers).` : '';
  if (!topFirst.length) {
    $('layer-list').replaceChildren(el('li', { className: 'muted', textContent: 'No layers on this image.' }));
    return;
  }
  const ids = topFirst.map(drawId);
  const shownIds = new Set(topFirst.filter((d) => showsPixels(d.layer)).map(drawId));
  const store = (order) => {
    (state.character.drawOrder ||= {})[sheet] = order;
    renderPreview();
  };
  const pickItem = (item) => {
    state.selectedPart = item;
    renderSidebar();
    renderEditor();
  };
  const setHidden = (item, hide) => {
    if (hide) (state.character.hidden ||= {})[item] = true;
    else {
      delete state.character.hidden?.[item];
      if (state.character.sheetParts?.[item]?.[sheet] === HIDDEN) delete state.character.sheetParts[item][sheet];
    }
    renderAll();
  };
  const tickFor = (item) => {
    const own = item === selected || (selectedItem && item === selectedItem && !selected.includes(' #'));
    const tick = el('input', { type: 'checkbox', checked: own || movesWith(item), disabled: !canGroup || own,
      title: own ? 'The selected part' : canGroup ? `Move ${item} together with ${selected}: moving, turning, resizing, mirroring or flipping one changes both by as much` : 'Pick a worn part first' });
    tick.addEventListener('change', () => setMovesWith(item, tick.checked));
    return tick;
  };
  const eyeFor = (item, hidden) => {
    const eye = el('button', { type: 'button', className: 'layer-eye' + (hidden ? ' off' : ''), textContent: hidden ? '◌' : '👁',
      title: hidden ? `Show ${item} again` : `Hide ${item} on every image (it stays worn)` });
    eye.addEventListener('click', () => setHidden(item, !hidden));
    return eye;
  };
  /** Makes a row draggable: it carries block (ids), and others drop above or below it. */
  const dragRow = (row, block, dropAbove, dropBelow) => {
    row.draggable = true;
    row.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      draggedLayers = block;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', block.join('\n'));
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      draggedLayers = null;
      row.classList.remove('dragging');
    });
    const below = (e) => e.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
    const own = () => draggedLayers?.includes(dropAbove) || draggedLayers?.includes(dropBelow);
    row.addEventListener('dragover', (e) => {
      if (!draggedLayers || own()) return;
      e.preventDefault();
      e.stopPropagation();
      row.classList.toggle('drop-below', below(e));
      row.classList.toggle('drop-above', !below(e));
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-above', 'drop-below'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove('drop-above', 'drop-below');
      if (!draggedLayers || own()) return;
      const order = below(e) ? moveBlock(ids, draggedLayers, dropBelow, true) : moveBlock(ids, draggedLayers, dropAbove, false);
      draggedLayers = null;
      store(order);
    });
  };
  const stepButtons = (block) => {
    const up = el('button', { type: 'button', textContent: '↑', title: 'Draw above the layer over it' });
    const down = el('button', { type: 'button', textContent: '↓', title: 'Draw below the layer under it' });
    const shown = (id) => shownIds.has(id);
    up.disabled = stepBlock(ids, block, 1, shown) === ids;
    down.disabled = stepBlock(ids, block, -1, shown) === ids;
    up.addEventListener('click', () => store(stepBlock(ids, block, 1, shown)));
    down.addEventListener('click', () => store(stepBlock(ids, block, -1, shown)));
    return el('span', { className: 'layer-buttons' }, [up, down]);
  };

  const rows = [];
  for (const group of groupLayers(topFirst.filter((d) => shownIds.has(drawId(d))), itemOfKey)) {
    const { item, draws } = group;
    const groupIds = draws.map(drawId);
    const block = topRun(ids.filter((id) => shownIds.has(id)), groupIds);
    const thumb = el('span', { className: 'layer-thumb' });
    const variant = state.library.variants.get(state.character.parts[item]);
    if (variant) {
      // Cut to what is drawn, so small parts (eyes, a nose) show at a size you can see.
      partThumbnail(item, variant, [sheet]).then((pixels) => {
        const box = pixels && drawnBounds(pixels);
        if (box) thumb.replaceChildren(toCanvas(cropImage(pixels, box)));
      }).catch(() => {});
    }
    const many = draws.length > 1;
    const open = many && openLayerGroups.has(item);
    const fold = el('button', { type: 'button', className: 'layer-fold', textContent: many ? (open ? '▾' : '▸') : '', disabled: !many,
      title: many ? `${open ? 'Fold' : 'Show'} the ${draws.length} layers of ${item}` : '' });
    fold.addEventListener('click', () => {
      if (openLayerGroups.has(item)) openLayerGroups.delete(item);
      else openLayerGroups.add(item);
      renderLayers();
    });
    const name = item.includes(' #') ? pieceLabel(item) : item;
    const pick = el('button', { type: 'button', className: 'layer-name', title: `Pick ${name}` }, [
      name, ...(many ? [el('span', { className: 'layer-count', textContent: ` ${draws.length}` })] : []),
    ]);
    pick.addEventListener('click', () => pickItem(item));
    // Cut off by another part (hair under a hood): one click shows it whole again.
    const clip = clipOf(state.character, item, $('layer-sheet').value);
    const scissors = clip ? el('button', { type: 'button', className: 'layer-eye layer-clip', textContent: '✂',
      title: `${item} ${clip.mode === 'inside' ? `only shows inside the outline of ${clip.by}` : clip.mode === 'over' ? `only shows where it overlaps ${clip.by}` : `is hidden where it overlaps ${clip.by}`}: click to show it whole again` }) : '';
    if (scissors) {
      scissors.addEventListener('click', () => {
        delete state.character.clip[item];
        renderAll();
      });
    }
    const row = el('li', { className: 'layer-row layer-group' + (item === selectedItem ? ' selected' : '') + (isHidden(item) ? ' is-hidden' : ''), title: 'Drag up or down to change the draw order' }, [
      el('span', { className: 'grip', textContent: '⋮⋮' }), fold, tickFor(item), thumb, pick, scissors, eyeFor(item, isHidden(item)), stepButtons(block),
    ]);
    row.dataset.item = item;
    dragRow(row, block, block[0], block[block.length - 1]);
    rows.push(row);
    if (!open) continue;
    draws.forEach((draw, n) => {
      const id = drawId(draw);
      const sub = el('span', { className: 'layer-thumb' });
      const pic = layerPicture(draw.layer, sheet);
      if (pic) sub.replaceChildren(toCanvas(pic));
      const piece = draw.item !== item;
      const name = el('button', { type: 'button', className: 'layer-name', textContent: `${item} ${n + 1}`,
        title: `${draw.layer.base?.path || draw.layer.key}${piece ? ` (piece ${draw.item.split('#').pop()})` : ''}` });
      name.addEventListener('click', () => pickItem(draw.item));
      const apart = !block.includes(id) ? el('span', { className: 'muted layer-apart', textContent: 'apart', title: 'Drawn apart from the rest of this part (e.g. behind the body)' }) : '';
      const subRow = el('li', { className: 'layer-row layer-sub' + (draw.item === selected ? ' selected' : ''), title: 'Drag up or down to change the draw order of this layer only' }, [
        el('span', { className: 'grip', textContent: '⋮⋮' }), piece ? tickFor(draw.item) : el('span', { className: 'layer-tick-space' }), sub, name, apart, stepButtons([id]),
      ]);
      dragRow(subRow, [id], id, id);
      rows.push(subRow);
    });
  }
  $('layer-list').replaceChildren(...rows);
}

/** Items hidden or cut off in any way: hidden, hidden on one image, or cut off by another part. */
function hiddenOrCut() {
  const c = state.character;
  return [...new Set([
    ...Object.keys(c.hidden || {}).filter((k) => c.hidden[k]),
    ...Object.keys(c.clip || {}),
    ...Object.keys(c.sheetParts || {}).filter((k) => Object.values(c.sheetParts[k]).includes(HIDDEN)),
  ])];
}

$('layer-show-all').addEventListener('click', () => {
  const c = state.character;
  const items = hiddenOrCut();
  c.hidden = {};
  c.clip = {};
  for (const s of Object.values(c.sheetParts || {})) for (const [sheet, v] of Object.entries(s)) if (v === HIDDEN) delete s[sheet];
  renderAll();
  toast(`Showing everything again: ${items.join(', ')}.`);
});

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
    const assign = el('button', { className: 'small-button assign', textContent: 'Assign…', title: 'Tell the generator what this file is, then the next one' });
    assign.addEventListener('click', () => assignOneByOne(u));
    return el('li', {}, [`Skipped ${u.path} (${u.reason}) `, assign]);
  });
  if (lib.unrecognized.length > 30) skipped.push(el('li', { textContent: `… and ${lib.unrecognized.length - 30} more skipped files (see Files…).` }));
  const queue = el('button', { className: 'small-button primary', textContent: `Assign skipped files one by one (${lib.unrecognized.length})…` });
  queue.addEventListener('click', () => assignOneByOne(lib.unrecognized[0]));
  const lines = [
    ...lib.warnings,
    ...state.problems,
    ...state.renderProblems,
  ];
  const total = lib.unrecognized.length + lines.length;
  reportCount = total;
  reportText = [
    `Import report: ${total} note(s)`, '',
    ...lib.unrecognized.map((u) => `Skipped ${u.path} (${u.reason})`),
    ...lines,
  ].join('\r\n');
  setFilesLabel(lib.unrecognized.length);
  $('open-problems').hidden = !total;
  $('open-problems').textContent = `Import report… (${total})`;
  $('problem-list').replaceChildren(
    el('p', { className: 'muted small', textContent: `${total} note(s). Skipped files don't stop the rest from loading; "Assign…" adds one by hand.` }),
    ...(lib.unrecognized.length ? [queue] : []),
    el('ul', {}, [...skipped, ...lines.slice(0, 500).map((l) => el('li', { textContent: l }))]),
  );
}

// ---------- character sets ----------

/** Icons drawn back to front: the figure's own parts first, then clothes, hair and accessories. */
const ICON_ORDER = ['Body', 'Face', 'Ears', 'Eyes', 'Eyebrows', 'Nose', 'Mouth', 'FacialMark', 'Beard', 'Clothing', 'Cloak',
  'RearHair', 'FrontHair', 'BeastEars', 'Tail', 'Wing', 'AccA', 'AccB', 'Glasses'];

/** The figure of a folder and body type's Variation icons, made once (see iconSilhouette). */
const silhouettes = new Map();
function silhouetteFor(variant) {
  const key = `${variant.pack}|${variant.bodyType}`;
  if (!silhouettes.has(key)) {
    silhouettes.set(key, (async () => {
      // Icons of many different parts, so no part is taken for the figure.
      const byPart = new Map();
      for (const v of state.library.variants.values()) {
        if (v.pack !== variant.pack || v.bodyType !== variant.bodyType || !v.icon) continue;
        const list = byPart.get(v.part) || [];
        if (list.length < 4) byPart.set(v.part, [...list, v]);
      }
      const icons = (await Promise.all([...byPart.values()].flat().map((v) => ensureImage(v.icon).catch(() => null)))).filter(Boolean);
      if (icons.length < 3) return null;
      // Close-ups (the face, ears, eyes, nose and mouth are drawn big, beside the figure) are not
      // on it: the figure is made again from the icons that are.
      const first = iconSilhouette(icons);
      const onFigure = icons.filter((i) => !isCloseUp(i, first));
      return onFigure.length >= 3 ? iconSilhouette(onFigure) : first;
    })());
  }
  return silhouettes.get(key);
}

/** What a part's close-up icons are drawn on: the picture most of them share (3 icons or more). */
const backdrops = new Map();
function backdropFor(variant) {
  const key = `${variant.pack}|${variant.bodyType}|${variant.part}`;
  if (!backdrops.has(key)) {
    backdrops.set(key, (async () => {
      const own = [...state.library.variants.values()].filter((v) => v.pack === variant.pack && v.bodyType === variant.bodyType && v.part === variant.part && v.icon);
      const icons = (await Promise.all(own.slice(0, 24).map((v) => ensureImage(v.icon).catch(() => null)))).filter(Boolean);
      return icons.length >= 3 ? iconSilhouette(icons) : null;
    })());
  }
  return backdrops.get(key);
}

/**
 * A set's picture: its parts cut out of their Variation icons and layered on one figure, in the
 * set's colours. Parts without an icon are left out; null when none has one.
 */
async function setIcon(set) {
  if (!state.character || !state.library.variants.size) return null;
  const { character } = applySet(setBase(), set, state.library);
  const order = (key) => ICON_ORDER.indexOf(partOfKey(key));
  const items = Object.keys(set.parts).map((key) => ({ key, variant: state.library.variants.get(character.parts[key]) }))
    .filter((i) => i.variant?.icon).sort((a, b) => order(a.key) - order(b.key));
  if (!items.length) return null;
  const figure = await silhouetteFor(items[0].variant);
  if (!figure) return null;
  const out = { width: figure.width, height: figure.height, data: new Uint8ClampedArray(figure.data) };
  let parts = 0;
  for (const { key, variant } of items) {
    const [icon, drawn] = await Promise.all([ensureImage(variant.icon), iconThumbnail(key, variant, character)]);
    // Close-up icons (face, eyes...) aren't drawn on the figure: left out like parts without one.
    const part = icon && drawn && !isCloseUp(icon, figure) && iconPart(icon, figure, drawn);
    if (!part) continue;
    blendOver(out, part);
    parts++;
  }
  return parts ? out : null;
}

/** A character wearing nothing, in Source colours: what set pictures are drawn on, so they stay the same. */
function setBase() {
  return { ...createCharacter(state.character?.bodyType || 'Male'), colors: {}, itemColors: {} };
}

/**
 * What a set looks like on its own: only its parts (no body or anything else of the current
 * character), in its colours; colours it doesn't have are the current character's.
 */
function setCharacter(set) {
  const worn = applySet(setBase(), set, state.library).character;
  return { ...worn, parts: Object.fromEntries(Object.keys(set.parts || {}).map((k) => [k, worn.parts[k]])), drawOrder: {}, sheetTransform: {} };
}

/** A set's picture for its card: the icon composite, or its portrait when no part has an icon. */
function setPicture(set) {
  const box = el('button', { type: 'button', className: 'set-icon gallery-pics placeholder', textContent: '?', title: `See ${set.name} bigger, with its portrait and walk sprite` });
  box.addEventListener('click', () => openSetView(set));
  (async () => {
    const pixels = (await setIcon(set)) || (state.character ? (await characterPicture(setCharacter(set), set.customGradients || [])).face : null);
    if (!pixels) return;
    const canvas = toCanvas(pixels);
    box.replaceChildren(canvas);
    box.classList.remove('placeholder');
  })().catch(() => {});
  return box;
}

/** A window with a set's icon composite, portrait and walk sprite, big. */
async function openSetView(set) {
  $('set-view-title').textContent = set.name;
  $('set-view-parts').textContent = `Parts: ${Object.keys(set.parts).join(', ')}`;
  const pics = $('set-view-pics');
  pics.replaceChildren(el('p', { className: 'muted small', textContent: 'Drawing...' }));
  viewedAction = () => putOnSet(set);
  $('set-view-use').textContent = 'Put on';
  if (!$('set-view').open) $('set-view').showModal();
  const [icon, { face, sprite }] = await Promise.all([setIcon(set), characterPicture(setCharacter(set), set.customGradients || [])]);
  const figure = (pixels, label, className) => el('figure', { className: 'set-view-pic' }, [
    Object.assign(toCanvas(pixels), { className }), el('figcaption', { className: 'muted small', textContent: label }),
  ]);
  pics.replaceChildren(
    icon ? figure(icon, 'Variation icons, layered', 'set-view-icon') : el('p', { className: 'muted small', textContent: 'None of these parts has a Variation icon.' }),
    ...(face ? [figure(face, 'Portrait (only the set)', 'set-view-face')] : []),
    ...(sprite ? [figure(sprite, 'Walk (only the set)', 'set-view-sprite')] : []),
  );
}
/** What the view window's button does: put the set on, or use the character. */
let viewedAction = null;
$('set-view-use').addEventListener('click', () => viewedAction?.());

/** The same window for a gallery character: its portrait, walk sprite and parts, big. */
async function openCharacterView(item, use) {
  $('set-view-title').textContent = item.name;
  $('set-view-parts').textContent = '';
  const pics = $('set-view-pics');
  pics.replaceChildren(el('p', { className: 'muted small', textContent: 'Drawing...' }));
  viewedAction = use;
  $('set-view-use').textContent = 'Use';
  if (!$('set-view').open) $('set-view').showModal();
  try {
    const { character, missing } = deserializeCharacter(item.text, state.library, allGradients(), item.fileName || '');
    $('set-view-parts').textContent = `Parts: ${Object.keys(character.parts).filter((k) => character.parts[k]).join(', ')}`
      + (missing.length ? ` (not in the open folders: ${missing.join(', ')})` : '');
    const { face, sprite } = await galleryPicture(item.text, item.fileName || '');
    const figure = (pixels, label, className) => el('figure', { className: 'set-view-pic' }, [
      Object.assign(toCanvas(pixels), { className }), el('figcaption', { className: 'muted small', textContent: label }),
    ]);
    pics.replaceChildren(
      ...(face ? [figure(face, 'Portrait', 'set-view-face')] : []),
      ...(sprite ? [figure(sprite, 'Walk', 'set-view-sprite')] : []),
    );
  } catch (err) {
    pics.replaceChildren(el('p', { className: 'muted small', textContent: `Can't be drawn: ${err.message}` }));
  }
}

async function putOnSet(set) {
  for (const g of set.customGradients || []) {
    if (!state.customGradients.some((x) => x.id === g.id)) state.customGradients.push(customGradientFromJson(g));
  }
  // Read the set's colour masks first: which colours its parts use decides where its colours go.
  await ensureVariants(variantsToDecode(applySet(state.character, set, state.library).character, state.library));
  const { character, missing } = applySet(state.character, set, state.library);
  state.character = character;
  renderAll();
  toast(missing.length ? `Put on "${set.name}", but missing: ${missing.join(', ')}` : `Put on "${set.name}".`);
}

/** Sets as cards, like the characters: a big picture, Use, Export and Remove. */
function renderSets() {
  const sets = state.settings.sets || [];
  $('set-list').replaceChildren(...(sets.length ? sets.map((set, i) => {
    const parts = Object.keys(set.parts);
    const name = el('button', { type: 'button', className: 'set-apply gallery-name', textContent: set.name, title: `Put on: ${parts.join(', ')}` });
    name.addEventListener('click', () => putOnSet(set));
    const use = el('button', { type: 'button', className: 'small-button primary', textContent: 'Use', title: `Put on: ${parts.join(', ')}` });
    use.addEventListener('click', () => putOnSet(set));
    const exportOne = el('button', { type: 'button', className: 'small-button', textContent: 'Export', title: 'Download this set as a file; Load → Load set adds it again' });
    exportOne.addEventListener('click', () => {
      const json = JSON.stringify({ format: 'rpgmaker-xgen-sets', version: 1, sets: [set] }, null, 2);
      downloadBlob(new Blob([json], { type: 'application/json' }), `${safeFileName(set.name)}.set.json`);
    });
    const remove = el('button', { type: 'button', className: 'small-button set-remove', textContent: 'Remove', title: 'Delete this set' });
    remove.addEventListener('click', () => {
      state.settings.sets.splice(i, 1);
      saveSettings();
      renderSets();
    });
    const copy = el('button', { type: 'button', className: 'small-button set-copy', textContent: 'Copy', title: 'Make a copy of this set, e.g. to change it' });
    copy.addEventListener('click', () => {
      state.settings.sets.splice(i + 1, 0, { ...structuredClone(set), name: `${set.name} (copy)` });
      saveSettings();
      renderSets();
    });
    const edit = el('button', { type: 'button', className: 'small-button set-edit', textContent: 'Edit', title: 'Rename it, or leave parts out of it' });
    edit.addEventListener('click', () => openSetDialog(i));
    return el('div', { className: 'gallery-card set' }, [
      setPicture(set),
      name,
      el('div', { className: 'muted small', textContent: `${parts.length} part${parts.length === 1 ? '' : 's'}: ${parts.join(', ')}`, title: parts.join(', ') }),
      el('div', { className: 'gallery-buttons' }, [use, edit, copy, exportOne, remove]),
    ]);
  }) : [el('div', { className: 'muted small', textContent: 'None yet. Save → Save set keeps some of the current parts, with their colours, to put on any character.' })]));
  $('export-sets').disabled = !sets.length;
}

/** editing: the index of a saved set to change (its name, which parts stay), or null for a new set. */
let editingSet = null;
function openSetDialog(editing = null) {
  editingSet = typeof editing === 'number' ? editing : null;
  const set = editingSet === null ? null : state.settings.sets[editingSet];
  const keys = set ? Object.keys(set.parts) : Object.keys(state.character.parts).filter((k) => state.character.parts[k]);
  $('set-dialog-title').textContent = set ? `Edit set "${set.name}"` : 'Save as set';
  $('set-name').value = set ? set.name : '';
  $('set-colours').checked = set ? !!Object.keys(set.colors || {}).length || !!Object.keys(set.itemColors || {}).length : true;
  $('set-items').replaceChildren(...keys.map((k) => el('label', { className: 'lock' }, [
    el('input', { type: 'checkbox', value: k, checked: set ? true : !OWN_PARTS.has(partOfKey(k)) }), ` ${k}`,
  ])));
  $('set-dialog').showModal();
}

$('save-set').addEventListener('click', () => openSetDialog());
$('set-dialog').addEventListener('close', () => {
  if ($('set-dialog').returnValue !== 'ok') return;
  const keys = [...$('set-items').querySelectorAll('input:checked')].map((i) => i.value);
  if (!keys.length) {
    toast('Not saved: tick at least one part.');
    return;
  }
  if (editingSet !== null) {
    const old = state.settings.sets[editingSet];
    const name = $('set-name').value.trim() || old.name;
    state.settings.sets[editingSet] = { ...trimSet(old, keys, $('set-colours').checked, state.library), name };
    editingSet = null;
    saveSettings();
    renderSets();
    toast(`Changed the set "${name}".`);
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
  const sheet = $('assign-sheet').value;
  return {
    sheet: WALK_LAYOUTS[sheet] ? 'TV' : sheet,
    layout: WALK_LAYOUTS[sheet]?.layout || null,
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
  // One by one keeps the colour slot's place, so the dialog doesn't jump between pictures.
  const oneByOne = $('assign-dialog').classList.contains('one-by-one');
  $('assign-face-fields').hidden = !isFace && !oneByOne;
  $('assign-face-fields').style.visibility = isFace ? '' : 'hidden';
  const creating = !$('assign-body').value;
  $('assign-new-body').hidden = !creating;
  const body = $('assign-body').value || $('assign-new-body').value.trim();
  $('assign-ok').disabled = !f.part || !body || (creating && !newBodyName(body, []));
  $('assign-result').textContent = f.part && body ? `${body}/${buildPartName(f)}` : 'Pick a part and body type.';
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

/**
 * Quick assign: the short form for this file (picture, part, body type, colour slot; Add, Skip or
 * Cancel), then the next file to assign, and so on.
 */
function assignOneByOne(entry) {
  const list = toAssign();
  if (!entry) return;
  const at = list.indexOf(entry);
  openAssignDialog(entry, at < 0 ? list.filter((u) => u !== entry) : [...list.slice(at + 1), ...list.slice(0, at)]);
}

$('assign-more').addEventListener('click', () => {
  $('assign-dialog').classList.remove('one-by-one');
  updateAssignPreview();
});

async function openAssignDialog(entry, queue = null) {
  assigning = entry;
  assignQueue = queue;
  // One by one (a queue): the short form, with the rest filled in from the file and its size.
  $('assign-dialog').classList.toggle('one-by-one', !!queue);
  const fileName = entry.path.split('/').pop();
  const stem = fileName.replace(/\.png$/i, '');
  const bodies = bodyChoices();
  const folderBody = suggestedBody(dirOf(entry.path), bodies, { words: true });
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
  $('assign-body').replaceChildren(...bodyOptions(bodies), el('option', { value: '', textContent: 'New folder…' }));
  $('assign-body').value = folderBody || state.character?.bodyType || 'Male';
  $('assign-new-body').value = '';
  assignRanked = [];

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
    assigningGuess = guessSheet(pixels.width, pixels.height, entry.path.split('/').pop());
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
    $('assign-body').value = state.library.readAs.get(`${entry.pack}|${entry.path}`)?.how === 'hand' ? current.bodyType : folderBody || current.bodyType;
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
  renderPartChips();
  if (!$('assign-dialog').open) $('assign-dialog').showModal();
  renderSuggestions(entry, !loaded);
}

/** Parts suggested for the file being assigned (by where it sits and its name), best first. */
let assignRanked = [];

/**
 * Every part name to click, under the Part field: the suggested ones first (marked), then the
 * rest. Typing filters them; a new name is still typed in the field.
 */
function renderPartChips() {
  const typed = $('assign-part').value.trim().toLowerCase();
  const suggested = [...new Set(assignRanked.map((r) => r.part))];
  const all = [...new Set([...suggested, ...PART_ORDER, ...partNames(state.library, state.character?.bodyType)])];
  const exact = all.some((p) => p.toLowerCase() === typed);
  const shown = exact || !typed ? all : all.filter((p) => p.toLowerCase().includes(typed));
  $('assign-part-chips').replaceChildren(...shown.map((p) => {
    const b = el('button', {
      type: 'button', textContent: p,
      className: 'chip' + (p.toLowerCase() === typed ? ' active' : '') + (suggested.includes(p) ? ' suggested' : ''),
      title: suggested.includes(p) ? `Suggested: ${p}` : p,
    });
    b.addEventListener('click', () => {
      const r = assignRanked.find((x) => x.part === p);
      if (r) applySuggestion(r);
      else {
        $('assign-part').value = p;
        $('assign-layer').value = '';
        suggestSlot();
        updateAssignPreview();
        renderPartChips();
      }
    });
    return b;
  }), ...(typed && !shown.length ? [el('span', { className: 'muted small', textContent: `"${$('assign-part').value.trim()}" will be a new part.` })] : []));
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
  const other = WALK_LAYOUTS[$('assign-sheet').value];
  const sheet = other ? 'TV' : $('assign-sheet').value;
  const pixels = other && assigningPixels ? other.toWalk(assigningPixels) : assigningPixels;
  box.replaceChildren();
  if (assigningGuess) box.append(el('span', { className: 'muted', textContent: `Suggested image: ${SHEET_NAMES[assigningGuess.sheet] || 'Variation icon'} (${assigningGuess.why}).` }));
  const fileName = entry.path.split('/').pop();
  // The file name, or else its folders' names ("Female Brows/Female Brow 10.png" is eyebrows).
  const named = partsInPath(entry.path, [...new Set([...PART_ORDER, ...partNames(state.library, state.character?.bodyType)])]);
  const profile = pixels && sheet !== 'icon' ? shapeProfile(pixels, sheet) : null;
  let refs = [];
  if (profile) {
    const waiting = el('span', { className: 'muted', textContent: 'Comparing with the loaded parts…' });
    box.append(waiting);
    refs = (await shapeReferences(sheet)).filter((r) => !(r.pack === entry.pack && r.path === entry.path));
    if (token !== suggestToken || assigning !== entry) return;
    waiting.remove();
  } else if (!named.length) return;
  const ranked = (profile ? rankWithName(profile, refs, named) : named.map((part) => ({ part, layer: '', score: NAME_BONUS, named: true })))
    .filter((r) => r.score >= 0.15);
  assignRanked = ranked;
  renderPartChips();
  if (!ranked.length) {
    box.append(el('span', { className: 'muted', textContent: 'No loaded part sits in the same place.' }));
    return;
  }
  box.append(el('span', { textContent: named.length ? 'By its name and where it sits:' : 'Sits where these parts sit:' }), ...ranked.map((r) => {
    const why = r.named ? `"${fileName}" or its folder names this part${profile ? `, and its shape is compared with the loaded ${r.part} parts` : ''}` : `Sits where the loaded ${r.part} parts sit`;
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
  renderPartChips();
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
$('assign-part').addEventListener('input', () => {
  suggestSlot();
  renderPartChips();
});
$('assign-sheet').addEventListener('change', () => assigning && renderSuggestions(assigning));

/** Parts whose variant was taken away (reassigned) are taken off the character. */
function dropMissingParts() {
  if (!state.character) return;
  for (const [key, id] of Object.entries(state.character.parts)) {
    if (id && !state.library.variants.has(id)) state.character.parts[key] = null;
  }
}

/** The body type folders files can go to: found, created by you, minus the empty ones you removed. */
function bodyChoices() {
  return assignmentBodies(state.library, state.settings.createdBodies, state.settings.removedBodies);
}

/** The body types that have parts now; a change that leaves one without parts asks about the folder. */
let knownBodies = new Set();
function syncKnownBodies() {
  knownBodies = new Set(state.library.bodyTypes.keys());
}

/** Body types emptied by moving, reassigning or removing files: ask whether to remove their folders. */
function askAboutEmptied() {
  const emptied = [...knownBodies].filter((b) => !state.library.bodyTypes.has(b));
  syncKnownBodies();
  if (!emptied.length) return;
  const names = emptied.map((b) => `"${b}"`).join(', ');
  $('empty-folder-text').textContent = emptied.length > 1
    ? `${names} have no parts left. Remove the empty folders?`
    : `${names} has no parts left. Remove the empty folder?`;
  $('empty-folder-dialog').onclose = () => {
    if ($('empty-folder-dialog').returnValue === 'remove') removeEmptyBodies(emptied);
    else keepEmptyBodies(emptied);
  };
  if (!$('empty-folder-dialog').open) $('empty-folder-dialog').showModal();
}

/** Empty folders out of the lists: no longer offered for assigning or moving. */
function removeEmptyBodies(bodies) {
  const gone = bodies.filter((b) => !state.library.bodyTypes.has(b));
  if (!gone.length) return;
  state.settings.createdBodies = (state.settings.createdBodies || []).filter((b) => !gone.includes(b));
  state.settings.removedBodies = [...new Set([...(state.settings.removedBodies || []), ...gone])];
  saveSettings();
  if ($('files-dialog').open) renderFiles();
  toast(`Removed the empty folder${gone.length > 1 ? 's' : ''} ${gone.join(', ')}. Creating one with the same name brings it back.`, 6000);
}

/** Kept: the folder stays listed, empty, ready for files. */
function keepEmptyBodies(bodies) {
  const kept = bodies.filter((b) => !state.library.bodyTypes.has(b));
  state.settings.createdBodies = [...new Set([...(state.settings.createdBodies || []), ...kept])];
  saveSettings();
  if ($('files-dialog').open) renderFiles();
}

function afterFilesChanged() {
  askAboutEmptied();
  // Assigned or unassigned files can leave a picture without a colour mask, or give it one.
  for (const v of state.library.variants.values()) applyAutoMask(v);
  thumbCache.clear();
  dropMissingParts();
  refreshLookalikes().catch((e) => console.warn('look-alikes', e));
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
    const layout = a.layout || (a.xp ? 'xp' : null);
    if (file && !assignFile(state.library, packName, path, file.src, a.readAs, a.bodyType) && layout) markLayout(packName, path, layout);
  }
}

/** A walk sheet of another RPG Maker (XP, 2000/2003): its picture is read as an MV/MZ walk sheet. */
function markLayout(packName, path, layout) {
  for (const f of libraryFiles(state.library)) {
    if (f.pack !== packName || f.path !== path) continue;
    const ref = f.role === 'mask' ? f.layer.mask : f.role === 'icon' ? null : f.layer.base;
    if (!ref) continue;
    ref.layout = layout;
    ref.pixels = null;
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
  return el('label', { className: 'lock', title: 'Parts drawn without a colour mask get one made by the generator, so they follow the colours like the generator\'s own parts' },
    [box, ' Recolour all: make every part without a colour mask recolourable']);
}

/**
 * Gives a part's pictures without a colour mask one made by the generator, as saved in
 * settings.autoMasks[variant id] = {count, slots}: the drawn colours split into `count` groups
 * ('auto': as many as it finds), group i recoloured with slots[i] (null: keeps its colours; no
 * slots: the part's own slots, outlines and whites kept). No plan: the made masks go.
 */
function applyAutoMask(variant) {
  makeAutoMask(variant);
  applyPaintedMasks(variant);
}

function makeAutoMask(variant) {
  const plan = autoMaskPlan(variant);
  const unmaskedLayers = variant.layers.filter(unmasked);
  for (const l of unmaskedLayers) if (l.mask?.auto) l.mask = null;
  delete variant.autoGroups;
  delete variant.autoSlots;
  delete variant.iconMask;
  // Recolour all leaves a picture as drawn when the same image of the part has a recolourable
  // one: RPG Maker's eyes are the iris (_m002) plus lashes and whites that keep their colours.
  const recolourable = (l) => l.base && (l.slotId || (l.mask && !l.mask.auto));
  const layers = plan?.automatic
    ? unmaskedLayers.filter((l) => !variant.layers.some((o) => o !== l && o.sheet === l.sheet && recolourable(o)))
    : unmaskedLayers;
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

// ---------- colour masks painted by hand ----------

/** Pictures of a part that can get a painted mask: every image but VX Ace's painted ones. */
const paintable = (variant) => (variant?.layers || []).filter((l) => l.base && !l.base.cells);
const paintKey = (variant, l) => `${variant.id}|${l.sheet}|${l.key}`;

/**
 * Puts the masks painted by hand (settings.maskEdits) on a part's pictures: layer.paint, drawn
 * over the layer's own mask (the file's, the generator's, or the slot its name gives).
 */
function applyPaintedMasks(variant) {
  for (const l of paintable(variant)) {
    const text = state.settings.maskEdits?.[paintKey(variant, l)];
    const edits = text && decodeEdits(text);
    if (!edits) {
      delete l.paint;
      continue;
    }
    l.paint = {
      painted: true, src: null, pixels: null, path: `${l.base.path} (colour mask painted by you)`,
      make: async () => paintedMask(l, edits),
    };
  }
}

/** The mask a picture has without painting: its own, the generator's, or its slot's. */
async function maskUnderPaint(l) {
  const base = await ensureImage(l.base);
  if (l.mask) return ensureImage(l.mask, true);
  const slot = SLOT_BY_ID.get(l.slotId);
  return slot ? slotMask(base, slot.rgb) : null;
}

async function paintedMask(l, edits) {
  const base = await ensureImage(l.base);
  return applyEdits(await maskUnderPaint(l), edits, base.width, base.height);
}

/** The button above a part's colours that opens the mask painter. */
function paintMaskButton() {
  if (state.selectedPart === ALL_COLOURS) return null;
  const variant = state.library.variants.get(state.character.parts[itemOfKey(state.selectedPart)]);
  if (!paintable(variant).length) return null;
  const painted = paintable(variant).some((l) => l.paint);
  const b = el('button', {
    type: 'button', className: 'small-button paint-mask', textContent: painted ? 'Paint the colour mask… (painted)' : 'Paint the colour mask…',
    title: 'Say by hand which colour slot each bit of this part uses: make a mask for a part that has none, or fix one that took the wrong colours',
  });
  b.addEventListener('click', () => openPainter(variant));
  return b;
}

const painter = { variant: null, layer: null, edits: null, under: null, base: null, slot: 'clothing', tool: 'brush', down: false, last: null, history: [] };

async function openPainter(variant) {
  painter.variant = variant;
  const layers = paintable(variant);
  $('paint-title').textContent = `Colour mask of ${variant.part} ${variant.pid}`;
  $('paint-layer').replaceChildren(...layers.map((l, i) => el('option', {
    value: i, textContent: `${SHEET_NAMES[l.sheet] || l.sheet}${layers.filter((o) => o.sheet === l.sheet).length > 1 ? ` · ${l.key}` : ''}${l.paint ? ' (painted)' : ''}`,
  })));
  $('paint-slots').replaceChildren(
    ...[{ id: '', label: 'Keep as drawn', rgb: null }, ...SLOTS].map((s) => {
      const b = el('button', { type: 'button', className: 'paint-slot', title: s.id ? `Paint in the ${s.label} slot` : 'Paint pixels out of the mask: they keep the colours they are drawn in' }, [
        el('span', { className: 'key' + (s.rgb == null ? ' none' : ''), style: s.rgb == null ? '' : `background:#${s.rgb.toString(16).padStart(6, '0')}` }),
        el('span', { textContent: s.label }),
      ]);
      b.dataset.slot = s.id;
      b.addEventListener('click', () => {
        painter.slot = s.id;
        showPaintSlot();
      });
      return b;
    }),
  );
  // Start with the slot the part uses most.
  const first = slotsForEditor().find((s) => !s.painted);
  painter.slot = first?.id || defaultGroupSlots(variant.part, 1)[0] || 'clothing';
  showPaintSlot();
  if (!$('paint-dialog').open) $('paint-dialog').showModal();
  showLivePreview($('paint-dialog'), $('paint-live'));
  await loadPaintLayer(layers[0]);
}

function showPaintSlot() {
  for (const b of $('paint-slots').children) b.classList.toggle('active', b.dataset.slot === painter.slot);
}

async function loadPaintLayer(l) {
  painter.layer = l;
  painter.history = [];
  painter.base = await ensureImage(l.base);
  painter.under = await maskUnderPaint(l);
  const text = state.settings.maskEdits?.[paintKey(painter.variant, l)];
  painter.edits = (text && decodeEdits(text)) || emptyEdits(painter.base.width, painter.base.height);
  const fit = Math.max(1, Math.floor(Math.min(620 / painter.base.width, 440 / painter.base.height)));
  const zoom = [...$('paint-zoom').options].map((o) => Number(o.value)).filter((z) => z <= fit).pop() || 1;
  $('paint-zoom').value = String(zoom);
  drawPainter();
}

/** The picture with its mask laid over it: each slot in its mask colour, as strong as picked. */
function drawPainter() {
  const { base, edits, under } = painter;
  if (!base) return;
  const mask = applyEdits(under, edits, base.width, base.height);
  const strength = Number($('paint-opacity').value) / 100;
  const out = createImage(base.width, base.height);
  for (let i = 0; i < base.data.length; i += 4) {
    const a = base.data[i + 3];
    if (!a) continue;
    const m = mask.data[i + 3] ? strength : 0;
    for (let c = 0; c < 3; c++) out.data[i + c] = base.data[i + c] * (1 - m) + mask.data[i + c] * m;
    out.data[i + 3] = m ? Math.max(a, 255 * m) : a;
  }
  const canvas = $('paint-canvas');
  const zoom = Number($('paint-zoom').value) || 1;
  canvas.width = base.width;
  canvas.height = base.height;
  canvas.style.width = `${base.width * zoom}px`;
  canvas.style.height = `${base.height * zoom}px`;
  canvas.getContext('2d').putImageData(new ImageData(out.data, base.width, base.height), 0, 0);
}

function paintAt(event) {
  const canvas = $('paint-canvas');
  const r = canvas.getBoundingClientRect();
  const x = Math.floor(((event.clientX - r.left) / r.width) * canvas.width);
  const y = Math.floor(((event.clientY - r.top) / r.height) * canvas.height);
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  const code = codeOf(painter.slot);
  if (painter.tool === 'colour') paintColour(painter.edits, painter.base, x, y, code, Number($('paint-tolerance').value));
  else {
    const radius = Number($('paint-size').value) - 1;
    const from = painter.last || { x, y };
    paintLine(painter.edits, from.x, from.y, x, y, radius, code);
    painter.last = { x, y };
  }
  drawPainter();
}

/** Saves the painting of the picture shown and redraws the character with it. */
function savePainting() {
  const { variant, layer, edits } = painter;
  if (!variant || !layer) return;
  const masks = (state.settings.maskEdits ||= {});
  if (hasEdits(edits)) masks[paintKey(variant, layer)] = encodeEdits(edits);
  else delete masks[paintKey(variant, layer)];
  saveSettings();
  applyPaintedMasks(variant);
  delete variant.iconMask;
  afterAutoMask(variant);
}

$('paint-canvas').addEventListener('pointerdown', (e) => {
  if (!painter.edits) return;
  painter.history.push(new Int8Array(painter.edits.codes));
  if (painter.history.length > 30) painter.history.shift();
  painter.down = painter.tool === 'brush';
  painter.last = null;
  $('paint-canvas').setPointerCapture?.(e.pointerId);
  paintAt(e);
  if (!painter.down) savePainting();
});
$('paint-canvas').addEventListener('pointermove', (e) => painter.down && paintAt(e));
$('paint-canvas').addEventListener('pointerup', () => {
  if (!painter.down) return;
  painter.down = false;
  savePainting();
});
for (const input of document.querySelectorAll('input[name="paint-tool"]')) {
  input.addEventListener('change', () => {
    painter.tool = document.querySelector('input[name="paint-tool"]:checked').value;
    $('paint-size-box').hidden = painter.tool !== 'brush';
    $('paint-tolerance-box').hidden = painter.tool !== 'colour';
  });
}
$('paint-layer').addEventListener('change', () => loadPaintLayer(paintable(painter.variant)[Number($('paint-layer').value)]));
$('paint-zoom').addEventListener('change', drawPainter);
$('paint-opacity').addEventListener('input', drawPainter);
$('paint-undo').addEventListener('click', () => {
  const before = painter.history.pop();
  if (!before) return;
  painter.edits.codes.set(before);
  drawPainter();
  savePainting();
});
$('paint-clear').addEventListener('click', () => {
  if (!painter.edits) return;
  painter.history.push(new Int8Array(painter.edits.codes));
  painter.edits = emptyEdits(painter.base.width, painter.base.height);
  drawPainter();
  savePainting();
});
$('paint-dialog').addEventListener('close', () => {
  painter.variant = null;
  painter.layer = null;
  if (state.character) renderSlots();
});

// ---------- removing single parts and files (not the whole folder) ----------

/** Parts removed by you (settings.removedParts) stay out of the lists when their folder opens. */
function applyRemovedParts(packName) {
  for (const v of state.library.variants.values()) {
    const removed = v.pack === packName && state.settings.removedParts?.[v.id];
    if (removed) v.hidden = v.removed = true;
    if (removed === 'deleted') v.deleted = true;
  }
}

/** Asks before doing something that is hard to see undone: resolves true for the ok button. */
function askFirst(title, text, okLabel) {
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  $('confirm-ok').textContent = okLabel;
  $('confirm-dialog').returnValue = '';
  $('confirm-dialog').showModal();
  return new Promise((resolve) => {
    $('confirm-dialog').addEventListener('close', () => resolve($('confirm-dialog').returnValue === 'ok'), { once: true });
  });
}

/** Takes the part the selected item wears out of the generator (only that part), after asking. */
async function removePartByUser() {
  const key = state.selectedPart;
  const variant = state.library.variants.get(state.character.parts[key]);
  if (!variant) return;
  const ok = await askFirst(`Remove ${variant.part} ${variant.pid} from the generator?`,
    `It is taken out of the lists of parts and stops being worn: only this one (${variant.pack}), not its folder, and the file on your computer stays as it is. `
    + 'It stays out when you open the folder again. To bring it back: Files… → Removed. '
    + `(To take off just this extra one, e.g. a second accessory, use "Take off this extra" instead.)`, 'Remove from generator');
  if (!ok) return;
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
// Recategorise a part: its one file straight in the assign dialog, several in Files.
$('reassign-part').addEventListener('click', () => {
  const variant = state.library.variants.get(state.character.parts[itemOfKey(state.selectedPart)]);
  if (!variant) return;
  const files = libraryFiles(state.library).filter((f) => f.variant === variant && f.role === 'image')
    .filter((f, i, all) => all.findIndex((g) => g.path === f.path) === i);
  if (files.length === 1) {
    openAssignDialog(files[0]);
    return;
  }
  // The folder they share, as the search.
  const paths = files.map((f) => f.path);
  let common = paths[0] || '';
  for (const p of paths) while (!p.startsWith(common)) common = common.slice(0, -1);
  $('files-search').value = common || variant.pid;
  openFilesDialog('all');
});

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

for (const id of ['assign-sheet', 'assign-part', 'assign-layer', 'assign-pid', 'assign-mask', 'assign-cell', 'assign-slot', 'assign-body', 'assign-new-body']) {
  $(id).addEventListener('input', updateAssignPreview);
}
$('assign-dialog').addEventListener('close', () => {
  // Pictures asked about one by one: the next one after this form (also when it was cancelled).
  setTimeout(() => !$('assign-dialog').open && !$('cut-dialog').open && askNext(), 0);
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
    const bodyType = $('assign-body').value || newBodyName($('assign-new-body').value, bodyChoices());
    if (!bodyType) return;
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
    const layoutField = f.layout ? { layout: f.layout } : {};
    if (f.layout) markLayout(entry.pack, entry.path, f.layout);
    if ($('assign-remember').checked) remember(entry, { readAs, bodyType, ...layoutField });
    const parsed = parsePartPath(`${bodyType}/${readAs}`);
    if (mask && parsed.sheet && parsed.sheet !== 'FG' && !parsed.isMask) {
      const maskAs = readAs.replace(/\.png$/i, '_c.png');
      const m = unassignFile(state.library, entry.pack, mask);
      if (m && !assignFile(state.library, entry.pack, mask, m.src, maskAs, bodyType)) {
        state.library.readAs.set(`${entry.pack}|${mask}`, { readAs: maskAs, bodyType, how: 'hand' });
        if ($('assign-remember').checked) remember({ pack: entry.pack, path: mask }, { readAs: maskAs, bodyType });
      }
    }
    // Its colour mask (or, for a mask, its image) waiting in the list comes along.
    const counterpart = !mask && assignCounterpart(state.library, entry.pack, entry.path, readAs, bodyType);
    if (counterpart && f.layout) markLayout(entry.pack, counterpart.path, f.layout);
    if (mask && f.layout) markLayout(entry.pack, mask, f.layout);
    if (counterpart && $('assign-remember').checked) remember({ pack: entry.pack, path: counterpart.path }, { readAs: counterpart.readAs, bodyType, ...layoutField });
    const along = mask || counterpart ? (parsed.isMask ? `, with its image ${counterpart.path.split('/').pop()}` : `, with its colour mask${counterpart ? ` ${counterpart.path.split('/').pop()}` : ''}`) : '';
    toast(`${entry.path.split('/').pop()}: ${bodyType} ${f.part}${along}.`);
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

/**
 * The files to assign, without the colour masks that go with an image in the list (assigning the
 * image assigns its mask), unless "Show their colour masks" is ticked.
 */
function toAssign() {
  const lib = state.library;
  return $('files-show-masks').checked ? lib.unrecognized : lib.unrecognized.filter((u) => !isPairedMask(lib, u));
}

function filesFor(tab) {
  const lib = state.library;
  if (tab === 'queue') return toAssign();
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
    assign.addEventListener('click', () => (loaded ? openAssignDialog(file) : assignOneByOne(file)));
    buttons.push(assign);
    if (file.role !== 'mask' && file.role !== 'icon') {
      const cut = el('button', { type: 'button', className: 'small-button', textContent: 'Cut…',
        title: 'Cut a finished sheet into pieces: its characters, rows, columns or single frames. Each piece is a file to assign, e.g. a dressed character as a body to put a cloak on' });
      cut.addEventListener('click', () => openCutDialog(file));
      buttons.push(cut);
    }
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

const TAB_LABELS = { packs: 'Packs', queue: 'To assign', odd: 'Odd names', hand: 'Assigned by you', all: 'All files', removed: 'Removed', folders: 'Folders' };
const TAB_NOTES = {
  packs: 'The packs you opened: folders, dropped files and zips. Take one out, or forget them all. The files on your computer are never touched.',
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
  if (filesTab === 'packs') {
    $('files-start').hidden = true;
    $('files-more').hidden = true;
    $('files-note').textContent = TAB_NOTES.packs;
    const packs = state.library.packs.filter((p) => !query || p.name.toLowerCase().includes(query));
    const forgetAll = el('button', { type: 'button', className: 'small-button', textContent: 'Forget all',
      title: 'Every pack, what you assigned or removed in them, your Gallery, sets, randomize rules and sheet templates. Undo brings the last four back' });
    forgetAll.addEventListener('click', () => forgetEverything());
    $('files-list').replaceChildren(
      ...packs.map((p) => {
        const remove = el('button', { type: 'button', className: 'small-button', textContent: 'Take out', title: p.folderKey ? 'Take it out and forget the folder (and what you assigned in it)' : 'Take its parts out' });
        remove.addEventListener('click', async () => {
          if (p.folderKey) await forgetAndUnload(p.folderKey);
          else {
            forgetPackSettings(p.name);
            unloadPack(p.name);
          }
          renderRecentFolders();
          renderFiles();
          toast(`Took "${p.name}" out.`);
        });
        return el('div', { className: 'file-row' }, [el('span', { textContent: `${p.name} (${p.fileCount} file${p.fileCount === 1 ? '' : 's'})${p.folderKey ? ' · remembered folder' : ''}` }), remove]);
      }),
      ...(state.library.packs.length ? [forgetAll] : [el('p', { className: 'muted', textContent: 'No packs open.' })]),
    );
    return;
  }
  if (filesTab === 'folders') {
    $('files-start').hidden = true;
    $('files-more').hidden = true;
    $('files-note').textContent = TAB_NOTES.folders;
    const rows = folderList().filter((d) => !query || `${d.pack} ${d.dir}`.toLowerCase().includes(query));
    const bodies = bodyChoices();
    const empty = bodies.filter((b) => state.settings.createdBodies?.includes(b) && !state.library.bodyTypes.has(b) && b.toLowerCase().includes(query));
    const unused = bodies.filter((b) => !state.library.bodyTypes.has(b));
    $('files-list').replaceChildren(createBodyRow(bodies), removeBodyRow(unused), bodyTypeRow(bodies), ...empty.map(emptyBodyRow), ...rows.map((d) => folderRow(d, bodies)));
    if (!rows.length && !empty.length) $('files-list').append(el('p', { className: 'muted', textContent: 'No folder matches.' }));
    return;
  }
  const files = filesFor(filesTab).filter(matches);
  const paired = filesTab === 'queue' ? state.library.unrecognized.filter((u) => isPairedMask(state.library, u)).length : 0;
  $('files-masks').hidden = !paired;
  $('files-masks-label').textContent = ` Show the colour masks that go with an image (${paired}): assigning the image assigns its mask`;
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
    const fileKey = `${f.pack}|${f.path}`;
    const assigned = lib.readAs.get(fileKey)?.how === 'hand' || state.settings.assignments?.[fileKey]?.readAs || state.settings.organizedFiles?.[fileKey];
    const dir = loaded && assigned ? f.variant.bodyType : dirOf(f.path);
    const key = `${f.pack}|${dir}`;
    if (!byDir.has(key)) byDir.set(key, { pack: f.pack, dir, files: new Map(), loaded: [], bodyTypes: new Set() });
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
  return moveFiles(d.loaded, bodyType, d.dir);
}

/**
 * Consolidates a whole body type into another: every part of `from`, in every folder (TV, SV, TVD,
 * Face, Variation) of every opened generator folder, goes to `to`.
 */
function moveBodyType(from, to) {
  if (from === to) return;
  const files = libraryFiles(state.library).filter((f) => f.variant.bodyType === from);
  return moveFiles([...new Map(files.map((f) => [`${f.pack}|${f.path}`, f])).values()], to, `the ${from} parts`);
}

/**
 * Moves loaded files to another body type, then merges what turned out to be there already: a
 * moved part made of the same files as one of the body type is hidden as a duplicate.
 */
async function moveFiles(loaded, bodyType, what) {
  const lib = state.library;
  if (!bodyType) return;
  const eligible = loaded.filter((f) => !f.layer?.vxace);
  const files = eligible.filter((f) => f.variant.bodyType !== bodyType);
  // Already assigned to the right type: only change the displayed folder, keeping the original variant and ID.
  for (const f of eligible.filter((f) => f.variant.bodyType === bodyType)) {
    (state.settings.organizedFiles ||= {})[`${f.pack}|${f.path}`] = true;
  }
  // Masks first out and last in, so they go with their images.
  const order = [...files.filter((f) => f.role === 'mask'), ...files.filter((f) => f.role !== 'mask')];
  const plan = order.map((f) => ({ f, readAs: readAsName(f) })).filter(({ readAs }) => parsePartPath(`${bodyType}/${readAs}`));
  for (const { f } of plan) unassignFile(lib, f.pack, f.path);
  let moved = eligible.length - files.length;
  for (const { f, readAs } of [...plan.filter((p) => p.f.role !== 'mask'), ...plan.filter((p) => p.f.role === 'mask')]) {
    if (assignFile(lib, f.pack, f.path, f.src, readAs, bodyType)) continue;
    (state.settings.assignments ||= {})[`${f.pack}|${f.path}`] = { readAs, bodyType };
    moved++;
  }
  if (state.character && !lib.bodyTypes.has(state.character.bodyType) && state.character.bodyType !== ALL_BODIES && lib.bodyTypes.has(bodyType)) {
    state.character.bodyType = bodyType;
  }
  saveSettings();
  afterFilesChanged();
  const merged = await withBusy('Looking for duplicates', () => findSameFiles(null, true));
  toast(`Moved ${moved} file${moved === 1 ? '' : 's'} of ${what} to ${bodyType}.${merged ? ` ${merged} of the moved parts were there already (the same files) and are hidden as duplicates.` : ''} Near copies are listed in "Look-alikes…".`, 10000);
}

/** Removes every file of a folder (they go to "Removed"); Undo puts them back. */
function removeFolder(d) {
  const removed = [];
  const lib = state.library;
  const assignments = state.settings.assignments ||= {};
  const files = [...d.files.values()].sort((a, b) => Number(b.role === 'mask') - Number(a.role === 'mask'));
  for (const f of files) {
    const key = `${f.pack}|${f.path}`;
    const reading = lib.readAs.get(key);
    if (!removeFile(lib, f.pack, f.path)) continue;
    removed.push({ f, key, reading, saved: assignments[key] });
    assignments[key] = { removed: true };
  }
  saveSettings();
  afterFilesChanged();
  const undo = () => {
    // Restore images before masks, using the reading the file had in its generator folder.
    const restoreOrder = [...removed.filter(({ f }) => f.role !== 'mask'), ...removed.filter(({ f }) => f.role === 'mask')];
    for (const { f, key, reading, saved } of restoreOrder) {
      if (reading?.readAs) {
        const entry = restoreToAssign(lib, f.pack, f.path);
        if (!entry || assignFile(lib, f.pack, f.path, entry.src, reading.readAs, reading.bodyType)) continue;
        lib.readAs.set(key, reading);
      } else if (!restoreFile(lib, f.pack, f.path)) continue;
      if (saved) assignments[key] = saved;
      else delete assignments[key];
    }
    saveSettings();
    afterFilesChanged();
  };
  toast(`Removed ${removed.length} file${removed.length === 1 ? '' : 's'} of ${d.dir}. They're listed under "Removed".`, 10000, { label: 'Undo', run: undo });
}

const bodyOptions = (names) => names.map((value) => el('option', { value, textContent: value }));

function emptyBodyRow(body) {
  const remove = el('button', { type: 'button', className: 'small-button', textContent: 'Remove empty folder' });
  remove.addEventListener('click', () => removeEmptyBodies([body]));
  return el('div', { className: 'folder-row' }, [
    el('div', {}, [el('b', { textContent: body }), el('span', { className: 'muted small', textContent: 'No files assigned yet' })]), remove,
  ]);
}

function createBodyRow(bodies) {
  const name = el('input', { type: 'text', placeholder: 'New folder name', ariaLabel: 'New folder name' });
  const create = el('button', { type: 'button', className: 'small-button', textContent: 'Create folder' });
  const add = () => {
    const value = newBodyName(name.value, bodies);
    if (!value) return toast('Enter a body type name without path separators or sheet folder names.');
    if (bodies.includes(value)) return toast(`The folder "${value}" already exists.`);
    (state.settings.createdBodies ||= []).push(value);
    state.settings.removedBodies = (state.settings.removedBodies || []).filter((b) => b !== value);
    saveSettings();
    renderFiles();
    toast(`Created "${value}". It is available for file assignments and folder moves.`);
  };
  create.addEventListener('click', add);
  name.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); add(); }
  });
  return el('div', { className: 'folder-row folder-new' }, [
    el('b', { textContent: 'New body type folder' }), el('div', { className: 'file-buttons' }, [name, create]),
  ]);
}

/** Next to "Create folder": removes an empty body type folder (one with parts is emptied first). */
function removeBodyRow(unused) {
  const pick = el('select', { title: 'Empty folder to remove' }, unused.length
    ? [el('option', { value: '', textContent: 'Choose empty folder…' }), ...bodyOptions(unused)]
    : [el('option', { value: '', textContent: 'No empty folders' })]);
  const remove = el('button', { type: 'button', className: 'small-button', textContent: 'Remove folder', disabled: true,
    title: 'Only empty folders can be removed: move a folder\'s parts elsewhere (or remove them) first' });
  pick.addEventListener('change', () => { remove.disabled = !pick.value; });
  remove.addEventListener('click', () => removeEmptyBodies([pick.value]));
  return el('div', { className: 'folder-row folder-new' }, [
    el('div', {}, [el('b', { textContent: 'Remove a body type folder' }), el('span', { className: 'muted small', textContent: 'Empty folders only; one with parts is emptied by moving its parts first' })]),
    el('div', { className: 'file-buttons' }, [pick, remove]),
  ]);
}

/** Top of the Folders tab: a whole body type into another, in every folder at once. */
function bodyTypeRow(destinations) {
  const bodies = destinations.filter((b) => state.library.bodyTypes.has(b));
  const count = (b) => [...state.library.variants.values()].filter((v) => v.bodyType === b && !v.removed).length;
  const from = el('select', { className: 'body-from', title: 'Body type to move' }, [el('option', { value: '', textContent: 'Choose source…' }),
    ...bodies.map((b) => el('option', { value: b, textContent: `${b} (${count(b)} parts)` }))]);
  const to = el('select', { className: 'body-to', title: 'Body type to move them to' }, [el('option', { value: '', textContent: 'Choose folder…' }), ...bodyOptions(destinations)]);

  const move = el('button', { type: 'button', className: 'small-button primary', textContent: 'Move every part', disabled: true });
  const update = () => { move.disabled = !from.value || !to.value || from.value === to.value; };
  from.addEventListener('change', update);
  to.addEventListener('change', update);
  move.addEventListener('click', () => moveBodyType(from.value, to.value));
  return el('div', { className: 'folder-row body-row' }, [
    el('div', {}, [el('b', { textContent: 'Body types' }), el('span', { className: 'muted small', textContent: '  every folder of every opened generator folder at once; parts that are there already are merged' })]),
    el('div', { className: 'file-buttons' }, [move, el('span', { className: 'small', textContent: 'of' }), from, el('span', { className: 'small', textContent: 'to' }), to]),
  ]);
}

/**
 * A folder of files still to assign (an asset pack sorted by folders, not named the RPG Maker
 * way): assigns all of them at once as one part for one body type. The image of each comes from
 * its size; part numbers from the file names. Remembered like assigning one by one.
 */
async function assignFolder(d, part, bodyType) {
  const lib = state.library;
  const waiting = [...d.files.values()].filter((f) => !f.variant && lib.unrecognized.includes(f));
  // Images first, then the colour masks ("_c"), so these join their image.
  waiting.sort((a, b) => Number(/_c\.png$/i.test(a.path)) - Number(/_c\.png$/i.test(b.path)));
  const slot = SLOT_BY_ID.get(slotForPart(part)?.slotId)?.m || null;
  let done = 0;
  const failed = [];
  await withBusy(`Assigning ${d.dir}`, async () => {
    for (const [i, f] of waiting.entries()) {
      if (i % 20 === 0) {
        busyStep(`Assigning ${d.dir}`, i, waiting.length);
        await nextFrame();
      }
      const size = await pngSize(f.src).catch(() => null);
      const stem = f.path.split('/').pop().replace(/\.png$/i, '');
      const mask = /_c$/i.test(stem);
      const guessed = size ? guessSheet(size.w, size.h, f.path.split('/').pop()).sheet : 'TV';
      const layout = WALK_LAYOUTS[guessed]?.layout || null;
      const sheet = layout ? 'TV' : guessed;
      const readAs = buildPartName({ sheet, part, pid: stem.replace(/_c$/i, ''), mask, cell: 'c1', slotM: sheet === 'FG' ? slot : null });
      if (!parsePartPath(`${bodyType}/${readAs}`)) {
        failed.push(f.path);
        continue;
      }
      const file = unassignFile(lib, f.pack, f.path) || f;
      const error = assignFile(lib, f.pack, f.path, file.src, readAs, bodyType);
      if (error) failed.push(f.path);
      else {
        if (layout) markLayout(f.pack, f.path, layout);
        remember(f, { readAs, bodyType, ...(layout ? { layout } : {}) });
        done++;
      }
    }
  });
  afterFilesChanged();
  toast(`${d.dir}: ${done} file${done === 1 ? '' : 's'} assigned as ${bodyType} ${part}${failed.length ? `; ${failed.length} could not be (still in "To assign")` : ''}. Reassign one by one in "To assign" or "All files" if one is off.`, 9000);
}

function folderRow(d, bodies) {
  const target = el('select', { title: 'Body type to move the parts to' }, [el('option', { value: '', textContent: 'Choose folder…' }), ...bodyOptions(bodies)]);
  const now = [...d.bodyTypes].sort();
  target.value = suggestedBody(d.dir, bodies);
  const move = el('button', { type: 'button', className: 'small-button', textContent: 'Move its parts to' });
  const movable = d.loaded.some((f) => !f.layer?.vxace);
  const update = () => { move.disabled = !movable || !target.value || (d.dir === target.value && now.length === 1 && now[0] === target.value); };
  target.addEventListener('change', update);
  update();
  move.addEventListener('click', () => moveFolder(d, target.value));
  const remove = el('button', { type: 'button', className: 'small-button', textContent: 'Remove folder', title: 'Take every file of this folder out of the generator. Put them back under "Removed"' });
  remove.addEventListener('click', () => removeFolder(d));
  const what = [
    `${d.files.size} file${d.files.size === 1 ? '' : 's'}`,
    now.length ? `parts for ${now.join(', ')}` : '',
    d.files.size > d.loaded.length ? `${d.files.size - d.loaded.length} to assign` : '',
  ].filter(Boolean).join(' · ');
  const waiting = [...d.files.values()].filter((f) => !f.variant).length;
  return el('div', { className: 'folder-row' }, [
    el('div', {}, [el('b', { textContent: d.dir }), el('span', { className: 'muted small', textContent: `  ${d.pack} · ${what}` })]),
    el('div', { className: 'file-buttons' }, [move, target, remove]),
    ...(waiting ? [folderAssignRow(d, waiting, bodies)] : []),
  ]);
}

/** Under a folder with files to assign: "Assign its N files as [part] for [body type]". */
function folderAssignRow(d, waiting, bodies) {
  const names = [...new Set([...PART_ORDER, ...partNames(state.library, state.character?.bodyType)])];
  const guess = partsInPath(`${d.dir}/`, names)[0] || '';
  const part = el('select', { className: 'folder-part', title: 'The part every file of this folder is' }, [
    el('option', { value: '', textContent: 'Choose part…' }), ...names.map((p) => el('option', { value: p, textContent: p })),
  ]);
  part.value = guess;
  const body = el('select', { className: 'folder-body', title: 'The body type they are for' }, bodyOptions(bodies));
  body.value = suggestedBody(d.dir, bodies, { words: true }) || state.character?.bodyType || bodies[0] || 'Male';
  const go = el('button', { type: 'button', className: 'small-button primary', textContent: `Assign its ${waiting} file${waiting === 1 ? '' : 's'}` });
  const update = () => { go.disabled = !part.value || !body.value; };
  part.addEventListener('change', update);
  body.addEventListener('change', update);
  update();
  go.addEventListener('click', () => assignFolder(d, part.value, body.value));
  return el('div', { className: 'file-buttons folder-assign' }, [
    go, el('span', { className: 'small', textContent: 'as' }), part, el('span', { className: 'small', textContent: 'for' }), body,
    el('span', { className: 'muted small', textContent: guess ? `(suggested from the folder name)` : '' }),
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
  const queue = toAssign();
  if (queue.length) openAssignDialog(queue[0], queue.slice(1));
});
$('files-show-masks').addEventListener('change', () => renderFiles());

// ---------- cutting finished sheets into pieces ----------

let cutting = null; // {file, image, cols, rows, cells: Set of "col,row" kept}

async function openCutDialog(file) {
  file.ref ||= { src: file.src, pixels: null };
  const image = await ensureImage(file.ref).catch(() => null);
  if (!image) {
    toast('Could not read that picture.');
    return;
  }
  const name = file.path.split('/').pop();
  const saved = state.settings.cuts?.[`${file.pack}|${file.path}`];
  const [cols, rows] = saved ? [saved.cols, saved.rows] : guessGrid(image.width, image.height, name);
  cutting = { file, image, cols, rows, cells: null };
  setCutGrid(cols, rows, saved?.cells);
  $('cut-title').textContent = `Cut ${name} (${image.width} x ${image.height})`;
  $('cut-presets').replaceChildren(...CUT_PRESETS.map(([c, r, label]) => {
    const b = el('button', { type: 'button', className: 'small-button', textContent: label });
    b.addEventListener('click', () => setCutGrid(c, r));
    return b;
  }));
  $('cut-dialog').returnValue = '';
  $('cut-dialog').showModal();
}

/** A new grid: every cell with something drawn in it is kept (or the cells given). */
function setCutGrid(cols, rows, cells = null) {
  const { image } = cutting;
  cutting.cols = Math.max(1, Math.min(64, cols | 0));
  cutting.rows = Math.max(1, Math.min(64, rows | 0));
  $('cut-cols').value = cutting.cols;
  $('cut-rows').value = cutting.rows;
  cutting.cells = new Set(cells || []);
  if (!cells) {
    for (let row = 0; row < cutting.rows; row++) {
      for (let col = 0; col < cutting.cols; col++) {
        if (hasPixels(cropImage(image, cellRect(image.width, image.height, cutting.cols, cutting.rows, col, row)))) cutting.cells.add(`${col},${row}`);
      }
    }
  }
  drawCut();
}

function drawCut() {
  const { image, cols, rows, cells } = cutting;
  const canvas = $('cut-canvas');
  const zoom = Math.max(1, Math.min(4, Math.floor(560 / Math.max(image.width, image.height)) || 1));
  canvas.width = image.width * zoom;
  canvas.height = image.height * zoom;
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.drawImage(toCanvas(image), 0, 0, canvas.width, canvas.height);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const r = cellRect(image.width, image.height, cols, rows, col, row);
      if (!cells.has(`${col},${row}`)) {
        g.fillStyle = 'rgb(0 0 0 / .6)';
        g.fillRect(r.x * zoom, r.y * zoom, r.w * zoom, r.h * zoom);
      }
      g.strokeStyle = '#a78bfa';
      g.lineWidth = 1;
      g.strokeRect(r.x * zoom + 0.5, r.y * zoom + 0.5, r.w * zoom - 1, r.h * zoom - 1);
    }
  }
  const n = cells.size;
  $('cut-ok').textContent = `Cut out ${n} piece${n === 1 ? '' : 's'}`;
  $('cut-ok').disabled = !n;
  const one = cellRect(image.width, image.height, cols, rows, 0, 0);
  $('cut-size').textContent = `Each piece ${one.w} x ${one.h}. Click pieces to leave them out or take them in.`;
}

$('cut-canvas').addEventListener('click', (e) => {
  if (!cutting) return;
  const r = $('cut-canvas').getBoundingClientRect();
  const col = Math.min(cutting.cols - 1, Math.floor(((e.clientX - r.left) / r.width) * cutting.cols));
  const row = Math.min(cutting.rows - 1, Math.floor(((e.clientY - r.top) / r.height) * cutting.rows));
  const key = `${col},${row}`;
  if (cutting.cells.has(key)) cutting.cells.delete(key);
  else cutting.cells.add(key);
  drawCut();
});
for (const id of ['cut-cols', 'cut-rows']) $(id).addEventListener('change', () => setCutGrid(Number($('cut-cols').value), Number($('cut-rows').value)));
$('cut-all').addEventListener('click', () => setCutGrid(cutting.cols, cutting.rows, Array.from({ length: cutting.cols * cutting.rows }, (_, i) => `${i % cutting.cols},${Math.floor(i / cutting.cols)}`)));
$('cut-dialog').addEventListener('close', async () => {
  const job = cutting;
  cutting = null;
  const asked = cutFromAsk;
  cutFromAsk = false;
  if ($('cut-dialog').returnValue !== 'ok' || !job?.cells.size) {
    if (asked) askNext();
    return;
  }
  const { file, cols, rows } = job;
  const cut = { cols, rows, cells: [...job.cells] };
  (state.settings.cuts ||= {})[`${file.pack}|${file.path}`] = cut;
  saveSettings();
  const added = await cutPieces(file.pack, file.path, file.src, cut, job.image);
  afterFilesChanged();
  // Cut while asking how to use it: ask about its pieces next.
  if (asked && added) {
    const stem = file.path.replace(/\.png$/i, '');
    useQueue = [...state.library.unrecognized.filter((u) => u.pack === file.pack && u.path.startsWith(`${stem} (`)), ...useQueue];
    askNext();
    return;
  }
  filesTab = 'queue';
  if ($('files-dialog').open) renderFiles();
  toast(added ? `${added} piece${added === 1 ? '' : 's'} of ${file.path.split('/').pop()} added to "To assign". Assign one, e.g. as the Body (walk) of a body type, then put parts like a cloak over it.`
    : 'Those pieces are assigned as parts already (Files → Assigned): unassign them to cut them again.', 12000);
});

/**
 * Cuts a picture into the "To assign" list: one file per kept cell. Pieces already read (or
 * waiting) are left as they are. Returns how many were added.
 */
async function cutPieces(packName, path, src, cut, image = null) {
  const lib = state.library;
  image ||= await decodeImage(src);
  // Pieces assigned as parts stay. Removed pieces, and ones still to assign, of an earlier cut
  // (e.g. into frames: "col 1" is a frame there, a character now) are replaced by the new ones.
  const assigned = new Set(libraryFiles(lib).filter((f) => f.pack === packName).map((f) => f.path));
  let added = 0;
  for (const cell of cut.cells) {
    const [col, row] = cell.split(',').map(Number);
    if (col >= cut.cols || row >= cut.rows) continue;
    const piecePath = cutPath(path, cut.cols, cut.rows, col, row);
    if (assigned.has(piecePath)) continue;
    const stale = (f) => !(f.pack === packName && f.path === piecePath);
    lib.unrecognized = lib.unrecognized.filter(stale);
    lib.removed = lib.removed.filter(stale);
    const piece = cropImage(image, cellRect(image.width, image.height, cut.cols, cut.rows, col, row));
    const canvas = new OffscreenCanvas(piece.width, piece.height);
    canvas.getContext('2d').putImageData(new ImageData(piece.data, piece.width, piece.height), 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    lib.unrecognized.push({ pack: packName, path: piecePath, src: blob, reason: `Cut from ${path.split('/').pop()}` });
    added++;
  }
  return added;
}

/** Cuts made before are made again when their folder is opened (before remembered assignments). */
async function applyCuts(packName, entries) {
  for (const [key, cut] of Object.entries(state.settings.cuts || {})) {
    if (!key.startsWith(`${packName}|`)) continue;
    const path = key.slice(packName.length + 1);
    const entry = entries.find((e) => e.path === path);
    if (entry) await cutPieces(packName, path, entry.src, cut).catch(() => 0);
  }
}

// ---------- look-alikes ----------

/** Asks whether to open a folder whose files match one already open. Resolves true to open it. */
/** "Open anyway" or "Skip it", asked once for a pair of folders; the answer stays until one is forgotten. */
async function openAgainAnswer(packName, twin) {
  const key = `${packName}|${twin.pack.name}`;
  const saved = state.settings.openAgain?.[key];
  if (saved !== undefined) return saved;
  const open = await askOpenAgain(packName, twin);
  (state.settings.openAgain ||= {})[key] = open;
  saveSettings();
  return open;
}

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
  const asked = (state.settings.lookalikesAsked ||= {});
  const undecided = found.filter((f) => !f.result.identical && f.result.ratio <= LOOKALIKE_RATIO && !choices[f.variant.id] && !asked[f.variant.id]);
  // Shown once: closing the list keeps them as they are, and it doesn't open again after a reload.
  for (const f of undecided) asked[f.variant.id] = true;
  if (undecided.length) saveSettings();
  if (autoHidden) renderEditor();
  if (undecided.length && !document.querySelector('dialog[open]')) openAlikesDialog();
  else if (undecided.length || autoHidden) {
    const parts = [];
    if (autoHidden) parts.push(`Hid ${autoHidden} exact duplicate${autoHidden > 1 ? 's' : ''}.`);
    if (undecided.length) parts.push(`${undecided.length} near copies to look at.`);
    toast(`${parts.join(' ')} See "Look-alikes…".`, 8000);
  }
}

/**
 * After files are removed, reassigned or moved: the look-alikes follow the parts as they are now.
 * A part that is gone (its files reassigned) leaves the list instead of showing an empty picture;
 * the others are compared again, as their files may have changed.
 */
async function refreshLookalikes() {
  const lib = state.library;
  const now = [];
  for (const f of state.lookalikes) {
    const variant = lib.variants.get(f.variant.id);
    const other = lib.variants.get(f.other.id);
    if (!variant?.layers.length || !other?.layers.length) continue;
    now.push({ ...f, variant, other });
  }
  state.lookalikes = now;
  const compare = now.filter((f) => !f.result.sameFiles);
  if (compare.length) {
    await ensureLayers(compare.flatMap(pairLayers));
    for (const f of compare) f.result = compareVariants(f.variant, f.other);
  }
  updateAlikesButton();
  if ($('alike-dialog').open) renderAlikes();
}

function updateAlikesButton() {
  const listed = state.lookalikes.filter((f) => f.result.identical || f.result.ratio <= LOOKALIKE_RATIO);
  $('open-alikes').hidden = !state.lookalikes.length;
  $('open-alikes').textContent = listed.length ? `Look-alikes… (${listed.length})` : 'Look-alikes…';
  alikeCount = listed.length;
  setFilesLabel();
}

function putPixels(canvas, pixels) {
  if (!pixels) return;
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
}

/**
 * A part drawn from its own files only, as look-alikes compare it: an alternate ("p17 (alt)")
 * is otherwise drawn over the part it borrows the rest from.
 */
function ownPicture(variant, sheets) {
  if (!variant.alt) return partThumbnail(variant.part, variant, sheets, true);
  const own = { ...variant, alt: false, id: `${variant.id}|own` };
  const library = { ...state.library, variants: new Map([[own.id, own]]) };
  return partThumbnail(variant.part, own, sheets, true, library);
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
  Promise.all([ownPicture(other, sheets), ownPicture(variant, sheets)]).then(([pa, pb]) => {
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

/** The words a look-alike is found by: its part, body type, name and folder, and the other's. */
function alikeText({ variant, other }) {
  return [variant.part, variant.bodyType, variant.pid, variant.pack, other.bodyType, other.pid, other.pack].join(' ').toLowerCase();
}

/** The look-alikes as listed now: ticked boxes, then the search and the chosen part. */
function shownAlikes() {
  const all = $('alike-all').checked;
  const hideDecided = $('alike-hide-decided').checked;
  const listed = state.lookalikes.filter((f) => all || f.result.identical || f.result.ratio <= LOOKALIKE_RATIO || f.variant.hidden);
  const undecided = hideDecided ? listed.filter((f) => !alikeDecided(f) || decidedNow.has(f.variant.id)) : listed;
  const part = $('alike-part').value;
  const words = $('alike-search').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = undecided.filter((f) => (!part || f.variant.part === part) && words.every((w) => alikeText(f).includes(w)));
  return { listed, undecided, shown };
}

function renderAlikes() {
  const { listed, undecided, shown } = shownAlikes();
  $('alike-decided-count').textContent = listed.filter(alikeDecided).length;
  // Parts to choose from, with how many look-alikes each has.
  const counts = new Map();
  for (const f of undecided) counts.set(f.variant.part, (counts.get(f.variant.part) || 0) + 1);
  const part = $('alike-part').value;
  $('alike-part').replaceChildren(el('option', { value: '', textContent: `Every part (${undecided.length})` }),
    ...[...new Set([...PART_ORDER, ...counts.keys()])].filter((p) => counts.has(p) || p === part).map((p) => el('option', { value: p, textContent: `${p} (${counts.get(p) || 0})` })));
  $('alike-part').value = part;
  $('alike-count').textContent = shown.length < undecided.length ? `Showing ${shown.length} of ${undecided.length}` : '';
  const empty = shown.length < undecided.length || undecided.length
    ? 'No look-alike matches the search or part.'
    : $('alike-hide-decided').checked && listed.length
      ? 'Every look-alike is decided. Untick "Hide the ones already decided" to see them.'
      : 'No copy looks like another part. Tick the box above to compare them anyway.';
  $('alike-list').replaceChildren(...(shown.length ? shown.map(alikeCard) : [el('p', { className: 'muted', textContent: empty })]));
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
$('alike-search').addEventListener('input', renderAlikes);
$('alike-part').addEventListener('change', renderAlikes);
$('alike-find').addEventListener('click', () => withBusy('Looking for duplicates', () => findSameFiles(null, false)));
// Hide all listed copies: every copy in the list (as filtered now) is hidden, remembered per part.
$('alike-hide-all').addEventListener('click', () => {
  let hidden = 0;
  for (const f of shownAlikes().shown) {
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

/** The gallery character being edited (Edit on its card): saving updates it instead of adding one. */
let editingGalleryId = null;

/** Keeps a character in the gallery. Saving again under the same name updates it. */
function addToGallery(text, name, kind) {
  const entries = galleryEntries();
  const editing = kind === 'saved' && editingGalleryId ? entries.findIndex((e) => e.id === editingGalleryId) : -1;
  const same = editing >= 0 ? editing : entries.findIndex((e) => e.text === text || (kind === 'saved' && e.kind === 'saved' && e.name === name));
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

// ---------- several characters in one picture (multi.js) ----------

/** Characters that can go in the picture: the current one, the Gallery's, the folders' presets. */
function multiChoices() {
  const presets = [...state.library.packs.values()].flatMap((p) => (p.presets || []).map((x) => ({ ...x, pack: p.name })));
  return [
    { key: 'current', label: `This character (${state.character?.name || 'unnamed'})` },
    ...galleryEntries().map((e) => ({ key: `g:${e.id}`, label: `Gallery: ${e.name}`, text: e.text, fileName: e.fileName || '' })),
    ...presets.map((x, i) => ({ key: `p:${i}`, label: `${x.pack}: ${x.name}`, text: x.text, fileName: x.fileName })),
  ];
}

/** The walk sheet and face of a character, drawn as the current sheets are. */
async function characterSheets(choice) {
  let character = state.character;
  let customGradients = [];
  if (choice.key !== 'current') {
    ({ character, customGradients } = deserializeCharacter(choice.text, state.library, allGradients(), choice.fileName));
    applyDefaults(character, state.library);
  }
  await ensureVariants(variantsToDecode(character, state.library));
  const byId = new Map([...gradientsById(), ...customGradients.map((g) => [g.id, g])]);
  const faceTemplate = state.settings.templates?.FG;
  // One face each, also when the Portrait sheet is a face set.
  const faceSettings = { ...state.settings, templates: { ...(state.settings.templates || {}), FG: faceTemplate && { fw: faceTemplate.fw, fh: faceTemplate.fh } } };
  const face = sheetOption('FG').crop ? croppedPortrait(sheetOption('FG').crop, faceTemplate && { fw: faceTemplate.fw, fh: faceTemplate.fh }, byId, character).image
    : composeSheet('FG', character, state.library, byId, faceSettings).image;
  const walk = composeSheet('TV', character, state.library, byId, state.settings);
  return { face, walk: walk.image, frame: walk.image ? frameOf('TV', walk.image, walk.frame) : null };
}

function renderMultiSlots() {
  const choices = multiChoices();
  const before = [...$('multi-slots').querySelectorAll('select')].map((s) => s.value);
  $('multi-slots').replaceChildren(...[...Array(MULTI_COLS * MULTI_ROWS).keys()].map((i) => {
    const select = el('select', { title: `Place ${i + 1} (row ${Math.floor(i / MULTI_COLS) + 1}, column ${(i % MULTI_COLS) + 1})` }, [
      el('option', { value: '', textContent: `${i + 1}: empty` }),
      ...choices.map((c) => el('option', { value: c.key, textContent: `${i + 1}: ${c.label}` })),
    ]);
    const was = before[i] ?? (i === 0 ? 'current' : '');
    select.value = choices.some((c) => c.key === was) ? was : '';
    select.addEventListener('change', drawMulti);
    return select;
  }));
}

let multiToken = 0;
/** Draws the pictures: { walk, face } (null when nothing is picked). */
async function makeMulti() {
  const choices = new Map(multiChoices().map((c) => [c.key, c]));
  const picked = [...$('multi-slots').querySelectorAll('select')].map((s) => choices.get(s.value) || null);
  const drawn = await Promise.all(picked.map((c) => (c ? characterSheets(c).catch((e) => (console.error(e), null)) : null)));
  const grid = drawn.find((d) => d?.frame)?.frame;
  return {
    walk: packCharacters(drawn.map((d) => d?.walk || null), grid ? { cols: grid.cols, rows: grid.rows } : { cols: 3, rows: 4 }),
    face: packCharacters(drawn.map((d) => d?.face || null), null),
  };
}

async function drawMulti() {
  const token = ++multiToken;
  const { walk, face } = await makeMulti();
  if (token !== multiToken) return;
  const figure = (image, caption) => el('figure', {}, [toCanvas(image), el('figcaption', { className: 'muted small', textContent: `${caption} (${image.width} x ${image.height})` })]);
  $('multi-preview').replaceChildren(...(walk ? [figure(walk, 'Walk sheets')] : []), ...(face ? [figure(face, 'Faces')] : []));
}

$('open-multi').addEventListener('click', () => {
  renderMultiSlots();
  $('multi-dialog').showModal();
  drawMulti();
});
$('multi-save').addEventListener('click', async () => {
  const name = safeFileName($('multi-name').value.trim() || 'Actors');
  const { walk, face } = await makeMulti();
  if (!walk && !face) {
    toast('Pick at least one character first.');
    return;
  }
  // No "$": RPG Maker reads the picture as 8 characters. "!" if you chose no lift for walk sheets.
  if ($('multi-walk').checked && walk) await downloadImage(walk, `${state.settings.noShift ? '!' : ''}${name}.png`);
  if ($('multi-face').checked && face) await downloadImage(face, `${name}_face.png`);
  toast(`Saved ${name}: put the walk sheets in img/characters and the faces in img/faces (named ${name}.png there).`, 7000);
});

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
  // Clothes, hair and accessories: not the body, face, eyes... of the character in the file.
  const keys = Object.keys(character.parts).filter((k) => character.parts[k] && !OWN_PARTS.has(partOfKey(k)));
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
  const sets = items.filter((i) => i.kind === 'sets').flatMap((i) => i.sets).map(withoutOwnParts);
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
    // Only the set, in its own colours: not drawn over your character's other parts.
    const onYours = characterPicture(setCharacter(asSet.set), asSet.customGradients);
    return el('div', { className: 'json-row' }, [
      el('h4', { textContent: item.name }),
      el('div', { className: 'json-options' }, [
        option('character', 'As a character', 'Replaces the current character (with several, they go to the Gallery).', picture(asCharacter)),
        option('both', 'As a character and a set', 'Loads it like "As a character", and also saves its parts under Sets, to put on other characters later.', picture(asCharacter)),
        option('set', 'As a set on your character', `${(n2 => `Its ${n2} part${n2 === 1 ? '' : 's'}`)(Object.keys(asSet.set.parts).length)} (pictured on their own) go${Object.keys(asSet.set.parts).length === 1 ? 'es' : ''} on your character; body type and name stay. Also saved under Sets.`, picture(onYours)),
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
  const pics = el('button', { type: 'button', className: 'gallery-pics', title: `See ${item.name} bigger` }, [face, sprite]);
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
  pics.addEventListener('click', () => openCharacterView(item, load));
  const exportOne = el('button', { type: 'button', className: 'small-button', textContent: 'Export', title: 'Download this character as a file' });
  const images = el('button', { type: 'button', className: 'small-button', textContent: 'Save image(s)…', title: 'Put this character on and save its sheets as pictures or GIFs (Export image(s))' });
  images.addEventListener('click', async () => {
    await load();
    openExport();
  });
  exportOne.addEventListener('click', () => downloadBlob(new Blob([item.text], { type: 'application/json' }), `${safeFileName(item.name)}.json`));
  const buttons = [use];
  if (item.id) {
    const edit = el('button', { type: 'button', className: 'small-button gallery-edit', textContent: 'Edit', title: 'Open it to change it: Save → Save character (or Keep current character) then updates this one' });
    edit.addEventListener('click', async () => {
      await load();
      editingGalleryId = item.id;
      toast(`Editing "${item.name}": Save → Save character updates it in the Gallery.`, 6000);
    });
    const copy = el('button', { type: 'button', className: 'small-button gallery-copy', textContent: 'Copy', title: 'Keep a copy of it in the Gallery, e.g. to change one of them' });
    copy.addEventListener('click', () => {
      const entries = galleryEntries();
      const at = entries.findIndex((e) => e.id === item.id);
      const name = `${item.name} (copy)`;
      let text = item.text;
      try {
        const data = JSON.parse(text);
        if (data.character) data.character.name = name;
        text = JSON.stringify(data, null, 2);
      } catch { /* not ours to rename: keep the text */ }
      entries.splice(at + 1, 0, { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, kind: 'saved', text, at: Date.now() });
      saveGallery(entries);
      renderGallery();
    });
    buttons.push(edit, copy);
  }
  buttons.push(images, exportOne);
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
    // Presets: character files that came with a folder. None: the section isn't shown.
    if (title.startsWith('Presets') && !presets.length) continue;
    sections.push(el('h4', { textContent: `${title} (${items.length})` }));
    if (title.startsWith('Presets')) {
      sections.push(el('p', { className: 'muted small', textContent: 'Character files (.json) that came inside the folders you opened, e.g. the MZ generator\'s own presets or characters a pack maker included. Click one to see it, Use to load it.' }));
    }
    sections.push(items.length
      ? el('div', { className: 'gallery-grid' }, items.map((i) => galleryCard(i, observer)))
      : el('p', { className: 'muted small', textContent: query ? 'Nothing matches.' : empty }));
  }
  $('gallery-list').replaceChildren(...sections);
}

// ---------- setups kept in the Gallery: saved or loaded, to switch between ----------

const SETUPS_KEY = 'xgen-setups';
function keptSetups() {
  try {
    return JSON.parse(localStorage.getItem(SETUPS_KEY) || '[]');
  } catch {
    return [];
  }
}
function saveKeptSetups(list) {
  try {
    localStorage.setItem(SETUPS_KEY, JSON.stringify(list));
    return true;
  } catch {
    toast('Could not keep the setup: the browser storage is full. Delete some in Gallery → Setups.');
    return false;
  }
}

/** Keeps a setup in the Gallery (the same one twice is kept once, the newest first). */
function keepSetup(data, how) {
  if (!data || typeof data !== 'object') return;
  const json = JSON.stringify(data);
  const list = keptSetups().filter((s) => s.json !== json);
  list.unshift({ id: newSheetKey(), name: data.name || 'Setup', author: data.author || '', note: data.note || '', how, date: new Date().toISOString().slice(0, 10), json });
  saveKeptSetups(list.slice(0, 40));
  if (!$('gallery-setups').hidden) renderSetups();
}

/** What a setup holds, in a few words. */
function setupSummary(data) {
  const n = (o) => (Array.isArray(o) ? o.length : Object.keys(o || {}).length);
  const bits = [
    [n(data.assignments), 'file read as set', 'files read as set'],
    [n(data.autoMasks), 'colour mask', 'colour masks'],
    [n(data.sets), 'set', 'sets'],
    [n(data.characters), 'character', 'characters'],
    [n(data.customGradients), 'colour', 'colours'],
    [n(data.options?.extraSheets), 'added sheet', 'added sheets'],
  ].filter(([count]) => count).map(([count, one, more]) => `${count} ${count === 1 ? one : more}`);
  if (data.templates && n(data.templates)) bits.push('sheet sizes');
  if (data.randomRules) bits.push('randomize rules');
  return bits.join(', ') || 'options only';
}

function renderSetups() {
  const list = keptSetups();
  if (!list.length) {
    $('setup-list').replaceChildren(el('p', { className: 'muted small', textContent: 'No setups yet: Save → Save setup keeps one here, and setups you load show up here too.' }));
    return;
  }
  $('setup-list').replaceChildren(...list.map((s) => {
    let data;
    try {
      data = JSON.parse(s.json);
    } catch {
      data = null;
    }
    const use = el('button', { type: 'button', className: 'small-button primary', textContent: 'Use', title: 'Use this setup for the folders you have open' });
    use.disabled = !data || !state.library.packs.length;
    use.addEventListener('click', () => {
      useSetup(data, state.library.packs.map((p) => p.name));
      renderSetups();
    });
    const save = el('button', { type: 'button', className: 'small-button', textContent: 'Export', title: 'Download it as a setup file to share' });
    save.addEventListener('click', () => downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `${safeFileName(s.name)}.setup.json`));
    const del = el('button', { type: 'button', className: 'small-button', textContent: 'Delete', title: 'Take it out of the Gallery (what it set stays)' });
    del.addEventListener('click', () => {
      saveKeptSetups(keptSetups().filter((x) => x.id !== s.id));
      renderSetups();
    });
    return el('div', { className: 'setup-card' }, [
      el('div', { className: 'setup-card-head' }, [el('strong', { textContent: s.name }), use, save, del]),
      el('div', { className: 'muted small', textContent: `${s.how === 'loaded' ? 'Loaded' : 'Saved'} ${s.date}${s.author ? ` · by ${s.author}` : ''} · ${data ? setupSummary(data) : 'could not be read'}` }),
      s.note ? el('div', { className: 'small', textContent: s.note }) : null,
    ].filter(Boolean));
  }));
}

/** tab: "characters", "sets" or "setups". */
function openGallery(tab = 'characters') {
  for (const b of $('gallery-tabs').querySelectorAll('button')) b.classList.toggle('active', b.dataset.galleryTab === tab);
  $('gallery-characters').hidden = tab !== 'characters';
  $('gallery-sets').hidden = tab !== 'sets';
  $('gallery-setups').hidden = tab !== 'setups';
  if (tab === 'characters') renderGallery();
  else if (tab === 'setups') renderSetups();
  else renderSets();
  if (!$('gallery-dialog').open) $('gallery-dialog').showModal();
}
$('open-gallery').addEventListener('click', () => openGallery('characters'));
$('open-sets').addEventListener('click', () => openGallery('sets'));
$('open-setups').addEventListener('click', () => openGallery('setups'));
for (const b of $('gallery-tabs').querySelectorAll('button')) b.addEventListener('click', () => openGallery(b.dataset.galleryTab));
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

/**
 * The character's portrait, walk and battler, copied into a dialog while it is open: the
 * previews on the page are behind it.
 */
function showLivePreview(dialog, box) {
  const sources = ['face-canvas', 'walk-canvas', 'sv-canvas'].map((id) => $(id)).filter(Boolean);
  const copies = sources.map(() => el('canvas', { width: 0, height: 0 }));
  box.replaceChildren(...copies);
  const copy = () => {
    if (!dialog.open) return;
    sources.forEach((src, i) => {
      const c = copies[i];
      if (c.width !== src.width || c.height !== src.height) {
        c.width = src.width;
        c.height = src.height;
      }
      const g = c.getContext('2d');
      g.clearRect(0, 0, c.width, c.height);
      if (src.width && src.height) g.drawImage(src, 0, 0);
    });
    setTimeout(() => requestAnimationFrame(copy), 120);
  };
  copy();
}

/**
 * "Match the colour of…": the worn parts to match this slot's colours to. Picking one opens the
 * hue, saturation and brightness window already moved towards that part's colours.
 */
function matchPicker(slot, current) {
  const own = slotOwner(slot);
  if (!own) return [];
  const others = Object.entries(state.character.parts).filter(([key, id]) => id && key !== own.key && state.library.variants.has(id) && !key.includes(' #'));
  if (!others.length) return [];
  const select = el('select', { className: 'match-colour', title: `Make the ${slot.label.toLowerCase()} colour closer to another part's colours (harmonise): you can fine-tune it after` }, [
    el('option', { value: '', textContent: 'Match the colour of…' }),
    ...others.map(([key]) => el('option', { value: key, textContent: key })),
  ]);
  select.addEventListener('change', async () => {
    const key = select.value;
    select.value = '';
    if (!key) return;
    const [from, to] = await Promise.all([slotPixels(own.key, own.variant, slot.id), partThumbnail(key, state.library.variants.get(state.character.parts[key]))]);
    const target = colourMean(from);
    const reference = to && colourMean(drawnRgb(to));
    if (!target || !reference) {
      toast('Could not read the colours to match.');
      return;
    }
    // Moving from what shows now: an adjusted colour adds to its own shift.
    const shift = matchAdjust(target, reference, 0.5);
    const before = current?.adjust || { hue: 0, saturation: 100, brightness: 100 };
    const values = {
      hue: Math.max(-180, Math.min(180, before.hue + shift.hue)),
      saturation: Math.max(0, Math.min(200, Math.round((before.saturation * shift.saturation) / 100))),
      brightness: Math.max(0, Math.min(200, Math.round((before.brightness * shift.brightness) / 100))),
    };
    openAdjustDialog(slot, current || null, values, `Moved half way towards the colours of ${key}. Slide to fine-tune, or Reset to start again.`);
  });
  return [select];
}

/** The worn part a slot's colours are measured on: the selected one, else the first that uses the slot. */
function slotOwner(slot) {
  const uses = (variant) => variant?.layers.some((l) => l.slotId === slot.id || (l.paint || l.mask)?.slots?.has?.(slot.id));
  if (state.selectedPart !== ALL_COLOURS) {
    const key = itemOfKey(state.selectedPart);
    const variant = state.library.variants.get(state.character.parts[key]);
    return variant ? { key, variant } : null;
  }
  for (const [key, id] of Object.entries(state.character.parts)) {
    const variant = id && state.library.variants.get(id);
    if (uses(variant)) return { key, variant };
  }
  return null;
}

/** [r, g, b] of every drawn pixel of a picture. */
function drawnRgb(image) {
  const out = [];
  for (let i = 0; i < image.data.length; i += 4) if (image.data[i + 3] > 128) out.push([image.data[i], image.data[i + 1], image.data[i + 2]]);
  return out;
}

/** The pixels of a part that use a slot, in the colours they show now ([r, g, b] list). */
async function slotPixels(key, variant, slotId) {
  const slot = SLOT_BY_ID.get(slotId);
  const layers = variant.layers.filter((l) => l.base && !l.base.cells);
  await ensureLayers(layers);
  const byId = gradientsById();
  const gradientFor = (id) => {
    const g = byId.get(itemColor(state.character, key, id));
    if (g?.shiftSource) return (g.shiftRef ||= { shift: g.adjust });
    return g?.colors ?? null;
  };
  const out = [];
  for (const l of layers) {
    const base = l.base.pixels;
    const own = (l.paint || l.mask)?.pixels;
    const mask = own || (l.slotId ? slotMask(base, (SLOT_BY_ID.get(l.slotId)?.rgb) ?? 0) : null);
    if (!base || !mask || mask.width !== base.width || mask.height !== base.height) continue;
    const shown = recolorLayer(base, mask, l.slotId, gradientFor, state.settings);
    for (let i = 0; i < base.data.length; i += 4) {
      if (base.data[i + 3] <= 128 || !mask.data[i + 3]) continue;
      if (slot && matchSlot((mask.data[i] << 16) | (mask.data[i + 1] << 8) | mask.data[i + 2]) !== slot.id) continue;
      out.push([shown.data[i], shown.data[i + 1], shown.data[i + 2]]);
    }
    if (out.length > 4000) break;
  }
  return out;
}

function openAdjustDialog(slot, current, start = null, note = '') {
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
  setAdjustValues(start || (origin ? { hue: 0, saturation: 100, brightness: 100, ...current.adjust } : { hue: 0, saturation: 100, brightness: 100 }));
  if (note) $('adjust-note').textContent = note;
  drawGradientRow('adjust-before', base.colors);
  updateAdjust();
  $('adjust-dialog').returnValue = ''; // Esc keeps the last value otherwise
  $('adjust-dialog').showModal();
  showLivePreview($('adjust-dialog'), $('adjust-live'));
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
  syncKnownBodies();
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
    if (!state.library.bodyTypes.has(state.character.bodyType) && !(state.character.bodyType === ALL_BODIES && state.library.bodyTypes.size > 1)) {
      state.character.bodyType = [...state.library.bodyTypes.keys()][0];
    }
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
 * look-alike choices and the answers to "Use this setup?" and "Folder already open?". Opened again,
 * the folder is read from scratch.
 */
function forgetPackSettings(name) {
  const s = state.settings;
  const drop = (map, prefix) => {
    for (const key of Object.keys(map || {})) if (key.startsWith(prefix)) delete map[key];
  };
  drop(s.assignments, `${name}|`);
  drop(s.organizedFiles, `${name}|`);
  drop(s.removedParts, `${name}/`);
  drop(s.lookalikes, `${name}/`);
  drop(s.autoMasks, `${name}/`);
  drop(s.lookalikesAsked, `${name}/`);
  drop(s.openAgain, `${name}|`);
  for (const key of Object.keys(s.openAgain || {})) if (key.endsWith(`|${name}`)) delete s.openAgain[key];
  if (s.setupAnswers) delete s.setupAnswers[name];
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

/**
 * Forget all: every pack (remembered folders, dropped files, zips), what was assigned or removed in
 * them, the Gallery, sets, randomize rules and sheet templates. Undo brings the last four back.
 */
async function forgetEverything() {
  exMemory.clear();
  const folders = canRememberFolders ? await rememberedFolders() : [];
  let removed = 0;
  for (const f of folders) removed += await forgetAndUnload(f.key);
  // Packs that aren't remembered folders (dropped files, zips, extracted or stretched parts).
  const others = state.library.packs.map((p) => p.name);
  for (const name of others) {
    forgetPackSettings(name);
    unloadPack(name);
  }
  removed += others.length;
  // Everything goes: saved characters, sets and randomize rules too. Undo brings those back.
  const gallery = galleryEntries();
  const sets = state.settings.sets || [];
  const savedRules = state.settings.randomRules;
  // Sheet templates: frame sizes, sheets turned off or renamed, sheets added.
  const TEMPLATE_FIELDS = ['templates', 'sheetOptions', 'extraSheets'];
  const savedTemplates = Object.fromEntries(TEMPLATE_FIELDS.filter((k) => state.settings[k] !== undefined).map((k) => [k, state.settings[k]]));
  const hadTemplates = Object.values(savedTemplates).some((v) => (Array.isArray(v) ? v.length : Object.keys(v || {}).length));
  saveGallery([]);
  state.settings.sets = [];
  delete state.settings.randomRules;
  for (const k of TEMPLATE_FIELDS) delete state.settings[k];
  saveSettings();
  if (hadTemplates) sheetsChanged();
  renderSets();
  renderRecentFolders();
  const kept = gallery.length || sets.length || savedRules || hadTemplates;
  toast(`Forgot ${folders.length + others.length > 1 ? 'the packs' : 'the pack'} and what you assigned in them${removed ? ', and took their parts out' : ''}${gallery.length || sets.length ? `, your ${gallery.length} saved character${gallery.length === 1 ? '' : 's'} and ${sets.length} set${sets.length === 1 ? '' : 's'}` : ''}${savedRules || hadTemplates ? `, and your ${[savedRules && 'randomize rules', hadTemplates && 'sheet templates'].filter(Boolean).join(' and ')}` : ''}.`,
    10000, kept ? { label: 'Undo', run: () => {
      saveGallery(gallery);
      state.settings.sets = sets;
      if (savedRules) state.settings.randomRules = savedRules;
      Object.assign(state.settings, savedTemplates);
      saveSettings();
      if (hadTemplates) sheetsChanged();
      renderSets();
      toast('Your saved characters, sets, rules and sheet templates are back.');
    } } : undefined);
  renderFiles();
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
  if (folders.length === 1) openAll.title = `Reopen ${folders[0].key}`;
  openAll.addEventListener('click', () => reopenFolders(folders, true));
  box.replaceChildren(openAll);
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
    title: 'Forget these folders, what you assigned, removed or decided about look-alikes in them, your saved characters (Gallery), sets, randomize rules and sheet templates' });
  forgetAll.addEventListener('click', () => forgetEverything());
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
  await loadPack(entries);
});

$('files-input').addEventListener('change', async (e) => {
  const entries = entriesFromFileList([...e.target.files]);
  e.target.value = '';
  await loadPack(entries);
});

/**
 * Load pack, and anything dropped on the page: folders, zips, pictures and JSON files (characters,
 * sets, setups), in any mix. Folders and pictures first, then zips, then the JSON files, which
 * need the parts.
 * @param {{path:string, src:File|Blob}[]} entries
 * @param {FileSystemDirectoryHandle[]} [folders] dropped or picked folders, remembered for next time
 */
async function loadPack(entries, folders = []) {
  const inFolder = (x) => folders.some((h) => x.path.startsWith(`${h.name}/`));
  const isZip = (x) => /\.zip$/i.test(x.path);
  const isJson = (x) => /\.json$/i.test(x.path);
  // A folder brings its own zips and JSON (generator presets): those stay with it.
  const zips = entries.filter((x) => isZip(x) && !inFolder(x));
  const jsons = entries.filter((x) => isJson(x) && !inFolder(x));
  const pictures = entries.filter((x) => !zips.includes(x) && !jsons.includes(x));
  for (const h of folders.filter((h) => entries.some((x) => x.path.startsWith(`${h.name}/`)))) await importHandle(h);
  const rest = pictures.filter((x) => !inFolder(x));
  // Pictures in folders: every folder its own pack. Loose pictures: one pack, named after the first.
  const inDirs = rest.filter((x) => x.path.includes('/'));
  const loose = rest.filter((x) => !x.path.includes('/'));
  if (inDirs.length) await importEntries(inDirs, packNameFromEntries(inDirs));
  if (loose.length) {
    const first = loose[0].path.replace(/\.png$/i, '');
    await importEntries(loose, loose.length > 1 ? `${first} +${loose.length - 1}` : first, { loose: true, ask: true });
  }
  for (const x of zips) await openZip(x.src).catch((err) => toast(`Could not open ${x.path}: ${err.message}`));
  if (!jsons.length) return;
  const files = await Promise.all(jsons.map(async (x) => ({ name: x.path.split('/').pop(), text: await readText(x.src) })));
  // Setups: used for the packs that are open.
  const others = [];
  for (const f of files) {
    let data = null;
    try {
      data = JSON.parse(f.text);
    } catch { /* not JSON: reported with the others */ }
    if (data && isSetup(data)) {
      if (state.library.packs.length) useSetup(data, state.library.packs.map((p) => p.name));
      else {
        keepSetup(data, 'loaded');
        toast(`Kept the setup "${data.name || f.name}" in Gallery → Setups: open its pack, then Use it.`, 8000);
      }
    } else others.push(f);
  }
  if (others.length) await importJsonFiles(others);
}

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
  // Started before anything is awaited (withBusy waits a frame to draw its bar, and by then the
  // browser has emptied the drop). The bar shows while it reads: big folders take a while.
  const reading = entriesFromDrop(e.dataTransfer, (n) => busyStep(`Reading the dropped files: ${n} so far`));
  const entries = await withBusy('Reading the dropped files', () => reading);
  if (!entries.length) {
    toast('Nothing could be read from that drop. Try again, or use Load → Load pack.');
    return;
  }
  // The same as Load pack; dropped folders are remembered for next time, like picked ones.
  await loadPack(entries, await handles);
});

// ---------- editor events ----------

$('body-type').addEventListener('change', (e) => {
  const bodyType = e.target.value;
  const parts = {};
  for (const [part, id] of Object.entries(state.character.parts)) {
    const variant = state.library.variants.get(id);
    // Parts from the old body type switch to the same part number in the new one, if it exists.
    // Parts deliberately borrowed from a third body type stay as they are, and so does everything
    // when switching to All body types (it has every part already).
    if (variant && variant.bodyType === state.character.bodyType && bodyType !== ALL_BODIES) {
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
  // A copy of the item picked (an extra one too).
  state.selectedPart = addItem(state.character, partOfKey(state.selectedPart), state.character.parts[itemOfKey(state.selectedPart)] || null);
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
$('clip-grow').addEventListener('input', updateClip);
for (const id of ['clip-sheet', 'clip-group', 'clip-frame']) {
  $(id).addEventListener('change', () => {
    if (id === 'clip-sheet') $('clip-group').value = 'all';
    renderClip();
    // Shows the picked direction or motion in the preview.
    const sheet = $('clip-sheet').value;
    const group = Number($('clip-group').value);
    if (Number.isNaN(group)) return;
    if (sheet === 'TV') {
      state.walkDir = Math.min(group, 3);
      for (const b of $('dir-buttons').children) b.classList.toggle('active', Number(b.dataset.dir) === state.walkDir);
    }
    if (sheet === 'SV') {
      state.svMotion = group;
      $('sv-motion').value = group;
    }
    renderPreview();
  });
}
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
function pairList(box, pairs, options, word, toPair, fromPair, optionsB = options) {
  const render = () => {
    box.replaceChildren(...pairs.map((pair, i) => {
      const [a, b] = fromPair(pair);
      const select = (value, list) => {
        const s = el('select', {}, list.map(([v, label]) => el('option', { value: v, textContent: label })));
        s.value = value;
        return s;
      };
      const sa = select(a, options);
      const sb = select(b, optionsB);
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
    pairs.push(toPair(options[0]?.[0], optionsB === options ? options[1]?.[0] ?? options[0]?.[0] : optionsB[0]?.[0]));
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
  $('rule-style').value = ruleDraft.style || 'any';
  $('rule-any-colour').checked = !!ruleDraft.anyColour;
  $('rule-set-chance').value = ruleDraft.setChance || 0;
  const slotOptions = SLOTS.map((s) => [s.id, s.label]);
  const partOptions = parts.map((p) => [p, p]);
  $('rule-add-link').onclick = pairList($('rule-links'), ruleDraft.links, slotOptions, 'same colour as',
    (slot, follows) => ({ slot, follows }), (l) => [l.slot, l.follows]);
  $('rule-add-apart').onclick = pairList($('rule-apart'), ruleDraft.apart, partOptions, 'never with',
    (a, b) => [a, b], (p) => p);
  const bodyOptions = [...state.library.bodyTypes.keys()].filter((b) => b !== ALL_BODIES).map((b) => [b, b]);
  $('rule-add-not-on').onclick = pairList($('rule-not-on'), (ruleDraft.notOn ||= []), partOptions, 'never on',
    (part, body) => [part, body], (p) => p, bodyOptions);
  $('rules-dialog').showModal();
}

$('random-rules').addEventListener('click', openRulesDialog);
$('rules-dialog').addEventListener('close', () => {
  if ($('rules-dialog').returnValue !== 'ok' || !ruleDraft) return;
  ruleDraft.mixBodyTypes = $('rule-mix').checked;
  ruleDraft.style = $('rule-style').value;
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

// Larger preview: pointing at a part tile, a picture in the per-image picker, in Files… or in
// Look-alikes shows it big, next to it, so small and dark parts can be seen. Inside a window
// (Files…, Look-alikes) it goes in that window, or it would open behind it.
const bigPreview = el('div', { className: 'big-preview', hidden: true });
document.body.append(bigPreview);
const PREVIEWED = '.variant canvas, .sheet-pick canvas, .file-card canvas, .alike-pics canvas';
document.addEventListener('mouseover', (e) => {
  const small = e.target.closest?.(PREVIEWED);
  if (!small || !small.width || !small.height) return;
  const scale = Math.max(1, Math.min(8, Math.floor(288 / Math.max(small.width, small.height))));
  const big = el('canvas', { width: small.width, height: small.height });
  big.getContext('2d').drawImage(small, 0, 0);
  big.style.width = `${small.width * scale}px`;
  big.style.height = `${small.height * scale}px`;
  bigPreview.replaceChildren(big);
  const host = small.closest('dialog[open]') || document.body;
  if (bigPreview.parentElement !== host) host.append(bigPreview);
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

// Clear all: every part to None, Body and Face too (locked parts stay), and everything done to
// parts undone: positions, pieces, per-image pictures, hiding, cut-off parts, draw order, whole
// image, colours. One click undoes it.
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
  const ch = state.character;
  let cleared = 0;
  let changes = 0;
  for (const key of Object.keys(ch.parts)) {
    const part = partOfKey(key);
    if (state.locked.has(key) || !ch.parts[key]) continue;
    removeItem(ch, key); // extra items ("AccA 2") go away completely
    if (key === part) ch.parts[key] = null; // "None", not "pick a default"
    cleared++;
  }
  // What is left for parts not worn (hair cut off by a hood, hidden parts...) goes too.
  const kept = (k) => state.locked.has(itemOfKey(k));
  for (const field of ['offsets', 'clip', 'split', 'sheetParts', 'hidden']) {
    for (const k of Object.keys(ch[field] || {})) {
      if (kept(k)) continue;
      delete ch[field][k];
      changes++;
    }
  }
  // Parts cut off by a part that is gone show whole again.
  for (const [k, clip] of Object.entries(ch.clip || {})) if (!ch.parts[clip.by]) delete ch.clip[k];
  for (const field of ['drawOrder', 'sheetTransform', 'taller']) {
    if (Object.keys(ch[field] || {}).length) changes++;
    ch[field] = {};
  }
  if (ch.only) { delete ch.only; changes++; }
  moveGroup.clear();
  // Colours back to Source: the parts as drawn, no gradients.
  const coloured = Object.keys(state.character.colors || {}).length
    + Object.values(state.character.itemColors || {}).reduce((n, c) => n + Object.values(c).filter(Boolean).length, 0);
  state.character.colors = {};
  for (const c of Object.values(state.character.itemColors || {})) for (const slot of Object.keys(c)) c[slot] = null;
  if (!cleared && !coloured && !changes) {
    toast('Nothing to clear: only locked parts are worn, all in their source colours.');
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
  toast(`Took off ${cleared} part${cleared === 1 ? '' : 's'}, set every colour back to Source and undid moves, pieces, hiding, cut-off parts, draw order and whole-image changes. Locked parts stay.`);
});

$('randomize').addEventListener('click', () => {
  for (const set of state.settings.sets || []) {
    for (const g of set.customGradients || []) {
      if (!state.customGradients.some((x) => x.id === g.id)) state.customGradients.push(customGradientFromJson(g));
    }
  }
  state.character = randomize(state.character, state.library, pickableGradients(), {
    locked: state.locked, rules: rules(), sets: state.settings.sets || [], syncColours: syncingColours(),
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

$('layer-sheet').addEventListener('change', () => {
  stretchPick = null;
  renderLayers();
  renderTaller();
});
// One button: squash and stretch on or off for the picture shown.
$('taller-toggle').addEventListener('click', () => {
  const sheet = $('layer-sheet').value;
  if (!TALLER_SHEETS.includes(sheet) || !state.character) return;
  const taller = (state.character.taller ||= {});
  if (taller[sheet]) {
    delete taller[sheet];
    stretchPick = null;
  } else {
    const pf = plainFrameOf(sheet);
    taller[sheet] = { top: 100, rows: [{ y: Math.round(pf.h * NECK_SHARE[sheet]), scale: 150 }], left: 100, cols: [], boxes: [], width: 100 };
    stretchPick = { kind: 'row', i: 0 };
  }
  renderTaller();
  renderPreview();
  drawFocus();
});

// ---------- squash and stretch (taller sprites), in the close up ----------

const TALLER_SHEETS = ['TV', 'TVD', 'SV'];
/** Where the head ends by default, as a share of the frame's height (MV/MZ chibi sprites). */
const NECK_SHARE = { TV: 0.58, TVD: 0.58, SV: 0.53 };
const LISTS = { row: 'rows', col: 'cols', box: 'boxes' };
const within = (v, lo, hi, fallback = lo) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : fallback));

/** The squash and stretch of a sheet (see stretch.js), or null. */
const stretchOf = (sheet) => normalizeStretch(state.character?.taller?.[sheet]);

/** A sheet's picture before squash and stretch: {image, canvas, frame}. */
const plainOf = (sheet) => state.composites[sheet]?.plain || state.composites[sheet];
const plainFrameOf = (sheet) => plainOf(sheet)?.frame || SHEETS[sheet]?.frame || { w: 48, h: 48 };

/** The frame the close up shows, as "column,row" of its sheet's grid (a line's own place there). */
function focusFrameKey(sheet) {
  const p = plainOf(sheet);
  if (!p?.frame) return '0,0';
  const r = focusRect(sheet, p.image, p.frame);
  return `${Math.round(r.x / p.frame.w)},${Math.round(r.y / p.frame.h)}`;
}

/** The line or box picked in the close up: {kind: 'row' | 'col' | 'box', i}. Arrow keys move it. */
let stretchPick = null;

/**
 * Changes the squash and stretch of a sheet: fn changes its spec (and may return {kind, item} to
 * pick). Lines stay in order, the picked one stays picked.
 */
function editStretch(sheet, fn, { panel = true } = {}) {
  const spec = stretchOf(sheet);
  if (!spec) return;
  let picked = stretchPick && { kind: stretchPick.kind, item: spec[LISTS[stretchPick.kind]]?.[stretchPick.i] };
  const made = fn(spec);
  if (made) picked = made;
  spec.rows.sort((p, q) => p.y - q.y);
  spec.cols.sort((p, q) => p.x - q.x);
  const i = picked?.item ? spec[LISTS[picked.kind]].indexOf(picked.item) : -1;
  stretchPick = i >= 0 ? { kind: picked.kind, i } : null;
  (state.character.taller ||= {})[sheet] = spec;
  if (panel) renderTaller();
  renderPreview();
}

/** Where a line across is in the frame shown: its own place there, or where it is in every frame. */
const rowPlace = (row, key) => row.at[key] ?? row.y;
function setRowPlace(row, key, y) {
  if (row.at[key] != null) row.at[key] = y;
  else row.y = y;
}

function pickStretch(kind, i) {
  stretchPick = { kind, i };
  renderTaller();
  drawFocus();
  $('focus-canvas').focus();
}

function renderTaller() {
  if (!state.character) return;
  const box = $('taller-panel');
  const sheet = $('layer-sheet').value;
  if (!TALLER_SHEETS.includes(sheet)) {
    $('taller-toggle').disabled = true;
    $('taller-toggle').classList.remove('active');
    box.replaceChildren(el('p', { className: 'muted small', textContent: 'For the walk, damage and battler pictures: pick one under Layers.' }));
    return;
  }
  const spec = stretchOf(sheet);
  const key = focusFrameKey(sheet);
  const pf = plainFrameOf(sheet);
  $('taller-toggle').disabled = false;
  $('taller-toggle').classList.toggle('active', !!spec);
  $('taller-toggle').setAttribute('aria-pressed', String(!!spec));
  $('taller-toggle').textContent = `Squash/Stretch: ${spec ? 'on' : 'off'}`;
  const head = [];
  if (!spec) {
    box.replaceChildren();
    return;
  }
  const num = (value, min, max, title, set, step = 1) => {
    const i = el('input', { type: 'number', className: 'tpl-num', min, max, step, value, title });
    i.addEventListener('change', () => editStretch(sheet, (s) => { set(s, within(Math.round(Number(i.value)), min, max, value)); }));
    return i;
  };
  const button = (label, title, fn) => {
    const b = el('button', { type: 'button', className: 'small-button', textContent: label, title });
    b.addEventListener('click', fn);
    return b;
  };
  const pick = (kind, i, colour) => {
    const b = button(String(i + 1), 'Pick it: the arrow keys move it', () => pickStretch(kind, i));
    b.style.borderColor = colour;
    b.classList.toggle('active', stretchPick?.kind === kind && stretchPick.i === i);
    return b;
  };
  const remove = (kind, i) => button('✕', 'Remove', () => {
    stretchPick = null;
    editStretch(sheet, (s) => { s[LISTS[kind]].splice(i, 1); });
  });
  const pct = (value, title, set) => num(value, 10, 400, title, set, 5);
  // The biggest band, for a new line: it goes in its middle and gets its size, so nothing changes yet.
  const newCut = (cuts, size, first, scales) => {
    const edges = [0, ...cuts, size];
    let best = 0;
    for (let i = 1; i < edges.length - 1; i++) if (edges[i + 1] - edges[i] > edges[best + 1] - edges[best]) best = i;
    return { at: Math.round((edges[best] + edges[best + 1]) / 2), scale: best === 0 ? first : scales[best - 1] };
  };

  const across = spec.rows.map((r, i) => {
    const own = r.at[key] != null;
    const thisFrame = el('input', { type: 'checkbox', checked: own, title: 'This frame (the one shown) gets its own place for this line, e.g. a bowing or crouching pose' });
    thisFrame.addEventListener('change', () => editStretch(sheet, (s) => {
      if (thisFrame.checked) s.rows[i].at[key] = s.rows[i].y;
      else delete s.rows[i].at[key];
    }));
    return el('div', { className: 'stretch-item' }, [
      pick('row', i, '#4fc3ff'), ' at ', num(rowPlace(r, key), 0, pf.h, 'Pixels from the top of the frame', (s, v) => setRowPlace(s.rows[i], key, v)), ' px, below it ',
      pct(r.scale, 'How long the band below this line gets: 150 = half again as long, 50 = half as long', (s, v) => { s.rows[i].scale = v; }), ' % ',
      el('label', { className: 'lock' }, [thisFrame, ' this frame']),
      ...(r.bend.length ? [button('Straighten', 'Make the line straight again', () => editStretch(sheet, (s) => { s.rows[i].bend = []; }))] : []),
      remove('row', i),
    ]);
  });
  const down = spec.cols.map((c, i) => el('div', { className: 'stretch-item' }, [
    pick('col', i, '#ffa94f'), ' at ', num(c.x, 0, pf.w, 'Pixels from the left of the frame', (s, v) => { s.cols[i].x = v; }), ' px, right of it ',
    pct(c.scale, 'How wide the band right of this line gets: 150 = half again as wide', (s, v) => { s.cols[i].scale = v; }), ' % ', remove('col', i),
  ]));
  const boxes = spec.boxes.map((b, i) => el('div', { className: 'stretch-item' }, [
    pick('box', i, '#ff6fb5'),
    ' ', num(b.x, -pf.w, pf.w * 2, 'Left', (s, v) => { s.boxes[i].x = v; }), ',', num(b.y, -pf.h, pf.h * 2, 'Top', (s, v) => { s.boxes[i].y = v; }),
    ' ', num(b.w, 1, pf.w * 2, 'Width', (s, v) => { s.boxes[i].w = v; }), '×', num(b.h, 1, pf.h * 2, 'Height', (s, v) => { s.boxes[i].h = v; }),
    ' wide ', pct(b.sx, 'How wide what is in the box gets (around its middle)', (s, v) => { s.boxes[i].sx = v; }), '% tall ',
    pct(b.sy, 'How tall what is in the box gets (around its middle)', (s, v) => { s.boxes[i].sy = v; }), '% ', remove('box', i),
  ]));
  box.replaceChildren(
    ...head,
    el('div', { className: 'stretch-head' }, ['Lines across ', el('span', { className: 'muted', textContent: '(blue, top to bottom)' })]),
    el('div', { className: 'stretch-item' }, ['Above the first line (the head) ', pct(spec.top, 'How tall the head gets: 100 = as it is', (s, v) => { s.top = v; }), ' %']),
    ...across,
    button('+ Line across', 'A new line in the middle of the biggest band. Lines keep a band (a belt) as it is between stretched ones', () => editStretch(sheet, (s) => {
      const n = newCut(s.rows.map((r) => r.y), pf.h, s.top, s.rows.map((r) => r.scale));
      const item = { y: n.at, scale: n.scale, bend: [], at: {} };
      s.rows.push(item);
      return { kind: 'row', item };
    })),
    el('div', { className: 'stretch-head' }, ['Lines down ', el('span', { className: 'muted', textContent: '(orange, left to right)' })]),
    ...(spec.cols.length ? [el('div', { className: 'stretch-item' }, ['Left of the first line ', pct(spec.left, 'How wide the band left of the first line down gets', (s, v) => { s.left = v; }), ' %'])] : []),
    ...down,
    button('+ Line down', 'A line down the frame: the bands left and right of it get widths of their own (the frames get wider or narrower)', () => editStretch(sheet, (s) => {
      const n = newCut(s.cols.map((c) => c.x), pf.w, s.left, s.cols.map((c) => c.scale));
      const item = { x: n.at, scale: n.scale };
      s.cols.push(item);
      return { kind: 'col', item };
    })),
    el('div', { className: 'stretch-head' }, ['Boxes ', el('span', { className: 'muted', textContent: '(pink: what is inside gets bigger or smaller, e.g. the eyes)' })]),
    ...boxes,
    button('+ Box', 'An area made bigger or smaller around its middle. Drag it, or its corner to size it', () => editStretch(sheet, (s) => {
      const w = Math.max(2, Math.round(pf.w / 3));
      const h = Math.max(2, Math.round(pf.h / 6));
      const item = { x: Math.round((pf.w - w) / 2), y: Math.round(pf.h * 0.3), w, h, sx: 150, sy: 150 };
      s.boxes.push(item);
      return { kind: 'box', item };
    })),
    el('div', { className: 'stretch-item' }, ['Body width ', num(spec.width, 50, 200, 'How wide everything below the first line across is, around the middle: 100 = as it is', (s, v) => { s.width = v; }, 5), ' %']),
    el('div', { className: 'stretch-item' }, [
      button('Add as alternate parts', 'Stretched copies of the worn parts (and their colour masks) join the part lists, e.g. Clothing "p11 (stretched)"', () => addStretchedParts().catch((err) => toast(`Could not add them: ${err.message}`))),
      button('Save them (zip)', 'The stretched copies of the worn parts as files, to keep in your parts folder', () => saveStretchedParts().catch((err) => toast(`Could not save them: ${err.message}`))),
    ]),
    el('p', { className: 'muted small', textContent: 'Left: the frame with its lines, right: the result. Drag a line; Shift-drag bends it at that point (shoulders above the neck); click one and use the arrow keys (Shift: 10). Drag a box, or its corner to size it. Colour masks are stretched along.' }),
  );
}

/** Whether the close up shows the lines (the Squash and stretch panel is open and on). */
function stretchEditing(sheet) {
  return !ex && !focusExtraId && TALLER_SHEETS.includes(sheet) && !!stretchOf(sheet) && !!state.composites[sheet];
}

/** Where the frame with the lines is drawn in the close up: canvas px = (o + frame px) * zoom. */
let stretchView = null;

function drawStretchEdit(sheet, c, canvas) {
  const spec = stretchOf(sheet);
  const plain = c.plain || c;
  const r = focusRect(sheet, plain.image, plain.frame);
  const r2 = focusRect(sheet, c.image, c.frame);
  const P = FOCUS_PAD + 2;
  const GAP = 6;
  const H = Math.max(r.h, r2.h);
  const W = r.w + GAP + r2.w;
  const stage = canvas.parentElement;
  const fit = Math.max(1, Math.min(16, Math.floor(Math.min((stage.clientWidth - 16) / (W + 2 * P), (stage.clientHeight - 16) / (H + 2 * P)))));
  focusZoom = focusUserZoom || fit;
  const z = focusZoom;
  canvas.width = (W + 2 * P) * z;
  canvas.height = (H + 2 * P) * z;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const ox = P;
  const oy = P + H - r.h;
  const ox2 = P + r.w + GAP;
  const oy2 = P + H - r2.h;
  ctx.drawImage(plain.canvas, r.x, r.y, r.w, r.h, ox * z, oy * z, r.w * z, r.h * z);
  ctx.drawImage(c.canvas, r2.x, r2.y, r2.w, r2.h, ox2 * z, oy2 * z, r2.w * z, r2.h * z);
  ctx.strokeStyle = 'rgba(128, 128, 128, 0.6)';
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(ox * z - 0.5, oy * z - 0.5, r.w * z + 1, r.h * z + 1);
  ctx.strokeRect(ox2 * z - 0.5, oy2 * z - 0.5, r2.w * z + 1, r2.h * z + 1);
  ctx.setLineDash([]);
  stretchView = { ox, oy, w: r.w, h: r.h, sheet };
  const key = focusFrameKey(sheet);
  const X = (x) => (ox + x) * z;
  const Y = (y) => (oy + y) * z;
  const shown = canvas.getBoundingClientRect().width / canvas.width || 1;
  const px = (n) => Math.max(1, n / shown);
  ctx.font = `${Math.round(px(11))}px system-ui, sans-serif`;
  const tag = (text, x, y, colour) => {
    const w = ctx.measureText(text).width + px(8);
    const h = px(15);
    const tx = Math.max(0, Math.min(canvas.width - w, x));
    const ty = Math.max(0, Math.min(canvas.height - h, y));
    ctx.fillStyle = colour;
    ctx.fillRect(tx, ty, w, h);
    ctx.fillStyle = '#10141c';
    ctx.fillText(text, tx + px(4), ty + px(11));
  };
  const isPicked = (kind, i) => stretchPick?.kind === kind && stretchPick.i === i;
  const lineStyle = (colour, picked) => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = px(picked ? 3 : 2);
    ctx.setLineDash(picked ? [] : [px(6), px(3)]);
  };
  if (spec.top !== 100 && spec.rows.length) tag(`head ${spec.top}%`, X(0), Y(0), '#4fc3ff');
  spec.rows.forEach((row, i) => {
    lineStyle('#4fc3ff', isPicked('row', i));
    ctx.beginPath();
    ctx.moveTo(X(-2), Y(lineY(row, key, 0)));
    for (let x = 0; x <= r.w; x++) ctx.lineTo(X(x), Y(lineY(row, key, x)));
    ctx.lineTo(X(r.w + 2), Y(lineY(row, key, r.w)));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#4fc3ff';
    for (const [bx] of row.bend) ctx.fillRect(X(bx) - px(3), Y(lineY(row, key, bx)) - px(3), px(6), px(6));
    tag(`${i + 1}: ${row.scale}%${row.at[key] != null ? ' (this frame)' : ''}`, X(r.w) - px(70), Y(lineY(row, key, r.w)) + px(2), '#4fc3ff');
  });
  spec.cols.forEach((col, i) => {
    lineStyle('#ffa94f', isPicked('col', i));
    ctx.beginPath();
    ctx.moveTo(X(col.x), Y(-2));
    ctx.lineTo(X(col.x), Y(r.h + 2));
    ctx.stroke();
    ctx.setLineDash([]);
    tag(`${i + 1}: ${col.scale}%`, X(col.x) + px(2), Y(r.h) - px(17), '#ffa94f');
  });
  spec.boxes.forEach((b, i) => {
    lineStyle('#ff6fb5', isPicked('box', i));
    ctx.strokeRect(X(b.x), Y(b.y), b.w * z, b.h * z);
    ctx.setLineDash([]);
    ctx.fillStyle = '#ff6fb5';
    ctx.fillRect(X(b.x + b.w) - px(4), Y(b.y + b.h) - px(4), px(8), px(8));
    tag(`${i + 1}: ${b.sx === b.sy ? b.sx : `${b.sx}×${b.sy}`}%`, X(b.x), Y(b.y) - px(16), '#ff6fb5');
  });
}

/** The frame pixel under the pointer, and 6 screen pixels in frame pixels. */
function stretchPoint(e) {
  const canvas = $('focus-canvas');
  const rect = canvas.getBoundingClientRect();
  const k = canvas.width / (rect.width || 1);
  return {
    x: ((e.clientX - rect.left) * k) / focusZoom - stretchView.ox,
    y: ((e.clientY - rect.top) * k) / focusZoom - stretchView.oy,
    tol: (6 * k) / focusZoom,
  };
}

/** The line or box at a frame pixel: {kind, i, part}, or null. */
function stretchHit(sheet, p) {
  const spec = stretchOf(sheet);
  if (!spec || !stretchView) return null;
  const key = focusFrameKey(sheet);
  const { w, h } = stretchView;
  const inFrame = p.x >= -p.tol && p.x <= w + p.tol && p.y >= -p.tol && p.y <= h + p.tol;
  if (!inFrame) return null;
  for (let i = spec.boxes.length - 1; i >= 0; i--) {
    const b = spec.boxes[i];
    if (Math.abs(p.x - (b.x + b.w)) <= p.tol && Math.abs(p.y - (b.y + b.h)) <= p.tol) return { kind: 'box', i, part: 'corner' };
  }
  for (let i = 0; i < spec.rows.length; i++) if (Math.abs(lineY(spec.rows[i], key, p.x) - p.y) <= p.tol) return { kind: 'row', i };
  for (let i = 0; i < spec.cols.length; i++) if (Math.abs(spec.cols[i].x - p.x) <= p.tol) return { kind: 'col', i };
  for (let i = spec.boxes.length - 1; i >= 0; i--) {
    const b = spec.boxes[i];
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return { kind: 'box', i, part: 'move' };
  }
  return null;
}

/** Moves the picked line or box by (dx, dy) frame pixels. */
function nudgeStretch(sheet, dx, dy) {
  if (!stretchPick) return false;
  const key = focusFrameKey(sheet);
  const pf = plainFrameOf(sheet);
  editStretch(sheet, (s) => {
    const item = s[LISTS[stretchPick.kind]][stretchPick.i];
    if (!item) return;
    if (stretchPick.kind === 'row') setRowPlace(item, key, within(rowPlace(item, key) + dy, 0, pf.h));
    else if (stretchPick.kind === 'col') item.x = within(item.x + dx, 0, pf.w);
    else {
      item.x += dx;
      item.y += dy;
    }
  });
  return true;
}

/** Copies a picture into a PNG file. */
async function pngBlob(image) {
  const canvas = new OffscreenCanvas(image.width, image.height);
  canvas.getContext('2d').putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

/**
 * Stretched copies of the worn parts' walk, damage and battler pictures (and their colour masks),
 * named like generator files in a group folder, so they read as alternates of their parts:
 * [{path, src, pack}]. Sheets without squash and stretch are left out (borrowed from the part).
 */
async function stretchedPartFiles(group) {
  const lib = state.library;
  const sheets = TALLER_SHEETS.filter((s) => isStretched(stretchOf(s)));
  const files = [];
  for (const [key, id] of Object.entries(state.character.parts)) {
    const variant = id && lib.variants.get(id);
    if (!variant) continue;
    const num = /^p(\d+)/.exec(variant.basePid || variant.pid)?.[1] || '01';
    for (const sheet of sheets) {
      const spec = stretchOf(sheet);
      const own = variantForSheet(variant, sheet, lib);
      if (!own) continue;
      await ensureVariants([own]);
      const pf = plainFrameOf(sheet);
      const off = partOffset(state.character, key, sheet);
      const { cols, rows } = SHEETS[sheet].frame;
      for (const l of own.layers) {
        if (l.sheet !== sheet || !l.base?.pixels || l.vxace || l.base.cells) continue;
        const img = l.base.pixels;
        const frame = { w: img.width / cols, h: img.height / rows, cols, rows };
        if (!Number.isInteger(frame.w) || !Number.isInteger(frame.h)) continue;
        // Where this picture's frame stands in the character's frame: centred, on the bottom, moved.
        const shift = { x: Math.round((pf.w - frame.w) / 2) + off.x, y: pf.h - frame.h + off.y };
        const dir = `Stretched parts/${group}/${variant.bodyType}/`;
        const name = `${sheet}_${l.layer}_p${num}`;
        files.push({ pack: variant.pack, path: `${dir}${name}.png`, src: await pngBlob(stretchFrames(img, frame, spec, shift).image) });
        const mask = (l.paint || l.mask)?.pixels;
        if (mask?.data && mask.width === img.width && mask.height === img.height) {
          files.push({ pack: variant.pack, path: `${dir}${name}_c.png`, src: await pngBlob(stretchFrames(mask, frame, spec, shift).image) });
        }
      }
    }
  }
  return files;
}

/** A group name not used yet: "stretched", "stretched 2", ... */
function stretchGroup() {
  const used = new Set(libraryFiles(state.library).map((f) => /^Stretched parts\/([^/]+)\//.exec(f.path)?.[1]).filter(Boolean));
  let n = 1;
  while (used.has(n === 1 ? 'stretched' : `stretched ${n}`)) n++;
  return n === 1 ? 'stretched' : `stretched ${n}`;
}

async function addStretchedParts() {
  if (!TALLER_SHEETS.some((s) => isStretched(stretchOf(s)))) {
    toast('Nothing is stretched yet.');
    return;
  }
  const group = stretchGroup();
  const files = await withBusy('Stretching the parts', () => stretchedPartFiles(group));
  if (!files.length) {
    toast('None of the worn parts could be stretched (VX Ace parts can\'t).');
    return;
  }
  for (const pack of new Set(files.map((f) => f.pack))) {
    const mine = files.filter((f) => f.pack === pack);
    addFilesToPack(state.library, pack, mine);
    // Kept with the pack, so Save setup (zip) shares them too.
    const p = state.library.packs.find((x) => x.name === pack);
    if (p?.entries) p.entries.push(...mine.map(({ path, src }) => ({ path, src })));
  }
  afterFilesChanged();
  toast(`Added ${files.length} stretched picture${files.length > 1 ? 's' : ''} as alternates: "(${group})" in the part lists, e.g. p01 (${group}). Wearing them, turn squash and stretch off, or they are stretched twice. They last until the page is closed; "Save them (zip)" keeps them as files.`, 14000);
}

async function saveStretchedParts() {
  if (!TALLER_SHEETS.some((s) => isStretched(stretchOf(s)))) {
    toast('Nothing is stretched yet.');
    return;
  }
  const files = await withBusy('Stretching the parts', () => stretchedPartFiles('stretched'));
  if (!files.length) {
    toast('None of the worn parts could be stretched.');
    return;
  }
  const zip = zipFiles(await Promise.all(files.map(async (f) => ({ name: f.path, bytes: await fileBytes(f.src) }))));
  downloadBlob(new Blob([zip], { type: 'application/zip' }), `${safeFileName(state.character.name || 'character')}_stretched_parts.zip`);
}

// ---------- extract mode: a piece of a picture (e.g. the eyes) made a part of its own ----------
// In the close up: the whole picture, picked pixels in pink. Pick by colour (everywhere, or only
// in an area), by single pixels, or all of an area; Shift takes away.

/** {sheet, sources, sel, undo, area, view, tool} while extract mode is on, else null. */
let ex = null;
/**
 * What was picked, kept when the close up is closed or another picture is shown: per sheet and
 * picture, {sel, area, w, h}. Forget, Clear, or a picture of another size drops it.
 */
const exMemory = new Map();
const exMemoryKey = () => `${ex.sheet}|${exSource().label}`;
function rememberExtract() {
  if (!ex?.sel) return;
  const img = exSource().image;
  if (selectedCount(ex.sel) || ex.area) exMemory.set(exMemoryKey(), { sel: ex.sel.slice(), area: ex.area, w: img.width, h: img.height, view: ex.view, tool: ex.tool });
  else exMemory.delete(exMemoryKey());
}
/** Where the picture is drawn: canvas px = (pad + px) * zoom. */
let exView = null;

function extractSourcesFor(sheet) {
  const extra = focusExtra();
  if (focusExtraId) return extra?.image ? [{ label: `${extra.sheet.name || 'The sheet'} as shown (every part)`, image: extra.image, mask: null, part: null }] : [];
  const c = state.composites[sheet];
  const base = sheetBase(sheet);
  const sources = c ? [{ label: `The ${sheetLabel(sheet).toLowerCase()} as shown (every part)`, image: c.plain?.image || c.image, mask: null, part: null }] : [];
  // The picked part's own pictures on this sheet, with their colour masks.
  const key = state.selectedPart && state.selectedPart !== ALL_COLOURS ? itemOfKey(state.selectedPart) : null;
  const variant = key && state.library.variants.get(state.character.parts[key]);
  if (variant) {
    for (const l of sheetLayers(variant, base, state.library)) {
      if (!l.base?.pixels || l.base.cells) continue;
      const mask = (l.paint || l.mask)?.pixels;
      sources.push({ label: `${partOfKey(key)}: its picture ${l.key || l.layer}`, image: l.base.pixels, mask: mask?.width === l.base.pixels.width && mask?.height === l.base.pixels.height ? mask : null, part: variant.part });
    }
  }
  return sources;
}

function setExtractMode(on) {
  const sheet = $('layer-sheet').value;
  if (!on) rememberExtract();
  ex = on ? { sheet: focusExtraId ? `extra:${focusExtraId}` : sheetBase(sheet), sources: extractSourcesFor(sheet), si: 0, sel: null, undo: [], area: null, view: 'picture', tool: 'colour' } : null;
  if (ex && !ex.sources.length) {
    ex = null;
    toast('Nothing to extract from: this picture is empty.');
  }
  const extracting = !!ex;
  $('focus-extract').classList.toggle('active', extracting);
  $('focus-extract').setAttribute('aria-pressed', String(extracting));
  $('focus-canvas').parentElement.classList.toggle('extracting', extracting);
  for (const id of ['focus-layers', 'focus-colours', 'focus-visibility', 'focus-taller']) $(id).hidden = extracting;
  $('focus-extract-panel').hidden = !extracting;
  // The note says how to pick pixels while extracting (and how to move parts again after).
  const note = $('focus-note');
  note.dataset.parts ||= note.textContent;
  note.textContent = extracting
    ? 'Extract: pick the pixels of the piece on the picture (they are highlighted). Colour: click a colour; Pixels: click or drag; Area: drag a box that colours are picked in. Right-click (or Shift) takes away, the same way. Then add the piece, and what is left, as parts. Click Extract again to go back.'
    : note.dataset.extra || note.dataset.parts;
  focusUserZoom = null;
  if (ex) {
    ex.si = ex.sources.length > 1 ? 1 : 0;
    $('extract-source').replaceChildren(...ex.sources.map((src, i) => el('option', { value: i, textContent: src.label })));
    $('extract-source').value = String(ex.si);
    $('extract-colour').value = state.settings.extractColour || '#ff28c8';
    const parts = [...new Set([...PART_ORDER, ...partNames(state.library, state.character.bodyType)])];
    $('extract-part').replaceChildren(...parts.map((p) => el('option', { value: p, textContent: p })));
    $('extract-part').value = parts.includes('Eyes') ? 'Eyes' : parts[0];
    $('extract-rest-part').replaceChildren(el('option', { value: '', textContent: "don't add it" }), ...parts.map((p) => el('option', { value: p, textContent: p })));
    extractSourceChanged();
  }
  drawFocus();
}
$('focus-extract').addEventListener('click', () => setExtractMode(!ex));
// Closing the close up keeps what was picked: Extract shows it again next time.
let exWasOn = false;
$('focus-dialog').addEventListener('close', () => {
  exWasOn = !!ex;
  if (ex) setExtractMode(false);
  focusExtraId = null;
  const note = $('focus-note');
  if (note.dataset.parts) note.textContent = note.dataset.parts;
  note.dataset.extra = '';
});

const exSource = () => ex.sources[ex.si] || ex.sources[0];

function extractSourceChanged() {
  // What was picked carries over to a picture of the same size; else it is what was picked on
  // that picture before.
  const old = ex.sel && { sel: ex.sel, area: ex.area, w: exSource()?.image.width, h: exSource()?.image.height };
  if (ex.sel) rememberExtract();
  ex.si = Number($('extract-source').value) || 0;
  const src = exSource();
  const kept = exMemory.get(exMemoryKey());
  const from = old && old.w === src.image.width && old.h === src.image.height && selectedCount(old.sel) ? old
    : kept && kept.w === src.image.width && kept.h === src.image.height ? kept : null;
  ex.sel = from ? from.sel.slice() : new Uint8Array(src.image.width * src.image.height);
  ex.undo = [];
  ex.area = from?.area || null;
  if (kept && from === kept) {
    ex.view = kept.view || ex.view;
    ex.tool = kept.tool || ex.tool;
  }
  $('extract-by-mask').checked = !!src.mask;
  $('extract-by-mask').disabled = !src.mask;
  $('extract-view').querySelector('[data-view="mask"]').disabled = !src.mask;
  if (ex.view === 'mask' && !src.mask) ex.view = 'picture';
  if (src.part && $('extract-rest-part').querySelector(`[value="${CSS.escape(src.part)}"]`)) $('extract-rest-part').value = src.part;
  else $('extract-rest-part').value = '';
  renderExtract();
}
$('extract-source').addEventListener('change', () => {
  extractSourceChanged();
  drawFocus();
});
$('extract-colour').addEventListener('input', () => {
  state.settings.extractColour = $('extract-colour').value;
  saveSettings();
  drawFocus();
});

/** Changes the picked pixels, keeping the old ones for Undo. */
function changeSelection(fn) {
  ex.undo.push(ex.sel.slice());
  if (ex.undo.length > 40) ex.undo.shift();
  fn(ex.sel);
  const img = exSource().image;
  // Only pixels with something on them count.
  for (let i = 0; i < ex.sel.length; i++) if (ex.sel[i] && img.data[i * 4 + 3] === 0) ex.sel[i] = 0;
  renderExtract();
  drawFocus();
}

const inArea = (i, w) => {
  if (!ex.area) return true;
  const x = i % w;
  const y = Math.floor(i / w);
  return x >= ex.area.x && x < ex.area.x + ex.area.w && y >= ex.area.y && y < ex.area.y + ex.area.h;
};

/** The piece and what is left (and their colour masks, when the picture has one). */
function extractResult() {
  const src = exSource();
  const fill = $('extract-fill').checked;
  const from = fill ? nearestOutside(src.image, ex.sel) : null;
  return {
    piece: keepSelected(src.image, ex.sel),
    rest: removeSelected(src.image, ex.sel, { fill, from }),
    pieceMask: src.mask && keepSelected(src.mask, ex.sel),
    restMask: src.mask && removeSelected(src.mask, ex.sel, { fill, from }),
  };
}

function renderExtract() {
  if (!ex) return;
  for (const b of $('extract-view').querySelectorAll('[data-view]')) b.classList.toggle('on', b.dataset.view === ex.view);
  for (const b of $('extract-tool').querySelectorAll('[data-tool]')) b.classList.toggle('on', b.dataset.tool === ex.tool);
  const n = selectedCount(ex.sel);
  $('extract-count').textContent = n ? `Picked: ${n} pixel${n === 1 ? '' : 's'} (highlighted).` : 'Nothing picked yet: click a colour or pixels on the picture.';
  $('extract-add').disabled = $('extract-save').disabled = !n;
  // A piece of an added sheet (e.g. 8 directions) isn't laid out like a part: save it as a PNG.
  if (focusExtraId) $('extract-add').disabled = true;
  $('extract-add').title = focusExtraId ? 'Pieces of an added sheet are saved as PNG (Save as PNG); pieces of the Walk, Battler, Damage or Portrait can be added as parts' : '';
  $('extract-undo').disabled = !ex.undo.length;
  const t = extractTarget();
  $('extract-part-row').hidden = !t;
  const hidden = t && hiddenOf(t);
  const nHidden = hidden ? selectedCount(hidden) : 0;
  if (t) {
    $('extract-part-text').textContent = `${t.key}, on the ${sheetLabel(t.sheet).toLowerCase()}:`;
    $('extract-split').disabled = $('extract-hide').disabled = !n;
    $('extract-unhide').disabled = !nHidden;
    $('extract-unhide').title = n ? 'Show the picked pixels again (hidden with Hide them)' : 'Nothing picked: show every hidden pixel again';
  }
  $('extract-hidden-note').textContent = !t ? 'Split off a piece or hide pixels: pick From: one of the part\'s own pictures.' : nHidden ? `${nHidden} pixels of ${t.key} are hidden on this picture.` : '';
  $('extract-area-row').hidden = !ex.area;
  if (ex.area) $('extract-area-text').textContent = `Area ${ex.area.w} × ${ex.area.h}: colours are picked only in it.`;
}

function drawExtractMode(canvas) {
  const src = exSource();
  const img = src.image;
  const view = ex.view === 'mask' && src.mask ? src.mask
    : ex.view === 'piece' || ex.view === 'rest' ? extractResult()[ex.view] : img;
  const P = FOCUS_PAD;
  const stage = canvas.parentElement;
  // At least 2x, so tall sheets (8 directions) aren't tiny: the stage scrolls.
  const fit = Math.max(2, Math.min(16, Math.floor(Math.min((stage.clientWidth - 16) / (img.width + 2 * P), (stage.clientHeight - 16) / (img.height + 2 * P)))));
  focusZoom = focusUserZoom || fit;
  const z = focusZoom;
  canvas.width = (img.width + 2 * P) * z;
  canvas.height = (img.height + 2 * P) * z;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(toCanvas(view), P * z, P * z, img.width * z, img.height * z);
  exView = { P, w: img.width, h: img.height };
  ctx.strokeStyle = 'rgba(128, 128, 128, 0.6)';
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(P * z - 0.5, P * z - 0.5, img.width * z + 1, img.height * z + 1);
  // The frame grid of a sprite sheet, faintly, to see where the frames are.
  const frame = focusExtraId ? extraFrameOf(focusExtra()) : state.composites[$('layer-sheet').value]?.frame;
  if (frame?.cols && img.width >= frame.w * frame.cols && img.height >= frame.h * frame.rows) {
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.3)';
    ctx.beginPath();
    for (let c = 1; c < frame.cols; c++) { ctx.moveTo((P + c * frame.w) * z, P * z); ctx.lineTo((P + c * frame.w) * z, (P + img.height) * z); }
    for (let r = 1; r < frame.rows; r++) { ctx.moveTo(P * z, (P + r * frame.h) * z); ctx.lineTo((P + img.width) * z, (P + r * frame.h) * z); }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  if (ex.view === 'picture' || ex.view === 'mask') {
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = state.settings.extractColour || '#ff28c8';
    for (let i = 0; i < ex.sel.length; i++) if (ex.sel[i]) ctx.fillRect((P + (i % img.width)) * z, (P + Math.floor(i / img.width)) * z, z, z);
    ctx.globalAlpha = 1;
  }
  if ($('focus-grid').checked && z >= 3) {
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= img.width; x++) { ctx.moveTo((x + P) * z + 0.5, P * z); ctx.lineTo((x + P) * z + 0.5, (img.height + P) * z); }
    for (let y = 0; y <= img.height; y++) { ctx.moveTo(P * z, (y + P) * z + 0.5); ctx.lineTo((img.width + P) * z, (y + P) * z + 0.5); }
    ctx.stroke();
  }
  if (ex.area) {
    ctx.strokeStyle = '#4fc3ff';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect((P + ex.area.x) * z, (P + ex.area.y) * z, ex.area.w * z, ex.area.h * z);
    ctx.setLineDash([]);
  }
}

/** The picture pixel under the pointer. */
function exPoint(e) {
  const canvas = $('focus-canvas');
  const rect = canvas.getBoundingClientRect();
  const k = canvas.width / (rect.width || 1);
  return {
    x: Math.floor(((e.clientX - rect.left) * k) / focusZoom - exView.P),
    y: Math.floor(((e.clientY - rect.top) * k) / focusZoom - exView.P),
  };
}

/** A colour clicked: its pixels added (or, with Shift, taken away), only in the area if there is one. */
function pickColourAt(p, out) {
  const src = exSource();
  const picked = selectByColour(src.image, [p], {
    // Showing the colour mask: its colours are what a click picks.
    by: (ex.view === 'mask' || $('extract-by-mask').checked) && src.mask ? src.mask : src.image,
    tolerance: within(Number($('extract-tolerance').value), 0, 128, 12),
    touching: $('extract-touching').checked,
  });
  const w = src.image.width;
  changeSelection((sel) => {
    for (let i = 0; i < sel.length; i++) if (picked[i] && inArea(i, w)) sel[i] = out ? 0 : 1;
  });
}

function paintPixel(p, out) {
  const { w, h } = exView;
  if (p.x < 0 || p.y < 0 || p.x >= w || p.y >= h) return;
  ex.sel[p.y * w + p.x] = out || exSource().image.data[(p.y * w + p.x) * 4 + 3] === 0 ? 0 : 1;
}

$('extract-view').addEventListener('click', (e) => {
  const view = e.target.closest('[data-view]')?.dataset.view;
  if (!view || !ex) return;
  ex.view = view;
  renderExtract();
  drawFocus();
});
$('extract-tool').addEventListener('click', (e) => {
  const tool = e.target.closest('[data-tool]')?.dataset.tool;
  if (!tool || !ex) return;
  ex.tool = tool;
  renderExtract();
});
$('extract-area-all').addEventListener('click', () => changeSelection((sel) => {
  for (let i = 0; i < sel.length; i++) if (inArea(i, exView.w)) sel[i] = 1;
}));
$('extract-area-clear').addEventListener('click', () => {
  ex.area = null;
  renderExtract();
  drawFocus();
});
for (const [id, by] of [['extract-grow', 1], ['extract-shrink', -1]]) {
  $(id).addEventListener('click', () => changeSelection((sel) => sel.set(growSelection(sel, exView.w, exView.h, by))));
}
$('extract-invert').addEventListener('click', () => changeSelection((sel) => {
  for (let i = 0; i < sel.length; i++) if (inArea(i, exView.w)) sel[i] = sel[i] ? 0 : 1;
}));
function extractUndo() {
  if (!ex?.undo.length) return;
  ex.sel = ex.undo.pop();
  renderExtract();
  drawFocus();
}
$('extract-undo').addEventListener('click', extractUndo);
$('extract-clear').addEventListener('click', () => {
  ex.area = null;
  changeSelection((sel) => sel.fill(0));
  exMemory.delete(exMemoryKey());
});
$('extract-fill').addEventListener('change', () => drawFocus());

/** The next free part number of a part in a pack: "07". */
function nextPid(packName, bodyType, part, taken = new Set()) {
  let max = 0;
  for (const v of state.library.variants.values()) {
    if (v.pack !== packName || v.bodyType !== bodyType || v.part !== part) continue;
    max = Math.max(max, Number(/^p(\d+)/.exec(v.pid)?.[1]) || 0);
  }
  let n = max + 1;
  while (taken.has(`${part}${n}`)) n++;
  taken.add(`${part}${n}`);
  return String(n).padStart(2, '0');
}

$('extract-add').addEventListener('click', async () => {
  if (!ex) return;
  const { piece, rest, pieceMask, restMask } = extractResult();
  const PACK = 'Extracted';
  const body = state.character.bodyType;
  const sheet = ex.sheet;
  const taken = new Set();
  const entries = [];
  const added = [];
  const addOne = async (part, image, mask) => {
    const nn = nextPid(PACK, body, part, taken);
    const dir = `${PACK}/${body}/`;
    entries.push({ path: `${dir}${sheet}_${part}_p${nn}.png`, src: await pngBlob(image) });
    if (mask) entries.push({ path: `${dir}${sheet}_${part}_p${nn}_c.png`, src: await pngBlob(mask) });
    added.push(`${part} p${nn}`);
  };
  await addOne($('extract-part').value, piece, pieceMask);
  if ($('extract-rest-part').value) await addOne($('extract-rest-part').value, rest, restMask);
  const pack = state.library.packs.find((p) => p.name === PACK);
  if (pack) {
    addFilesToPack(state.library, PACK, entries);
    (pack.entries ||= []).push(...entries);
    afterFilesChanged();
  } else {
    await importEntries(entries, PACK, { loose: true });
  }
  toast(`Added ${added.join(' and ')} (in "${PACK}") to the part lists. They last until the page is closed; Save as PNG keeps them as files.`, 10000);
});

// ---------- by hand: split a piece off a part, or hide some of its pixels (clip) ----------

/** The part Extract works on when it shows that part's own picture: {key, sheet, w, h}, else null. */
function extractTarget() {
  const src = ex && exSource();
  if (!src?.part || focusExtraId || !state.selectedPart || state.selectedPart === ALL_COLOURS) return null;
  const key = itemOfKey(state.selectedPart);
  if (!state.character.parts[key]) return null;
  return { key, sheet: ex.sheet, w: src.image.width, h: src.image.height };
}

/** The pixels of the part hidden on this picture (Hide them), or null. */
function hiddenOf(t) {
  const cut = state.character.clip?.[t.key]?.cut?.[t.sheet];
  return cut && cut.w === t.w && cut.h === t.h ? decodeMask(cut.rle, t.w * t.h) : null;
}

function setHidden(t, sel) {
  const all = (state.character.clip ||= {});
  const entry = (all[t.key] ||= {});
  const cuts = (entry.cut ||= {});
  if (selectedCount(sel)) cuts[t.sheet] = { w: t.w, h: t.h, rle: encodeMask(sel) };
  else delete cuts[t.sheet];
  if (!Object.keys(cuts).length) delete entry.cut;
  if (!entry.mode && !entry.at && !entry.cut) delete all[t.key];
}

$('extract-hide').addEventListener('click', () => {
  const t = extractTarget();
  if (!t || !selectedCount(ex.sel)) return;
  const now = hiddenOf(t) || new Uint8Array(t.w * t.h);
  for (let i = 0; i < now.length; i++) if (ex.sel[i]) now[i] = 1;
  setHidden(t, now);
  renderExtract();
  renderPreview();
  toast(`Hid ${selectedCount(ex.sel)} pixels of ${t.key} on the ${sheetLabel(t.sheet).toLowerCase()}. Show them again: pick them and click Show them again.`);
});

$('extract-unhide').addEventListener('click', () => {
  const t = extractTarget();
  const now = t && hiddenOf(t);
  if (!now) return;
  // Nothing picked: every hidden pixel shows again.
  const all = !selectedCount(ex.sel);
  for (let i = 0; i < now.length; i++) if (all || ex.sel[i]) now[i] = 0;
  setHidden(t, now);
  renderExtract();
  renderPreview();
});

$('extract-split').addEventListener('click', async () => {
  const t = extractTarget();
  if (!t || !selectedCount(ex.sel)) return;
  await ensureVariants(variantsToDecode(state.character, state.library));
  const old = state.character.split?.[t.key];
  const cuts = [...handCuts(old), { sheet: t.sheet, w: t.w, h: t.h, rle: encodeMask(ex.sel) }];
  const made = makeSplit(state.character, state.library, t.key, old?.gap ?? 0, !!old?.byFrame, state.settings, cuts);
  (state.character.split ||= {})[t.key] = { ...made, ...(old?.links ? { links: old.links } : {}) };
  const piece = `${t.key} #${made.count}`;
  ex.undo.push(ex.sel.slice());
  ex.sel.fill(0);
  state.selectedPart = piece;
  renderAll();
  renderExtract();
  drawFocus();
  toast(`Split off "${pieceLabel(piece)}": it moves, turns and is recoloured on its own (Layers, Position).`, 7000);
});

$('extract-save').addEventListener('click', async () => {
  if (!ex) return;
  const { piece, rest } = extractResult();
  const name = safeFileName(state.character.name || 'character');
  await downloadImage(piece, `${name}_${ex.sheet}_${$('extract-part').value}.png`);
  await downloadImage(rest, `${name}_${ex.sheet}_rest.png`);
});

// ---------- close up: one image big, the picked part glowing, moved by mouse or arrow keys ----------

/** Panels of the part editor shown in the close up while it is open: [element, its place]. */
const focusPanels = [['layers', 'focus-layers'], ['slots', 'focus-colours'], ['clip-box', 'focus-visibility']];
// Taller sprites live in the close up only (its own panel there).
const focusHomes = new Map();
let focusZoom = 1;
/** Zoom picked with the wheel or the buttons; null = fit the window. */
let focusUserZoom = null;
/** Transparent room shown around the frame, so an outline at its edge isn't cut off. */
const FOCUS_PAD = 2;
let focusTimer = 0;

// ---------- close up of an added sheet (Sheet templates: 8 directions, XP, your own sizes) ----------
// The whole sheet big, in its own frames. Its parts are picked and recoloured here; they move on
// the sheet they are made of (the Walk for 8 directions), which this one follows. Extract works here.

/** The id of the added sheet the close up shows, else null. */
let focusExtraId = null;
const focusExtra = () => (focusExtraId ? (state.extraComposites || []).find((x) => x.sheet.id === focusExtraId) || null : null);

/** The frames of an added sheet: its own columns and rows, else those of its kind. */
function extraFrameOf(x) {
  const img = x?.image;
  if (!img) return null;
  const kind = { DIR8: [3, x.sheet.onlyDiagonals ? 4 : 8], XP: [4, 4], RM2K: [3, 4] }[x.sheet.base] || [SHEETS[x.sheet.base]?.frame?.cols || 1, SHEETS[x.sheet.base]?.frame?.rows || 1];
  const cols = x.sheet.cols > 0 ? x.sheet.cols : kind[0];
  const rows = x.sheet.rows > 0 ? x.sheet.rows : kind[1];
  return { w: Math.floor(img.width / cols), h: Math.floor(img.height / rows), cols, rows };
}

function openExtraFocus(id) {
  const x = (state.extraComposites || []).find((s) => s.sheet.id === id);
  if (!x?.image) return;
  const base = WALK_LAYOUTS[x.sheet.base] ? 'TV' : x.sheet.base;
  openFocus(base, id);
}

/** An added sheet in the close up: the whole picture and its frames. */
function drawExtraFocus(canvas, x) {
  const img = x.image;
  const P = FOCUS_PAD;
  const stage = canvas.parentElement;
  // At least 2x, so tall sheets (8 directions) aren't tiny: the stage scrolls.
  const fit = Math.max(2, Math.min(16, Math.floor(Math.min((stage.clientWidth - 16) / (img.width + 2 * P), (stage.clientHeight - 16) / (img.height + 2 * P)))));
  focusZoom = focusUserZoom || fit;
  const z = focusZoom;
  canvas.width = (img.width + 2 * P) * z;
  canvas.height = (img.height + 2 * P) * z;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(toCanvas(img), P * z, P * z, img.width * z, img.height * z);
  drawFrameLines(ctx, P, z, img, extraFrameOf(x));
}

/** The edge of a picture, its frame grid and (when big enough and ticked) its pixel grid. */
function drawFrameLines(ctx, P, z, img, frame) {
  ctx.strokeStyle = 'rgba(128, 128, 128, 0.6)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(P * z - 0.5, P * z - 0.5, img.width * z + 1, img.height * z + 1);
  if (frame?.cols > 1 || frame?.rows > 1) {
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.45)';
    ctx.beginPath();
    for (let c = 1; c < frame.cols; c++) { ctx.moveTo((P + c * frame.w) * z + 0.5, P * z); ctx.lineTo((P + c * frame.w) * z + 0.5, (P + img.height) * z); }
    for (let r = 1; r < frame.rows; r++) { ctx.moveTo(P * z, (P + r * frame.h) * z + 0.5); ctx.lineTo((P + img.width) * z, (P + r * frame.h) * z + 0.5); }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  if ($('focus-grid').checked && z >= 3) {
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.3)';
    ctx.beginPath();
    for (let px = 0; px <= img.width; px++) { ctx.moveTo((px + P) * z + 0.5, P * z); ctx.lineTo((px + P) * z + 0.5, (img.height + P) * z); }
    for (let py = 0; py <= img.height; py++) { ctx.moveTo(P * z, (py + P) * z + 0.5); ctx.lineTo((img.width + P) * z, (py + P) * z + 0.5); }
    ctx.stroke();
  }
}

function openFocus(sheet, extraId = null) {
  if (!state.character) return;
  focusExtraId = extraId;
  if ($('layer-sheet').value !== sheet) $('layer-sheet').value = sheet;
  // Borrow the Layers, Colours and Visibility panels; they go back on close.
  for (const [id, place] of focusPanels) {
    const node = $(id);
    if (!focusHomes.has(id)) focusHomes.set(id, { parent: node.parentElement, next: node.nextSibling });
    $(place).append(node);
  }
  $('focus-dirs').hidden = sheet !== 'TV' || !!extraId;
  // An added sheet's parts move on the sheet it is made of.
  const note = $('focus-note');
  note.dataset.parts ||= note.textContent;
  note.dataset.extra = extraId
    ? `${focusExtra()?.sheet.name || 'This sheet'} is made of the ${sheetLabel(sheet)} parts: pick and recolour them here (Layers, Colours); they move in the ${sheetLabel(sheet)} close up, and this sheet follows. Extract works here too. Mouse wheel: scroll; Ctrl + wheel: zoom; hold the middle button and drag: pan.`
    : '';
  note.textContent = note.dataset.extra || note.dataset.parts;
  focusUserZoom = null;
  stretchPick = null;
  renderTaller();
  $('focus-outline').checked = state.settings.focusOutline !== false;
  $('focus-outline-colour').value = state.settings.focusOutlineColour || '#ffd640';
  if (!$('focus-dialog').open) $('focus-dialog').showModal();
  renderLayers();
  // Closed while extracting: it opens in extract mode again, with what was picked.
  if (exWasOn && !ex) setExtractMode(true);
  drawFocus();
  $('focus-canvas').focus();
}

$('focus-dialog').addEventListener('close', () => {
  // Opened again before this (late) close event: the panels stay in it.
  if ($('focus-dialog').open) return;
  for (const [id] of focusPanels) {
    const home = focusHomes.get(id);
    if (home) home.parent.insertBefore($(id), home.next);
  }
  focusHomes.clear();
});

for (const [id, sheet] of [['face-canvas', 'FG'], ['walk-canvas', 'TV'], ['sv-canvas', 'SV'], ['damage-canvas', 'TVD']]) {
  $(id).title = 'Click: a close up, to move parts with the mouse or the arrow keys';
  $(id).addEventListener('click', () => openFocus(sheet));
}
$('focus-dirs').addEventListener('click', (e) => {
  const dir = e.target.dataset?.dir;
  if (dir == null) return;
  state.walkDir = Number(dir);
  for (const b of $('dir-buttons').children) b.classList.toggle('active', b.dataset.dir === dir);
  drawFocus();
});
$('focus-grid').addEventListener('change', () => drawFocus());
$('focus-outline').addEventListener('change', () => {
  state.settings.focusOutline = $('focus-outline').checked ? undefined : false;
  saveSettings();
  drawFocus();
});
$('focus-outline-colour').addEventListener('input', () => {
  state.settings.focusOutlineColour = $('focus-outline-colour').value;
  saveSettings();
  drawFocus();
});

/** Redraws the close up soon (after the preview is drawn), once however often it is asked. */
function scheduleFocus() {
  if (!$('focus-dialog').open) return;
  clearTimeout(focusTimer);
  focusTimer = setTimeout(drawFocus, 30);
}

/** The part moved in the close up: the picked item or piece, when it is worn. */
function focusKey() {
  const key = state.selectedPart;
  return key && key !== ALL_COLOURS && wornKeys().includes(key) ? key
    : key && key !== ALL_COLOURS && state.character.parts[key] ? key : null;
}

/** The part of a sheet the close up shows: a portrait or damage strip whole, a sprite's standing frame. */
function focusRect(sheet, image, frame) {
  if (sheet === 'FG' || sheet === 'TVD' || !frame) return { x: 0, y: 0, w: image.width, h: image.height };
  const f = frameOf(sheet, image, frame);
  if (sheet === 'TV') return { x: (f.cols === 3 ? 1 : 0) * f.w, y: Math.min(state.walkDir, f.rows - 1) * f.h, w: f.w, h: f.h };
  const m = state.svMotion;
  const col = f.cols === 9 && f.rows === 6 ? Math.floor(m / 6) * 3 + 1 : 0;
  return { x: col * f.w, y: (f.cols === 9 && f.rows === 6 ? m % 6 : m % f.rows) * f.h, w: f.w, h: f.h };
}

function drawFocus() {
  if (!$('focus-dialog').open || !state.character) return;
  const sheet = $('layer-sheet').value;
  const canvas = $('focus-canvas');
  const extra = focusExtra();
  if (focusExtraId) {
    $('focus-title').textContent = `${ex ? 'Extract' : 'Close up'}: ${extra?.sheet.name || 'Sheet'}`;
    if (!extra?.image) {
      canvas.width = 0;
      canvas.height = 0;
      return;
    }
    if (ex) drawExtractMode(canvas);
    else {
      exView = null;
      stretchView = null;
      drawExtraFocus(canvas, extra);
    }
    return;
  }
  const c = state.composites[sheet];
  $('focus-title').textContent = `Close up: ${sheetLabel(sheet)}`;
  if (!c) {
    canvas.width = 0;
    canvas.height = 0;
    return;
  }
  if (ex) {
    $('focus-title').textContent = `Extract: ${sheetLabel(sheet)}`;
    drawExtractMode(canvas);
    return;
  }
  exView = null;
  if (stretchEditing(sheet)) {
    drawStretchEdit(sheet, c, canvas);
    return;
  }
  stretchView = null;
  const r = focusRect(sheet, c.image, c.frame);
  const P = FOCUS_PAD;
  const stage = canvas.parentElement;
  const fit = Math.max(1, Math.min(16, Math.floor(Math.min((stage.clientWidth - 16) / (r.w + 2 * P), (stage.clientHeight - 16) / (r.h + 2 * P)))));
  focusZoom = focusUserZoom || fit;
  canvas.width = (r.w + 2 * P) * focusZoom;
  canvas.height = (r.h + 2 * P) * focusZoom;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(c.canvas, r.x, r.y, r.w, r.h, P * focusZoom, P * focusZoom, r.w * focusZoom, r.h * focusZoom);
  // The frame's edge: what lies outside it is not in the file.
  ctx.strokeStyle = 'rgba(128, 128, 128, 0.6)';
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(P * focusZoom - 0.5, P * focusZoom - 0.5, r.w * focusZoom + 1, r.h * focusZoom + 1);
  ctx.setLineDash([]);
  if ($('focus-grid').checked && focusZoom >= 3) {
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= r.w; x++) { ctx.moveTo((x + P) * focusZoom + 0.5, P * focusZoom); ctx.lineTo((x + P) * focusZoom + 0.5, (r.h + P) * focusZoom); }
    for (let y = 0; y <= r.h; y++) { ctx.moveTo(P * focusZoom, (y + P) * focusZoom + 0.5); ctx.lineTo((r.w + P) * focusZoom, (y + P) * focusZoom + 0.5); }
    ctx.stroke();
  }
  const key = focusKey();
  $('focus-note').classList.toggle('warn', !key);
  if (!key || state.settings.focusOutline === false) return;
  // The picked part alone: everything else hidden. Its outline glows.
  const hidden = Object.fromEntries(wornKeys().filter((k) => k !== key && itemOfKey(k) !== key && k !== itemOfKey(key)).map((k) => [k, true]));
  for (const k of Object.keys(state.character.parts)) if (k !== key && k !== itemOfKey(key) && !(k in hidden)) hidden[k] = true;
  const alone = composeSheet(sheet, { ...state.character, hidden }, state.library, gradientsById(), state.settings).image;
  if (!alone || alone.width !== c.image.width || alone.height !== c.image.height) return;
  // The outline follows the part's pixel edges at any zoom: a thin line, the same on screen however
  // big the pixels are, with a soft glow.
  const solid = (x, y) => x >= 0 && y >= 0 && x < r.w && y < r.h && alone.data[((r.y + y) * alone.width + r.x + x) * 4 + 3] > 40;
  const z = focusZoom;
  const path = new Path2D();
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      if (!solid(x, y)) continue;
      const sx = (x + P) * z;
      const sy = (y + P) * z;
      if (!solid(x, y - 1)) { path.moveTo(sx, sy); path.lineTo(sx + z, sy); }
      if (!solid(x, y + 1)) { path.moveTo(sx, sy + z); path.lineTo(sx + z, sy + z); }
      if (!solid(x - 1, y)) { path.moveTo(sx, sy); path.lineTo(sx, sy + z); }
      if (!solid(x + 1, y)) { path.moveTo(sx + z, sy); path.lineTo(sx + z, sy + z); }
    }
  }
  const colour = state.settings.focusOutlineColour || '#ffd640';
  // Scaled down on screen (a big canvas in a small window): keep the line about 2 screen pixels.
  const shown = canvas.getBoundingClientRect().width / canvas.width || 1;
  ctx.save();
  ctx.lineCap = 'square';
  ctx.strokeStyle = colour;
  ctx.shadowColor = colour;
  ctx.shadowBlur = 6;
  ctx.lineWidth = Math.max(1, 2 / shown);
  ctx.stroke(path);
  ctx.restore();
}

/** Zooms the close up, keeping the point under the pointer (fx, fy: 0..1 of the picture) in place. */
function setFocusZoom(zoom, fx = 0.5, fy = 0.5, clientX = null, clientY = null) {
  const next = Math.max(1, Math.min(32, Math.round(zoom)));
  if (next === focusZoom && focusUserZoom) return;
  focusUserZoom = next;
  const canvas = $('focus-canvas');
  const stage = canvas.parentElement;
  drawFocus();
  // Scroll so the same spot stays under the pointer (or the middle stays in the middle).
  const rect = canvas.getBoundingClientRect();
  const box = stage.getBoundingClientRect();
  const px = clientX ?? box.left + box.width / 2;
  const py = clientY ?? box.top + box.height / 2;
  stage.scrollLeft += rect.left + fx * rect.width - px;
  stage.scrollTop += rect.top + fy * rect.height - py;
}
$('focus-zoom-in').addEventListener('click', () => setFocusZoom(focusZoom + 1));
$('focus-zoom-out').addEventListener('click', () => setFocusZoom(focusZoom - 1));
$('focus-zoom-fit').addEventListener('click', () => {
  focusUserZoom = null;
  drawFocus();
});

/** Moves the picked part by (dx, dy) pixels on this image (portrait, or every sprite sheet). */
function focusNudge(dx, dy) {
  const key = focusKey();
  if (!key || (!dx && !dy)) return;
  if (state.selectedPart !== key) return;
  const prefix = $('layer-sheet').value === 'FG' ? 'off-face' : 'off-sprite';
  for (const [axis, d] of [['x', dx], ['y', dy]]) {
    if (!d) continue;
    const input = $(`${prefix}-${axis}`);
    input.value = Math.max(-64, Math.min(64, (Number(input.value) || 0) + d));
  }
  updateOffset();
}

// Arrow keys work wherever you are in the close up (after picking a part under Layers too), but
// not in a text box or a dropdown.
$('focus-dialog').addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea')) return;
  if (ex) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      extractUndo();
    }
    return;
  }
  if (focusExtraId) return;
  const step = e.shiftKey ? 10 : 1;
  const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (!move) return;
  e.preventDefault();
  const sheet = $('layer-sheet').value;
  if (stretchEditing(sheet) && nudgeStretch(sheet, ...move)) return;
  focusNudge(...move);
});
{
  let drag = null;
  const canvas = $('focus-canvas');
  const stage = canvas.parentElement;
  let pan = null;
  // Middle-drag (or right-drag, outside extract mode) pans; Ctrl + wheel zooms around the pointer.
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 1 && e.button !== 2) return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('panning');
    pan = { x: e.clientX, y: e.clientY, left: stage.scrollLeft, top: stage.scrollTop };
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pan) return;
    stage.scrollLeft = pan.left - (e.clientX - pan.x);
    stage.scrollTop = pan.top - (e.clientY - pan.y);
  });
  const endPan = () => {
    pan = null;
    stage.classList.remove('panning');
  };
  stage.addEventListener('pointerup', endPan);
  stage.addEventListener('pointercancel', endPan);
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  // The wheel scrolls (Shift: sideways); Ctrl + wheel zooms around the pointer.
  stage.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / (rect.width || 1);
    const fy = (e.clientY - rect.top) / (rect.height || 1);
    setFocusZoom(focusZoom + (e.deltaY < 0 ? 1 : -1), fx, fy, e.clientX, e.clientY);
  }, { passive: false });
  // Extract mode: pick by colour, paint pixels, or drag an area. Shift takes away.
  let exDrag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!ex || !exView || (e.button !== 0 && e.button !== 2)) return;
    // Right-click takes away, the same way left-click adds (so it doesn't pan here).
    e.stopImmediatePropagation();
    e.stopPropagation();
    canvas.focus();
    const out = e.shiftKey || e.button === 2;
    const p = exPoint(e);
    if (ex.tool === 'colour') {
      pickColourAt(p, out);
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    if (ex.tool === 'pixel') {
      ex.undo.push(ex.sel.slice());
      exDrag = { tool: 'pixel', out, last: p };
      paintPixel(p, out);
      renderExtract();
      drawFocus();
    } else {
      exDrag = { tool: 'area', x: p.x, y: p.y, out, before: ex.area };
      ex.area = null;
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!ex || !exDrag) return;
    e.stopImmediatePropagation();
    const p = exPoint(e);
    if (exDrag.tool === 'pixel') {
      // Every pixel on the way, however fast the mouse moves.
      const { last } = exDrag;
      const steps = Math.max(Math.abs(p.x - last.x), Math.abs(p.y - last.y), 1);
      for (let t = 1; t <= steps; t++) paintPixel({ x: Math.round(last.x + ((p.x - last.x) * t) / steps), y: Math.round(last.y + ((p.y - last.y) * t) / steps) }, exDrag.out);
      exDrag.last = p;
    } else {
      const x0 = within(Math.min(exDrag.x, p.x), 0, exView.w);
      const y0 = within(Math.min(exDrag.y, p.y), 0, exView.h);
      const x1 = within(Math.max(exDrag.x, p.x) + 1, 0, exView.w);
      const y1 = within(Math.max(exDrag.y, p.y) + 1, 0, exView.h);
      ex.area = x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
    }
    drawFocus();
  });
  const endEx = () => {
    if (!exDrag) return;
    const done = exDrag;
    exDrag = null;
    // A box drawn with the right button takes away what is picked in it (the area stays as it was).
    if (done.tool === 'area' && done.out) {
      const box = ex.area;
      ex.area = done.before;
      if (box) {
        changeSelection((sel) => {
          for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) sel[y * exView.w + x] = 0;
        });
        return;
      }
      drawFocus();
    }
    renderExtract();
  };
  canvas.addEventListener('pointerup', endEx);
  canvas.addEventListener('pointercancel', endEx);
  // Squash and stretch: lines and boxes are dragged on the frame at the left; Shift-drag bends a line.
  let stretchDrag = null;
  const cursors = { row: 'ns-resize', col: 'ew-resize', corner: 'nwse-resize', move: 'move' };
  canvas.addEventListener('pointermove', (e) => {
    const sheet = $('layer-sheet').value;
    if (!stretchView || !stretchEditing(sheet)) {
      if (!drag) canvas.style.cursor = '';
      return;
    }
    const p = stretchPoint(e);
    if (!stretchDrag) {
      const hit = stretchHit(sheet, p);
      canvas.style.cursor = hit ? (hit.kind === 'box' ? cursors[hit.part] : (e.shiftKey && hit.kind === 'row' ? 'crosshair' : cursors[hit.kind])) : '';
      return;
    }
    const d = stretchDrag;
    const dx = Math.round(p.x - d.x);
    const dy = Math.round(p.y - d.y);
    const pf = plainFrameOf(sheet);
    const key = focusFrameKey(sheet);
    editStretch(sheet, (s) => {
      const item = s[LISTS[d.kind]][stretchPick?.i];
      if (!item) return;
      if (d.kind === 'row' && d.bend) {
        // A bend point where the line was grabbed, following the pointer up and down. The line
        // stays where it was a few pixels to each side (unless bent there already): a bend is a
        // bump, e.g. one per shoulder.
        const at = within(Math.round(d.x), 0, pf.w);
        const reach = Math.max(3, Math.round(pf.w / 10));
        const place = rowPlace(item, key);
        const pins = [];
        if (!item.bend.some(([bx]) => bx >= at - reach && bx < at - 1) && at - reach >= 0) pins.push([at - reach, Math.round(lineY(item, key, at - reach) - place)]);
        if (!item.bend.some(([bx]) => bx <= at + reach && bx > at + 1) && at + reach <= pf.w) pins.push([at + reach, Math.round(lineY(item, key, at + reach) - place)]);
        item.bend = [...item.bend.filter(([bx]) => Math.abs(bx - at) > 1), ...pins, [at, Math.round(p.y) - place]].sort((u, v) => u[0] - v[0]);
      } else if (d.kind === 'row') setRowPlace(item, key, within(d.start.y + dy, 0, pf.h));
      else if (d.kind === 'col') item.x = within(d.start.x + dx, 0, pf.w);
      else if (d.part === 'corner') {
        item.w = Math.max(1, d.start.w + dx);
        item.h = Math.max(1, d.start.h + dy);
      } else {
        item.x = d.start.x + dx;
        item.y = d.start.y + dy;
      }
    }, { panel: false });
  });
  canvas.addEventListener('pointerdown', (e) => {
    const sheet = $('layer-sheet').value;
    if (e.button !== 0 || !stretchView || !stretchEditing(sheet)) return;
    e.stopImmediatePropagation();
    canvas.focus();
    const p = stretchPoint(e);
    const hit = stretchHit(sheet, p);
    if (!hit) {
      stretchPick = null;
      renderTaller();
      drawFocus();
      return;
    }
    const item = stretchOf(sheet)[LISTS[hit.kind]][hit.i];
    stretchPick = { kind: hit.kind, i: hit.i };
    stretchDrag = {
      kind: hit.kind, part: hit.part, x: p.x, y: p.y, bend: hit.kind === 'row' && e.shiftKey,
      start: hit.kind === 'row' ? { y: rowPlace(item, focusFrameKey(sheet)) } : { ...item },
    };
    canvas.setPointerCapture(e.pointerId);
    renderTaller();
    drawFocus();
  });
  const endStretch = () => {
    if (!stretchDrag) return;
    stretchDrag = null;
    renderTaller();
  };
  canvas.addEventListener('pointerup', endStretch);
  canvas.addEventListener('pointercancel', endStretch);
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !focusKey() || focusExtraId) return;
    canvas.focus();
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('dragging');
    drag = { x: e.clientX, y: e.clientY, dx: 0, dy: 0 };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    // Screen pixels to image pixels: the canvas may be shown smaller than it is.
    const scale = focusZoom * (canvas.getBoundingClientRect().width / canvas.width || 1);
    const dx = Math.round((e.clientX - drag.x) / scale);
    const dy = Math.round((e.clientY - drag.y) / scale);
    if (dx === drag.dx && dy === drag.dy) return;
    focusNudge(dx - drag.dx, dy - drag.dy);
    drag.dx = dx;
    drag.dy = dy;
  });
  const end = () => {
    drag = null;
    canvas.classList.remove('dragging');
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}
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
/** A built-in sheet's own options: {off, name}. */
const sheetOption = (sheet) => state.settings.sheetOptions?.[sheet] || {};
const sheetOn = (sheet) => !sheetOption(sheet).off && !sheetOption(sheet).removed;
/** The sheet whose parts a built-in sheet is made of: its own unless picked otherwise. */
const sheetBase = (sheet) => sheetOption(sheet).base || sheet;
const sheetLabel = (sheet) => sheetOption(sheet).name || SHEET_NAMES[sheet];
/** Sheets added in Sheet templates: {id, base, name, off, fw, fh, cols, rows}. */
const extraSheets = () => state.settings.extraSheets || [];

/** Every added sheet with an id of its own (sheets copied twice, e.g. by a setup, become one). */
function tidyExtraSheets() {
  const list = state.settings.extraSheets;
  if (!Array.isArray(list)) return;
  const seen = new Set();
  state.settings.extraSheets = list.filter((x) => {
    if (!x || typeof x !== 'object') return false;
    x.id ||= newSheetKey();
    if (seen.has(x.id)) return false;
    seen.add(x.id);
    return true;
  });
}
const newSheetKey = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** "Sheet 3": the first number no added sheet is called yet. */
function newSheetName() {
  const names = new Set(extraSheets().map((x) => x.name));
  let n = extraSheets().length + 1;
  while (names.has(`Sheet ${n}`)) n++;
  return `Sheet ${n}`;
}
/** The settings an extra sheet is drawn with: its base sheet, with the extra sheet's template. */
function extraSettings(x) {
  const template = x.fw > 0 && x.fh > 0 ? { fw: x.fw, fh: x.fh, cols: x.cols, rows: x.rows } : undefined;
  return { ...state.settings, templates: { ...(state.settings.templates || {}), [x.base]: template } };
}

/** The whole portrait, at the size its parts are (not a sheet template's). */
function wholePortrait(byId = gradientsById(), character = state.character) {
  return composeSheet('FG', character, state.library, byId, { ...state.settings, templates: { ...(state.settings.templates || {}), FG: undefined } });
}

/** The size a cropped portrait is made: the sheet's width and height, else the box as it is. */
function cropOutput(crop, t) {
  const w = t?.fw > 0 ? t.fw : t?.fh > 0 ? t.fh : Math.round(crop.w) || 144;
  return { w, h: t?.fh > 0 ? t.fh : w };
}

/**
 * A portrait sheet cut out of the whole portrait (e.g. the 144 x 144 face from a full-body
 * picture): the crop box, made the sheet's size, repeated in every cell of a grid.
 */
function croppedPortrait(crop, t, byId, character = state.character) {
  const full = wholePortrait(byId, character);
  if (!full.image) return full;
  const out = cropOutput(crop, t);
  const one = cropScale(full.image, cropBox(crop, full.image.width, full.image.height, out.w, out.h), out.w, out.h);
  const cols = t?.cols || 1;
  const rows = t?.rows || 1;
  if (cols * rows === 1) return { image: one, problems: full.problems, frame: null };
  const image = createImage(out.w * cols, out.h * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      for (let y = 0; y < out.h; y++) image.data.set(one.data.subarray(y * out.w * 4, (y + 1) * out.w * 4), ((r * out.h + y) * image.width + c * out.w) * 4);
    }
  }
  return { image, problems: full.problems, frame: { w: out.w, h: out.h, cols, rows } };
}

// 8 directions: the diagonals are drawn like the walk sheet, from each picture's diagonal rows: its
// own (a part made with 8 rows) or, for a part with 4 directions, made from its 4 directions: turned
// (the front or back picture turned toward the side, see dir8.js), or the side each diagonal faces.
// Parts on the front of the face turn further than the head they are on (see diagonalsOf).
const FACE_PARTS = new Set(['Eyes', 'Eyebrows', 'Nose', 'Mouth', 'FacialMark', 'Glasses']);
// The rest of the head: going up, its side peeks out (an ear, a cheek); the body's doesn't.
const HEAD_PARTS = new Set(['Face', 'Ears', 'BeastEars', 'Beard']);
const diagonalKind = (part) => (FACE_PARTS.has(part) ? 'face' : HEAD_PARTS.has(part) ? 'head' : null);
const diagonalPictures = new Map();
function diagonalOf(ref, mode, kind = null) {
  if (!ref?.pixels) return null;
  if (ref.diagonal) return ref.diagonal;
  const key = `${DIAGONAL_MODES[mode] ? mode : 'turned'}:${kind || 'body'}`;
  if (!diagonalPictures.has(key)) diagonalPictures.set(key, new WeakMap());
  const cache = diagonalPictures.get(key);
  let d = cache.get(ref.pixels);
  if (!d) cache.set(ref.pixels, (d = diagonalsOf(ref.pixels, mode, kind)));
  return d;
}
function diagonalRef(ref, mode, kind = null) {
  if (!ref) return ref;
  // A different path: pictures cut into pieces are cached by path.
  const d = Object.defineProperty({ ...ref, path: `${ref.path}#diagonal-${mode || 'turned'}-${kind || 'body'}` }, 'pixels', { get: () => diagonalOf(ref, mode, kind), enumerable: true });
  // A piece of the part is cut out of the picture first, then turned (compose.js: turnedPiece).
  if (!ref.diagonal) Object.defineProperties(d, { source: { value: ref }, warp: { value: (image) => diagonalsOf(image, mode, kind) } });
  return d;
}
/** The library as the diagonals see it: walk pictures swapped for their diagonal rows. */
function diagonalLibrary(mode = 'turned') {
  const swap = (v) => v && { ...v, layers: v.layers.map((l) => {
    if (l.sheet !== 'TV' || l.vxace) return l;
    const kind = diagonalKind(l.part || v.part);
    return { ...l, base: diagonalRef(l.base, mode, kind), mask: diagonalRef(l.mask, mode, kind), paint: diagonalRef(l.paint, mode, kind) };
  }) };
  return { ...state.library, variants: { get: (id) => swap(state.library.variants.get(id)), has: (id) => state.library.variants.has(id) } };
}

/** Shows the sheets' names, and hides the ones turned off, in the preview and the export. */
function showSheetOptions() {
  for (const sheet of SHEET_KEYS) {
    const on = sheetOn(sheet);
    const figure = document.querySelector(`#preview figure[data-sheet="${sheet}"]`);
    if (figure) {
      figure.hidden = !on;
      figure.querySelector('.sheet-label').textContent = sheetLabel(sheet);
    }
    const button = document.querySelector(`#export-buttons [data-export="${sheet}"]`);
    button.hidden = !on;
    button.textContent = sheetLabel(sheet);
  }
  for (const b of document.querySelectorAll('#export-buttons [data-export^="extra:"]')) b.remove();
  const all = document.querySelector('#export-buttons [data-export="all"]');
  for (const x of extraSheets().filter((s) => !s.off)) {
    const button = el('button', { type: 'button', className: exportPick.has(`extra:${x.id}`) ? 'on' : '', textContent: x.name || 'Sheet', title: WALK_LAYOUTS[x.base] ? `Your walk sheet for ${WALK_LAYOUTS[x.base].note}` : `Your sheet, from the ${SHEET_NAMES[x.base]} parts` });
    button.dataset.export = `extra:${x.id}`;
    all.before(button);
  }
}

/** A sheet just added in Sheet templates: its preview is scrolled into view once drawn. */
let newSheetId = null;

/** The extra sheets in the preview: the whole sheet, or why there is nothing to see yet. */
function renderExtraPreviews() {
  $('extra-previews').replaceChildren(...(state.extraComposites || []).map((x) => {
    const from = x.sheet.base === 'DIR8' && x.sheet.onlyDiagonals ? 'only the diagonals: down-left, down-right, up-left, up-right'
      : WALK_LAYOUTS[x.sheet.base] ? WALK_LAYOUTS[x.sheet.base].note : `from the ${SHEET_NAMES[x.sheet.base]} parts`;
    const big = x.image && toCanvas(x.image);
    if (big) {
      big.title = 'Click: a close up of this sheet';
      big.classList.add('zoomable');
      big.addEventListener('click', () => openExtraFocus(x.sheet.id));
    }
    const figure = el('figure', { className: 'wide' }, [
      x.image ? big
        : el('div', { className: 'empty-sheet muted small', textContent: x.error ? `Could not be drawn: ${x.error}` : `Nothing to draw yet: no ${SHEET_NAMES[WALK_LAYOUTS[x.sheet.base] ? 'TV' : x.sheet.base]} parts are worn.` }),
      el('figcaption', { textContent: x.image ? `${x.sheet.name || 'Sheet'} (${x.image.width} x ${x.image.height}, ${from})` : `${x.sheet.name || 'Sheet'} (${from})` }),
    ]);
    if (x.sheet.id === newSheetId) {
      newSheetId = null;
      figure.classList.add('just-added');
      requestAnimationFrame(() => figure.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    }
    return figure;
  }));
}

function sheetsChanged() {
  tidyExtraSheets();
  saveSettings();
  showSheetOptions();
  if (state.character) renderPreview();
}

// ---------- frame sizes: parts made for bigger (or smaller) frames than the sheet's ----------

/** Picture sizes of sprite parts (read from the file header, kept on the picture's ref), up to `limit` per folder. */
async function spriteSizes(packName = null, limit = 300) {
  const byPack = new Map();
  for (const v of state.library.variants.values()) {
    if (packName && v.pack !== packName) continue;
    const refs = byPack.get(v.pack) || [];
    byPack.set(v.pack, refs);
    if (refs.length >= limit) continue;
    for (const l of v.layers) if (l.base && !l.vxace && !l.base.layout && SHEETS[l.sheet]?.frame) refs.push([l.sheet, l.base]);
  }
  const sizes = [];
  for (const [sheet, ref] of [...byPack.values()].flat()) {
    if (!ref.size) ref.size = ref.pixels ? { w: ref.pixels.width, h: ref.pixels.height } : await pngSize(ref.src).catch(() => null);
    if (ref.size) sizes.push({ sheet, ...ref.size });
  }
  return sizes;
}

/** The frame each sprite sheet uses now: its template, else what the preview drew, else RPG Maker's. */
function currentFrames() {
  return Object.fromEntries(['TV', 'TVD', 'SV'].map((sheet) => {
    const t = state.settings.templates?.[sheet];
    const f = t?.fw > 0 && t?.fh > 0 ? { w: t.fw, h: t.fh } : state.composites[sheet]?.frame || SHEETS[sheet].frame;
    return [sheet, { w: f.w, h: f.h }];
  }));
}

async function findFrameHints(packName = null) {
  const covered = new Set(extraSheets().filter((x) => x.fw && x.fh).map((x) => `${x.base}|${x.fw}|${x.fh}`));
  return frameHints(await spriteSizes(packName), currentFrames(), covered);
}

/** After opening a folder: say when its sprites have other frame sizes than the sheets. */
function offerFrameHints(packName) {
  findFrameHints(packName).then((hints) => {
    if (!hints.length) return;
    const h = hints[0];
    // After the "Added ..." message has been read.
    setTimeout(() => toast(`"${packName}" has ${SHEET_NAMES[h.sheet].toLowerCase()} parts with ${h.w} × ${h.h} frames${hints.length > 1 ? ' (and other sizes)' : ''}: not your sheet's size.`, 10000,
      { label: 'Suggest a sheet', run: () => $('open-templates').click() }), 4500);
  }).catch((e) => console.error(e));
}

/** Sheet templates: a row per frame size found in the parts, to use it or add it as a sheet. */
async function renderFrameHints() {
  const box = $('template-hints');
  const hints = await findFrameHints();
  const frames = currentFrames();
  box.replaceChildren(...hints.slice(0, 6).map((h) => {
    const name = SHEET_NAMES[h.sheet];
    const use = el('button', { type: 'button', className: 'small-button', textContent: `Use for ${name}`, title: `${name}: frames of ${h.w} x ${h.h}, ${h.cols} x ${h.rows}` });
    use.addEventListener('click', () => {
      (state.settings.templates ||= {})[h.sheet] = { fw: h.w, fh: h.h, cols: h.cols, rows: h.rows };
      saveSettings();
      renderTemplates();
      renderFrameHints();
      if (state.character) renderPreview();
    });
    const add = el('button', { type: 'button', className: 'small-button', textContent: 'Add as a sheet', title: `Another ${name.toLowerCase()} sheet with ${h.w} x ${h.h} frames; yours stays as it is` });
    add.addEventListener('click', () => {
      const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
      (state.settings.extraSheets ||= []).push({ id, base: h.sheet, name: `${name} ${h.w}x${h.h}`, fw: h.w, fh: h.h, cols: h.cols, rows: h.rows });
      newSheetId = id;
      sheetsChanged();
      renderTemplates();
      renderFrameHints();
    });
    return el('div', { className: 'template-hint' }, [
      el('span', { textContent: `${h.count} ${name.toLowerCase()} picture${h.count > 1 ? 's' : ''} with ${h.w} × ${h.h} frames (${h.cols} × ${h.rows}); your ${name} sheet: ${frames[h.sheet].w} × ${frames[h.sheet].h}.` }),
      use, add,
    ]);
  }));
  box.hidden = !hints.length;
}

function renderTemplates() {
  const t = state.settings.templates || {};
  const number = (value, placeholder, save) => {
    const i = el('input', { type: 'number', min: 1, max: 1024, value: value || '', placeholder: 'auto', title: `${placeholder}; empty: automatic`, className: 'tpl-num' });
    i.addEventListener('change', () => save(Math.max(0, Math.min(1024, Math.round(Number(i.value) || 0))) || undefined));
    return i;
  };
  const partsSelect = (value, onChange, xp = false) => {
    const select = el('select', { title: 'Which parts it is made of. XP: the walk sheet as 4 x 4 frames (stand, step, stand, other step)' }, [
      ...SHEET_KEYS.map((s) => el('option', { value: s, textContent: `${SHEET_NAMES[s]} parts`, selected: s === value })),
      ...(xp ? Object.entries(WALK_LAYOUTS).map(([key, w]) => el('option', { value: key, textContent: w.label, selected: value === key })) : []),
    ]);
    select.addEventListener('change', () => onChange(select.value));
    return select;
  };
  /** One row: on, name, parts, width, height, columns, rows, Remove. Every sheet alike. */
  const row = ({ on, onToggle, name, placeholder, onName, base, onBase, size, onSize, onRemove, onCrop = null, cropped = false, xp = false, diagonals = null, onlyDiagonals = false, onOnlyDiagonals = null, onDiagonals = null }) => {
    const tick = el('input', { type: 'checkbox', checked: on, title: 'Untick to leave it out of the preview and the export' });
    tick.addEventListener('change', () => onToggle(tick.checked));
    const nameBox = el('input', { type: 'text', className: 'tpl-name', value: name || '', placeholder, title: 'Its name in the preview and on the export button' });
    nameBox.addEventListener('change', () => onName(nameBox.value.trim()));
    const remove = el('button', { type: 'button', className: 'small-button', textContent: 'Remove', title: 'Take this sheet out of the list' });
    remove.addEventListener('click', onRemove);
    const actions = [remove];
    if (base === 'FG' && onCrop) {
      const crop = el('button', { type: 'button', className: `small-button${cropped ? ' active' : ''}`, textContent: cropped ? 'Cropped' : 'Crop…',
        title: 'Cut it out of the whole portrait: pick the part (e.g. the face of a full-body picture); Width and Height set the size it is made' });
      crop.addEventListener('click', onCrop);
      actions.unshift(crop);
    }
    // 8 directions: how the diagonals of parts drawn in 4 directions are made.
    if (base === 'DIR8' && onDiagonals) {
      const pick = el('select', { className: 'tpl-diagonals', title: 'Diagonals of parts drawn in 4 directions. Turned: the front (or back) turned toward the side, in one outline; going up, the side of the face peeks out. Turned more: further. Subtle: barely turned, a few pixels, so the drawing stays as it is. Side view: the side each diagonal faces' },
        Object.entries(DIAGONAL_MODES).map(([key, m]) => el('option', { value: key, textContent: `Diagonals: ${m.label}`, selected: (diagonals || 'turned') === key })));
      pick.addEventListener('change', () => onDiagonals(pick.value));
      const only = el('input', { type: 'checkbox', className: 'tpl-only-diagonals', checked: !!onlyDiagonals });
      only.addEventListener('change', () => onOnlyDiagonals(only.checked));
      actions.unshift(pick, el('label', { className: 'lock small', title: 'Leave out the walk rows (down, left, right, up): the sheet is just the 4 diagonals, down-left, down-right, up-left, up-right' }, [only, ' Only the diagonals']));
    }
    return [tick, nameBox, partsSelect(base, onBase, xp),
      ...['fw', 'fh', 'cols', 'rows'].map((f, k) => number(size?.[f], ['width', 'height', 'columns', 'rows'][k], (v) => onSize(f, v))),
      el('div', { className: 'tpl-actions' }, actions)];
  };
  const head = ['', 'Name', 'Made of', 'Width', 'Height', 'Columns', 'Rows', ''].map((text) => el('span', { className: 'tpl-head', textContent: text }));
  const builtIn = SHEET_KEYS.filter((sheet) => !sheetOption(sheet).removed).flatMap((sheet) => {
    const options = () => ((state.settings.sheetOptions ||= {})[sheet] ||= {});
    return row({
      on: sheetOn(sheet),
      onToggle: (on) => { options().off = !on || undefined; sheetsChanged(); },
      name: sheetOption(sheet).name, placeholder: SHEET_NAMES[sheet],
      onName: (v) => { options().name = v || undefined; sheetsChanged(); },
      base: sheetBase(sheet),
      onBase: (v) => { options().base = v === sheet ? undefined : v; sheetsChanged(); renderTemplates(); },
      size: t[sheet],
      onSize: (field, v) => {
        const templates = (state.settings.templates ||= {});
        const entry = (templates[sheet] ||= {});
        entry[field] = v;
        if (!Object.values(entry).some(Boolean)) delete templates[sheet];
        saveSettings();
        if (state.character) renderPreview();
      },
      onRemove: () => { options().removed = true; sheetsChanged(); renderTemplates(); },
      cropped: !!sheetOption(sheet).crop,
      onCrop: () => openCrop(sheetLabel(sheet), () => sheetOption(sheet).crop, (c) => { options().crop = c || undefined; }, () => state.settings.templates?.[sheet]),
    });
  });
  const extras = extraSheets().flatMap((x) => row({ xp: true,
    on: !x.off,
    onToggle: (on) => { x.off = !on || undefined; sheetsChanged(); },
    name: x.name, placeholder: 'name',
    onName: (v) => { x.name = v || 'Sheet'; sheetsChanged(); },
    base: x.base,
    onBase: (v) => { x.base = v; sheetsChanged(); renderTemplates(); },
    size: x,
    onSize: (field, v) => { x[field] = v; sheetsChanged(); },
    // By id: the list may have been read again since this row was drawn (a setup, another tab).
    onRemove: () => { state.settings.extraSheets = extraSheets().filter((s) => s.id !== x.id && s !== x); sheetsChanged(); renderTemplates(); },
    cropped: !!x.crop,
    onCrop: () => openCrop(x.name || 'Sheet', () => x.crop, (c) => { x.crop = c || undefined; }, () => x),
    diagonals: x.diagonals,
    onDiagonals: (v) => { x.diagonals = v === 'turned' ? undefined : v; sheetsChanged(); },
    onlyDiagonals: x.onlyDiagonals,
    onOnlyDiagonals: (v) => { x.onlyDiagonals = v || undefined; sheetsChanged(); },
  }));
  $('template-grid').replaceChildren(...head, ...builtIn, ...extras);
  const removed = SHEET_KEYS.filter((s) => sheetOption(s).removed);
  $('restore-sheets').hidden = !removed.length;
  $('restore-sheets').textContent = `Bring back ${removed.map((s) => SHEET_NAMES[s]).join(', ')}`;
}
// ---------- crop: a portrait sheet cut out of the whole portrait ----------

/** The sheet being cropped: {label, get, set, template}. */
let cropping = null;
const CROP_VIEW = 360;

function openCrop(label, get, set, template) {
  if (!state.character) return;
  cropping = { label, get, set, template };
  $('crop-title').textContent = `Crop: ${label}`;
  drawCrop(true);
  $('crop-dialog').showModal();
}

/** Draws the whole portrait with the box on it, and what the sheet becomes. */
function drawCrop(resetSlider = false) {
  const full = wholePortrait().image;
  const canvas = $('crop-canvas');
  if (!full || !cropping) {
    canvas.width = canvas.height = 0;
    $('crop-note').textContent = 'No portrait to crop: wear portrait parts first.';
    return;
  }
  const out = cropOutput(cropping.get() || { w: 144 }, cropping.template());
  const box = cropBox(cropping.get(), full.width, full.height, out.w, out.h);
  const scale = Math.min(CROP_VIEW / full.width, CROP_VIEW / full.height, 4);
  canvas.width = Math.round(full.width * scale);
  canvas.height = Math.round(full.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = scale < 1;
  ctx.drawImage(toCanvas(full), 0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, canvas.height);
  ctx.rect(box.x * scale, box.y * scale, box.w * scale, box.h * scale);
  ctx.fill('evenodd');
  ctx.strokeStyle = '#ffd34d';
  ctx.lineWidth = 2;
  ctx.strokeRect(box.x * scale + 1, box.y * scale + 1, box.w * scale - 2, box.h * scale - 2);
  cropping.view = { scale, box, full, out };
  const result = $('crop-result');
  result.width = out.w;
  result.height = out.h;
  result.getContext('2d').putImageData(new ImageData(cropScale(full, box, out.w, out.h).data, out.w, out.h), 0, 0);
  const most = Math.min(full.width, Math.floor(full.height / (out.h / out.w)));
  if (resetSlider) {
    $('crop-size').max = most;
    $('crop-size').value = box.w;
  }
  $('crop-note').textContent = `Whole portrait ${full.width} × ${full.height}; the box is ${box.w} × ${box.h}, made ${out.w} × ${out.h}${cropping.template()?.fw ? '' : ' (set Width and Height in Sheet templates to make it another size)'}.`;
}

let cropRedraw = 0;
function setCrop(crop) {
  cropping.set(crop);
  saveSettings();
  drawCrop();
  cancelAnimationFrame(cropRedraw);
  cropRedraw = requestAnimationFrame(() => {
    renderTemplates();
    if (state.character) renderPreview();
  });
}

$('crop-canvas').addEventListener('pointerdown', (e) => {
  const v = cropping?.view;
  if (!v) return;
  const canvas = e.currentTarget;
  canvas.setPointerCapture(e.pointerId);
  const at = (ev) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((ev.clientX - r.left) * (canvas.width / r.width)) / v.scale, y: ((ev.clientY - r.top) * (canvas.height / r.height)) / v.scale };
  };
  const start = at(e);
  const inside = start.x >= v.box.x && start.x < v.box.x + v.box.w && start.y >= v.box.y && start.y < v.box.y + v.box.h;
  // Grabbing the box moves it; clicking elsewhere puts its middle there.
  const grab = inside ? { x: start.x - v.box.x, y: start.y - v.box.y } : { x: v.box.w / 2, y: v.box.h / 2 };
  const move = (ev) => {
    const p = at(ev);
    setCrop({ x: Math.round(p.x - grab.x), y: Math.round(p.y - grab.y), w: v.box.w });
  };
  move(e);
  const up = () => {
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
  };
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
});
$('crop-size').addEventListener('input', (e) => {
  const v = cropping?.view;
  if (!v) return;
  const w = Number(e.target.value);
  // Grows and shrinks around its middle.
  setCrop({ x: Math.round(v.box.x + (v.box.w - w) / 2), y: Math.round(v.box.y + (v.box.h - (w * v.out.h) / v.out.w) / 2), w });
});
$('crop-reset').addEventListener('click', () => {
  setCrop(null);
  drawCrop(true);
});

$('restore-sheets').addEventListener('click', () => {
  for (const s of SHEET_KEYS) if (state.settings.sheetOptions?.[s]) delete state.settings.sheetOptions[s].removed;
  sheetsChanged();
  renderTemplates();
});
$('add-sheet').addEventListener('click', () => {
  tidyExtraSheets();
  const name = newSheetName();
  const list = (state.settings.extraSheets ||= []);
  const id = newSheetKey();
  list.push({ id, base: 'TV', name });
  newSheetId = id;
  sheetsChanged();
  renderTemplates();
});
tidyExtraSheets();
renderTemplates();
showSheetOptions();

// What pictures are drawn on: a light or plain background shows small, dark parts.
const showPicBg = () => {
  if (state.settings.picBg) document.documentElement.dataset.picBg = state.settings.picBg;
  else delete document.documentElement.dataset.picBg;
  $('pic-bg').value = state.settings.picBg || '';
  const colour = state.settings.picBgColour || '#3a6ea5';
  document.documentElement.style.setProperty('--pic-bg-custom', colour);
  $('pic-bg-colour').value = colour;
  $('pic-bg-colour').hidden = state.settings.picBg !== 'custom';
};
$('pic-bg-colour').addEventListener('input', (e) => {
  state.settings.picBgColour = e.target.value;
  saveSettings();
  showPicBg();
});
showPicBg();
$('pic-bg').addEventListener('change', (e) => {
  state.settings.picBg = e.target.value || undefined;
  saveSettings();
  showPicBg();
});

for (const [id, setting] of [['make-room', 'makeRoom'], ['fit-frame', 'fitFrame'], ['smooth-pixels', 'smoothPixels'], ['no-shift', 'noShift']]) {
  $(id).checked = !!state.settings[setting];
  $(id).addEventListener('change', (e) => {
    state.settings[setting] = e.target.checked;
    saveSettings();
    if (state.character) renderPreview();
  });
}

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

// ---------- export: pick the sheets and the kind, then Export now ----------


function renderExport() {
  for (const b of $('export-buttons').querySelectorAll('[data-export]')) b.classList.toggle('on', exportPick.has(b.dataset.export));
  for (const b of $('export-format').querySelectorAll('[data-format]')) b.classList.toggle('on', b.dataset.format === exportFormat);
  const unite = $('export-for').value === 'unite';
  $('export-format-box').hidden = unite;
  $('export-shift-box').hidden = unite;
  $('no-shift-box').hidden = exportFormat === 'gif';
  $('export-note').textContent = unite
    ? 'A zip with a folder per sheet: one picture per animation, its frames side by side, as RPG Maker Unite takes them.'
    : exportFormat === 'gif' ? 'Portraits are still pictures: they are left out of GIFs.' : '';
}

// ---------- where Export saves ----------
// Chrome/Edge: a folder picked once (remembered); other browsers: their download folder.
let exportDir = null;
let exportDirLoaded = false;
async function loadExportDir() {
  if (!exportDirLoaded && canRememberFolders) exportDir = await exportFolder();
  exportDirLoaded = true;
}
function exportPlace() {
  return exportDir ? `the folder "${exportDir.name}"` : 'your Downloads folder';
}
function renderExportDest() {
  $('export-dest').textContent = exportDir ? `the folder "${exportDir.name}"` : 'your Downloads folder (the browser\'s download location)';
  $('export-pick-folder').hidden = !canRememberFolders;
  $('export-pick-folder').textContent = exportDir ? 'Change folder…' : 'Choose folder…';
  $('export-to-downloads').hidden = !exportDir;
  if (!canRememberFolders) $('export-dest').title = 'This browser always saves to its download folder: change it in the browser\'s settings, or use Chrome or Edge to pick a folder here';
}
$('export-pick-folder').addEventListener('click', async () => {
  try {
    exportDir = await window.showDirectoryPicker({ id: 'xgen-export', mode: 'readwrite' });
  } catch {
    return; // cancelled
  }
  await setExportFolder(exportDir);
  renderExportDest();
});
$('export-to-downloads').addEventListener('click', async () => {
  exportDir = null;
  await setExportFolder(null);
  renderExportDest();
});
let exportDenied = false;
/** Saves a file where Export saves: the folder picked, or the download folder. */
async function exportBlob(blob, fileName) {
  if (exportDir && !exportDenied) {
    try {
      const opts = { mode: 'readwrite' };
      if ((await exportDir.queryPermission(opts)) !== 'granted' && (await exportDir.requestPermission(opts)) !== 'granted') throw new Error('not allowed');
      const file = await exportDir.getFileHandle(fileName, { create: true });
      const out = await file.createWritable();
      await out.write(blob);
      await out.close();
      return;
    } catch (err) {
      // Not allowed or gone: the rest goes to the download folder.
      exportDenied = true;
      toast(`Could not save in "${exportDir.name}" (${err.message}): saved to your Downloads folder instead.`, 8000);
    }
  }
  downloadBlob(blob, fileName);
}
function exportImage(image, fileName) {
  return new Promise((resolve) => toCanvas(image).toBlob((blob) => resolve(exportBlob(blob, fileName)), 'image/png'));
}

async function openExport() {
  await loadExportDir();
  renderExportDest();
  showSheetOptions(); // the sheets added since, as buttons
  $('export-for').value = state.settings.exportFor || 'rm';
  renderExport();
  $('export-dialog').showModal();
}
$('export-images').addEventListener('click', openExport);
$('export-for').addEventListener('change', () => {
  state.settings.exportFor = $('export-for').value;
  saveSettings();
  renderExport();
});
// All, or any number of sheets: picking a sheet turns All off, picking All turns the rest off.
$('export-buttons').addEventListener('click', (e) => {
  const pick = e.target.closest('[data-export]')?.dataset.export;
  if (!pick) return;
  if (pick === 'all') {
    exportPick.clear();
    exportPick.add('all');
  } else {
    exportPick.delete('all');
    if (exportPick.has(pick)) exportPick.delete(pick);
    else exportPick.add(pick);
    // Every sheet picked one by one is All.
    const each = [...$('export-buttons').querySelectorAll('[data-export]')].filter((b) => !b.hidden).map((b) => b.dataset.export).filter((k) => k !== 'all');
    if (!exportPick.size || each.every((k) => exportPick.has(k))) {
      exportPick.clear();
      exportPick.add('all');
    }
  }
  renderExport();
});
// Static PNG or animated GIF: one or the other.
$('export-format').addEventListener('click', (e) => {
  const format = e.target.closest('[data-format]')?.dataset.format;
  if (!format) return;
  exportFormat = format;
  renderExport();
});
$('export-now').addEventListener('click', async () => {
  const want = (key) => exportPick.has('all') || exportPick.has(key);
  exportDenied = false;
  // Asked right away, while the click still counts: browsers ask again after a reload.
  if (exportDir) await exportDir.requestPermission({ mode: 'readwrite' }).catch(() => {});
  $('export-dialog').close();
  if ($('export-for').value === 'unite') await exportUnite(want);
  else if (exportFormat === 'gif') exportGifs(want);
  else await exportPngs(want);
});

/** The export's Size: each pixel becomes this many pixels (1 = the original size). */
const exportZoom = () => Math.max(1, Number($('gif-zoom').value) || 1);

/** A picture enlarged `zoom` times, pixel for pixel (no smoothing). */
function enlarged(image, zoom) {
  if (zoom <= 1) return image;
  const out = createImage(image.width * zoom, image.height * zoom);
  for (let y = 0; y < out.height; y++) {
    const row = Math.floor(y / zoom) * image.width;
    for (let x = 0; x < out.width; x++) {
      const si = (row + Math.floor(x / zoom)) * 4;
      out.data.set(image.data.subarray(si, si + 4), (y * out.width + x) * 4);
    }
  }
  return out;
}

/** Show preview: each sheet picked at the original size (left) and at the size picked (right). */
let previewUrls = [];
$('export-preview').addEventListener('click', () => {
  const want = (key) => exportPick.has('all') || exportPick.has(key);
  const zoom = exportZoom();
  const gif = $('export-for').value !== 'unite' && exportFormat === 'gif';
  for (const u of previewUrls) URL.revokeObjectURL(u);
  previewUrls = [];
  const rows = [];
  const pair = (name, make) => {
    const figure = (z) => el('figure', {}, [make(z), el('figcaption', { className: 'muted small', textContent: z === 1 ? '1x (original)' : `${z}x` })]);
    rows.push(el('div', {}, [el('h4', { textContent: name }), el('div', { className: 'gif-compare' }, [figure(1), ...(zoom > 1 ? [figure(zoom)] : [])])]));
  };
  if (gif) {
    const gifs = [want('TV') && sheetOn('TV') && walkGif(), want('TVD') && sheetOn('TVD') && damageGif(), want('SV') && sheetOn('SV') && battlerGif()].filter(Boolean);
    for (const g of gifs) {
      pair(g.name, (z) => {
        const url = URL.createObjectURL(new Blob([g.make(z)], { type: 'image/gif' }));
        previewUrls.push(url);
        return el('img', { src: url, alt: g.name });
      });
    }
  } else {
    for (const key of SHEET_KEYS.filter((k) => sheetOn(k) && want(k))) {
      const c = state.composites[key];
      if (c?.image) pair(sheetLabel(key), (z) => toCanvas(enlarged(c.image, z)));
    }
    if ($('export-for').value !== 'unite') {
      for (const x of state.extraComposites || []) {
        if (x.image && want(`extra:${x.sheet.id}`)) pair(x.sheet.name || 'Sheet', (z) => toCanvas(enlarged(x.image, z)));
      }
    }
  }
  if (!rows.length) return toast(gif ? 'Nothing to animate: pick the walk, damage or battler.' : 'Nothing to show: no picked sheet has parts.');
  $('export-preview-title').textContent = zoom > 1 ? `Preview: 1x (original) and ${zoom}x` : 'Preview: 1x (original); pick a Size to compare';
  $('export-preview-list').replaceChildren(...rows);
  $('export-preview-dialog').showModal();
});

async function exportPngs(want) {
  const all = exportPick.has('all');
  const name = safeFileName(state.character.name);
  const zoom = exportZoom();
  const big = (file) => (zoom > 1 ? file.replace(/\.png$/, `_${zoom}x.png`) : file);
  let count = 0;
  for (const key of SHEET_KEYS.filter((k) => sheetOn(k) && want(k))) {
    const c = state.composites[key];
    if (!c) continue;
    await exportImage(enlarged(c.image, zoom), big(SHEET_FILE_NAMES[key](name)));
    count++;
  }
  for (const x of state.extraComposites || []) {
    if (!x.image || !want(`extra:${x.sheet.id}`)) continue;
    await exportImage(enlarged(x.image, zoom), big(`${name}_${safeFileName(x.sheet.name || 'sheet')}.png`));
    count++;
  }
  if (all) {
    await exportBlob(new Blob([currentCreditsText() + '\n'], { type: 'text/plain' }), `${name}_credits.txt`);
  }
  if (all && state.customGradients.length) {
    // Shifted source colours aren't gradients: RPG Maker can't use them.
    const exportable = state.customGradients.filter((g) => !g.shiftSource);
    if (exportable.length) await exportImage(gradientsToImage(exportable), `${name}_custom_gradients.png`);
  }
  toast(count ? `Saved ${count} image(s) to ${exportPlace()}.` : 'Nothing to export for these sheets: no selected part has layers for them.', 8000);
}

// ---------- animated GIFs ----------

/** The plain colour the pictures are on (Background), as [r, g, b]; null when it is checks or none. */
function gifBackground() {
  const named = { white: '#ffffff', grey: '#8a8a8a', green: '#3fbf5a', magenta: '#e040c0' };
  const hex = state.settings.picBg === 'custom' ? state.settings.picBgColour || '#3a6ea5' : named[state.settings.picBg];
  if (!hex) return null;
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

/**
 * GIF frames from a composed sheet: each animation step shows the given rows' frames side by side
 * (one row, or the four walk directions), enlarged `zoom` times.
 * @param {{image:object, frame:object}} composite
 * @param {number[][]} steps per step, the [col, row] of each frame shown side by side
 */
function gifOf(composite, steps, zoom) {
  const f = frameOf('', composite.image, composite.frame);
  const across = steps[0].length;
  const width = f.w * across * zoom;
  const height = f.h * zoom;
  const src = composite.image;
  const frames = steps.map((cells) => {
    const out = new Uint8ClampedArray(width * height * 4);
    cells.forEach(([col, row], n) => {
      for (let y = 0; y < height; y++) {
        const sy = row * f.h + Math.floor(y / zoom);
        for (let x = 0; x < f.w * zoom; x++) {
          const si = (sy * src.width + col * f.w + Math.floor(x / zoom)) * 4;
          out.set(src.data.subarray(si, si + 4), (y * width + n * f.w * zoom + x) * 4);
        }
      }
    });
    return out;
  });
  return encodeGif({ width, height, frames, delay: 180, background: gifBackground() });
}

/** Columns of one animation: RPG Maker's 3-frame walk goes 0, 1, 2, 1; other grids loop. */
const animationColumns = (cols) => (cols === 3 ? PATTERN : [...Array(cols).keys()]);

/** The walk GIF: the direction shown, or all four when All walk directions is ticked. */
function walkGif() {
  const walk = state.composites.TV;
  if (!walk) return null;
  const f = frameOf('TV', walk.image, walk.frame);
  const rows = $('walk-all').checked ? [...Array(f.rows).keys()] : [Math.min(state.walkDir, f.rows - 1)];
  const steps = animationColumns(f.cols).map((col) => rows.map((row) => [col, row]));
  const name = `${safeFileName(state.character.name)}_walk${rows.length > 1 ? '' : `_${DIRECTIONS[rows[0]]?.toLowerCase() || rows[0]}`}.gif`;
  return { name, make: (zoom) => gifOf(walk, steps, zoom) };
}

/** The battler GIF: the motion shown. */
function battlerGif() {
  const sv = state.composites.SV;
  if (!sv) return null;
  const f = frameOf('SV', sv.image, sv.frame);
  const m = state.svMotion;
  // RPG Maker's battler: 18 motions of 3 frames, in 2 blocks of 9 columns.
  const steps = f.cols === 9 && f.rows === 6
    ? PATTERN.map((k) => [[Math.floor(m / 6) * 3 + k, m % 6]])
    : animationColumns(f.cols).map((col) => [[col, m % f.rows]]);
  const motion = (SV_MOTIONS[m] || String(m)).toLowerCase();
  return { name: `${safeFileName(state.character.name)}_battler_${motion}.gif`, make: (zoom) => gifOf(sv, steps, zoom) };
}

/** The damage GIF: its poses one after another. */
function damageGif() {
  const d = state.composites.TVD;
  if (!d) return null;
  const f = frameOf('TVD', d.image, d.frame);
  const steps = [...Array(f.rows).keys()].flatMap((row) => [...Array(f.cols).keys()].map((col) => [[col, row]]));
  return { name: `${safeFileName(state.character.name)}_damage.gif`, make: (zoom) => gifOf(d, steps, zoom) };
}

function exportGifs(want) {
  const gifs = [
    want('TV') && sheetOn('TV') && walkGif(),
    want('TVD') && sheetOn('TVD') && damageGif(),
    want('SV') && sheetOn('SV') && battlerGif(),
  ].filter(Boolean);
  if (!gifs.length) return toast('Nothing to animate: pick the walk, damage or battler (portraits are still pictures).');
  saveGifs(gifs);
}

/**
 * Saves GIFs. Enlarged (size above 1x): the first is shown next to its original size first, to
 * save them or cancel.
 * @param {{name:string, make:(zoom:number) => Uint8Array}[]} gifs
 */
function saveGifs(gifs) {
  const zoom = exportZoom();
  const save = async () => {
    for (const g of gifs) await exportBlob(new Blob([g.make(zoom)], { type: 'image/gif' }), g.name);
    toast(`Saved ${gifs.map((g) => g.name).join(', ')} to ${exportPlace()}.`, 8000);
  };
  if (zoom === 1) return save();
  const urls = [1, zoom].map((z) => URL.createObjectURL(new Blob([gifs[0].make(z)], { type: 'image/gif' })));
  $('gif-before').src = urls[0];
  $('gif-after').src = urls[1];
  $('gif-after-label').textContent = `${zoom}x`;
  $('gif-preview-name').textContent = gifs.length > 1 ? `${gifs[0].name} (and ${gifs.length - 1} more)` : gifs[0].name;
  const dialog = $('gif-preview');
  dialog.returnValue = '';
  dialog.addEventListener('close', () => {
    for (const u of urls) URL.revokeObjectURL(u);
    if (dialog.returnValue === 'save') save();
  }, { once: true });
  dialog.showModal();
}

/** A picture as PNG bytes. */
function pngBytes(image) {
  return new Promise((resolve) => toCanvas(image).toBlob(async (blob) => resolve(new Uint8Array(await blob.arrayBuffer())), 'image/png'));
}

// RPG Maker Unite: every animation its own picture (frames side by side), all in one zip.
async function exportUnite(want = () => true) {
  const name = safeFileName(state.character.name);
  const strips = [];
  const walk = want('TV') && sheetOn('TV') && state.composites.TV;
  if (walk) {
    const f = frameOf('TV', walk.image, walk.frame);
    for (let row = 0; row < f.rows; row++) {
      strips.push([`${name}/walk_${(DIRECTIONS[row] || `row${row + 1}`).toLowerCase()}.png`, uniteStrip(walk.image, f, animationColumns(f.cols).map((col) => [col, row]))]);
    }
  }
  const sv = want('SV') && sheetOn('SV') && state.composites.SV;
  if (sv) {
    const f = frameOf('SV', sv.image, sv.frame);
    const motions = f.cols === 9 && f.rows === 6
      ? SV_MOTIONS.map((motion, m) => [motion, [0, 1, 2].map((k) => [Math.floor(m / 6) * 3 + k, m % 6])])
      : [...Array(f.rows).keys()].map((row) => [`row${row + 1}`, [...Array(f.cols).keys()].map((col) => [col, row])]);
    for (const [motion, cells] of motions) strips.push([`${name}/battler_${motion.toLowerCase()}.png`, uniteStrip(sv.image, f, cells)]);
  }
  const damage = want('TVD') && sheetOn('TVD') && state.composites.TVD;
  if (damage) {
    const f = frameOf('TVD', damage.image, damage.frame);
    strips.push([`${name}/damage.png`, uniteStrip(damage.image, f, [...Array(f.rows).keys()].flatMap((row) => [...Array(f.cols).keys()].map((col) => [col, row])))]);
  }
  if (want('FG') && sheetOn('FG') && state.composites.FG) strips.push([`${name}/portrait.png`, state.composites.FG.image]);
  if (!strips.length) return toast('Nothing to export: no sheet has parts.');
  await withBusy('Making the Unite pictures', async () => {
    const files = [];
    const zoom = exportZoom();
    for (const [file, image] of strips) files.push({ name: file, bytes: await pngBytes(enlarged(image, zoom)) });
    await exportBlob(new Blob([zipFiles(files)], { type: 'application/zip' }), `${name}_unite.zip`);
  });
  toast(`Saved ${name}_unite.zip to ${exportPlace()}: ${strips.length} pictures for Unite.`, 8000);
}

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
  editingGalleryId = null; // another character: saving adds it (Edit sets this again after loading)
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
