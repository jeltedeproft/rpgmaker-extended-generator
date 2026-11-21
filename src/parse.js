// Turns a list of files (from a dropped/selected generator folder) into a part library.
// Pure: no DOM. File objects are stored as opaque `src` values and decoded later.

import { SHEETS, SLOT_BY_M } from './format.js';

const PART_FILE_RE = /^(FG|TVD|TV|SV|icon)_([A-Za-z]+?)(\d*)_p([A-Za-z0-9]+)((?:_[A-Za-z]+\d*)*)\.png$/i;
const GRADIENT_FILE_RE = /^(?:gradients|grad_([A-Za-z0-9]+))\.png$/i;

const SHEET_FOLDER_NAMES = new Set(
  [...Object.values(SHEETS).map((s) => s.folder), 'Variation', 'Generator'].map((n) => n.toLowerCase()),
);

/** Normalises a body type folder name: "male" -> "Male". */
function normaliseBodyType(name) {
  if (!name) return 'Default';
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Parses one path, e.g. "Generator/TV/Male/TV_Clothing1_p03_c.png".
 * @returns {object|null} null when the name doesn't follow the generator convention.
 */
export function parsePartPath(path) {
  const segments = path.split(/[\\/]/).filter(Boolean);
  const fileName = segments[segments.length - 1];
  const match = PART_FILE_RE.exec(fileName);
  if (!match) return null;

  const [, rawPrefix, name, layerNumber, pid, suffixString] = match;
  const prefix = rawPrefix.toLowerCase() === 'icon' ? 'icon' : rawPrefix.toUpperCase();
  const parent = segments.length >= 2 ? segments[segments.length - 2] : '';
  const bodyType = SHEET_FOLDER_NAMES.has(parent.toLowerCase()) ? 'Default' : normaliseBodyType(parent);

  const result = {
    sheet: prefix === 'icon' ? null : prefix,
    isIcon: prefix === 'icon',
    part: name,
    layer: name + layerNumber,
    pid: 'p' + pid,
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
    /** Gradient sources awaiting decode: {pack, path, category, src}. */
    gradientFiles: [],
    unrecognized: [],
    warnings: [],
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
  const id = `${packName}/${parsed.pid}`;
  let variant = variants.get(id);
  if (!variant) {
    variant = { id, pack: packName, pid: parsed.pid, part: parsed.part, icon: null, layers: [] };
    variants.set(id, variant);
  }
  return variant;
}

/** Layers are keyed so a base image and its `_c` mask end up in the same record. */
function layerKey(parsed) {
  return parsed.sheet === 'FG' ? `${parsed.layer}:${parsed.cell}` : parsed.layer;
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
  const pack = { name, fileCount: entries.length };
  library.packs.push(pack);

  for (const { path, src } of entries) {
    if (!/\.png$/i.test(path)) continue;

    const gradient = parseGradientPath(path);
    if (gradient) {
      library.gradientFiles.push({ pack: name, path, category: gradient.category, src });
      continue;
    }

    const parsed = parsePartPath(path);
    if (!parsed) {
      library.unrecognized.push({ pack: name, path, src, reason: 'Name does not match TYPE_Part_pNN[_c].png' });
      continue;
    }
    if (parsed.unknownSuffixes.length) {
      library.warnings.push(`${path}: ignored suffix ${parsed.unknownSuffixes.join(', ')}`);
    }

    const variant = getVariant(library, name, parsed);
    if (parsed.isIcon) {
      variant.icon = { src, pixels: null };
      continue;
    }

    const key = layerKey(parsed);
    let layer = variant.layers.find((l) => l.sheet === parsed.sheet && l.key === key);
    if (!layer) {
      layer = { sheet: parsed.sheet, key, layer: parsed.layer, part: parsed.part, slotId: null, base: null, mask: null };
      variant.layers.push(layer);
    }
    if (parsed.isMask) {
      if (layer.mask) library.warnings.push(`${path}: duplicate mask, keeping the first`);
      else layer.mask = { src, pixels: null, path };
    } else {
      if (layer.base) library.warnings.push(`${path}: duplicate layer, keeping the first`);
      else {
        layer.base = { src, pixels: null, path };
        layer.slotId = parsed.slotId;
      }
    }
  }

  // Masks without a base image can't be drawn.
  for (const body of library.bodyTypes.values()) {
    for (const variants of body.parts.values()) {
      for (const variant of variants.values()) {
        if (variant.pack !== name) continue;
        variant.layers = variant.layers.filter((l) => {
          if (!l.base) library.warnings.push(`${l.mask.path}: mask has no matching base image`);
          return !!l.base;
        });
      }
    }
  }
  return pack;
}

/** Variant labels like "p03" or "p03 · MyPack" when several packs are loaded. */
export function variantLabel(library, variant) {
  return library.packs.length > 1 ? `${variant.pid} · ${variant.pack}` : variant.pid;
}
