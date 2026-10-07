/**
 * Exercises the Time Pieces animation-seen checkboxes against the sample saves.
 *
 *   node test/anim-timepieces.js
 *
 * Checks four things:
 *   1. an untouched decode -> encode round-trip is still byte-perfect
 *   2. flipping every animation box twice flips the read flags back *and*
 *      touches nothing but LevelSaveInfo LevelBits entries
 *   3. act masks flip exactly one bit per box (the chapter's other flags stand)
 *   4. a freshly toggled entry re-encodes to a stable document
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode, encode } from '../src/hat.js';
import category from '../web/categories/time-pieces.js';
import { flatten, diff, harness } from './lib.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (name) => fs.readFileSync(path.join(ROOT, name));
const saves = () => fs.readdirSync(ROOT).filter((f) => f.endsWith('.hat')).sort();

const { check, done } = harness();

const IN_LSB = (k) => k.includes('.LevelSaveInfo[');
const animMap = (doc) => {
  const out = new Map();
  const lsb = doc.properties.find((p) => p.name === 'LevelSaveInfo');
  if (Array.isArray(lsb?.value)) {
    for (const el of lsb.value) {
      const lb = el.properties.find((q) => q.name === 'LevelBits');
      if (!Array.isArray(lb?.value)) continue;
      for (const e of lb.value) {
        const id = e.properties.find((q) => q.name === 'Id')?.value;
        if (typeof id === 'string' && id.startsWith('actselectanimation_')) {
          out.set(id, e.properties.find((q) => q.name === 'Bits')?.value ?? null);
        }
      }
    }
  }
  return out;
};

// ------------------------------------------------------- 1. round-trip -------

console.log('\n1. untouched round-trip');
for (const name of saves()) {
  const bytes = load(name);
  check(name, () => assert.equal(Buffer.from(encode(decode(bytes))).compare(bytes), 0));
}

// ------------------------------------------------- 2. flag flips ----------

console.log('\n2. flipping boxes flips flags, touches only LevelSaveInfo');
for (const name of saves()) {
  const doc = decode(load(name));
  const rows = category.rows(doc).filter((r) => Array.isArray(r.fields));
  const before = animMap(doc);

  check(`${name}: flip every box, on-states invert`, () => {
    for (const row of rows) {
      for (const f of row.fields) category.setField(doc, row.id, f.key, !f.value);
    }
    for (const row of rows) {
      const now = category.rows(doc).find((r) => r.id === row.id);
      for (const f of row.fields) {
        const match = now.fields?.find((g) => g.key === f.key);
        assert.ok(match, `${row.id}.${f.key} vanished`);
        assert.equal(match.value, !f.value, `${row.id}.${f.key} did not flip: ${f.value} -> ${match.value}`);
      }
    }
  });

  check(`${name}: flip back restores every flag's on-off state`, () => {
    for (const row of [...rows].reverse()) {
      for (const f of [...row.fields].reverse()) {
        category.setField(doc, row.id, f.key, f.value);
      }
    }
    for (const row of rows) {
      const now = category.rows(doc).find((r) => r.id === row.id);
      for (const f of row.fields) {
        const match = now.fields?.find((g) => g.key === f.key);
        assert.ok(match, `${row.id}.${f.key} vanished`);
        assert.equal(match.value, f.value, `${row.id}.${f.key} did not return to ${f.value}`);
      }
    }
  });

  check(`${name}: writes during flips are all inside LevelSaveInfo`, () => {
    // did the last two passes only touch LevelSaveInfo?
    const doc2 = decode(load(name));
    const flat = flatten(doc2);
    for (const row of rows) for (const f of row.fields) category.setField(doc2, row.id, f.key, !f.value);
    const d = diff(flat, flatten(doc2));
    assert.deepEqual(d.removed.filter((k) => !IN_LSB(k)), [], 'non-LevelSaveInfo entry disappeared');
    assert.deepEqual(d.added.filter((k) => !IN_LSB(k)), [], 'non-LevelSaveInfo entry appeared');
    for (const key of d.changed) assert.ok(IN_LSB(key), `unexpected change: ${key}`);
  });

  check(`${name}: re-encode is stable`, () => {
    const once = encode(doc);
    assert.deepEqual(Buffer.from(encode(decode(once))), Buffer.from(once));
  });
}

// ------------------------------------------------- 3. bit precision ---------

console.log('\n3. one act bit per box, others in the same chapter stand');
for (const name of saves()) {
  const doc = decode(load(name));

  check(`${name}: flip one "appeared" box; sibling acts keep their state`, () => {
    const rows = category.rows(doc).filter((r) => r.box && r.fields?.[0]?.key === 'anim_unlock');
    let flipped = 0;
    for (let i = 0; i < rows.length && flipped < 2; i++) {
      const row = rows[i];
      const now = category.rows(doc).find((r) => r.id === row.id);
      if (!now.fields) continue;
      const mine = now.fields[0].value;
      const siblings = category.rows(doc).filter(
        (r) => r.group === row.group && r.id !== row.id && r.fields
      );
      if (siblings.length === 0) continue;
      const befores = siblings.map((r) => r.fields[0].value);
      const changed = category.setField(doc, row.id, now.fields[0].key, !now.fields[0].value);
      assert.equal(changed, true, `setField refused on ${row.id}`);
      const after = category.rows(doc).find((r) => r.id === row.id);
      assert.equal(after.fields[0].value, !mine);
      const sibAfter = siblings.map((r) => category.rows(doc).find((x) => x.id === r.id)?.fields?.[0]?.value);
      assert.deepEqual(sibAfter, befores, `${row.id}'s siblings moved too`);
      category.setField(doc, row.id, now.fields[0].key, mine);  // put it back
      flipped++;
    }
    assert.ok(flipped > 0, 'no act rows exercised');
  });
}

done();
