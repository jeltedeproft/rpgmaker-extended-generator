// Shareable setups: how someone set the generator up for their own parts (how their files are
// read, the colour masks made and painted for them, how sheets were cut, sheet sizes, sets,
// colours, randomize rules and characters), in one file others can import, or that a folder of
// parts can ship next to its pictures. Shared as a zip, it also holds the pictures (app.js).

export const SETUP_FORMAT = 'rpgmaker-xgen-setup';

/** Option settings a setup carries as they are. */
const OPTIONS = ['sheetOptions', 'extraSheets', 'fitFrame', 'flipGradient', 'syncColours', 'splitEverything', 'recolourAll', 'makeRoom', 'smoothPixels', 'partStyle', 'noShift'];

/** Settings keyed "<folder>|<file path>": stored per file path, so they fit any folder name. */
const BY_FILE = ['assignments', 'organizedFiles', 'cuts'];
/** Settings keyed "<folder>/<part id>": stored per part id without the folder (painted masks: "<part id>|sheet|layer"). */
const BY_PART = ['autoMasks', 'removedParts', 'maskEdits'];

/** Keys of one folder with the folder taken off ("Pack|a/b.png" -> "a/b.png"). */
function ownKeys(map, pack, sep) {
  const prefix = `${pack}${sep}`;
  return Object.fromEntries(Object.entries(map || {}).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]));
}

/**
 * The setup for the given folders: what is set for their files and parts, plus the general
 * settings. `customGradients` are the user's own colours (JSON form, see customGradientToJson);
 * `characters` premade characters to share ({name, text}: a saved character file).
 */
export function makeSetup(settings, packs, customGradients = [], { name = 'My setup', author = '', note = '', characters = [] } = {}) {
  const setup = { format: SETUP_FORMAT, version: 1, name, author, note };
  for (const key of BY_FILE) setup[key] = Object.assign({}, ...packs.map((p) => ownKeys(settings[key], p, '|')));
  for (const key of BY_PART) setup[key] = Object.assign({}, ...packs.map((p) => ownKeys(settings[key], p, '/')));
  setup.credits = packs.map((p) => settings.packCredits?.[p]).filter(Boolean).join('\n\n');
  setup.createdBodies = settings.createdBodies || [];
  setup.templates = settings.templates || {};
  setup.randomRules = settings.randomRules || null;
  setup.sets = settings.sets || [];
  setup.options = Object.fromEntries(OPTIONS.filter((k) => settings[k] !== undefined).map((k) => [k, settings[k]]));
  setup.customGradients = customGradients;
  setup.characters = characters.map(({ name: n, text }) => ({ name: n, text }));
  return setup;
}

/** True for a setup file's parsed JSON. */
export function isSetup(data) {
  return data?.format === SETUP_FORMAT;
}

/**
 * Settings with a setup applied to the given folders (a new object; the input is not changed).
 * Per-file and per-part entries go to every folder; sets are added (same name: replaced),
 * sheet sizes, rules and options taken over. Returns the colours and characters to add too.
 * @returns {{settings:object, customGradients:object[], characters:Array<{name:string, text:string}>, counts:{files:number, parts:number, sets:number}}}
 */
export function applySetup(settings, setup, packs) {
  if (!isSetup(setup)) throw new Error('not a setup file');
  const next = structuredClone(settings);
  let files = 0;
  let parts = 0;
  for (const pack of packs) {
    for (const key of BY_FILE) {
      for (const [path, v] of Object.entries(setup[key] || {})) {
        (next[key] ||= {})[`${pack}|${path}`] = v;
        if (key === 'assignments') files++;
      }
    }
    for (const key of BY_PART) {
      for (const [id, v] of Object.entries(setup[key] || {})) {
        (next[key] ||= {})[`${pack}/${id}`] = v;
        if (key === 'autoMasks') parts++;
      }
    }
    if (setup.credits && !next.packCredits?.[pack]) (next.packCredits ||= {})[pack] = setup.credits;
  }
  next.createdBodies = [...new Set([...(next.createdBodies || []), ...(setup.createdBodies || [])])];
  if (setup.templates && Object.keys(setup.templates).length) next.templates = { ...(next.templates || {}), ...setup.templates };
  if (setup.randomRules) next.randomRules = setup.randomRules;
  const names = new Set((setup.sets || []).map((s) => s.name));
  next.sets = [...(next.sets || []).filter((s) => !names.has(s.name)), ...(setup.sets || [])];
  // Copies: changing a sheet later doesn't change the setup it came from.
  for (const [k, v] of Object.entries(setup.options || {})) if (OPTIONS.includes(k)) next[k] = structuredClone(v);
  const characters = (setup.characters || []).filter((c) => c && typeof c.text === 'string').map((c) => ({ name: String(c.name || 'Character'), text: c.text }));
  return { settings: next, customGradients: setup.customGradients || [], characters, counts: { files, parts, sets: names.size } };
}
