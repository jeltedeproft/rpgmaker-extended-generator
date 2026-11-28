// Splits an image into "islands": groups of pixels separated by transparent gaps, e.g. the left
// and right eye of an Eyes part. Pure: works on {width, height, data} images.

/** Islands smaller than this many pixels join the nearest bigger island (stray specks). */
const MIN_ISLAND = 3;
const cache = new Map();
const CACHE_LIMIT = 64;

/**
 * Labels every visible pixel with its island number (1, 2, ...), counted left to right within
 * each animation frame, so "piece 1" is the left-most island in every frame.
 * @param {object[]} images same-size images, treated as one (all layers of a part)
 * @param {{w:number,h:number}|null} frame null = the whole image is one frame
 * @param {number} gap transparent pixels that still join two islands (0 = only touching pixels)
 * @param {string} [cacheKey] identifies the images, to skip recomputing on every redraw
 * @returns {{labels:Uint8Array, count:number}} count = most islands found in any one frame
 */
export function islandLabels(images, frame, gap = 0, cacheKey = null) {
  const key = cacheKey && `${cacheKey}|${frame?.w}x${frame?.h}|${gap}`;
  if (key && cache.has(key)) return cache.get(key);

  const { width, height } = images[0];
  const solid = new Uint8Array(width * height);
  for (const image of images) {
    for (let i = 0; i < solid.length; i++) if (image.data[i * 4 + 3]) solid[i] = 1;
  }
  const labels = new Uint8Array(width * height);
  const reach = Math.max(0, Math.round(gap)) + 1;
  const fw = frame?.w || width;
  const fh = frame?.h || height;
  let count = 0;
  // Islands per frame, "col,row" -> count (only frames with something in them).
  const frames = {};

  for (let fy = 0; fy + fh <= height; fy += fh) {
    for (let fx = 0; fx + fw <= width; fx += fw) {
      // Flood-fill the islands of this frame.
      const islands = [];
      const owner = new Map();
      for (let y = fy; y < fy + fh; y++) {
        for (let x = fx; x < fx + fw; x++) {
          const start = y * width + x;
          if (!solid[start] || owner.has(start)) continue;
          const island = { pixels: [], sx: 0, sy: 0 };
          owner.set(start, island);
          const stack = [start];
          while (stack.length) {
            const p = stack.pop();
            const px = p % width;
            const py = (p - px) / width;
            island.pixels.push(p);
            island.sx += px;
            island.sy += py;
            for (let ny = Math.max(fy, py - reach); ny <= Math.min(fy + fh - 1, py + reach); ny++) {
              for (let nx = Math.max(fx, px - reach); nx <= Math.min(fx + fw - 1, px + reach); nx++) {
                const n = ny * width + nx;
                if (solid[n] && !owner.has(n)) {
                  owner.set(n, island);
                  stack.push(n);
                }
              }
            }
          }
          island.cx = island.sx / island.pixels.length;
          island.cy = island.sy / island.pixels.length;
          islands.push(island);
        }
      }
      // Specks join the nearest real island.
      const big = islands.filter((i) => i.pixels.length >= MIN_ISLAND);
      const kept = big.length ? big : islands;
      for (const island of islands) {
        if (kept.includes(island)) continue;
        let best = kept[0];
        for (const k of kept) {
          if (Math.hypot(k.cx - island.cx, k.cy - island.cy) < Math.hypot(best.cx - island.cx, best.cy - island.cy)) best = k;
        }
        best.pixels.push(...island.pixels);
      }
      kept.sort((a, b) => a.cx - b.cx || a.cy - b.cy);
      kept.forEach((island, i) => {
        for (const p of island.pixels) labels[p] = Math.min(255, i + 1);
      });
      count = Math.max(count, kept.length);
      if (kept.length) frames[`${fx / fw},${fy / fh}`] = kept.length;
    }
  }
  const result = { labels, count, frames };
  if (key) {
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
    cache.set(key, result);
  }
  return result;
}

/**
 * A picked area of a picture as text: runs of 0s and 1s ("12.3.40..."), first a run of 0s.
 * @param {Uint8Array} sel 1 = picked
 */
export function encodeMask(sel) {
  const runs = [];
  let value = 0;
  let run = 0;
  for (let i = 0; i < sel.length; i++) {
    if ((sel[i] ? 1 : 0) === value) run++;
    else {
      runs.push(run.toString(36));
      value = 1 - value;
      run = 1;
    }
  }
  runs.push(run.toString(36));
  return runs.join('.');
}

/** encodeMask back to a Uint8Array of `length` (shorter text: the rest is 0). */
export function decodeMask(text, length) {
  const sel = new Uint8Array(length);
  let i = 0;
  let value = 0;
  for (const run of String(text || '').split('.')) {
    const n = parseInt(run, 36) || 0;
    if (value) sel.fill(1, i, Math.min(length, i + n));
    i += n;
    value = 1 - value;
  }
  return sel;
}

/** A copy of `image` without the picked pixels (keep = false), or with only them (keep = true). */
export function maskPicture(image, sel, keep) {
  const out = { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
  for (let i = 0; i < sel.length; i++) if (!!sel[i] !== keep) out.data[i * 4 + 3] = 0;
  return out;
}

/** A copy of `image` with only the pixels of island `n` (1-based) left. */
export function keepIsland(image, labels, n) {
  const out = { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== n) out.data[i * 4 + 3] = 0;
  }
  return out;
}
