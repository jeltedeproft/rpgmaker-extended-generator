# Extended Character Generator (RPG Maker MV/MZ)

A browser-based character generator for RPG Maker MV/MZ generator parts. It aims to be what the
existing extended generator is, minus the bugs:

- **No install, any OS:** a static web page; files never leave your machine.
- **Drop in any folder:** RPG Maker's `Generator` folder, asset packs, or both. Each folder is its
  own pack, so same-numbered parts **never overwrite each other**.
- **Forgiving import:** files that don't match the naming convention are listed in an import
  report instead of breaking the load. Any variation id works (`p01`, `p5001`, `pMV01`).
- **Mix body types:** a Male character can wear Female (or Kid) parts.
- **Placement control:** per-part pixel offsets for the face and for sprites. On sprite sheets each
  animation frame is shifted separately, so nothing bleeds into the next frame.
- **Remembers your folders** (Chrome/Edge): pick RPG Maker's `generator` folder once, then reopen
  it with one click next time.
- **Unlimited colours:** every gradient sheet found is loaded, any gradient fits any slot, and you
  can make your own (exportable as a gradient sheet).
- **Live preview** of face, animated walk (4 directions), animated battler (18 motions), damage.
- **Export** face / walk (`$Name.png`) / damage / battler PNGs; **save/load** characters as JSON
  (still loads if a pack folder was renamed).
- **Several items of one part** (two accessories, two hairs), each with its own position and,
  if you want, its own colours.
- **Editable draw order** per sheet (starts as RPG Maker's order).
- **Randomize** with per-part locks.

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
