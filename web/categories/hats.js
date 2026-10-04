/**
 * Hats category — the six ability hats.
 *
 * Save representation
 *   <bag>.Hats[] = { [ItemQuality,] LastUseTime, BackpackClass }   (plain entry)
 *
 * A hat counts as collected when the save has a **plain** entry for it (one with
 * no ItemQualityInfoName). Flairs are stored as separate entries in the same
 * array, so the two categories are deliberately independent: adding a flair never
 * changes a hat's state, and removing a hat never removes its flairs.
 *
 * Nothing outside `<bag>.Hats` is touched — Loadouts only describe what is
 * equipped, and they are left alone.
 */
import { ORDER, OBJECTS } from '../data/hats.js';
import {
  locateArray,
  ensureArray,
  classId,
  flairId,
  resolveObject,
  rememberPaths,
  pruneCreatedList,
  buildPlainEntry,
} from './backpack.js';

const KNOWN = new Set(ORDER);
const DEFAULT_PACKAGE = OBJECTS[ORDER[0]].split('.')[0];

/** True when `set()` would be able to write anything at all. */
function editable(doc) {
  return (
    locateArray(doc, 'Hats') !== null ||
    doc.properties.some((p) => p.name === 'MyBackpack2017' && Array.isArray(p.value))
  );
}

export default {
  id: 'hats',
  title: 'Hats',
  // "Not in this save" would mean exactly the same as "Not collected" here.
  filters: ['all', 'collected', 'uncollected'],

  rows(doc) {
    const entries = locateArray(doc, 'Hats')?.arr.value ?? [];
    const owned = new Set();      // every plain entry this save actually has
    const saveOnly = new Set();   // …of which these are not in Collectibles.txt
    for (const el of entries) {
      if (flairId(el) !== undefined) continue;   // a flair entry, not a hat
      const id = classId(el);
      if (!id) continue;
      owned.add(id);
      if (!KNOWN.has(id)) saveOnly.add(id);
    }
    const canEdit = editable(doc);

    return [...ORDER, ...[...saveOnly].sort()].map((id) => ({
      id,
      label: id,
      group: KNOWN.has(id) ? 'hats' : 'other',
      checked: owned.has(id),
      disabled: !canEdit,
      note: KNOWN.has(id) ? null : 'not in Collectibles.txt',
    }));
  },

  groupTitle(key) {
    return key === 'hats' ? 'All hats' : 'Not in Collectibles.txt';
  },

  compareGroups(a, b) {
    const rank = (k) => (k === 'hats' ? 0 : k === 'other' ? 1 : 2);
    return rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
  },

  banner(doc) {
    if (editable(doc)) return null;
    return 'This save has no backpack array, so there is nothing to edit.';
  },

  /**
   * @param {object} doc    decoded save (mutated in place)
   * @param {string} id     bare hat id, e.g. `Hat_Ability_Sprint`
   * @param {boolean} checked
   * @returns {boolean} whether the document changed
   */
  set(doc, id, checked) {
    const found = ensureArray(doc, 'Hats', 'start');
    if (!found) return false;
    // capture every object path before we possibly delete one of them
    rememberPaths(doc, found.arr);

    const isTarget = (el) => flairId(el) === undefined && classId(el) === id;
    const collected = found.arr.value.some(isTarget);
    if (collected === !!checked) return false;

    if (checked) {
      found.arr.value.push(
        buildPlainEntry(found.arr, resolveObject(doc, id, OBJECTS, found, DEFAULT_PACKAGE))
      );
    } else {
      found.arr.value = found.arr.value.filter((el) => !isTarget(el));
      pruneCreatedList(doc, found);
    }
    return true;
  },

  notes: [
    'Checking a hat appends a plain entry — {LastUseTime, BackpackClass} — cloned from an entry the save already has, so the field set and types match exactly.',
    'Unchecking a hat removes every plain entry for it. A few older saves store duplicates of the same hat, so unchecking then re-checking collapses those to a single entry.',
    'Flairs live in the same array as separate entries, so the two categories never affect each other.',
    'Loadouts are not touched — they only record what is equipped, which stays something you do in-game.',
  ],
};
