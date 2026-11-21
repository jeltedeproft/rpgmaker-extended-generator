// Minimal PNG encoder/decoder (Node only, no dependencies).
import { deflateSync, inflateSync } from 'node:zlib';

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** @param {{width:number,height:number,data:Uint8ClampedArray}} image */
export function encodePng(image) {
  const { width, height, data } = image;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Decodes a non-interlaced PNG (greyscale, RGB, palette, grey+alpha, RGBA; 8-bit, or 1/2/4-bit
 * palette/grey) to {width, height, data: RGBA Uint8ClampedArray}.
 */
export function decodePng(buffer) {
  let pos = 8;
  let width, height, bitDepth, colorType, interlace;
  let palette = null;
  let transparency = null;
  const idat = [];
  while (pos < buffer.length) {
    const len = buffer.readUInt32BE(pos);
    const type = buffer.toString('ascii', pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') transparency = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (interlace) throw new Error('Interlaced PNGs are not supported');
  if (bitDepth === 16) throw new Error('16-bit PNGs are not supported');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const bpp = Math.max(1, (channels * bitDepth) / 8);
  const stride = Math.ceil((width * channels * bitDepth) / 8);
  const raw = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y ? pixels.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[x] = v & 255;
    }
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  const sample = (y, i) => {
    if (bitDepth === 8) return pixels[y * stride + i];
    const perByte = 8 / bitDepth;
    const byte = pixels[y * stride + Math.floor(i / perByte)];
    return (byte >> (8 - bitDepth * (1 + (i % perByte)))) & ((1 << bitDepth) - 1);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (colorType === 6) {
        for (let k = 0; k < 4; k++) rgba[o + k] = sample(y, x * 4 + k);
      } else if (colorType === 2) {
        for (let k = 0; k < 3; k++) rgba[o + k] = sample(y, x * 3 + k);
        rgba[o + 3] = 255;
      } else if (colorType === 3) {
        const idx = sample(y, x);
        rgba[o] = palette[idx * 3];
        rgba[o + 1] = palette[idx * 3 + 1];
        rgba[o + 2] = palette[idx * 3 + 2];
        rgba[o + 3] = transparency && idx < transparency.length ? transparency[idx] : 255;
      } else if (colorType === 0) {
        const g = Math.round((sample(y, x) * 255) / ((1 << bitDepth) - 1));
        rgba[o] = rgba[o + 1] = rgba[o + 2] = g;
        rgba[o + 3] = 255;
      } else if (colorType === 4) {
        rgba[o] = rgba[o + 1] = rgba[o + 2] = sample(y, x * 2);
        rgba[o + 3] = sample(y, x * 2 + 1);
      }
    }
  }
  return { width, height, data: rgba, colorType, bitDepth };
}
