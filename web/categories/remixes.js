/**
 * Remixes category — the alternate versions of a level's music you have found.
 *
 *   MyBackpack2017.Remixes[] = { class: "…Hat_BackpackItem", properties: [BackpackClass] }
 *   MyBackpack.Remixes[]     = { properties: [ItemQuality, LastUseTime, BackpackClass] }
 *
 * All 8 sample saves carry the list, so Remixes are editable everywhere.
 *
 * `CDLC1 Hundo.hat` is worth knowing about: 296 of its 304 remix entries are
 * placeholders with no properties at all. They carry no id, so they never
 * become rows, and they are never removed — only entries whose id is actually
 * being un-checked go.
 */
import { backpackList } from './backpack-list.js';

export default backpackList({
  id: 'remixes',
  title: 'Remixes',
  list: 'remixes',
  groupLabel: 'remixes',
  notes: [
    'Stored as `<bag>.Remixes`.',
    'Checking one appends an entry cloned from a remix this save already has; unchecking removes every entry with that id.',
    'Placeholder entries that carry no id are left exactly as they are found.',
    'Which remix is currently selected lives in Loadouts, which is not touched here.',
  ],
});
