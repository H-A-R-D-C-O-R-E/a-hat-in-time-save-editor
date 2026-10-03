import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode } from '../src/hat.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2] ?? 'DLC1 Hundo.hat';
const doc = decode(new Uint8Array(fs.readFileSync(path.join(DIR, file))));

const bare = (s) => (typeof s === 'string' && s.includes('.') ? s.slice(s.lastIndexOf('.') + 1) : s);

function find(props, name, scope = '') {
  const out = [];
  for (const p of props) {
    if (p.name === name) out.push([`${scope}.${p.name}`, p]);
    if (p.type === 'ArrayProperty' && p.elementType === 'struct') {
      p.value.forEach((el, i) => out.push(...find(el.properties, name, `${scope}.${p.name}[${i}]`)));
    } else if (p.type === 'StructProperty' && Array.isArray(p.value)) {
      out.push(...find(p.value, name, `${scope}.${p.name}`));
    } else if (p.properties) out.push(...find(p.properties, name, `${scope}.${p.name}`));
  }
  return out;
}

const show = (props, indent = '    ') => {
  for (const p of props) {
    if (p.type === 'ArrayProperty' && p.elementType === 'struct') {
      console.log(`${indent}${p.name}: struct[${p.value.length}]`);
      p.value.forEach((el, i) => {
        console.log(`${indent}  [${i}] class=${el.class ? bare(el.class) : '-'}`);
        show(el.properties, indent + '    ');
      });
    } else if (p.type === 'ArrayProperty') {
      const v = p.value.map((x) => (typeof x === 'string' ? bare(x) : JSON.stringify(x)));
      console.log(`${indent}${p.name}: ${p.elementType}[${v.length}] = ${v.slice(0, 12).join(', ')}${v.length > 12 ? ' …' : ''}`);
    } else if (typeof p.value === 'string') {
      console.log(`${indent}${p.name} = ${bare(p.value)}`);
    } else {
      console.log(`${indent}${p.name} = ${JSON.stringify(p.value)}`);
    }
  }
};

const roots = [];
for (const name of ['MyBackpack', 'MyBackpack2017', 'Loadouts', 'HUBDecorations']) {
  roots.push(...find(doc.properties, name));
}
console.log(`file: ${file}`);
for (const [p, node] of roots) {
  console.log(`\n=== ${p} ===`);
  if (node.type === 'ArrayProperty' && node.elementType === 'struct') {
    console.log(`  struct[${node.value.length}]`);
    node.value.forEach((el, i) => { console.log(`  [${i}] class=${el.class ? bare(el.class) : '-'}`); show(el.properties, '      '); });
  } else show(node.value, '  ');
}
