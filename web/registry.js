/**
 * Category registry — one entry per editable section of the save.
 *
 * To add a category later:
 *   1. create web/categories/<id>.js exporting a default object with the API below
 *   2. import it here and append it to CATEGORIES
 *
 * A plain "one entry per unlocked item" list (Dyes, Weapons, Stickers, …) needs
 * no new code at all: add its section to BACKPACK_LISTS in
 * tools/build-web-data.js, run `npm run build`, then export
 * `backpackList({...})` from ./categories/backpack-list.js.
 *
 * Category API
 *   id          string   stable key, also the URL hash (`#/badges`)
 *   title       string   sidebar label
 *   blurb       string   one-line explanation shown above the list
 *   rows(doc)   Row[]    every editable row for this save
 *   groupTitle(key)      display name for a group key
 *   compareGroups(a, b)  sort order for group keys
 *   set(doc, id, value)  mutate the decoded save; returns true if it changed
 *   setField(doc, id, key, value)  optional: mutate one field of a row whose
 *                        state is more than one checkbox
 *   explain(id, value)   optional: what a toggle writes to the file
 *   banner(doc)          optional: string shown above the list (null when fine)
 *   filters              optional: which of all/collected/uncollected/absent to
 *                        offer; defaults to all four
 *   notes                optional: string[] shown in the "writes to the file" panel
 *
 * Row
 *   { id, label, group, checked, fields?, present?, mod?, note?, disabled? }
 *
 * `present` (optional) marks rows that exist in this save at all — when any row
 * is false the "Not in this save" filter chip appears. Leave it off for categories
 * where "absent" and "unchecked" would mean the same thing.
 *
 * `disabled` greys a row out and makes the checkbox inert; use it together with
 * `banner()` to explain why a save cannot be edited in this category.
 *
 * A row whose state is a single flag just sets `checked` — that is what the
 * filter chips, the tally and the "n / m collected" counts read. A row that is
 * really several fields (the three stamps of a death wish) keeps `checked` as
 * "any of them is on" and adds
 *
 *   fields: [{ key, label, text?, type: 'checkbox' | 'number', value, min? }]
 *
 * plus a matching `setField(doc, id, key, value)`. The shell renders one control
 * per field instead of the single box and counts a row as changed when *any*
 * field differs from the baseline taken when the file was loaded. A `number`
 * field is handed a number — or `null` when the box was emptied or held
 * something unreadable, which should be refused rather than read as a zero.
 * `min` (default 0) and `step` (default 1) bound the spinner.
 *
 * Shares helper code in `./categories/backpack.js` for anything stored in
 * MyBackpack / MyBackpack2017 (hats, flairs, badges, dyes, stickers, …).
 */
import timePieces from './categories/time-pieces.js';
import deathwishes from './categories/deathwishes.js';
import hats from './categories/hats.js';
import hatFlairs from './categories/hat-flairs.js';
import badges from './categories/badges.js';
import dyes from './categories/dyes.js';
import stickers from './categories/stickers.js';
import weapons from './categories/weapons.js';
import remixes from './categories/remixes.js';
import filters from './categories/filters.js';
import backpackItems from './categories/backpack-items.js';
import more from './categories/more.js';

export const CATEGORIES = [
  timePieces,
  deathwishes,
  hats,
  hatFlairs,
  badges,
  dyes,
  stickers,
  weapons,
  remixes,
  filters,
  backpackItems,
  more,
];
