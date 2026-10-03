import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode } from '../src/hat.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = fs.readdirSync(DIR).filter((x) => x.endsWith('.hat')).sort();

const hits = new Map();
const add = (k, v) => { if (typeof v === 'string' && v !== '') (hits.get(k) ?? hits.set(k, new Set()).get(k)).add(v); };
function walk(props, scope) {
  for (const p of props) {
    if (typeof p.value === 'string') add(`${scope}.${p.name}`, p.value);
    if (p.type === 'ArrayProperty') {
      if (p.elementType === 'string') p.value.forEach((v) => add(`${scope}.${p.name}`, v));
      else if (p.elementType === 'struct') p.value.forEach((el) => { add(`${scope}.${p.name}#class`, el.class); walk(el.properties, `${scope}.${p.name}`); });
    } else if (p.type === 'StructProperty' && Array.isArray(p.value)) walk(p.value, `${scope}.${p.name}`);
    if (p.properties) walk(p.properties, `${scope}.${p.name}`);
  }
}
for (const f of files) walk(decode(new Uint8Array(fs.readFileSync(path.join(DIR, f)))).properties, '');

const bare = (s) => (s.includes('.') ? s.slice(s.lastIndexOf('.') + 1) : s);
const isMod = (s) => s.startsWith('Mod:') || (s.includes('.') && !s.includes(':') && !s.startsWith('hatintimegamecontent.'));
const vanilla = (set) => [...new Set([...(set ?? [])].filter((v) => v !== 'None' && !isMod(v)).map(bare))].sort();

const GROUPS = [
  ['hats      ', ['.*\\.Hats\\.BackpackClass']],
  ['hat flairs', ['.*\\.Hats\\.ItemQualityInfoName']],
  ['badges    ', ['.*\\.Badges\\.BackpackClass', '.*\\.Badges#class']],
  ['weapons   ', ['.*\\.Weapons\\.BackpackClass', '\\.MyBackpack\\.Weapon', '\\.Loadouts\\.Weapon']],
  ['skins     ', ['.*\\.Skins\\.BackpackClass']],
  ['remixes   ', ['.*\\.Remixes\\.BackpackClass']],
  ['backpack  ', ['.*\\.Collectibles\\.BackpackClass']],
  ['stickers  ', ['.*\\.Stickers\\.BackpackClass']],
  ['filters   ', ['.*\\.Filters\\.BackpackClass']],
  ['contracts ', ['\\.SnatcherContracts', '\\.CompletedSnatcherContracts', '\\.TurnedInSnatcherContracts']],
  ['decorations', ['\\.HUBDecorations\\.Decorations']],
  ['timepieces', ['\\.TimeObjects\\.Id', '\\.SpeedrunTimeObjects\\.Id']],
];
for (const [label, pats] of GROUPS) {
  const re = new Set();
  for (const [k, v] of hits) if (pats.some((p) => new RegExp(`^${p}$`).test(k))) v.forEach((x) => re.add(x));
  const vals = [...new Set([...re].filter((v) => v !== 'None' && !isMod(v)).map(bare))].sort();
  console.log(`\n### ${label}  (${vals.length} vanilla)`);
  console.log('  ' + vals.join('\n  '));
}

// every class-ish token in the file, grouped by prefix
console.log('\n### all distinct class-name tokens found anywhere in the saves');
const TOKEN = /(?:Hat|Tag|Yerti|Yoshi|Werti)_[A-Za-z0-9_]+/g;
const all = new Set();
for (const set of hits.values()) for (const v of set) for (const m of v.match(TOKEN) ?? []) all.add(m);
const byPrefix = new Map();
for (const t of all) {
  const key = t.replace(/_+(?:Sprint|Chemical|IceHat|FoxMask|Help|Parade|Detective|TimeStop|StatueFall).*$/, '');
  (byPrefix.get(key) ?? byPrefix.set(key, new Set()).get(key)).add(t);
}
for (const [k, v] of [...byPrefix].sort()) console.log(`  ${k} -> ${[...v].sort().join(', ')}`);
