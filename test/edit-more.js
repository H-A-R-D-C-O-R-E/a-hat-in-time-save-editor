/**
 * Exercises the "More" category — the leftover scalar fields and the three
 * small tables at the top level of a save.
 *
 *   node test/edit-more.js
 *
 * Checks:
 *   1. rows() only reads, on every save on disk
 *   2. every row agrees with the file, and every label is the raw id
 *   3. a scalar edit touches only that property
 *   4. an absent scalar is created where the game keeps it, and taken back out
 *      byte for byte when it is cleared again
 *   5. values are validated before anything is written
 *   6. a field the game wrote is kept at zero, one we created is removed
 *   7. secret levels grow and shrink UnlockedSecretLevels only
 *   8. challenge roads grow and shrink ChallengeRoadIDs only
 *   9. the three contract boxes write their own list, with a qualified path
 *  10. ActBits entries are built the way the game builds them
 *  11. everything the category promises to leave alone stays put
 *  12. a batch of edits survives the encoder on all 10 saves
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode, encode } from '../src/hat.js';
import more from '../web/categories/more.js';
import { SECRET_LEVELS, ACT_FLAGS, CONTRACT_ORDER, CHALLENGE_ROADS } from '../web/data/more.js';
import { flatten, diff, confined, harness } from './lib.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (name) => fs.readFileSync(path.join(ROOT, name));
const saves = () => fs.readdirSync(ROOT).filter((f) => f.endsWith('.hat')).sort();
const decodeSave = (name) => decode(new Uint8Array(load(name)));
const bytes = (doc) => Buffer.from(encode(doc));
const top = (doc, name) => doc.properties.find((p) => p.name === name);
const listOf = (doc, name) => top(doc, name)?.value ?? [];
const unqualify = (v) => (typeof v === 'string' ? v.split('.').pop() : null);
/** A challenge road is its level ids — the save and the file order them apart. */
const roadKey = (id) => String(id).split('_').sort().join('_');

const SCALARS = [
  'LastPlayTime', 'TotalPlayTime', 'ActPlayTime', 'NumReloads',
  'MyBadgePoints', 'MyLifeTimeBadgePoints', 'MyEnergyBits', 'MyBadgeSlots',
  'CurrentChapter', 'CurrentAct', 'CurrentCheckpoint', 'CreationTimeStamp',
  'AllowSaving',
];
/** The three lists, in the order a contract row shows its boxes. */
const CONTRACT_LISTS = [
  'CompletedSnatcherContracts',
  'TurnedInSnatcherContracts',
  'SnatcherContracts',
];
const SCALAR_GROUPS = ['stats', 'time', 'state'];
/** Fields no other category owns either — the ones this one must never touch. */
const NEVER = [
  '.SketchingData[', '.HUBDecorations[', '.SpeedrunTimeObjects[',
  '.TimeObjects[', '.CurrentCollectedTimePieces[', '.CurrentCollectedTimePieces_Mods[',
  '.LevelSaveInfo[', '.MyBackpack[', '.MyBackpack2017[', '.Loadouts[',
  '.PlayerCharacterType[',
];
const strays = (d) => [...d.removed, ...d.added, ...d.changed]
  .filter((k) => NEVER.some((prefix) => k.startsWith(prefix)));

const { check, done } = harness();

// ------------------------------------------------------------ what the file says --

console.log('\nwhat the saves already say');

check('rows() only reads — looking at a save never edits it', () => {
  for (const name of saves()) {
    const doc = decodeSave(name);
    const before = flatten(doc);
    more.rows(doc);
    more.rows(doc);
    assert.deepEqual(flatten(doc), before, `${name}: rows() must not write`);
  }
});

check('every row agrees with the file, and every label is the raw id', () => {
  for (const name of saves()) {
    const doc = decodeSave(name);
    const rows = more.rows(doc);
    const byId = new Map(rows.map((r) => [r.id, r]));
    assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, `${name}: ids are unique`);

    for (const id of SCALARS) {
      const row = byId.get(id);
      assert.ok(row, `${name}: missing row for ${id}`);
      assert.equal(row.label, id, `${name}: labels are raw ids`);

      const prop = top(doc, id);
      assert.equal(row.present, prop !== undefined, `${name}: ${id} presence`);
      if (id === 'AllowSaving') {
        assert.equal(row.fields, undefined, `${name}: AllowSaving is one plain box`);
        assert.equal(row.checked, prop ? !!prop.value : false, `${name}: AllowSaving`);
      } else {
        const field = row.fields?.[0];
        assert.equal(field?.type, 'number', `${name}: ${id} needs a number field`);
        const value = prop?.value ?? 0;
        assert.equal(field.value, value, `${name}: ${id} value`);
        assert.equal(row.checked, value !== 0, `${name}: ${id} tick`);
        assert.equal(field.min <= value && value <= field.max, true, `${name}: ${id} in range`);
      }
    }

    const unlocked = new Set(listOf(doc, 'UnlockedSecretLevels'));
    for (const id of SECRET_LEVELS) {
      const row = byId.get(id);
      assert.ok(row, `${name}: secret level ${id} not listed`);
      assert.equal(row.label, id, `${name}: labels are raw ids`);
      assert.equal(row.checked, unlocked.has(id), `${name}: ${id}`);
      assert.equal(row.present, undefined, `${name}: an unlocked box is not "present"`);
      assert.equal(row.mod, id.startsWith('Mod:'), `${name}: mod tag for ${id}`);
    }

    // Challenge roads, keyed by the ids they hold: the save and Collectibles.txt
    // write the same chain in opposite orders
    const roadRows = new Map(rows.filter((r) => r.group === 'roads')
      .map((r) => [roadKey(r.id), r]));
    const fileWording = new Map(listOf(doc, 'ChallengeRoadIDs')
      .map((id) => [roadKey(id), id]));
    const catalogWording = new Map(CHALLENGE_ROADS.map((id) => [roadKey(id), id]));

    for (const id of CHALLENGE_ROADS) {
      assert.ok(roadRows.has(roadKey(id)), `${name}: challenge road ${id} not listed`);
    }
    for (const [key, row] of roadRows) {
      const inCatalog = catalogWording.has(key);
      const carried = fileWording.get(key);
      assert.equal(row.id, row.label, `${name}: a road is labelled with its own id`);
      assert.equal(row.label, carried ?? catalogWording.get(key),
        `${name}: this save's wording, the catalog's otherwise`);
      assert.equal(row.checked, carried !== undefined, `${name}: ${row.id}`);
      assert.equal(row.note, inCatalog ? null : 'not in Collectibles.txt',
        `${name}: ${row.id} note`);
      assert.equal(row.present, undefined, `${name}: a road box is not "present"`);
      assert.equal(row.fields, undefined, `${name}: a road is one plain box`);
      assert.ok(inCatalog || carried, `${name}: ${row.id} comes from somewhere`);
    }

    for (const id of CONTRACT_ORDER) {
      const row = byId.get(id);
      assert.ok(row, `${name}: contract ${id} not listed`);
      assert.deepEqual(row.fields.map((f) => f.type), ['checkbox', 'checkbox', 'checkbox']);
      assert.deepEqual(row.fields.map((f) => f.value),
        CONTRACT_LISTS.map((list) => listOf(doc, list).some((v) => unqualify(v) === id)),
        `${name}: ${id} boxes`);
      assert.equal(row.checked, row.fields.some((f) => f.value), `${name}: ${id} tick`);
      assert.equal(row.note, null, `${name}: ${id} is in Collectibles.txt`);
    }

    for (const id of ACT_FLAGS) {
      const row = byId.get(id);
      assert.ok(row, `${name}: ActBits flag ${id} not listed`);
      const entry = listOf(doc, 'ActBits')
        .find((e) => e.properties.find((p) => p.name === 'IdName')?.value === id);
      const bits = entry?.properties.find((p) => p.name === 'Bits')?.value;
      assert.equal(row.present, entry !== undefined, `${name}: ${id} presence`);
      assert.equal(row.fields[0].value, entry ? bits : 0, `${name}: ${id} value`);
      assert.equal(row.checked, row.fields[0].value !== 0, `${name}: ${id} tick`);
    }
  }
});

check('the catalog is offered in full, with the groups in order', () => {
  const rows = more.rows(decodeSave('Deathwish.hat'));
  const ids = new Set(rows.map((r) => r.id));
  for (const id of SCALARS) assert.ok(ids.has(id), `${id} should be a row`);
  assert.ok(ids.has('MyEnergyBits'), 'pons are the point of this category');
  assert.ok(ids.has('TotalPlayTime'), 'and play time');
  assert.equal(rows.filter((r) => r.group === 'contracts').length >= CONTRACT_ORDER.length, true);
  assert.equal(rows.filter((r) => r.group === 'actbits').length >= ACT_FLAGS.length, true);
  assert.equal(rows.filter((r) => r.group === 'secrets').length >= SECRET_LEVELS.length, true);
  assert.equal(rows.filter((r) => r.group === 'roads').length >= CHALLENGE_ROADS.length, true);

  const groups = [...new Set(rows.map((r) => r.group))].sort(more.compareGroups);
  assert.deepEqual(groups,
    ['stats', 'time', 'state', 'secrets', 'roads', 'contracts', 'actbits']);
  assert.deepEqual(groups.map((g) => more.groupTitle(g)),
    ['Stats', 'Play time', 'Save state', 'Secret levels', 'Challenge roads',
      'Snatcher contracts', 'ActBits']);
  assert.equal(more.banner, undefined, 'nothing here is ever refused as a whole');
});

check('a mod-made secret level is only offered to the save that carries it', () => {
  // rows are "catalog ∪ whatever this save carries", and the catalog is vanilla
  // only — a `Mod:` rift belongs to the content pack that made it
  assert.ok(SECRET_LEVELS.length > 0, 'there are vanilla rifts to offer');
  assert.deepEqual(SECRET_LEVELS.filter((id) => id.startsWith('Mod:')), [],
    'the catalog must not carry mod ids into unmodded saves');

  for (const name of saves()) {
    const doc = decodeSave(name);
    const unlocked = new Set(listOf(doc, 'UnlockedSecretLevels'));
    const offered = more.rows(doc)
      .filter((r) => r.group === 'secrets' && r.id.startsWith('Mod:'))
      .map((r) => r.id)
      .sort();
    assert.deepEqual(offered,
      [...unlocked].filter((id) => id.startsWith('Mod:')).sort(),
      `${name}: a Mod: rift appears only when this save has it`);
    assert.deepEqual(more.rows(doc).filter((r) => r.mod).map((r) => r.id), offered,
      `${name}: the mod tag marks exactly those rows`);
  }

  // an unmodded save is offered the vanilla catalog and nothing more
  const secrets = more.rows(decodeSave('Deathwish.hat')).filter((r) => r.group === 'secrets');
  assert.equal(secrets.length, SECRET_LEVELS.length, 'no extra rows for a save without mods');
  assert.ok(secrets.every((r) => !r.mod));
});

// ------------------------------------------------------------------ scalars ------

console.log('\nscalar fields');

check('editing a scalar touches only that property', () => {
  for (const name of saves()) {
    const doc = decodeSave(name);
    const before = decodeSave(name);
    assert.equal(more.setField(doc, 'MyEnergyBits', 'value', 4321), true, `${name}: write`);
    confined(diff(flatten(before), flatten(doc)), 'MyEnergyBits');
    assert.equal(top(doc, 'MyEnergyBits').value, 4321, `${name}: the value`);
    assert.equal(more.setField(doc, 'MyEnergyBits', 'value', 4321), false,
      `${name}: the same value changes nothing`);
  }
});

check('an absent scalar is created, and cleared away byte for byte', () => {
  let exercised = 0;
  for (const name of saves()) {
    const original = load(name);
    const doc = decodeSave(name);
    // a *number* row this save has no record of — AllowSaving is a box, not a
    // number, and the ActBits rows have numbers of their own
    const row = more.rows(doc).find((r) => SCALAR_GROUPS.includes(r.group)
      && r.present === false && r.fields?.[0]?.type === 'number');
    if (!row) continue;
    exercised += 1;

    assert.equal(more.setField(doc, row.id, 'value', 5), true, `${name}: create ${row.id}`);
    // the field's own type: a float row steps by anything, an int one by 1
    const made = top(doc, row.id);
    const expectedType = row.fields[0].step === 'any' ? 'FloatProperty' : 'IntProperty';
    assert.deepEqual(made,
      { name: row.id, type: expectedType, arrayIndex: 0, value: 5 },
      `${name}: written the way the game writes it`);
    assert.equal(more.rows(doc).find((r) => r.id === row.id).present, true,
      `${name}: it is in the save now`);

    assert.equal(more.setField(doc, row.id, 'value', 0), true, `${name}: clearing`);
    assert.equal(top(doc, row.id), undefined, `${name}: zero and absent are the same thing`);
    assert.equal(bytes(doc).compare(original), 0, `${name}: byte for byte`);
  }
  assert.ok(exercised >= 5, `expected several saves to be missing a field, saw ${exercised}`);
});

check('a created field lands between the properties the game keeps beside it', () => {
  const doc = decodeSave('Deathwish.hat');
  const names = () => doc.properties.map((p) => p.name);

  assert.equal(more.setField(doc, 'MyEnergyBits', 'value', 5), true);
  assert.equal(names().indexOf('MyEnergyBits'),
    names().indexOf('MyLifeTimeBadgePoints') + 1,
    'MyEnergyBits sits right after MyLifeTimeBadgePoints, where every save keeps it');

  assert.equal(more.setField(doc, 'Hat_SnatcherContract_FeedSpider', 'completed', true), true);
  assert.equal(more.setField(doc, 'Hat_SnatcherContract_FeedSpider', 'turnedIn', true), true);
  assert.equal(more.setField(doc, 'Hat_SnatcherContract_FeedSpider', 'available', true), true);
  assert.ok(names().indexOf('SnatcherContracts') < names().indexOf('CompletedSnatcherContracts'),
    'the offered pool comes first');
  assert.ok(names().indexOf('CompletedSnatcherContracts')
    < names().indexOf('TurnedInSnatcherContracts'));
  assert.ok(names().indexOf('TurnedInSnatcherContracts') < names().indexOf('MyBackpack2017'),
    'and all three sit in front of the backpack');

  // a fresh save, where UnlockedSecretLevels does not exist yet
  const fresh = decodeSave('hat kid default file.hat');
  const freshNames = () => fresh.properties.map((p) => p.name);
  const secret = more.rows(fresh).find((r) => r.group === 'secrets' && !r.checked);
  assert.ok(secret, 'a fresh save has locked levels');
  assert.equal(more.set(fresh, secret.id, true), true);
  assert.equal(freshNames().indexOf('UnlockedSecretLevels'),
    freshNames().indexOf('NumReloads') + 1,
    'the new list goes behind NumReloads, in front of TimeObjects');
});

check('values are validated before anything is written', () => {
  const doc = decodeSave('Deathwish.hat');
  const before = flatten(doc);
  const refuse = (id, key, value) =>
    assert.equal(more.setField(doc, id, key, value), false, `${id} = ${JSON.stringify(value)}`);

  refuse('MyEnergyBits', 'value', null);        // emptied box
  refuse('MyEnergyBits', 'value', '12');        // not a number
  refuse('MyEnergyBits', 'value', 1.5);         // an int32 field
  refuse('MyEnergyBits', 'value', 2 ** 31);     // past int32
  refuse('TotalPlayTime', 'value', null);
  refuse('TotalPlayTime', 'value', Number.NaN);
  refuse('TotalPlayTime', 'value', 1e39);       // past float32
  refuse('LastPlayTime', 'value', -(2 ** 31) - 1);
  refuse('AllowSaving', 'value', 4);            // a box, not a number
  refuse('no_such_row', 'value', 1);
  assert.equal(more.set(doc, 'MyEnergyBits', true), false, 'a number has no "checked"');
  assert.equal(more.set(doc, 'no_such_row', true), false, 'unknown row');
  assert.equal(more.setField(doc, 'Hat_SnatcherContract_IceWall', 'bogus', true), false,
    'unknown field key');
  assert.equal(more.setField(doc, 'LastPlayTime', 'completed', true), false,
    'a contract key on a scalar row');
  assert.deepEqual(flatten(doc), before, 'a refused edit writes nothing');
});

check('a field the game wrote is kept at zero, one we created is removed', () => {
  // kept: this save really does track NumReloads, so zero stays in the file
  const kept = decodeSave('Deathwish.hat');
  assert.equal(more.setField(kept, 'NumReloads', 'value', 0), true);
  assert.equal(top(kept, 'NumReloads').value, 0, 'still there, now zero');
  assert.equal(more.setField(kept, 'NumReloads', 'value', 0), false, 'and that is a no-op');
  assert.equal(more.setField(kept, 'NumReloads', 'value', 38), true, 'back to its old value');

  // removed: Deathwish.hat has no AllowSaving at all
  const original = load('Deathwish.hat');
  const made = decodeSave('Deathwish.hat');
  assert.equal(more.set(made, 'AllowSaving', true), true);
  assert.equal(top(made, 'AllowSaving').value, true);
  assert.equal(more.set(made, 'AllowSaving', false), true);
  assert.equal(top(made, 'AllowSaving'), undefined, 'ours goes with the edit that made it');
  assert.equal(bytes(made).compare(original), 0, 'byte for byte');

  // a game-written false is a real field: unticking writes false, not nothing
  const fresh = decodeSave('hat kid default file.hat');
  assert.equal(more.set(fresh, 'AllowSaving', false), false, 'already false');
  assert.equal(more.set(fresh, 'AllowSaving', true), true);
  assert.equal(more.set(fresh, 'AllowSaving', false), true);
  assert.equal(top(fresh, 'AllowSaving').value, false, 'kept, because the file had it');
});

// ------------------------------------------------------------- secret levels -----

console.log('\nsecret levels');

check('a secret level grows and shrinks UnlockedSecretLevels only', () => {
  const name = 'hat kid default file.hat';
  const original = load(name);
  const doc = decodeSave(name);
  assert.equal(top(doc, 'UnlockedSecretLevels'), undefined, 'a fresh save has no list');

  const id = SECRET_LEVELS[0];
  assert.equal(more.rows(doc).find((r) => r.id === id).checked, false);
  assert.equal(more.set(doc, id, true), true, 'ticking unlocks it');
  const list = top(doc, 'UnlockedSecretLevels');
  assert.deepEqual(list.value, [id], 'one string, exactly as written');
  assert.equal(list.elementType, 'string');
  assert.equal(more.set(doc, id, true), false, 'already unlocked');

  assert.equal(more.set(doc, id, false), true, 'unticking takes it out');
  assert.equal(top(doc, 'UnlockedSecretLevels'), undefined, 'and the list we invented with it');
  assert.equal(bytes(doc).compare(original), 0, 'the file we started with');
});

check('a list the game wrote survives being emptied', () => {
  const name = 'Deathwish.hat';
  const doc = decodeSave(name);
  const had = [...listOf(doc, 'UnlockedSecretLevels')];
  assert.ok(had.length > 0, 'this save has secret levels');

  for (const id of had) assert.equal(more.set(doc, id, false), true, `${id} out`);
  const list = top(doc, 'UnlockedSecretLevels');
  assert.ok(list, 'the game wrote it, so it stays');
  assert.deepEqual(list.value, [], 'empty, but still in the file');

  assert.equal(more.set(doc, had[0], false), false, 'nothing to remove');
  const extra = SECRET_LEVELS.find((id) => !had.includes(id));
  assert.equal(more.set(doc, extra, true), true);
  assert.deepEqual(list.value, [extra]);
  confined(diff(flatten(decodeSave(name)), flatten(doc)), 'UnlockedSecretLevels');
});

// --------------------------------------------------------- challenge roads -----

console.log('\nchallenge roads');

check('a challenge road grows and shrinks ChallengeRoadIDs only', () => {
  const name = 'hat kid default file.hat';
  const original = load(name);
  const doc = decodeSave(name);
  assert.equal(top(doc, 'ChallengeRoadIDs'), undefined, 'a fresh save has no list');

  const id = CHALLENGE_ROADS[0];
  assert.equal(more.rows(doc).find((r) => r.id === id).checked, false);
  assert.equal(more.set(doc, id, true), true, 'ticking banks it');
  const list = top(doc, 'ChallengeRoadIDs');
  assert.deepEqual(list.value, [id], 'one string, exactly as written');
  assert.equal(list.elementType, 'string');
  assert.equal(more.set(doc, id, true), false, 'already banked');
  confined(diff(flatten(decodeSave(name)), flatten(doc)), 'ChallengeRoadIDs');

  const names = () => doc.properties.map((p) => p.name);
  assert.equal(names().indexOf('ChallengeRoadIDs'), names().indexOf('Loadouts') + 1,
    'the new list goes behind Loadouts, where every save keeps it');
  assert.ok(names().indexOf('ChallengeRoadIDs') < names().indexOf('CreationTimeStamp'),
    'and in front of the fields after it');

  assert.equal(more.set(doc, id, false), true, 'unticking takes it out');
  assert.equal(top(doc, 'ChallengeRoadIDs'), undefined, 'and the list we invented with it');
  assert.equal(bytes(doc).compare(original), 0, 'the file we started with');
});

check('the ChallengeRoadIDs the game wrote survives being emptied', () => {
  // a save whose every road the catalog knows: emptying the list and putting
  // it all back leaves the file exactly as it was
  const name = 'DLC2 Hundo.hat';
  const original = load(name);
  const doc = decodeSave(name);
  const had = [...listOf(doc, 'ChallengeRoadIDs')];
  assert.equal(had.length, 2, 'this save has banked two roads');

  for (const id of had) assert.equal(more.set(doc, id, false), true, `${id} out`);
  const list = top(doc, 'ChallengeRoadIDs');
  assert.ok(list, 'the game wrote it, so it stays');
  assert.deepEqual(list.value, [], 'empty, but still in the file');
  assert.equal(more.set(doc, had[0], false), false, 'nothing to remove');

  for (const id of had) assert.equal(more.set(doc, id, true), true, `${id} back`);
  assert.deepEqual(list.value, had, 'the wording and the order the game wrote');
  assert.equal(bytes(doc).compare(original), 0, 'the file we started with');
  confined(diff(flatten(decodeSave(name)), flatten(doc)), 'ChallengeRoadIDs');

  // and the save with the longest list, road by road
  const big = decodeSave('CDLC1 Hundo.hat');
  const roads = [...listOf(big, 'ChallengeRoadIDs')];
  assert.ok(roads.length > had.length, 'this save has banked far more roads');
  for (const id of roads) assert.equal(more.set(big, id, false), true, `${id} out`);
  assert.deepEqual(listOf(big, 'ChallengeRoadIDs'), [], 'empty, but still in the file');
  confined(diff(flatten(decodeSave('CDLC1 Hundo.hat')), flatten(big)), 'ChallengeRoadIDs');
});

check('roads are matched by the ids they hold, and only one is unlisted', () => {
  // Collectibles.txt writes every road the other way round from the saves, so
  // the comparison is by ids held; exactly one road on disk is not listed —
  // the partial `2299859278_2649503587` — and it is the only one still shown
  // with a "not in Collectibles.txt" tag.
  assert.equal(CHALLENGE_ROADS.filter((id) => !/^\d+(_\d+)*$/.test(id)).length, 0,
    'every catalog road is a chain of ids');

  for (const name of saves()) {
    const doc = decodeSave(name);
    const rows = more.rows(doc).filter((r) => r.group === 'roads');
    const unlisted = rows.filter((r) => r.note !== null);
    const carried = listOf(doc, 'ChallengeRoadIDs')
      .filter((id) => !CHALLENGE_ROADS.some((c) => roadKey(c) === roadKey(id)));
    assert.deepEqual(unlisted.map((r) => r.id), carried,
      `${name}: the untagged rows are exactly the unlisted roads`);
    assert.ok(unlisted.every((r) => r.checked), `${name}: they came out of the save`);
  }

  const doc = decodeSave('CDLC1 Hundo.hat');
  assert.deepEqual(listOf(doc, 'ChallengeRoadIDs')
    .filter((id) => !CHALLENGE_ROADS.some((c) => roadKey(c) === roadKey(id))),
  ['2299859278_2649503587'], 'the partial road is the only one Collectibles.txt lacks');
  assert.ok(CHALLENGE_ROADS.some((c) => roadKey(c) === roadKey('2299859278_2649503587_2778599067')),
    'the full road it is a prefix of is listed');
});

check('a road written the other way round still reads as the same road', () => {
  const doc = decodeSave('DLC2 Hundo.hat');
  const carried = listOf(doc, 'ChallengeRoadIDs');
  const catalogWording = CHALLENGE_ROADS
    .filter((id) => carried.some((v) => roadKey(v) === roadKey(id)));
  assert.ok(catalogWording.length > 0, 'this save has a road the file also lists');
  const differently = catalogWording.find((id) => !carried.includes(id));
  assert.ok(differently, 'at least one of them is spelled differently here');

  const row = more.rows(doc).find((r) => roadKey(r.id) === roadKey(differently));
  assert.equal(row.checked, true, 'the ids it holds are what count');
  assert.equal(row.label, carried.find((v) => roadKey(v) === roadKey(differently)),
    'and the label is this save\'s own wording');

  // ticking it by the catalog's spelling changes nothing — it is already there
  assert.equal(more.set(doc, differently, true), false);
  assert.deepEqual(listOf(doc, 'ChallengeRoadIDs'), carried, 'not even a duplicate');

  assert.equal(more.set(doc, row.id, false), true, 'and it comes out by its own id');
  assert.ok(!listOf(doc, 'ChallengeRoadIDs').some((v) => roadKey(v) === roadKey(differently)));
  confined(diff(flatten(decodeSave('DLC2 Hundo.hat')), flatten(doc)), 'ChallengeRoadIDs');
});

// ---------------------------------------------------------------- contracts -------

console.log('\nSnatcher contracts');

check('each box writes its own list with a qualified path', () => {
  const name = 'Deathwish.hat';
  const doc = decodeSave(name);
  const id = 'Hat_SnatcherContract_FeedSpider';
  const had = listOf(doc, 'CompletedSnatcherContracts').length;
  assert.ok(had > 0, 'this save has finished contracts already');

  assert.equal(more.setField(doc, id, 'completed', true), true);
  assert.equal(listOf(doc, 'CompletedSnatcherContracts').length, had + 1,
    'appended, not rewritten');
  assert.deepEqual(top(doc, 'CompletedSnatcherContracts').value.at(-1),
    `hatintimegamecontent.${id}`, 'qualified, like every other entry');
  assert.equal(top(doc, 'SnatcherContracts'), undefined, 'the other lists stay absent');
  assert.equal(top(doc, 'TurnedInSnatcherContracts'), undefined);

  assert.equal(more.setField(doc, id, 'turnedIn', true), true);
  assert.equal(more.setField(doc, id, 'available', true), true);
  assert.deepEqual(top(doc, 'TurnedInSnatcherContracts').value, [`hatintimegamecontent.${id}`]);
  assert.deepEqual(top(doc, 'SnatcherContracts').value, [`hatintimegamecontent.${id}`]);
  assert.deepEqual(
    more.rows(doc).find((r) => r.id === id).fields.map((f) => f.value),
    [true, true, true],
    'the row reads all three back'
  );

  assert.equal(more.set(doc, id, false), true, 'one tick clears all three');
  assert.equal(listOf(doc, 'CompletedSnatcherContracts').length, had,
    'the entries the game wrote are still there');
  assert.equal(top(doc, 'TurnedInSnatcherContracts'), undefined, 'our list went with them');
  assert.equal(top(doc, 'SnatcherContracts'), undefined);
});

check('a completed contract comes out of the list the game wrote', () => {
  const name = 'Deathwish.hat';
  const doc = decodeSave(name);
  const before = flatten(decodeSave(name));
  const id = 'Hat_SnatcherContract_IceWall';
  assert.ok(listOf(doc, 'CompletedSnatcherContracts').map(unqualify).includes(id));

  assert.equal(more.setField(doc, id, 'completed', false), true);
  assert.ok(!listOf(doc, 'CompletedSnatcherContracts').some((v) => unqualify(v) === id));
  assert.ok(top(doc, 'CompletedSnatcherContracts'), 'the list itself is kept');
  assert.equal(more.setField(doc, id, 'completed', false), false);
  assert.equal(more.set(doc, id, false), false, 'already gone everywhere');
  confined(diff(before, flatten(doc)), 'CompletedSnatcherContracts');
});

check('a new contract is written with this save\'s own package', () => {
  const doc = decodeSave('Deathwish.hat');
  const seen = new Set(
    CONTRACT_LISTS.flatMap((list) => listOf(doc, list))
      .filter((v) => typeof v === 'string' && v.includes('.'))
      .map((v) => v.split('.')[0])
  );
  assert.deepEqual([...seen], ['hatintimegamecontent'], 'one package in this save');

  for (const id of CONTRACT_ORDER) {
    if (listOf(doc, 'CompletedSnatcherContracts').some((v) => unqualify(v) === id)) {
      assert.equal(more.setField(doc, id, 'completed', false), true, `${id} out first`);
    }
    assert.equal(more.setField(doc, id, 'completed', true), true, id);
    const written = listOf(doc, 'CompletedSnatcherContracts').at(-1);
    assert.equal(written, `hatintimegamecontent.${id}`);
    assert.ok(seen.has(written.split('.')[0]), `${id} keeps this save's package`);
  }
});

// ------------------------------------------------------------------ ActBits ------

console.log('\nActBits');

check('a flag the save has never tracked gains an entry, and loses it again', () => {
  const name = '1.0 Hundo.hat';
  const original = load(name);
  const doc = decodeSave(name);
  assert.equal(top(doc, 'ActBits'), undefined, 'this save tracks no ActBits at all');

  assert.equal(more.setField(doc, 'hasenteredwater', 'value', 0), false,
    'zero on an unknown flag grows nothing');
  assert.equal(top(doc, 'ActBits'), undefined);

  assert.equal(more.setField(doc, 'hasenteredwater', 'value', 1), true);
  const list = top(doc, 'ActBits');
  assert.equal(list.elementType, 'struct');
  assert.deepEqual(list.value.map((e) => e.properties.map((p) => [p.name, p.value])),
    [[['Id', 'hasenteredwater'], ['Bits', 1], ['IdName', 'hasenteredwater']]],
    'the shape every other entry in a save uses');

  assert.equal(more.setField(doc, 'hasenteredwater', 'value', 0), true, 'clearing it');
  assert.equal(top(doc, 'ActBits'), undefined, 'our entry, our list');
  assert.equal(bytes(doc).compare(original), 0, 'byte for byte');
});

check('a flag the game wrote keeps its entry at zero', () => {
  const name = 'Deathwish.hat';
  const doc = decodeSave(name);
  const entryOf = () => listOf(doc, 'ActBits')
    .find((e) => e.properties.find((p) => p.name === 'IdName')?.value === 'mirrormodeactlock');

  assert.equal(entryOf().properties.find((p) => p.name === 'Bits').value, 0, 'starts at 0');
  assert.equal(more.setField(doc, 'mirrormodeactlock', 'value', 0), false, 'already 0');
  assert.equal(more.setField(doc, 'mirrormodeactlock', 'value', 7), true);
  assert.equal(entryOf().properties.find((p) => p.name === 'Bits').value, 7);
  assert.equal(more.setField(doc, 'mirrormodeactlock', 'value', 0), true);
  assert.ok(entryOf(), 'the entry the game wrote is still there');
  assert.equal(listOf(doc, 'ActBits').length, 3, 'nothing was dropped');
  assert.equal(more.set(doc, 'mirrormodeactlock', true), false, 'a number has no "checked"');
  assert.equal(more.setField(doc, 'mirrormodeactlock', 'value', null), false, 'emptied box');
  assert.equal(more.setField(doc, 'mirrormodeactlock', 'value', 1.5), false, 'not an integer');
  assert.equal(more.setField(doc, 'mirrormodeactlock', 'value', 2 ** 31), false, 'past int32');
  confined(diff(flatten(decodeSave(name)), flatten(doc)), 'ActBits');
});

// -------------------------------------------------------- what is left alone -----

console.log('\nwhat is left alone');

check('a batch of edits never touches another category\'s fields', () => {
  for (const name of saves()) {
    const before = flatten(decodeSave(name));
    const doc = decodeSave(name);

    for (const id of ['MyEnergyBits', 'TotalPlayTime', 'NumReloads', 'CurrentChapter']) {
      more.setField(doc, id, 'value', 7);
    }
    more.set(doc, 'AllowSaving', true);
    for (const id of SECRET_LEVELS) more.set(doc, id, true);
    for (const id of CHALLENGE_ROADS) more.set(doc, id, true);
    for (const id of CONTRACT_ORDER) {
      more.setField(doc, id, 'completed', true);
      more.setField(doc, id, 'turnedIn', true);
      more.setField(doc, id, 'available', true);
    }
    for (const id of ACT_FLAGS) more.setField(doc, id, 'value', 3);

    const d = diff(before, flatten(doc));
    assert.deepEqual(strays(d), [],
      `${name}: wrote outside the category: ${strays(d).slice(0, 5).join(', ')}`);
    assert.ok(d.added.length + d.changed.length > 0, `${name}: the batch should change something`);
  }
});

check('every refused edit leaves the file alone', () => {
  for (const name of saves()) {
    const doc = decodeSave(name);
    const before = flatten(doc);
    for (const id of SCALARS) {
      more.setField(doc, id, 'value', null);
      more.setField(doc, id, 'value', 'nope');
      more.set(doc, id, false);       // a number has no box; AllowSaving is already off
    }
    more.setField(doc, 'some_future_field', 'value', 1);
    more.set(doc, 'some_future_field', true);
    more.set(doc, '1758385712', false);   // one level of a road is not a road
    assert.equal(strays(diff(before, flatten(doc))).length, 0,
      `${name}: a refused edit must write nothing`);
    assert.deepEqual(flatten(doc), before, `${name}: nothing at all may move`);
  }
});

// ------------------------------------------------------------- round-trip --------

console.log('\nthrough the encoder');

for (const name of saves()) {
  check(`${name}: a batch of More edits round-trips through the encoder`, () => {
    const doc = decodeSave(name);
    const rows = more.rows(doc);
    const secretRow = rows.find((r) => r.group === 'secrets' && !r.checked);
    const roadRow = rows.find((r) => r.group === 'roads' && !r.checked);
    const contract = CONTRACT_ORDER.find((id) => !rows.find((r) => r.id === id).fields[0].value);

    assert.equal(more.setField(doc, 'MyEnergyBits', 'value', 12345), true, 'pons');
    assert.equal(more.setField(doc, 'TotalPlayTime', 'value', 1.5), true, 'play time');
    assert.equal(more.setField(doc, 'ActPlayTime', 'value', 0.25), true, 'act time');
    assert.equal(more.set(doc, 'AllowSaving', true), true, 'the box');
    if (secretRow) assert.equal(more.set(doc, secretRow.id, true), true, 'a secret level');
    if (roadRow) assert.equal(more.set(doc, roadRow.id, true), true, 'a challenge road');
    if (contract) assert.equal(more.setField(doc, contract, 'completed', true), true, 'a contract');
    assert.equal(more.setField(doc, 'hasenteredwater', 'value', 3), true, 'an ActBits flag');
    assert.equal(more.setField(doc, 'uncollectedpons', 'value', 99), true, 'another one');

    assert.deepEqual(decode(new Uint8Array(encode(doc))), doc, 'what you see is what is written');

    assert.equal(more.setField(doc, 'MyEnergyBits', 'value', 0), true, 'pons again');
    if (secretRow) assert.equal(more.set(doc, secretRow.id, false), true, 'and the secret');
    if (roadRow) assert.equal(more.set(doc, roadRow.id, false), true, 'and the road');
    if (contract) assert.equal(more.setField(doc, contract, 'completed', false), true);
    assert.deepEqual(decode(new Uint8Array(encode(doc))), doc, 'and back out again');
  });
}

check('reading a file back gives the same rows', () => {
  for (const name of saves()) {
    const doc = decodeSave(name);
    more.set(doc, SECRET_LEVELS.find((id) => !more.rows(doc).find((r) => r.id === id).checked)
      ?? SECRET_LEVELS[0], true);
    more.setField(doc, 'MyEnergyBits', 'value', 17);
    const rows = more.rows(doc).map((r) => JSON.stringify(r));
    assert.deepEqual(
      more.rows(decode(new Uint8Array(encode(doc)))).map((r) => JSON.stringify(r)),
      rows,
      `${name}: rows must survive the encoder`
    );
  }
});

done();
