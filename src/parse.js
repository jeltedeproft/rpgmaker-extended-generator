// Turns a list of files (from a dropped/selected generator folder) into a part library.
// Pure: no DOM. File objects are stored as opaque `src` values and decoded later.

import { SHEETS, SLOT_BY_M, PART_ORDER, DEFAULT_SIZE, ALL_BODIES } from './format.js';
import { parseVxAcePath } from './vxace.js';
import { partsInWords, partNameWords, maskFit } from './suggest.js';

const PART_FILE_RE = /^(FG|TVD|TV|SV|icon)_([A-Za-z]+?)(\d*)_p([A-Za-z0-9-]+)((?:_[A-Za-z]+\d*)*)\.png$/i;
/** "TV_Body_p01 (2).png": the copy suffix Windows adds, and RPG Maker's DLC readme tells you to rename to. */
const COPY_SUFFIX_RE = /\s*\((\d+)\)(?=\.png$)/i;
const CANONICAL_PART = new Map(PART_ORDER.map((p) => [p.toLowerCase(), p]));
const GRADIENT_FILE_RE = /^(?:gradients|grad_([A-Za-z0-9]+))\.png$/i;
/** Text files kept with a pack for the credits list. */
export const TEXT_FILE_RE = /\.(txt|md)$/i;
const CREDIT_NAME_RE = /credit|licen[cs]e|terms|readme|copyright|author|about/i;

const SHEET_FOLDER_NAMES = new Set(
  [...Object.values(SHEETS).map((s) => s.folder), 'Variation', 'Generator'].map((n) => n.toLowerCase()),
);

/** Normalises a body type folder name: "male" -> "Male". */
function normaliseBodyType(name) {
  if (!name) return 'Default';
  const standard = ['Male', 'Female', 'Kid', 'Default'].find((b) => b.toLowerCase() === name.toLowerCase());
  if (standard) return standard;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Destinations exist independently of whether any parts have been assigned there yet. */
/** removed: empty folders the user removed; they come back when files are assigned to them. */
export function assignmentBodies(library, created = [], removed = []) {
  const names = new Set(['Male', 'Female', 'Kid', ...library.bodyTypes.keys(), ...created]);
  for (const file of library.unrecognized) {
    const dirs = file.path.split(/[\\/]/).slice(0, -1);
    const parent = dirs.at(-1);
    if (parent && SHEET_FOLDER_NAMES.has(dirs.at(-2)?.toLowerCase()) && !SHEET_FOLDER_NAMES.has(parent.toLowerCase())) {
      names.add(normaliseBodyType(parent));
    }
  }
  for (const name of removed || []) if (!library.bodyTypes.has(name)) names.delete(name);
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }) || (a < b ? -1 : a > b ? 1 : 0));
}

export function suggestedBody(dir, bodies) {
  for (const segment of dir.split(/[\\/]/).reverse()) {
    const match = bodies.find((b) => b === segment) || bodies.find((b) => b.toLowerCase() === segment.toLowerCase());
    if (match) return match;
  }
  return '';
}

export function newBodyName(value, bodies) {
  const name = value.trim();
  if (!name || /[\\/|]/.test(name) || ['.', '..'].includes(name) || SHEET_FOLDER_NAMES.has(name.toLowerCase())) return '';
  return suggestedBody(name, bodies) || normaliseBodyType(name);
}

/**
 * Parses one path, e.g. "Generator/TV/Male/TV_Clothing1_p03_c.png".
 * @returns {object|null} null when the name doesn't follow the generator convention.
 */
export function parsePartPath(path) {
  const segments = path.split(/[\\/]/).filter(Boolean);
  const rawName = segments[segments.length - 1];
  const copy = COPY_SUFFIX_RE.exec(rawName);
  const match = PART_FILE_RE.exec(rawName.replace(COPY_SUFFIX_RE, ''));
  if (!match) return null;

  const [, rawPrefix, rawPart, layerNumber, pid, suffixString] = match;
  const prefix = rawPrefix.toLowerCase() === 'icon' ? 'icon' : rawPrefix.toUpperCase();
  // "SV_body_p01" (RPG Maker's odd-eye bodies) is the same part as "SV_Body_p01".
  const name = CANONICAL_PART.get(rawPart.toLowerCase()) || rawPart;
  const parent = segments.length >= 2 ? segments[segments.length - 2] : '';
  const bodyType = SHEET_FOLDER_NAMES.has(parent.toLowerCase()) ? 'Default' : normaliseBodyType(parent);
  // A folder holding the body-type folders that isn't a sheet folder or the picked folder itself
  // marks a set of alternatives, e.g. odd-eye_bodies/left_green/Female/SV_body_p01.png.
  const grand = segments.length >= 4 ? segments[segments.length - 3] : '';
  const group = grand && !SHEET_FOLDER_NAMES.has(grand.toLowerCase()) && !SHEET_FOLDER_NAMES.has(parent.toLowerCase()) ? grand : '';
  const tags = [group, copy?.[1]].filter(Boolean);

  const result = {
    sheet: prefix === 'icon' ? null : prefix,
    isIcon: prefix === 'icon',
    part: name,
    layer: name + layerNumber,
    pid: 'p' + pid + (tags.length ? ` (${tags.join(', ')})` : ''),
    /**
     * The variant this one borrows missing sheets from: the plain part number for a set
     * ("p01 (left_green)"). A renamed copy ("p07 (2)", RPG Maker's fix for clashing DLC names) is a
     * different item, so it borrows nothing.
     */
    basePid: copy ? 'p' + pid + (tags.length ? ` (${tags.join(', ')})` : '') : 'p' + pid,
    bodyType,
    isMask: false,
    cell: null,
    slotId: null,
    unknownSuffixes: [],
  };

  const suffixes = suffixString.split('_').filter(Boolean);
  for (const suffix of suffixes) {
    const lower = suffix.toLowerCase();
    const c = /^c(\d*)$/.exec(lower);
    const m = /^m(\d+)$/.exec(lower);
    if (c && prefix === 'FG') {
      result.cell = 'c' + (c[1] || '1');
    } else if (c) {
      result.isMask = true;
    } else if (m) {
      const slot = SLOT_BY_M.get(Number(m[1]));
      if (slot) result.slotId = slot.id;
      else result.unknownSuffixes.push(suffix);
    } else {
      result.unknownSuffixes.push(suffix);
    }
  }
  if (prefix === 'FG' && !result.cell) result.cell = 'c1';
  return result;
}

const LENIENT_RE = /^(FG|TVD|TV|SV|icon)[_ -](.+)\.png$/i;
const MASK_SUFFIX_RE = /((?:_(?:c\d*|m\d+))*)$/i;
const KNOWN_PARTS_LONGEST_FIRST = [...PART_ORDER].sort((a, b) => b.length - a.length);
/** Other words packs use for a part, found anywhere in a name ("TV_FurClothes01" is clothing). */
const PART_WORDS = [
  ['Clothing', /clothing|clothes|cloth|outfit|armou?r|dress|robe|shirt/i],
  ['Cloak', /cloak|cape|mantle/i],
  ['Glasses', /glasses|goggles/i],
];
/** "TV_FurClothes01b.png" next to "TV_FurClothes01.png": the b (or "mask") file is its colour mask. */
const NAMED_MASK_RE = /^(.+?)(?:[_ -]?mask|_?b)\.png$/i;

/**
 * Reads names that skip the part number, e.g. "TV_ClothingEric.png" or "TV_FurClothes01.png" (part
 * Clothing, variation "Eric" / "Fur01") or "SV_Hat.png" (a new part "Hat"). Returns the strict name
 * it was read as, or null.
 */
export function lenientName(fileName) {
  // Typos seen in real packs: "TV_Clothing2_pXX.png.png", "FG_FrontHair_p17_c1].png".
  const cleaned = fileName.replace(COPY_SUFFIX_RE, '').replace(/(\.png)+$/i, '.png').replace(/[^A-Za-z0-9_. -]+/g, '');
  if (PART_FILE_RE.test(cleaned)) return cleaned;
  const match = LENIENT_RE.exec(cleaned);
  if (!match) return null;
  const prefix = match[1];
  const suffixes = MASK_SUFFIX_RE.exec(match[2])[1];
  const stem = match[2].slice(0, match[2].length - suffixes.length);
  // A part name at the start, written in one piece or apart: "RearHair01", "Rear_Hair_01", "rear hair2".
  let known = null;
  let afterKnown = 0;
  for (const p of KNOWN_PARTS_LONGEST_FIRST) {
    const m = new RegExp('^' + partNameWords(p).join('[_ -]*'), 'i').exec(stem);
    if (m) {
      known = p;
      afterKnown = m[0].length;
      break;
    }
  }
  // The words of a part name anywhere, in any order: "Hair_Rear_01", "Long_Beard".
  const tokens = stem.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+|(?<=[A-Za-z])(?=\d)|(?<=\d)(?=[A-Za-z])/).filter(Boolean);
  const inWords = !known && [...partsInWords(tokens.filter((t) => /^[A-Za-z]+$/.test(t)).map((t) => t.toLowerCase()), [], false)];
  let part;
  let rest;
  const word = !known && !(inWords?.length === 1) && PART_WORDS.find(([, re]) => re.test(stem));
  if (known) {
    part = known;
    rest = stem.slice(afterKnown);
  } else if (inWords?.length === 1) {
    const [[found, ws]] = inWords;
    part = found;
    const used = new Set(ws);
    rest = '_' + tokens.filter((t) => !used.has(t.toLowerCase().replace(/s$/, '')) && !used.has(t.toLowerCase())).join('-');
  } else if (word) {
    // The part word can sit anywhere: "FurClothes01" -> Clothing, variation "Fur01".
    part = word[0];
    rest = '_' + stem.replace(word[1], '');
  } else {
    const m = /^([A-Za-z]+)(.*)$/.exec(stem);
    if (!m) return null;
    [, part, rest] = m;
  }
  const layer = /^\d*/.exec(rest)[0];
  const pid = rest.slice(layer.length).replace(/^_p(?=[A-Za-z0-9])/i, '_').replace(/^[_ -]+/, '').replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || '01';
  return `${prefix}_${part}${layer}_p${pid}${suffixes}.png`;
}

/**
 * Builds a generator file name from its pieces (used to assign unrecognised files by hand).
 * @param {{sheet:string, part:string, layer?:string|number, pid:string, mask?:boolean, cell?:string, slotM?:number}} a
 */
export function buildPartName(a) {
  const pid = String(a.pid || '01').replace(/^p/i, '').replace(/[^A-Za-z0-9-]+/g, '-') || '01';
  const part = String(a.part).replace(/[^A-Za-z]+/g, '') || 'Part';
  let name = `${a.sheet}_${part}${a.layer ?? ''}_p${pid}`;
  if (a.sheet === 'FG') {
    name += `_${a.cell || 'c1'}`;
    if (a.slotM) name += `_m${String(a.slotM).padStart(3, '0')}`;
  } else if (a.mask) {
    name += '_c';
  }
  return name + '.png';
}

/** @returns {{category:string}|null} */
export function parseGradientPath(path) {
  const fileName = path.split(/[\\/]/).pop();
  const match = GRADIENT_FILE_RE.exec(fileName);
  if (!match) return null;
  return { category: match[1] ? match[1].toLowerCase() : 'all' };
}

export function createLibrary() {
  return {
    packs: [],
    /** @type {Map<string, {parts: Map<string, Map<string, object>>}>} */
    bodyTypes: new Map(),
    /** Every variant by its globally unique id ("pack/bodyType/part/pNN"). */
    variants: new Map(),
    /** Gradient sources awaiting decode: {pack, path, category, src}. */
    gradientFiles: [],
    unrecognized: [],
    /** Files the user removed: [{pack, path, src}], to put back. */
    removed: [],
    warnings: [],
    /**
     * Files not read from their own name: "pack|path" -> {readAs, bodyType, how}, how = 'odd'
     * (guessed from an odd name) or 'hand' (assigned by the user).
     */
    readAs: new Map(),
  };
}

function getVariant(library, packName, parsed) {
  let body = library.bodyTypes.get(parsed.bodyType);
  if (!body) {
    body = { parts: new Map() };
    library.bodyTypes.set(parsed.bodyType, body);
  }
  let variants = body.parts.get(parsed.part);
  if (!variants) {
    variants = new Map();
    body.parts.set(parsed.part, variants);
  }
  // Ids are globally unique ("pack/bodyType/part/pNN") so one character can mix parts from
  // Male, Female, Kid, ... and Body p01 never collides with Tail p01.
  const id = `${packName}/${parsed.bodyType}/${parsed.part}/${parsed.pid}`;
  let variant = variants.get(id);
  if (!variant) {
    variant = {
      id, pack: packName, bodyType: parsed.bodyType, pid: parsed.pid, basePid: parsed.basePid, part: parsed.part, icon: null, layers: [],
      /** An alternate only replaces the layers it has; the rest come from the plain variant. */
      alt: !!parsed.alt,
    };
    variants.set(id, variant);
    library.variants.set(id, variant);
  }
  return variant;
}

/** Layers are keyed so a base image and its `_c` mask end up in the same record. */
function layerKey(parsed) {
  return parsed.sheet === 'FG' ? `${parsed.layer}:${parsed.cell}` : parsed.layer;
}

/**
 * Adds a VX Ace file: one layer per half of the picture it holds, in each body type it is for.
 * Every layer keeps the whole file and which cells it holds; a colour picks the cell.
 */
function addVxAce(library, packName, vx, path, src) {
  for (const bodyType of vx.bodyTypes || ['Male', 'Female']) {
    const variant = getVariant(library, packName, { bodyType, part: vx.part, pid: vx.pid, basePid: vx.pid });
    for (const l of vx.layers) {
      if (variant.layers.some((x) => x.sheet === vx.sheet && x.key === l.key)) {
        library.warnings.push(`${path}: a second ${l.key} for ${vx.part} ${vx.pid}, keeping the first`);
        continue;
      }
      variant.layers.push({
        sheet: vx.sheet, key: l.key, layer: vx.part, part: vx.part, slotId: l.slotId, vxace: true,
        base: { src, pixels: null, path, cells: l.cells }, mask: null,
      });
    }
  }
}

/**
 * Adds a pack (one imported folder) to the library.
 * Variant ids are namespaced by pack, so importing two packs that both use "p01" never overwrites.
 * @param {{path:string, src:any}[]} entries
 */
export function addPack(library, packName, entries) {
  let name = packName || 'Pack';
  let n = 2;
  while (library.packs.some((p) => p.name === name)) name = `${packName} (${n++})`;
  const pack = { name, fileCount: entries.length, texts: [] };
  library.packs.push(pack);

  const lenient = [];
  const vxShared = [];
  for (const { path, src } of entries) {
    // Readme, credits and licence files: shown in the credits list.
    if (TEXT_FILE_RE.test(path)) {
      pack.texts.push({ path, src });
      continue;
    }
    if (!/\.png$/i.test(path)) continue;

    const gradient = parseGradientPath(path);
    if (gradient) {
      library.gradientFiles.push({ pack: name, path, category: gradient.category, src });
      continue;
    }

    const parsed = parsePartPath(path);
    if (parsed) {
      addParsed(library, name, parsed, path, src);
      continue;
    }
    const vx = parseVxAcePath(path);
    if (vx) {
      pack.format = 'vxace';
      if (vx.pid) addVxAce(library, name, vx, path, src);
      else vxShared.push({ vx, path, src });
      continue;
    }
    lenient.push({ path, src });
  }
  // Mini/Eyes.png: the walking eyes of every eye shape.
  for (const { vx, path, src } of vxShared) {
    for (const variant of [...library.variants.values()].filter((v) => v.pack === name && v.part === vx.part && v.basePid === v.pid)) {
      addVxAce(library, name, { ...vx, pid: variant.pid, bodyTypes: [variant.bodyType] }, path, src);
    }
  }
  // Odd names go last, so a typo'd copy ("FG_FrontHair_p17_c1].png") becomes the alternate,
  // not the original.
  const names = new Set(entries.map((e) => e.path.toLowerCase()));
  for (const { path, src } of lenient) {
    const fileName = path.split('/').pop();
    let readAs = lenientName(fileName);
    // A mask named after its image with "b" or "mask" added.
    const namedMask = NAMED_MASK_RE.exec(fileName);
    const imagePath = namedMask && `${path.slice(0, path.length - fileName.length)}${namedMask[1]}.png`;
    if (imagePath && !/^FG/i.test(fileName) && names.has(imagePath.toLowerCase())) {
      const imageAs = lenientName(`${namedMask[1]}.png`);
      if (imageAs && !/_c\.png$/i.test(imageAs)) readAs = imageAs.replace(/\.png$/i, '_c.png');
    }
    const parsed = readAs && parsePartPath(path.slice(0, path.length - fileName.length) + readAs);
    if (!parsed) {
      library.unrecognized.push({ pack: name, path, src, reason: 'Name does not match TYPE_Part_pNN[_c].png' });
      continue;
    }
    library.warnings.push(`${path}: read as ${readAs}`);
    library.readAs.set(`${name}|${path}`, { readAs, bodyType: parsed.bodyType, how: 'odd' });
    addParsed(library, name, parsed, path, src);
  }
  finishPack(library, name);
  // Credit-like files first: "credits.txt" before "notes.txt".
  const creditLike = (t) => (CREDIT_NAME_RE.test(t.path.split('/').pop()) ? 0 : 1);
  pack.texts.sort((a, b) => creditLike(a) - creditLike(b) || a.path.localeCompare(b.path));
  return pack;
}

/** Takes a whole pack (one opened folder) out of the library again. */
export function removePack(library, name) {
  library.packs = library.packs.filter((p) => p.name !== name);
  for (const [id, v] of library.variants) if (v.pack === name) library.variants.delete(id);
  for (const [bodyType, body] of library.bodyTypes) {
    for (const [part, variants] of body.parts) {
      for (const [id, v] of variants) if (v.pack === name) variants.delete(id);
      if (!variants.size) body.parts.delete(part);
    }
    if (!body.parts.size) library.bodyTypes.delete(bodyType);
  }
  library.gradientFiles = library.gradientFiles.filter((g) => g.pack !== name);
  library.unrecognized = library.unrecognized.filter((u) => u.pack !== name);
  library.removed = library.removed.filter((u) => u.pack !== name);
  for (const key of [...library.readAs.keys()]) if (key.startsWith(`${name}|`)) library.readAs.delete(key);
}

/**
 * Adds a file the user assigned by hand (from the import report) under the given name.
 * @param {string} readAs a generator file name, e.g. "TV_Hat_p01.png"
 * @param {string} bodyType body type folder, e.g. "Male" (new names make a new body type)
 * @returns {string|null} an error message, or null when it was added
 */
export function assignFile(library, packName, path, src, readAs, bodyType) {
  const parsed = parsePartPath(`${bodyType || 'Default'}/${readAs}`);
  if (!parsed) return `"${readAs}" is not a valid part name.`;
  library.unrecognized = library.unrecognized.filter((u) => !(u.pack === packName && u.path === path));
  library.readAs.set(`${packName}|${path}`, { readAs, bodyType: parsed.bodyType, how: 'hand' });
  // A mask assigned before its image waits for it (layers without an image aren't drawn).
  addParsed(library, packName, parsed, path, src);
  claimSpareMasks(library, packName);
  return null;
}

/**
 * Every part file of the library: [{pack, path, src, variant, role}], role 'image', 'mask' or
 * 'icon'. Used to find a file again, e.g. to reassign it.
 */
export function libraryFiles(library) {
  const files = [];
  for (const variant of library.variants.values()) {
    if (variant.icon?.path) files.push({ pack: variant.pack, path: variant.icon.path, src: variant.icon.src, variant, role: 'icon' });
    for (const l of variant.layers) {
      if (l.base) files.push({ pack: variant.pack, path: l.base.path, src: l.base.src, variant, layer: l, role: 'image' });
      if (l.mask && !l.mask.auto) files.push({ pack: variant.pack, path: l.mask.path, src: l.mask.src, variant, layer: l, role: 'mask' });
    }
  }
  return files;
}

/**
 * Takes a file out of the parts it was read into and puts it in the "to assign" list. A mask
 * whose image is taken out goes to the list too. Variants left empty are removed.
 * @returns {{src:any}|null} the file, or null when it isn't in the library
 */
export function unassignFile(library, packName, path, reason = 'Unassigned') {
  const found = libraryFiles(library).find((f) => f.pack === packName && f.path === path);
  if (!found) return library.unrecognized.find((u) => u.pack === packName && u.path === path) || null;
  const { variant, layer, role, src } = found;
  if (role === 'icon') variant.icon = null;
  if (role === 'mask') layer.mask = null;
  if (role === 'image') {
    layer.base = null;
    if (layer.mask?.auto) layer.mask = null; // made from this image: it goes with it
    if (layer.mask) {
      library.unrecognized.push({ pack: packName, path: layer.mask.path, src: layer.mask.src, reason: 'Its image was reassigned' });
      layer.mask = null;
    }
  }
  variant.layers = variant.layers.filter((l) => l.base || l.mask);
  if (!variant.layers.some((l) => l.base) && !variant.icon) {
    for (const l of variant.layers) {
      library.unrecognized.push({ pack: packName, path: l.mask.path, src: l.mask.src, reason: 'Its image was reassigned' });
    }
    library.variants.delete(variant.id);
    const parts = library.bodyTypes.get(variant.bodyType)?.parts;
    parts?.get(variant.part)?.delete(variant.id);
    if (parts && !parts.get(variant.part)?.size) parts.delete(variant.part);
    if (parts && !parts.size) library.bodyTypes.delete(variant.bodyType); // e.g. all Kid parts moved
  }
  library.readAs.delete(`${packName}|${path}`);
  library.unrecognized.push({ pack: packName, path, src, reason });
  return { src };
}

/**
 * Removes a file for good (until it is put back): out of every part it is read into, or out of
 * the "to assign" list. A mask left without its image goes to the "to assign" list as usual.
 * @returns {boolean} false when the file isn't in the library
 */
export function removeFile(library, packName, path) {
  const same = (f) => f.pack === packName && f.path === path;
  const waiting = library.unrecognized.find(same);
  // A VX Ace file can feed several layers: take it out of all of them.
  while (libraryFiles(library).some(same)) unassignFile(library, packName, path);
  const entry = library.unrecognized.find(same);
  if (!entry) return false;
  library.unrecognized = library.unrecognized.filter((u) => !same(u));
  // Remember where it was, to put it back there.
  library.removed.push({ pack: packName, path, src: entry.src, waiting: waiting ? waiting.reason : null });
  return true;
}

/**
 * Puts a removed file back where it was: in the "to assign" list, or read from its name again
 * (MV/MZ or VX Ace; a name it can't read goes to the "to assign" list).
 */
export function restoreFile(library, packName, path) {
  const i = library.removed.findIndex((u) => u.pack === packName && u.path === path);
  if (i === -1) return false;
  const [{ src, waiting }] = library.removed.splice(i, 1);
  if (waiting) {
    library.unrecognized.push({ pack: packName, path, src, reason: waiting });
    return true;
  }
  const parsed = parsePartPath(path);
  const vx = !parsed && parseVxAcePath(path);
  if (parsed) addParsed(library, packName, parsed, path, src);
  else if (vx?.pid) addVxAce(library, packName, vx, path, src);
  else if (vx) {
    for (const variant of [...library.variants.values()].filter((v) => v.pack === packName && v.part === vx.part && v.basePid === v.pid)) {
      addVxAce(library, packName, { ...vx, pid: variant.pid, bodyTypes: [variant.bodyType] }, path, src);
    }
  } else library.unrecognized.push({ pack: packName, path, src, reason: 'Put back' });
  return true;
}

/** Frame grids of the sprite sheets: columns x rows of square frames. */
const SPRITE_GRIDS = { TV: [3, 4], TVD: [3, 1], SV: [9, 6] };

/** A picture of this size can be this sprite sheet: its frame grid splits it into square frames. */
export function fitsSheet(sheet, width, height) {
  const grid = SPRITE_GRIDS[sheet];
  if (!grid) return true;
  const [cols, rows] = grid;
  return width % cols === 0 && height % rows === 0 && width / cols === height / rows;
}

/**
 * Sprite pictures whose size doesn't fit the sheet in their name, but another sheet's: RPG Maker
 * MV itself ships SV_Clothing1_pXX.png (and its mask) at walk size, 144x192. They are read as the
 * sheet they fit, "TV_Clothing1_pXX.png", and say so in the import report. Needs `size` ({w, h})
 * on the files' refs; files assigned by hand are left alone.
 * @returns {string[]} what was re-read, in words
 */
export function fixWrongSheets(library, packName) {
  const notes = [];
  const files = libraryFiles(library).filter((f) => f.pack === packName && f.role !== 'icon' && !f.layer.vxace
    && SPRITE_GRIDS[f.layer.sheet] && library.readAs.get(`${packName}|${f.path}`)?.how !== 'hand');
  // Images first: a mask follows its image.
  const todo = [...files.filter((f) => f.role === 'image'), ...files.filter((f) => f.role === 'mask')]
    .map((f) => ({ f, size: (f.role === 'mask' ? f.layer.mask : f.layer.base).size }));
  for (const { f, size } of todo) {
    if (!size || fitsSheet(f.layer.sheet, size.w, size.h)) continue;
    const fits = Object.keys(SPRITE_GRIDS).filter((s) => fitsSheet(s, size.w, size.h));
    const to = fits.find((s) => DEFAULT_SIZE[s].w === size.w && DEFAULT_SIZE[s].h === size.h) || fits[0];
    if (!to) continue;
    const name = library.readAs.get(`${packName}|${f.path}`)?.readAs || f.path.split('/').pop();
    const readAs = name.replace(/^(TVD|TV|SV)_/i, `${to}_`);
    const bodyType = f.variant.bodyType;
    const file = unassignFile(library, packName, f.path);
    if (!file || assignFile(library, packName, f.path, file.src, readAs, bodyType)) continue;
    library.readAs.set(`${packName}|${f.path}`, { readAs, bodyType, how: 'odd', bySize: true });
    notes.push(`${f.path}: ${size.w}×${size.h}px is the size of a ${SHEETS[to].label.toLowerCase()} sheet, not a ${SHEETS[f.layer.sheet].label.toLowerCase()} one: read as ${readAs}`);
  }
  return notes;
}

/**
 * The loaded image a mask file is named after: "TV_FurClothes01_c.png", "...b.png" or "...mask.png"
 * next to "TV_FurClothes01.png", in the same folder.
 */
export function imageOfMask(library, packName, path) {
  const dir = path.slice(0, path.lastIndexOf('/') + 1);
  const m = /^(.+?)(?:_c|[_ -]?mask|_?b)\.png$/i.exec(path.slice(dir.length));
  if (!m) return null;
  const want = `${dir}${m[1]}.png`.toLowerCase();
  return libraryFiles(library).find((f) => f.pack === packName && f.role === 'image' && f.path.toLowerCase() === want && SPRITE_GRIDS[f.layer.sheet]) || null;
}

const MASK_NAME_RE = /^(.+?)(?:_c|[_ -]?mask|_?b)\.png$/i;

/**
 * Assigns the other half of an image and its colour mask, when it still waits in the "to assign"
 * list: assigning "Hood.png" also assigns "Hood_c.png" (or "Hood mask.png") as its mask, and
 * assigning the mask also assigns the image. Walk, battler and damage pictures only (portraits
 * name their colour slot instead).
 * @param {string} readAs what the file just assigned is read as
 * @returns {{path:string, readAs:string}|null} the counterpart assigned
 */
export function assignCounterpart(library, packName, path, readAs, bodyType) {
  const parsed = parsePartPath(`${bodyType}/${readAs}`);
  if (!parsed || parsed.isIcon || !SPRITE_GRIDS[parsed.sheet]) return null;
  const dir = path.slice(0, path.lastIndexOf('/') + 1);
  const name = path.slice(dir.length);
  const queued = library.unrecognized.filter((u) => u.pack === packName && u.path.startsWith(dir) && !u.path.slice(dir.length).includes('/'));
  let other;
  let otherAs;
  if (parsed.isMask) {
    const stem = MASK_NAME_RE.exec(name)?.[1];
    other = stem && queued.find((u) => u.path.slice(dir.length).toLowerCase() === `${stem}.png`.toLowerCase());
    otherAs = readAs.replace(/_c\.png$/i, '.png');
  } else {
    const stem = name.replace(/\.png$/i, '').toLowerCase();
    other = queued.find((u) => MASK_NAME_RE.exec(u.path.slice(dir.length))?.[1].toLowerCase() === stem);
    otherAs = readAs.replace(/\.png$/i, '_c.png');
  }
  if (!other || assignFile(library, packName, other.path, other.src, otherAs, bodyType)) return null;
  return { path: other.path, readAs: otherAs };
}

/** The generator name a loaded file is read as: its own name, or what it was read as. */
function readName(library, file) {
  return library.readAs.get(`${file.pack}|${file.path}`)?.readAs || file.path.split('/').pop();
}

/**
 * Masks waiting for an image (assigned under another variation than their image, e.g.
 * "pTV-FurClothes01-c" next to "pFur01") become the colour mask of the image they are named
 * after, when that image is loaded and has no mask yet.
 * @returns {{path:string, readAs:string, bodyType:string, text:string}[]} what moved
 */
export function attachWaitingMasks(library, packName) {
  const moved = [];
  const waiting = libraryFiles(library).filter((f) => f.pack === packName && f.role === 'mask' && !f.layer.base);
  for (const mask of waiting) {
    const image = imageOfMask(library, packName, mask.path);
    if (!image || (image.layer.mask && !image.layer.mask.auto)) continue;
    const readAs = readName(library, image).replace(/\.png$/i, '_c.png');
    const bodyType = image.variant.bodyType;
    const file = unassignFile(library, packName, mask.path);
    if (!file || assignFile(library, packName, mask.path, file.src, readAs, bodyType)) continue;
    library.readAs.set(`${packName}|${mask.path}`, { readAs, bodyType, how: 'odd' });
    moved.push({ path: mask.path, readAs, bodyType, text: `${mask.path}: was waiting for an image, now the colour mask of ${image.path}` });
  }
  return moved;
}

/**
 * Takes a removed file back as a file to assign, to reassign it by hand.
 * @returns {object|null} its "to assign" entry, or null when it isn't removed
 */
export function restoreToAssign(library, packName, path) {
  const i = library.removed.findIndex((u) => u.pack === packName && u.path === path);
  if (i === -1) return null;
  const [{ src }] = library.removed.splice(i, 1);
  const entry = { pack: packName, path, src, reason: 'Put back to reassign' };
  library.unrecognized.push(entry);
  return entry;
}

/** "p17" -> "p17 (alt)"; "p17 (2)" -> "p17 (2, alt)". */
function withTag(pid, tag) {
  return pid.endsWith(')') ? `${pid.slice(0, -1)}, ${tag})` : `${pid} (${tag})`;
}

/** The layer a parsed file would fill, if that variant already has an image for it. */
function filledLayer(library, name, parsed) {
  const variant = library.variants.get(`${name}/${parsed.bodyType}/${parsed.part}/${parsed.pid}`);
  const key = layerKey(parsed);
  return variant?.layers.find((l) => l.sheet === parsed.sheet && l.key === key && l.base
    && (parsed.sheet !== 'FG' || l.slotId === parsed.slotId));
}

function addParsed(library, name, parsed, path, src) {
  if (parsed.unknownSuffixes.length) {
    library.warnings.push(`${path}: ignored suffix ${parsed.unknownSuffixes.join(', ')}`);
  }
  // A second image for the same layer (e.g. "FG_FrontHair_p17_c1].png", a slightly different
  // headband next to FG_FrontHair_p17_c1.png) becomes an alternate: "p17 (alt)". It replaces that
  // layer and borrows the rest (the hair itself) from p17.
  if (!parsed.isMask && !parsed.isIcon && filledLayer(library, name, parsed)) {
    const original = parsed.pid;
    for (let n = 1; filledLayer(library, name, parsed); n++) {
      parsed = { ...parsed, pid: withTag(original, n > 1 ? `alt ${n}` : 'alt'), alt: true };
    }
    library.warnings.push(`${path}: a second image for ${original} ${parsed.layer}, added as ${parsed.pid}`);
  }

  const variant = getVariant(library, name, parsed);
  if (parsed.isIcon) {
    variant.icon = { src, pixels: null, path };
    return;
  }

  const key = layerKey(parsed);
  // Official MZ faces can use one cell twice: fixed (FG_Clothing1_p04_c1) and recoloured
  // (FG_Clothing1_p04_c1_m010). Those are two layers, not duplicates.
  const sameSlot = (l) => parsed.sheet !== 'FG' || !l.base || l.slotId === parsed.slotId;
  let layer = variant.layers.find((l) => l.sheet === parsed.sheet && l.key === key && sameSlot(l));
  if (!layer) {
    layer = { sheet: parsed.sheet, key, layer: parsed.layer, part: parsed.part, slotId: null, base: null, mask: null };
    variant.layers.push(layer);
  }
  if (parsed.isMask) {
    // A real mask replaces one made by the generator.
    // A second mask: kept aside for the alternate it may be named after (see claimSpareMasks).
    if (layer.mask && !layer.mask.auto) (library.spareMasks ||= []).push({ pack: name, path, src });
    else layer.mask = { src, pixels: null, path };
  } else {
    if (layer.base) library.warnings.push(`${path}: duplicate layer, keeping the first`);
    else {
      layer.base = { src, pixels: null, path };
      layer.slotId = parsed.slotId;
    }
  }
}

/**
 * Masks that may belong to another image: a layer with a mask, and an alternate's layer for the
 * same picture without one. RPG Maker MV ships "TV_Clothing2_pXX.png" and "TV_Clothing2_pXX.png.png"
 * next to one "TV_Clothing2_pXX_c.png", and the mask is for the second one.
 * @returns {{owner:object, other:object}[]} layers: owner has the mask, other has none
 */
export function maskPairs(library, packName) {
  const pairs = [];
  for (const alt of library.variants.values()) {
    if (alt.pack !== packName || !alt.alt) continue;
    const plain = [...library.variants.values()].find((v) => v.pack === packName && v.bodyType === alt.bodyType
      && v.part === alt.part && v.pid === alt.basePid);
    if (!plain) continue;
    for (const other of alt.layers) {
      if (other.mask || !other.base || other.slotId) continue;
      const owner = plain.layers.find((l) => l.sheet === other.sheet && l.key === other.key && l.mask && l.base);
      if (owner) pairs.push({ owner, other });
    }
  }
  return pairs;
}

/**
 * Gives a mask to the image whose shape it covers best (images and masks decoded). A mask that
 * fits the other image clearly better moves there.
 * @returns {string[]} what moved, in words
 */
export function fitMasks(pairs) {
  const moved = [];
  for (const { owner, other } of pairs) {
    const mask = owner.mask;
    if (!mask?.pixels || !owner.base.pixels || !other.base.pixels) continue;
    const own = maskFit(owner.base.pixels, mask.pixels);
    const fits = maskFit(other.base.pixels, mask.pixels);
    if (fits <= own + 0.1) continue;
    other.mask = mask;
    owner.mask = null;
    moved.push(`${mask.path}: fits ${other.base.path} better than ${owner.base.path}, so it is its colour mask`);
  }
  return moved;
}

/**
 * Second masks for one layer go to the picture they are named after: RPG Maker MZ ships
 * TVD/Male/TV_Clothing_p03.png (read as "p03 (alt)") with TV_Clothing_p03_c.png next to
 * TVD_Clothing_p03.png and TVD_Clothing_p03_c.png. Masks no picture is named for are dropped.
 */
function claimSpareMasks(library, name) {
  const spare = (library.spareMasks || []).filter((m) => m.pack === name);
  if (!spare.length) return;
  library.spareMasks = library.spareMasks.filter((m) => m.pack !== name);
  const stem = (path) => path.toLowerCase().replace(/(_c)?\.png$/, '');
  // Plain parts first: a mask taken from one of them can then go to its alternate.
  const variants = [...library.variants.values()].filter((v) => v.pack === name).sort((a, b) => !!a.alt - !!b.alt);
  for (const variant of variants) {
    for (const layer of variant.layers) {
      if (!layer.base || layer.slotId || (layer.mask && stem(layer.mask.path) === stem(layer.base.path))) continue;
      const i = spare.findIndex((m) => stem(m.path) === stem(layer.base.path));
      if (i < 0) continue;
      const [mask] = spare.splice(i, 1);
      if (layer.mask && !layer.mask.auto) spare.push({ pack: name, path: layer.mask.path, src: layer.mask.src });
      layer.mask = { src: mask.src, pixels: null, path: mask.path };
    }
  }
  for (const m of spare) library.warnings.push(`${m.path}: duplicate mask, keeping the first`);
}

/** Masks without a base image can't be drawn: drop them (with a warning). */
function finishPack(library, name) {
  claimSpareMasks(library, name);
  for (const body of library.bodyTypes.values()) {
    for (const variants of body.parts.values()) {
      for (const variant of variants.values()) {
        if (variant.pack !== name) continue;
        variant.layers = variant.layers.filter((l) => {
          if (!l.base && !l.warned) {
            library.warnings.push(`${l.mask.path}: mask has no matching base image`);
            l.warned = true;
          }
          return !!l.base;
        });
      }
    }
  }
}

/**
 * Variant labels like "p03", plus the pack when several are loaded and the body type when it
 * differs from the character's.
 */
export function variantLabel(library, variant, bodyType) {
  let label = variant.pid;
  if (library.packs.length > 1) label += ` · ${variant.pack}`;
  if (bodyType && variant.bodyType !== bodyType) label += ` · ${variant.bodyType}`;
  return label;
}

/**
 * Can be picked as a part: not hidden, and has an image to draw. A colour mask assigned before
 * its image only waits for it: it is not a part of its own.
 */
export function selectable(variant) {
  return !variant.hidden && variant.layers.some((l) => l.base);
}

/**
 * All variants of a part across body types, the given body type first. Hidden ones (look-alikes,
 * see lookalike.js) and ones with nothing to draw are left out, except `keepId` (the one worn).
 */
export function variantsForPart(library, part, bodyType, keepId = null) {
  const shown = (v) => selectable(v) || v.id === keepId;
  // All body types: every body type's parts in the main list, none "from other body types".
  if (bodyType === ALL_BODIES) {
    return { own: [...library.bodyTypes.values()].flatMap((body) => [...(body.parts.get(part)?.values() || [])].filter(shown)), others: [] };
  }
  const own = [...(library.bodyTypes.get(bodyType)?.parts.get(part)?.values() || [])].filter(shown);
  const others = [];
  for (const [name, body] of library.bodyTypes) {
    if (name !== bodyType) others.push(...[...(body.parts.get(part)?.values() || [])].filter(shown));
  }
  return { own, others };
}
