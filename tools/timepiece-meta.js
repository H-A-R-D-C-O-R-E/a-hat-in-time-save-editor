import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode } from '../src/hat.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const lines = fs.readFileSync(path.join(DIR, 'Collectibles.txt'), 'utf8').split(/\r?\n/);
const known = [];
let grab = false;
for (let i = 0; i < lines.length; i++) {
  const l = lines[i].trim();
  if (l === '') { grab = false; continue; }
  if (i === 0 || lines[i - 1].trim() === '') { grab = l.replace(/:$/, '') === 'Time Pieces'; continue; }
  if (grab) known.push(l.replace(/^\d+:\s*/, ''));
}

const meta = new Map();
const chapters = new Map();
for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.hat')).sort()) {
  const doc = decode(new Uint8Array(fs.readFileSync(path.join(DIR, file))));
  const so = doc.properties.find((p) => p.name === 'SpeedrunTimeObjects');
  for (const e of so.value) {
    const g = (n) => e.properties.find((q) => q.name === n)?.value;
    const id = g('Id');
    const rec = { ChapterName: g('ChapterName'), ActName: g('ActName'), ActID: g('ActID'), Time: g('Time') };
    if (!meta.has(id)) meta.set(id, rec);
    else {
      const cur = meta.get(id);
      for (const k of ['ChapterName', 'ActName', 'ActID']) {
        if (cur[k] === undefined && rec[k] !== undefined) cur[k] = rec[k];
        else if (cur[k] !== rec[k] && rec[k] !== undefined) {
          if (!cur['_dup']) cur['_dup'] = new Set();
          cur['_dup'].add(`${k}:${cur[k]} vs ${rec[k]}`);
        }
      }
    }
    if (rec.ChapterName) {
      if (!chapters.has(rec.ChapterName)) chapters.set(rec.ChapterName, new Set());
      chapters.get(rec.ChapterName).add(id);
    }
  }
}

console.log(`SpeedrunTimeObjects ids known: ${meta.size}`);
const missing = known.filter((id) => !meta.has(id));
console.log(`\nknown list ids with NO ChapterName source (${missing.length}):`);
missing.forEach((id) => console.log(`   ${id}`));

console.log(`\nknown list ids present but lacking ChapterName:`);
known.filter((id) => meta.has(id) && !meta.get(id).ChapterName).forEach((id) => console.log(`   ${id}`));

console.log(`\n=== chapter groups ===`);
for (const [ch, ids] of [...chapters].sort()) {
  console.log(`  ${ch}  (${ids.size})`);
  console.log('     ' + [...ids].sort().join(', '));
}

console.log(`\n=== id -> ChapterName / ActName / ActID (known list only) ===`);
for (const id of known) {
  const r = meta.get(id);
  console.log(`  ${id.padEnd(40)} ${r ? `${r.ChapterName ?? '?'} / ${r.ActName ?? '?'} / ${r.ActID ?? '?'}` : '(none)'}`);
}

const dupIds = [...meta].filter(([, r]) => r._dup);
console.log(`\nids whose metadata differs between saves: ${dupIds.length}`);
dupIds.slice(0, 10).forEach(([id, r]) => console.log(`   ${id}: ${[...r._dup].join('; ')}`));
