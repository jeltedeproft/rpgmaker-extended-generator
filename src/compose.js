// Composites a character's selected parts into one sheet image.

import { DRAW_ORDER, DEFAULT_SIZE, SHEETS } from './format.js';
import { createImage, recolorLayer, blendOver, blendFrames, transformFrames, frameCentres, gridCentres, isTransformed, swapFrameRows } from './recolor.js';
import { islandLabels, keepIsland } from './islands.js';
import { solidOf, insideOutline, applyClip } from './clip.js';
import { VX_ORDER, cellOf, paintedIndex, followedSlot } from './vxace.js';

/**
 * Position in the draw order, 0 = top-most. Unknown layers fall back to the first entry for the
 * same part, then to the top (so custom parts are always visible).
 */
export function orderIndex(sheet, key, part) {
  const vx = VX_ORDER[sheet]?.indexOf(key) ?? -1;
  if (vx !== -1) return vx;
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
  const perImage = Object.values(character.sheetParts || {}).flatMap((c) => Object.values(c))
    .map((id) => library.variants.get(id)).filter(Boolean);
  for (const variant of [...selectedVariants(character, library), ...perImage]) {
    result.add(variant);
    for (const sheet of Object.keys(DRAW_ORDER)) {
      const source = variantForSheet(variant, sheet, library);
      if (source) result.add(source);
    }
    const plain = variant.alt && plainVariant(variant, library);
    if (plain) result.add(plain);
  }
  return [...result];
}

/** A per-image choice that hides an item on that image. */
export const HIDDEN = 'hidden';

/**
 * The variant that draws an item on one sheet: the per-image choice (character.sheetParts, e.g.
 * the face of p01 with the walk sprite of p01 (2), or a stand-in for an image the part lacks),
 * else the item's own variant. null = hidden there (character.hidden hides it on every image).
 */
export function itemOnSheet(character, key, variant, sheet, library) {
  if (character.hidden?.[key]) return null;
  const choice = character.sheetParts?.[key]?.[sheet];
  if (choice === HIDDEN) return null;
  return (choice && library.variants.get(choice)) || variant;
}

/**
 * Position and shape of an item on a sheet: "face" for FG, "sprite" for walk/damage/battler.
 * {x, y, rot (degrees, clockwise), scale (percent), flipX (mirrored), flipY (upside down)}.
 */
export function partOffset(character, key, sheet) {
  const o = character.offsets?.[key]?.[sheet === 'FG' ? 'face' : 'sprite'];
  const own = { x: o?.x || 0, y: o?.y || 0, rot: o?.rot || 0, scale: o?.scale || 100, flipX: !!o?.flipX, flipY: !!o?.flipY };
  if (itemOfKey(key) === key) return own;
  // A piece moves with its item, plus its own offset.
  const item = partOffset(character, itemOfKey(key), sheet);
  return {
    x: item.x + own.x, y: item.y + own.y, rot: item.rot + own.rot,
    scale: Math.round((item.scale * own.scale) / 100), flipX: item.flipX !== own.flipX, flipY: item.flipY !== own.flipY,
  };
}

/**
 * Mirroring a walk sheet also swaps its left- and right-facing rows (RPG Maker's 4-row walk
 * sheet), so the mirrored sprite still faces the way each row says.
 */
function mirrorRows(sheet, image, frame) {
  return sheet === 'TV' && frame?.rows === 4 ? swapFrameRows(image, frame, 1, 2) : image;
}

/** The whole-image transform of a sheet (character.sheetTransform), applied before exporting. */
export function sheetTransformOf(character, sheet) {
  const t = character.sheetTransform?.[sheet];
  const scale = t?.scale || 100;
  return { x: t?.x || 0, y: t?.y || 0, rot: t?.rot || 0, scale, scaleY: t?.scaleY || scale, flipX: !!t?.flipX, flipY: !!t?.flipY };
}

/**
 * Per-frame offsets of an item on a sprite sheet, on top of its sprite offset: Map "col,row" ->
 * {x, y, rot}. Stored as offsets[key].cells[sheet]["col,row"]; a piece adds its item's.
 */
export function cellOffsets(character, key, sheet) {
  const result = new Map();
  for (const k of itemOfKey(key) === key ? [key] : [itemOfKey(key), key]) {
    for (const [cell, o] of Object.entries(character.offsets?.[k]?.cells?.[sheet] || {})) {
      const prev = result.get(cell) || { x: 0, y: 0, rot: 0 };
      result.set(cell, { x: prev.x + (o.x || 0), y: prev.y + (o.y || 0), rot: prev.rot + (o.rot || 0) });
    }
  }
  return result;
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

/** The plain variant a tagged one ("p17 (alt)") is based on: same pack first, then any pack. */
function plainVariant(variant, library) {
  if (variant.basePid === variant.pid) return null;
  const candidates = [...(library.bodyTypes.get(variant.bodyType)?.parts.get(variant.part)?.values() || [])]
    .filter((v) => v.pid === variant.basePid);
  return candidates.find((v) => v.pack === variant.pack) || candidates[0] || null;
}

/** The variant that supplies a sheet for a selected variant (itself, or its fallback). */
export function variantForSheet(variant, sheet, library) {
  if (variant.layers.some((l) => l.sheet === sheet)) return variant;
  return sheetFallback(variant, sheet, library);
}

/**
 * The layers a selected variant draws on a sheet. An alternate ("p17 (alt)") draws its own
 * layers plus the plain variant's layers it doesn't replace.
 */
export function sheetLayers(variant, sheet, library) {
  const own = (variantForSheet(variant, sheet, library)?.layers || []).filter((l) => l.sheet === sheet);
  const plain = variant.alt && plainVariant(variant, library);
  if (!plain || plain === variant) return own;
  const replaced = (l) => own.some((o) => o.key === l.key && !!o.slotId === !!l.slotId);
  return [...own, ...plain.layers.filter((l) => l.sheet === sheet && !replaced(l))];
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
  // An item with its own colours can also pick the source colours (null) on its own.
  for (const k of [key, itemOfKey(key)]) {
    const own = character.itemColors?.[k];
    if (own && slotId in own && own[slotId] !== undefined) return own[slotId];
  }
  return character.colors[slotId] || null;
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
    const source = itemOnSheet(character, key, selected, sheet, library);
    if (!source) continue;
    const pieces = pieceKeys(character, key);
    for (const layer of sheetLayers(source, sheet, library)) {
      if (!layer.base) continue;
      if (!pieces.length) draws.push({ layer, item: key });
      // A split item draws each piece as its own layer (own position, colours and draw order).
      pieces.forEach((piece, i) => draws.push({ layer, item: piece, piece: { of: key, n: i + 1 } }));
    }
  }
  // character.only: just this item or piece (a piece on its own, to see which one it is).
  const sorted = draws.filter((d) => !character.only || d.item === character.only)
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
  if (sheet === 'FG') {
    // A face made of parts that are all one other size (VX Ace's 128px faces) keeps that size.
    const sizes = new Set(layers.filter((l) => l.base.pixels).map((l) => `${l.base.pixels.width}x${l.base.pixels.height}`));
    if (sizes.size === 1 && !layers.some((l) => !l.vxace && l.base.pixels)) {
      const [w, h] = [...sizes][0].split('x').map(Number);
      return { w, h };
    }
    return DEFAULT_SIZE.FG;
  }
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
export function sheetLayout(sheet, draws, settings, character = null) {
  const t = templateFor(sheet, settings);
  let layout;
  if (!t) {
    const size = sheetSize(sheet, draws);
    layout = { size, frame: frameFor(sheet, size) };
  } else {
    const size = { w: t.fw * t.cols, h: t.fh * t.rows };
    const frame = t.cols * t.rows > 1 ? { w: t.fw, h: t.fh, cols: t.cols, rows: t.rows } : null;
    layout = { size, frame };
  }
  if (!character || !(settings?.makeRoom || settings?.fitFrame)) return layout;
  // Fit into RPG Maker's size: make room for the portrait too, then shrink it all back (fitInto).
  const frame = layout.frame || (settings.fitFrame && sheet === 'FG' ? { w: layout.size.w, h: layout.size.h, cols: 1, rows: 1 } : null);
  const room = frame ? roomNeeded(character, draws, sheet, frame) : 0;
  const result = withRoom({ ...layout, frame }, sheet, room);
  return room ? { ...result, fit: !!settings.fitFrame } : layout;
}

/**
 * "Make room": how many pixels each sprite frame must grow on every side so moved, enlarged and
 * turned parts are not cut off at the frame's edge (0 = they fit). Portraits keep their size.
 */
export function roomNeeded(character, draws, sheet, frame) {
  const grid = SHEETS[sheet].frame || { cols: 1, rows: 1 };
  if (!frame || frame.cols !== grid.cols || frame.rows !== grid.rows) return 0;
  const side = Math.max(frame.w, frame.h);
  const grown = (t, rot = t.rot) => {
    const r = ((rot || 0) * Math.PI) / 180;
    const f = (Math.max(t.scale ?? 100, t.scaleY ?? 0) / 100) * (Math.abs(Math.cos(r)) + Math.abs(Math.sin(r)));
    return (side * Math.max(0, f - 1)) / 2;
  };
  let room = 0;
  for (const item of new Set(draws.map((d) => d.item))) {
    const o = partOffset(character, item, sheet);
    let cell = 0;
    let turn = o.rot;
    for (const c of cellOffsets(character, item, sheet).values()) {
      cell = Math.max(cell, Math.abs(c.x || 0), Math.abs(c.y || 0));
      if (Math.abs(o.rot + (c.rot || 0)) % 180 > Math.abs(turn) % 180) turn = o.rot + (c.rot || 0);
    }
    room = Math.max(room, grown(o, turn) + Math.max(Math.abs(o.x), Math.abs(o.y)) + cell);
  }
  const whole = sheetTransformOf(character, sheet);
  room += grown(whole) + Math.max(Math.abs(whole.x), Math.abs(whole.y));
  return Math.min(side * 2, Math.ceil(room));
}

/** The layout with every frame grown by `room` pixels on each side (the parts drawn in its middle). */
function withRoom(layout, sheet, room) {
  if (!room) return layout;
  const { frame } = layout;
  const big = { ...frame, w: frame.w + room * 2, h: frame.h + room * 2 };
  return { size: { w: big.w * frame.cols, h: big.h * frame.rows }, frame: big, room, inner: { w: frame.w, h: frame.h } };
}

/**
 * Brings a part image to the sheet's size. Same size: as is. A sprite part in RPG Maker's grid
 * but with other frame sizes (48px parts on a 64px template, or the other way): frame by frame,
 * centred and standing on the frame's bottom. Anything else: centred on the sheet.
 * @returns {{image:object, tiled:boolean}} tiled = the image is laid out in the sheet's frames
 */
export function placeOnSheet(img, sheet, { size, frame, room = 0, inner = frame }) {
  if (img.width === size.w && img.height === size.h) return { image: img, tiled: !!frame };
  const grid = SHEETS[sheet].frame;
  if (frame && grid && frame.cols === grid.cols && frame.rows === grid.rows
    && img.width % grid.cols === 0 && img.height % grid.rows === 0) {
    const sw = img.width / grid.cols;
    const sh = img.height / grid.rows;
    const out = createImage(size.w, size.h);
    // Centred, standing on the bottom (of the frame inside the room made around it).
    const dx = room + Math.round((inner.w - sw) / 2);
    const dy = room + inner.h - sh;
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
 * How many pieces an item falls apart into on each sheet with a given gap: {FG: 1, TV: 2, ...},
 * the most islands found in one frame. Each sheet is its own picture, so horns can split on the
 * walk sprite while the face stays one piece. Layers must be decoded.
 */
export function piecesPerSheet(character, library, key, gap, settings = null) {
  const variant = library.variants.get(character.parts[key]);
  const result = {};
  if (!variant) return result;
  for (const sheet of ['FG', 'TV', 'SV', 'TVD']) {
    const source = itemOnSheet(character, key, variant, sheet, library);
    const own = source ? sheetLayers(source, sheet, library).filter((l) => l.base?.pixels) : [];
    if (!own.length) continue;
    const draws = layersForSheet(sheet, { ...character, parts: { [key]: character.parts[key] }, split: {} }, library);
    const layout = sheetLayout(sheet, draws, settings);
    const placed = own.map((l) => placeOnSheet(l.base.pixels, sheet, layout));
    result[sheet] = islandLabels(placed.map((p) => p.image), placed[0].tiled ? layout.frame : null, gap).count;
  }
  return result;
}

/**
 * Number of pieces to split an item into: the most of any sheet. On a sheet with fewer islands
 * the extra pieces are simply empty (a one-piece face is all "piece 1").
 */
export function countPieces(character, library, key, gap, settings = null) {
  return Math.max(0, ...Object.values(piecesPerSheet(character, library, key, gap, settings)));
}

/**
 * Renders one sheet. All layer pixels must be decoded first (see loader.ensureVariants).
 * @param {Map<string,{colors:Uint8ClampedArray}>} gradientsById
 * @returns {{image:object|null, problems:string[]}}
 */
export function composeSheet(sheet, character, library, gradientsById, settings) {
  // A portrait with columns and rows (a face set): the face repeated in every cell.
  const faceGrid = sheet === 'FG' && settings?.templates?.FG;
  if (faceGrid && (faceGrid.cols > 1 || faceGrid.rows > 1)) {
    const cols = faceGrid.cols || 1;
    const rows = faceGrid.rows || 1;
    const one = composeSheet(sheet, character, library, gradientsById, { ...settings, templates: { ...settings.templates, FG: { fw: faceGrid.fw, fh: faceGrid.fh } } });
    if (!one.image) return one;
    const { width: w, height: h } = one.image;
    const out = createImage(w * cols, h * rows);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        for (let y = 0; y < h; y++) out.data.set(one.image.data.subarray(y * w * 4, (y + 1) * w * 4), (((row * h + y) * out.width) + col * w) * 4);
      }
    }
    return { image: out, problems: one.problems, frame: { w, h, cols, rows } };
  }
  const layers = layersForSheet(sheet, character, library);
  const problems = [];
  if (!layers.length) return { image: null, problems };

  const layout = sheetLayout(sheet, layers, settings, character);
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
      const g = id ? gradientsById.get(id) : null;
      // An adjusted "source" colour shifts the pixels' own colours.
      if (g?.shiftSource) return (g.shiftRef ||= { shift: g.adjust });
      return g?.colors ?? null;
    };
    // VX Ace parts are painted, not recoloured: the colour picks a cell of the file.
    const painted = !!layer.base.cells;
    const paintedColour = painted ? itemColor(character, item, layer.slotId) : null;
    const base = painted && layer.base.pixels ? cellOf(layer.base, paintedIndex(paintedColour)) : layer.base.pixels;
    if (!base) {
      problems.push(`${layer.base.path}: not decoded`);
      continue;
    }
    // A mask painted by hand (maskpaint.js) goes over the layer's own one.
    const mask = (layer.paint || layer.mask)?.pixels ?? null;
    if (mask && (mask.width !== base.width || mask.height !== base.height)) {
      problems.push(`${layer.mask.path}: mask is ${mask.width}x${mask.height}, image is ${base.width}x${base.height}`);
    }
    // Colour sync: a VX Ace part with no painted colour picked takes the MV/MZ colour it follows
    // (a gradient, or a hue, saturation and brightness shift), over its whole picture.
    const follow = painted ? followedSlot(layer.slotId, paintedColour, settings) : null;
    const recoloured = !painted ? recolorLayer(base, mask, layer.slotId, gradientFor, settings)
      : follow ? recolorLayer(base, null, follow, gradientFor, settings) : base;
    const onSheet = placeOnSheet(recoloured, sheet, layout);
    let image = onSheet.image;
    if (piece) {
      const labels = islandsOf(piece.of);
      if (labels) image = keepIsland(image, labels, piece.n);
    }
    // Sprite sheets are shifted inside each animation frame, so nothing bleeds into the next one.
    const tiled = onSheet.tiled ? frame : null;
    const cells = tiled ? cellOffsets(character, item, sheet) : new Map();
    placed.push({ item, image, offset: partOffset(character, item, sheet), frame: tiled, cells });
  }

  // 2. Mirror, flip, resize and turn: all layers of an item change around one shared centre per
  // frame.
  for (const p of placed) if (p.offset.flipX && p.frame) p.image = mirrorRows(sheet, p.image, frame);
  const centres = new Map();
  for (const p of placed) {
    const cellTurns = [...p.cells.values()].some((c) => c.rot);
    if (!isTransformed(p.offset) && !cellTurns) continue;
    const key = `${p.item}|${!!p.frame}`;
    if (!centres.has(key)) {
      const own = placed.filter((q) => q.item === p.item && q.frame === p.frame);
      centres.set(key, frameCentres(own.map((q) => q.image), p.frame));
    }
    const smooth = !!settings?.smoothPixels;
    const transform = cellTurns
      ? (fx, fy) => ({ ...p.offset, smooth, rot: p.offset.rot + (p.cells.get(`${fx / p.frame.w},${fy / p.frame.h}`)?.rot || 0) })
      : { ...p.offset, smooth };
    p.image = transformFrames(p.image, transform, p.frame, centres.get(key));
  }
  const draw = (target, p) => {
    if (!p.cells.size) return blendOver(target, p.image, p.offset.x, p.offset.y, p.frame);
    return blendFrames(target, p.image, p.frame, (col, row) => {
      const c = p.cells.get(`${col},${row}`);
      return { x: p.offset.x + (c?.x || 0), y: p.offset.y + (c?.y || 0) };
    });
  };

  // 3. Draw bottom to top. Clipped items only show inside (or outside) another item's shape.
  const regions = new Map();
  const regionOf = (by, mode) => {
    const key = `${by}|${mode}`;
    if (!regions.has(key)) {
      const own = placed.filter((q) => q.item === by || itemOfKey(q.item) === by);
      if (!own.length) regions.set(key, null);
      else {
        const shape = createImage(size.w, size.h);
        for (const q of own) draw(shape, q);
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
      draw(out, p);
      continue;
    }
    const moved = draw(createImage(size.w, size.h), p);
    blendOver(out, applyClip(moved, region, clip.mode));
  }
  const whole = { ...sheetTransformOf(character, sheet), smooth: !!settings?.smoothPixels };
  const image = transformSheet(out, sheet, frame, whole);
  if (layout.room) {
    const fitted = fitRoom(image, frame, layout.room, layout.inner);
    if (layout.fit) {
      const inner = { ...frame, w: layout.inner.w, h: layout.inner.h };
      return { image: fitInto(fitted.image, fitted.frame, inner), problems, frame: sheet === 'FG' ? null : inner };
    }
    return { image: fitted.image, problems, frame: fitted.frame };
  }
  return { image, problems, frame };
}

/**
 * "Make room", fitted: every frame keeps only the room the drawing needs. RPG Maker stands a
 * character with the bottom of its frame on the tile, so the feet stay on the bottom unless
 * something hangs below them; the sides grow alike, so the character stays centred; the rest of
 * the room goes on top. All frames keep one size, so the sheet still divides into RPG Maker's grid
 * (3 x 4 walk frames, 9 x 6 battler frames).
 * @param {number} room the room made on every side of each frame
 * @param {{w:number,h:number}} inner the frame size without the room
 */
export function fitRoom(image, frame, room, inner) {
  let side = 0;
  let top = 0;
  let bottom = 0;
  for (let fy = 0; fy + frame.h <= image.height; fy += frame.h) {
    for (let fx = 0; fx + frame.w <= image.width; fx += frame.w) {
      for (let y = 0; y < frame.h; y++) {
        for (let x = 0; x < frame.w; x++) {
          if (!image.data[((fy + y) * image.width + fx + x) * 4 + 3]) continue;
          side = Math.max(side, room - x, x - (room + inner.w - 1));
          top = Math.max(top, room - y);
          bottom = Math.max(bottom, y - (room + inner.h - 1));
        }
      }
    }
  }
  const fitted = { ...frame, w: inner.w + side * 2, h: inner.h + top + bottom };
  const out = createImage(fitted.w * frame.cols, fitted.h * frame.rows);
  for (let row = 0; row < frame.rows; row++) {
    for (let col = 0; col < frame.cols; col++) {
      for (let y = 0; y < fitted.h; y++) {
        const sy = row * frame.h + room - top + y;
        const start = (sy * image.width + col * frame.w + room - side) * 4;
        out.data.set(image.data.subarray(start, start + fitted.w * 4), ((row * fitted.h + y) * out.width + col * fitted.w) * 4);
      }
    }
  }
  return { image: out, frame: fitted };
}

/**
 * "Fit into RPG Maker's size": every frame shrunk (keeping its proportions, all by the same
 * amount) into frames of the inner size, standing on the bottom and centred, so a sheet with parts
 * that stick out still has RPG Maker's frame size (portrait 144px, walk 48px, battler 64px).
 * Each pixel becomes the average of the pixels it covers. Frames that already fit stay as they are.
 */
export function fitInto(image, frame, inner) {
  const s = Math.min(1, inner.w / frame.w, inner.h / frame.h);
  const out = createImage(inner.w * frame.cols, inner.h * frame.rows);
  const w = Math.max(1, Math.round(frame.w * s));
  const h = Math.max(1, Math.round(frame.h * s));
  const ox = Math.floor((inner.w - w) / 2);
  const oy = inner.h - h;
  const src = image.data;
  for (let row = 0; row < frame.rows; row++) {
    for (let col = 0; col < frame.cols; col++) {
      for (let y = 0; y < h; y++) {
        const y0 = (y * frame.h) / h;
        const y1 = ((y + 1) * frame.h) / h;
        for (let x = 0; x < w; x++) {
          const x0 = (x * frame.w) / w;
          const x1 = ((x + 1) * frame.w) / w;
          // Area average, with colours weighted by how solid they are.
          let r = 0; let g = 0; let b = 0; let a = 0; let area = 0;
          for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
            const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
            for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
              const wgt = wy * (Math.min(sx + 1, x1) - Math.max(sx, x0));
              const i = ((row * frame.h + sy) * image.width + col * frame.w + sx) * 4;
              const al = src[i + 3] * wgt;
              r += src[i] * al;
              g += src[i + 1] * al;
              b += src[i + 2] * al;
              a += al;
              area += wgt;
            }
          }
          if (!a) continue;
          const o = ((row * inner.h + oy + y) * out.width + col * inner.w + ox + x) * 4;
          out.data[o] = Math.round(r / a);
          out.data[o + 1] = Math.round(g / a);
          out.data[o + 2] = Math.round(b / a);
          out.data[o + 3] = Math.round(a / area);
        }
      }
    }
  }
  return out;
}

/**
 * The whole-image transform: every frame (the whole face) is mirrored, flipped, resized and
 * turned around the frame's middle, then moved. Nothing moves into a neighbouring frame.
 */
export function transformSheet(image, sheet, frame, t) {
  if (!isTransformed(t) && !t.x && !t.y) return image;
  let result = t.flipX ? mirrorRows(sheet, image, frame) : image;
  result = transformFrames(result, t, frame, gridCentres(result.width, result.height, frame));
  if (!t.x && !t.y) return result;
  return blendOver(createImage(result.width, result.height), result, t.x, t.y, frame);
}
