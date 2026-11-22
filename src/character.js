// Character model: which variant per part (from any body type), which gradient per colour slot,
// and per-part pixel offsets.

import { PART_ORDER, REQUIRED_PARTS, SLOTS } from './format.js';
import { preferredCategory, createCustomGradient } from './gradients.js';
import { partOfKey, pieceKeys } from './compose.js';

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
 * Randomises parts (from the character's own body type) and colours.
 * @param {object} options.locked set of part names / slot ids that must not change
 * @param {number} options.optionalChance chance an optional part is worn
 */
export function randomize(character, library, gradients, { rng = Math.random, locked = new Set(), optionalChance = 0.5 } = {}) {
  const next = { ...character, parts: { ...character.parts }, colors: { ...character.colors } };
  const body = library.bodyTypes.get(character.bodyType);
  if (body) {
    for (const [part, variants] of body.parts) {
      if (locked.has(part)) continue;
      const ids = [...variants.keys()];
      if (!REQUIRED_PARTS.has(part) && rng() > optionalChance) next.parts[part] = null;
      else next.parts[part] = pick(ids, rng);
    }
  }
  if (gradients.length) {
    for (const slot of SLOTS) {
      if (locked.has(slot.id)) continue;
      const preferred = gradients.filter((g) => g.category === preferredCategory(slot.id));
      next.colors[slot.id] = pick(preferred.length ? preferred : gradients, rng).id;
    }
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
export function deserializeCharacter(json, library) {
  const data = JSON.parse(json);
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
