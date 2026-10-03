/**
 * Exercises the Hats and Hat Flairs categories against the sample saves.
 *
 *   node test/edit-hats.js
 *
 * Checks:
 *   1. rows() always agrees with what the file actually contains
 *   2. a toggle touches nothing outside <bag>.Hats
 *   3. adding then removing an item restores the document byte-for-byte
 *   4. the two categories never affect each other
 *   5. the pre-2017 save cannot be given flairs, and is left untouched
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode, encode } from '../src/hat.js';
import hats from '../web/categories/hats.js';
import hatFlairs from '../web/categories/hat-flairs.js';
import { locateArray, cosmeticCapable, prop, classId, flairId } from '../web/categories/backpack.js';
import { ORDER as HAT_ORDER, OBJECTS as HAT_OBJECTS, FLAIR_ORDER, FLAIR_OBJECTS } from '../web/data/hats.js';
import { flatten, diff, harness, onlyIn } from './lib.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (name) => fs.readFileSync(path.join(ROOT, name));
const saves = () => fs.readdirSync(ROOT).filter((f) => f.endsWith('.hat')).sort();

const decodeSave = (name) => decode(new Uint8Array(load(name)));
const entriesOf = (doc) => locateArray(doc, 'Hats')?.arr.value ?? [];

const { check, done } = harness();

/**
 * The Hats array as an order-independent multiset of entries, ignoring
 * LastUseTime. Re-collecting an item always writes a *fresh* entry, so a value
 * the file happened to record for "last used" is not recoverable — everything
 * else must match exactly.
 */
const signature = (doc) =>
  entriesOf(doc)
    .map((e) => JSON.stringify(e.properties.filter((p) => p.name !== 'LastUseTime')))
    .sort();

const only = (d, what) => {
  try {
    onlyIn(d, '.Hats[');
  } catch (err) {
    throw new Error(`${what}: ${err.message}`);
  }
};

// ------------------------------------------------------------- catalog -------

console.log('\ncatalog');

check('every flair is placed on a known hat', () => {
  const known = new Set(HAT_ORDER);
  assert.deepEqual(Object.keys(FLAIR_OBJECTS).sort(), [...FLAIR_ORDER].sort());
  for (const [flair, rec] of Object.entries(FLAIR_OBJECTS)) {
    assert.ok(known.has(rec.hat), `${flair} sits on unknown hat ${rec.hat}`);
    assert.ok(HAT_OBJECTS[rec.hat], `${flair}'s hat ${rec.hat} has no object path`);
    assert.ok(rec.object.endsWith(`.${flair}`), `${flair}: odd object path ${rec.object}`);
  }
});

check('flair groups use the hat display names, in Hats-section order', () => {
  const keys = [...new Set(Object.values(FLAIR_OBJECTS).map((r) => r.hat))];
  keys.sort(hatFlairs.compareGroups);
  assert.deepEqual(
    keys.map(hatFlairs.groupTitle),
    ['Default Hat', 'Sprint Hat', 'Brewer Hat', 'Ice Hat', 'Dweller Mask', 'Time Stop Hat'],
    `titles were ${keys.map(hatFlairs.groupTitle).join(', ')}`
  );
  assert.deepEqual(
    keys,
    HAT_ORDER,
    'groups should be ordered exactly as the Hats section lists them'
  );
  assert.equal(hats.groupTitle('hats'), 'All hats');
  assert.equal(hats.groupTitle('other'), 'Not in Collectibles.txt');
});

// -------------------------------------------------------- rows vs. file ------

console.log('\nrows match the file');

for (const name of saves()) {
  const doc = decodeSave(name);

  check(`${name}: hat rows equal the plain entries`, () => {
    const expected = new Set(
      entriesOf(doc)
        .filter((el) => flairId(el) === undefined)
        .map((el) => classId(el))
        .filter(Boolean)
    );
    const rows = hats.rows(doc);
    assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, 'duplicate rows');
    for (const row of rows) assert.equal(row.checked, expected.has(row.id), `row ${row.id}`);
    assert.ok(HAT_ORDER.every((id) => rows.some((r) => r.id === id)), 'a catalog hat went missing');
    assert.ok(rows.every((r) => !r.disabled), 'hats should always be editable');
  });

  check(`${name}: flair rows equal the ItemQualityInfoName values`, () => {
    const expected = new Set(entriesOf(doc).map((el) => flairId(el)).filter(Boolean));
    const rows = hatFlairs.rows(doc);
    assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, 'duplicate rows');
    for (const row of rows) assert.equal(row.checked, expected.has(row.id), `row ${row.id}`);
    assert.ok(FLAIR_ORDER.every((id) => rows.some((r) => r.id === id)), 'a catalog flair went missing');
  });
}

// ------------------------------------------------------------- add one -------

console.log('\nadding an item');

check('a missing hat can be collected and then un-collected exactly', () => {
  const name = 'All Rifts DLC.hat';
  const before = decodeSave(name);
  const doc = decodeSave(name);

  const missing = hats.rows(doc).find((r) => !r.checked);
  assert.ok(missing, `${name} was expected to be missing a hat`);
  assert.equal(missing.id, 'Hat_Ability_TimeStop');

  assert.equal(hats.set(doc, missing.id, true), true);
  const d1 = diff(flatten(before), flatten(doc));
  only(d1, 'collecting a hat');

  const added = entriesOf(doc).at(-1);
  assert.deepEqual(
    added.properties.map((p) => p.name),
    ['LastUseTime', 'BackpackClass'],
    'a modern plain entry is {LastUseTime, BackpackClass}'
  );
  assert.equal(prop(added, 'BackpackClass').value, HAT_OBJECTS[missing.id]);

  assert.equal(hats.set(doc, missing.id, false), true);
  assert.deepEqual(doc, before, 'collecting then un-collecting should be a no-op');
});

check('an owned hat can be dropped and its flairs survive', () => {
  const name = 'Deathwish.hat';
  const before = decodeSave(name);
  const doc = decodeSave(name);

  const owned = hats.rows(doc).find((r) => r.checked);
  const beforeFlairs = entriesOf(doc).filter((el) => flairId(el));

  assert.equal(hats.set(doc, owned.id, false), true);
  only(diff(flatten(before), flatten(doc)), 'dropping a hat');
  assert.equal(hats.rows(doc).find((r) => r.id === owned.id).checked, false);
  assert.deepEqual(
    entriesOf(doc).filter((el) => flairId(el)),
    beforeFlairs,
    'every flair entry should be untouched'
  );

  assert.equal(hats.set(doc, owned.id, true), true);
  only(diff(flatten(before), flatten(doc)), 'restoring a hat');
  assert.deepEqual(signature(doc), signature(before), 'the set of entries should be restored');
  assert.equal(hats.rows(doc).find((r) => r.id === owned.id).checked, true);
});

check('collecting an already-collected hat changes nothing', () => {
  const doc = decodeSave('Deathwish.hat');
  const owned = hats.rows(doc).find((r) => r.checked);
  assert.equal(hats.set(doc, owned.id, true), false);
});

check('an unchecked flair is written as exactly three fields', () => {
  const name = 'Deathwish.hat';
  const before = decodeSave(name);
  const doc = decodeSave(name);

  const target = hatFlairs.rows(doc).find((r) => !r.checked);
  assert.ok(target, 'expected at least one unchecked flair');
  const rec = FLAIR_OBJECTS[target.id];
  assert.ok(rec, `${target.id} is not in the catalog`);

  assert.equal(hatFlairs.set(doc, target.id, true), true);
  only(diff(flatten(before), flatten(doc)), 'adding a flair');

  const added = entriesOf(doc).at(-1);
  assert.deepEqual(
    added.properties.map((p) => p.name),
    ['ItemQualityInfo', 'ItemQualityInfoName', 'BackpackClass']
  );
  assert.equal(prop(added, 'ItemQualityInfo').value, rec.object);
  assert.equal(prop(added, 'ItemQualityInfoName').value, target.id);
  assert.equal(prop(added, 'BackpackClass').value, HAT_OBJECTS[rec.hat]);
  assert.equal(prop(added, 'LastUseTime'), undefined, 'LastUseTime must not be invented');
});

check('adding then removing a flair restores the document exactly', () => {
  const name = 'Deathwish.hat';
  const before = decodeSave(name);
  const doc = decodeSave(name);

  const target = hatFlairs.rows(doc).find((r) => !r.checked);
  assert.equal(hatFlairs.set(doc, target.id, true), true);
  assert.equal(hatFlairs.set(doc, target.id, false), true);
  assert.deepEqual(doc, before);
});

check('an owned flair can be dropped and restored', () => {
  const name = 'Deathwish.hat';
  const before = decodeSave(name);
  const doc = decodeSave(name);

  const target = hatFlairs.rows(doc).find((r) => r.checked);
  assert.equal(hatFlairs.set(doc, target.id, false), true);
  only(diff(flatten(before), flatten(doc)), 'dropping a flair');
  assert.equal(hatFlairs.rows(doc).find((r) => r.id === target.id).checked, false);

  assert.equal(hatFlairs.set(doc, target.id, true), true);
  only(diff(flatten(before), flatten(doc)), 'restoring a flair');
  assert.deepEqual(signature(doc), signature(before));
});

// ---------------------------------------------------------- independence -----

console.log('\nthe two categories stay independent');

check('collecting a hat does not change any flair row', () => {
  const doc = decodeSave('All Rifts DLC.hat');
  const before = hatFlairs.rows(doc).map((r) => `${r.id}=${r.checked}`);
  hats.set(doc, 'Hat_Ability_TimeStop', true);
  assert.deepEqual(
    hatFlairs.rows(doc).map((r) => `${r.id}=${r.checked}`),
    before,
    'adding a hat flipped a flair'
  );
});

check('collecting a flair does not change any hat row', () => {
  const doc = decodeSave('Deathwish.hat');
  const before = hats.rows(doc).map((r) => `${r.id}=${r.checked}`);
  const target = hatFlairs.rows(doc).find((r) => !r.checked);
  hatFlairs.set(doc, target.id, true);
  assert.deepEqual(
    hats.rows(doc).map((r) => `${r.id}=${r.checked}`),
    before,
    'adding a flair flipped a hat'
  );
  assert.equal(hats.rows(doc).filter((r) => r.checked).length, 6);
});

// ---------------------------------------------------------- legacy save ------

console.log('\nthe pre-2017 save');

check('1.0 Hundo.hat reports that it cannot hold flairs', () => {
  const doc = decodeSave('1.0 Hundo.hat');
  assert.equal(cosmeticCapable(locateArray(doc, 'Hats')), false);
  assert.match(hatFlairs.banner(doc), /pre-2017/);

  const rows = hatFlairs.rows(doc);
  assert.ok(rows.every((r) => r.disabled), 'every flair row should be inert');
  assert.ok(rows.every((r) => !r.checked), 'no flairs can be collected');
  assert.equal(hats.banner(doc), null, 'hats should still be editable');
  assert.ok(hats.rows(doc).every((r) => !r.disabled));
});

check('attempting to add a flair to it changes nothing', () => {
  const name = '1.0 Hundo.hat';
  const original = load(name);
  const doc = decodeSave(name);
  const target = hatFlairs.rows(doc)[0];

  assert.equal(hatFlairs.set(doc, target.id, true), false);
  assert.deepEqual(Buffer.from(encode(doc)), original, 'the save should be untouched');
});

check('hats on it are still editable, using its own field set', () => {
  const before = decodeSave('1.0 Hundo.hat');
  const doc = decodeSave('1.0 Hundo.hat');
  const target = hats.rows(doc)[0];
  assert.equal(target.id, 'Hat_Ability_Help');

  // Everything that is not this hat must come through untouched.
  const others = (d) =>
    entriesOf(d)
      .filter((el) => classId(el) !== target.id)
      .map((e) => JSON.stringify(e.properties))
      .sort();
  const beforeOthers = others(before);

  assert.equal(hats.set(doc, target.id, false), true);
  only(diff(flatten(before), flatten(doc)), 'dropping a hat from a legacy save');
  assert.equal(hats.rows(doc).find((r) => r.id === target.id).checked, false);
  assert.deepEqual(others(doc), beforeOthers, 'other hats must be untouched');

  assert.equal(hats.set(doc, target.id, true), true);
  only(diff(flatten(before), flatten(doc)), 'restoring a legacy hat');
  assert.equal(hats.rows(doc).find((r) => r.id === target.id).checked, true);
  assert.deepEqual(others(doc), beforeOthers, 'other hats must be untouched');

  // This save stores four plain entries for the same hat; re-collecting yields
  // one, in the pre-2017 field set.
  const plain = entriesOf(doc).filter(
    (el) => classId(el) === target.id && flairId(el) === undefined
  );
  assert.equal(plain.length, 1);
  assert.deepEqual(plain[0].properties.map((p) => p.name), ['ItemQuality', 'LastUseTime', 'BackpackClass']);
  assert.equal(prop(plain[0], 'ItemQuality').value, 'None');
});

// ------------------------------------------------------- survives a file -----

console.log('\nthe edit survives being written out');

for (const name of saves()) {
  if (!cosmeticCapable(locateArray(decodeSave(name), 'Hats'))) continue;

  check(`${name}: an added flair round-trips through the encoder`, () => {
    const doc = decodeSave(name);
    const target = hatFlairs.rows(doc).find((r) => !r.checked);
    assert.ok(target, `${name} has no unchecked flair to add`);

    hatFlairs.set(doc, target.id, true);
    const back = decode(new Uint8Array(encode(doc)));
    assert.deepEqual(entriesOf(back), entriesOf(doc));
    assert.equal(
      hatFlairs.rows(back).find((r) => r.id === target.id).checked,
      true,
      'the flair was lost on the way through the file'
    );
  });
}

done();
