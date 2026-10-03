/**
 * Exercises the Badges category against the sample saves.
 *
 *   node test/edit-badges.js
 *
 * Checks:
 *   1. rows() always agrees with what the file actually contains
 *   2. a toggle touches nothing outside <bag>.Badges
 *   3. adding then removing a badge restores the document byte-for-byte
 *   4. the badge slot upgrades and badge point counters are left alone
 *   5. hats and flairs are unaffected
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode, encode } from '../src/hat.js';
import badges from '../web/categories/badges.js';
import hats from '../web/categories/hats.js';
import hatFlairs from '../web/categories/hat-flairs.js';
import { locateArray, prop, classId } from '../web/categories/backpack.js';
import { LISTS } from '../web/data/backpack.js';
import { flatten, diff, harness, onlyIn, confined } from './lib.js';

const BADGE_ORDER = LISTS.badges.order;
const BADGE_OBJECTS = LISTS.badges.objects;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (name) => fs.readFileSync(path.join(ROOT, name));
const saves = () => fs.readdirSync(ROOT).filter((f) => f.endsWith('.hat')).sort();

const decodeSave = (name) => decode(new Uint8Array(load(name)));
const entriesOf = (doc) => locateArray(doc, 'Badges')?.arr.value ?? [];

const { check, done } = harness();

const only = (d, what) => {
  try {
    onlyIn(d, '.Badges[');
  } catch (err) {
    throw new Error(`${what}: ${err.message}`);
  }
};

/** Every badge the save has, as bare ids, plus the fields of the badge slots. */
const slotState = (doc) => ({
  slots: doc.properties.find((p) => p.name === 'MyBadgeSlots')?.value,
  points: doc.properties.find((p) => p.name === 'MyBadgePoints')?.value,
  life: doc.properties.find((p) => p.name === 'MyLifeTimeBadgePoints')?.value,
  collectibles: JSON.stringify(locateArray(doc, 'Collectibles')?.arr.value ?? null),
});

const checkedIds = (doc) => badges.rows(doc).filter((r) => r.checked).map((r) => r.id);

// ------------------------------------------------------------- catalog -------

console.log('\ncatalog');

check('every badge has an object path in the same package as the hats', () => {
  assert.deepEqual(Object.keys(BADGE_OBJECTS).sort(), [...BADGE_ORDER].sort());
  const hatPkg = 'hatintimegamecontent';
  for (const [id, object] of Object.entries(BADGE_OBJECTS)) {
    assert.equal(object, `${hatPkg}.${id}`, `${id} resolved to ${object}`);
  }
});

check('badges render as one group plus a save-only group', () => {
  const doc = decodeSave('Deathwish.hat');
  const rows = badges.rows(doc);
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, 'duplicate rows');
  assert.deepEqual([...new Set(rows.map((r) => r.group))], ['badges']);
  assert.equal(badges.groupTitle('badges'), 'All badges');
  assert.equal(badges.groupTitle('other'), 'Not in Collectibles.txt');
  assert.deepEqual(badges.filters, ['all', 'collected', 'uncollected']);
  assert.equal(badges.banner(doc), null);
  assert.ok(rows.every((r) => !r.disabled));
  assert.ok(BADGE_ORDER.every((id) => rows.some((r) => r.id === id)), 'a catalog badge went missing');
});

// -------------------------------------------------------- rows vs. file ------

console.log('\nrows match the file');

for (const name of saves()) {
  const doc = decodeSave(name);

  check(`${name}: checked rows equal the entries in the file`, () => {
    const expected = new Set(entriesOf(doc).map((el) => classId(el)).filter(Boolean));
    for (const row of badges.rows(doc)) {
      assert.equal(row.checked, expected.has(row.id), `row ${row.id}`);
    }
    const ids = [...new Set([...BADGE_ORDER, ...expected])];
    assert.equal(badges.rows(doc).length, ids.length, 'every catalog and save-only id needs a row');
  });
}

check('a badge that is not in Collectibles.txt is labelled, not hidden', () => {
  const doc = decodeSave('DLC2 Hundo.hat');
  const row = badges.rows(doc).find((r) => !BADGE_ORDER.includes(r.id));
  assert.ok(row, 'expected a save-only badge in DLC2 Hundo.hat');
  assert.equal(row.id, 'Light_Ability_AntiGrief');
  assert.equal(row.group, 'other');
  assert.equal(row.note, 'not in Collectibles.txt');
  assert.equal(row.checked, true);
});

check('the catalog badge missing from most saves shows up unchecked', () => {
  for (const name of ['Deathwish.hat', 'CDLC1 Hundo.hat', 'Mod Chapters.hat']) {
    const row = badges.rows(decodeSave(name)).find((r) => r.id === 'Hat_Badge_Scooter_Subcon');
    assert.ok(row, `${name}: row missing`);
    assert.equal(row.checked, false, `${name} should not have it`);
  }
});

// ------------------------------------------------------------- add one -------

console.log('\nadding and removing');

check('a missing badge is written with exactly the fields this save uses', () => {
  const name = 'All Rifts DLC.hat';
  const before = decodeSave(name);
  const doc = decodeSave(name);

  const target = badges.rows(doc).find((r) => !r.checked);
  assert.ok(target, `${name} was expected to be missing a badge`);

  assert.equal(badges.set(doc, target.id, true), true);
  only(diff(flatten(before), flatten(doc)), 'adding a badge');

  const added = entriesOf(doc).at(-1);
  assert.deepEqual(Object.keys(added).sort(), ['class', 'properties']);
  assert.equal(added.class, 'hatintimegamecontent.Hat_BackpackItem');
  assert.deepEqual(added.properties.map((p) => p.name), ['BackpackClass']);
  assert.equal(prop(added, 'BackpackClass').value, BADGE_OBJECTS[target.id]);
  assert.ok(added.properties.every((p) => p.arrayIndex === 0));

  assert.equal(badges.set(doc, target.id, false), true);
  assert.deepEqual(doc, before, 'adding then removing should be a no-op');
});

check('the pre-2017 save keeps its own badge field set', () => {
  const before = decodeSave('1.0 Hundo.hat');
  const doc = decodeSave('1.0 Hundo.hat');

  const target = badges.rows(doc).find((r) => !r.checked);
  assert.ok(target, 'expected a missing badge');
  assert.equal(badges.set(doc, target.id, true), true);
  only(diff(flatten(before), flatten(doc)), 'adding a badge to a legacy save');

  const added = entriesOf(doc).at(-1);
  assert.equal(added.class, undefined, 'the pre-2017 format has no per-element class');
  assert.deepEqual(added.properties.map((p) => p.name), ['ItemQuality', 'LastUseTime', 'BackpackClass']);
  assert.equal(prop(added, 'ItemQuality').value, 'None');
  assert.equal(prop(added, 'BackpackClass').value, BADGE_OBJECTS[target.id]);
  assert.ok(typeof prop(added, 'LastUseTime').value === 'number');

  assert.equal(badges.set(doc, target.id, false), true);
  assert.deepEqual(doc, before);
});

check('an owned badge can be dropped and restored', () => {
  const name = 'Deathwish.hat';
  const before = decodeSave(name);
  const doc = decodeSave(name);

  const target = badges.rows(doc).find((r) => r.checked);
  assert.equal(badges.set(doc, target.id, false), true);
  only(diff(flatten(before), flatten(doc)), 'dropping a badge');
  assert.equal(badges.rows(doc).find((r) => r.id === target.id).checked, false);

  assert.equal(badges.set(doc, target.id, true), true);
  only(diff(flatten(before), flatten(doc)), 'restoring a badge');
  assert.deepEqual(
    entriesOf(doc).map((e) => JSON.stringify(e)).sort(),
    entriesOf(before).map((e) => JSON.stringify(e)).sort(),
    'the set of badge entries should be restored'
  );
});

check('toggling to the state it is already in is a no-op', () => {
  const doc = decodeSave('Deathwish.hat');
  const have = badges.rows(doc).find((r) => r.checked);
  const haveNot = badges.rows(doc).find((r) => !r.checked);
  assert.equal(badges.set(doc, have.id, true), false);
  assert.equal(badges.set(doc, haveNot.id, false), false);
});

// ------------------------------------------------- the things we must not do -

console.log('\nthe badge slot upgrades stay put');

for (const name of saves()) {
  check(`${name}: slots, points and Collectibles survive a badge edit`, () => {
    const doc = decodeSave(name);
    const slotsBefore = slotState(doc);

    // a save that has never collected a badge (both default files have no
    // badge list at all) moves one the other way instead
    const target = badges.rows(doc).find((r) => r.checked) ?? badges.rows(doc).find((r) => !r.checked);
    assert.ok(target, `${name} has no badges at all`);
    assert.equal(badges.set(doc, target.id, !target.checked), true);
    const other = badges.rows(doc).find((r) => !r.checked && r.id !== target.id);
    if (other) assert.equal(badges.set(doc, other.id, true), true);

    assert.deepEqual(slotState(doc), slotsBefore, 'something outside Badges moved');
    assert.ok(
      !entriesOf(doc).some((el) => /BadgeSlot/.test(classId(el) ?? '')),
      'a badge slot upgrade must never appear in the Badges array'
    );
  });
}

check('hats and flairs are unaffected by badge edits', () => {
  const doc = decodeSave('Deathwish.hat');
  const hatsBefore = hats.rows(doc).map((r) => `${r.id}=${r.checked}`);
  const flairsBefore = hatFlairs.rows(doc).map((r) => `${r.id}=${r.checked}`);

  const target = badges.rows(doc).find((r) => !r.checked);
  badges.set(doc, target.id, true);

  assert.deepEqual(hats.rows(doc).map((r) => `${r.id}=${r.checked}`), hatsBefore);
  assert.deepEqual(hatFlairs.rows(doc).map((r) => `${r.id}=${r.checked}`), flairsBefore);
});

// ------------------------------------------------------- survives a file -----

console.log('\nthe edit survives being written out');

for (const name of saves()) {
  check(`${name}: a badge edit round-trips through the encoder`, () => {
    const doc = decodeSave(name);
    // drop one where the save has one, gain one where it has none
    const target = badges.rows(doc).find((r) => r.checked) ?? badges.rows(doc).find((r) => !r.checked);
    assert.ok(target, `${name} has no badges at all`);

    const wanted = !target.checked;
    assert.equal(badges.set(doc, target.id, wanted), true, `${name}: the badge should move`);
    const back = decode(new Uint8Array(encode(doc)));
    assert.deepEqual(entriesOf(back), entriesOf(doc));
    assert.equal(
      badges.rows(back).find((r) => r.id === target.id).checked,
      wanted,
      'the badge came back on the way through the file'
    );
  });
}

// ------------------------------------------------ a mod badge's own package --

console.log('\na mod badge keeps its own package');

check('DLC2 Hundo.hat restores antigriefbadge.Light_Ability_AntiGrief', () => {
  const id = 'Light_Ability_AntiGrief';
  const before = decodeSave('DLC2 Hundo.hat');
  const doc = decodeSave('DLC2 Hundo.hat');
  const read = () =>
    entriesOf(doc)
      .map((el) => prop(el, 'BackpackClass')?.value)
      .find((v) => typeof v === 'string' && v.split('.').pop() === id);

  const original = read();
  assert.equal(original, `antigriefbadge.${id}`);

  assert.equal(badges.set(doc, id, false), true);
  assert.equal(read(), undefined);
  assert.equal(badges.set(doc, id, true), true);
  assert.equal(read(), original, 're-taking it must not guess hatintimegamecontent');
  // confining only: dropping the last badge and picking it back up can restore
  // the array exactly, and there is nothing wrong with that.
  confined(diff(flatten(before), flatten(doc)), '.Badges[');
  assert.equal(badges.rows(doc).find((r) => r.id === id).note, 'not in Collectibles.txt');
});

done();
