import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode, encode } from '../src/hat.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2] ?? path.join(here, '..');

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.hat')).sort();
if (files.length === 0) {
  console.error(`no .hat files in ${dir}`);
  process.exit(1);
}

let failures = 0;
for (const file of files) {
  const full = path.join(dir, file);
  const original = new Uint8Array(fs.readFileSync(full));
  try {
    const document = decode(original);
    const viaJson = JSON.parse(JSON.stringify(document));
    const a = encode(document);
    const b = encode(viaJson);
    const okA = equal(original, a);
    const okB = equal(original, b);
    if (okA && okB) {
      console.log(`PASS ${file.padEnd(22)} ${String(original.length).padStart(8)} bytes`);
    } else {
      failures++;
      console.log(`FAIL ${file}`);
      console.log(`     decode/encode       : ${okA ? 'identical' : diff(original, a)}`);
      console.log(`     decode/JSON/encode  : ${okB ? 'identical' : diff(original, b)}`);
    }
  } catch (err) {
    failures++;
    console.log(`FAIL ${file}: ${err.message}`);
  }
}

console.log(failures ? `\n${failures}/${files.length} failed` : `\n${files.length}/${files.length} round-trip byte-for-byte`);
process.exit(failures ? 1 : 0);

function equal(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function diff(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  const hex = (buf) => [...buf.subarray(Math.max(0, i - 6), i + 10)].map((x) => x.toString(16).padStart(2, '0')).join(' ');
  if (i === n) return `lengths differ (${a.length} vs ${b.length})`;
  return `first difference at 0x${i.toString(16)}\n       orig: ${hex(a)}\n       got : ${hex(b)}`;
}
