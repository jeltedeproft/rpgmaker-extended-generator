# Extended Character Generator (RPG Maker MV/MZ)

A browser-based character generator for RPG Maker MV/MZ generator parts. It aims to be what the
existing extended generator is, minus the bugs:

- **No install, any OS:** a static web page; files never leave your machine.
- **Drop in any folder:** RPG Maker's `Generator` folder, asset packs, or both. Each folder is its
  own pack, so same-numbered parts **never overwrite each other**.
- **Forgiving import:** files that don't match the naming convention are listed in an import
  report instead of breaking the load, with an **Assign…** button to add them by hand (as any
  part, including new ones like `AccC`, and any body type). Any variation id works (`p01`,
  `p5001`, `pMV01`), and names without one (`TV_ClothingEric.png`) are read too.
- **Mix body types:** a Male character can wear Female (or Kid) parts.
- **Placement control:** per-part pixel offsets and rotation for the face and for sprites. On sprite sheets each
  animation frame is shifted separately, so nothing bleeds into the next frame.
- **Remembers your folders** (Chrome/Edge): pick RPG Maker's `generator` folder once, then reopen
  it with one click next time.
- **Unlimited colours:** every gradient sheet found is loaded, any gradient fits any slot, and you
  can make your own (exportable as a gradient sheet), duplicate or delete any. Hue, saturation and
  brightness shift any colour, including the colours a part is drawn in.
- **Recolour parts drawn without a colour mask:** the generator can make the mask, splitting the
  drawing into 1 to 4 colour groups and giving each group the colour slot you pick.
- **Any sheet size:** sheet templates set the frame size and grid per sheet (e.g. 64px walk
  frames); parts made for other frame sizes are fitted in frame by frame.
- **Live preview** of face, animated walk (4 directions), animated battler (18 motions), damage.
- **Export** face / walk (`$Name.png`) / damage / battler PNGs; **save/load** characters as JSON
  (still loads if a pack folder was renamed).
- **Several items of one part** (two accessories, two hairs), each with its own position and,
  if you want, its own colours.
- **Split a part into pieces** where transparent gaps separate it (left and right eye, two
  earrings): move, turn, recolour and reorder each piece on its own.
- **Regional transparency:** show a part only inside another part's outline (hair in a hood's
  opening), only where they overlap, or except where they overlap.
- **Credits:** lists every pack the character uses (parts and colours), shows readme/credit
  files found in the pack folder, lets you add an author line, and exports a `_credits.txt`.
- **Layers** beside the parts: every layer of an image with its picture; drag to change the draw
  order (starts as RPG Maker's order), tick layers to move those parts together.
- **Cut finished sheets** into characters, rows, columns or single frames, and assign a piece as
  a part: a dressed character as a body, to put a cloak over it.
- **Character sets:** save some parts with their colours and positions ("Knight armour") and put
  them on any character; export/import sets to share them.
- **Randomize** with per-part locks and rules: how often each part is worn, colour links (hair
  and eyebrows match), parts that never go together, other body types, random saved sets.

## Develop
No dependencies. Needs Node 20+.
```
npm run serve        # http://localhost:5173  (add ?sample to auto-load the sample kit)
npm test             # unit tests (+ real-pack tests when test-assets/ has packs)
node tools/smoke.mjs # headless-Chrome UI smoke test (needs the server running)
npm run sample-kit   # regenerate the placeholder kit in sample-kit/
```
**Real packs for testing** go in `test-assets/<name>/` (git-ignored: they're not ours to
redistribute). `node tools/make-manifest.mjs test-assets/<name>` lets the dev server load one with
`?sample&pack=test-assets/<name>`, and `PACK=test-assets/<name> node tools/smoke.mjs` includes it in
the smoke test.
`sample-kit/` is generated placeholder art in the generator's file format, so we can develop
without shipping RPG Maker's licensed assets.

## Layout
- `src/format.js`: everything about the RPG Maker format (slots, draw order, sizes). See `docs/FORMAT.md`.
- `src/parse.js`: filenames → part library. `src/recolor.js`, `src/compose.js`: pixel work.
- `src/character.js`: character model, randomize, save/load. `src/gradients.js`: gradient sheets.
- `src/loader.js`, `src/app.js`: browser-only (file reading, decoding, UI).
