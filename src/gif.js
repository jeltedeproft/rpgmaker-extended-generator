// Animated GIF encoder: frames of RGBA pixels -> GIF89a bytes. No dependencies.
// Pixel art rarely has more than 255 colours; when it has, colours are rounded to fewer bits until
// they fit. Transparent pixels (alpha < 128) get a colour index of their own, unless a background
// colour is given: then every pixel is laid on it.

/**
 * @param {{width:number, height:number, frames:Uint8ClampedArray[]|Uint8Array[], delay:number,
 *   background?:number[]|null, loop?:boolean}} options delay in milliseconds per frame;
 *   background [r, g, b] or null for transparent
 * @returns {Uint8Array}
 */
export function encodeGif({ width, height, frames, delay = 180, background = null, loop = true }) {
  const transparent = !background;
  // 1. Every frame as 0xRRGGBB values, -1 for transparent.
  const rgbFrames = frames.map((data) => {
    const out = new Int32Array(width * height);
    for (let i = 0; i < out.length; i++) {
      const a = data[i * 4 + 3];
      if (transparent) {
        out[i] = a < 128 ? -1 : (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2];
        continue;
      }
      // Laid on the background.
      const mix = (c, b) => Math.round((c * a + b * (255 - a)) / 255);
      out[i] = (mix(data[i * 4], background[0]) << 16) | (mix(data[i * 4 + 1], background[1]) << 8) | mix(data[i * 4 + 2], background[2]);
    }
    return out;
  });

  // 2. A palette of at most 256 entries (one kept for transparent).
  const room = transparent ? 255 : 256;
  let bits = 8;
  let palette;
  const reduce = (c) => {
    if (bits === 8) return c;
    const mask = (0xff << (8 - bits)) & 0xff;
    const half = 1 << (7 - bits);
    const ch = (v) => Math.min(255, (v & mask) + half);
    return (ch(c >> 16) << 16) | (ch((c >> 8) & 0xff) << 8) | ch(c & 0xff);
  };
  for (;;) {
    palette = new Map();
    for (const f of rgbFrames) {
      for (const c of f) {
        if (c < 0) continue;
        const r = reduce(c);
        if (!palette.has(r)) palette.set(r, palette.size + (transparent ? 1 : 0));
        if (palette.size > room) break;
      }
      if (palette.size > room) break;
    }
    if (palette.size <= room || bits === 1) break;
    bits--;
  }
  const entries = palette.size + (transparent ? 1 : 0);
  let tableBits = 1;
  while ((1 << tableBits) < Math.max(2, entries)) tableBits++;
  const table = new Uint8Array(3 * (1 << tableBits));
  for (const [c, index] of palette) table.set([c >> 16, (c >> 8) & 0xff, c & 0xff], index * 3);

  // 3. The file.
  const bytes = [];
  const u16 = (n) => bytes.push(n & 0xff, (n >> 8) & 0xff);
  const ascii = (s) => { for (const ch of s) bytes.push(ch.charCodeAt(0)); };
  ascii('GIF89a');
  u16(width);
  u16(height);
  bytes.push(0x80 | 0x70 | (tableBits - 1), 0, 0);
  for (const b of table) bytes.push(b);
  if (loop) {
    bytes.push(0x21, 0xff, 0x0b);
    ascii('NETSCAPE2.0');
    bytes.push(0x03, 0x01, 0x00, 0x00, 0x00);
  }
  const centiseconds = Math.max(2, Math.round(delay / 10));
  const minCodeSize = Math.max(2, tableBits);
  for (const f of rgbFrames) {
    // Graphic control: restore to background after each frame (disposal 2), so transparent parts
    // of the next frame don't show this one.
    bytes.push(0x21, 0xf9, 0x04, (2 << 2) | (transparent ? 1 : 0));
    u16(centiseconds);
    bytes.push(0, 0);
    bytes.push(0x2c);
    u16(0);
    u16(0);
    u16(width);
    u16(height);
    bytes.push(0);
    const indices = new Uint8Array(f.length);
    for (let i = 0; i < f.length; i++) indices[i] = f[i] < 0 ? 0 : palette.get(reduce(f[i]));
    bytes.push(minCodeSize);
    const data = lzw(indices, minCodeSize);
    for (let i = 0; i < data.length; i += 255) {
      const n = Math.min(255, data.length - i);
      bytes.push(n);
      for (let k = 0; k < n; k++) bytes.push(data[i + k]);
    }
    bytes.push(0);
  }
  bytes.push(0x3b);
  return Uint8Array.from(bytes);
}

/** GIF's LZW compression of colour indices, as variable-length codes packed into bytes. */
export function lzw(indices, minCodeSize) {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = end + 1;
  let table = new Map();
  const out = [];
  let acc = 0;
  let accBits = 0;
  const emit = (code) => {
    acc |= code << accBits;
    accBits += codeSize;
    while (accBits >= 8) {
      out.push(acc & 0xff);
      acc >>>= 8;
      accBits -= 8;
    }
  };
  emit(clear);
  if (!indices.length) {
    emit(end);
    if (accBits) out.push(acc & 0xff);
    return out;
  }
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const found = table.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      table = new Map();
      next = end + 1;
      codeSize = minCodeSize + 1;
    } else {
      if (next >= 1 << codeSize) codeSize++;
      table.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(end);
  if (accBits) out.push(acc & 0xff);
  return out;
}
