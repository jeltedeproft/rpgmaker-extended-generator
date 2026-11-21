// Composites a character's selected parts into one sheet image.

import { DRAW_ORDER, DEFAULT_SIZE } from './format.js';
import { createImage, recolorLayer, blendOver } from './recolor.js';

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

/** The variants a character currently uses, in a stable order. */
export function selectedVariants(character, body) {
  const result = [];
  if (!body) return result;
  for (const [part, variantId] of Object.entries(character.parts)) {
    if (!variantId) continue;
    const variant = body.parts.get(part)?.get(variantId);
    if (variant) result.push(variant);
  }
  return result;
}

/** Layers to draw for one sheet, bottom-most first. */
export function layersForSheet(sheet, character, body) {
  const layers = [];
  for (const variant of selectedVariants(character, body)) {
    for (const layer of variant.layers) {
      if (layer.sheet === sheet) layers.push(layer);
    }
  }
  return layers
    .map((layer, i) => ({ layer, i, order: orderIndex(sheet, layer.key, layer.part) }))
    .sort((a, b) => b.order - a.order || a.i - b.i)
    .map((entry) => entry.layer);
}

function sheetSize(sheet, layers) {
  const body = layers.find((l) => l.part === 'Body' && l.base.pixels);
  if (body) return { w: body.base.pixels.width, h: body.base.pixels.height };
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
 * Renders one sheet. All layer pixels must be decoded first (see loader.ensureDecoded).
 * @param {Map<string,{colors:Uint8ClampedArray}>} gradientsById
 * @returns {{image:object|null, problems:string[]}}
 */
export function composeSheet(sheet, character, body, gradientsById, settings) {
  const layers = layersForSheet(sheet, character, body);
  const problems = [];
  if (!layers.length) return { image: null, problems };

  const size = sheetSize(sheet, layers);
  const out = createImage(size.w, size.h);
  const gradientFor = (slotId) => {
    const id = character.colors[slotId];
    return id ? gradientsById.get(id)?.colors ?? null : null;
  };

  for (const layer of layers) {
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
    // Parts of a different size (e.g. 160px MZ faces vs 144px) are centred.
    const ox = Math.round((size.w - base.width) / 2);
    const oy = Math.round((size.h - base.height) / 2);
    blendOver(out, colored, ox, oy);
  }
  return { image: out, problems };
}
