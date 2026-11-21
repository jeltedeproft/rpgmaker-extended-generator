// Character model: which variant per part, which gradient per colour slot.

import { PART_ORDER, REQUIRED_PARTS, SLOTS } from './format.js';
import { preferredCategory, createCustomGradient } from './gradients.js';

export const CHARACTER_FILE_VERSION = 1;

export function createCharacter(bodyType) {
  return { name: 'New character', bodyType, parts: {}, colors: {} };
}

/** Parts available for a body type, known parts first, then any custom part names found in packs. */
export function partNames(body) {
  if (!body) return [];
  const found = [...body.parts.keys()];
  const known = PART_ORDER.filter((p) => found.includes(p));
  const extra = found.filter((p) => !PART_ORDER.includes(p)).sort();
  return [...known, ...extra];
}

/** Colour slots that the currently selected variants actually use. */
export function usedSlots(character, body) {
  const ids = new Set();
  if (!body) return [];
  for (const [part, variantId] of Object.entries(character.parts)) {
    const variant = variantId && body.parts.get(part)?.get(variantId);
    if (!variant) continue;
    for (const layer of variant.layers) {
      if (layer.slotId) ids.add(layer.slotId);
      if (layer.mask?.slots) layer.mask.slots.forEach((s) => ids.add(s));
    }
  }
  return SLOTS.filter((s) => ids.has(s.id));
}

/** Picks a default variant for required parts so a fresh character is never invisible. */
export function applyDefaults(character, body) {
  if (!body) return character;
  for (const part of REQUIRED_PARTS) {
    const variants = body.parts.get(part);
    if (variants?.size && !character.parts[part]) character.parts[part] = [...variants.keys()][0];
  }
  return character;
}

function pick(list, rng) {
  return list[Math.floor(rng() * list.length)];
}

/**
 * Randomises parts and colours.
 * @param {object} options.locked set of part names / slot ids that must not change
 * @param {number} options.optionalChance chance an optional part is worn
 */
export function randomize(character, body, gradients, { rng = Math.random, locked = new Set(), optionalChance = 0.5 } = {}) {
  const next = { ...character, parts: { ...character.parts }, colors: { ...character.colors } };
  for (const part of partNames(body)) {
    if (locked.has(part)) continue;
    const ids = [...body.parts.get(part).keys()];
    if (!REQUIRED_PARTS.has(part) && rng() > optionalChance) next.parts[part] = null;
    else next.parts[part] = pick(ids, rng);
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
 * Finds a variant for a saved reference. Exact id first; otherwise the same part number from any
 * pack, so a character still loads when a pack folder was renamed.
 */
export function resolveVariant(body, part, variantId) {
  const variants = body?.parts.get(part);
  if (!variants || !variantId) return null;
  if (variants.has(variantId)) return variantId;
  const pid = variantId.split('/').pop();
  for (const [id, v] of variants) if (v.pid === pid) return id;
  return null;
}

export function serializeCharacter(character, customGradients) {
  const used = new Set(Object.values(character.colors));
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
  const body = library.bodyTypes.get(bodyType);

  const character = { name: saved.name || 'Character', bodyType, parts: {}, colors: { ...saved.colors } };
  for (const [part, id] of Object.entries(saved.parts || {})) {
    if (!id) {
      character.parts[part] = null;
      continue;
    }
    const resolved = resolveVariant(body, part, id);
    if (!resolved) missing.push(`${part} ${id}`);
    character.parts[part] = resolved;
  }
  const customGradients = (data.customGradients || []).map((g) => createCustomGradient(g.id, g.label, g.stops));
  return { character, customGradients, missing };
}
