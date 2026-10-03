import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode } from '../src/hat.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = fs.readdirSync(DIR).filter((x) => x.endsWith('.hat')).sort();
const scopeWant = process.argv[2] ?? '.TimeObjects.Id';   // substring match on the property path
const bare = (s) => (s.includes('.') ? s.slice(s.lastIndexOf('.') + 1) : s);
const isMod = (s) => s.startsWith('Mod:') || (s.includes('.') && !s.includes(':') && !s.startsWith('hatintimegamecontent.'));

const inFiles = new Map();
for (const f of files) {
  const doc = decode(new Uint8Array(fs.readFileSync(path.join(DIR, f))));
  (function walk(props, scope) {
    for (const p of props) {
      const here = `${scope}.${p.name}`;
      if (p.type === 'ArrayProperty') {
        if (p.elementType === 'string') p.value.forEach((v) => here.includes(scopeWant) && collect(v, f));
        else if (p.elementType === 'struct') p.value.forEach((el) => walk(el.properties, here));
      } else if (p.type === 'StructProperty' && Array.isArray(p.value)) walk(p.value, here);
      if (typeof p.value === 'string') here.includes(scopeWant) && collect(p.value, f);
      if (p.properties) walk(p.properties, here);
    }
  })(doc.properties, '');
}
function collect(v, f) {
  if (isMod(v)) return;
  (inFiles.get(v) ?? inFiles.set(v, new Set()).get(v)).add(f);
}
const sorted = [...inFiles].sort((a, b) => a[0].localeCompare(b[0]));
for (const [v, fs2] of sorted) console.log(`  ${String(fs2.size).padStart(2)}/${files.length}  ${v}`);
console.log(`\ntotal: ${sorted.length}`);
