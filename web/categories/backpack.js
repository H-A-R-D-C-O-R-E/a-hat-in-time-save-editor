/**
 * Shared access to the backpack arrays (`MyBackpack2017`, and the pre-2017
 * `MyBackpack`), so categories for hats, flairs, badges, dyes, stickers… can all
 * speak the same language.
 *
 * Layout (from the sample saves)
 *
 *   MyBackpack2017 <BackpackInfo2017>   the current format
 *       Hats / Badges / Skins / Remixes / Filters / Weapons / Collectibles / Stickers
 *           each entry: { [ItemQualityInfo, ItemQualityInfoName,] [LastUseTime,] BackpackClass }
 *
 *   MyBackpack <BackpackInfo>           the pre-2017 format (only "1.0 Hundo.hat")
 *       Hats / Badges / Collectibles / Skins / Remixes
 *           each entry: { ItemQuality, LastUseTime, BackpackClass }
 *       no Weapons, Filters or Stickers list at all — that save predates them,
 *       so the categories that need one say so instead of inventing a field.
 *
 * Two things follow from that:
 *   - a *plain* entry (no ItemQualityInfoName) is an owned item with no cosmetic
 *     applied; every plain Hats entry carries LastUseTime in all 8 samples;
 *   - `ItemQuality` is a *rarity* (Hat_ItemQuality_Rare/Epic/Completionist or
 *     "None"), not a flair. Flairs only exist as ItemQualityInfo + Name, and only
 *     inside MyBackpack2017 — the pre-2017 format has no slot for them.
 */

export const BAG_NAMES = ['MyBackpack2017', 'MyBackpack'];

export const prop = (el, name) => el.properties.find((q) => q.name === name);
export const unqualify = (v) => (typeof v === 'string' ? v.split('.').pop() : undefined);

/** The bare class id of an entry, e.g. `Hat_Ability_Sprint`. */
export const classId = (el) => unqualify(prop(el, 'BackpackClass')?.value);

/** The flair id carried by an entry, or undefined for a plain entry. */
export const flairId = (el) => prop(el, 'ItemQualityInfoName')?.value;

/**
 * Find an array by name in whichever bag holds it.
 * @returns {{bagName: string, bag: object, arr: object} | null}
 */
export function locateArray(doc, arrayName) {
  for (const bagName of BAG_NAMES) {
    const bag = doc.properties.find((p) => p.name === bagName);
    if (!Array.isArray(bag?.value)) continue;
    const arr = bag.value.find((p) => p.name === arrayName);
    if (arr && Array.isArray(arr.value)) return { bagName, bag, arr };
  }
  return null;
}

/**
 * Like locateArray, but will create `arrayName` if the bag exists without it.
 * New lists are appended (that is where the samples put `Stickers`); pass
 * `'start'` for `Hats`, which every sample keeps at the front.
 * @returns {object | null} null when MyBackpack2017 is not present
 */
export function ensureArray(doc, arrayName, position = 'end') {
  const found = locateArray(doc, arrayName);
  if (found) return found;
  const bag = doc.properties.find((p) => p.name === 'MyBackpack2017' && Array.isArray(p.value));
  if (!bag) return null;
  const arr = { name: arrayName, type: 'ArrayProperty', arrayIndex: 0, elementType: 'struct', value: [] };
  if (position === 'start') bag.value.unshift(arr);
  else bag.value.push(arr);
  createdLists(doc).add(arrayName);
  return { bagName: 'MyBackpack2017', bag, arr };
}

/**
 * Take a list back out again if it is now empty *and* this session is the one
 * that put it there — so adding the first sticker and then removing it leaves
 * the save exactly as it started. A list the game itself wrote (even an empty
 * one) is never touched.
 *
 * @returns {boolean} whether the array was removed
 */
export function pruneCreatedList(doc, found) {
  if (found.arr.value.length > 0) return false;
  if (!createdLists(doc).has(found.arr.name)) return false;
  const at = found.bag.value.indexOf(found.arr);
  if (at < 0) return false;
  found.bag.value.splice(at, 1);
  createdLists(doc).delete(found.arr.name);
  return true;
}

/**
 * Can this save hold cosmetic info on its entries at all? True for anything in
 * MyBackpack2017, or for a MyBackpack array that already carries one.
 */
export function cosmeticCapable(found) {
  if (!found) return false;
  if (found.bagName === 'MyBackpack2017') return true;
  return found.arr.value.some((el) => flairId(el) !== undefined);
}

/** The package prefix used by this save's entries, e.g. `hatintimegamecontent`. */
export function packageOf(found) {
  for (const el of found?.arr.value ?? []) {
    const cls = prop(el, 'BackpackClass')?.value;
    if (typeof cls === 'string' && cls.includes('.')) return cls.split('.')[0];
  }
  return null;
}

/**
 * Qualified object paths, remembered per document.
 *
 * A save-only id (a mod's dye, weapon, sticker…) has a package we can only read
 * out of the entry while it is still there — and `set()` needs it again after
 * that entry has just been removed. Worse, the same bare id uses a *different*
 * package in different saves (`Xara_MaterialDye_AstralDye` is `radicaldyes2.` in
 * three samples and `raddyepack.` in another), so nothing may be guessed or
 * cached across documents: the map is keyed by the save being edited.
 */
const PATHS = new WeakMap();

/** Lists this session had to invent, per save — `set()` may take them back out. */
const CREATED = new WeakMap();

function createdLists(doc) {
  let set = CREATED.get(doc);
  if (!set) {
    set = new Set();
    CREATED.set(doc, set);
  }
  return set;
}

function pathsFor(doc) {
  let map = PATHS.get(doc);
  if (!map) {
    map = new Map();
    PATHS.set(doc, map);
  }
  return map;
}

/** Remember every object path in `arr` under the save `doc`, before it changes. */
export function rememberPaths(doc, arr) {
  const map = pathsFor(doc);
  for (const el of arr.value) {
    const cls = prop(el, 'BackpackClass')?.value;
    if (typeof cls === 'string') map.set(unqualify(cls), cls);
  }
}

/**
 * Bare id -> the object path to write for it: the catalog's if it has one,
 * otherwise whatever path this save already uses for that id (looking at the
 * live array first, then at everything we have seen in this save), otherwise
 * `<package>.<id>`.
 *
 * @param {object} doc            the save being edited
 * @param {string} id             bare id, e.g. `Hat_Ability_Sprint`
 * @param {object} catalog        id -> qualified object path
 * @param {object|null} found     result of locateArray/ensureArray
 * @param {string} fallbackPkg    package to assume when nothing is observed
 */
export function resolveObject(doc, id, catalog, found, fallbackPkg) {
  if (catalog?.[id]) return catalog[id];
  for (const el of found?.arr.value ?? []) {
    const cls = prop(el, 'BackpackClass')?.value;
    if (typeof cls === 'string' && cls.split('.').pop() === id) return cls;
  }
  return pathsFor(doc).get(id) ?? `${packageOf(found) ?? fallbackPkg}.${id}`;
}

/**
 * The per-element `class` a save writes for its struct entries
 * (`hatintimegamecontent.Hat_LoadoutBackpackItem` for Hats, …).
 * The pre-2017 save has none, in which case this returns undefined and no
 * `class` is written — exactly like the array already looks.
 */
function classOf(arr) {
  for (const el of arr.value) {
    if ('class' in el) return el.class;
  }
  return undefined;
}

/**
 * Build a plain (no-flair) entry for an owned item by cloning a plain entry that
 * already exists, so the class, field set and types match the save exactly.
 * Falls back to a bare LastUseTime + BackpackClass if the array has none.
 */
export function buildPlainEntry(arr, qualifiedId) {
  // Only an entry that actually carries an id can be a template: CDLC1 stores
  // 296 placeholder remixes with no properties at all, and cloning one of those
  // would produce a new entry with nothing in it.
  const plain = arr.value.filter(
    (el) => flairId(el) === undefined && prop(el, 'BackpackClass') !== undefined
  );
  const source = plain[0];

  if (source) {
    const clone = { ...source, properties: source.properties.map((p) => ({ ...p })) };
    const cls = prop(clone, 'BackpackClass');
    if (cls) cls.value = qualifiedId;
    // `ItemQuality` is a rarity; a freshly granted item has none.
    const quality = prop(clone, 'ItemQuality');
    if (quality) quality.value = 'None';
    return clone;
  }

  let lastUse = 0;
  for (const el of arr.value) {
    const t = prop(el, 'LastUseTime')?.value;
    if (typeof t === 'number' && t > lastUse) lastUse = t;
  }
  const entry = {
    properties: [
      { name: 'LastUseTime', type: 'IntProperty', arrayIndex: 0, value: lastUse },
      { name: 'BackpackClass', type: 'ObjectProperty', arrayIndex: 0, value: qualifiedId },
    ],
  };
  const cls = classOf(arr);
  if (cls !== undefined) entry.class = cls;
  return entry;
}

/**
 * Build an entry for an item this save is gaining, by cloning a real entry that
 * this save already has so the class, field set and types match exactly.
 *
 * The source is the target array when it has anything to copy, and otherwise a
 * *sibling* list in the same bag — that is what makes it possible to add the
 * first sticker (or the first weapon) to a save that has never had one, without
 * guessing whether the entry wants LastUseTime or not. Observed shapes:
 *
 *   MyBackpack2017    { class: "…Hat_BackpackItem", properties: [BackpackClass] }
 *   MyBackpack        { properties: [ItemQuality, LastUseTime, BackpackClass] }
 */
export function buildOwnedEntry(found, qualifiedId) {
  const target = found.arr;
  const hasEntry = (a) => a.value.some((el) => prop(el, 'BackpackClass') !== undefined);

  if (hasEntry(target)) return buildPlainEntry(target, qualifiedId);

  // Badges first: they are the plainest list, and every sample save has one.
  for (const name of ['Badges', 'Skins', 'Weapons', 'Remixes', 'Filters', 'Hats']) {
    if (name === target.name) continue;
    const sibling = found.bag.value.find((p) => p.name === name && Array.isArray(p.value));
    if (sibling && hasEntry(sibling)) return buildPlainEntry(sibling, qualifiedId);
  }

  return buildPlainEntry(target, qualifiedId);
}

/**
 * Build a flair entry. Mirrors the 5 real entries in `Deathwish.hat` that carry
 * no LastUseTime, so we never invent one — a freshly added cosmetic has, after
 * all, never been used.
 */
export function buildCosmeticEntry(arr, { object, name, hatObject }) {
  const properties = [];
  // Keep `ItemQuality` first if this save still uses the legacy rarity field.
  if (arr.value.some((el) => prop(el, 'ItemQuality') !== undefined)) {
    properties.push({ name: 'ItemQuality', type: 'ObjectProperty', arrayIndex: 0, value: 'None' });
  }
  properties.push(
    { name: 'ItemQualityInfo', type: 'ObjectProperty', arrayIndex: 0, value: object },
    { name: 'ItemQualityInfoName', type: 'NameProperty', arrayIndex: 0, value: name },
    { name: 'BackpackClass', type: 'ObjectProperty', arrayIndex: 0, value: hatObject }
  );
  const entry = { properties };
  const cls = classOf(arr);
  if (cls !== undefined) entry.class = cls;
  return entry;
}
