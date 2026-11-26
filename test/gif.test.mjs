import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeGif } from '../src/gif.js';

/** A plain GIF decoder (as the format describes it), to read back what the encoder wrote. */
function decodeGif(bytes) {
  let p = 0;
  const u8 = () => bytes[p++];
  const u16 = () => bytes[p++] | (bytes[p++] << 8);
  const sig = String.fromCharCode(...bytes.slice(0, 6));
  p = 6;
  const width = u16();
  const height = u16();
  const packed = u8();
  p += 2;
  const tableSize = packed & 0x80 ? 1 << ((packed & 7) + 1) : 0;
  const palette = bytes.slice(p, p + tableSize * 3);
  p += tableSize * 3;
  const frames = [];
  let gce = null;
  let loops = false;
  for (;;) {
    const b = u8();
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = u8();
      if (label === 0xf9) {
        u8();
        const flags = u8();
        gce = { delay: u16(), transparent: flags & 1 ? u8() : (u8(), -1), disposal: (flags >> 2) & 7 };
        u8();
        continue;
      }
      if (label === 0xff) loops = true;
      for (let n = u8(); n; n = u8()) p += n;
      continue;
    }
    assert.equal(b, 0x2c);
    p += 4;
    const w = u16();
    const h = u16();
    u8();
    const min = u8();
    const data = [];
    for (let n = u8(); n; n = u8()) for (let k = 0; k < n; k++) data.push(u8());
    // LZW
    const clear = 1 << min;
    const end = clear + 1;
    let size = min + 1;
    let dict = [];
    const reset = () => {
      dict = [];
      for (let i = 0; i < clear; i++) dict.push([i]);
      dict.push(null, null);
      size = min + 1;
    };
    reset();
    const out = [];
    let prev = null;
    let bit = 0;
    for (;;) {
      let code = 0;
      for (let i = 0; i < size; i++, bit++) code |= ((data[bit >> 3] >> (bit & 7)) & 1) << i;
      if (code === clear) { reset(); prev = null; continue; }
      if (code === end) break;
      let entry;
      if (prev === null) entry = dict[code];
      else if (code < dict.length) {
        entry = dict[code];
        dict.push([...dict[prev], entry[0]]);
      } else {
        entry = [...dict[prev], dict[prev][0]];
        dict.push(entry);
      }
      out.push(...entry);
      prev = code;
      if (dict.length === 1 << size && size < 12) size++;
    }
    assert.equal(out.length, w * h);
    frames.push({ indices: out, ...gce });
  }
  return { sig, width, height, palette, frames, loops };
}

test('an animated GIF reads back with the same pixels, delay and transparency', () => {
  const w = 5;
  const h = 4;
  const frame = (shift) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      if ((i + shift) % 3 === 0) continue; // transparent
      d.set([(i * 40 + shift) % 256, 10, 200, 255], i * 4);
    }
    return d;
  };
  const frames = [frame(0), frame(1), frame(2)];
  const gif = decodeGif(encodeGif({ width: w, height: h, frames, delay: 150 }));
  assert.equal(gif.sig, 'GIF89a');
  assert.deepEqual([gif.width, gif.height, gif.frames.length, gif.loops], [5, 4, 3, true]);
  frames.forEach((data, n) => {
    const f = gif.frames[n];
    assert.equal(f.delay, 15);
    assert.equal(f.disposal, 2);
    for (let i = 0; i < w * h; i++) {
      const index = f.indices[i];
      if (data[i * 4 + 3] < 128) {
        assert.equal(index, f.transparent);
        continue;
      }
      assert.deepEqual([...gif.palette.slice(index * 3, index * 3 + 3)], [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
    }
  });
});

test('a big, many-coloured picture still compresses and reads back (codes up to 12 bits)', () => {
  const w = 120;
  const h = 90;
  const d = new Uint8ClampedArray(w * h * 4);
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 256;
  for (let i = 0; i < w * h; i++) d.set([rnd(), rnd(), rnd(), 255], i * 4);
  const gif = decodeGif(encodeGif({ width: w, height: h, frames: [d], background: [0, 0, 0] }));
  assert.equal(gif.frames[0].transparent, -1);
  // Colours were rounded to fit 256: each is close to the original.
  let worst = 0;
  for (let i = 0; i < w * h; i++) {
    const k = gif.frames[0].indices[i] * 3;
    for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(gif.palette[k + c] - d[i * 4 + c]));
  }
  assert.ok(worst <= 64, `worst ${worst}`);
});

test('a background colour fills transparent pixels', () => {
  const d = new Uint8ClampedArray(2 * 1 * 4);
  d.set([255, 0, 0, 255], 0);
  const gif = decodeGif(encodeGif({ width: 2, height: 1, frames: [d], background: [0, 255, 0] }));
  const at = (i) => [...gif.palette.slice(gif.frames[0].indices[i] * 3, gif.frames[0].indices[i] * 3 + 3)];
  assert.deepEqual(at(0), [255, 0, 0]);
  assert.deepEqual(at(1), [0, 255, 0]);
});
