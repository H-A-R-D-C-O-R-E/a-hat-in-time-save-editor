import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const lines = fs.readFileSync(path.join(DIR, 'Collectibles.txt'), 'utf8').split(/\r?\n/);

const sections = new Map();
let cur = null;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  if (line === '') { cur = null; continue; }
  if ((i === 0 || lines[i - 1].trim() === '') && cur === null) {
    cur = line.replace(/:$/, '');
    sections.set(cur, []);
    continue;
  }
  if (cur === null) { console.log(`!! line ${i + 1} orphaned: ${line}`); continue; }
  sections.get(cur).push(line);
}

console.log('=== sections ===');
let total = 0;
for (const [name, entries] of sections) {
  total += entries.length;
  console.log(`  ${String(entries.length).padStart(3)}  ${name}`);
}
console.log(`  ----  ${total} entries total`);

console.log('\n=== duplicates (within a section or across sections) ===');
const where = new Map();
for (const [name, entries] of sections) {
  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e)) console.log(`  DUPLICATE IN ${name}: ${e}`);
    seen.add(e);
    (where.get(e) ?? where.set(e, new Set()).get(e)).add(name);
  }
}
let dupCount = 0;
for (const [e, secs] of where) if (secs.size > 1) { dupCount++; console.log(`  ${e}  ->  ${[...secs].join(', ')}`); }
if (!dupCount) console.log('  none');

console.log('\n=== entries out of order within their section ===');
const UNSORTED = new Set(['Challenge Roads', 'Time Pieces', 'Hat Flairs']);
let outOfOrder = 0;
for (const [name, entries] of sections) {
  if (UNSORTED.has(name)) continue;
  for (let i = 1; i < entries.length; i++) {
    if (entries[i] < entries[i - 1]) {
      outOfOrder++;
      console.log(`  ${name}: "${entries[i]}" after "${entries[i - 1]}"`);
    }
  }
}

// Hat Flairs is grouped by hat family — check each family block is sorted
const flairs = sections.get('Hat Flairs') ?? [];
let run = [flairs[0]];
for (let i = 1; i <= flairs.length; i++) {
  const fam = (e) => e.slice(0, e.lastIndexOf('_'));
  if (i < flairs.length && fam(flairs[i]) === fam(run[0])) { run.push(flairs[i]); continue; }
  for (let j = 1; j < run.length; j++) {
    if (run[j] < run[j - 1]) { outOfOrder++; console.log(`  Hat Flairs [${fam(run[0])}]: "${run[j]}" after "${run[j - 1]}"`); }
  }
  run = [flairs[i]];
}
if (!outOfOrder) console.log('  none');
