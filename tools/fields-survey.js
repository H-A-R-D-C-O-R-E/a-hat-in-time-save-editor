import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode } from '../src/hat.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

console.log('=== top-level property names per file ===');
const perFile = new Map();
for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.hat')).sort()) {
  const doc = decode(new Uint8Array(fs.readFileSync(path.join(DIR, file))));
  const names = doc.properties.map((p) => p.name);
  perFile.set(file, new Set(names));
  console.log(`\n${file}  (${names.length})`);
  console.log('   ' + names.join(' | '));
}

console.log('\n\n=== name appears in / absent from ===');
const all = [...new Set([...perFile.values()].flatMap((s) => [...s]))];
for (const n of all) {
  const has = [...perFile].filter(([, s]) => s.has(n)).map(([f]) => f);
  if (has.length !== perFile.size) {
    console.log(`  ${n.padEnd(40)} ${has.length}/${perFile.size}  present in: ${has.join(', ')}`);
  }
}

// full element dump
const file = process.argv[2] ?? '1.0 Hundo.hat';
const doc = decode(new Uint8Array(fs.readFileSync(path.join(DIR, file))));
const to = doc.properties.find((p) => p.name === 'TimeObjects');
const so = doc.properties.find((p) => p.name === 'SpeedrunTimeObjects');
const fmt = (e) =>
  e.properties.map((q) => `${q.name}=${JSON.stringify(q.value)}`).join('  ');
console.log(`\n\n=== ${file} TimeObjects (${to.value.length}) ===`);
to.value.forEach((e, i) => console.log(`  [${i}] ${fmt(e)}`));
console.log(`\n=== ${file} SpeedrunTimeObjects (${so.value.length}) — first 8 ===`);
so.value.slice(0, 8).forEach((e, i) => console.log(`  [${i}] ${fmt(e)}`));
console.log(`  … last 3`);
so.value.slice(-3).forEach((e, i) => console.log(`  [${so.value.length - 3 + i}] ${fmt(e)}`));
