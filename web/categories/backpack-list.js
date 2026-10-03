/**
 * Factory for the "simple" backpack lists — Badges, Dyes, Stickers, Weapons,
 * Remixes and Camera Filters are all the same shape:
 *
 *   <bag>.<List>[] = { [class,] [ItemQuality,] [LastUseTime,] BackpackClass }
 *
 * one entry per owned item, no cosmetic slot, no counters, no sub-items. So
 * instead of six copies of the same category, they are one category built from
 * a line of configuration:
 *
 *   export default backpackList({ id: 'dyes', title: 'Dyes', … });
 *
 * Collecting an item appends an entry cloned from one the save already has;
 * un-collecting drops every entry carrying that id. Nothing else in the file is
 * touched — not Loadouts (equipping stays an in-game action), not any counter.
 *
 * A save can be edited when it already has the list, or when MyBackpack2017 can
 * grow it (that is how a save with no stickers yet gains its first one). The
 * pre-2017 `MyBackpack` is only read, never extended: `1.0 Hundo.hat` has no
 * Weapons, Filters or Stickers list, and we do not invent fields for a format
 * that never had them — those rows show a banner instead.
 */
import { LISTS } from '../data/backpack.js';
import {
  locateArray,
  ensureArray,
  classId,
  resolveObject,
  rememberPaths,
  pruneCreatedList,
  buildOwnedEntry,
} from './backpack.js';

const OTHER = 'other';

export function backpackList({ id, title, blurb, list, groupLabel, notes = [] }) {
  const { array, order, objects } = LISTS[list];
  if (!order?.length) throw new Error(`backpackList("${list}"): empty catalog`);

  const KNOWN = new Set(order);
  const DEFAULT_PACKAGE = objects[order[0]].split('.')[0];

  /** Can `set()` write? Either the list is there, or MyBackpack2017 can hold it. */
  const editable = (doc) =>
    locateArray(doc, array) !== null ||
    doc.properties.some((p) => p.name === 'MyBackpack2017' && Array.isArray(p.value));

  return {
    id,
    title,
    blurb,
    // "Not in this save" would mean exactly the same as "Not collected" here.
    filters: ['all', 'collected', 'uncollected'],

    rows(doc) {
      const entries = locateArray(doc, array)?.arr.value ?? [];
      const owned = new Set();      // every id this save actually has
      const saveOnly = new Set();   // …of which these are not in Collectibles.txt
      for (const el of entries) {
        const itemId = classId(el);
        // placeholder entries (296 of CDLC1's 304 remixes) carry no id at all
        if (!itemId) continue;
        owned.add(itemId);
        if (!KNOWN.has(itemId)) saveOnly.add(itemId);
      }
      const canEdit = editable(doc);

      return [...order, ...[...saveOnly].sort()].map((itemId) => ({
        id: itemId,
        label: itemId,
        group: KNOWN.has(itemId) ? id : OTHER,
        checked: owned.has(itemId),
        disabled: !canEdit,
        note: KNOWN.has(itemId) ? null : 'not in Collectibles.txt',
      }));
    },

    groupTitle(key) {
      return key === id ? `All ${groupLabel}` : 'Not in Collectibles.txt';
    },

    compareGroups(a, b) {
      const rank = (k) => (k === id ? 0 : k === OTHER ? 1 : 2);
      return rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
    },

    banner(doc) {
      if (editable(doc)) return null;
      return `This save has no ${array} list, and its pre-2017 backpack cannot hold one.`;
    },

    /**
     * @param {object} doc     decoded save (mutated in place)
     * @param {string} itemId  bare id, e.g. `Hat_Collectible_Skin_Bee`
     * @param {boolean} checked
     * @returns {boolean} whether the document changed
     */
    set(doc, itemId, checked) {
      const found = ensureArray(doc, array);
      if (!found) return false;
      // capture every object path before we possibly delete one of them
      rememberPaths(doc, found.arr);

      const isTarget = (el) => classId(el) === itemId;
      const collected = found.arr.value.some(isTarget);
      if (collected === !!checked) return false;

      if (checked) {
        const object = resolveObject(doc, itemId, objects, found, DEFAULT_PACKAGE);
        found.arr.value.push(buildOwnedEntry(found, object));
      } else {
        found.arr.value = found.arr.value.filter((el) => !isTarget(el));
        pruneCreatedList(doc, found);
      }
      return true;
    },

    notes,
  };
}
