#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { decode, encode, FormatError } from './hat.js';

function usage(code) {
  console.error(`usage:
  node src/cli.js decode <save.hat> [-o out.json]     .hat  -> .json
  node src/cli.js encode <save.json> [-o out.hat]     .json -> .hat
  node src/cli.js roundtrip <save.hat>                check byte-for-byte identity
  node src/cli.js verify [<file.hat> ...]             verify every given save`);
  process.exit(code);
}

function flagValue(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  if (i + 1 >= args.length) { console.error(`missing value for ${name}`); usage(2); }
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
}

function readBinary(file) {
  if (!fs.existsSync(file)) { console.error(`no such file: ${file}`); process.exit(1); }
  return new Uint8Array(fs.readFileSync(file));
}

function firstDifference(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

function describeDifference(original, rebuilt) {
  const at = firstDifference(original, rebuilt);
  if (at === -1) return null;
  const hex = (buf, i) => {
    const from = Math.max(0, i - 8);
    const slice = buf.subarray(from, Math.min(buf.length, i + 8));
    return [...slice].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  };
  return `first difference at 0x${at.toString(16)} (lengths ${original.length} vs ${rebuilt.length})\n` +
         `    original: ...${hex(original, at)}\n` +
         `    rebuilt : ...${hex(rebuilt, at)}`;
}

function checkFile(file) {
  const original = readBinary(file);
  const document = decode(original);

  // simulate a JSON round trip as well, since that is what the web UI does
  const viaJson = JSON.parse(JSON.stringify(document));

  const rebuilt = encode(document);
  const rebuiltFromJson = encode(viaJson);

  const results = [];
  results.push(['decode/encode', original, rebuilt]);
  results.push(['decode/JSON/encode', original, rebuiltFromJson]);

  let ok = true;
  for (const [label, a, b] of results) {
    const diff = describeDifference(a, b);
    if (diff) {
      ok = false;
      console.log(`FAIL ${file} [${label}]\n    ${diff}`);
    }
  }
  if (ok) {
    const counts = countKinds(document.properties);
    console.log(`OK   ${file}  ${original.length} bytes, ${counts.props} properties, ${counts.arrays} arrays`);
  }
  return ok;
}

function countKinds(properties) {
  const out = { props: 0, arrays: 0 };
  const walk = (props) => {
    for (const p of props) {
      out.props++;
      if (p.type === 'ArrayProperty') {
        out.arrays++;
        if (p.elementType === 'struct' && Array.isArray(p.value)) {
          for (const el of p.value) walk(el.properties);
        }
      } else if (p.type === 'StructProperty' && Array.isArray(p.value)) {
        walk(p.value);
      }
    }
  };
  walk(properties);
  return out;
}

const args = process.argv.slice(2);
const command = args.shift();
const out = flagValue(args, '-o');

switch (command) {
  case 'decode': {
    if (args.length !== 1) usage(1);
    const document = decode(readBinary(args[0]));
    const json = JSON.stringify(document, null, 2);
    if (out) { fs.writeFileSync(out, json); console.error(`wrote ${out} (${json.length} bytes)`); }
    else process.stdout.write(json + '\n');
    break;
  }
  case 'encode': {
    if (args.length !== 1) usage(1);
    const document = JSON.parse(fs.readFileSync(args[0], 'utf8'));
    const bytes = encode(document);
    if (out) { fs.writeFileSync(out, bytes); console.error(`wrote ${out} (${bytes.length} bytes)`); }
    else process.stdout.write(Buffer.from(bytes));
    break;
  }
  case 'roundtrip': {
    if (args.length !== 1) usage(1);
    process.exit(checkFile(args[0]) ? 0 : 1);
    break;
  }
  case 'verify': {
    const files = args.length ? args : fs.readdirSync('.').filter((f) => f.endsWith('.hat')).sort();
    let failed = 0;
    for (const file of files) if (!checkFile(file)) failed++;
    console.log(failed ? `\n${failed} file(s) FAILED` : `\nall ${files.length} file(s) round-trip byte-for-byte`);
    process.exit(failed ? 1 : 0);
    break;
  }
  default:
    usage(command === undefined || command === '-h' || command === '--help' ? 0 : 1);
}
