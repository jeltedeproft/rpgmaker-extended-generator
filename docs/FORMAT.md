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
- ✅ **Official MZ `grad_eyes.png`** (from the tester): 256x48, 12 rows, white at column 0, the
  eye colour in the middle, black at column 255. Same direction as ours. The SomeNewWork pack's first
  12 rows are the same gradients (tiny differences from re-saving) plus 12 extra rows.

## Official files (from the tester, kept locally in `test-assets/`)
- ✅ **RPG Maker MV `Generator`** (4391 files, Male/Female/Kid): every numbered part parses; 1366
  masks, all colours in our slot table except ~600 stray pixels (artist slips, e.g. 148 px of
  `#da7912` in one SV_Clothing2). Some PNGs are interlaced (browsers handle that; `tools/png.mjs`
  now does too).
- User folders contain copies like `TV_Body_p01 (2).png` (RPG Maker's DLC readme tells you to
  rename clashing files) and ids like `p2-2`. Both are read; the copy number shows in the label.
- **MZ Basic Resources DLC**: normal parts plus `odd-eye_bodies/<left_colour>/<Body>/{SV,TV}_body_p01[_c].png`.
  Note lowercase `body`. The left eye is pre-painted (blue/green/red/yellow) and only the right eye
  is in the mask. RPG Maker expects you to swap them over the real body files. We read the
  `<left_colour>` folder as a **set**: the variant is `Body p01 (left_green)`, and sheets it doesn't
  have (face, damage) come from the plain `Body p01`.

- ✅ **RPG Maker MZ `generator`** (4735 files): every part parses except one typo'd official file
  (`FG_FrontHair_p17_c1].png`). Findings:
  - MZ's `TV_Body` masks mark part of each eye `#1380f8` instead of the eye colour `#2c80cb` (the
    tester's "alien eyes"). Clothing masks contain off-whites (`#fffffd`, `#fbfdfe`...) and other
    near-misses. Rule: an unknown mask colour joins the closest slot **that the same mask already
    uses**, or white (keep), if within 64 per channel. RPG Maker's exact rule is unverified, but this
    leaves 8 colours (about 10 pixels) unmatched across all 1375 masks.
  - A face cell can exist twice: fixed (`FG_Beard_p07_c1`) and recoloured (`FG_Beard_p07_c1_m003`,
    identical pixels). Both are kept; the recoloured one is drawn on top.

## Open questions (need RPG Maker's own generator to compare)
1. **How brightness is measured.** 34–47% of pixels in recolourable areas are coloured, not grey.
   We use luminance (0.299R + 0.587G + 0.114B). RPG Maker might use a single channel or max(R,G,B).
2. **Draw order direction:** assumed top-most first (Wing2/Cloak2/RearHair2 at the end = behind body).
3. **160px face parts:** centred on the 144px face (8px cropped on each side). The horizontal
   centres in the real pack support this, but it hasn't been checked against RPG Maker's output.
4. **Eyebrows:** the forum says hair (m003) and the PDF says skin (m001). The real pack uses m003.
   We follow the filename either way.
5. Is a single 144x144 face PNG accepted by RPG Maker, or does it need a 576x288 sheet?

## VX Ace generator (supported, see src/vxace.js)
From the tester's VX Ace `Generator` folder (515 files, kept locally in `test-assets/vxace/`).
It is a different system: **colours are pre-painted, not recoloured.**
```
Generator/
  Face/<Part>NN.png               shared by both genders (Acc1_, Acc2_, Ears, Eyebrows, Glasses, Kemono, Tattoo)
  Face/{Male,Female}/<Part>NN.png Beard, Eyes, Face, FrontHair, Mouth, Neck, Nose, RearHair
  Mini/<Part>NN.png               walk sprites, shared (Acc, Cloak, Ears, Glasses, Kemono, Tail, Wing, Head, Eyes)
  Mini/{Male,Female}/<Part>NN.png Beard, Cloth, FrontHair, RearHair
```
- Face parts are 512x256: a 4x2 grid of 128x128 cells, **one cell per colour choice** (8 colours).
  Skin (`Face`), `Ears`, `Mouth` and `Nose` are 512x128: 4 skin tones.
- Mini parts are 768x256 or 768x128: cells of 96x128, each a 3x4 walk sheet of 32x32 frames.
  `Head.png` holds 4 skin tones (read as Body p01), `Eyes.png` 8 eye colours (the walking eyes of every
  eye shape).
- Tall Mini files (Cloak, Tail, Wing, RearHair, Ears, Cloth) hold two layers: the top half is drawn
  behind the body, the bottom half in front. Cloth's bottom half is the skin of the hands (4 skin
  tones). Worked out from where the pixels sit (e.g. the cloak's back view is in the bottom half).
- Suffix `s` (`FrontHair01s`, `Eyes01s`): half-transparent (alpha ~110-150) shadow the part casts on
  the face, drawn just under the part.
- Suffix `a` (`RearHair01a`, `Neck01a`): a second layer. `RearHair..a` covers the top of the head
  (drawn over the face); `Neck..a` is the back of the collar (drawn behind everything).
- Names map to MV parts: Acc1_ = AccA, Acc2_ = AccB, Kemono = BeastEars, Tattoo = FacialMark,
  Neck (face) and Cloth (walk) = Clothing, Head = Body.
- Colours are "painted slots": skin tone, hair colour and eye colour are shared by every part that
  has them; the other parts have their own. A colour id `painted:N` picks cell N.
- No gradient files and no masks. No damage or battler sprites.
- UNVERIFIED: the exact draw order of the VX Ace generator (ours is in `VX_ORDER`), and whether VX
  Ace wants 96x96 faces (the parts are 128x128; we export 128x128).
