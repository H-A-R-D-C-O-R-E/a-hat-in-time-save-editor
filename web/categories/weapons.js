/**
 * Weapons category — the throwables and melee weapons you have unlocked.
 *
 *   MyBackpack2017.Weapons[] = { class: "…Hat_BackpackItem", properties: [BackpackClass] }
 *
 * All 7 modern sample saves have the list. `1.0 Hundo.hat` only has
 * `MyBackpack.Weapon` — a single ObjectProperty naming the weapon currently
 * held, not an inventory — so the pre-2017 save has nothing to edit and its
 * rows show a banner instead.
 */
import { backpackList } from './backpack-list.js';

export default backpackList({
  id: 'weapons',
  title: 'Weapons',
  list: 'weapons',
  groupLabel: 'weapons',
  notes: [
    'Stored as `<bag>.Weapons` — a list of everything unlocked. The weapon currently held is a different thing: `MyBackpack.Weapon` in the pre-2017 save, and Loadouts in the current one. Neither is touched.',
    'Checking one appends an entry cloned from a weapon this save already has; unchecking removes every entry with that id.',
    'The pre-2017 save has no Weapons list at all, so its rows are disabled.',
  ],
});
