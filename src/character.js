// Character model: which variant per part (from any body type), which gradient per colour slot,
// and per-part pixel offsets.

import { PART_ORDER, REQUIRED_PARTS, SLOTS, SLOT_BY_RGB } from './format.js';
import { preferredCategory, createCustomGradient } from './gradients.js';
import { partOfKey, pieceKeys, selectedItems, variantForSheet } from './compose.js';
import { SHEET_KEYS } from './format.js';

// v1: variant ids were "pack/pNN" (one body type per character).
// v2: variant ids are "pack/bodyType/part/pNN" and characters may carry offsets.
// v3: several items per part ("AccA 2"), with optional own colours per item (itemColors).
export const CHARACTER_FILE_VERSION = 3;

export function createCharacter(bodyType) {
  return { name: 'New character', bodyType, parts: {}, colors: {}, offsets: {}, itemColors: {}, split: {} };
}

/** Item keys worn for a part, first item first: ["AccA", "AccA 2", ...]. */
export function itemKeys(character, part) {
  return Object.keys(character.parts)
    .filter((k) => k !== part && partOfKey(k) === part)
    .sort((a, b) => Number(a.split(' ').pop()) - Number(b.split(' ').pop()));
}

/** Adds another item of a part (a copy of the first one) and returns its key. */
export function addItem(character, part) {
  let n = 2;
  while (`${part} ${n}` in character.parts) n++;
  const key = `${part} ${n}`;
  character.parts[key] = character.parts[part] || null;
  return key;
}

/** Removes an extra item and everything stored for it and its pieces. */
export function removeItem(character, key) {
  delete character.parts[key];
  for (const k of [key, ...pieceKeys(character, key)]) {
    delete character.offsets?.[k];
    delete character.itemColors?.[k];
    delete character.clip?.[k];
  }
  delete character.split?.[key];
}

/** Part names for the editor: known parts first, then custom part names found in any pack. */
export function partNames(library, bodyType) {
  const found = new Set();
  const body = library.bodyTypes.get(bodyType);
  if (body) body.parts.forEach((_, p) => found.add(p));
  // Parts that only exist for other body types are still offered (mixing is allowed).
  for (const b of library.bodyTypes.values()) b.parts.forEach((_, p) => found.add(p));
  const known = PART_ORDER.filter((p) => found.has(p));
  const extra = [...found].filter((p) => !PART_ORDER.includes(p)).sort();
  return [...known, ...extra];
}

/** Colour slots that the currently selected variants actually use. */
export function usedSlots(character, library) {
  const ids = new Set();
  for (const variantId of Object.values(character.parts)) {
    const variant = variantId && library.variants.get(variantId);
    if (!variant) continue;
    for (const layer of variant.layers) {
      if (layer.slotId) ids.add(layer.slotId);
      if (layer.mask?.slots) layer.mask.slots.forEach((s) => ids.add(s));
    }
  }
  return SLOTS.filter((s) => ids.has(s.id));
}

/**
 * Picks a default variant for required parts so a fresh character is never invisible.
 * A part set to null was deliberately cleared ("None") and stays empty.
 */
export function applyDefaults(character, library) {
  const body = library.bodyTypes.get(character.bodyType);
  if (!body) return character;
  for (const part of REQUIRED_PARTS) {
    const variants = body.parts.get(part);
    if (variants?.size && character.parts[part] === undefined) character.parts[part] = [...variants.keys()][0];
  }
  return character;
}

function pick(list, rng) {
  return list[Math.floor(rng() * list.length)];
}

/**
 * Rules for randomizing. All optional:
 * - chances: {part: 0..100} chance a part is worn (default 50, Body/Face 100)
 * - mixBodyTypes: also pick parts made for other body types
 * - anyColour: any gradient for any slot (default: the slot's suggested colours)
 * - links: [{slot, follows}] a slot always gets the same colour as another (eyebrows = hair)
 * - apart: [[partA, partB]] never worn together (the second one is dropped)
 * - setChance: 0..100 chance to put a random saved set on top, from `sets`
 */
export const DEFAULT_RULES = { chances: {}, mixBodyTypes: false, anyColour: false, links: [], apart: [], setChance: 0 };

/** Chance (0..1) that a part is worn under the rules. */
export function wearChance(part, rules = DEFAULT_RULES) {
  const c = rules.chances?.[part];
  if (c != null && c !== '') return Math.max(0, Math.min(100, Number(c))) / 100;
  return REQUIRED_PARTS.has(part) ? 1 : 0.5;
}

/**
 * Randomises parts and colours.
 * @param {object} options.locked set of part names / slot ids that must not change
 * @param {object} options.rules see DEFAULT_RULES
 * @param {object[]} options.sets saved character sets, for rules.setChance
 */
export function randomize(character, library, gradients, { rng = Math.random, locked = new Set(), rules = DEFAULT_RULES, sets = [] } = {}) {
  let next = { ...character, parts: { ...character.parts }, colors: { ...character.colors }, split: { ...(character.split || {}) } };
  const changed = (part, id) => {
    if (next.parts[part] !== id) delete next.split[part]; // pieces belong to the old variant
    next.parts[part] = id;
  };
  const own = library.bodyTypes.get(character.bodyType);
  const parts = new Set(own ? own.parts.keys() : []);
  if (rules.mixBodyTypes) for (const b of library.bodyTypes.values()) b.parts.forEach((_, p) => parts.add(p));
  for (const part of parts) {
    if (locked.has(part)) continue;
    const pool = rules.mixBodyTypes
      ? [...library.bodyTypes.values()].flatMap((b) => [...(b.parts.get(part)?.keys() || [])])
      : [...(own?.parts.get(part)?.keys() || [])];
    if (!pool.length) continue;
    changed(part, rng() < wearChance(part, rules) ? pick(pool, rng) : null);
  }
  for (const [a, b] of rules.apart || []) {
    if (next.parts[a] && next.parts[b] && !locked.has(b)) changed(b, null);
  }

  if (gradients.length) {
    for (const slot of SLOTS) {
      if (locked.has(slot.id)) continue;
      const preferred = rules.anyColour ? [] : gradients.filter((g) => g.category === preferredCategory(slot.id));
      next.colors[slot.id] = pick(preferred.length ? preferred : gradients, rng).id;
    }
  }

  if (sets.length && rng() < (rules.setChance || 0) / 100) {
    next = applySet(next, pick(sets, rng), library).character;
  }
  // Links last, so they also follow colours that came from a set.
  for (const { slot, follows } of rules.links || []) {
    if (slot && follows && !locked.has(slot) && next.colors[follows]) next.colors[slot] = next.colors[follows];
  }
  return next;
}

/**
 * Finds a variant for a saved reference. Exact id first; otherwise the same body type and part
 * number from any pack (so a renamed pack folder still loads), then the same part number from any
 * body type. Understands v1 ids ("pack/pNN") via `fallbackBodyType`.
 */
export function resolveVariant(library, part, savedId, fallbackBodyType) {
  if (!savedId) return null;
  const exact = library.variants.get(savedId);
  if (exact && exact.part === part) return savedId;

  const segments = savedId.split('/');
  const pid = segments[segments.length - 1];
  const bodyType = segments.length >= 4 ? segments[segments.length - 3] : fallbackBodyType;
  const inBody = (name) => {
    for (const [id, v] of library.bodyTypes.get(name)?.parts.get(part) || []) if (v.pid === pid) return id;
    return null;
  };
  const sameBody = inBody(bodyType);
  if (sameBody) return sameBody;
  for (const name of library.bodyTypes.keys()) {
    const found = inBody(name);
    if (found) return found;
  }
  return null;
}

/**
 * Which packs a character uses, for crediting: [{pack, parts: ["Eyes p03", ...], colours}].
 * Includes packs that only lend a sheet (odd-eye bodies) or a colour.
 */
export function creditsFor(character, library) {
  const byPack = new Map();
  const entry = (pack) => {
    if (!byPack.has(pack)) byPack.set(pack, { pack, parts: new Set(), colours: false });
    return byPack.get(pack);
  };
  for (const { key, variant } of selectedItems(character, library)) {
    for (const sheet of SHEET_KEYS) {
      const source = variantForSheet(variant, sheet, library);
      if (source) entry(source.pack).parts.add(`${key} ${source.pid}`);
    }
  }
  const packNames = new Set(library.packs.map((p) => p.name));
  const colourIds = [
    ...Object.values(character.colors || {}),
    ...Object.values(character.itemColors || {}).flatMap((c) => Object.values(c)),
  ];
  for (const id of colourIds) {
    const pack = id?.split('/')[0];
    if (packNames.has(pack)) entry(pack).colours = true;
  }
  return [...byPack.values()].map((c) => ({ ...c, parts: [...c.parts] }));
}

/** Plain-text credits, ready to paste into a game's credits. */
export function creditsText(credits, notes = {}) {
  return credits.map((c) => {
    const what = [c.parts.length ? c.parts.join(', ') : '', c.colours ? 'colours' : ''].filter(Boolean).join('; ');
    const note = notes[c.pack]?.trim();
    return `${c.pack}${note ? ` (${note})` : ''}: ${what}`;
  }).join('\n');
}

/**
 * A character set: a partial character (some items, with their colours, positions, pieces and
 * visibility) that can be put on top of any character, e.g. "Knight armour" or "Red-haired".
 * @param {string[]} keys item keys to include
 */
export function makeSet(character, library, name, keys, includeColours = true) {
  const pick = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => keys.includes(k) || keys.some((key) => k.startsWith(`${key} #`))));
  const set = {
    name,
    parts: Object.fromEntries(keys.map((k) => [k, character.parts[k] ?? null])),
    offsets: structuredClone(pick(character.offsets)),
    itemColors: structuredClone(pick(character.itemColors)),
    split: structuredClone(pick(character.split)),
    clip: structuredClone(pick(character.clip)),
    colors: {},
  };
  if (includeColours) {
    const slots = usedSlots({ parts: Object.fromEntries(keys.map((k) => [k, character.parts[k]])) }, library);
    for (const s of slots) if (character.colors[s.id]) set.colors[s.id] = character.colors[s.id];
  }
  return set;
}

/** Puts a set on a character: its items replace the same items, everything else stays. */
export function applySet(character, set, library) {
  const next = structuredClone({ ...character, offsets: character.offsets || {}, itemColors: character.itemColors || {}, split: character.split || {}, clip: character.clip || {} });
  const missing = [];
  for (const [key, id] of Object.entries(set.parts || {})) {
    if (!id) {
      next.parts[key] = null;
      continue;
    }
    const resolved = resolveVariant(library, partOfKey(key), id, character.bodyType);
    if (!resolved) missing.push(`${key} ${id}`);
    next.parts[key] = resolved;
    // Start the item clean, then take the set's settings for it.
    for (const field of ['offsets', 'itemColors', 'split', 'clip']) {
      for (const k of Object.keys(next[field])) if (k === key || k.startsWith(`${key} #`)) delete next[field][k];
    }
  }
  for (const field of ['offsets', 'itemColors', 'split', 'clip']) Object.assign(next[field], structuredClone(set[field] || {}));
  Object.assign(next.colors, set.colors || {});
  return { character: next, missing };
}

export function serializeCharacter(character, customGradients) {
  const used = new Set([
    ...Object.values(character.colors),
    ...Object.values(character.itemColors || {}).flatMap((c) => Object.values(c)),
  ]);
  return JSON.stringify(
    {
      format: 'rpgmaker-xgen-character',
      version: CHARACTER_FILE_VERSION,
      character,
      customGradients: customGradients
        .filter((g) => used.has(g.id))
        .map((g) => ({ id: g.id, label: g.label, stops: g.stops })),
    },
    null,
    2,
  );
}

/**
 * @returns {{character:object, customGradients:object[], missing:string[]}}
 */
/** True for RPG Maker MZ's own generator presets ("CharacterGeneratorSettings" .json files). */
export function isGeneratorSettings(data) {
  return data?.identity === 'CharacterGeneratorSettings' && typeof data.patterns === 'object';
}

/** The variant of a part with this number ("p04" also finds "p4" or "p004"), own body type first. */
function variantByNumber(library, part, pid, bodyType) {
  const exact = resolveVariant(library, part, pid, bodyType);
  if (exact) return exact;
  const n = Number(pid.replace(/\D/g, ''));
  const order = [bodyType, ...[...library.bodyTypes.keys()].filter((b) => b !== bodyType)];
  for (const name of order) {
    for (const [id, v] of library.bodyTypes.get(name)?.parts.get(part) || []) {
      if (v.basePid === v.pid && Number(v.pid.replace(/\D/g, '')) === n) return id;
    }
  }
  return null;
}

/**
 * Reads a preset saved by RPG Maker MZ's own character generator:
 * {gender, patterns: {fronthair: "p21", ...}, colors: {"#FCCB0A": 23, ...}, offsets: {nose: {x, y}}}.
 * Colours are keyed by mask colour and pick a row of that colour's gradient sheet (grad_skin,
 * grad_hair, grad_eyes or grad_common). Offsets move face parts.
 * @param {Array} gradients loaded gradients, to find the rows in
 */
export function fromGeneratorSettings(data, library, gradients = [], name = 'Character') {
  const missing = [];
  const wanted = String(data.gender || '').toLowerCase();
  const bodyType = [...library.bodyTypes.keys()].find((b) => b.toLowerCase() === wanted)
    || [...library.bodyTypes.keys()][0];
  if (bodyType?.toLowerCase() !== wanted) missing.push(`body type ${data.gender}`);
  const partByLower = new Map(PART_ORDER.map((p) => [p.toLowerCase(), p]));
  for (const p of library.bodyTypes.get(bodyType)?.parts.keys() || []) partByLower.set(p.toLowerCase(), p);

  const character = { ...createCharacter(bodyType), name };
  for (const [key, pid] of Object.entries(data.patterns || {})) {
    const part = partByLower.get(key.toLowerCase());
    if (!part) {
      if (pid) missing.push(`${key} ${pid}`);
      continue;
    }
    if (!pid) {
      character.parts[part] = null;
      continue;
    }
    const id = variantByNumber(library, part, String(pid), bodyType);
    if (!id) missing.push(`${part} ${pid}`);
    character.parts[part] = id;
  }

  // Row n of the slot's gradient sheet. RPG Maker MZ sheets come first, then any pack's.
  const rowsFor = (category) => {
    const sheets = gradients.filter((g) => g.source === 'file' && g.category === category);
    return sheets.length ? sheets : gradients.filter((g) => g.source === 'file' && g.category === 'all');
  };
  for (const [hex, row] of Object.entries(data.colors || {})) {
    const slot = SLOT_BY_RGB.get(parseInt(String(hex).replace('#', ''), 16));
    if (!slot || !Number.isInteger(row)) continue;
    const rows = rowsFor(preferredCategory(slot.id));
    const gradient = rows.find((g) => g.id.endsWith(`#${row}`));
    if (gradient) character.colors[slot.id] = gradient.id;
    else if (character.parts[slot.part]) missing.push(`${slot.label} colour ${row + 1}`);
  }

  for (const [key, o] of Object.entries(data.offsets || {})) {
    const part = partByLower.get(key.toLowerCase());
    if (!part || (!o?.x && !o?.y)) continue;
    character.offsets[part] = { face: { x: o.x || 0, y: o.y || 0, rot: 0 } };
  }
  return { character, customGradients: [], missing };
}

export function deserializeCharacter(json, library, gradients = [], fileName = '') {
  const data = JSON.parse(json);
  if (isGeneratorSettings(data)) {
    return fromGeneratorSettings(data, library, gradients, fileName.replace(/\.json$/i, '') || 'Character');
  }
  if (data.format !== 'rpgmaker-xgen-character') throw new Error('Not a character file');
  if (data.version > CHARACTER_FILE_VERSION) throw new Error('Character file is from a newer version');

  const saved = data.character;
  const missing = [];
  const bodyType = library.bodyTypes.has(saved.bodyType) ? saved.bodyType : [...library.bodyTypes.keys()][0];
  if (bodyType !== saved.bodyType) missing.push(`body type ${saved.bodyType}`);

  const character = {
    name: saved.name || 'Character',
    bodyType,
    parts: {},
    colors: { ...saved.colors },
    offsets: structuredClone(saved.offsets || {}),
    itemColors: structuredClone(saved.itemColors || {}),
    drawOrder: structuredClone(saved.drawOrder || {}),
    split: structuredClone(saved.split || {}),
    clip: structuredClone(saved.clip || {}),
  };
  for (const [part, id] of Object.entries(saved.parts || {})) {
    if (!id) {
      character.parts[part] = null;
      continue;
    }
    const resolved = resolveVariant(library, partOfKey(part), id, saved.bodyType);
    if (!resolved) missing.push(`${part} ${id}`);
    character.parts[part] = resolved;
  }
  const customGradients = (data.customGradients || []).map((g) => createCustomGradient(g.id, g.label, g.stops));
  return { character, customGradients, missing };
}
