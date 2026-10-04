/**
 * Death Wishes category — one row per contract, three stamp checkboxes.
 *
 * Save representation
 *   LevelSaveInfo[<map>].LevelBits[] = { Id, Bits, IdName }
 *
 * `Id` is the contract id lower-cased, `IdName` is that same id in its proper
 * case (the form the catalog uses) and `Bits` is a small bit field:
 *
 *     0 nothing   1 first   2 second   3 first+second
 *     4 third     5 first+third   6 second+third   7 all three
 *
 * so bit 0 is the first stamp, bit 1 the second and bit 2 the third. Every
 * death wish the game ships lives in the `subconforest` LevelSaveInfo element
 * — that is where the Death Wish door is — and that is the element this
 * category reads and writes. A save that has no such element yet gains one the
 * first time you stamp something: the LevelSaveInfo list itself if it is
 * missing, then a Subcon Forest entry with its LevelBits. Nothing is created by
 * merely looking at the list.
 *
 * Only `Bits` moves. SnatcherContracts, TurnedInSnatcherContracts,
 * CompletedSnatcherContracts, ActBits, TimeObjects and every counter are left
 * exactly as they were (the contract lists and ActBits are editable in the
 * **More** category, which owns them), and the per-tier bits the game keeps
 * beside each contract (`…_BossRush_0`, `…_BossRush_1`, `…_BossRush_2` — scores,
 * not stamps) are never shown as rows.
 *
 * Because `Bits` is a bit field rather than a flag, a row has three fields
 * instead of one: `fields` / `setField` in registry.js exist for this.
 */
import { SECTIONS } from '../data/collectibles.js';

const ORDER = SECTIONS['Deathwishes'];
if (!Array.isArray(ORDER) || ORDER.length === 0) {
  throw new Error('Collectibles.txt has no usable Deathwishes section');
}
const KNOWN = new Set(ORDER);

const GROUP = 'deathwishes';
const OTHER = 'other';

/** Death Wishes are stored against the Subcon Forest map. */
const MAP = 'subconforest';
/** Lower-cased prefix shared by every contract id, vanilla or mod. */
const PREFIX = 'hat_snatchercontract_deathwish_';

const STAMPS = [
  { key: 'stamp1', label: 'Stamp 1', text: '1', bit: 1 },
  { key: 'stamp2', label: 'Stamp 2', text: '2', bit: 2 },
  { key: 'stamp3', label: 'Stamp 3', text: '3', bit: 4 },
];

/**
 * Everything this editor had to build itself — the LevelSaveInfo list, a
 * Subcon Forest element, a LevelBits field and the LevelBits entries. It is
 * what makes "tick then untick" a true no-op: an entry that was already in the
 * file is always kept (even at Bits = 0) so clearing stamps on a contract the
 * save tracks restores it bit for bit, while scaffolding we added is taken back
 * down again as soon as it empties out. Keyed by the object, so it vanishes
 * with the document it belongs to.
 */
const CREATED = new WeakSet();

const levelsOf = (doc) => {
  const lsi = doc.properties.find((p) => p.name === 'LevelSaveInfo');
  return Array.isArray(lsi?.value) ? lsi.value : null;
};

/** A LevelSaveInfo we know how to extend: a struct list, or one with no entries. */
const extendable = (prop) =>
  !!prop &&
  Array.isArray(prop.value) &&
  (prop.elementType === 'struct' || prop.elementType === 'empty');

const mapOf = (el) =>
  Array.isArray(el?.properties) ? el.properties.find((p) => p.name === 'Map')?.value : undefined;

function bitsOf(el) {
  if (!Array.isArray(el?.properties)) return [];
  const p = el.properties.find((q) => q.name === 'LevelBits');
  return Array.isArray(p?.value) ? p.value : [];
}

const idOf = (b) => b.properties.find((p) => p.name === 'Id')?.value;
const nameOf = (b) => b.properties.find((p) => p.name === 'IdName')?.value;

/** The raw Bits value; anything unreadable counts as "nothing complete". */
const rawOf = (b) => {
  const v = b.properties.find((p) => p.name === 'Bits')?.value;
  return typeof v === 'number' ? v : 0;
};

/** The three stamps as 0-7. Bits above 7 exist in the wild; they are not ours. */
const maskOf = (b) => rawOf(b) & 7;

/**
 * `Foo_0`, `Foo_1`, `Foo_2` … are the game's per-tier bits beside a contract,
 * not contracts themselves. A contract never ends in a bare digit — the one
 * id that does (`…_CameraTourist_1`) is in the catalog and is matched by
 * name first, so it keeps its row.
 */
const isContract = (name) => {
  const low = name.toLowerCase();
  return low.startsWith(PREFIX) && !/_\d$/.test(low);
};

/**
 * The LevelSaveInfo element whose LevelBits carry stamps, if the save already
 * has one: prefer the entry that already holds a known contract, fall back to
 * the Subcon Forest map the game itself uses. Read-only — never grows the file.
 */
function findElement(doc) {
  const els = levelsOf(doc);
  if (!els) return null;
  return (
    els.find((el) => bitsOf(el).some((b) => KNOWN.has(nameOf(b)))) ??
    els.find((el) => mapOf(el) === MAP) ??
    null
  );
}

/**
 * Same element, but build whatever is missing instead of giving up: the
 * LevelSaveInfo list itself, then a Subcon Forest entry, then its LevelBits.
 * Returns null only when LevelSaveInfo exists in a shape this editor must not
 * guess at (an opaque or non-struct list).
 */
function ensureElement(doc) {
  const found = findElement(doc);
  if (found) return found;

  let list = doc.properties.find((p) => p.name === 'LevelSaveInfo');
  if (list) {
    if (!extendable(list)) return null;
    list.elementType = 'struct';   // an 'empty' list grows its first entry here
  } else {
    list = { name: 'LevelSaveInfo', type: 'ArrayProperty', arrayIndex: 0, elementType: 'struct', value: [] };
    doc.properties.push(list);
    CREATED.add(list);
  }

  const element = {
    properties: [
      { name: 'Map', type: 'StrProperty', arrayIndex: 0, value: MAP },
      { name: 'LevelBits', type: 'ArrayProperty', arrayIndex: 0, elementType: 'struct', value: [] },
    ],
  };
  CREATED.add(element);
  CREATED.add(element.properties[1]);
  list.value.push(element);
  return element;
}

/** Can this save take a stamp? Yes, unless LevelSaveInfo exists but is opaque. */
function writable(doc, found = findElement(doc)) {
  if (found) return true;
  const list = doc.properties.find((p) => p.name === 'LevelSaveInfo');
  return !list || extendable(list);
}

/** Index an element's LevelBits by their proper-cased id. */
function indexBits(el) {
  const byName = new Map();
  if (!el) return byName;
  for (const b of bitsOf(el)) {
    const name = nameOf(b);
    if (typeof name === 'string' && name) byName.set(name, b);
  }
  return byName;
}

function findEntry(el, id) {
  for (const b of bitsOf(el)) if (nameOf(b) === id) return b;
  const low = id.toLowerCase();
  for (const b of bitsOf(el)) if (idOf(b) === low) return b;
  return null;
}

/** Build a LevelBits entry the way the game writes one. */
function buildEntry(el, id, mask) {
  const entry = {
    properties: [
      { name: 'Id', type: 'StrProperty', arrayIndex: 0, value: id.toLowerCase() },
      { name: 'Bits', type: 'IntProperty', arrayIndex: 0, value: mask },
      { name: 'IdName', type: 'NameProperty', arrayIndex: 0, value: id },
    ],
  };
  // every LevelBits element seen so far is untagged, but follow a save that
  // tags them rather than emitting an entry it cannot re-decode
  const template = bitsOf(el).find((b) => b.class !== undefined);
  if (template) entry.class = template.class;
  return entry;
}

/**
 * The element's LevelBits array, ready to be appended to. Null when the
 * property exists but its contents are opaque — never guess at those.
 */
function ensureBits(el) {
  let prop = el.properties.find((q) => q.name === 'LevelBits');
  if (!prop) {
    prop = { name: 'LevelBits', type: 'ArrayProperty', arrayIndex: 0, elementType: 'struct', value: [] };
    el.properties.push(prop);
    CREATED.add(prop);
    return prop.value;
  }
  if (!Array.isArray(prop.value)) return null;
  if (prop.elementType === 'empty') prop.elementType = 'struct';
  else if (prop.elementType !== 'struct') return null;
  return prop.value;
}

/**
 * Write a stamp mask onto one contract, creating or dropping its LevelBits
 * entry as needed — and, when the save has nowhere to put one, creating the
 * Subcon Forest LevelSaveInfo entry it belongs in. Bits above 7 are preserved.
 *
 * @returns {boolean} whether the document changed
 */
function setMask(doc, id, wanted) {
  const mask = wanted & 7;
  const found = findElement(doc);
  const entry = found ? findEntry(found, id) : null;
  const raw = entry ? rawOf(entry) : 0;
  const next = (raw & ~7) | mask;
  // nothing wanted and nothing there: do not grow the file to say so
  if (next === raw) return false;

  const el = found ?? ensureElement(doc);
  if (!el) return false;
  const arr = ensureBits(el);
  if (!arr) return false;

  if (!entry) {
    const made = buildEntry(el, id, mask);
    arr.push(made);
    CREATED.add(made);
    return true;
  }

  if (next === 0 && CREATED.has(entry)) {
    const at = arr.indexOf(entry);
    if (at >= 0) arr.splice(at, 1);
    pruneScaffold(doc, el);
    return true;
  }

  const bits = entry.properties.find((p) => p.name === 'Bits');
  // no Bits field means this entry is not carrying stamps at all; refuse rather
  // than invent the field (never seen in a real save)
  if (!bits) return false;
  bits.value = next;
  return true;
}

/**
 * Take back the scaffolding this editor built once the last stamp on it goes:
 * a LevelBits field we added, then the Subcon Forest element, then the whole
 * LevelSaveInfo list — each only if we are the ones who put it there, and only
 * once it is empty. A list or element the game wrote is never dropped.
 */
function pruneScaffold(doc, el) {
  const at = el.properties.findIndex((q) => q.name === 'LevelBits');
  const bits = at >= 0 ? el.properties[at] : null;
  if (Array.isArray(bits?.value) && bits.value.length) return;  // stamps remain

  if (bits && CREATED.has(bits)) el.properties.splice(at, 1);
  if (!CREATED.has(el)) return;

  const list = doc.properties.find((p) => p.name === 'LevelSaveInfo');
  const i = Array.isArray(list?.value) ? list.value.indexOf(el) : -1;
  if (i >= 0) list.value.splice(i, 1);

  if (CREATED.has(list) && list.value.length === 0) {
    const j = doc.properties.indexOf(list);
    if (j >= 0) doc.properties.splice(j, 1);
  }
}

export default {
  id: 'deathwishes',
  title: 'Death Wishes',

  // "Not in this save" would mean exactly the same as "Not collected" here.
  filters: ['all', 'collected', 'uncollected'],

  rows(doc) {
    const el = findElement(doc);
    const byName = indexBits(el);
    const saveOnly = [...byName.keys()]
      .filter((name) => isContract(name) && !KNOWN.has(name))
      .sort();
    const canWrite = writable(doc, el);

    return [...ORDER, ...saveOnly].map((id) => {
      const entry = byName.get(id) ?? null;
      const mask = entry ? maskOf(entry) : 0;
      return {
        id,
        label: id,
        group: KNOWN.has(id) ? GROUP : OTHER,
        checked: mask !== 0,
        fields: STAMPS.map((s) => ({
          key: s.key,
          label: s.label,
          text: s.text,
          type: 'checkbox',
          value: (mask & s.bit) !== 0,
        })),
        disabled: !canWrite,
        note: KNOWN.has(id) ? null : 'not in Collectibles.txt',
      };
    });
  },

  groupTitle(key) {
    return key === GROUP ? 'All death wishes' : 'Not in Collectibles.txt';
  },

  compareGroups(a, b) {
    const rank = (k) => (k === GROUP ? 0 : k === OTHER ? 1 : 2);
    return rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
  },

  banner(doc) {
    if (writable(doc)) return null;
    return 'This save’s LevelSaveInfo list is not in a shape this editor can add a Subcon Forest entry to.';
  },

  /**
   * @param {object} doc    decoded save (mutated in place)
   * @param {string} id     contract id, e.g. `Hat_SnatcherContract_DeathWish_BossRush`
   * @param {boolean} all   true = all three stamps (7), false = none (0)
   * @returns {boolean} whether the document changed
   */
  set(doc, id, all) {
    return setMask(doc, id, all ? 7 : 0);
  },

  /**
   * One stamp at a time — this is what the three checkboxes drive.
   *
   * @param {object} doc  decoded save (mutated in place)
   * @param {string} id   contract id
   * @param {string} key  `stamp1` | `stamp2` | `stamp3`
   * @param {boolean} on  whether that stamp is complete
   * @returns {boolean} whether the document changed
   */
  setField(doc, id, key, on) {
    const stamp = STAMPS.find((s) => s.key === key);
    if (!stamp) return false;
    // read with findElement, not ensureElement: asking for "no stamp" on a save
    // that has never tracked this contract must not invent a LevelSaveInfo
    const el = findElement(doc);
    const entry = el ? findEntry(el, id) : null;
    const current = entry ? maskOf(entry) : 0;
    return setMask(doc, id, on ? current | stamp.bit : current & ~stamp.bit);
  },

  notes: [
    'Three stamps per Death Wish, stored as one bit field in LevelSaveInfo[<map>].LevelBits: 0 nothing, 1 first, 2 second, 3 first+second, 4 third, 5 first+third, 6 second+third, 7 all three.',
    'The boxes are the first, second and third stamp, left to right. Bits above 7 are not stamps and are never touched.',
    'Death wish progress lives in the Subcon Forest LevelSaveInfo entry. A save that has no such entry — or no LevelSaveInfo at all — grows one the first time you stamp something; merely looking at the list never creates anything.',
    'A contract the save already tracks keeps its entry when you clear all three stamps (Bits = 0). An entry this editor created is removed again, together with the LevelSaveInfo or Subcon Forest scaffolding around it once that empties out — so ticking then unticking restores the file exactly.',
    'Left alone here: SnatcherContracts, TurnedInSnatcherContracts, CompletedSnatcherContracts, ActBits, TimeObjects and every counter — the contract lists and ActBits are edited in More, TimeObjects in Time Pieces. The per-tier bits beside each contract (…_0, …_1, …_2) are scores, not stamps, and are never offered as rows.',
  ],
};
