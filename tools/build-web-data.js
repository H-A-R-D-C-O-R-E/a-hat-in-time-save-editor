#!/usr/bin/env node
/**
 * Generates the static data modules the web editor imports.
 *
 *   node tools/build-web-data.js
 *
 * Inputs
 *   Collectibles.txt  the hand-maintained list of every collectible
 *   *.hat             the sample saves (used only to harvest metadata)
 *
 * Outputs
 *   web/data/collectibles.js   every section of Collectibles.txt, in order
 *   web/data/time-pieces.js    chapter grouping + element templates for time pieces
 *   web/data/hats.js           hat/flair object paths + the flair -> hat mapping
 *   web/data/backpack.js       LISTS: order + object path for every backpack
 *                              list (badges, collectibles, dyes, filters,
 *                              remixes, stickers, weapons)
 *   web/data/more.js           the challenge roads and contract ids of
 *                              Collectibles.txt, plus the vanilla secret level
 *                              ids, ActBits flags and contract paths harvested
 *                              from the sample saves (mod-made rifts held back)
 *
 * Re-run this whenever Collectibles.txt changes (`npm run build` / `npm run web`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode } from '../src/hat.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT_DIR = path.join(ROOT, 'web', 'data');

const prop = (el, name) => el.properties.find((q) => q.name === name);
const boolOf = (el, name) => {
  const p = prop(el, name);
  return p ? !!p.value : false;
};

function parseCollectibles(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const order = [];
  const sections = new Map();
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') { current = null; continue; }
    const isHeader = i === 0 || lines[i - 1].trim() === '';
    if (isHeader) {
      const name = line.replace(/:$/, '');
      if (!sections.has(name)) { sections.set(name, []); order.push(name); }
      current = name;
      continue;
    }
    if (current) sections.get(current).push(line.replace(/^\d+:\s*/, ''));
  }
  return { order, sections };
}

const { order: SECTION_ORDER, sections } = parseCollectibles(path.join(ROOT, 'Collectibles.txt'));
const knownIds = sections.get('Time Pieces') ?? [];

// ---------------------------------------------------------------- harvest ----

const chapterOf = new Map();  // time piece id -> SpeedrunTimeObjects.ChapterName
const templates = new Map();  // time piece id -> normalised TimeObjects element

/**
 * The tables the "More" category offers. Collectibles.txt has no section for
 * secret levels or ActBits (they are not collectibles), so their ids come from
 * the saves themselves — every id any sample carries, plus the qualified object
 * path each contract is written with.
 *
 * One exception: a `Mod:<id>:<name>` secret level belongs to the content pack
 * that made it, so it is held out of the catalog. Rows are "catalog ∪ whatever
 * this save carries", so a modded save still lists its own rifts — tagged "mod"
 * — and can take them away again, while an unmodded save is not shown a row for
 * a rift it can never reach.
 */
const secretLevels = new Set();      // UnlockedSecretLevels[] entries
const actFlags = new Set();          // ActBits[].IdName values
const contractPathOf = new Map();    // bare contract id -> path as written in saves
const CONTRACT_LISTS = [
  'SnatcherContracts',
  'CompletedSnatcherContracts',
  'TurnedInSnatcherContracts',
];

const samples = fs.readdirSync(ROOT).filter((f) => f.endsWith('.hat')).sort();
let decoded = 0;

for (const name of samples) {
  let doc;
  try {
    doc = decode(new Uint8Array(fs.readFileSync(path.join(ROOT, name))));
  } catch (err) {
    console.warn(`  ! skipping ${name}: ${err.message}`);
    continue;
  }
  decoded += 1;

  const speedrun = doc.properties.find((p) => p.name === 'SpeedrunTimeObjects');
  if (Array.isArray(speedrun?.value)) {
    for (const el of speedrun.value) {
      const id = prop(el, 'Id')?.value;
      const chapter = prop(el, 'ChapterName')?.value;
      if (id && chapter && !chapterOf.has(id)) chapterOf.set(id, chapter);
    }
  }

  const timeObjects = doc.properties.find((p) => p.name === 'TimeObjects');
  if (Array.isArray(timeObjects?.value)) {
    for (const el of timeObjects.value) {
      const id = prop(el, 'Id')?.value;
      if (!id) continue;
      const seen = {
        IsAct: boolOf(el, 'IsAct'),
        Paid: boolOf(el, 'Paid'),
        HighScore: Number(prop(el, 'Highscore')?.value ?? prop(el, 'HighScore')?.value ?? 0),
        IsMod: prop(el, 'IsMod') ? !!prop(el, 'IsMod').value : null,
        ModPackage: prop(el, 'ModPackage') ? String(prop(el, 'ModPackage').value ?? '') : null,
      };
      const prev = templates.get(id);
      // keep whichever record is the most complete (older saves lack IsMod/ModPackage)
      const merged = prev
        ? {
            IsAct: prev.IsAct ?? seen.IsAct,
            Paid: prev.Paid ?? seen.Paid,
            HighScore: prev.HighScore ?? seen.HighScore,
            IsMod: seen.IsMod ?? prev.IsMod,
            ModPackage: seen.ModPackage ?? prev.ModPackage,
          }
        : seen;
      templates.set(id, merged);
    }
  }

  const secrets = doc.properties.find((p) => p.name === 'UnlockedSecretLevels');
  if (Array.isArray(secrets?.value)) {
    for (const value of secrets.value) {
      if (typeof value === 'string' && value) secretLevels.add(value);
    }
  }

  const actBits = doc.properties.find((p) => p.name === 'ActBits');
  if (Array.isArray(actBits?.value)) {
    for (const el of actBits.value) {
      const id = prop(el, 'IdName')?.value;
      if (typeof id === 'string' && id) actFlags.add(id);
    }
  }

  for (const name of CONTRACT_LISTS) {
    const list = doc.properties.find((p) => p.name === name);
    if (!Array.isArray(list?.value)) continue;
    for (const value of list.value) {
      // "None" shows up bare in one save's completed list; only a real path
      // (package.id) tells us which package this save writes contracts with.
      if (typeof value === 'string' && value.includes('.')) {
        contractPathOf.set(value.split('.').pop(), value);
      }
    }
  }
}

/** Heuristic used only if an id was never observed in any sample save. */
const looksLikeRift = (id) => /^(TimeRift|Spaceship)_/.test(id);

const TIME_TEMPLATES = {};
for (const id of knownIds) {
  const t = templates.get(id);
  TIME_TEMPLATES[id] = {
    IsAct: t?.IsAct ?? !looksLikeRift(id),
    Paid: t?.Paid ?? false,
    HighScore: t?.HighScore ?? 0,
    IsMod: t?.IsMod ?? id.startsWith('Mod:'),
    ModPackage: t?.ModPackage ?? '',
  };
}

const TIME_CHAPTERS = {};
for (const id of knownIds) TIME_CHAPTERS[id] = chapterOf.get(id) ?? null;

// ------------------------------------------------ hats, flairs, simple lists --

/**
 * The backpack lists: one entry per item. `section` is where the ids live in
 * Collectibles.txt; `array` is the property they live in inside <bag>.  Note
 * Dyes are stored as `Skins` and camera filters as `Filters`. Collectibles (the
 * "Backpack" section) shares the entry shape minus one thing — a count — which
 * is why it gets its own category rather than the factory.
 */
const BACKPACK_LISTS = [
  { key: 'badges', array: 'Badges', section: 'Badges' },
  // Not a plain list — Backpack items carry a count — but the ids and their
  // object paths are harvested exactly the same way, for
  // web/categories/backpack-items.js to consume.
  { key: 'collectibles', array: 'Collectibles', section: 'Backpack' },
  { key: 'dyes', array: 'Skins', section: 'Dyes/Paintables' },
  { key: 'filters', array: 'Filters', section: 'Camera Filters' },
  { key: 'remixes', array: 'Remixes', section: 'Remixes' },
  { key: 'stickers', array: 'Stickers', section: 'Stickers' },
  { key: 'weapons', array: 'Weapons', section: 'Weapons' },
];

const knownHats = sections.get('Hats') ?? [];
const knownFlairs = sections.get('Hat Flairs') ?? [];

/** A backpack array lives in MyBackpack2017 (current) or MyBackpack (pre-2017). */
function locateBagArray(doc, arrayName) {
  for (const bagName of ['MyBackpack2017', 'MyBackpack']) {
    const bag = doc.properties.find((p) => p.name === bagName);
    if (!Array.isArray(bag?.value)) continue;
    const arr = bag.value.find((p) => p.name === arrayName);
    if (Array.isArray(arr?.value)) return { bagName, arr };
  }
  return null;
}

const unqualify = (v) => (typeof v === 'string' ? v.split('.').pop() : undefined);
const hatObjectOf = new Map();    // hat id  -> qualified object path as written in saves
const flairObjectOf = new Map();  // flair id -> qualified object path as written in saves
const flairHatOf = new Map();     // flair id -> hat id it is observed attached to
const packageOf = new Map();      // bare package name -> times seen

/** list key -> (bare id -> qualified object path as written in saves) */
const listObjectOf = new Map(BACKPACK_LISTS.map(({ key }) => [key, new Map()]));

for (const name of samples) {
  let doc;
  try {
    doc = decode(new Uint8Array(fs.readFileSync(path.join(ROOT, name))));
  } catch {
    continue;
  }

  for (const { key, array } of BACKPACK_LISTS) {
    for (const el of locateBagArray(doc, array)?.arr.value ?? []) {
      const cls = prop(el, 'BackpackClass')?.value;
      if (typeof cls === 'string') listObjectOf.get(key).set(unqualify(cls), cls);
    }
  }

  const found = locateBagArray(doc, 'Hats');
  if (!found) continue;
  for (const el of found.arr.value) {
    const cls = prop(el, 'BackpackClass')?.value;
    if (typeof cls === 'string') {
      hatObjectOf.set(unqualify(cls), cls);
      packageOf.set(cls.split('.')[0], (packageOf.get(cls.split('.')[0]) ?? 0) + 1);
    }
    const flairName = prop(el, 'ItemQualityInfoName')?.value;
    if (typeof flairName === 'string') {
      const info = prop(el, 'ItemQualityInfo')?.value;
      flairObjectOf.set(flairName, typeof info === 'string' ? info : undefined);
      if (typeof cls === 'string') flairHatOf.set(flairName, unqualify(cls));
    }
  }
}

/**
 * Fallback for a flair no sample save carries (only `..._Help_Speedrun` today).
 * The cosmetic id embeds the hat it belongs to; order matters — `IceFox` must be
 * matched as Ice before FoxMask.
 */
function guessFlairHat(flair) {
  if (/Sprint/.test(flair)) return 'Hat_Ability_Sprint';
  if (/Chemical/.test(flair)) return 'Hat_Ability_Chemical';
  if (/Ice/.test(flair)) return 'Hat_Ability_StatueFall';
  if (/FoxMask/.test(flair)) return 'Hat_Ability_FoxMask';
  if (/TimeStop/.test(flair)) return 'Hat_Ability_TimeStop';
  if (/Help/.test(flair)) return 'Hat_Ability_Help';
  return null;
}

const PACKAGE = [...packageOf].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'hatintimegamecontent';

const HAT_OBJECTS = {};
for (const id of knownHats) HAT_OBJECTS[id] = hatObjectOf.get(id) ?? `${PACKAGE}.${id}`;

/** Every simple list, ready for web/categories/backpack-list.js to consume. */
const LISTS = {};
for (const { key, array, section } of BACKPACK_LISTS) {
  const order = sections.get(section);
  if (!order) throw new Error(`Collectibles.txt has no "${section}" section`);
  const objects = {};
  for (const id of order) objects[id] = listObjectOf.get(key).get(id) ?? `${PACKAGE}.${id}`;
  LISTS[key] = { array, order, objects };
}

const FLAIR_OBJECTS = {};
const unmapped = [];
for (const id of knownFlairs) {
  const hat = flairHatOf.get(id) ?? guessFlairHat(id);
  if (!hat) { unmapped.push(id); continue; }
  FLAIR_OBJECTS[id] = { hat, object: flairObjectOf.get(id) ?? `${PACKAGE}.${id}` };
}
if (unmapped.length) throw new Error(`cannot place flairs on a hat: ${unmapped.join(', ')}`);

// The guessed mapping must agree with what the saves actually contain.
for (const [id, rec] of Object.entries(FLAIR_OBJECTS)) {
  const observed = flairHatOf.get(id);
  if (observed && observed !== rec.hat) {
    throw new Error(`flair ${id}: saves say ${observed}, guess said ${rec.hat}`);
  }
}

// ------------------------------------------------------------------ write ----

fs.mkdirSync(OUT_DIR, { recursive: true });

function emit(file, banner, exports) {
  const body = Object.entries(exports)
    .map(([name, value]) => `export const ${name} = ${JSON.stringify(value, null, 2)};\n`)
    .join('\n');
  fs.writeFileSync(file, `${banner}\n\n${body}`);
  console.log(`  -> ${path.relative(ROOT, file)}  (${(fs.statSync(file).size / 1024).toFixed(1)} kB)`);
}

const BANNER = '// Generated by tools/build-web-data.js — do not edit by hand.\n// Run `npm run build` after changing Collectibles.txt.';

emit(path.join(OUT_DIR, 'collectibles.js'), BANNER, {
  SECTION_ORDER,
  SECTIONS: Object.fromEntries(SECTION_ORDER.map((k) => [k, sections.get(k)])),
});

emit(path.join(OUT_DIR, 'time-pieces.js'), BANNER, {
  ORDER: knownIds,
  CHAPTERS: TIME_CHAPTERS,
  TEMPLATES: TIME_TEMPLATES,
});

emit(path.join(OUT_DIR, 'hats.js'), BANNER, {
  ORDER: knownHats,
  OBJECTS: HAT_OBJECTS,
  FLAIR_ORDER: knownFlairs,
  FLAIR_OBJECTS,
});

emit(path.join(OUT_DIR, 'backpack.js'), BANNER, { LISTS });

const CONTRACT_ORDER = sections.get('Snatcher Contracts');
if (!Array.isArray(CONTRACT_ORDER) || CONTRACT_ORDER.length === 0) {
  throw new Error('Collectibles.txt has no usable "Snatcher Contracts" section');
}

/**
 * Challenge roads are the one list that is only ever read out of
 * Collectibles.txt: a road is a chain of Steam Workshop ids joined with
 * underscores, and a save may well carry one the file does not list (it still
 * becomes a row, from the save itself) — but nothing is harvested into the
 * catalog from a save, so no road is ever offered to a save that has none.
 */
const CHALLENGE_ROADS = (sections.get('Challenge Roads') ?? [])
  .filter((road) => /^\d+(_\d+)*$/.test(road));
if (CHALLENGE_ROADS.length === 0) {
  throw new Error('Collectibles.txt has no usable "Challenge Roads" section');
}

// Mod-made secret levels are left out of the catalog (see the harvest note) —
// a save that carries one still gets it as a row from its own list.
let offeredSecretLevels = [...secretLevels]
  .filter((id) => !id.startsWith('Mod:'))
  .sort();
let offeredActFlags = [...actFlags].sort();
let offeredContractObjects = Object.fromEntries(
  [...contractPathOf].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
);

/**
 * Fallback catalog for when no sample saves were on disk (`decoded === 0`).
 * Secret levels and ActBits live nowhere except in saves, so a build without
 * any save to harvest from would otherwise emit empty lists — and the web
 * editor would have no locked vanilla rift to offer. These are the vanilla
 * ids observed in real saves (a hundo file carries exactly these 10 secret
 * levels; the flags are the global ones it tracks, plus `hasenteredwater`
 * which older saves track), with contracts qualified the way every save on
 * disk writes them. A build *with* saves still harvests everything from the
 * saves themselves and ignores this table.
 */
if (decoded === 0) {
  console.warn('  ! no sample saves found — using the built-in vanilla catalog');
  offeredSecretLevels = [
    'Cruise_CaveRift_Aquarium',
    'Metro_CaveRift_RumbiFactory',
    'Sands_PurpleRiftSandSails',
    'SandsSkiesPurple',
    'TimeRift_Cave_Alps',
    'TimeRift_Cave_BirdBasement',
    'TimeRift_Cave_CampPurpleRift',
    'TimeRift_Cave_Mafia',
    'TimeRift_Cave_Raccoon',
    'Witch_Dream',
  ];
  offeredActFlags = [
    'deathwishfirstlevelintro',
    'deathwishfirsttimeinit',
    'hasenteredwater',
    'mirrormodeactlock',
    'totalavailablerifttokens',
    'uncollectedpons',
    'uncollectedrifttokens',
  ];
  offeredContractObjects = Object.fromEntries(
    CONTRACT_ORDER.map((id) => [id, `hatintimegamecontent.${id}`])
  );
}

emit(path.join(OUT_DIR, 'more.js'), BANNER, {
  SECRET_LEVELS: offeredSecretLevels,
  ACT_FLAGS: offeredActFlags,
  CONTRACT_ORDER,
  CHALLENGE_ROADS,
  CONTRACT_OBJECTS: offeredContractObjects,
});

console.log(
  `\n${decoded}/${samples.length} sample saves read — ` +
    `${knownIds.length} known time pieces, ` +
    `${Object.values(TIME_CHAPTERS).filter(Boolean).length} with a chapter, ` +
    `${Object.keys(TIME_TEMPLATES).length} templates.\n` +
    `${knownHats.length} hats (package "${PACKAGE}"), ${knownFlairs.length} hat flairs — ` +
    `${Object.keys(FLAIR_OBJECTS).length} placed on a hat, ` +
    `${flairHatOf.size} observed in saves.\n` +
    BACKPACK_LISTS.map(({ key, array, section }) => {
      const n = sections.get(section).length;
      const seen = listObjectOf.get(key).size;
      return `  ${key.padEnd(9)} ${String(n).padStart(3)} ids in "${section}" -> <bag>.${array}` +
        ` (${seen} observed in saves)`;
    }).join('\n') +
    `\n  more      ${offeredSecretLevels.length} secret levels ` +
    `(${Math.max(secretLevels.size - offeredSecretLevels.length, 0)} mod ids held back), ` +
    `${offeredActFlags.length} ActBits flags, ` +
    `${CONTRACT_ORDER.length} contracts (${Object.keys(offeredContractObjects).length} paths observed), ` +
    `${CHALLENGE_ROADS.length} challenge roads`
);
