// Composites a character's selected parts into one sheet image.

import { DRAW_ORDER, DEFAULT_SIZE, SHEETS } from './format.js';
import { createImage, recolorLayer, blendOver, rotateFrames, frameCentres } from './recolor.js';

/**
 * Position in the draw order, 0 = top-most. Unknown layers fall back to the first entry for the
 * same part, then to the top (so custom parts are always visible).
 */
export function orderIndex(sheet, key, part) {
  const order = DRAW_ORDER[sheet] || [];
  const exact = order.indexOf(key);
  if (exact !== -1) return exact;
  const layerName = key.split(':')[0];
  const sameLayer = order.findIndex((k) => k.split(':')[0] === layerName);
  if (sameLayer !== -1) return sameLayer;
  const samePart = order.findIndex((k) => k.split(':')[0].replace(/\d+$/, '') === part);
  if (samePart !== -1) return samePart;
  return 0;
}

/**
 * An item is one worn part. The first item of a part is keyed by the part name ("AccA"), extra
 * items get a number ("AccA 2"). Offsets, own colours and draw order are stored per item key.
 */
export function partOfKey(key) {
  return key.replace(/ \d+$/, '');
}

/** The items a character currently wears: [{key, part, variant}], in a stable order. */
export function selectedItems(character, library) {
  const result = [];
  for (const [key, variantId] of Object.entries(character.parts)) {
    const variant = variantId && library.variants.get(variantId);
    if (variant) result.push({ key, part: partOfKey(key), variant });
  }
  return result;
}

/** The variants a character currently uses (from any body type), in a stable order. */
export function selectedVariants(character, library) {
  return selectedItems(character, library).map((item) => item.variant);
}

/** Selected variants plus the fallbacks they borrow sheets from: everything that needs decoding. */
export function variantsToDecode(character, library) {
  const result = new Set();
  for (const variant of selectedVariants(character, library)) {
    result.add(variant);
    for (const sheet of Object.keys(DRAW_ORDER)) {
      const source = variantForSheet(variant, sheet, library);
      if (source) result.add(source);
    }
  }
  return [...result];
}

/**
 * Offset and rotation (degrees, clockwise) of an item on a sheet: "face" for FG, "sprite" for
 * walk/damage/battler.
 */
export function partOffset(character, key, sheet) {
  const o = character.offsets?.[key]?.[sheet === 'FG' ? 'face' : 'sprite'];
  return { x: o?.x || 0, y: o?.y || 0, rot: o?.rot || 0 };
}

/**
 * A set variant (e.g. an odd-eye body, "p01 (left_green)") only replaces some sheets. For the
 * sheets it lacks, use the plain variant with the same number: same pack first, then any pack.
 */
function sheetFallback(variant, sheet, library) {
  if (variant.basePid === variant.pid) return null;
  const candidates = [...(library.bodyTypes.get(variant.bodyType)?.parts.get(variant.part)?.values() || [])]
    .filter((v) => v.pid === variant.basePid && v.layers.some((l) => l.sheet === sheet));
  return candidates.find((v) => v.pack === variant.pack) || candidates[0] || null;
}

/** The variant that supplies a sheet for a selected variant (itself, or its fallback). */
export function variantForSheet(variant, sheet, library) {
  if (variant.layers.some((l) => l.sheet === sheet)) return variant;
  return sheetFallback(variant, sheet, library);
}

/** The colour a slot gets for one item: the item's own choice, else the character's. */
export function itemColor(character, key, slotId) {
  return character.itemColors?.[key]?.[slotId] || character.colors[slotId];
}

/** Identifies one drawn layer in a custom draw order. */
export function drawId(draw) {
  return `${draw.item}|${draw.layer.key}`;
}

/**
 * Applies a custom draw order (ids top-most first, see drawId). Layers it names swap places among
 * themselves; layers it doesn't name (parts added later) keep their default position.
 */
function applyCustomOrder(draws, order) {
  if (!order?.length) return draws;
  const rank = new Map(order.map((id, i) => [id, i]));
  const slots = [];
  const named = [];
  draws.forEach((d, i) => {
    if (rank.has(drawId(d))) {
      slots.push(i);
      named.push(d);
    }
  });
  named.sort((a, b) => rank.get(drawId(b)) - rank.get(drawId(a)));
  const result = [...draws];
  slots.forEach((slot, i) => (result[slot] = named[i]));
  return result;
}

/**
 * What to draw for one sheet, bottom-most first: [{layer, item}] where item is the item key.
 * Default is RPG Maker's order (extra items sit just above the first one); character.drawOrder
 * can override it per sheet.
 */
export function layersForSheet(sheet, character, library) {
  const draws = [];
  for (const { key, variant: selected } of selectedItems(character, library)) {
    const variant = variantForSheet(selected, sheet, library);
    for (const layer of variant?.layers || []) {
      if (layer.sheet === sheet) draws.push({ layer, item: key });
    }
  }
  const sorted = draws
    .map((draw, i) => ({ draw, i, order: orderIndex(sheet, draw.layer.key, draw.layer.part) }))
    // Same position: the recoloured layer goes above a fixed one (see FG_Beard_p07_c1 vs _c1_m003).
    .sort((a, b) => b.order - a.order || !!a.draw.layer.slotId - !!b.draw.layer.slotId || a.i - b.i)
    .map((entry) => entry.draw);
  return applyCustomOrder(sorted, character.drawOrder?.[sheet]);
}

/** Moves one layer up (+1, towards the top) or down (-1) and returns the new order for the sheet. */
export function moveLayer(sheet, character, library, id, step) {
  const topFirst = layersForSheet(sheet, character, library).map(drawId).reverse();
  const i = topFirst.indexOf(id);
  const j = i - step;
  if (i === -1 || j < 0 || j >= topFirst.length) return topFirst;
  [topFirst[i], topFirst[j]] = [topFirst[j], topFirst[i]];
  return topFirst;
}

function sheetSize(sheet, draws) {
  const layers = draws.map((d) => d.layer);
  const body = layers.find((l) => l.part === 'Body' && l.base.pixels);
  if (body) return { w: body.base.pixels.width, h: body.base.pixels.height };
  // Faces are 144px; MZ ships some 160px parts (ears, accessories) that are centred and cropped.
  if (sheet === 'FG') return DEFAULT_SIZE.FG;
  let w = 0;
  let h = 0;
  for (const l of layers) {
    if (!l.base.pixels) continue;
    w = Math.max(w, l.base.pixels.width);
    h = Math.max(h, l.base.pixels.height);
  }
  return w && h ? { w, h } : DEFAULT_SIZE[sheet];
}

/**
 * Animation frame (tile) size of a sheet: the sheet split into RPG Maker's grid (3x4 walk, 9x6
 * battler, ...), so bigger or smaller sprites work too. null when the size doesn't split evenly:
 * then the whole sheet counts as one frame.
 */
export function frameFor(sheet, size) {
  const grid = SHEETS[sheet].frame;
  if (!grid || size.w % grid.cols || size.h % grid.rows) return null;
  return { w: size.w / grid.cols, h: size.h / grid.rows, cols: grid.cols, rows: grid.rows };
}

/**
 * Renders one sheet. All layer pixels must be decoded first (see loader.ensureVariants).
 * @param {Map<string,{colors:Uint8ClampedArray}>} gradientsById
 * @returns {{image:object|null, problems:string[]}}
 */
export function composeSheet(sheet, character, library, gradientsById, settings) {
  const layers = layersForSheet(sheet, character, library);
  const problems = [];
  if (!layers.length) return { image: null, problems };

  const size = sheetSize(sheet, layers);
  const out = createImage(size.w, size.h);
  const frame = frameFor(sheet, size);
  // 1. Recolour every layer and bring it to sheet size.
  const placed = [];
  for (const { layer, item } of layers) {
    const gradientFor = (slotId) => {
      const id = itemColor(character, item, slotId);
      return id ? gradientsById.get(id)?.colors ?? null : null;
    };
    const base = layer.base.pixels;
    if (!base) {
      problems.push(`${layer.base.path}: not decoded`);
      continue;
    }
    const mask = layer.mask?.pixels ?? null;
    if (mask && (mask.width !== base.width || mask.height !== base.height)) {
      problems.push(`${layer.mask.path}: mask is ${mask.width}x${mask.height}, image is ${base.width}x${base.height}`);
    }
    const colored = recolorLayer(base, mask, layer.slotId, gradientFor, settings);
    const offset = partOffset(character, item, sheet);
    if (frame && base.width === size.w && base.height === size.h) {
      // Sprite sheets: shifted later, inside each animation frame.
      placed.push({ item, image: colored, offset, frame });
    } else {
      // Parts of a different size (e.g. 160px MZ faces vs 144px) are centred, then shifted.
      const image = createImage(size.w, size.h);
      const ox = Math.round((size.w - base.width) / 2) + offset.x;
      const oy = Math.round((size.h - base.height) / 2) + offset.y;
      blendOver(image, colored, ox, oy);
      placed.push({ item, image, offset: { ...offset, x: 0, y: 0 }, frame: null });
    }
  }

  // 2. Rotate: all layers of an item turn around one shared centre per frame.
  const centres = new Map();
  for (const p of placed) {
    if (!p.offset.rot) continue;
    const key = `${p.item}|${!!p.frame}`;
    if (!centres.has(key)) {
      const own = placed.filter((q) => q.item === p.item && q.frame === p.frame);
      centres.set(key, frameCentres(own.map((q) => q.image), p.frame));
    }
    p.image = rotateFrames(p.image, p.offset.rot, p.frame, centres.get(key));
  }

  // 3. Draw bottom to top.
  for (const p of placed) blendOver(out, p.image, p.offset.x, p.offset.y, p.frame);
  return { image: out, problems };
}
