/**
 * Dyes category — hat and outfit colours.
 *
 * Collectibles.txt calls the section `Dyes/Paintables` and the ids are
 * `Hat_Collectible_Skin_*`, which is also the name the save uses for the array:
 * `<bag>.Skins`. Both spellings are kept apart on purpose — the section name is
 * the catalog's, `Skins` is the file's.
 *
 *   MyBackpack2017.Skins[] = { class: "…Hat_BackpackItem", properties: [BackpackClass] }
 *   MyBackpack.Skins[]     = { properties: [ItemQuality, LastUseTime, BackpackClass] }
 *
 * All 8 sample saves carry this list, so Dyes are editable everywhere.
 */
import { backpackList } from './backpack-list.js';

export default backpackList({
  id: 'dyes',
  title: 'Dyes',
  list: 'dyes',
  groupLabel: 'dyes',
  notes: [
    'Stored as `<bag>.Skins` — "dyes" is what Collectibles.txt calls them, "skins" is what the save calls them.',
    'Checking one appends an entry cloned from a dye this save already has; unchecking removes every entry with that id.',
    'The dye actually worn right now lives in Loadouts, which is not touched here.',
  ],
});
