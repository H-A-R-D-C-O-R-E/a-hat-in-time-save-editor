import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode } from '../src/hat.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ---------- Collectibles.txt ---------- */
const raw = fs.readFileSync(path.join(DIR, 'Collectibles.txt'), 'utf8').split(/\r?\n/);
const sections = new Map();
let current = null;
for (let i = 0; i < raw.length; i++) {
  const line = raw[i].trim();
  if (line === '') { current = null; continue; }
  if ((i === 0 || raw[i - 1].trim() === '') && current === null) {
    current = line.replace(/:$/, '');
    sections.set(current, []);
    continue;
  }
  sections.get(current).push(line);
}
const listed = new Map();                       // section -> Set of entries
for (const [k, v] of sections) listed.set(k, new Set(v));
const everything = new Set();
for (const v of sections.values()) for (const e of v) everything.add(e.replace(/^\d+:\s*/, ''));

/* ---------- saves ---------- */
const hits = new Map();
const add = (k, v) => { if (typeof v === 'string' && v !== '') (hits.get(k) ?? hits.set(k, new Set()).get(k)).add(v); };
function walk(props, scope) {
  for (const p of props) {
    if (p.type === 'StrProperty' || p.type === 'NameProperty' || p.type === 'ObjectProperty') {
      add(`${scope}.${p.name}`, p.value);
      if (p.properties) walk(p.properties, `${scope}.${p.name}`);
    } else if (p.type === 'StructProperty') walk(p.value, `${scope}.${p.name}`);
    else if (p.type === 'ArrayProperty') {
      if (p.elementType === 'string') for (const v of p.value) add(`${scope}.${p.name}`, v);
      else if (p.elementType === 'struct') for (const el of p.value) walk(el.properties, `${scope}.${p.name}`);
    }
  }
}
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.hat')).sort()) {
  walk(decode(new Uint8Array(fs.readFileSync(path.join(DIR, f)))).properties, '');
}

const bare = (s) => s.includes('.') ? s.slice(s.lastIndexOf('.') + 1) : s;
// anything qualified by a package other than the game's own package is mod content
const isMod = (s) => s.startsWith('Mod:') || (s.includes('.') && !s.includes(':') && !s.startsWith('hatintimegamecontent.'));
const pkg = (s) => s.includes('.') && !s.includes(':') ? s.slice(0, s.lastIndexOf('.')) : '(timepiece ids)';
// container classes of inline loadout objects — not items in their own right
const CONTAINER = new Set(['Hat_BackpackItem', 'Hat_LoadoutBackpackItem', 'Hat_CollectibleBackpackItem', 'None']);

// bare names that we only ever saw behind a mod package
const modBare = new Set();
for (const set of hits.values()) for (const v of set) if (isMod(v) && v.includes('.') && !v.includes(':')) modBare.add(bare(v));

/* ---------- section-by-section ---------- */
const MAP = [
  ['Hats',              ['.MyBackpack.Hats.BackpackClass', '.MyBackpack2017.Hats.BackpackClass', '.Loadouts.hat.BackpackClass']],
  ['Hat Flairs',        ['.MyBackpack2017.Hats.ItemQualityInfoName']],
  ['Badges',            ['.MyBackpack.Badges.BackpackClass', '.MyBackpack2017.Badges.BackpackClass', '.Loadouts.Badges.BackpackClass']],
  ['Time Pieces',       ['.TimeObjects.Id', '.SpeedrunTimeObjects.Id']],
  ['Weapons',           ['.MyBackpack.Weapon', '.MyBackpack2017.Weapons.BackpackClass', '.Loadouts.Weapon']],
  ['Dyes/Paintables',   ['.MyBackpack.Skins.BackpackClass', '.MyBackpack2017.Skins.BackpackClass']],
  ['Remixes',           ['.MyBackpack.Remixes.BackpackClass', '.MyBackpack2017.Remixes.BackpackClass']],
  ['Backpack',          ['.MyBackpack.Collectibles.BackpackClass', '.MyBackpack2017.Collectibles.BackpackClass']],
  ['Stickers',          ['.MyBackpack2017.Stickers.BackpackClass']],
  ['Camera Filters',    ['.MyBackpack2017.Filters.BackpackClass']],
  ['Deathwishes',       ['.SnatcherContracts', '.CompletedSnatcherContracts', '.TurnedInSnatcherContracts']],
];

console.log('### A. values the saves contain, but your section does not (vanilla content only)\n');
for (const [section, paths] of MAP) {
  const have = new Set();
  for (const p of paths) for (const v of hits.get(p) ?? []) if (v !== 'None' && !CONTAINER.has(bare(v)) && !isMod(v) && !modBare.has(bare(v))) have.add(v);
  const missing = [...have].filter((v) => !everything.has(bare(v)) && !everything.has(v) && !modBare.has(bare(v))).sort();
  const modded = [...(hits.get(paths[0]) ?? [])].filter(isMod).length;
  console.log(`  ${section}: ${have.size} vanilla in saves, ${missing.length} not listed${modded ? ` (+${modded} modded, ignored)` : ''}`);
  for (const m of missing) console.log(`        MISSING  ${bare(m)}      [${pkg(m)}]`);
  console.log('');
}

/* ---------- challenge roads (order independent) ---------- */
const listedRoads = new Set([...(listed.get('Challenge Roads') ?? [])].map((e) => e.replace(/^\d+:\s*/, '').split('_').sort().join('_')));
const saveRoads = new Set([...(hits.get('.ChallengeRoadIDs') ?? [])].map((e) => e.split('_').sort().join('_')));
const roadsInSavesNotListed = [...saveRoads].filter((r) => !listedRoads.has(r));
const roadsListedNotInSaves = [...listedRoads].filter((r) => !saveRoads.has(r));
console.log(`### B. Challenge Roads  (compared as unordered sets — the save stores them reversed)`);
console.log(`  listed: ${listedRoads.size}   in saves: ${saveRoads.size}`);
console.log(`  in a save but not listed : ${roadsInSavesNotListed.length}`);
for (const r of roadsInSavesNotListed) console.log(`        ${r.split('_').join('_')}`);
console.log(`  listed but in no save    : ${roadsListedNotInSaves.length}`);
console.log('');

/* ---------- list entries that appear nowhere (possible typos) ---------- */
console.log('### C. list entries never seen in any save — suspicious?\n');
const saveValues = new Set();
for (const set of hits.values()) for (const v of set) { saveValues.add(v); saveValues.add(bare(v)); }
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 6) return Infinity;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}
const saveList = [...saveValues].filter((v) => v.length > 8);

for (const [section, entries] of sections) {
  if (section === 'Challenge Roads') continue;
  const orphans = entries.filter((e) => !saveValues.has(e) && !saveValues.has(bare(e)));
  if (!orphans.length) continue;
  console.log(`  ${section} (${orphans.length}):`);
  for (const o of orphans) {
    let best = null, bestD = 4;                    // only report near-misses (<= 3 edits)
    for (const v of saveList) {
      const d = editDistance(o.toLowerCase(), v.toLowerCase());
      if (d < bestD) { bestD = d; best = v; }
    }
    console.log(`      ${o}${best ? `\n           save has: ${best}   (${bestD} edit${bestD === 1 ? '' : 's'})` : '   (no near match)'}`);
  }
}
