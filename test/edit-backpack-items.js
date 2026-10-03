/**
 * Exercises the Backpack category — the Collectibles array, which unlike the
 * six plain backpack lists carries a *count* per item.
 *
 *   node test/edit-backpack-items.js
 *
 * Checks:
 *   1. rows() agrees with the file: ownership is the entry, count is its Amount
 *   2. decorations (same array, other section) and placeholders never appear
 *   3. a toggle touches nothing outside <bag>.Collectibles
 *   4. adding then removing restores the document, in both bag formats
 *   5. counts are written to Amount, in the slot the saves keep it
 *   6. count 0 drops the entry instead of writing a zero no save stores
 *   7. an entry with no Amount reads as 1 and gains one only when asked
 *   8. the edits survive being written out and read back
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode, encode } from '../src/hat.js';
import { CATEGORIES } from '../web/registry.js';
import { locateArray, classId, prop } from '../web/categories/backpack.js';
import { LISTS } from '../web/data/backpack.js';
import { flatten, diff, harness, onlyIn, confined } from './lib.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (name) => fs.readFileSync(path.join(ROOT, name));
const saves = () => fs.readdirSync(ROOT).filter((f) => f.endsWith('.hat')).sort();
const decodeSave = (name) => decode(new Uint8Array(load(name)));

const cat = CATEGORIES.find((c) => c.id === 'backpack');
assert.ok(cat, 'category backpack is not registered');

const ORDER = LISTS.collectibles.order;
const ARRAY = LISTS.collectibles.array;
const entriesOf = (doc) => locateArray(doc, ARRAY)?.arr.value ?? [];
const entryOf = (doc, id) => entriesOf(doc).find((el) => classId(el) === id) ?? null;
const countOf = (doc, id) => {
  const el = entryOf(doc, id);
  if (!el) return 0;
  const amt = prop(el, 'Amount')?.value;
  return typeof amt === 'number' ? amt : 1;
};

const { check, done } = harness();

const only = (d, where, what) => {
  try {
    onlyIn(d, where);
  } catch (err) {
    throw new Error(`${what}: ${err.message}`);
  }
};

const within = (d, where, what) => {
  try {
    confined(d, where);
  } catch (err) {
    throw new Error(`${what}: ${err.message}`);
  }
};

// -------------------------------------------------------- rows vs. file ------

console.log('\nrows match the file');

for (const name of saves()) {
  const doc = decodeSave(name);

  check(`${name}: every row agrees with its entry`, () => {
    const rows = cat.rows(doc);
    const canEdit = cat.banner(doc) === null;

    for (const row of rows) {
      const el = entryOf(doc, row.id);
      assert.equal(row.checked, !!el, `${row.id}: ownership`);
      assert.equal(row.disabled, !canEdit, `${row.id}: disabled vs banner`);
      assert.equal(row.label, row.id, `${row.id}: internal names stay put`);

      assert.deepEqual(
        row.fields.map((f) => `${f.key}:${f.type}`),
        ['owned:checkbox', 'count:number'],
        `${row.id}: a box and a count`
      );
      assert.equal(row.fields[0].value, !!el, `${row.id}: the box`);
      assert.equal(row.fields[1].value, el ? countOf(doc, row.id) : 0, `${row.id}: the count`);
    }

    const saveOnly = rows.filter((r) => r.group === 'other');
    const catalogued = new Set([...ORDER, ...saveOnly.map((r) => r.id)]);
    assert.equal(rows.length, catalogued.size, 'row count');
    assert.ok(rows.every((r) => r.id && r.id !== 'None'), 'placeholders are not rows');
    assert.equal(
      rows.some((r) => r.id.startsWith('Hat_Collectible_Decoration_')),
      false,
      'decorations belong to another section'
    );
    assert.ok(saveOnly.every((r) => r.note === 'not in Collectibles.txt'));
    assert.ok(cat.compareGroups('backpack', 'other') < 0, 'the catalog ranks first');
    assert.equal(cat.filters.includes('absent'), false, 'no "absent" chip');
    assert.equal(cat.groupTitle('backpack'), 'All backpack items');
  });
}

check('the row count is the catalog, plus the ids only this save carries', () => {
  assert.equal(ORDER.length, 24);
  assert.equal(cat.rows(decodeSave('Deathwish.hat')).length, 24);

  const dlc2 = cat.rows(decodeSave('DLC2 Hundo.hat'));
  assert.equal(dlc2.length, 25);
  const key = dlc2.find((r) => r.id === 'hat_Collectible_ShortCut_Key');
  assert.ok(key, 'the mod key should be listed');
  assert.equal(key.group, 'other');
  assert.equal(key.checked, true, 'DLC2 Hundo.hat has it');
  assert.equal(key.note, 'not in Collectibles.txt');
});

check('decorations sit in the same array and are still left alone', () => {
  const before = decodeSave('Deathwish.hat');
  const doc = decodeSave('Deathwish.hat');
  const decorations = entriesOf(doc).filter((el) =>
    String(classId(el) ?? '').startsWith('Hat_Collectible_Decoration_')
  );
  assert.ok(decorations.length >= 10, 'Deathwish.hat should carry decorations');

  const target = cat.rows(doc).find((r) => !r.checked);
  const deco = (d) =>
    entriesOf(d).filter((el) => String(classId(el) ?? '').startsWith('Hat_Collectible_Decoration_'));
  assert.equal(cat.set(doc, target.id, true), true);
  assert.deepEqual(deco(doc), deco(before), 'adding must not move a decoration');
  assert.equal(cat.set(doc, target.id, false), true);
  assert.deepEqual(doc, before, 'touching a backpack item must not move a decoration');
});

check('CDLC1 keeps its 133 empty Collectibles placeholders', () => {
  const before = decodeSave('CDLC1 Hundo.hat');
  const doc = decodeSave('CDLC1 Hundo.hat');
  const empties = (d) => entriesOf(d).filter((e) => e.properties.length === 0);
  // CDLC1 pads Collectibles with 133 entries that carry nothing at all
  assert.equal(empties(before).length, 133);

  const target = cat.rows(doc).find((r) => !r.checked);
  assert.equal(cat.set(doc, target.id, true), true);
  assert.equal(empties(doc).length, 133, 'adding must not touch placeholders');
  assert.equal(cat.set(doc, target.id, false), true);
  assert.equal(empties(doc).length, 133, 'removing must not touch placeholders');
  assert.deepEqual(doc, before);
});

// ---------------------------------------------------- add and remove one -----

console.log('\nadding and removing');

check('a missing item is written with exactly the fields this save uses', () => {
  const name = 'Deathwish.hat';
  const before = decodeSave(name);
  const doc = decodeSave(name);
  const target = cat.rows(doc).find((r) => !r.checked);
  assert.ok(target, 'expected an unchecked row');

  assert.equal(cat.set(doc, target.id, true), true);
  only(diff(flatten(before), flatten(doc)), `.${ARRAY}[`, 'adding');

  const added = entriesOf(doc).at(-1);
  assert.deepEqual(Object.keys(added).sort(), ['class', 'properties']);
  assert.equal(added.class, 'hatintimegamecontent.Hat_CollectibleBackpackItem');
  assert.deepEqual(added.properties.map((p) => p.name), ['Amount', 'BackpackClass']);
  assert.equal(prop(added, 'Amount').type, 'IntProperty');
  assert.equal(prop(added, 'Amount').value, 1, 'a freshly granted item: one of it');
  assert.equal(prop(added, 'BackpackClass').value, LISTS.collectibles.objects[target.id]);
  assert.ok(added.properties.every((p) => p.arrayIndex === 0));
  assert.equal(cat.rows(doc).find((r) => r.id === target.id).checked, true);

  assert.equal(cat.set(doc, target.id, false), true);
  assert.deepEqual(doc, before, 'add then remove should be a no-op');
});

check('the pre-2017 save keeps its own field set', () => {
  const before = decodeSave('1.0 Hundo.hat');
  const doc = decodeSave('1.0 Hundo.hat');
  const target = cat.rows(doc).find((r) => !r.checked);
  assert.ok(target, 'expected an unchecked row');

  assert.equal(cat.banner(doc), null, 'this save does have a Collectibles list');
  assert.ok(cat.rows(doc).every((r) => !r.disabled));

  assert.equal(cat.set(doc, target.id, true), true);
  only(diff(flatten(before), flatten(doc)), `.${ARRAY}[`, 'legacy add');

  const added = entriesOf(doc).at(-1);
  assert.equal(added.class, undefined, 'no per-element class in the old format');
  assert.deepEqual(
    added.properties.map((p) => p.name),
    ['CollectibleInstance', 'Amount', 'BackpackClass'],
    'legacy field set, in the order the save writes it'
  );
  assert.equal(prop(added, 'CollectibleInstance').value, 'None');
  assert.equal(prop(added, 'BackpackClass').value, LISTS.collectibles.objects[target.id]);

  assert.equal(cat.set(doc, target.id, false), true);
  assert.deepEqual(doc, before, 'add then remove should be a no-op');
});

check('toggling to the state it is already in is a no-op', () => {
  for (const name of saves()) {
    const doc = decodeSave(name);
    const rows = cat.rows(doc);
    const have = rows.find((r) => r.checked);
    const haveNot = rows.find((r) => !r.checked);
    if (have) assert.equal(cat.set(doc, have.id, true), false, `${name}/${have.id}`);
    if (haveNot) assert.equal(cat.set(doc, haveNot.id, false), false, `${name}/${haveNot.id}`);
    assert.equal(cat.setField(doc, rows[0].id, 'nope', true), false, 'unknown key');
  }
});

check('taking an item and giving it back restores the id set', () => {
  for (const name of ['Deathwish.hat', 'CDLC1 Hundo.hat']) {
    const before = decodeSave(name);
    const doc = decodeSave(name);
    const target = cat.rows(doc).find((r) => r.checked);
    assert.ok(target, `${name}: expected a collected row`);

    assert.equal(cat.set(doc, target.id, false), true);
    only(diff(flatten(before), flatten(doc)), `.${ARRAY}[`, `${name} removal`);
    assert.equal(entryOf(doc, target.id), null);

    assert.equal(cat.set(doc, target.id, true), true);
    within(diff(flatten(before), flatten(doc)), `.${ARRAY}[`, `${name} restore`);
    const ids = (d) => entriesOf(d).map((el) => classId(el)).filter(Boolean).sort();
    assert.deepEqual(ids(doc), ids(before), 'the id set should come back');
  }
});

// ------------------------------------------------------------- counts -------

console.log('\ncounts');

check('a count is written to Amount, where the saves keep it', () => {
  const before = flatten(decodeSave('Deathwish.hat'));
  const doc = decodeSave('Deathwish.hat');
  const id = 'Hat_Collectible_BadgePart_Sprint';
  assert.equal(countOf(doc, id), 20, 'Deathwish.hat carries 20 of these');

  assert.equal(cat.setField(doc, id, 'count', 171), true);
  only(diff(before, flatten(doc)), `.${ARRAY}[`, 'count edit');
  assert.equal(prop(entryOf(doc, id), 'Amount').value, 171);
  assert.equal(cat.rows(doc).find((r) => r.id === id).fields[1].value, 171);

  assert.equal(cat.setField(doc, id, 'count', 171), false, 'the same count is no change');
  assert.equal(cat.setField(doc, id, 'count', '20'), true, 'a string count is still a count');
  assert.equal(prop(entryOf(doc, id), 'Amount').value, 20);
  assert.equal(countOf(doc, id), 20);
});

check('a count of 0 drops the entry rather than writing a zero', () => {
  const before = decodeSave('Deathwish.hat');
  const doc = decodeSave('Deathwish.hat');
  const id = 'Hat_Collectible_BadgePart_FoxMask';

  assert.equal(cat.setField(doc, id, 'count', 0), true);
  assert.equal(entryOf(doc, id), null, 'the entry goes, because no save stores a zero');
  assert.equal(cat.rows(doc).find((r) => r.id === id).checked, false);
  only(diff(flatten(before), flatten(doc)), `.${ARRAY}[`, 'zero count');

  assert.equal(cat.setField(doc, id, 'count', 0), false, 'already nothing');
  assert.equal(cat.set(doc, id, false), false, 'the box agrees');
  assert.equal(cat.set(doc, id, true), true, 'and can be had back');
  assert.equal(countOf(doc, id), 1);
});

check('an unreadable count changes nothing', () => {
  const before = flatten(decodeSave('Deathwish.hat'));
  const doc = decodeSave('Deathwish.hat');
  const id = 'Hat_Collectible_BadgePart_Chemical';
  assert.equal(countOf(doc, id), 17);

  for (const bad of [null, undefined, '', '   ', 'abc', NaN, Infinity]) {
    assert.equal(cat.setField(doc, id, 'count', bad), false, `count ${String(bad)}`);
  }
  assert.deepEqual(flatten(doc), before, 'nothing may be written for an unreadable count');
});

check('a count is clamped to the int32 the field holds', () => {
  const doc = decodeSave('Deathwish.hat');
  const id = 'Tag_Collectible_Soul';

  assert.equal(cat.setField(doc, id, 'count', 1e12), true);
  assert.equal(prop(entryOf(doc, id), 'Amount').value, 2147483647);
  assert.equal(cat.setField(doc, id, 'count', 4.7), true, 'fractions round down');
  assert.equal(prop(entryOf(doc, id), 'Amount').value, 4);
  assert.equal(cat.setField(doc, id, 'count', -3), true, 'negative clamps to none');
  assert.equal(entryOf(doc, id), null);
});

check('an entry with no Amount reads as 1 and gains one only when asked', () => {
  const name = 'CDLC1 Hundo.hat';
  const before = flatten(decodeSave(name));
  const doc = decodeSave(name);
  const id = 'Hat_Collectible_VaultCode';
  assert.equal(prop(entryOf(doc, id), 'Amount'), undefined, 'the game omits it for vault codes');
  assert.equal(countOf(doc, id), 1, 'so it reads as one');

  let row = cat.rows(doc).find((r) => r.id === id);
  assert.equal(row.checked, true, 'the entry is there');
  assert.equal(row.fields[1].value, 1);

  assert.equal(cat.setField(doc, id, 'count', 1), false, 'asking for what it already reads as');
  assert.deepEqual(flatten(doc), before, 'and nothing is written for it');

  assert.equal(cat.setField(doc, id, 'count', 3), true);
  only(diff(before, flatten(doc)), `.${ARRAY}[`, 'first Amount');
  assert.equal(prop(entryOf(doc, id), 'Amount').value, 3);
  assert.deepEqual(
    entryOf(doc, id).properties.map((p) => p.name),
    ['Amount', 'BackpackClass'],
    'Amount takes the slot the other entries use'
  );

  assert.equal(cat.setField(doc, id, 'count', 1), true, 'back down to one is a real write');
  assert.equal(prop(entryOf(doc, id), 'Amount').value, 1);
});

check('the box and the count drive the same entry', () => {
  const doc = decodeSave('Deathwish.hat');
  const id = 'Hat_Collectible_BirdPassport';
  const row = () => cat.rows(doc).find((r) => r.id === id);
  assert.equal(row().checked, false);

  assert.equal(cat.setField(doc, id, 'count', 7), true, 'a count gives you the item');
  assert.equal(row().checked, true);
  assert.equal(row().fields[0].value, true);
  assert.equal(row().fields[1].value, 7);

  assert.equal(cat.setField(doc, id, 'owned', false), true, 'unticking takes it away');
  assert.equal(row().checked, false);
  assert.equal(row().fields[1].value, 0, 'and the count goes with it');
});

// ------------------------------------------------------------- round-trip ----

console.log('\nthe edit survives being written out');

for (const name of saves()) {
  check(`${name}: a backpack edit round-trips through the encoder`, () => {
    const doc = decodeSave(name);

    const wanted = cat.rows(doc).find((r) => !r.checked) ?? cat.rows(doc)[0];
    const had = entryOf(doc, wanted.id);
    if (had) cat.set(doc, wanted.id, false);
    else cat.set(doc, wanted.id, true);
    cat.setField(doc, 'Tag_Collectible_Soul', 'count', 6938);

    const back = decode(new Uint8Array(encode(doc)));
    assert.deepEqual(entriesOf(back), entriesOf(doc), 'the whole array comes back');
    assert.deepEqual(back, doc, 'and so does the document');
  });
}

// ------------------------------------------------ a save with no list -------

console.log('\na save with no Collectibles list');

check('it gets a banner and does nothing, rather than inventing a field', () => {
  const doc = decodeSave('1.0 Hundo.hat');
  const bag = doc.properties.find((p) => p.name === 'MyBackpack');
  bag.value.splice(bag.value.findIndex((p) => p.name === ARRAY), 1);
  const before = flatten(doc);

  const banner = cat.banner(doc);
  assert.ok(banner, 'expected a banner');
  assert.match(banner, /Collectibles/);

  const rows = cat.rows(doc);
  assert.equal(rows.length, ORDER.length, 'the catalog is still listed');
  assert.ok(rows.every((r) => r.disabled), 'every row should be inert');
  assert.ok(rows.every((r) => !r.checked));

  const id = rows[0].id;
  assert.equal(cat.set(doc, id, true), false);
  assert.equal(cat.setField(doc, id, 'count', 5), false);
  assert.equal(cat.setField(doc, id, 'owned', true), false);
  assert.equal(locateArray(doc, ARRAY), null, 'no list may appear');
  assert.deepEqual(flatten(doc), before, 'nothing may be written');
});

done();
