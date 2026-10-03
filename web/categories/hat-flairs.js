/**
 * Hat Flairs category — the cosmetic items you can wear on an ability hat.
 *
 * Save representation
 *   <bag>.Hats[] = { ItemQualityInfo, ItemQualityInfoName, BackpackClass }
 *
 * A flair has no array of its own: owning one is recorded by a *separate entry*
 * in the same `Hats` array as the hats, carrying both the cosmetic
 * (`ItemQualityInfo`/`ItemQualityInfoName`) and the hat it belongs to
 * (`BackpackClass`). That pairing is the only place the game records which hat a
 * flair fits, so the catalog maps every flair to its hat (harvested from the
 * sample saves, verified so the mapping never contradicts them).
 *
 * Flairs only exist in `MyBackpack2017`. The pre-2017 `MyBackpack` format has
 * `ItemQuality` (a rarity) but no cosmetic slot at all, so on such a save this
 * category reports itself as unavailable rather than writing fields the format
 * does not have.
 */
import { ORDER as HAT_ORDER, FLAIR_ORDER, FLAIR_OBJECTS, OBJECTS as HAT_OBJECTS } from '../data/hats.js';
import {
  locateArray,
  ensureArray,
  cosmeticCapable,
  classId,
  flairId,
  packageOf,
  buildCosmeticEntry,
} from './backpack.js';

const KNOWN = new Set(FLAIR_ORDER);
const DEFAULT_PACKAGE = HAT_OBJECTS[Object.keys(HAT_OBJECTS)[0]].split('.')[0];
const UNKNOWN = '__unknown__';

/** Display names for the six ability hats, keyed by their raw class id. */
export const HAT_TITLES = {
  Hat_Ability_Help: 'Default Hat',
  Hat_Ability_Sprint: 'Sprint Hat',
  Hat_Ability_Chemical: 'Brewer Hat',
  Hat_Ability_StatueFall: 'Ice Hat',
  Hat_Ability_FoxMask: 'Dweller Mask',
  Hat_Ability_TimeStop: 'Time Stop Hat',
};

/**
 * Groups are hats, so rank them the way the Hats section of Collectibles.txt
 * lists them — not by whichever of that hat's flairs happens to come first in
 * the Hat Flairs section. The two categories then read in the same order.
 */
const HAT_RANK = new Map(HAT_ORDER.map((id, i) => [id, i]));

function qualifiedHat(hatId, found) {
  if (HAT_OBJECTS[hatId]) return HAT_OBJECTS[hatId];
  for (const el of found.arr.value) {
    const cls = el.properties.find((p) => p.name === 'BackpackClass')?.value;
    if (typeof cls === 'string' && cls.split('.').pop() === hatId) return cls;
  }
  return `${packageOf(found) ?? DEFAULT_PACKAGE}.${hatId}`;
}

/** Which hat does this flair belong to, and what object path does it use? */
function resolve(flair, found) {
  const catalog = FLAIR_OBJECTS[flair];
  if (catalog) return { hat: catalog.hat, object: catalog.object };

  // Not in the catalog: it is already in this save, so read the pairing back off it.
  const entry = found.arr.value.find((el) => flairId(el) === flair);
  const hat = entry ? classId(entry) : null;
  if (!hat) return null;
  const info = entry.properties.find((p) => p.name === 'ItemQualityInfo')?.value;
  return { hat, object: typeof info === 'string' ? info : `${packageOf(found) ?? DEFAULT_PACKAGE}.${flair}` };
}

export default {
  id: 'hat-flairs',
  title: 'Hat Flairs',
  blurb: 'Cosmetics worn on a hat. Ticking one adds it as its own entry in the save’s Hats array.',
  // "Not in this save" would mean exactly the same as "Not collected" here.
  filters: ['all', 'collected', 'uncollected'],

  rows(doc) {
    const found = locateArray(doc, 'Hats');
    const entries = found?.arr.value ?? [];

    const owned = new Map();          // flair id -> hat id, as the save has it
    for (const el of entries) {
      const flair = flairId(el);
      if (flair) owned.set(flair, classId(el));
    }

    const saveOnly = [...owned.keys()].filter((f) => !KNOWN.has(f)).sort();
    const canEdit = cosmeticCapable(found);

    return [...FLAIR_ORDER, ...saveOnly].map((id) => ({
      id,
      label: id,
      group: owned.get(id) ?? FLAIR_OBJECTS[id]?.hat ?? UNKNOWN,
      checked: owned.has(id),
      disabled: !canEdit,
    }));
  },

  groupTitle(key) {
    if (key === UNKNOWN) return 'Unknown hat';
    return HAT_TITLES[key] ?? key.replace(/^Hat_Ability_/, '');
  },

  compareGroups(a, b) {
    const rank = (k) => (HAT_RANK.has(k) ? HAT_RANK.get(k) : Number.MAX_SAFE_INTEGER);
    return rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
  },

  banner(doc) {
    const found = locateArray(doc, 'Hats');
    if (!found) {
      return 'This save has no backpack array, so there is nothing to edit.';
    }
    if (!cosmeticCapable(found)) {
      return 'This save uses the pre-2017 backpack format (MyBackpack), which has no slot for hat flairs. Hats can still be edited.';
    }
    return null;
  },

  /**
   * @param {object} doc    decoded save (mutated in place)
   * @param {string} id     bare flair id, e.g. `Hat_CosmeticItemQualityInfo_Sprint_BallCap`
   * @param {boolean} checked
   * @returns {boolean} whether the document changed
   */
  set(doc, id, checked) {
    const found = ensureArray(doc, 'Hats', 'start');
    if (!found || !cosmeticCapable(found)) return false;

    const isTarget = (el) => flairId(el) === id;
    const collected = found.arr.value.some(isTarget);
    if (collected === !!checked) return false;

    if (checked) {
      const rec = resolve(id, found);
      if (!rec) return false;
      found.arr.value.push(
        buildCosmeticEntry(found.arr, {
          object: rec.object,
          name: id,
          hatObject: qualifiedHat(rec.hat, found),
        })
      );
    } else {
      found.arr.value = found.arr.value.filter((el) => !isTarget(el));
    }
    return true;
  },

  notes: [
    'Checking a flair appends {ItemQualityInfo, ItemQualityInfoName, BackpackClass} — the three fields a real flair entry has. LastUseTime is left out on purpose: five entries in Deathwish.hat already have none.',
    'The BackpackClass is the hat that flair fits, taken from the catalog (verified against every sample save).',
    'Unchecking a flair removes its entry. Plain hat entries are untouched.',
    'Hats are a separate category; neither one changes the other.',
  ],
};
