// 8-direction walk sheets (for diagonal-movement plugins): RPG Maker's 3 x 4 walk sheet with 4
// more rows under it, the diagonals: down-left, down-right, up-left, up-right.

import { createImage } from './recolor.js';

export const DIAGONALS = ['Down-left', 'Down-right', 'Up-left', 'Up-right'];
/** For a part drawn in 4 directions only: the walk row (down, left, right, up) each diagonal shows. */
const FALLBACK_ROWS = [1, 2, 1, 2];

/** The given rows of a 4-row sheet, in that order. */
function pickRows(image, pick) {
  const fh = image.height / 4;
  const out = createImage(image.width, fh * pick.length);
  const bytes = image.width * fh * 4;
  for (const [i, row] of pick.entries()) out.data.set(image.data.subarray(row * bytes, (row + 1) * bytes), i * bytes);
  return out;
}

/** An 8-row sheet as its walk sheet (rows 1-4) and its diagonals (rows 5-8), each 4 rows. */
export function split8(image) {
  if (!image || image.height % 8) return { walk: image, diagonal: null };
  const half = image.height / 2;
  const top = createImage(image.width, half);
  const bottom = createImage(image.width, half);
  const bytes = image.width * half * 4;
  top.data.set(image.data.subarray(0, bytes));
  bottom.data.set(image.data.subarray(bytes, bytes * 2));
  return { walk: top, diagonal: bottom };
}

/** Diagonals for a part drawn in 4 directions: each shows the side it faces (left or right). */
export function diagonalFallback(walk) {
  if (!walk || walk.height % 4) return walk;
  return pickRows(walk, FALLBACK_ROWS);
}

/** The walk sheet and its diagonals as one 8-row sheet. */
export function join8(walk, diagonal) {
  const out = createImage(Math.max(walk.width, diagonal.width), walk.height + diagonal.height);
  for (let y = 0; y < walk.height; y++) out.data.set(walk.data.subarray(y * walk.width * 4, (y + 1) * walk.width * 4), y * out.width * 4);
  for (let y = 0; y < diagonal.height; y++) out.data.set(diagonal.data.subarray(y * diagonal.width * 4, (y + 1) * diagonal.width * 4), (walk.height + y) * out.width * 4);
  return out;
}

// ---------- diagonals made from the 4 directions ----------

/** How the diagonals of a part drawn in 4 directions are made: turned (a little or more), or the side view. */
export const DIAGONAL_MODES = {
  // The head turned and skewed toward the side; below the neck the body of the side picture, which
  // stands turned already (its stance, legs and arm).
  turned: { label: 'Turned', options: { near: 0.65, far: 1.25, shift: 4, skew: 2, inside: 'up', faceShift: 2, sideBody: { from: 0.6, shift: 1 } } },
  more: { label: 'Turned more', options: { near: 0.55, far: 1.35, shift: 5, skew: 3, inside: 'up', faceShift: 3, sideBody: { from: 0.6, shift: 1 } } },
  side: { label: 'Side view', options: null },
};

/**
 * The diagonal rows of a 4-direction walk picture, made the given way (default: turned).
 * kind: 'face' for a part on the front of the face (eyes, mouth, nose...): it moves further toward
 * the turn than the head's outline, which makes a face read as turned rather than squeezed; 'head'
 * for the rest of the head (face, ears); else the body, clothes, hair...
 */
export function diagonalsOf(walk, mode = 'turned', kind = null) {
  const options = (DIAGONAL_MODES[mode] || DIAGONAL_MODES.turned).options;
  if (!options) return diagonalFallback(walk);
  const o = { ...options };
  // Only the head shows its side going up (an ear, a cheek): a body or clothes doing that showed a
  // second arm and leg on the back.
  if (kind !== 'head' && kind !== 'face' && kind !== true) o.inside = false;
  if (kind === 'face' || kind === true) o.shift += options.faceShift || 0;
  return diagonalWarp(walk, o);
}

/**
 * Diagonals by turning the front (or back) picture: the half on the side it turns to narrower, the
 * other half wider, all moved toward that side. One outline, never a second head. Up diagonals
 * (inside: 'up') also show the side picture, only within that outline: the side of the face peeks
 * out past the back of the head. Only the frame's size decides where pixels go, so parts and colour
 * masks stay together.
 * @param {{cols?:number, near?:number, far?:number, shift?:number, inside?:boolean|'up', sideShift?:number, gap?:number}} [options]
 *   near: how wide the half it turns to stays; far: how wide the other half becomes; shift: pixels
 */
export function diagonalWarp(walk, { cols, near = 0.8, far = 1.12, shift = 2, inside = false, sideShift = 3, gap = 2, body = null, neck = [0.5, 0.62], skew = 0, sideBody = null } = {}) {
  if (!walk || walk.height % 4) return walk;
  const fh = walk.height / 4;
  const n = cols || (walk.width % 3 === 0 ? 3 : Math.max(1, Math.round(walk.width / fh)));
  const fw = Math.floor(walk.width / n);
  const out = createImage(walk.width, walk.height);
  const cx = fw / 2;
  // Below the neck the body turns less than the head (body: {near, far, shift}), so the arms keep
  // their width instead of one going thin and the other fat. Between the two it changes gradually.
  const lerp = (a, b, t) => a + (b - a) * t;
  const rowTurn = (y) => {
    if (!body) return { near, far, shift };
    const t = Math.min(1, Math.max(0, ((y + 0.5) / fh - neck[0]) / (neck[1] - neck[0])));
    return { near: lerp(near, body.near, t), far: lerp(far, body.far, t), shift: lerp(shift, body.shift, t) };
  };
  // [front or back row, which way it turns: -1 left, 1 right, back?, the side row it turns to]
  const MADE = [[0, -1, false, 1], [0, 1, false, 2], [3, -1, true, 1], [3, 1, true, 2]];
  for (const [d, [main, dir, back, sideRow]] of MADE.entries()) {
    // Seen from the back, the middle of the back moves away from the side it turns to.
    const side = back ? -dir : dir;
    for (let y = 0; y < fh; y++) {
      // Below the neck, the body from the side picture it turns to (its stance and legs).
      if (sideBody && (y + 0.5) / fh >= sideBody.from) {
        const off = Math.round(-dir * (sideBody.shift || 0));
        for (let c = 0; c < n; c++) {
          const o = (d * fh + y) * out.width + c * fw;
          const s = ((back && sideBody.backRow != null ? sideBody.backRow : sideRow) * fh + y) * walk.width + c * fw;
          for (let x = 0; x < fw; x++) {
            const sx = x - off;
            if (sx < 0 || sx >= fw) continue;
            const si = (s + sx) * 4;
            if (walk.data[si + 3]) out.data.set(walk.data.subarray(si, si + 4), (o + x) * 4);
          }
        }
        continue;
      }
      const turn = rowTurn(y);
      // Skew: the top of the head leans further into the turn than the chin.
      const lean = skew ? skew * Math.max(0, neck[0] - (y + 0.5) / fh) / neck[0] : 0;
      const mid = cx + side * (turn.shift + lean);
      const from = [];
      for (let x = 0; x < fw; x++) {
        const u = x + 0.5 - mid;
        const sx = Math.floor(cx + (Math.sign(u) === side ? u / turn.near : u / turn.far));
        from.push(sx >= 0 && sx < fw ? sx : -1);
      }
      for (let c = 0; c < n; c++) {
        const o = (d * fh + y) * out.width + c * fw;
        const s = (main * fh + y) * walk.width + c * fw;
        for (let x = 0; x < fw; x++) {
          if (from[x] < 0) continue;
          const si = (s + from[x]) * 4;
          if (walk.data[si + 3]) out.data.set(walk.data.subarray(si, si + 4), (o + x) * 4);
        }
        // Inside: the side picture's far half (ear, cheek) painted within the outline only.
        if (!(inside === true || (inside === 'up' && back))) continue;
        const ss = (sideRow * fh + y) * walk.width + c * fw;
        for (let x = 0; x < fw; x++) {
          if ((x + 0.5 - mid) * side > -gap) continue;
          const oi = (o + x) * 4;
          if (!out.data[oi + 3]) continue;
          const sx = Math.round(x + side * sideShift);
          if (sx < 0 || sx >= fw) continue;
          const si = (ss + sx) * 4;
          if (walk.data[si + 3]) out.data.set(walk.data.subarray(si, si + 4), oi);
        }
      }
    }
  }
  return out;
}
