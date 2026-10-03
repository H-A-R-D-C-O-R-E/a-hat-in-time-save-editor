/**
 * Read-only probe: exact contents of the Hats array + flair->hat mapping.
 *
 *   node tools/inspect-hats.js [file.hat]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode } from '../src/hat.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = process.argv[2] ? [process.argv[2]] : fs.readdirSync(ROOT).filter((f) => f.endsWith('.hat')).sort();

const top = (doc, n) => doc.properties.find((p) => p.name === n);
const find = (doc, name) => {
  let hit = null;
  (function walk(props, scope) {
    for (const p of props) {
      if (p.name === name && p.type === 'ArrayProperty') { hit = { path: scope ? `${scope}.${name}` : name, prop: p }; return; }
      if (p.type === 'ArrayProperty' && p.elementType === 'struct') { for (const el of p.value) { walk(el.properties, `${scope}.${p.name}[]`); if (hit) return; } }
      else if (p.type === 'StructProperty' && Array.isArray(p.value)) { walk(p.value, `${scope}.${p.name}`); if (hit) return; }
    }
  })(doc.properties, '');
  return hit;
};

// ---- Collectibles.txt -------------------------------------------------------
const lines = fs.readFileSync(path.join(ROOT, 'Collectibles.txt'), 'utf8').split(/\r?\n/);
const sections = new Map();
let cur = null;
for (let i = 0; i < lines.length; i++) {
  const l = lines[i].trim();
  if (l === '') { cur = null; continue; }
  const hdr = i === 0 || lines[i - 1].trim() === '';
  if (hdr) { cur = l.replace(/:$/, ''); if (!sections.has(cur)) sections.set(cur, []); continue; }
  if (cur) sections.get(cur).push(l.replace(/^\d+:\s*/, ''));
}
const knownHats = sections.get('Hats') ?? [];
const knownFlairs = sections.get('Hat Flairs') ?? [];
console.log(`Collectibles.txt  Hats=${knownHats.length}  Hat Flairs=${knownFlairs.length}`);

// ---- per-save ---------------------------------------------------------------
const flairHatMap = new Map(); // flair -> Set(hat)
const prefixes = new Map();
const allHatEntries = new Map();  // qualified hat -> Set(save)
const allFlairEntries = new Map();

for (const file of files) {
  const doc = decode(new Uint8Array(fs.readFileSync(path.join(ROOT, file))));
  const hit = find(doc, 'Hats');
  if (!hit) { console.log(`\n${file}: NO Hats array`); continue; }
  const { path: p, prop } = hit;
  const entries = prop.value;

  const plain = entries.filter((e) => !e.properties.find((q) => q.name === 'ItemQualityInfoName'));
  const withFlair = entries.filter((e) => e.properties.find((q) => q.name === 'ItemQualityInfoName'));

  const cls = (e) => e.properties.find((q) => q.name === 'BackpackClass')?.value;
  const flairOf = (e) => e.properties.find((q) => q.name === 'ItemQualityInfoName')?.value;
  const infoOf = (e) => e.properties.find((q) => q.name === 'ItemQualityInfo')?.value;

  const allHats = new Set(entries.map(cls).filter(Boolean));
  const plainHats = new Set(plain.map(cls).filter(Boolean));

  console.log(`\n${file}   ${p}  n=${entries.length}`);
  console.log(`  hats via ANY entry   (${allHats.size}): ${[...allHats].sort().join(', ')}`);
  console.log(`  hats via PLAIN entry (${plainHats.size}): ${[...plainHats].sort().join(', ')}`);
  console.log(`  plain=${plain.length}  withFlair=${withFlair.length}`);

  const dupPlain = new Map();
  for (const e of plain) dupPlain.set(cls(e), (dupPlain.get(cls(e)) ?? 0) + 1);
  const dups = [...dupPlain].filter(([, n]) => n > 1);
  if (dups.length) console.log(`  DUPLICATE plain entries: ${dups.map(([h, n]) => `${h} x${n}`).join(', ')}`);

  const lastUse = entries.filter((e) => e.properties.some((q) => q.name === 'LastUseTime'));
  const noLastUse = entries.filter((e) => !e.properties.some((q) => q.name === 'LastUseTime'));
  console.log(`  with LastUseTime=${lastUse.length}  without=${noLastUse.length}`);
  if (lastUse[0]) console.log(`     LastUseTime sample: ${lastUse[0].properties.map((q) => q.name + '=' + JSON.stringify(q.value)).join('  ')}`);

  // unknown values
  const unknownHats = [...allHats].filter((h) => !knownHats.includes(h.split('.').pop()));
  const flairs = [...new Set(withFlair.map(flairOf))];
  const unknownFlairs = flairs.filter((f) => !knownFlairs.includes(f));
  console.log(`  hats not in Collectibles.txt (${unknownHats.length}): ${unknownHats.join(', ') || '—'}`);
  console.log(`  flairs not in Collectibles.txt (${unknownFlairs.length}): ${unknownFlairs.join(', ') || '—'}`);

  for (const h of allHats) {
    if (!allHatEntries.has(h)) allHatEntries.set(h, new Set());
    allHatEntries.get(h).add(file);
    const raw = h.split('.')[0];
    prefixes.set(raw, (prefixes.get(raw) ?? 0) + 1);
  }
  for (const f of flairs) {
    if (!allFlairEntries.has(f)) allFlairEntries.set(f, new Set());
    allFlairEntries.get(f).add(file);
  }
  for (const e of withFlair) {
    const f = flairOf(e);
    if (!flairHatMap.has(f)) flairHatMap.set(f, new Set());
    flairHatMap.get(f).add(cls(e));
    // is ItemQualityInfo always the package-qualified ItemQualityInfoName?
    const info = infoOf(e);
    if (info !== undefined && info.split('.').pop() !== f) {
      console.log(`  !! ItemQualityInfo ${info} != name ${f}`);
    }
  }

  // full dump on request
  if (process.argv[2]) {
    entries.forEach((e, i) => {
      const last = e.properties.find((q) => q.name === 'LastUseTime');
      console.log(`   [${String(i).padStart(2)}] ${String(cls(e)).padEnd(46)} flair=${String(flairOf(e) ?? '-').padEnd(52)} ${last ? 'LastUseTime=' + last.value : ''}`);
    });
    const lo = top(doc, 'Loadouts');
    if (lo) {
      console.log('  Loadouts[0]:');
      for (const q of lo.value[0].properties) {
        console.log(`     ${q.name}  ${q.type}  ${JSON.stringify(q.value)?.slice(0, 220)}`);
      }
    }
  }
}

// ---- summaries ---------------------------------------------------------------
console.log('\n================ summaries ================');
console.log(`\npackage prefixes: ${[...prefixes].map(([k, v]) => `${k}(${v})`).join(', ')}`);

console.log('\nflair -> hats seen in saves:');
const bad = [];
for (const [f, hs] of [...flairHatMap].sort()) {
  const ok = hs.size === 1;
  if (!ok) bad.push(f);
  console.log(`  ${ok ? ' ' : '!'} ${f.padEnd(56)} -> ${[...hs].join(', ')}`);
}
console.log(`  flairs with ambiguous/missing hat: ${bad.length}`);

console.log(`\nCollectibles.txt Hats not in any save: ${knownHats.filter((h) => ![...allHatEntries.keys()].some((k) => k.split('.').pop() === h)).join(', ') || '—'}`);
console.log(`Collectibles.txt Flairs not in any save: ${knownFlairs.filter((f) => !allFlairEntries.has(f)).join(', ') || '—'}`);
console.log(`Save hats not in Collectibles.txt: ${[...allHatEntries.keys()].filter((h) => !knownHats.includes(h.split('.').pop())).join(', ') || '—'}`);
console.log(`Save flairs not in Collectibles.txt: ${[...allFlairEntries.keys()].filter((f) => !knownFlairs.includes(f)).join(', ') || '—'}`);

console.log('\nflairs in Collectibles.txt with NO observed hat:');
for (const f of knownFlairs) if (!flairHatMap.has(f)) console.log(`  ${f}`);
