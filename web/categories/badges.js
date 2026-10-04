/**
 * Badges category — equippable perks, one per entry in `<bag>.Badges`.
 *
 * Save representation
 *   MyBackpack2017.Badges[] = { class: "…Hat_BackpackItem", properties: [BackpackClass] }
 *   MyBackpack.Badges[]     = { properties: [ItemQuality, LastUseTime, BackpackClass] }
 *
 * Unlike hats, a badge entry has no cosmetic slot and no LastUseTime at all in
 * the current format — the whole entry *is* the class id. So collecting a badge
 * is "append an entry cloned from one this save already has, with the id
 * swapped", and un-collecting is "drop every entry with that id".
 *
 * Deliberately out of scope: the two badge *slot* upgrades are
 * `Hat_Collectible_BadgeSlot` / `Hat_Collectible_BadgeSlot2`, which live in
 * `<bag>.Collectibles`, together with the `MyBadgeSlots` counter. Neither is
 * touched by this category, and `MyBadgePoints` / `MyLifeTimeBadgePoints` are
 * not touched either.
 */
import { backpackList } from './backpack-list.js';

export default backpackList({
  id: 'badges',
  title: 'Badges',
  list: 'badges',
  groupLabel: 'badges',
  notes: [
    'Every badge in the current format is a single BackpackClass — no LastUseTime, no ItemQuality — so checking one appends exactly that, cloned from an entry the save already has. The pre-2017 save keeps its {ItemQuality, LastUseTime, BackpackClass} field set.',
    'Unchecking a badge removes every entry with that id.',
    'The two badge slot upgrades (Hat_Collectible_BadgeSlot, Hat_Collectible_BadgeSlot2) live in Collectibles and are deliberately not offered here; MyBadgeSlots and the MyBadgePoints counters are left alone.',
    'Badges have no cosmetic slot, so unlike hats there is nothing for this category to interfere with — Loadouts is not touched either.',
  ],
});
