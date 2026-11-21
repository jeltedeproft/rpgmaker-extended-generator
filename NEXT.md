# Next

## What the tester wants (from chat)
- Uses **MZ**. Makes sprites and portraits from generator parts.
- ✅ Mix male and female parts in one character.
- ✅ More control over placement (per-part offsets).
- ✅ "Imports official parts automatically" → remembered folders (Chrome/Edge).
- [ ] More control over colour use: e.g. a different gradient per item of the same slot, colour
      linking (eyebrows follow hair).

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
- [ ] Odd-eyed bodies from "Basic Resources": need the folder layout/filenames. If they reuse the
      official names, opening them as a second folder may already work (packs never overwrite).

## Blocked on RPG Maker's own generator (trial: rpgmakerweb.com/free-trials, or the tester's files)
- [ ] Settle the open questions in `docs/FORMAT.md` (brightness measure first).
- [ ] Compare one character pixel-for-pixel with RPG Maker's own generator.
- [ ] Ask the tester what exactly is "buggy" in the existing tool, and turn that into test cases.

## Features
- [ ] Insert into an existing 4x2 sheet (faces 576x288, characters 576x384) at slot N.
- [ ] Manually assign unrecognised files (part / layer / sheet) from the import report.
- [ ] Multiple items of the same part (e.g. two accessories).
- [ ] Busts (requested on the forum thread).
- [ ] Undo/redo.

## Launch
- [ ] Host as a static page (itch.io HTML5 or GitHub Pages). GitHub Pages is live for testing.
- [ ] Follow the itch launch rules: go public only on a day we post in the forum thread.
