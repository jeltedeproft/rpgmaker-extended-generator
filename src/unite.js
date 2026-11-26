// RPG Maker Unite: character images of any size, one animation per picture with its frames side by
// side, 1 pixel of transparent space around the outside and 2 pixels between frames
// (rpgmakerunite.com, "Character Related"). Plus a small zip writer, to save them all as one file.

import { createImage } from './recolor.js';

/** Space around the strip and between frames, in pixels. */
export const UNITE_BORDER = 1;
export const UNITE_GAP = 2;

/**
 * One animation as a Unite strip: the given frames of a sheet, left to right.
 * @param {{width:number, height:number, data:Uint8ClampedArray}} image the sheet
 * @param {{w:number, h:number}} frame size of one frame
 * @param {Array<[number, number]>} cells [column, row] of each frame, in playing order
 */
export function uniteStrip(image, frame, cells) {
  const n = cells.length;
  const out = createImage(n * frame.w + (n - 1) * UNITE_GAP + 2 * UNITE_BORDER, frame.h + 2 * UNITE_BORDER);
  for (const [i, [col, row]] of cells.entries()) {
    const x0 = UNITE_BORDER + i * (frame.w + UNITE_GAP);
    for (let y = 0; y < frame.h; y++) {
      const from = ((row * frame.h + y) * image.width + col * frame.w) * 4;
      out.data.set(image.data.subarray(from, from + frame.w * 4), ((UNITE_BORDER + y) * out.width + x0) * 4);
    }
  }
  return out;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * A zip file of the given files, stored (PNGs are compressed already).
 * @param {Array<{name:string, bytes:Uint8Array}>} files
 * @returns {Uint8Array}
 */
export function zipFiles(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.bytes);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // names in UTF-8
    local.setUint32(14, crc, true);
    local.setUint32(18, f.bytes.length, true);
    local.setUint32(22, f.bytes.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, f.bytes);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, f.bytes.length, true);
    entry.setUint32(24, f.bytes.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + f.bytes.length;
  }
  const size = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
