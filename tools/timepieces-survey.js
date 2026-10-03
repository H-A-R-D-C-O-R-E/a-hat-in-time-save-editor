import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode } from '../src/hat.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- known time pieces from Collectibles.txt ----
const lines = fs.readFileSync(path.join(DIR, 'Collectibles.txt'), 'utf8').split(/\r?\n/);
const known = [];
let grab = false;
for (let i = 0; i < lines.length; i++) {
  const l = lines[i].trim();
  if (l === '') { grab = false; continue; }
  if (i === 0 || lines[i - 1].trim() === '') {
    grab = l.replace(/:$/, '') === 'Time Pieces';
    continue;
  }
  if (grab) known.push(l.replace(/^\d+:\s*/, ''));
}
const knownSet = new Set(known);

const top = (doc, name) => doc.properties.find((p) => p.name === name);

for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.hat')).sort()) {
  const doc = decode(new Uint8Array(fs.readFileSync(path.join(DIR, file))));
  const to = top(doc, 'TimeObjects');
  const so = top(doc, 'SpeedrunTimeObjects');
  const cur = top(doc, 'CurrentCollectedTimePieces');
  const unlocked = top(doc, 'UnlockedSecretLevels');

  const ids = to?.value.map((e) => e.properties.find((q) => q.name === 'Id')?.value) ?? [];
  const coll = to?.value.map((e) => !!e.properties.find((q) => q.name === 'Collected')?.value) ?? [];
  const nTrue = coll.filter(Boolean).length;
  const soIds = so?.value.map((e) => e.properties.find((q) => q.name === 'Id')?.value) ?? [];
  const soTrue = so?.value.filter((e) => e.properties.find((q) => q.name === 'Collected')?.value).length;

  console.log(`\n### ${file}`);
  console.log(`  TimeObjects          n=${ids.length}  Collected=true:${nTrue}  false:${ids.length - nTrue}`);
  console.log(`  SpeedrunTimeObjects  n=${soIds.length}  Collected=true:${soTrue}`);
  console.log(`  CurrentCollectedTimePieces = ${cur?.value}   (matches TimeObjects true count: ${cur?.value === nTrue})`);
  console.log(`  same id order in both arrays: ${JSON.stringify(ids) === JSON.stringify(soIds)}`);
  console.log(`  UnlockedSecretLevels n=${unlocked?.value.length ?? 0}`);

  const notCollected = ids.filter((_, i) => !coll[i]);
  if (notCollected.length) console.log(`  NOT collected: ${notCollected.join(', ')}`);

  const saveOnly = ids.filter((x) => !knownSet.has(x));
  const missing = known.filter((x) => !ids.includes(x));
  console.log(`  in save but not in Collectibles.txt (${saveOnly.length}): ${saveOnly.join(', ') || '—'}`);
  console.log(`  in Collectibles.txt but not in this save (${missing.length}): ${missing.join(', ') || '—'}`);

  // extra properties on a TimeObjects element beyond Id/Collected
  const extra = new Set();
  for (const e of to?.value ?? []) for (const q of e.properties) extra.add(q.name);
  console.log(`  TimeObjects element fields: ${[...extra].join(', ')}`);

  // LevelBits entries mentioning time pieces / acts
  const lvl = top(doc, 'LevelSaveInfo');
  const bits = [];
  for (const entry of lvl?.value ?? []) {
    for (const q of entry.properties) {
      if (q.name !== 'LevelBits') continue;
      for (const b of (Array.isArray(q.value) ? q.value : [])) {
        const name = typeof b === 'string' ? b : b.properties?.find((z) => z.name === 'Id')?.value;
        if (name && /timepiece|time_piece|actbits|completed|collected/i.test(name)) bits.push(name);
      }
    }
  }
  console.log(`  LevelBits matching timepiece/collected: ${bits.length}`);
  bits.slice(0, 12).forEach((b) => console.log(`      ${b}`));
  if (bits.length > 12) console.log(`      … ${bits.length - 12} more`);
}
