import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode } from '../src/hat.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2] ?? '1.0 Hundo.hat';
const doc = decode(new Uint8Array(fs.readFileSync(path.join(DIR, file))));

const brief = (p, ind = '') => {
  if (p.type === 'ArrayProperty') {
    const n = p.value.length;
    const head = p.value.slice(0, 4).map((v) => (typeof v === 'string' ? v : v.class ?? '{…}'));
    return `${p.name}: array[${p.elementType}] n=${n}  ${head.join(', ')}${n > 4 ? ' …' : ''}`;
  }
  if (typeof p.value === 'string') return `${p.name} = "${p.value}"`;
  if (Array.isArray(p.value)) return `${p.name}: struct[${p.value.length}]`;
  return `${p.name} = ${JSON.stringify(p.value)}`;
};

console.log(`=== ${file} : top-level properties ===`);
for (const p of doc.properties) console.log('  ' + brief(p));

const findTop = (name) => doc.properties.find((p) => p.name === name);
for (const n of ['TimeObjects', 'SpeedrunTimeObjects', 'ActBits', 'LevelSaveInfo']) {
  const p = findTop(n);
  if (!p) { console.log(`\n-- ${n}: absent`); continue; }
  console.log(`\n-- ${n} : ${p.type} ${p.structType ?? ''}`);
  if (p.type === 'ArrayProperty' && p.elementType === 'struct') {
    console.log(`   elements: ${p.value.length}`);
    p.value.slice(0, 3).forEach((el, i) => {
      console.log(`   [${i}] class=${el.class ?? '-'}`);
      el.properties.forEach((q) => console.log('        ' + brief(q)));
    });
  } else if (Array.isArray(p.value)) {
    p.value.forEach((q) => console.log('   ' + brief(q, '   ')));
  }
}

// does anything else reference a time piece id?
const ids = findTop('TimeObjects')?.value ?? [];
const probe = ids.slice(0, 3);
console.log('\n-- where do these TimeObjects ids appear? --');
for (const id of probe) {
  const hits = [];
  (function walk(props, scope) {
    for (const p of props) {
      const here = `${scope}.${p.name}`;
      const test = (v) => typeof v === 'string' && (v === id || v.endsWith(':' + id) || v.toLowerCase().includes(id.toLowerCase()));
      if (p.type === 'ArrayProperty') {
        if (p.elementType === 'string') p.value.forEach((v) => test(v) && hits.push(here));
        else if (p.elementType === 'struct') p.value.forEach((el) => walk(el.properties, here));
      } else if (p.type === 'StructProperty' && Array.isArray(p.value)) walk(p.value, here);
      if (typeof p.value === 'string' && test(p.value)) hits.push(here);
      if (p.properties) walk(p.properties, here);
    }
  })(doc.properties, '');
  console.log(`  ${id}`);
  [...new Set(hits)].forEach((h) => console.log(`      ${h}`));
}
