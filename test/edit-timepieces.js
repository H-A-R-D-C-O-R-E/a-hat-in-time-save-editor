/**
 * Exercises the web editor's Time Pieces category against the sample saves.
 *
 *   node test/edit-timepieces.js
 *
 * Checks three things:
 *   1. an untouched decode -> encode round-trip is still byte-perfect
 *   2. toggling only changes the properties the category claims to change
 *   3. flipping every row on and off restores the document exactly
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

const top = (doc, name) => doc.properties.find((p) => p.name === name);
const idOf = (el) => el.properties.find((q) => q.name === 'Id')?.value;
const collected = (doc, id) => {
  const el = top(doc, 'TimeObjects')?.value.find((e) => idOf(e) === id);
  return el ? el.properties.find((q) => q.name === 'Collected').value : undefined;
};

const ALLOWED = (k) =>
  k.includes('.TimeObjects[') ||
  k.endsWith('.CurrentCollectedTimePieces[0]') ||
  k.endsWith('.CurrentCollectedTimePieces_Mods[0]');

// ------------------------------------------------------- 1. round-trip -------

console.log('\n1. untouched round-trip');
for (const name of saves()) {
  const bytes = load(name);
  check(name, () => assert.equal(Buffer.from(encode(decode(bytes))).compare(bytes), 0));
}

// ------------------------------------------------- 2. minimal diffs ----------

console.log('\n2. toggling only touches what it claims to');

const cases = [
  { file: '1.0 Hundo.hat', toggle: 'chapter1_tutorial', add: 'Metro_RouteA' },
  { file: 'DLC1 Hundo.hat', toggle: 'Alps_Birdhouse', add: 'Metro_RouteD' },
  { file: 'All Stickers.hat', toggle: 'subcon_cave', add: 'Cruise_Working' },
  // this save already knows every vanilla id, so exercise the template fallback
  { file: 'Deathwish.hat', toggle: 'moon_parade', add: 'Mod:1234567890:TestTimePiece' },
];

for (const c of cases) {
  const doc = decode(load(c.file));
  const before = flatten(doc);
  const counterBefore = top(doc, 'CurrentCollectedTimePieces')?.value;
  const counterModBefore = top(doc, 'CurrentCollectedTimePieces_Mods')?.value;
  const schema = (() => {
    const els = top(doc, 'TimeObjects').value;
    const names = new Set(els.flatMap((e) => e.properties.map((p) => p.name)));
    return { high: names.has('Highscore') ? 'Highscore' : 'HighScore', mod: names.has('IsMod') };
  })();

  check(`${c.file}: uncollect ${c.toggle}`, () => {
    assert.equal(collected(doc, c.toggle), true, 'expected the piece to start collected');
    assert.equal(category.set(doc, c.toggle, false), true, 'set() reported no change');
    assert.equal(collected(doc, c.toggle), false);

    const d = diff(before, flatten(doc));
    assert.deepEqual(d.added, [], 'properties appeared');
    assert.deepEqual(d.removed, [], 'properties disappeared');
    for (const key of d.changed) assert.ok(ALLOWED(key), `unexpected change: ${key}`);
    assert.equal(
      d.changed.filter((k) => k.includes('.TimeObjects[')).length,
      1,
      'exactly one TimeObjects field should change'
    );
  });

  check(`${c.file}: counters stay consistent`, () => {
    const els = top(doc, 'TimeObjects').value;
    const isMod = (e) => !!e.properties.find((p) => p.name === 'IsMod')?.value;
    const isCollected = (e) => !!e.properties.find((p) => p.name === 'Collected')?.value;
    const vanilla = els.filter((e) => isCollected(e) && !isMod(e)).length;
    const mods = els.filter((e) => isCollected(e) && isMod(e)).length;

    const main = top(doc, 'CurrentCollectedTimePieces');
    if (counterBefore === undefined) {
      assert.equal(main, undefined, 'the counter must not be invented');
    } else {
      assert.ok(main, 'the counter was removed');
      assert.equal(main.value, vanilla, 'CurrentCollectedTimePieces out of sync');
      assert.equal(main.value, counterBefore - 1, 'counter should have dropped by one');
    }

    const modCounter = top(doc, 'CurrentCollectedTimePieces_Mods');
    if (counterModBefore === undefined) {
      assert.equal(modCounter, undefined, 'the mod counter must not be invented');
    } else {
      assert.equal(modCounter.value, mods, 'CurrentCollectedTimePieces_Mods out of sync');
    }
  });

  check(`${c.file}: re-encode is stable`, () => {
    const once = encode(doc);
    assert.deepEqual(Buffer.from(encode(decode(once))), Buffer.from(once));
  });

  const doc2 = decode(load(c.file));
  const before2 = flatten(doc2);
  const sizeBefore = top(doc2, 'TimeObjects').value.length;

  check(`${c.file}: collect "${c.add}" which this save does not have`, () => {
    assert.equal(collected(doc2, c.add), undefined, 'the save already has this id');
    assert.equal(category.set(doc2, c.add, true), true, 'set() reported no change');
    assert.equal(collected(doc2, c.add), true);

    const els = top(doc2, 'TimeObjects').value;
    assert.equal(els.length, sizeBefore + 1, 'an element was not appended');
    const added = els[els.length - 1];
    const wanted = ['Id', 'Collected', 'Paid', schema.high, 'IsAct'];
    if (schema.mod) wanted.push('IsMod', 'ModPackage');
    assert.deepEqual(added.properties.map((p) => p.name), wanted, 'wrong field set on the new element');
    assert.ok(added.properties.every((p) => p.arrayIndex === 0), 'arrayIndex must be 0');
    assert.equal(
      added.properties.find((p) => p.name === 'IsAct').value,
      !/^(TimeRift|Spaceship)_/.test(c.add),
      'IsAct guess is wrong'
    );

    const d = diff(before2, flatten(doc2));
    assert.deepEqual(d.removed, []);
    assert.deepEqual(d.added.filter((k) => !k.includes('.TimeObjects[')), [],
      'properties appeared outside TimeObjects');
    assert.deepEqual(d.changed.filter((k) => !ALLOWED(k)), [], 'unrelated properties changed');
  });

  check(`${c.file}: uncollecting an id the save no longer has is a no-op`, () => {
    const arr = top(doc2, 'TimeObjects');
    arr.value.pop();
    const size = arr.value.length;
    assert.equal(category.set(doc2, c.add, false), false, 'expected a no-op');
    assert.equal(arr.value.length, size, 'a no-op must not append anything');
  });
}

// ------------------------------------------------ 3. whole-document flip ----

console.log('\n3. flipping every row restores the document');
for (const name of saves()) {
  check(name, () => {
    const doc = decode(load(name));
    const snapshot = JSON.stringify(doc);
    const rows = category.rows(doc);

    assert.ok(rows.length >= 56, `expected at least the 56 known ids, got ${rows.length}`);
    assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, 'duplicate row ids');

    const keys = [...new Set(rows.map((r) => r.group))];
    assert.ok(keys.length > 0, 'no groups produced');
    assert.equal(keys.length, new Set(keys).size, 'duplicate group keys');

    // Only touch rows the save already has, so nothing is appended.
    const present = rows.filter((r) => r.present);
    const original = new Map(present.map((r) => [r.id, r.checked]));
    for (const row of present) assert.equal(category.set(doc, row.id, !row.checked), true);
    for (const row of present) {
      assert.equal(collected(doc, row.id), !original.get(row.id), `${row.id} did not flip`);
    }
    for (const row of present) assert.equal(category.set(doc, row.id, original.get(row.id)), true);

    assert.equal(JSON.stringify(doc), snapshot, 'the document was not restored exactly');
  });
}

done();

