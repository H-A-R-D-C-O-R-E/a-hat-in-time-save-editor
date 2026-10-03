// Completeness check: pull every collectible-looking string straight out of the
// raw bytes and confirm the decoded save actually contains it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode } from '../src/hat.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = fs.readdirSync(DIR).filter((x) => x.endsWith('.hat')).sort();

const PATTERN = /[A-Za-z0-9_]*(?:Collectible|Ability_|Weapon_|Badge_|SnatcherContract|CosmeticItemQualityInfo|Decoration_|Sticker_?)[A-Za-z0-9_]*/g;

const fromRaw = new Set();
const perFileRaw = new Map();
for (const f of files) {
  const buf = fs.readFileSync(path.join(DIR, f));
  const latin1 = buf.toString('latin1');
  const found = new Set(latin1.match(PATTERN) ?? []);
  perFileRaw.set(f, found);
  for (const v of found) fromRaw.add(v);
}

// same set, but recovered by walking the decoded document
const fromDoc = new Set();
const bare = (s) => (s.includes('.') ? s.slice(s.lastIndexOf('.') + 1) : s);
function walk(props) {
  for (const p of props) {
    fromDoc.add(p.name);                          // property names appear in the raw bytes too
    if (typeof p.value === 'string') { fromDoc.add(p.value); fromDoc.add(bare(p.value)); }
    if (p.type === 'ArrayProperty') {
      if (p.elementType === 'string') p.value.forEach((v) => { fromDoc.add(v); fromDoc.add(bare(v)); });
      else if (p.elementType === 'struct') p.value.forEach((el) => walk(el.properties));
    } else if (p.type === 'StructProperty' && Array.isArray(p.value)) walk(p.value);
    if (p.properties) walk(p.properties);
  }
}
for (const f of files) walk(decode(new Uint8Array(fs.readFileSync(path.join(DIR, f)))).properties);

console.log(`raw strings found  : ${fromRaw.size}`);
console.log(`decoded strings    : ${fromDoc.size}`);
const missed = [...fromRaw].filter((v) => !fromDoc.has(v));
console.log(`in raw but NOT decoded: ${missed.length}`);
for (const m of missed.slice(0, 40)) console.log(`     ${m}`);

// where do the interesting names show up?
console.log('\n=== per-file presence of entries your list has but no save decodes to ===');
const rawText = new Map(files.map((f) => [f, fs.readFileSync(path.join(DIR, f)).toString('latin1')]));
const probes = [
  'Hat_Ability_Help_Detective', 'Hat_Ability_Parade', 'Hat_Ability_Help', 'Hat_Ability_Sprint',
  'Hat_SnatcherContract_DeathWish_SecretVault', 'Hat_SnatcherContract_DeathWish_',
  'Hat_Badge_Scooter_Subcon', 'Hat_Badge_Scooter',
  'Hat_Collectible_LevelTablet', 'Hat_Collectible_MafiaTie', 'Hat_Collectible_MetroGuide',
  'Hat_Collectible_VaultCode_Green', 'Hat_Collectible_VaultCode_Red', 'Hat_Collectible_VaultCode_Yellow',
  'Hat_Collectible_Skin_PatternExample', 'Hat_Collectible_Skin_Summer_Fairy',
  'Hat_Collectible_Remix_Sand_SandmobileJazz',
  'Sticker3DRod', 'Sticker_3DRod',
  'Virtual', 'Wireframe', 'Speedrun',
  'Trumpet', 'FishingRod', 'PoolNoodle', 'Hat_Weapon_Cocoa', 'Hat_Weapon_',
  'CameraFilter_', 'Scooter', 'SecretVault',
];
for (const p of probes) {
  const hits = files.filter((f) => rawText.get(f).includes(p));
  console.log(`  ${p.padEnd(42)} ${hits.length ? hits.join(', ') : '— nowhere —'}`);
}
