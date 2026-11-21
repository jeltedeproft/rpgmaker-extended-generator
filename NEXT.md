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
- [ ] Eyes come out as "two colours / alien" with official parts. Can't reproduce with the
      SomeNewWork pack (eyes look right). Need: screenshot, which eye part + colour, and ideally the
      official `FG_Eyes_*` files and `grad_eyes.png`. Likely the brightness measure (FORMAT.md Q1).
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
