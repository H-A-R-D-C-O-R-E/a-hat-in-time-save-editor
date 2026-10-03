import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode } from '../src/hat.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const byId = new Map();
const order = [];
for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.hat')).sort()) {
  const doc = decode(new Uint8Array(fs.readFileSync(path.join(DIR, file))));
  const to = doc.properties.find((p) => p.name === 'TimeObjects');
  for (const e of to.value) {
    const g = (n) => e.properties.find((q) => q.name === n);
    const id = g('Id').value;
    const rec = {
      IsAct: g('IsAct')?.value,
      Paid: g('Paid')?.value,
      High: g('Highscore')?.value ?? g('HighScore')?.value,
      IsMod: g('IsMod')?.value,
      ModPackage: g('ModPackage')?.value,
      keys: e.properties.map((q) => q.name).join(','),
    };
    if (!byId.has(id)) { byId.set(id, []); order.push(id); }
    byId.get(id).push({ file, ...rec });
  }
}

const vary = (sel) => order.filter((id) => new Set(byId.get(id).map(sel)).size > 1);

console.log(`ids seen: ${order.length}`);
const varIsAct = vary((r) => r.IsAct);
const varPaid = vary((r) => r.Paid);
const varHigh = vary((r) => r.High);
const varKeys = vary((r) => r.keys);
console.log(`IsAct varies across saves: ${varIsAct.length}`);
varIsAct.forEach((id) => console.log(`   ${id}: ` + byId.get(id).map((r) => `${r.file}=${r.IsAct}`).join('  ')));
console.log(`Paid varies across saves: ${varPaid.length}`);
varPaid.forEach((id) => console.log(`   ${id}: ` + byId.get(id).map((r) => `${r.file}=${r.Paid}`).join('  ')));
console.log(`Highscore varies: ${varHigh.length}`);
console.log(`field-set varies: ${varKeys.length}`);
varKeys.forEach((id) => console.log(`   ${id}: ` + [...new Set(byId.get(id).map((r) => r.keys))].join('  ||  ')));

console.log(`\nPaid=true ids (stable): ${order.filter((id) => byId.get(id)[0].Paid).join(', ')}`);
console.log(`IsAct=false ids (stable): ${order.filter((id) => byId.get(id)[0].IsAct === false).join(', ')}`);

console.log(`\nper-id canonical record (first appearance):`);
for (const id of order) {
  const r = byId.get(id)[0];
  console.log(`  ${JSON.stringify(id).padEnd(46)} IsAct=${r.IsAct} Paid=${r.Paid} IsMod=${r.IsMod} ModPackage=${JSON.stringify(r.ModPackage)}  seen in ${byId.get(id).length} file(s)`);
}
