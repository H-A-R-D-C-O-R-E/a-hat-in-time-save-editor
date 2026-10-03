import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode } from '../src/hat.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = fs.readdirSync(DIR).filter((x) => x.endsWith('.hat')).sort();

/* ---- list ---- */
const rawL = fs.readFileSync(path.join(DIR, 'Collectibles.txt'), 'utf8').split(/\r?\n/);
const sections = new Map();
let cur = null;
for (let i = 0; i < rawL.length; i++) {
  const line = rawL[i].trim();
  if (line === '') { cur = null; continue; }
  if ((i === 0 || rawL[i - 1].trim() === '') && cur === null) { cur = line.replace(/:$/, ''); sections.set(cur, []); continue; }
  sections.get(cur).push(line.replace(/^\d+:\s*/, ''));
}

/* ---- saves ---- */
const bare = (s) => (s.includes('.') ? s.slice(s.lastIndexOf('.') + 1) : s);
const isMod = (s) => s.startsWith('Mod:') || (s.includes('.') && !s.includes(':') && !s.startsWith('hatintimegamecontent.'));
const pkg = (s) => (s.includes('.') && !s.includes(':') ? s.slice(0, s.lastIndexOf('.')) : '');

const perFile = new Map();
for (const f of files) {
  const doc = decode(new Uint8Array(fs.readFileSync(path.join(DIR, f))));
  const bag = new Map();                       // path-substring -> Map(bare -> {files:Set, full:Set})
  (function walk(props, scope) {
    for (const p of props) {
      const here = `${scope}.${p.name}`;
      const put = (v) => {
        if (typeof v !== 'string' || v === '') return;
        const m = bag.get(here) ?? bag.set(here, new Map()).get(here);
        const b = bare(v);
        const e = m.get(b) ?? { files: new Set(), full: new Set(), mod: false };
        e.files.add(f); e.full.add(v); if (isMod(v)) e.mod = true;
        m.set(b, e);
      };
      if (p.type === 'ArrayProperty') {
        if (p.elementType === 'string') p.value.forEach(put);
        else if (p.elementType === 'struct') p.value.forEach((el) => walk(el.properties, here));
      } else if (p.type === 'StructProperty' && Array.isArray(p.value)) walk(p.value, here);
      if (typeof p.value === 'string') put(p.value);
      if (p.properties) walk(p.properties, here);
    }
  })(doc.properties, '');
  perFile.set(f, bag);
}

const CATEGORIES = [
  ['Hats',              ['.Hats.BackpackClass'],                                ['Hats']],
  ['Hat Flairs',        ['.Hats.ItemQualityInfoName'],                          ['Hat Flairs']],
  ['Badges',            ['.Badges.BackpackClass'],                              ['Badges']],
  ['Time Pieces',       ['.TimeObjects.Id'],                                    ['Time Pieces']],
  ['Weapons',           ['.Weapons.BackpackClass', '.MyBackpack.Weapon'],       ['Weapons']],
  ['Dyes/Paintables',   ['.Skins.BackpackClass'],                               ['Dyes/Paintables']],
  ['Remixes',           ['.Remixes.BackpackClass'],                             ['Remixes']],
  ['Backpack',          ['.Collectibles.BackpackClass'],                        ['Backpack', 'Decorations']],
  ['Stickers',          ['.Stickers.BackpackClass'],                            ['Stickers']],
  ['Camera Filters',    ['.Filters.BackpackClass'],                             ['Camera Filters']],
  ['Deathwishes',       ['.SnatcherContracts', '.CompletedSnatcherContracts',
                         '.TurnedInSnatcherContracts'],                         ['Deathwishes']],
];

const allListed = new Set();
for (const v of sections.values()) for (const e of v) allListed.add(e);

for (const [label, pathSubs, listSections] of CATEGORIES) {
  const saveVals = new Map();                          // bare -> {files, full, mod}
  for (const bag of perFile.values()) {
    for (const [pathKey, m] of bag) {
      if (!pathSubs.some((s) => pathKey.endsWith(s))) continue;
      for (const [b, e] of m) {
        const cur = saveVals.get(b) ?? { files: new Set(), full: new Set(), mod: true };
        e.files.forEach((x) => cur.files.add(x));
        e.full.forEach((x) => cur.full.add(x));
        cur.mod = cur.mod && e.mod;
        saveVals.set(b, cur);
      }
    }
  }
  const vanilla = [...saveVals].filter(([, e]) => !e.mod).map(([b]) => b);
  const inSaveNotList = vanilla.filter((b) => !allListed.has(b)).sort();
  const listEntries = listSections.flatMap((s) => sections.get(s) ?? []);
  const inListNotSave = listEntries.filter((e) => !saveVals.has(e)).sort();

  console.log(`\n## ${label}`);
  console.log(`   saves (vanilla): ${vanilla.length}   list: ${listEntries.length}`);
  console.log(`   -- in a save but NOT in your list (${inSaveNotList.length})`);
  for (const b of inSaveNotList) {
    const e = saveVals.get(b);
    console.log(`        ${b.padEnd(50)} ${e.files.size}/8 files   ${[...e.full].map(pkg).filter(Boolean).join(' ')}`);
  }
  console.log(`   -- in your list but in NO save (${inListNotSave.length})`);
  for (const b of inListNotSave) console.log(`        ${b}`);
}
