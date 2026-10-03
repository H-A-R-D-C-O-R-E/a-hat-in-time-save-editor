/**
 * Exercises the five new backpack lists — Dyes, Stickers, Weapons, Remixes and
 * Camera Filters — against the sample saves.
 *
 *   node test/edit-backpack-lists.js
 *
 * Checks:
 *   1. rows() always agrees with what the file actually contains
 *   2. a toggle touches nothing outside <bag>.<list>
 *   3. adding then removing restores the document
 *   4. edits survive being written out
 *   5. placeholder entries (CDLC1's 296 empty remixes) are left alone
 *   6. a mod item keeps its own package when it is dropped and re-taken
 *   7. the pre-2017 save refuses the three lists it never had
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

const IDS = ['dyes', 'stickers', 'weapons', 'remixes', 'filters'];
const CATS = IDS.map((id) => {
  const cat = CATEGORIES.find((c) => c.id === id);
  assert.ok(cat, `category ${id} is not registered`);
  return cat;
});

const entriesOf = (doc, list) => locateArray(doc, LISTS[list].array)?.arr.value ?? [];
const idsOf = (doc, list) =>
  new Set(entriesOf(doc, list).map((el) => classId(el)).filter(Boolean));

const { check, done } = harness();

const only = (d, where, what) => {
  try {
    onlyIn(d, where);
  } catch (err) {
    throw new Error(`${what}: ${err.message}`);
  }
};

/** Same, but an untouched document counts as success (a perfect restore). */
const within = (d, where, what) => {
  try {
    confined(d, where);
  } catch (err) {
    throw new Error(`${what}: ${err.message}`);
  }
};

const blocked = (cat, doc) => cat.banner(doc) !== null;

// -------------------------------------------------------- rows vs. file ------

console.log('\nrows match the file');

for (const name of saves()) {
  const doc = decodeSave(name);

  check(`${name}: every list's rows agree with its array`, () => {
    for (const list of IDS) {
      const cat = CATEGORIES.find((c) => c.id === list);
      const present = idsOf(doc, list);
      const rows = cat.rows(doc);

      for (const row of rows) {
        assert.equal(row.checked, present.has(row.id), `${list}/${row.id}`);
        assert.ok(row.label, `${list}/${row.id} has no label`);
        assert.ok(
          row.disabled === blocked(cat, doc),
          `${list}/${row.id} disabled=${row.disabled} but banner=${!blocked(cat, doc)}`
        );
      }

      const expected = new Set([...LISTS[list].order, ...present]);
      assert.equal(rows.length, expected.size, `${list}: row count`);
      assert.ok(cat.compareGroups(list, 'other') < 0, `${list}: catalog group ranks first`);
      assert.equal(cat.filters.includes('absent'), false, `${list}: no "absent" chip`);
    }
  });
}

check('save-only items are labelled rather than hidden', () => {
  const doc = decodeSave('DLC1 Hundo.hat');
  const dyes = CATEGORIES.find((c) => c.id === 'dyes').rows(doc);
  const saveOnly = dyes.filter((r) => r.group === 'other');
  assert.ok(saveOnly.length >= 6, 'DLC1 Hundo.hat should carry mod dyes');
  assert.ok(saveOnly.every((r) => r.note === 'not in Collectibles.txt'));
  assert.ok(saveOnly.every((r) => r.checked), 'they are all unlocked in that save');

  const angel = dyes.find((r) => r.id === 'Xara_MaterialDye_Angel');
  assert.ok(angel, 'expected a save-only dye row');
  assert.equal(angel.note, 'not in Collectibles.txt');
  assert.equal(angel.checked, true);
});

check('catalog ids missing from a save are listed unchecked', () => {
  const doc = decodeSave('All Rifts DLC.hat');
  const weapons = CATEGORIES.find((c) => c.id === 'weapons').rows(doc);
  const missing = weapons.filter((r) => !r.checked);
  assert.ok(missing.length > 0, 'expected some locked weapons');
  assert.ok(weapons.every((r) => r.checked === idsOf(doc, 'weapons').has(r.id)));
});

// ---------------------------------------------------- add and remove one -----

console.log('\nadding and removing');

check('a missing item is written with exactly the fields this save uses', () => {
  const name = 'Deathwish.hat';
  const before = decodeSave(name);
  const doc = decodeSave(name);

  for (const list of IDS) {
    const cat = CATEGORIES.find((c) => c.id === list);
    const target = cat.rows(doc).find((r) => !r.checked);
    assert.ok(target, `${list}: expected an unchecked row in ${name}`);

    assert.equal(cat.set(doc, target.id, true), true, `${list}: set() changed nothing`);
    only(diff(flatten(before), flatten(doc)), `.${LISTS[list].array}[`, `adding ${list}`);

    const added = entriesOf(doc, list).at(-1);
    assert.deepEqual(
      Object.keys(added).sort(),
      ['class', 'properties'],
      `${list}: a modern entry is class + properties`
    );
    assert.equal(added.class, 'hatintimegamecontent.Hat_BackpackItem');
    assert.deepEqual(added.properties.map((p) => p.name), ['BackpackClass']);
    assert.equal(prop(added, 'BackpackClass').value, LISTS[list].objects[target.id]);
    assert.ok(added.properties.every((p) => p.arrayIndex === 0));
    assert.equal(cat.rows(doc).find((r) => r.id === target.id).checked, true);

    assert.equal(cat.set(doc, target.id, false), true);
    assert.deepEqual(doc, before, `${list}: add then remove should be a no-op`);
  }
});

check('the pre-2017 save keeps its own field set for the lists it has', () => {
  const before = decodeSave('1.0 Hundo.hat');
  const doc = decodeSave('1.0 Hundo.hat');

  for (const list of ['dyes', 'remixes']) {
    const cat = CATEGORIES.find((c) => c.id === list);
    const target = cat.rows(doc).find((r) => !r.checked);
    assert.ok(target, `${list}: expected an unchecked row`);

    assert.equal(cat.set(doc, target.id, true), true);
    only(diff(flatten(before), flatten(doc)), `.${LISTS[list].array}[`, `legacy ${list}`);

    const added = entriesOf(doc, list).at(-1);
    assert.equal(added.class, undefined, `${list}: no per-element class in the old format`);
    assert.deepEqual(
      added.properties.map((p) => p.name),
      ['ItemQuality', 'LastUseTime', 'BackpackClass'],
      `${list}: legacy field set`
    );
    assert.equal(prop(added, 'ItemQuality').value, 'None');
    assert.equal(prop(added, 'BackpackClass').value, LISTS[list].objects[target.id]);

    assert.equal(cat.set(doc, target.id, false), true);
    assert.deepEqual(doc, before, `${list}: add then remove should be a no-op`);
  }
});

check('taking an item and giving it back restores the list', () => {
  for (const name of ['Deathwish.hat', 'CDLC1 Hundo.hat']) {
    for (const list of IDS) {
      const before = decodeSave(name);
      const doc = decodeSave(name);
      const cat = CATEGORIES.find((c) => c.id === list);
      const target = cat.rows(doc).find((r) => r.checked);
      // a save with nothing in that list has nothing to take away
      if (!target) continue;

      assert.equal(cat.set(doc, target.id, false), true);
      only(diff(flatten(before), flatten(doc)), `.${LISTS[list].array}[`, `${list} removal`);
      assert.equal(idsOf(doc, list).has(target.id), false);

      assert.equal(cat.set(doc, target.id, true), true);
      within(diff(flatten(before), flatten(doc)), `.${LISTS[list].array}[`, `${list} restore`);
      assert.deepEqual([...idsOf(doc, list)].sort(), [...idsOf(before, list)].sort(),
        `${list}: the id set should come back`);
    }
  }
});

check('toggling to the state it is already in is a no-op', () => {
  const doc = decodeSave('Deathwish.hat');
  for (const list of IDS) {
    const cat = CATEGORIES.find((c) => c.id === list);
    const rows = cat.rows(doc);
    const have = rows.find((r) => r.checked);
    const haveNot = rows.find((r) => !r.checked);
    if (have) assert.equal(cat.set(doc, have.id, true), false, list);
    assert.ok(haveNot, `${list}: expected an unchecked row`);
    assert.equal(cat.set(doc, haveNot.id, false), false, list);
  }
});

// ------------------------------------------------------------- round-trip ----

console.log('\nthe edit survives being written out');

for (const name of saves()) {
  check(`${name}: a list edit round-trips through the encoder`, () => {
    let changed = 0;
    const doc = decodeSave(name);

    for (const list of IDS) {
      const cat = CATEGORIES.find((c) => c.id === list);
      if (blocked(cat, doc)) continue;
      const target = cat.rows(doc).find((r) => r.checked);
      if (!target) continue;
      cat.set(doc, target.id, false);
      changed += 1;
    }
    assert.ok(changed > 0, `${name}: nothing to drop`);

    const back = decode(new Uint8Array(encode(doc)));
    for (const list of IDS) assert.deepEqual(entriesOf(back, list), entriesOf(doc, list), list);
  });
}

// ----------------------------------------------------------- placeholders ----

console.log('\nplaceholder entries');

check('CDLC1 Hundo.hat keeps its 296 empty remix entries', () => {
  const before = decodeSave('CDLC1 Hundo.hat');
  const doc = decodeSave('CDLC1 Hundo.hat');
  const empties = (d) => entriesOf(d, 'remixes').filter((e) => e.properties.length === 0);
  assert.equal(empties(before).length, 296);
  assert.equal(CATS.find((c) => c.id === 'remixes').rows(doc).length, 9,
    'placeholders must not become rows');

  const cat = CATS.find((c) => c.id === 'remixes');
  const target = cat.rows(doc).find((r) => r.checked);
  assert.equal(cat.set(doc, target.id, false), true);
  assert.equal(empties(doc).length, 296, 'removing a remix must not touch placeholders');
  assert.equal(cat.set(doc, target.id, true), true);
  assert.equal(empties(doc).length, 296, 'restoring a remix must not touch placeholders');
});

check('a placeholder never counts as collected', () => {
  const doc = decodeSave('CDLC1 Hundo.hat');
  const remixes = CATS.find((c) => c.id === 'remixes').rows(doc);
  assert.ok(remixes.every((r) => r.id && r.id !== 'undefined'));
  assert.equal(remixes.filter((r) => r.checked).length, 8);
});

// --------------------------------------------------- a mod item's package ----

console.log('\nmod items keep their own package');

// The same bare id is `radicaldyes2.` in three saves and `raddyepack.` in
// another — dropping it and picking it back up has to restore *that save's*
// path, not a guess.
const PACKAGE_CASES = [
  { file: 'DLC1 Hundo.hat', id: 'Xara_MaterialDye_AstralDye', pkg: 'raddyepack' },
  { file: 'All Rifts DLC.hat', id: 'Xara_MaterialDye_AstralDye', pkg: 'radicaldyes2' },
  { file: 'DLC2 Hundo.hat', id: 'Xara_MaterialDye_AstralDye', pkg: 'radicaldyes2' },
  { file: 'CDLC1 Hundo.hat', id: 'Tag_Collectible_Skin_Violet', pkg: 'vanessacursemod' },
  { file: 'DLC1 Hundo.hat', id: 'Hat_Weapon_memory', pkg: 'ultra_silence' },
  { file: 'DLC2 Hundo.hat', id: 'Werti_Collectible_Sticker_OOHH', pkg: 'metrojamconduc' },
];

for (const c of PACKAGE_CASES) {
  check(`${c.file}: ${c.id} comes back as ${c.pkg}.${c.id}`, () => {
    const before = decodeSave(c.file);
    const doc = decodeSave(c.file);
    const list = IDS.find((k) => idsOf(doc, k).has(c.id));
    assert.ok(list, `${c.file}: ${c.id} is not in any list this test covers`);

    const cat = CATS.find((x) => x.id === list);
    const original = entriesOf(doc, list)
      .map((el) => prop(el, 'BackpackClass')?.value)
      .find((v) => typeof v === 'string' && v.split('.').pop() === c.id);
    assert.equal(original, `${c.pkg}.${c.id}`);

    assert.equal(cat.set(doc, c.id, false), true);
    assert.equal(idsOf(doc, list).has(c.id), false);

    assert.equal(cat.set(doc, c.id, true), true);
    const restored = entriesOf(doc, list)
      .map((el) => prop(el, 'BackpackClass')?.value)
      .find((v) => typeof v === 'string' && v.split('.').pop() === c.id);
    assert.equal(restored, original, 'the package must be the one this save used');
    assert.deepEqual([...idsOf(doc, list)].sort(), [...idsOf(before, list)].sort(),
      'the id set should come back');
    within(diff(flatten(before), flatten(doc)), `.${LISTS[list].array}[`, 'restore');
  });
}

// ----------------------------------------------------- the pre-2017 refusal --

console.log('\nthe three lists the pre-2017 save never had');

for (const list of ['stickers', 'weapons', 'filters']) {
  check(`1.0 Hundo.hat refuses ${list}`, () => {
    const before = decodeSave('1.0 Hundo.hat');
    const doc = decodeSave('1.0 Hundo.hat');
    const cat = CATS.find((c) => c.id === list);

    const banner = cat.banner(doc);
    assert.ok(banner, 'expected a banner');
    assert.match(banner, new RegExp(LISTS[list].array));

    const rows = cat.rows(doc);
    assert.ok(rows.every((r) => r.disabled), 'every row should be inert');
    assert.ok(rows.some((r) => !r.checked), 'there should be something to want');

    assert.equal(cat.set(doc, rows.find((r) => !r.checked).id, true), false);
    assert.deepEqual(doc, before, 'nothing may be written');
    assert.equal(locateArray(doc, LISTS[list].array), null, 'no list may appear');
  });
}

check('the pre-2017 save still edits the two lists it does have', () => {
  const doc = decodeSave('1.0 Hundo.hat');
  for (const list of ['dyes', 'remixes']) {
    const cat = CATS.find((c) => c.id === list);
    assert.equal(cat.banner(doc), null, list);
    assert.ok(cat.rows(doc).every((r) => !r.disabled), list);
  }
});

done();
