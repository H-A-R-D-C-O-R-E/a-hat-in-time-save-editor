import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode } from '../src/hat.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = fs.readdirSync(DIR).filter((x) => x.endsWith('.hat')).sort();
const docs = files.map((f) => [f, decode(new Uint8Array(fs.readFileSync(path.join(DIR, f))))]);

const needles = process.argv.slice(2);
const bare = (s) => (s.includes('.') ? s.slice(s.lastIndexOf('.') + 1) : s);

function walk(props, scope, out, needles) {
  for (const p of props) {
    const here = `${scope}.${p.name}`;
    const test = (v) => needles.some((n) => v === n || v.endsWith('.' + n) || v.includes(n));
    if (typeof p.value === 'string' && test(p.value)) out.push([here, p.value]);
    if (p.type === 'ArrayProperty') {
      if (p.elementType === 'string') p.value.forEach((v) => test(v) && out.push([here, v]));
      else if (p.elementType === 'struct') p.value.forEach((el) => { if (el.class && test(el.class)) out.push([here + '#class', el.class]); walk(el.properties, here, out, needles); });
    } else if (p.type === 'StructProperty' && Array.isArray(p.value)) walk(p.value, here, out, needles);
    if (p.properties) walk(p.properties, here, out, needles);
  }
}

for (const n of needles) {
  console.log(`\n=== ${n} ===`);
  let any = false;
  for (const [f, doc] of docs) {
    const out = [];
    walk(doc.properties, '', out, [n]);
    const uniq = [...new Map(out.map(([k, v]) => [k + '|' + v, [k, v]])).values()];
    if (uniq.length) {
      any = true;
      console.log(`  ${f}`);
      for (const [k, v] of uniq) console.log(`      ${k} = ${v}`);
    }
  }
  if (!any) console.log('  — nowhere —');
}
