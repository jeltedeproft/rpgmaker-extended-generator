// A face or a picture cut out of a bigger portrait: a full-body picture made of big portrait
// parts gives the 144 x 144 face (and other sizes) from the part of it you pick.

import { createImage } from './recolor.js';

/**
 * The crop box for an output of outW x outH: `crop.w` wide, as tall as the output's shape, kept
 * inside the picture. Without a crop: the top middle of the picture (where a face usually is).
 * @returns {{x:number, y:number, w:number, h:number}}
 */
export function cropBox(crop, picW, picH, outW, outH) {
  const aspect = outH / outW;
  let w = Math.round(crop?.w || Math.min(picW, picH / aspect, outW > picW ? picW : outW));
  w = Math.max(1, Math.min(w, picW, Math.floor(picH / aspect)));
  const h = Math.max(1, Math.round(w * aspect));
  const x = Math.round(crop ? crop.x : (picW - w) / 2);
  const y = Math.round(crop ? crop.y : 0);
  return { x: Math.max(0, Math.min(picW - w, x)), y: Math.max(0, Math.min(picH - h, y)), w, h };
}

/**
 * A box of a picture made outW x outH. Shrinking averages the pixels each output pixel covers
 * (weighted by their alpha, so edges don't darken); growing repeats pixels (pixel art stays sharp).
 */
export function cropScale(image, box, outW, outH) {
  const out = createImage(outW, outH);
  const sx = box.w / outW;
  const sy = box.h / outH;
  for (let oy = 0; oy < outH; oy++) {
    const y0 = box.y + oy * sy;
    const y1 = y0 + sy;
    for (let ox = 0; ox < outW; ox++) {
      const x0 = box.x + ox * sx;
      const x1 = x0 + sx;
      const o = (oy * outW + ox) * 4;
      if (sx <= 1 && sy <= 1) {
        const i = (Math.min(image.height - 1, Math.floor(y0)) * image.width + Math.min(image.width - 1, Math.floor(x0))) * 4;
        out.data.set(image.data.subarray(i, i + 4), o);
        continue;
      }
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let area = 0;
      for (let y = Math.floor(y0); y < Math.ceil(y1) && y < image.height; y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0);
        for (let x = Math.floor(x0); x < Math.ceil(x1) && x < image.width; x++) {
          const wt = wy * (Math.min(x + 1, x1) - Math.max(x, x0));
          const i = (y * image.width + x) * 4;
          const al = image.data[i + 3] * wt;
          r += image.data[i] * al;
          g += image.data[i + 1] * al;
          b += image.data[i + 2] * al;
          a += al;
          area += wt;
        }
      }
      if (a > 0) out.data.set([r / a, g / a, b / a, a / area], o);
    }
  }
  return out;
}
