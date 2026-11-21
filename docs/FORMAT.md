# RPG Maker MV/MZ generator format: what we know

Sources: Naoso's guide on the RPG Maker forums (MZ), the RPG Maker MV character generator tutorial PDF,
and the Extended Generator tutorials page. **No real RPG Maker assets have been tested yet.** Every
assumption lives in `src/format.js`, so corrections go there.

## Folder layout
```
Generator/
  Face/{Male,Female,Kid}/   FG_<Layer>_p<NN>_c<cell>[_m<NNN>].png   144x144 (some MZ parts 160x160)
  TV/{...}/                 TV_<Layer>_p<NN>.png + TV_<Layer>_p<NN>_c.png   144x192 (3x4 frames of 48)
  TVD/{...}/                TVD_<Layer>_p<NN>[_c].png   144x48 (3x1 frames of 48)
  SV/{...}/                 SV_<Layer>_p<NN>[_c].png    576x384 (9x6 frames of 64)
  Variation/{...}/          icon_<Part>_p<NN>.png       64x64 thumbnails
  gradients.png             MV: one sheet, 256 wide, 4px per gradient
  grad_{skin,hair,eyes,common}.png   MZ: one sheet per category
```
`<Layer>` = part name + optional layer number (`FrontHair1`, `FrontHair2`, `Clothing2`, ...).

## Colouring
- **TV/TVD/SV:** the `_c` mask marks recolourable pixels with a fixed RGB per slot (skin `#F9C19D`,
  hair `#FCCB0A`, ...). White means "leave as is". The base pixel's brightness picks a colour from
  the slot's 256px gradient.
- **FG:** no masks. `_mNNN` assigns the whole layer to a slot (m001 skin, m003 hair, ...).

## Open questions (check with real assets)
1. **Gradient direction:** does brightness 0 read column 0 or column 255? The default is column 0,
   and there's a toggle under Settings. Check it once against an RTP part with a known gradient.
2. **Draw order direction:** the PDF lists are assumed to be top-most first (Wing2/Cloak2/RearHair2
   at the end = behind the body).
3. **Eyebrows:** the forum says hair colour (m003), the PDF says skin (m001). We follow the filename's m-number.
4. **Clothing/Cloak sub-colour labels:** garbled in the PDF; only the labels could be wrong, not the colours.
5. **`_c` masks:** indexed without alpha, or RGBA? Both decode fine, but check antialiased edges
   (the matcher tolerates ±6 per channel).
6. **MZ 160px faces:** currently centred onto the body layer's canvas. Check that it lines up.
7. Is a single 144x144 face PNG accepted by RPG Maker, or does it need a 576x288 sheet?
