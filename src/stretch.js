// Squash and stretch: sprite frames cut along lines into bands, each band made longer or shorter
// (or wider or narrower) on its own, and put back together, so a body gets longer while the head
// and a belt keep their size. Works on whole sheets (a finished character, or the generator's
// composite) and on single part files (stretched parts kept as alternates).
//
// A spec, as kept in character.taller[sheet]:
//   top:   percent for the band above the first line across (the head; 100 = as it is)
//   rows:  lines across, top to bottom: {y, scale (percent for the band below it), bend, at}
//          bend: [[x, dy], ...] a bent line (dy from y, straight between the points);
//          at:   {"col,row": y} the line's own place in that frame
//   left:  percent for the band left of the first line down
//   cols:  lines down, left to right: {x, scale (percent for the band right of it)}
//   boxes: [{x, y, w, h, sx, sy}] areas made bigger or smaller (percent) around their middle,
//          e.g. the eyes
//   width: percent of the width of what is below the first line across (around the middle)
// Older characters kept {neck, stretch, width, necks}; normalizeStretch reads both.

import { createImage } from './recolor.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** The spec in its current form, from a stored one (old {neck, stretch, necks} too). */
export function normalizeStretch(t) {
  if (!t) return null;
  if (t.rows || t.cols || t.boxes) {
    return {
      top: t.top ?? 100,
      rows: (t.rows || []).map((r) => ({ y: r.y, scale: r.scale ?? 100, bend: r.bend || [], at: r.at || {} })),
      left: t.left ?? 100,
      cols: (t.cols || []).map((c) => ({ x: c.x, scale: c.scale ?? 100 })),
      boxes: (t.boxes || []).map((b) => ({ ...b, sx: b.sx ?? 100, sy: b.sy ?? 100 })),
      width: t.width ?? 100,
    };
  }
  return {
    top: 100,
    rows: t.neck == null ? [] : [{ y: t.neck, scale: t.stretch ?? 100, bend: [], at: { ...(t.necks || {}) } }],
    left: 100, cols: [], boxes: [], width: t.width ?? 100,
  };
}

/** Whether a spec changes anything. */
export function isStretched(spec) {
  if (!spec) return false;
  return spec.top !== 100 || spec.left !== 100 || spec.width !== 100
    || spec.rows.some((r) => r.scale !== 100) || spec.cols.some((c) => c.scale !== 100)
    || spec.boxes.some((b) => b.sx !== 100 || b.sy !== 100);
}

/** Where a line across is in a frame ("col,row") at column x: its own place there, bent. */
export function lineY(row, key, x) {
  const y = row.at?.[key] ?? row.y;
  const bend = row.bend || [];
  if (!bend.length) return y;
  const pts = [...bend].sort((a, b) => a[0] - b[0]);
  if (x <= pts[0][0]) return y + pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, d0] = pts[i - 1];
      const [x1, d1] = pts[i];
      return y + d0 + ((d1 - d0) * (x - x0)) / Math.max(1e-9, x1 - x0);
    }
  }
  return y + pts[pts.length - 1][1];
}

/**
 * How many rows each band grows by (negative: shrinks), from the lines' straight places in a
 * frame: band 0 is above the first line, band i below line i - 1.
 */
function growth(cuts, size, scales) {
  const d = [];
  let prev = 0;
  for (let i = 0; i <= cuts.length; i++) {
    const next = i < cuts.length ? clamp(cuts[i], prev, size) : size;
    d.push(Math.round(((next - prev) * (scales[i] - 100)) / 100));
    prev = next;
  }
  return d;
}

/**
 * One column (or row) of pixels mapped through its bands: for each output index, the source
 * index, or -1. bounds: the source band edges (0, cuts..., size), grow: rows added per band.
 */
function mapLine(bounds, grow, outSize) {
  const map = new Int32Array(outSize).fill(-1);
  let off = 0;
  for (let i = 0; i < grow.length; i++) {
    const s0 = bounds[i];
    const s1 = bounds[i + 1];
    const o0 = s0 + off;
    off += grow[i];
    const o1 = s1 + off;
    const len = s1 - s0;
    const out = o1 - o0;
    if (len <= 0 || out <= 0) continue;
    for (let o = Math.max(0, o0); o < Math.min(outSize, o1); o++) {
      map[o] = s0 + Math.min(len - 1, Math.floor(((o - o0) * len) / out));
    }
  }
  return map;
}

const at = (img, x, y) => (y * img.width + x) * 4;

/** Boxes: each area scaled around its middle and drawn over the frame (cleared first when smaller). */
function applyBoxes(img, boxes, shift) {
  let out = img;
  for (const b of boxes) {
    if (b.sx === 100 && b.sy === 100) continue;
    const x0 = Math.round(b.x - shift.x);
    const y0 = Math.round(b.y - shift.y);
    const cx = x0 + b.w / 2;
    const cy = y0 + b.h / 2;
    const sx = Math.max(0.1, b.sx / 100);
    const sy = Math.max(0.1, b.sy / 100);
    const src = out;
    out = createImage(src.width, src.height);
    out.data.set(src.data);
    // Smaller: what was in the box goes, the smaller copy is drawn in its middle.
    if (sx < 1 || sy < 1) {
      for (let y = Math.max(0, y0); y < Math.min(src.height, y0 + b.h); y++) {
        for (let x = Math.max(0, x0); x < Math.min(src.width, x0 + b.w); x++) out.data.fill(0, at(out, x, y), at(out, x, y) + 4);
      }
    }
    const nw = b.w * sx;
    const nh = b.h * sy;
    for (let y = Math.max(0, Math.floor(cy - nh / 2)); y < Math.min(src.height, Math.ceil(cy + nh / 2)); y++) {
      const fy = Math.floor(cy + (y + 0.5 - cy) / sy);
      if (fy < y0 || fy >= y0 + b.h || fy < 0 || fy >= src.height) continue;
      for (let x = Math.max(0, Math.floor(cx - nw / 2)); x < Math.min(src.width, Math.ceil(cx + nw / 2)); x++) {
        const fx = Math.floor(cx + (x + 0.5 - cx) / sx);
        if (fx < x0 || fx >= x0 + b.w || fx < 0 || fx >= src.width) continue;
        const i = at(src, fx, fy);
        if (src.data[i + 3] === 0) continue;
        out.data.set(src.data.subarray(i, i + 4), at(out, x, y));
      }
    }
  }
  return out;
}

/** One frame through the whole spec. shift: where the frame's (0, 0) is in the spec's frame. */
function stretchOne(img, spec, key, shift) {
  let cur = spec.boxes.length ? applyBoxes(img, spec.boxes, shift) : img;
  const w = cur.width;
  const h = cur.height;
  const rows = spec.rows;
  // Body width: what is below the first line across, made wider or narrower around the middle.
  if (spec.width !== 100 && rows.length) {
    const wide = Math.max(0.1, spec.width / 100);
    const mid = w / 2;
    const src = cur;
    cur = createImage(w, h);
    for (let x = 0; x < w; x++) {
      const neck = lineY(rows[0], key, x + shift.x) - shift.y;
      const sx = Math.floor(mid + (x + 0.5 - mid) / wide);
      for (let y = 0; y < h; y++) {
        const from = y < neck ? x : sx;
        if (from < 0 || from >= w) continue;
        cur.data.set(src.data.subarray(at(src, from, y), at(src, from, y) + 4), at(cur, x, y));
      }
    }
  }
  // Lines across: every column cut at the (bent) lines, each band made longer or shorter.
  if (rows.length) {
    const straight = rows.map((r) => (r.at?.[key] ?? r.y) - shift.y);
    const grow = growth(straight, h, [spec.top, ...rows.map((r) => r.scale)]);
    const outH = Math.max(1, h + grow.reduce((a, b) => a + b, 0));
    const src = cur;
    cur = createImage(w, outH);
    for (let x = 0; x < w; x++) {
      const bounds = [0];
      for (const r of rows) bounds.push(clamp(Math.round(lineY(r, key, x + shift.x) - shift.y), bounds[bounds.length - 1], h));
      bounds.push(h);
      const map = mapLine(bounds, grow, outH);
      for (let y = 0; y < outH; y++) {
        if (map[y] < 0) continue;
        cur.data.set(src.data.subarray(at(src, x, map[y]), at(src, x, map[y]) + 4), at(cur, x, y));
      }
    }
  }
  // Lines down: every row cut at the lines, each band made wider or narrower.
  if (spec.cols.length) {
    const cuts = spec.cols.map((c) => c.x - shift.x);
    const grow = growth(cuts, w, [spec.left, ...spec.cols.map((c) => c.scale)]);
    const outW = Math.max(1, w + grow.reduce((a, b) => a + b, 0));
    const bounds = [0];
    for (const c of cuts) bounds.push(clamp(Math.round(c), bounds[bounds.length - 1], w));
    bounds.push(w);
    const map = mapLine(bounds, grow, outW);
    const src = cur;
    cur = createImage(outW, src.height);
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < outW; x++) {
        if (map[x] < 0) continue;
        cur.data.set(src.data.subarray(at(src, map[x], y), at(src, map[x], y) + 4), at(cur, x, y));
      }
    }
  }
  return cur;
}

/**
 * Stretches every frame of a sheet on its own and puts them back together: all frames get the
 * size of the biggest, standing on the bottom and centred, so the sheet keeps its grid.
 * @param {{w:number, h:number, cols:number, rows:number}} frame
 * @param {object} spec see normalizeStretch
 * @param {{x:number, y:number}} shift where this sheet's frame (0, 0) is in the spec's frame (a part
 *   that is smaller than the character's frame, or moved)
 * @returns {{image:object, frame:object}}
 */
export function stretchFrames(image, frame, spec, shift = { x: 0, y: 0 }) {
  const done = [];
  let W = 1;
  let H = 1;
  for (let row = 0; row < frame.rows; row++) {
    for (let col = 0; col < frame.cols; col++) {
      const one = createImage(frame.w, frame.h);
      for (let y = 0; y < frame.h; y++) {
        const from = at(image, col * frame.w, row * frame.h + y);
        one.data.set(image.data.subarray(from, from + frame.w * 4), y * frame.w * 4);
      }
      const out = stretchOne(one, spec, `${col},${row}`, shift);
      done.push({ col, row, out });
      W = Math.max(W, out.width);
      H = Math.max(H, out.height);
    }
  }
  const result = createImage(W * frame.cols, H * frame.rows);
  for (const { col, row, out } of done) {
    const ox = col * W + Math.floor((W - out.width) / 2);
    const oy = row * H + (H - out.height);
    for (let y = 0; y < out.height; y++) {
      result.data.set(out.data.subarray(y * out.width * 4, (y + 1) * out.width * 4), at(result, ox, oy + y));
    }
  }
  return { image: result, frame: { ...frame, w: W, h: H } };
}
