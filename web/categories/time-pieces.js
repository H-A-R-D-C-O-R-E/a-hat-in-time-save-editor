/**
 * Time Pieces category.
 *
 * Save representation
 *   TimeObjects[]                    { Id, Collected, Paid, Highscore|HighScore,
 *                                      IsAct, [IsMod, ModPackage] }
 *   CurrentCollectedTimePieces       count of collected non-mod pieces (optional)
 *   CurrentCollectedTimePieces_Mods  count of collected mod pieces     (optional)
 *
 * What this category touches
 *   - TimeObjects[].Collected                       (always)
 *   - appends a TimeObjects[] entry                 (when collecting an id the
 *                                                     save does not know yet)
 *   - creates the TimeObjects list itself           (only on that append —
 *                                                     rows() never writes)
 *   - the two counters above, *only if they exist*  (recomputed, never created)
 *
 * Deliberately left alone: SpeedrunTimeObjects (best-times table),
 * UnlockedSecretLevels (secret level unlocks, editable in **More**),
 * ActBits and LevelSaveInfo (Death Wishes writes the Subcon element, More the
 * ActBits flags), and everything outside TimeObjects.
 */
import { ORDER, CHAPTERS, TEMPLATES } from '../data/time-pieces.js';

const top = (doc, name) => doc.properties.find((p) => p.name === name);
const prop = (el, name) => el.properties.find((q) => q.name === name);
const boolOf = (el, name) => {
  const p = prop(el, name);
  return p ? !!p.value : false;
};
const idOf = (el) => prop(el, 'Id')?.value;

/**
 * Display titles for the game's own `ChapterName` values. The raw key stays on
 * the group header as a tooltip.
 *
 * NOTE: `Chapter2_Subcon` and `Chapter3_Trainwreck` are *not* the real chapter
 * numbers — in game Subcon is chapter 3 and Battle of the Birds is chapter 2.
 * The keys are used as-is (they come straight out of the save); only the labels
 * and the ordering below follow the real game.
 */
const CHAPTER_TITLES = {
  Chapter1_MafiaTown: 'Mafia Town (Chapter 1)',
  Chapter3_Trainwreck: 'Battle of the Birds (Chapter 2)',
  Chapter2_Subcon: 'The Subcon Forest (Chapter 3)',
  Chapter4_Sand: 'Alpine Skyline (Chapter 4)',
  Chapter5_Finale: 'The Finale (Chapter 5)',
  Chapter6_Cruise: 'The Arctic Cruise (Chapter 6)',
  Chapter7_Metro: 'Nyakuza Metro (Chapter 7)',
  Location_Spaceship: 'Spaceship',
};
const CHAPTER_ORDER = [
  'Chapter1_MafiaTown',
  'Chapter3_Trainwreck',   // Battle of the Birds — real chapter 2
  'Chapter2_Subcon',       // The Subcon Forest — real chapter 3
  'Chapter4_Sand',
  'Chapter5_Finale',
  'Chapter6_Cruise',
  'Chapter7_Metro',
  'Location_Spaceship',
];

/**
 * Ids whose chapter the save gets wrong. The save stamps `TimeRift_Cave_Tour`
 * with `Chapter5_Finale`; it belongs with the Spaceship rifts.
 */
const GROUP_OVERRIDES = {
  'TimeRift_Cave_Tour': 'Location_Spaceship',
};

const OTHER = '__other__';

const humanize = (key) => key.replace(/_/g, ' ').replace(/^Chapter/, 'Chapter ');

function groupTitle(key) {
  if (key === OTHER) return 'Other / unknown chapter';
  return CHAPTER_TITLES[key] ?? humanize(key);
}

function groupRank(key) {
  const i = CHAPTER_ORDER.indexOf(key);
  return i === -1 ? CHAPTER_ORDER.length : i;
}

/** Which field names this particular save uses on a TimeObjects element. */
function schemaOf(elements) {
  const names = new Set();
  for (const el of elements) for (const p of el.properties) names.add(p.name);
  if (names.size === 0) return { high: 'HighScore', mod: true };  // fresh save: assume current build
  return { high: names.has('Highscore') ? 'Highscore' : 'HighScore', mod: names.has('IsMod') };
}

/** id -> ChapterName, read from this save's own speedrun table (falls back to the baked data). */
function chaptersOf(doc) {
  const map = new Map();
  const speedrun = top(doc, 'SpeedrunTimeObjects');
  if (Array.isArray(speedrun?.value)) {
    for (const el of speedrun.value) {
      const id = prop(el, 'Id')?.value;
      const chapter = prop(el, 'ChapterName')?.value;
      if (id && chapter) map.set(id, chapter);
    }
  }
  return map;
}

function elementFor(doc, id) {
  const arr = top(doc, 'TimeObjects');
  if (!Array.isArray(arr?.value)) return null;
  return arr.value.find((el) => idOf(el) === id) ?? null;
}

/** The list as it stands — reading a save is never an edit, so this never creates it. */
function timeObjects(doc) {
  const arr = top(doc, 'TimeObjects');
  return Array.isArray(arr?.value) ? arr : null;
}

/** Only ever called from a path that is about to write. */
function ensureTimeObjects(doc) {
  let arr = timeObjects(doc);
  if (!arr) {
    arr = { name: 'TimeObjects', type: 'ArrayProperty', arrayIndex: 0, elementType: 'struct', value: [] };
    doc.properties.unshift(arr);
  }
  if (!Array.isArray(arr.value)) arr.value = [];
  return arr;
}

function rebuildCounters(doc) {
  const elements = timeObjects(doc)?.value ?? [];
  const isMod = (el) => boolOf(el, 'IsMod');
  const collected = (el) => boolOf(el, 'Collected');
  const vanilla = elements.filter((el) => collected(el) && !isMod(el)).length;
  const mods = elements.filter((el) => collected(el) && isMod(el)).length;

  const main = top(doc, 'CurrentCollectedTimePieces');
  if (main && Number.isInteger(main.value)) main.value = vanilla;
  const mod = top(doc, 'CurrentCollectedTimePieces_Mods');
  if (mod && Number.isInteger(mod.value)) mod.value = mods;
}

function buildElement(id, collected) {
  const t = TEMPLATES[id] ?? {
    IsAct: !/^(TimeRift|Spaceship)_/.test(id),
    Paid: false,
    HighScore: 0,
    IsMod: id.startsWith('Mod:'),
    ModPackage: '',
  };
  const bool = (value) => ({ type: 'BoolProperty', arrayIndex: 0, value });
  const int = (value) => ({ type: 'IntProperty', arrayIndex: 0, value });
  const str = (value) => ({ type: 'StrProperty', arrayIndex: 0, value });

  const properties = [
    { name: 'Id', ...str(id) },
    { name: 'Collected', ...bool(collected) },
    { name: 'Paid', ...bool(t.Paid) },
    { name: 'HighScore', ...int(t.HighScore) },
    { name: 'IsAct', ...bool(t.IsAct) },
    { name: 'IsMod', ...bool(t.IsMod) },
    { name: 'ModPackage', ...str(t.ModPackage) },
  ];
  return { properties };
}

/** Rename/trim a freshly built element so its fields match the target save. */
function adaptElement(element, schema, id) {
  const wanted = ['Id', 'Collected', 'Paid', schema.high, 'IsAct'];
  if (schema.mod) wanted.push('IsMod', 'ModPackage');

  const out = [];
  for (const name of wanted) {
    const source = name === schema.high
      ? element.properties.find((p) => p.name === 'Highscore' || p.name === 'HighScore')
      : element.properties.find((p) => p.name === name);
    const p = source
      ? { ...source }
      : { name, arrayIndex: 0, value: name === 'IsMod' ? id.startsWith('Mod:') : name === 'ModPackage' ? '' : name === 'IsAct' ? !/^(TimeRift|Spaceship)_/.test(id) : name === 'Paid' ? false : 0 };
    p.name = name;
    out.push(p);
  }
  return { properties: out };
}

export default {
  id: 'time-pieces',
  title: 'Time Pieces',

  rows(doc) {
    // Read only. Creating the list here would mean that merely *looking* at a
    // brand-new save (which has no TimeObjects at all) edited it, and the next
    // download would hand back a file that differs from the one loaded.
    const elements = timeObjects(doc)?.value ?? [];
    const byId = new Map();
    for (const el of elements) {
      const id = idOf(el);
      if (id !== undefined && !byId.has(id)) byId.set(id, el);
    }
    const chapters = chaptersOf(doc);

    const ids = [...new Set([...ORDER, ...byId.keys()])];
    return ids.map((id) => {
      const el = byId.get(id) ?? null;
      const chapter = GROUP_OVERRIDES[id] ?? chapters.get(id) ?? CHAPTERS[id] ?? OTHER;
      return {
        id,
        label: id,
        group: chapter,
        checked: el ? boolOf(el, 'Collected') : false,
        present: el !== null,
        mod: id.startsWith('Mod:'),
      };
    });
  },

  groupTitle,

  compareGroups(a, b) {
    const ra = groupRank(a);
    const rb = groupRank(b);
    if (ra !== rb) return ra - rb;
    return a < b ? -1 : a > b ? 1 : 0;
  },

  /**
   * @param {object} doc     decoded save (mutated in place)
   * @param {string} id      time piece id
   * @param {boolean} checked desired collected state
   * @returns {boolean} whether the document changed
   */
  set(doc, id, checked) {
    const list = timeObjects(doc);
    const existing = list ? list.value.find((el) => idOf(el) === id) : null;

    if (existing) {
      const flag = prop(existing, 'Collected');
      if (!flag) return false;
      if (flag.value === checked) return false;
      flag.value = checked;
      rebuildCounters(doc);
      return true;
    }

    if (!checked) return false;  // not in the save and not wanted -> nothing to do

    // Reaching here means we are about to append, so the list may be created.
    const arr = ensureTimeObjects(doc);
    const schema = schemaOf(arr.value);
    arr.value.push(adaptElement(buildElement(id, checked), schema, id));
    rebuildCounters(doc);
    return true;
  },

  /** What a toggle in this category writes to the file. */
  notes: [
    'Checking a box sets TimeObjects[<id>].Collected = true; unchecking sets it to false.',
    'If a checked time piece is not in this save yet, a TimeObjects entry is appended, built from a template harvested from a real save (Id, Collected, Paid, HighScore, IsAct, and IsMod/ModPackage when this save uses them).',
    'CurrentCollectedTimePieces and CurrentCollectedTimePieces_Mods are recomputed — but only if that save already has them; they are never created.',
    'Left untouched on purpose: SpeedrunTimeObjects (best-times table), UnlockedSecretLevels and ActBits (both editable in More), LevelSaveInfo (Death Wishes), and everything outside TimeObjects.',
  ],
};
