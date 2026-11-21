# RPG Maker MV/MZ generator format: what we know

Sources: Naoso's guide on the RPG Maker forums (MZ), the RPG Maker MV character generator tutorial PDF,
the Extended Generator tutorials page, and **one real third-party MZ pack** (SomeNewWork's Generator
Pack EX, 366 files, kept locally in git-ignored `test-assets/`). We haven't tested RPG Maker's own
parts yet. All format assumptions live in `src/format.js`.

## Folder layout
```
Generator/
  Face/{Male,Female,Kid}/   FG_<Layer>_p<N>_c<cell>[_m<NNN>].png   144x144, some MZ parts 160x160
  TV/{...}/                 TV_<Layer>_p<N>.png + TV_<Layer>_p<N>_c.png   144x192 (3x4 frames of 48)
  TVD/{...}/                TVD_<Layer>_p<N>[_c].png   144x48 (3x1 frames of 48)
  SV/{...}/                 SV_<Layer>_p<N>[_c].png    576x384 (9x6 frames of 64)
  Variation/{...}/          icon_<Part>_p<N>.png       64x64 thumbnails
  gradients.png             MV: one sheet, 256 wide, 4px per gradient
  grad_{skin,hair,eyes,common}.png   MZ: one sheet per category
```
- `<Layer>` = part name + optional layer number (`FrontHair1`, `Clothing2`, ...).
- `<N>` is any number of digits. ✅ Real packs use numbers like `p3459` and `p835` to avoid clashes.
- ✅ Face cells without `_mNNN` (e.g. `FG_Eyes_p2002_c2.png`) are fixed-colour layers (outlines, eye whites).
- ✅ Empty images are used as "none" variants (e.g. "no ears").

## Colouring
- **TV/TVD/SV:** the `_c` mask marks recolourable pixels with a fixed RGB per slot. White = keep.
  ✅ Every mask pixel in the real pack matches our slot table exactly. Masks are often palette PNGs
  (1/2/4/8-bit).
- **FG:** no masks. `_mNNN` assigns the whole layer to a slot.
- ✅ **Gradients run light → dark:** column 0 is white/highlight, column 255 is black/shadow, so
  a pixel's brightness B reads column `255 - B`. Real MZ sheets have 148 skin, 48 hair, 24 eye and
  68 common rows. Row 0 of `grad_common` is plain white.

## Open questions (need RPG Maker's own generator to compare)
1. **How brightness is measured.** 34–47% of pixels in recolourable areas are coloured, not grey.
   We use luminance (0.299R + 0.587G + 0.114B). RPG Maker might use a single channel or max(R,G,B).
2. **Draw order direction:** assumed top-most first (Wing2/Cloak2/RearHair2 at the end = behind body).
3. **160px face parts:** centred on the 144px face (8px cropped on each side). The horizontal
   centres in the real pack support this, but it hasn't been checked against RPG Maker's output.
4. **Eyebrows:** the forum says hair (m003) and the PDF says skin (m001). The real pack uses m003.
   We follow the filename either way.
5. Is a single 144x144 face PNG accepted by RPG Maker, or does it need a 576x288 sheet?
