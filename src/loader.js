// Browser-only: reading folders, decoding PNGs to pixels, exporting.

import { cellOf } from './vxace.js';
import { splitGradientImage } from './gradients.js';
import { scanMask } from './recolor.js';

/** Entries from <input type=file webkitdirectory>. */
export function entriesFromFileList(fileList) {
  return [...fileList].map((file) => ({ path: file.webkitRelativePath || file.name, src: file }));
}

/** Entries from a drag-and-drop of folders and/or files. */
export async function entriesFromDrop(dataTransfer) {
  const roots = [...dataTransfer.items].map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
  const entries = [];
  async function walk(entry, prefix) {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      entries.push({ path: prefix + entry.name, src: file });
      return;
    }
    const reader = entry.createReader();
    // readEntries returns results in batches; keep reading until empty.
    for (;;) {
      const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) break;
      for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
    }
  }
  for (const root of roots) await walk(root, '');
  return entries;
}

/** A pack name from the top folder of the entries. */
export function packNameFromEntries(entries, fallback = 'Pack') {
  const first = entries[0]?.path.split('/')[0];
  return first && entries.every((e) => e.path.startsWith(first + '/')) ? first : fallback;
}

/** Entries for the bundled sample kit (src = URL). */
export async function sampleKitEntries(baseUrl = 'sample-kit/') {
  const manifest = await (await fetch(baseUrl + 'manifest.json')).json();
  return manifest.files.map((path) => ({ path, src: baseUrl + path }));
}

async function toBlob(src) {
  if (typeof src === 'string') {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`${src}: HTTP ${res.status}`);
    return res.blob();
  }
  return src;
}

/** Reads a text file (File, Blob or URL). */
export async function readText(src) {
  return (await toBlob(src)).text();
}

/** Decodes a PNG (File, Blob or URL) to {width, height, data}. Colours are not premultiplied/converted. */
export async function decodeImage(src) {
  const bitmap = await createImageBitmap(await toBlob(src), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

const pending = new WeakMap();

/** Decodes an image ref ({src, pixels}) once; concurrent calls share the work. */
/** VX Ace files hold several layers (cells of colours): decode each file once for all of them. */
const sharedDecodes = new Map();
function decodeShared(src) {
  if (!sharedDecodes.has(src)) {
    const job = decodeImage(src).finally(() => setTimeout(() => sharedDecodes.delete(src), 2000));
    sharedDecodes.set(src, job);
  }
  return sharedDecodes.get(src);
}

export function ensureImage(ref, isMask = false) {
  if (!ref || ref.pixels) return Promise.resolve(ref?.pixels);
  if (!pending.has(ref)) {
    // A VX Ace layer's pixels are its first painted colour; the whole file stays in ref.full.
    const decoded = ref.cells
      ? decodeShared(ref.src).then((full) => {
        ref.full = full;
        return cellOf(ref, 0);
      })
      : decodeImage(ref.src);
    pending.set(
      ref,
      decoded.then((pixels) => {
        ref.pixels = pixels;
        if (isMask) {
          // slots: colours the editor offers. unknownColors: mask colours that match no slot.
          const { slots, unknown } = scanMask(pixels);
          ref.slots = slots;
          ref.unknownColors = unknown;
        }
        return pixels;
      }),
    );
  }
  return pending.get(ref);
}

/** Decodes the given layers (image and mask). Returns error messages instead of throwing. */
export async function ensureLayers(layers) {
  const errors = [];
  await Promise.all(layers.flatMap((layer) => [
    ensureImage(layer.base).catch((e) => errors.push(`${layer.base.path}: ${e.message}`)),
    layer.mask && ensureImage(layer.mask, true).catch((e) => errors.push(`${layer.mask.path}: ${e.message}`)),
  ]));
  return errors;
}

/** Decodes every layer of the given variants. Returns error messages instead of throwing. */
export async function ensureVariants(variants) {
  const errors = [];
  const jobs = [];
  for (const v of variants) {
    for (const layer of v.layers) {
      jobs.push(ensureImage(layer.base).catch((e) => errors.push(`${layer.base.path}: ${e.message}`)));
      if (layer.mask) jobs.push(ensureImage(layer.mask, true).catch((e) => errors.push(`${layer.mask.path}: ${e.message}`)));
    }
  }
  await Promise.all(jobs);
  return errors;
}

/** Decodes all gradient files found in the library. */
export async function loadGradients(library) {
  const gradients = [];
  const errors = [];
  for (const g of library.gradientFiles) {
    try {
      const pixels = await decodeImage(g.src);
      const name = g.path.split('/').pop().replace(/\.png$/i, '');
      gradients.push(...splitGradientImage(pixels, { pack: g.pack, name, category: g.category }));
    } catch (e) {
      errors.push(`${g.path}: ${e.message}`);
    }
  }
  return { gradients, errors };
}

/** Image -> canvas element. */
export function toCanvas(image) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  return canvas;
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadImage(image, fileName) {
  return new Promise((resolve) => toCanvas(image).toBlob((blob) => {
    downloadBlob(blob, fileName);
    resolve();
  }, 'image/png'));
}

// ---------- remembered folders (File System Access API: Chrome/Edge) ----------
// Other browsers fall back to <input webkitdirectory>, which can't be remembered.

export const canRememberFolders = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

export async function pickFolder() {
  return window.showDirectoryPicker({ id: 'xgen-generator', mode: 'read' });
}

/** Entries from a directory handle; paths start with the folder's name like webkitRelativePath. */
export async function entriesFromHandle(handle, prefix = handle.name + '/') {
  const entries = [];
  for await (const [name, child] of handle.entries()) {
    if (child.kind === 'directory') entries.push(...(await entriesFromHandle(child, `${prefix}${name}/`)));
    else if (/\.(png|txt|md|json)$/i.test(name)) entries.push({ path: prefix + name, src: await child.getFile() });
  }
  return entries;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('xgen', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('folders');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('folders', mode);
    const result = fn(tx.objectStore('folders'));
    tx.oncomplete = () => resolve(result.result ?? result);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Remembers a folder for next time. The same folder is stored once; two different folders with
 * the same name ("Generator") both stay, as "Generator" and "Generator (2)".
 */
export async function rememberFolder(handle) {
  try {
    const known = await rememberedFolders();
    for (const { key, handle: h } of known) {
      if (await h.isSameEntry(handle)) return key;
    }
    let key = handle.name;
    for (let n = 2; known.some((k) => k.key === key); n++) key = `${handle.name} (${n})`;
    await withStore('readwrite', (s) => s.put(handle, key));
    return key;
  } catch {
    return null; // storage blocked: the folder just won't be remembered
  }
}

export async function forgetFolder(key) {
  try {
    await withStore('readwrite', (s) => s.delete(key));
  } catch { /* ignore */ }
}

/** @returns {Promise<{key:string, handle:FileSystemDirectoryHandle}[]>} in the order they were added */
export async function rememberedFolders() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('folders', 'readonly');
      const result = [];
      const req = tx.objectStore('folders').openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        result.push({ key: String(cursor.key), handle: cursor.value });
        cursor.continue();
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return [];
  }
}

/** Without asking: is read access to a remembered folder still granted? */
export async function hasReadPermission(handle) {
  try {
    return (await handle.queryPermission({ mode: 'read' })) === 'granted';
  } catch {
    return false;
  }
}

/**
 * Folder handles of a drop (Chrome/Edge), so dropped folders can be remembered too. Must be
 * called right away in the drop event, before anything is awaited.
 * @returns {Promise<FileSystemDirectoryHandle[]>}
 */
export function dropFolderHandles(dataTransfer) {
  if (!canRememberFolders) return Promise.resolve([]);
  const pending = [...dataTransfer.items].filter((i) => i.kind === 'file').map((i) => i.getAsFileSystemHandle?.());
  return Promise.all(pending.map((p) => Promise.resolve(p).catch(() => null)))
    .then((handles) => handles.filter((h) => h?.kind === 'directory'));
}

/** Asks for read access again (must run inside a click handler). */
export async function ensureReadPermission(handle) {
  const opts = { mode: 'read' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}
