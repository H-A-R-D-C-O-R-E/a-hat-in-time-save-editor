/**
 * Backpack — the "Backpack" section of Collectibles.txt: passports, metro
 * tickets, vault codes, badge parts, souls and crowns.
 *
 * They are the same storage family as the six plain lists, with one difference:
 * every entry carries a *count*.
 *
 *   <bag>.Collectibles[] = { [class,] [CollectibleInstance,] [Amount,] BackpackClass }
 *
 * so each row is a box ("you have it") plus a number ("how many"). Ownership
 * is the entry's existence — a save never stores Amount = 0 for an item it
 * still tracks — and the number writes `Amount`.
 *
 *   - An entry the game wrote without an Amount (every vault code, and the
 *     RouletteToken in one save) reads as 1: something is in the backpack, so
 *     at least one of it. Typing a count writes the field explicitly, in the
 *     slot the other entries use, right before BackpackClass.
 *   - Adding an item clones an entry this save already has, so the class, the
 *     field set and the pre-2017 `CollectibleInstance` all match; removing one
 *     drops it again, so add-then-remove is a no-op.
 *   - The `Collectibles` array also holds the `Hat_Collectible_Decoration_*`
 *     items. Those belong to the Decorations section of Collectibles.txt, not
 *     to Backpack, so they are left for their own category and never shown —
 *     or written — here.
 */
import { LISTS } from '../data/backpack.js';
import { SECTIONS } from '../data/collectibles.js';
import {
  locateArray,
  ensureArray,
  classId,
  prop,
  resolveObject,
  rememberPaths,
  pruneCreatedList,
} from './backpack.js';

const ID = 'backpack';
const OTHER = 'other';

const { array, order, objects } = LISTS.collectibles;
const KNOWN = new Set(order);
const DEFAULT_PACKAGE = objects[order[0]].split('.')[0];

/** What every save writes on a Collectibles element. */
const ENTRY_CLASS = 'hatintimegamecontent.Hat_CollectibleBackpackItem';

/** Ids living in the same array but in another section — not backpack items. */
const ELSEWHERE = new Set(
  Object.entries(SECTIONS)
    .filter(([section]) => section !== 'Backpack')
    .flatMap(([, ids]) => ids)
);

const INT_MAX = 2147483647; // IntProperty is an int32; the encoder keeps its word

/** Can `set()` write? Either the list is there, or MyBackpack2017 can hold it. */
const editable = (doc) =>
  locateArray(doc, array) !== null ||
  doc.properties.some((p) => p.name === 'MyBackpack2017' && Array.isArray(p.value));

/**
 * How many the save says you have: 0 when the entry is missing, otherwise the
 * Amount it wrote — or 1 when the game left the field out entirely, which is
 * what it does for vault codes and for one save's roulette tokens.
 */
const amountOf = (el) => {
  const amt = prop(el, 'Amount')?.value;
  return typeof amt === 'number' ? amt : 1;
};

/** Write `Amount`, keeping it where the saves put it: just before BackpackClass. */
function setAmount(entry, wanted) {
  const amt = prop(entry, 'Amount');
  if (amt) {
    amt.value = wanted;
    return;
  }
  const at = entry.properties.findIndex((p) => p.name === 'BackpackClass');
  entry.properties.splice(at < 0 ? entry.properties.length : at, 0, {
    name: 'Amount',
    type: 'IntProperty',
    arrayIndex: 0,
    value: wanted,
  });
}

/** Clone an entry this save already has, so its field set is the save's own. */
function buildEntry(doc, found, id, count) {
  const source = found.arr.value.find((el) => {
    const cid = classId(el);
    return cid && cid !== 'None';
  });
  const entry = source
    ? { ...source, properties: source.properties.map((p) => ({ ...p })) }
    : { class: ENTRY_CLASS, properties: [] };

  const cls = prop(entry, 'BackpackClass');
  const object = resolveObject(doc, id, objects, found, DEFAULT_PACKAGE);
  if (cls) cls.value = object;
  else {
    entry.properties.push({
      name: 'BackpackClass',
      type: 'ObjectProperty',
      arrayIndex: 0,
      value: object,
    });
  }

  setAmount(entry, count);
  return entry;
}

/**
 * Ownership only — box checked/unchecked, and what "Select all" drives.
 * @returns {boolean} whether the document changed
 */
function setOwned(doc, id, owned) {
  const existing = locateArray(doc, array);

  if (!owned) {
    // Nothing to take away — and no list to invent on the way out either.
    if (!existing) return false;
    rememberPaths(doc, existing.arr);
    const isTarget = (el) => classId(el) === id;
    if (!existing.arr.value.some(isTarget)) return false;
    existing.arr.value = existing.arr.value.filter((el) => !isTarget(el));
    pruneCreatedList(doc, existing);
    return true;
  }

  const found = existing ?? ensureArray(doc, array);
  if (!found) return false;
  // capture every object path before we possibly delete one of them
  rememberPaths(doc, found.arr);
  if (found.arr.value.some((el) => classId(el) === id)) return false;

  found.arr.value.push(buildEntry(doc, found, id, 1));
  return true;
}

/**
 * Set the count. Zero means "none", which is written by dropping the entry;
 * null (an emptied or unreadable box) means nothing at all.
 */
function setCount(doc, id, value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  const n = Number(value);
  if (!Number.isFinite(n)) return false;
  const wanted = Math.min(INT_MAX, Math.max(0, Math.floor(n)));
  if (wanted === 0) return setOwned(doc, id, false);

  const found = locateArray(doc, array) ?? ensureArray(doc, array);
  if (!found) return false;
  const entry = found.arr.value.find((el) => classId(el) === id);
  if (!entry) {
    rememberPaths(doc, found.arr);
    found.arr.value.push(buildEntry(doc, found, id, wanted));
    return true;
  }

  const amt = prop(entry, 'Amount');
  if (amt) {
    if (amt.value === wanted) return false;
    amt.value = wanted;
    return true;
  }
  // no Amount at all: the entry reads as 1, so typing 1 is not a change
  if (wanted === amountOf(entry)) return false;
  setAmount(entry, wanted);
  return true;
}

export default {
  id: ID,
  title: 'Backpack',
  // "Not in this save" would mean exactly the same as "Not collected" here.
  filters: ['all', 'collected', 'uncollected'],

  rows(doc) {
    const entries = locateArray(doc, array)?.arr.value ?? [];
    const byId = new Map();
    for (const el of entries) {
      const itemId = classId(el);
      // placeholders carry no id at all, and one save writes BackpackClass "None"
      if (!itemId || itemId === 'None') continue;
      if (!byId.has(itemId)) byId.set(itemId, el);
    }
    const saveOnly = [...byId.keys()]
      .filter((itemId) => !KNOWN.has(itemId) && !ELSEWHERE.has(itemId))
      .sort();
    const canEdit = editable(doc);

    return [...order, ...saveOnly].map((itemId) => {
      const entry = byId.get(itemId) ?? null;
      const have = entry !== null;
      return {
        id: itemId,
        label: itemId,
        group: KNOWN.has(itemId) ? ID : OTHER,
        checked: have,
        fields: [
          { key: 'owned', label: 'Owned', text: 'have', type: 'checkbox', value: have },
          {
            key: 'count',
            label: 'Count',
            text: 'count',
            type: 'number',
            min: 0,
            value: have ? amountOf(entry) : 0,
          },
        ],
        disabled: !canEdit,
        note: KNOWN.has(itemId) ? null : 'not in Collectibles.txt',
      };
    });
  },

  groupTitle(key) {
    return key === ID ? 'All backpack items' : 'Not in Collectibles.txt';
  },

  compareGroups(a, b) {
    const rank = (k) => (k === ID ? 0 : k === OTHER ? 1 : 2);
    return rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
  },

  banner(doc) {
    if (editable(doc)) return null;
    return `This save has no ${array} list, and its pre-2017 backpack cannot hold one.`;
  },

  /**
   * @param {object} doc     decoded save (mutated in place)
   * @param {string} itemId  bare id, e.g. `Hat_Collectible_BadgePart_Sprint`
   * @param {boolean} owned
   * @returns {boolean} whether the document changed
   */
  set(doc, itemId, owned) {
    return setOwned(doc, itemId, owned);
  },

  /**
   * One of the row's two controls.
   *
   * @param {object} doc     decoded save (mutated in place)
   * @param {string} itemId  bare id
   * @param {string} key     `owned` (the box) | `count` (the number)
   * @param {*} value        boolean for `owned`, the new amount for `count`
   * @returns {boolean} whether the document changed
   */
  setField(doc, itemId, key, value) {
    if (key === 'owned') return setOwned(doc, itemId, !!value);
    if (key === 'count') return setCount(doc, itemId, value);
    return false;
  },

  notes: [
    'Each row has a box for "you have it" and a number for how many. The number writes the entry’s Amount field; the box is the entry itself.',
    'An entry the game wrote without an Amount reads as 1 — every vault code looks like that — and gains one as soon as you type a count.',
    'Setting the count to 0 (or unticking the box) removes the entry rather than writing Amount = 0: no sample save stores a zero.',
    'The Collectibles array also holds the Hat_Collectible_Decoration_* items, which belong to the Decorations section; they are hidden here and never written to.',
    'Left alone: CollectibleInstance (always "None" in every sample), and the position of entries the save already has.',
  ],
};
