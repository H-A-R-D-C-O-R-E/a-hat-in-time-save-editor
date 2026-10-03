/**
 * Hat Kid or Bow Kid — the one editable thing in a save that is not an item.
 *
 * Comparing `hat kid default file.hat` with `bow kid default file.hat` (two
 * brand-new files, one per character, nothing else done) leaves exactly three
 * differences:
 *
 *   • `PlayerCharacterType` — an IntProperty, present with value 1 in the Bow
 *     Kid file and absent from every Hat Kid save here (10 of 10 samples)
 *   • `Loadouts` — the Bow Kid file has a second element, #1, whose
 *     UpperBody/Legs are `BowKid*` where #0's are `HatKid*`
 *   • `LastPlayTime` / `CreationTimeStamp` — only when each file was written
 *
 * So `Loadouts` is indexed by character: #0 is Hat Kid's loadout, #1 is Bow
 * Kid's, and `PlayerCharacterType` picks which one to play. That reading holds
 * across every save on disk — all five with two loadouts have the Bow Kid body
 * in #1, and no save carries the property at all while playing as Hat Kid.
 *
 * Switching therefore writes the flag and makes sure the target loadout
 * exists. A save that has never seen Bow Kid gets #1 as a *copy* of #0 with
 * the body swapped: she inherits the gear Hat Kid had equipped, rather than
 * starting from an empty loadout we would have had to invent. Going back to
 * Hat Kid only removes the property — the loadout stays, because real Hat Kid
 * saves keep one (`DLC1 Hundo.hat` has two).
 *
 * This is shaped exactly like a category, but it is not registered in
 * CATEGORIES: it has no list to show, so app.js tracks it for the pending-
 * change count and renders it as the segmented control in the top bar.
 */
const LOADOUTS = 'Loadouts';

/** The property that names the character, and the id its row carries. */
export const CHARACTER_ROW = 'PlayerCharacterType';

/** The body the game's own Bow Kid loadout wears (both from `bow kid default file.hat`). */
const BOW_BODY = {
  UpperBody: 'hatintimegamecontent.Hat_CosmeticItem_BowKidUpperBody',
  Legs: 'hatintimegamecontent.Hat_CosmeticItem_BowKidLegs',
};

const isCharacter = (target) => target === 'hat' || target === 'bow';

const loadoutsOf = (doc) => {
  const p = doc.properties.find((x) => x.name === LOADOUTS);
  return p && Array.isArray(p.value) ? p : null;
};

/**
 * Structural copy — the new loadout must not share a single node with the one
 * it was cloned from, or editing either of them later would edit both.
 */
const clone = (value) => {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = clone(v);
    return out;
  }
  return value;
};

/** Which character this save plays as. No flag (or anything but 1) is Hat Kid. */
export function characterOf(doc) {
  const flag = doc.properties.find((p) => p.name === CHARACTER_ROW);
  return flag && flag.value === 1 ? 'bow' : 'hat';
}

/**
 * Why `target` cannot be chosen right now, or null when it can.
 * Switching to Hat Kid only removes a property, so nothing can block it.
 *
 * @param {object} doc
 * @param {'hat'|'bow'} target
 * @returns {string|null}
 */
export function characterBlocker(doc, target) {
  if (!isCharacter(target) || characterOf(doc) === target) return null;
  if (target === 'hat') return null;
  const loadouts = loadoutsOf(doc);
  if (!loadouts || loadouts.value.length === 0) {
    return 'This save has no Loadouts list, so Bow Kid would have nowhere to keep her loadout.';
  }
  return null;
}

/** Give Bow Kid the loadout Hat Kid already has, with the body swapped over. */
function bowLoadout(source) {
  const element = clone(source);
  for (const [name, value] of Object.entries(BOW_BODY)) {
    const existing = element.properties.find((p) => p.name === name);
    // a pre-2017 loadout has no body fields at all — they go at the end, where
    // the current format keeps them
    if (existing) existing.value = value;
    else element.properties.push({ name, type: 'ObjectProperty', arrayIndex: 0, value });
  }
  return element;
}

/**
 * Switch the save to `target`.
 *
 * @param {object} doc            decoded save (mutated in place)
 * @param {'hat'|'bow'} target
 * @returns {boolean} whether the document changed
 */
export function setCharacter(doc, target) {
  if (!isCharacter(target) || characterOf(doc) === target) return false;
  if (characterBlocker(doc, target)) return false;

  let loadouts = null;
  if (target === 'bow') {
    loadouts = loadoutsOf(doc);
    if (loadouts.value.length < 2) loadouts.value.push(bowLoadout(loadouts.value[0]));
  }

  const flag = doc.properties.find((p) => p.name === CHARACTER_ROW);
  if (target === 'hat') {
    if (!flag) return false;
    doc.properties.splice(doc.properties.indexOf(flag), 1);
    return true;
  }
  if (flag) {
    flag.value = 1;
    return true;
  }
  // straight after Loadouts, which is where the game's own Bow Kid file keeps it
  doc.properties.splice(doc.properties.indexOf(loadouts) + 1, 0, {
    name: CHARACTER_ROW,
    type: 'IntProperty',
    arrayIndex: 0,
    value: 1,
  });
  return true;
}

/**
 * Category-shaped, so the pending-change counter can track it the same way it
 * tracks every list: one row, ticked when the save plays as Bow Kid.
 */
export const characterSetting = {
  id: 'character',
  title: 'Character',
  blurb: 'Which character the save is played as.',
  // one row, so there is nothing to filter
  filters: ['all'],

  rows(doc) {
    return [{
      id: CHARACTER_ROW,
      label: CHARACTER_ROW,            // the internal name stays put, as everywhere else
      group: 'character',
      checked: characterOf(doc) === 'bow',
    }];
  },

  groupTitle() {
    return 'Character';
  },

  compareGroups() {
    return 0;
  },

  banner(doc) {
    return characterBlocker(doc, characterOf(doc) === 'bow' ? 'hat' : 'bow');
  },

  /**
   * @param {object} doc    decoded save (mutated in place)
   * @param {string} id     always `PlayerCharacterType`
   * @param {boolean} checked  true for Bow Kid, false for Hat Kid
   * @returns {boolean} whether the document changed
   */
  set(doc, id, checked) {
    return id === CHARACTER_ROW && setCharacter(doc, checked ? 'bow' : 'hat');
  },

  /** What a toggle in this control writes to the file. */
  explain(id, value) {
    if (id !== CHARACTER_ROW) return null;
    return value
      ? 'Bow Kid — PlayerCharacterType = 1, and Loadouts[1] is her loadout.'
      : 'Hat Kid — PlayerCharacterType removed, Loadouts[0] is her loadout.';
  },

  notes: [
    'Bow Kid is PlayerCharacterType = 1; every Hat Kid save leaves the property out of the file altogether.',
    'Loadouts is indexed by character: [0] is Hat Kid’s loadout, [1] is Bow Kid’s. A save that only has the first gains a copy of it wearing BowKidUpperBody / BowKidLegs, so she keeps whatever Hat Kid had equipped.',
    'Switching back to Hat Kid only removes the property. A loadout Bow Kid already had is left in place — real Hat Kid saves keep one.',
    'Nothing else is touched: no backpack entry, no counter, no timestamp.',
  ],
};
