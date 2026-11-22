// Regional transparency: one part only shows inside (or outside) another, e.g. hair that only
// shows in the opening of a hood. Pure: works on {width, height, data} images.

/** How a part is clipped by another. */
export const CLIP_MODES = {
  inside: 'inside the outline of',
  over: 'only where it overlaps',
  outside: 'except where it overlaps',
};

/** Pixels where the image is visible (alpha > 0). */
export function solidOf(image) {
  const solid = new Uint8Array(image.width * image.height);
  for (let i = 0; i < solid.length; i++) if (image.data[i * 4 + 3]) solid[i] = 1;
  return solid;
}

/**
 * The area "inside the outline" of a shape, per animation frame: the shape itself, plus every
 * gap that has the shape to its left, to its right and above it. That covers a hood's face
 * opening, which is usually open at the bottom, but not the space behind or beside it.
 * @param {{w:number,h:number}|null} frame null = the whole image is one frame
 */
export function insideOutline(solid, width, height, frame = null) {
  const inside = new Uint8Array(solid);
  const fw = frame?.w || width;
  const fh = frame?.h || height;
  for (let fy = 0; fy + fh <= height; fy += fh) {
    for (let fx = 0; fx + fw <= width; fx += fw) {
      const above = new Uint8Array(fw);
      for (let y = fy; y < fy + fh; y++) {
        let first = -1;
        let last = -1;
        for (let x = fx; x < fx + fw; x++) {
          if (!solid[y * width + x]) continue;
          if (first === -1) first = x;
          last = x;
        }
        for (let x = fx; x < fx + fw; x++) {
          const i = y * width + x;
          if (solid[i]) above[x - fx] = 1;
          else if (x > first && x < last && first !== -1 && above[x - fx]) inside[i] = 1;
        }
      }
    }
  }
  return inside;
}

/**
 * Applies a clip to `image` in place.
 * @param {Uint8Array} region solidOf (for "over"/"outside") or insideOutline (for "inside")
 */
export function applyClip(image, region, mode) {
  const keepInside = mode !== 'outside';
  for (let i = 0; i < region.length; i++) {
    if (!!region[i] !== keepInside) image.data[i * 4 + 3] = 0;
  }
  return image;
}
