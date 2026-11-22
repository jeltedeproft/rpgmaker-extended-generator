# Next

## What the tester wants (from chat)
- Uses **MZ**. Makes sprites and portraits from generator parts.
- ✅ Mix male and female parts in one character.
- ✅ More control over placement (per-part offsets).
- ✅ "Imports official parts automatically" → remembered folders (Chrome/Edge).
- ✅ More control over colour use: own colours per item, and colour links when randomizing.
- [ ] Live colour linking while editing (eyebrows follow hair when you change the hair).

## Tester feedback, round 2 (2026-11-21)
- ✅ Body and Face can be set to None.
- ✅ "Other colours" list stays open while picking.
- ✅ Sprite offsets: disabled (with a note) for parts that only exist on the face, e.g. Eyes. That
  was probably why they "did nothing". Confirm with the tester.
- ✅ A folder with no recognisable parts now says so instead of "Added ...".
- [ ] Eyes come out as "two colours / alien" with official parts. Screenshot (`docs/imageEyes.png`,
      a sprite) shows green irises with a row of untouched blue (#1380f8) pixels: most likely the
      official sprite masks mark them with a colour missing from our slot table. The import report
      now lists such colours; ask the tester to copy the lines that mention a `_c.png`.
- ✅ Battler motion names capitalised.
- ✅ Parts without a Variation icon get a rendered thumbnail (face, else walk, else battler frame).
- [ ] VX Ace generator folders: different format. Need a file listing to support it.
- ✅ Odd-eyed bodies from "Basic Resources": open the DLC `generator` folder next to the normal
      one; bodies show up as `p01 (left_green)` etc. No file swapping.
- ✅ Eyes: MZ's walk-sprite body masks use a second blue for part of the eye; now matched.

## Tester feedback, round 3 (2026-11-22)
- ✅ Position per walk direction, per battler motion and per damage frame (or a single frame),
  on top of the sprite position.
- ✅ MZ `FG_RearHair2_p12_c1` (hair tie) drawn behind `_c2_m003` (the hair): unnamed face cells
  now go below the named ones (c1 above c2). Same fix for `FG_FrontHair_p17`'s headband.
- ✅ Pause, stand still (middle frame), all four walk directions, whole-sheet view.
- ✅ `FG_FrontHair_p17_c1].png` (a slightly different headband) is kept as "p17 (alt)".
- ✅ Face skin / hair "not changing colour in real time": the main preview did change (checked
  with the official MZ folder); the part tiles showed RPG Maker's fixed-colour icons. Tiles are
  now drawn in the current colours. Confirm with the tester that this is what they meant.

## Tester feedback, round 4 (2026-11-22)
- ✅ RPG Maker MZ generator presets (`CharacterGeneratorSettings` .json): Load character reads
  them, and .json presets inside an opened folder are listed under "Presets". Colours map to rows
  of grad_skin / grad_hair / grad_eyes / grad_common; offsets move face parts. Tested with the
  tester's three presets (kept in git-ignored `test-assets/presets/`).
- ✅ "Mask colour not tied to any colour slot" with the Another DLC generator: every such pixel
  had the picture's own colour (copied outlines and buckles), meant to stay as drawn. No longer
  reported.

- ✅ MV generator (ticket zip, same as `official-mv`): `TV_FurClothes01.png` was its own part
  "FurClothes" and its mask `TV_FurClothes01b.png` a variant "pb". Now Clothing "Fur01" with that
  mask. Part words anywhere in a name (clothes, outfit, cape, goggles, ...) map to the known part;
  a "b"/"mask" file next to its image is read as the mask. `TV_Clothing2_pXX.png.png` is a
  different image (grey-background preview) and stays "pXX (alt)".

- ✅ "?" tiles: parts with only a damage sprite now show their damage frame.
- ✅ Devil-horn helmet `TV_AccB_p07 (2)` got the jester hat's damage sprite: renamed copies
  "(2)" no longer borrow sheets from the plain number (only sets and "(alt)" do).
- ✅ Files dialog ("Files…" in the toolbar): To assign / Odd names / Assigned by you / All files,
  every file with its picture and current reading; "Assign one by one" (with Skip); Reassign and
  Unassign for any loaded file, remembered per pack.

## Blocked on RPG Maker's own generator (trial: rpgmakerweb.com/free-trials, or the tester's files)
- [ ] Settle the open questions in `docs/FORMAT.md` (brightness measure first).
- [ ] Compare one character pixel-for-pixel with RPG Maker's own generator.
- [ ] Ask the tester what exactly is "buggy" in the existing tool, and turn that into test cases.

## Features
- [ ] Insert into an existing 4x2 sheet (faces 576x288, characters 576x384) at slot N.
- ✅ Manually assign unrecognised files (part / layer / sheet) from the import report.
- ✅ Multiple items of the same part (e.g. two accessories).
- [ ] Busts (requested on the forum thread).
- [ ] Undo/redo.

## Launch
- [ ] Host as a static page (itch.io HTML5 or GitHub Pages). GitHub Pages is live for testing.
- [ ] Follow the itch launch rules: go public only on a day we post in the forum thread.

## Tester wish list (2026-11-21, mostly from the original Extended Generator's feature list)
All done (2026-11-22). Earlier: own naming (any pid, copies, set folders) · all gradients for any
item + custom ones · mixing Male/Female/Kid · pixel offsets.
- ✅ Manually assign unrecognised files ("Assign…" in the import report, remembered per pack).
      Names without a part number (`TV_ClothingEric.png`) and typos (`.png.png`, `]`) are read
      automatically.
- ✅ More categories/parts (Accessory C, body types beyond Male/Female/Kid): from file and folder
      names, or typed in the Assign dialog. New parts draw on top; the draw order box moves them.
- ✅ Templates for non-standard sizes (Settings → Sheet templates: frame size + grid per sheet).
      Sprite parts with other frame sizes are placed frame by frame, standing on the bottom.
- ✅ Editable draw order (default = MV/MZ order), per sheet, per character.
- ✅ Several items of the same part (two AccA), each with its own position and optional own colours.
- ✅ Rotate elements per tile/frame (face and sprites separately, each frame around its own centre).
- ✅ Character sets / partial characters (save a group of parts + colours, apply on top;
      export/import as a file).
- ✅ Randomize with rules (chance per part, other body types, any colour, colour links, parts
      that never go together, random saved sets).
- ✅ Credits: show which pack every used part came from, with a readme/credit text per pack.
Tester's own ideas:
- ✅ Split an image into islands separated by transparent gaps (e.g. left/right eye) as separate
      layers: move/tilt/recolour/reorder each (heterochromia, eye spacing). All 29 MZ female eyes
      split into exactly 2 pieces.
- ✅ Regional transparency: clip one layer by another (hair only visible inside a hood opening):
      "inside the outline of", "only where it overlaps", "except where it overlaps".
