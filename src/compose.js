// Composites a character's selected parts into one sheet image.

import { DRAW_ORDER, DEFAULT_SIZE, SHEETS } from './format.js';
import { createImage, recolorLayer, blendOver, rotateFrames, frameCentres } from './recolor.js';
import { islandLabels, keepIsland } from './islands.js';
import { solidOf, insideOutline, applyClip } from './clip.js';

/**
 * Position in the draw order, 0 = top-most. Unknown layers fall back to the first entry for the
 * same part, then to the top (so custom parts are always visible).
 */
export function orderIndex(sheet, key, part) {
  const order = DRAW_ORDER[sheet] || [];
  const exact = order.indexOf(key);
  if (exact !== -1) return exact;
  const [layerName, cell] = key.split(':');
  const sameLayer = order.findIndex((k) => k.split(':')[0] === layerName);
  if (sameLayer !== -1) {
    // A face cell the list doesn't name (FG_RearHair2_p12_c2) goes just below the layer's named
    // cells: c1 is drawn above c2 (a fixed hair tie in c1 sits on top of the hair in c2).
    let last = sameLayer;
    while (order[last + 1]?.split(':')[0] === layerName) last++;
    return last + (cell ? Number(cell.replace(/\D/g, '')) || 1 : 1) / 100;
  }
  const samePart = order.findIndex((k) => k.split(':')[0].replace(/\d+$/, '') === part);
  if (samePart !== -1) return samePart;
  return 0;
}

/**
 * An item is one worn part. The first item of a part is keyed by the part name ("AccA"), extra
 * items get a number ("AccA 2"). An item split into pieces has piece keys "Eyes #1", "Eyes #2".
 * Offsets, own colours and draw order are stored per key.
 */
export function partOfKey(key) {
  return itemOfKey(key).replace(/ \d+$/, '');
}

/** The item a key belongs to: "Eyes #2" -> "Eyes"; item keys map to themselves. */
export function itemOfKey(key) {
  return key.replace(/ #\d+$/, '');
}

/** Number of pieces an item is split into (0 = not split). */
export function pieceCountOf(character, key) {
  const split = character.split?.[key];
  return split?.count > 1 ? split.count : 0;
}

/** Piece keys of an item: ["Eyes #1", "Eyes #2"], or [] when it isn't split. */
export function pieceKeys(character, key) {
  return Array.from({ length: pieceCountOf(character, key) }, (_, i) => `${key} #${i + 1}`);
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
  const own = { x: o?.x || 0, y: o?.y || 0, rot: o?.rot || 0 };
  if (itemOfKey(key) === key) return own;
  // A piece moves with its item, plus its own offset.
  const item = partOffset(character, itemOfKey(key), sheet);
  return { x: item.x + own.x, y: item.y + own.y, rot: item.rot + own.rot };
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

/**
 * How an item or piece is clipped: {by: item key, mode: "inside"|"over"|"outside"}, or null.
 * Pieces follow their item's clip unless they have their own.
 */
export function clipOf(character, key) {
  const clip = character.clip?.[key] || character.clip?.[itemOfKey(key)];
  if (!clip?.by || clip.by === key || clip.by === itemOfKey(key)) return null;
  return clip;
}

/** The colour a slot gets for an item or piece: its own choice, else its item's, else the character's. */
export function itemColor(character, key, slotId) {
  return character.itemColors?.[key]?.[slotId]
    || character.itemColors?.[itemOfKey(key)]?.[slotId]
    || character.colors[slotId];
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
    const pieces = pieceKeys(character, key);
    for (const layer of variant?.layers || []) {
      if (layer.sheet !== sheet || !layer.base) continue;
      if (!pieces.length) draws.push({ layer, item: key });
      // A split item draws each piece as its own layer (own position, colours and draw order).
      pieces.forEach((piece, i) => draws.push({ layer, item: piece, piece: { of: key, n: i + 1 } }));
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
 * A sheet template from the settings: frame size and grid, e.g. 64x64 walk frames, or a 4x4
 * walk sheet. null = automatic (the body's size, RPG Maker's grid).
 * @returns {{fw:number, fh:number, cols:number, rows:number}|null}
 */
export function templateFor(sheet, settings) {
  const t = settings?.templates?.[sheet];
  if (!(t?.fw > 0) || !(t?.fh > 0)) return null;
  const grid = SHEETS[sheet].frame || { cols: 1, rows: 1 };
  return { fw: t.fw, fh: t.fh, cols: t.cols > 0 ? t.cols : grid.cols, rows: t.rows > 0 ? t.rows : grid.rows };
}

/** Size and frame grid of a sheet: from its template, else from the parts. */
export function sheetLayout(sheet, draws, settings) {
  const t = templateFor(sheet, settings);
  if (!t) {
    const size = sheetSize(sheet, draws);
    return { size, frame: frameFor(sheet, size) };
  }
  const size = { w: t.fw * t.cols, h: t.fh * t.rows };
  const frame = t.cols * t.rows > 1 ? { w: t.fw, h: t.fh, cols: t.cols, rows: t.rows } : null;
  return { size, frame };
}

/**
 * Brings a part image to the sheet's size. Same size: as is. A sprite part in RPG Maker's grid
 * but with other frame sizes (48px parts on a 64px template, or the other way): frame by frame,
 * centred and standing on the frame's bottom. Anything else: centred on the sheet.
 * @returns {{image:object, tiled:boolean}} tiled = the image is laid out in the sheet's frames
 */
export function placeOnSheet(img, sheet, { size, frame }) {
  if (img.width === size.w && img.height === size.h) return { image: img, tiled: !!frame };
  const grid = SHEETS[sheet].frame;
  if (frame && grid && frame.cols === grid.cols && frame.rows === grid.rows
    && img.width % grid.cols === 0 && img.height % grid.rows === 0) {
    const sw = img.width / grid.cols;
    const sh = img.height / grid.rows;
    const out = createImage(size.w, size.h);
    const dx = Math.round((frame.w - sw) / 2);
    const dy = frame.h - sh;
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        for (let y = 0; y < sh; y++) {
          const ty = row * frame.h + dy + y;
          if (ty < row * frame.h || ty >= (row + 1) * frame.h) continue;
          for (let x = 0; x < sw; x++) {
            const tx = col * frame.w + dx + x;
            if (tx < col * frame.w || tx >= (col + 1) * frame.w) continue;
            const si = ((row * sh + y) * img.width + col * sw + x) * 4;
            const ti = (ty * size.w + tx) * 4;
            out.data[ti] = img.data[si];
            out.data[ti + 1] = img.data[si + 1];
            out.data[ti + 2] = img.data[si + 2];
            out.data[ti + 3] = img.data[si + 3];
          }
        }
      }
    }
    return { image: out, tiled: true };
  }
  // Parts of a different size (e.g. 160px MZ faces vs 144px) are centred.
  const out = createImage(size.w, size.h);
  blendOver(out, img, Math.round((size.w - img.width) / 2), Math.round((size.h - img.height) / 2));
  return { image: out, tiled: false };
}

/**
 * How many pieces an item falls apart into with a given gap: the most islands found in one frame,
 * looking at the face first (that's where eyes, earrings and ornaments are easiest to tell
 * apart), then the sprites. Layers must be decoded.
 */
export function countPieces(character, library, key, gap, settings = null) {
  const variant = library.variants.get(character.parts[key]);
  if (!variant) return 0;
  for (const sheet of ['FG', 'TV', 'SV', 'TVD']) {
    const source = variantForSheet(variant, sheet, library);
    const own = (source?.layers || []).filter((l) => l.sheet === sheet && l.base?.pixels);
    if (!own.length) continue;
    const draws = layersForSheet(sheet, { ...character, parts: { [key]: character.parts[key] }, split: {} }, library);
    const layout = sheetLayout(sheet, draws, settings);
    const placed = own.map((l) => placeOnSheet(l.base.pixels, sheet, layout));
    return islandLabels(placed.map((p) => p.image), placed[0].tiled ? layout.frame : null, gap).count;
  }
  return 0;
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

  const layout = sheetLayout(sheet, layers, settings);
  const { size, frame } = layout;
  const out = createImage(size.w, size.h);
  const islands = new Map();
  const islandsOf = (itemKey) => {
    if (!islands.has(itemKey)) {
      const own = [...new Set(layers.filter((d) => d.piece?.of === itemKey && d.layer.base.pixels).map((d) => d.layer))];
      const placedOwn = own.map((l) => placeOnSheet(l.base.pixels, sheet, layout));
      const cacheKey = `${sheet}|${size.w}x${size.h}|${frame?.w}x${frame?.h}|` + own.map((l) => l.base.path).join(',');
      islands.set(itemKey, placedOwn.length
        ? islandLabels(placedOwn.map((p) => p.image), placedOwn[0].tiled ? frame : null, character.split[itemKey].gap, cacheKey).labels
        : null);
    }
    return islands.get(itemKey);
  };

  // 1. Recolour every layer, bring it to sheet size and cut out pieces.
  const placed = [];
  for (const { layer, item, piece } of layers) {
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
    const onSheet = placeOnSheet(recolorLayer(base, mask, layer.slotId, gradientFor, settings), sheet, layout);
    let image = onSheet.image;
    if (piece) {
      const labels = islandsOf(piece.of);
      if (labels) image = keepIsland(image, labels, piece.n);
    }
    // Sprite sheets are shifted inside each animation frame, so nothing bleeds into the next one.
    placed.push({ item, image, offset: partOffset(character, item, sheet), frame: onSheet.tiled ? frame : null });
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

  // 3. Draw bottom to top. Clipped items only show inside (or outside) another item's shape.
  const regions = new Map();
  const regionOf = (by, mode) => {
    const key = `${by}|${mode}`;
    if (!regions.has(key)) {
      const own = placed.filter((q) => q.item === by || itemOfKey(q.item) === by);
      if (!own.length) regions.set(key, null);
      else {
        const shape = createImage(size.w, size.h);
        for (const q of own) blendOver(shape, q.image, q.offset.x, q.offset.y, q.frame);
        const solid = solidOf(shape);
        regions.set(key, mode === 'inside' ? insideOutline(solid, size.w, size.h, own[0].frame) : solid);
      }
    }
    return regions.get(key);
  };
  for (const p of placed) {
    const clip = clipOf(character, p.item);
    const region = clip && regionOf(clip.by, clip.mode);
    if (!region) {
      blendOver(out, p.image, p.offset.x, p.offset.y, p.frame);
      continue;
    }
    const moved = blendOver(createImage(size.w, size.h), p.image, p.offset.x, p.offset.y, p.frame);
    blendOver(out, applyClip(moved, region, clip.mode));
  }
  return { image: out, problems, frame };
}
