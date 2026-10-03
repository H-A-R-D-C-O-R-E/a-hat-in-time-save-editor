import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode } from '../src/hat.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const top = (doc, n) => doc.properties.find((p) => p.name === n);

for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.hat')).sort()) {
  const doc = decode(new Uint8Array(fs.readFileSync(path.join(DIR, file))));
  const to = top(doc, 'TimeObjects');
  const so = top(doc, 'SpeedrunTimeObjects');
  const c = top(doc, 'CurrentCollectedTimePieces');
  const cm = top(doc, 'CurrentCollectedTimePieces_Mods');
  const us = top(doc, 'UnlockedSecretLevels');

  const els = to.value;
  const idOf = (e) => e.properties.find((q) => q.name === 'Id')?.value;
  const boolOf = (e, n) => !!e.properties.find((q) => q.name === n)?.value;
  const vanilla = els.filter((e) => !boolOf(e, 'IsMod'));
  const mod = els.filter((e) => boolOf(e, 'IsMod'));
  const vColl = vanilla.filter((e) => boolOf(e, 'Collected'));
  const mColl = mod.filter((e) => boolOf(e, 'Collected'));

  console.log(`\n### ${file}`);
  console.log(`  CurrentCollectedTimePieces      = ${c ? c.value : '(absent)'}`);
  console.log(`  CurrentCollectedTimePieces_Mods = ${cm ? cm.value : '(absent)'}`);
  console.log(`  derived: vanilla collected=${vColl.length}  mod collected=${mColl.length}  (total ${els.length})`);
  console.log(`  elements carrying IsMod field: ${els.filter((e) => e.properties.some((q) => q.name === 'IsMod')).length}`);
  console.log(`  elements carrying ModPackage: ${els.filter((e) => e.properties.some((q) => q.name === 'ModPackage')).length}`);

  const ids = new Set(els.map(idOf));
  const soIds = new Set(so.value.map(idOf));
  const onlyTo = [...ids].filter((x) => !soIds.has(x));
  const onlySo = [...soIds].filter((x) => !ids.has(x));
  console.log(`  TimeObjects ids=${ids.size}  SpeedrunTimeObjects ids=${soIds.size}`);
  console.log(`    only in TimeObjects (${onlyTo.length}): ${onlyTo.slice(0, 8).join(', ')}${onlyTo.length > 8 ? ' …' : ''}`);
  console.log(`    only in SpeedrunTimeObjects (${onlySo.length}): ${onlySo.slice(0, 8).join(', ')}${onlySo.length > 8 ? ' …' : ''}`);

  const unlocked = us?.value ?? [];
  console.log(`  UnlockedSecretLevels (${unlocked.length}): ${unlocked.join(', ')}`);
  const notInTo = unlocked.filter((x) => !ids.has(x));
  console.log(`    …of which NOT a TimeObjects id: ${notInTo.join(', ') || 'none'}`);

  // do SpeedrunTimeObjects entries carry a Collected-like flag?
  const fields = new Set();
  so.value.slice(0, 50).forEach((e) => e.properties.forEach((q) => fields.add(q.name)));
  console.log(`  SpeedrunTimeObjects fields: ${[...fields].join(', ')}`);
}
