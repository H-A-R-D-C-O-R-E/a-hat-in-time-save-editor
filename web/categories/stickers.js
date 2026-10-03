/**
 * Stickers category — the stickers unlocked for the staging area.
 *
 *   MyBackpack2017.Stickers[] = { class: "…Hat_BackpackItem", properties: [BackpackClass] }
 *
 * Only 3 of the 8 sample saves have the list at all (CDLC1, DLC2, Mod Chapters);
 * the rest simply never had a sticker. Because it is a property of
 * BackpackInfo2017, a modern save without one grows it on demand — appended at
 * the end of the bag, which is exactly where those three saves keep it.
 *
 * `1.0 Hundo.hat` predates stickers entirely, so its rows are disabled behind a
 * banner rather than given a field its format never had.
 *
 * Note that `Stickers` also appears as an (almost always empty) *equipped*
 * array inside Loadouts — that is which stickers are on the wall, and it is left
 * alone, as is everything else in Loadouts.
 */
import { backpackList } from './backpack-list.js';

export default backpackList({
  id: 'stickers',
  title: 'Stickers',
  blurb: 'The stickers you have unlocked for your room.',
  list: 'stickers',
  groupLabel: 'stickers',
  notes: [
    'Stored as `<bag>.Stickers`. A save that has never had one gets a fresh list appended after Collectibles, which is where the three saves that do have stickers keep it.',
    'Checking one appends an entry cloned from a sticker this save already has; unchecking removes every entry with that id.',
    'Which stickers are currently on the wall lives in Loadouts, which is not touched here.',
  ],
});
