// Cutting finished sheets into pieces: a sheet of eight characters into one picture per
// character, a walk sheet into its frames, and so on. Pure functions; the pictures are cut in app.js.

/** Grids offered for cutting: [columns, rows, label]. */
export const CUT_PRESETS = [
  [4, 2, '8 characters (4 x 2)'],
  [12, 8, 'Every frame of 8 characters (12 x 8)'],
  [3, 4, 'Frames of one walk sheet (3 x 4)'],
  [9, 6, 'Frames of a battler (9 x 6)'],
  [1, 4, 'Rows (walk directions)'],
  [3, 1, 'Columns'],
];

/**
 * The grid a finished sheet most likely has: "$Name.png" is one character; a sheet as wide as 12
 * square frames and as high as 8 holds eight characters (4 x 2); else one picture.
 */
export function guessGrid(width, height, fileName = '') {
  if (/^\$/.test(fileName)) return [1, 1];
  if (width % 12 === 0 && height % 8 === 0 && width / 12 === height / 8) return [4, 2];
  // RPG Maker 2000/2003 charsets: 288 x 256, 8 characters of 3 x 4 frames of 24 x 32.
  if (width % 12 === 0 && height % 8 === 0 && (width / 12) * 4 === (height / 8) * 3) return [4, 2];
  // A named sheet without "$" (e.g. "!Crystal.png", 576 x 768) holds 8 characters of any frame
  // size: RPG Maker reads it that way.
  if (fileName && width % 12 === 0 && height % 8 === 0 && width >= 288) return [4, 2];
  return [1, 1];
}

/** The rectangle of one cell (column, row) of a picture cut into cols x rows. Edges are whole pixels. */
export function cellRect(width, height, cols, rows, col, row) {
  const x = Math.round((col * width) / cols);
  const y = Math.round((row * height) / rows);
  return { x, y, w: Math.round(((col + 1) * width) / cols) - x, h: Math.round(((row + 1) * height) / rows) - y };
}

/** The file name of a cut piece: "Actor1 (row 2, col 3).png", in the folder of the sheet. */
export function cutPath(path, cols, rows, col, row) {
  const dir = path.slice(0, path.lastIndexOf('/') + 1);
  const stem = path.slice(dir.length).replace(/\.png$/i, '');
  const where = rows > 1 && cols > 1 ? `row ${row + 1}, col ${col + 1}` : rows > 1 ? `row ${row + 1}` : `col ${col + 1}`;
  return `${dir}${stem} (${where}).png`;
}

/** Copies one rectangle out of a picture ({width, height, data}). */
export function cropImage(image, { x, y, w, h }) {
  const out = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  for (let row = 0; row < h; row++) {
    const start = ((y + row) * image.width + x) * 4;
    out.data.set(image.data.subarray(start, start + w * 4), row * w * 4);
  }
  return out;
}

/** Whether a picture has anything drawn (not all transparent): empty cells are not kept. */
export function hasPixels(image) {
  for (let i = 3; i < image.data.length; i += 4) if (image.data[i] > 16) return true;
  return false;
}

/** The smallest rectangle holding everything drawn in a picture, or null when it is empty. */
export function drawnBounds(image) {
  let x0 = image.width;
  let y0 = image.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.data[(y * image.width + x) * 4 + 3] <= 16) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
