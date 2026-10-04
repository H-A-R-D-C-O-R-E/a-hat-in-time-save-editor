/**
 * Camera Filters category — the camera effects you have unlocked.
 *
 * Collectibles.txt calls the section `Camera Filters` and the ids are
 * `Hat_Collectible_CameraFilter_*`; the save stores them under the shorter
 * `Filters`. Both spellings are kept apart on purpose.
 *
 *   MyBackpack2017.Filters[] = { class: "…Hat_BackpackItem", properties: [BackpackClass] }
 *
 * All 7 modern sample saves have the list. `1.0 Hundo.hat` predates camera
 * filters, so its rows are disabled behind a banner rather than given a field
 * its format never had.
 */
import { backpackList } from './backpack-list.js';

export default backpackList({
  id: 'filters',
  title: 'Filters',
  list: 'filters',
  groupLabel: 'camera filters',
  notes: [
    'Stored as `<bag>.Filters`; Collectibles.txt calls the section "Camera Filters".',
    'Checking one appends an entry cloned from a filter this save already has; unchecking removes every entry with that id.',
    'Which filter is active right now lives in Loadouts, which is not touched here.',
    'The pre-2017 save has no Filters list at all, so its rows are disabled.',
  ],
});
