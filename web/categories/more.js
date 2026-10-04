/**
 * More — everything a save tracks that no other category owns.
 *
 * Every other category is one item per row; this one is the leftovers at the
 * top level of the file: the scalar fields (pons, play times, badge points,
 * where the save says you are) and the small lists that sit beside them.
 *
 *   MyEnergyBits / MyBadgePoints / MyLifeTimeBadgePoints / MyBadgeSlots
 *   TotalPlayTime / ActPlayTime / LastPlayTime / CreationTimeStamp / NumReloads
 *   CurrentChapter / CurrentAct / CurrentCheckpoint / AllowSaving
 *   UnlockedSecretLevels[]        strings — secret levels you have unlocked
 *   ChallengeRoadIDs[]            strings — challenge roads this file has banked
 *   CompletedSnatcherContracts[]  strings — vanilla Snatcher contracts, done
 *   TurnedInSnatcherContracts[]   strings — …and handed back in
 *   SnatcherContracts[]           strings — …still on offer (older saves only)
 *   ActBits[]                     { Id, Bits, IdName } — one number per flag
 *
 * Row labels are the raw property names and the raw ids, as everywhere else.
 * A row's box is ticked when its value is non-zero (or, for a contract, when
 * any of its three boxes is on); `present` marks the fields the save actually
 * has, so "Not in this save" means the property or entry is missing here — not
 * that it is zero.
 *
 * Creating and un-creating
 *   `rows()` only ever reads. A field the save does not have yet is created by
 *   the edit that needs it, spliced in after the property the game keeps next
 *   to it (see PLACEMENT), and remembered as ours: setting it back to its zero
 *   value — or unticking the last box — takes it out again, so an edit that is
 *   undone restores the file byte for byte. Scaffolding the game wrote is never
 *   dropped, and asking for zero on something absent grows nothing.
 *
 * Deliberately never offered
 *   SketchingData (the sketch pad's pixels), HUBDecorations (its elements carry
 *   no id to label them by), SpeedrunTimeObjects (the best-times table),
 *   CurrentCollectedTimePieces and CurrentCollectedTimePieces_Mods (recomputed
 *   by Time Pieces, never created here), LevelSaveInfo (Death Wishes),
 *   Loadouts / PlayerCharacterType (the character switch), and every backpack
 *   list (its own categories).
 */
import {
  SECRET_LEVELS,
  ACT_FLAGS,
  CONTRACT_ORDER,
  CONTRACT_OBJECTS,
  CHALLENGE_ROADS,
} from '../data/more.js';

if (!Array.isArray(SECRET_LEVELS) || SECRET_LEVELS.length === 0) {
  // No catalog — this happens when web/data/more.js was built without any
  // sample saves on disk (the builder harvests secret levels from *.hat).
  // Rows still work: each save's own UnlockedSecretLevels become rows, so
  // editing what the save carries is unaffected — only offering locked
  // vanilla rifts to a save that lacks them needs the catalog. Re-run
  // `npm run build` with a save next to it to populate the catalog.
  console.warn('web/data/more.js has no secret levels — run `npm run build` with a .hat nearby');
}
if (!Array.isArray(CONTRACT_ORDER) || CONTRACT_ORDER.length === 0) {
  throw new Error('web/data/more.js has no contracts — run `npm run build`');
}
if (!Array.isArray(CHALLENGE_ROADS) || CHALLENGE_ROADS.length === 0) {
  throw new Error('web/data/more.js has no challenge roads — run `npm run build`');
}

const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;
const FLOAT32_MAX = 3.4028234663852886e38;

const SECRETS = 'UnlockedSecretLevels';
const ROADS = 'ChallengeRoadIDs';
const ACTBITS = 'ActBits';
/** Every contract id starts with this — it is how a row finds its three lists. */
const CONTRACT_PREFIX = 'Hat_SnatcherContract_';

/** The three checkboxes a contract row carries, and the list each one writes. */
const CONTRACT_LISTS = [
  { key: 'completed', label: 'Completed', text: 'done', name: 'CompletedSnatcherContracts' },
  { key: 'turnedIn', label: 'Turned in', text: 'turned in', name: 'TurnedInSnatcherContracts' },
  { key: 'available', label: 'Offered', text: 'offered', name: 'SnatcherContracts' },
];

/**
 * The scalar fields, in the order every save on disk keeps them, grouped for
 * display. Two entries are `anchor`s: Time Pieces owns them, so they are not
 * rows here — they appear only in PLACEMENT, so that a field this editor has
 * to create lands where the game would have put it.
 */
const FIELDS = [
  { name: 'LastPlayTime', group: 'time', type: 'IntProperty', min: INT32_MIN, max: INT32_MAX },
  { name: 'TotalPlayTime', group: 'time', type: 'FloatProperty', min: 0, max: FLOAT32_MAX, step: 'any' },
  { name: 'ActPlayTime', group: 'time', type: 'FloatProperty', min: 0, max: FLOAT32_MAX, step: 'any' },
  { name: 'NumReloads', group: 'time', type: 'IntProperty', min: 0, max: INT32_MAX },
  { name: 'MyBadgePoints', group: 'stats', type: 'IntProperty', min: 0, max: INT32_MAX },
  { name: 'MyLifeTimeBadgePoints', group: 'stats', type: 'IntProperty', min: 0, max: INT32_MAX },
  { name: 'MyEnergyBits', group: 'stats', type: 'IntProperty', min: 0, max: INT32_MAX },
  { name: 'CurrentCollectedTimePieces', anchor: true, type: 'IntProperty' },
  { name: 'CurrentCollectedTimePieces_Mods', anchor: true, type: 'IntProperty' },
  { name: 'MyBadgeSlots', group: 'stats', type: 'IntProperty', min: 0, max: INT32_MAX },
  { name: 'CurrentChapter', group: 'state', type: 'IntProperty', min: 0, max: INT32_MAX },
  { name: 'CurrentAct', group: 'state', type: 'IntProperty', min: 0, max: INT32_MAX },
  { name: 'CurrentCheckpoint', group: 'state', type: 'IntProperty', min: 0, max: INT32_MAX },
  { name: 'CreationTimeStamp', group: 'time', type: 'IntProperty', min: 0, max: INT32_MAX },
  { name: 'AllowSaving', group: 'state', type: 'BoolProperty' },
];
const EDITABLE = FIELDS.filter((f) => !f.anchor);
const fieldDef = (id) => EDITABLE.find((f) => f.name === id) ?? null;

/**
 * Where the game keeps each top-level property this category can create, top
 * to bottom. A missing field or list is spliced in beside its neighbours so the
 * file still reads like one the game wrote. Names this category never touches
 * (TimeObjects, MyBackpack2017, …) are listed too — they are landmarks only.
 */
const PLACEMENT = [
  'LastPlayTime', 'TotalPlayTime', 'ActPlayTime', 'NumReloads',
  'TimeObjects', 'SpeedrunTimeObjects', SECRETS, 'HUBDecorations',
  'MyBadgePoints', 'MyLifeTimeBadgePoints', 'MyEnergyBits',
  'CurrentCollectedTimePieces', 'CurrentCollectedTimePieces_Mods', 'MyBadgeSlots',
  'CurrentChapter', 'CurrentAct', 'CurrentCheckpoint', ACTBITS,
  'SnatcherContracts', 'CompletedSnatcherContracts', 'TurnedInSnatcherContracts',
  'MyBackpack2017', 'MyBackpack', 'Loadouts', 'PlayerCharacterType',
  'ChallengeRoadIDs', 'SketchingData', 'CreationTimeStamp', 'AllowSaving', 'LevelSaveInfo',
];

const GROUP_TITLES = {
  stats: 'Stats',
  time: 'Play time',
  state: 'Save state',
  secrets: 'Secret levels',
  roads: 'Challenge roads',
  contracts: 'Snatcher contracts',
  actbits: 'ActBits',
};
const GROUP_ORDER = ['stats', 'time', 'state', 'secrets', 'roads', 'contracts', 'actbits'];

/**
 * Everything this editor had to invent — a scalar property, a string list, the
 * ActBits list or an entry inside it. Setting one back to its zero value (or
 * emptying it) removes it again; a field the game wrote is kept, even at zero.
 * Keyed by the object, so it leaves with the document it belongs to.
 */
const CREATED = new WeakSet();

const top = (doc, name) => doc.properties.find((p) => p.name === name);
const unqualify = (value) => (typeof value === 'string' ? value.split('.').pop() : null);

/**
 * A challenge road is a chain of level ids, and the save and Collectibles.txt
 * write the same chain in opposite orders — so a road's identity is its ids as
 * a set. The label is always the wording on hand: this save's own when it
 * carries the road, the catalog's otherwise.
 */
const roadKey = (id) => String(id).split('_').sort().join('_');
const ROAD_KEYS = new Set(CHALLENGE_ROADS.map(roadKey));

/** The string list `name` holds, when it exists and is one — never creates it. */
function listOf(doc, name) {
  const prop = top(doc, name);
  if (!prop || !Array.isArray(prop.value)) return null;
  if (prop.elementType !== 'string' && prop.elementType !== 'empty') return null;
  return prop.value;
}

/** The same list, built beside its neighbours if this save has none yet. */
function ensureList(doc, name) {
  const existing = top(doc, name);
  if (existing) {
    if (!Array.isArray(existing.value)) return null;   // opaque: no guessing
    if (existing.elementType !== 'string' && existing.elementType !== 'empty') return null;
    return existing;
  }
  const made = { name, type: 'ArrayProperty', arrayIndex: 0, elementType: 'string', value: [] };
  doc.properties.splice(insertIndex(doc, name), 0, made);
  CREATED.add(made);
  return made;
}

/** Drop a list we invented, once the edit that invented it has been undone. */
function pruneList(doc, prop) {
  if (prop.value.length > 0 || !CREATED.has(prop)) return;
  const at = doc.properties.indexOf(prop);
  if (at >= 0) doc.properties.splice(at, 1);
}

/**
 * Where a property called `name` belongs: after the nearest landmark above it
 * that this save has, before the nearest one below it, otherwise at the end.
 */
function insertIndex(doc, name) {
  const at = PLACEMENT.indexOf(name);
  let after = -1;
  let before = -1;
  for (let i = 0; i < PLACEMENT.length; i++) {
    const found = doc.properties.findIndex((p) => p.name === PLACEMENT[i]);
    if (found < 0) continue;
    if (i < at) after = found;
    else if (i > at && before < 0) before = found;
  }
  if (after >= 0) return after + 1;
  if (before >= 0) return before;
  return doc.properties.length;
}

/* ------------------------------------------------------------- scalars ----- */

/** TotalPlayTime is stored as seconds but edited as h / m / s / cs (1:23:04.62). */
const TIME_ROW = 'TotalPlayTime';
const TIME_KEYS = ['h', 'm', 's', 'cs'];

/** Seconds -> { h, m, s, cs }. cs is hundredths, 00–99. */
function splitPlayTime(total) {
  const t = Number(total) || 0;
  let h = Math.floor(t / 3600);
  let m = Math.floor((t - h * 3600) / 60);
  let s = Math.floor(t - h * 3600 - m * 60);
  let cs = Math.round((t - h * 3600 - m * 60 - s) * 100);
  if (cs >= 100) {
    cs -= 100;
    s += 1;
  }
  if (s >= 60) {
    s -= 60;
    m += 1;
  }
  if (m >= 60) {
    m -= 60;
    h += 1;
  }
  return { h, m, s, cs };
}

/** { h, m, s, cs } -> seconds, the format the file holds. */
function joinPlayTime({ h, m, s, cs }) {
  return h * 3600 + m * 60 + s + cs / 100;
}

/** One h/m/s/cs component is valid, before anything is written. */
function fitsTimeComponent(key, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (key === 'h') return Number.isInteger(value) && value >= 0;
  if (key === 'm' || key === 's') return Number.isInteger(value) && value >= 0 && value <= 59;
  if (key === 'cs') return Number.isInteger(value) && value >= 0 && value <= 99;
  return false;
}

/** What a field reads as when the save does not have it: its zero value. */
function readScalar(prop, def) {
  if (!prop) return def.type === 'BoolProperty' ? false : 0;
  if (def.type === 'BoolProperty') return !!prop.value;
  return typeof prop.value === 'number' ? prop.value : 0;
}

/** Validate against the type that would be written, before touching anything. */
function fitsType(def, value) {
  if (def.type === 'BoolProperty') return typeof value === 'boolean';
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (def.type === 'IntProperty') {
    return Number.isInteger(value) && value >= INT32_MIN && value <= INT32_MAX;
  }
  return Math.abs(value) <= FLOAT32_MAX;
}

/**
 * Write one scalar field, creating it when the save has none — and taking it
 * back out again when the value returns to zero and it was ours.
 *
 * @returns {boolean} whether the document changed
 */
function setScalar(doc, def, value) {
  if (def.type === 'BoolProperty') return false;   // a box, not a number
  if (!fitsType(def, value)) return false;

  const prop = top(doc, def.name);
  if (prop && prop.type !== def.type) return false;  // a type we cannot write

  // float32 is what the file holds, so compare and store the rounded value:
  // what is typed is what comes back out of the encoder.
  const next = def.type === 'FloatProperty' ? Math.fround(value) : value;

  if (prop) {
    const current = prop.value;
    if (current === next) return false;
    if (next === 0 && CREATED.has(prop)) {
      doc.properties.splice(doc.properties.indexOf(prop), 1);
      return true;
    }
    prop.value = next;
    return true;
  }

  if (next === 0) return false;   // "absent" and "zero" are the same thing
  const made = { name: def.name, type: def.type, arrayIndex: 0, value: next };
  doc.properties.splice(insertIndex(doc, def.name), 0, made);
  CREATED.add(made);
  return true;
}

/** AllowSaving is a plain checkbox row, so it goes through `set`, not setField. */
function setBool(doc, def, value) {
  if (!fitsType(def, value)) return false;
  const prop = top(doc, def.name);
  if (prop && prop.type !== def.type) return false;

  if (prop) {
    if (prop.value === value) return false;
    if (value === false && CREATED.has(prop)) {
      doc.properties.splice(doc.properties.indexOf(prop), 1);
      return true;
    }
    prop.value = value;
    return true;
  }

  if (value === false) return false;
  const made = { name: def.name, type: def.type, arrayIndex: 0, value: true };
  doc.properties.splice(insertIndex(doc, def.name), 0, made);
  CREATED.add(made);
  return true;
}

/* -------------------------------------------------------- string lists ------ */

/**
 * Add to or take out of one of the string lists. `stored` is what goes into the
 * file — a bare id for a secret level, a qualified path for a contract — and
 * `match` decides which entries count as this row's.
 */
function setEntry(doc, name, stored, match, wanted) {
  const current = listOf(doc, name);
  const there = !!current && current.some(match);
  if (there === !!wanted) return false;

  if (!wanted) {
    const prop = top(doc, name);
    prop.value = prop.value.filter((value) => !match(value));
    pruneList(doc, prop);
    return true;
  }

  const prop = ensureList(doc, name);
  if (!prop) return false;
  prop.value.push(stored);
  return true;
}

/**
 * The path to write for a contract this save has never seen: the one harvested
 * from a sample save if we have it, otherwise whatever package this save writes
 * its other contracts with, otherwise the game's own package.
 */
function contractPath(doc, id) {
  const known = CONTRACT_OBJECTS[id];
  if (known) return known;
  for (const { name } of CONTRACT_LISTS) {
    for (const value of listOf(doc, name) ?? []) {
      if (typeof value === 'string' && value.includes('.')) return `${value.split('.')[0]}.${id}`;
    }
  }
  return `hatintimegamecontent.${id}`;
}

function contractSet(doc, name) {
  return new Set((listOf(doc, name) ?? []).map(unqualify));
}

/* ------------------------------------------------------------- ActBits ------ */

function actElements(doc) {
  const prop = top(doc, ACTBITS);
  return Array.isArray(prop?.value) ? prop.value : [];
}

function actNames(doc) {
  return new Set(actElements(doc).map((el) => actIdOf(el).name).filter((x) => x));
}

/** An ActBits entry as { id (lower-cased, in Id), name (as IdName), bits }. */
function actIdOf(el) {
  if (!Array.isArray(el?.properties)) return {};
  return {
    id: el.properties.find((p) => p.name === 'Id')?.value,
    name: el.properties.find((p) => p.name === 'IdName')?.value,
    bits: el.properties.find((p) => p.name === 'Bits'),
  };
}

function findAct(doc, name) {
  const low = name.toLowerCase();
  for (const el of actElements(doc)) {
    const { id, name: idName } = actIdOf(el);
    if (idName === name || id === low) return el;
  }
  return null;
}

function ensureActList(doc) {
  const prop = top(doc, ACTBITS);
  if (prop) {
    if (!Array.isArray(prop.value)) return null;
    if (prop.elementType !== 'struct' && prop.elementType !== 'empty') return null;
    prop.elementType = 'struct';   // an 'empty' list grows its first entry here
    return prop;
  }
  const made = { name: ACTBITS, type: 'ArrayProperty', arrayIndex: 0, elementType: 'struct', value: [] };
  doc.properties.splice(insertIndex(doc, ACTBITS), 0, made);
  CREATED.add(made);
  return made;
}

/** Build an ActBits entry the way the game writes one: { Id, Bits, IdName }. */
function buildAct(name, value) {
  const entry = {
    properties: [
      { name: 'Id', type: 'StrProperty', arrayIndex: 0, value: name.toLowerCase() },
      { name: 'Bits', type: 'IntProperty', arrayIndex: 0, value },
      { name: 'IdName', type: 'NameProperty', arrayIndex: 0, value: name },
    ],
  };
  return entry;
}

function setActBits(doc, name, value) {
  if (!Number.isInteger(value) || value < INT32_MIN || value > INT32_MAX) return false;

  const entry = findAct(doc, name);
  if (entry) {
    const { bits } = actIdOf(entry);
    // no Bits field means the entry is not carrying a value at all — refuse
    // rather than invent the field (never seen in a real save)
    if (!bits) return false;
    if (bits.value === value) return false;
    if (value === 0 && CREATED.has(entry)) {
      const list = top(doc, ACTBITS);
      list.value.splice(list.value.indexOf(entry), 1);
      if (CREATED.has(list) && list.value.length === 0) {
        doc.properties.splice(doc.properties.indexOf(list), 1);
      }
      return true;
    }
    bits.value = value;
    return true;
  }

  if (value === 0) return false;   // nothing tracked and nothing wanted
  const list = ensureActList(doc);
  if (!list) return false;
  const made = buildAct(name, value);
  const template = list.value.find((el) => el.class !== undefined);
  if (template) made.class = template.class;
  list.value.push(made);
  CREATED.add(made);
  return true;
}

/* ------------------------------------------------------------ category ------ */

export default {
  id: 'more',
  title: 'More',

  rows(doc) {
    const rows = [];

    for (const def of EDITABLE) {
      const prop = top(doc, def.name);
      const value = readScalar(prop, def);
      const row = {
        id: def.name,
        label: def.name,
        group: def.group,
        checked: def.type === 'BoolProperty' ? value === true : value !== 0,
        present: prop !== undefined,
      };
      if (prop !== undefined && prop.type !== def.type) {
        row.note = `stored as ${prop.type}`;
      }
      if (def.type !== 'BoolProperty') {
        if (def.name === TIME_ROW) {
          const parts = splitPlayTime(value);
          row.fields = [
            { key: 'h', label: 'Hours', text: 'h', type: 'number', value: parts.h, min: 0, step: 1 },
            { key: 'm', label: 'Minutes', text: 'm', type: 'number', value: parts.m, min: 0, max: 59, step: 1 },
            { key: 's', label: 'Seconds', text: 's', type: 'number', value: parts.s, min: 0, max: 59, step: 1 },
            { key: 'cs', label: 'Hundredths', text: 'cs', type: 'number', value: parts.cs, min: 0, max: 99, step: 1 },
          ];
        } else {
          row.fields = [{
            key: 'value',
            label: 'value',
            type: 'number',
            value,
            min: def.min ?? 0,
            step: def.step ?? 1,
            ...(def.max === undefined ? {} : { max: def.max }),
          }];
        }
      }
      rows.push(row);
    }

    // Unlocked secret levels: the catalog, plus anything this save carries.
    // The catalog is vanilla only — a `Mod:` rift is listed here only when this
    // save itself has it, since it belongs to the content pack that made it.
    const unlocked = new Set(listOf(doc, SECRETS) ?? []);
    const secrets = [...new Set([...SECRET_LEVELS, ...unlocked])].sort();
    for (const id of secrets) {
      rows.push({
        id,
        label: id,
        group: 'secrets',
        checked: unlocked.has(id),
        mod: id.startsWith('Mod:'),
      });
    }

    // Challenge roads: the gauntlet of community levels a file has banked.
    // The catalog is Collectibles.txt's own list, in the order the roads were
    // published; a road the file does not list still becomes a row when this
    // save carries it, so nothing a save holds is ever invisible. Both sides
    // are keyed by roadKey, because they write the chain in opposite orders.
    const carried = listOf(doc, ROADS) ?? [];
    const roads = new Map(CHALLENGE_ROADS.map((id) => [roadKey(id), id]));
    for (const id of carried) roads.set(roadKey(id), id);   // the file's wording wins
    const inFile = new Set(carried.map(roadKey));
    for (const [key, id] of roads) {
      rows.push({
        id,
        label: id,
        group: 'roads',
        checked: inFile.has(key),
        note: ROAD_KEYS.has(key) ? null : 'not in Collectibles.txt',
      });
    }

    // Snatcher contracts: three boxes per contract, one per string list.
    const byList = new Map(CONTRACT_LISTS.map((l) => [l.name, contractSet(doc, l.name)]));
    const seenContracts = new Set();
    for (const set of byList.values()) for (const id of set) seenContracts.add(id);
    for (const id of [...new Set([...CONTRACT_ORDER, ...seenContracts])]) {
      const on = CONTRACT_LISTS.map((l) => byList.get(l.name).has(id));
      rows.push({
        id,
        label: id,
        group: 'contracts',
        checked: on.some(Boolean),
        note: CONTRACT_ORDER.includes(id) ? null : 'not in Collectibles.txt',
        fields: CONTRACT_LISTS.map((list, i) => ({
          key: list.key,
          label: list.label,
          text: list.text,
          type: 'checkbox',
          value: on[i],
        })),
      });
    }

    // ActBits: one number per flag the save tracks, plus the known ones.
    const byName = new Map();
    for (const el of actElements(doc)) {
      const { name, bits } = actIdOf(el);
      if (typeof name === 'string' && name) byName.set(name, { el, bits });
    }
    for (const id of [...new Set([...ACT_FLAGS, ...byName.keys()])].sort()) {
      const found = byName.get(id);
      const bits = typeof found?.bits?.value === 'number' ? found.bits.value : 0;
      rows.push({
        id,
        label: id,
        group: 'actbits',
        checked: bits !== 0,
        present: found !== undefined,
        fields: [{
          key: 'value',
          label: 'value',
          type: 'number',
          value: bits,
          min: 0,
          max: INT32_MAX,
          step: 1,
        }],
      });
    }

    return rows;
  },

  groupTitle(key) {
    return GROUP_TITLES[key] ?? key;
  },

  compareGroups(a, b) {
    const ra = GROUP_ORDER.indexOf(a);
    const rb = GROUP_ORDER.indexOf(b);
    if (ra !== rb) return (ra === -1 ? GROUP_ORDER.length : ra) - (rb === -1 ? GROUP_ORDER.length : rb);
    return a < b ? -1 : a > b ? 1 : 0;
  },

  /**
   * @param {object} doc     decoded save (mutated in place)
   * @param {string} id      row id — a property name, a contract, or an id
   * @param {boolean} checked
   * @returns {boolean} whether the document changed
   */
  set(doc, id, checked) {
    const def = fieldDef(id);
    if (def) {
      // A number has no "checked" state, so Select all / Select none skips it.
      if (def.type === 'BoolProperty') return setBool(doc, def, !!checked);
      return false;
    }
    if (id.startsWith(CONTRACT_PREFIX)) {
      const path = contractPath(doc, id);
      const match = (value) => unqualify(value) === id;
      let changed = false;
      for (const list of CONTRACT_LISTS) {
        if (setEntry(doc, list.name, path, match, !!checked)) changed = true;
      }
      return changed;
    }
    if (SECRET_LEVELS.includes(id) || (listOf(doc, SECRETS) ?? []).includes(id)) {
      return setEntry(doc, SECRETS, id, (value) => value === id, !!checked);
    }
    // a challenge road — the same road may be written the other way round here
    const road = roadKey(id);
    if (ROAD_KEYS.has(road)
      || (listOf(doc, ROADS) ?? []).some((value) => roadKey(value) === road)) {
      return setEntry(doc, ROADS, id, (value) => roadKey(value) === road, !!checked);
    }
    if (ACT_FLAGS.includes(id) || actNames(doc).has(id)) return false;  // a number
    return false;
  },

  /**
   * One field of a row: the number of a scalar or an ActBits flag, one
   * h / m / s / cs box of TotalPlayTime, or one of the three contract boxes.
   *
   * @param {object} doc  decoded save (mutated in place)
   * @param {string} id   row id
   * @param {string} key  `value` | `h` | `m` | `s` | `cs` | `completed` | `turnedIn` | `available`
   * @param {number|boolean|null} value  null when the box was emptied
   * @returns {boolean} whether the document changed
   */
  setField(doc, id, key, value) {
    if (id === TIME_ROW && TIME_KEYS.includes(key)) {
      const def = fieldDef(id);
      if (!def || !fitsTimeComponent(key, value)) return false;
      const prop = top(doc, def.name);
      const parts = splitPlayTime(readScalar(prop, def));
      parts[key] = value;
      return setScalar(doc, def, joinPlayTime(parts));
    }
    if (key === 'value') {
      const def = fieldDef(id);
      if (def) return def.type === 'BoolProperty' ? false : setScalar(doc, def, value);
      if (ACT_FLAGS.includes(id) || actNames(doc).has(id)) {
        if (typeof value !== 'number') return false;   // an emptied box, not a zero
        return setActBits(doc, id, value);
      }
      return false;
    }

    const list = CONTRACT_LISTS.find((l) => l.key === key);
    if (list && id.startsWith(CONTRACT_PREFIX) && typeof value === 'boolean') {
      return setEntry(
        doc,
        list.name,
        contractPath(doc, id),
        (entry) => unqualify(entry) === id,
        value
      );
    }
    return false;
  },

  notes: [
    'A number writes one top-level property, under its own internal name; the value in the box is the value in the file. Integers must fit int32 and floats float32, an emptied or unreadable box is refused rather than read as a zero, and a float is stored rounded to the float32 the file holds.',
    'TotalPlayTime is the exception: the file holds seconds, but the row shows hours / minutes / seconds / hundredths — 1:23:04.62 is h=1, m=23, s=4, cs=62. Editing any box converts back to seconds — h × 3600 + m × 60 + s + cs ÷ 100 — and writes that, rounded to the float32 the file holds. Hours are 0 and up, minutes and seconds 0–59, hundredths 0–99.',
    'A field this save does not have yet is created by the first edit that needs it — placed after the property the game keeps next to it — and is tagged "not in this save" until then. Creating a value and then clearing it again takes the field back out, so the file ends up exactly as it started; a field the game wrote is kept even at zero.',
    'A row is ticked when its value is non-zero (a contract when any of its three boxes is on). "Not in this save" filters to the fields and entries this save has no record of at all.',
    'Secret levels are strings in UnlockedSecretLevels; ticking one adds it, unticking removes it, and a save with no such list grows one on the first tick. Only the vanilla rifts are offered to every save — a Mod: rift belongs to the content pack that made it, so it appears only in a save that already carries it.',
    'Challenge roads are strings in ChallengeRoadIDs: one per Challenge Road this file has banked — the rotating gauntlet of 2 to 7 community levels you run back to back with three lives, and the trophies the file select counts (there is no other trophy field in the file). A road is its Steam Workshop level ids joined with underscores, and the save and Collectibles.txt write that chain in opposite orders, so a road is matched by the ids it holds rather than by the string: the row carries this save\'s own wording when it has the road and the catalog\'s otherwise. Rows follow Collectibles.txt in the order the roads were published, a road the file does not list is still shown while this save carries it (tagged "not in Collectibles.txt") — it goes with the tick that takes it out, since the catalog is the only other thing that would offer it — and a list that has to be created lands beside Loadouts where the game keeps it: existing entries keep their order and wording, new ones are appended.',
    'Snatcher contracts carry three boxes: Completed and Turned in (CompletedSnatcherContracts, TurnedInSnatcherContracts) and Offered (SnatcherContracts, the pool of contracts still on offer, which only older saves still write). The id is written qualified with the package this save already uses, and the row label stays the raw id.',
    'ActBits is one number per flag — a count or a flag, not a bit field, so the whole value is written. A flag the save has never tracked gains an entry {Id, Bits, IdName} on its first non-zero value; asking for zero on an unknown flag changes nothing.',
    'Never offered: SketchingData (the sketch pad’s pixels), HUBDecorations (its elements carry no id to label them by), SpeedrunTimeObjects (the best-times table), CurrentCollectedTimePieces and _Mods (recomputed by Time Pieces), LevelSaveInfo (Death Wishes), Loadouts and PlayerCharacterType (the character switch), and every backpack list.',
  ],
};
