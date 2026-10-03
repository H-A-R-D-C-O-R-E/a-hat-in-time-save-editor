import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode } from '../src/hat.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Collect every string that could identify a collectible / item / level bit.
const byKind = new Map();
const add = (kind, value) => {
  if (typeof value !== 'string' || value.length === 0) return;
  if (!byKind.has(kind)) byKind.set(kind, new Set());
  byKind.get(kind).add(value);
};

function walk(props, scope) {
  for (const p of props) {
    switch (p.type) {
      case 'StrProperty':
      case 'NameProperty':
      case 'ObjectProperty':
        add(`${scope}.${p.name}`, p.value);
        if (p.properties) walk(p.properties, `${scope}.${p.name}`);
        break;
      case 'StructProperty':
        walk(p.value, `${scope}.${p.name}`);
        break;
      case 'ArrayProperty':
        if (p.elementType === 'string') for (const v of p.value) add(`${scope}.${p.name}`, v);
        else if (p.elementType === 'struct') {
          for (const el of p.value) walk(el.properties, `${scope}.${p.name}`);
        }
        break;
    }
  }
}

for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.hat')).sort()) {
  const doc = decode(new Uint8Array(fs.readFileSync(path.join(DIR, file))));
  walk(doc.properties, '');
}

const out = [];
let total = new Set();
for (const kind of [...byKind.keys()].sort()) {
  const values = [...byKind.get(kind)].sort();
  out.push(`## ${kind}  (${values.length})`);
  out.push(...values, '');
  for (const v of values) total.add(v);
}
out.push(`# ${total.size} distinct string values across ${byKind.size} property paths`);

const dest = path.join(DIR, 'notes', 'string-values-in-saves.txt');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out.join('\n'));
console.log(`wrote ${dest}`);
console.log(`${total.size} distinct values across ${byKind.size} property paths`);
for (const kind of [...byKind.keys()].sort()) console.log(`   ${String(byKind.get(kind).size).padStart(5)}  ${kind}`);
