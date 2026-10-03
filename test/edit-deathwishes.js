/**
 * Exercises the Death Wishes category against the sample saves.
 *
 *   node test/edit-deathwishes.js
 *
 * Checks:
 *   1. the three stamp boxes always agree with LevelSaveInfo.SubconForest.LevelBits
 *   2. a stamp edit touches nothing outside LevelSaveInfo
 *   3. all eight 0..7 combinations land on the documented Bits value
 *   4. clearing stamps restores the document exactly (created entry dropped,
 *      pre-existing entry kept at Bits = 0)
 *   5. bits above 7 — the game's other flags — are never touched
 *   6. the per-tier …_0 / …_1 / …_2 bits are never offered as rows
 *   7. a save with no LevelSaveInfo, or no Subcon Forest entry, has one built
 *      on the first stamp and taken back out again when the stamp is cleared —
 *      and building is never triggered by merely reading the list
 *   8. the edit survives being written out and read back
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode, encode } from '../src/hat.js';
import dw from '../web/categories/deathwishes.js';
import hats from '../web/categories/hats.js';
import timePieces from '../web/categories/time-pieces.js';
import { SECTIONS } from '../web/data/collectibles.js';
import { flatten, diff, harness, onlyIn } from './lib.js';

const ORDER = SECTIONS['Deathwishes'];
const BIT = { stamp1: 1, stamp2: 2, stamp3: 4 };
const KEYS = ['stamp1', 'stamp2', 'stamp3'];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (name) => fs.readFileSync(path.join(ROOT, name));
const saves = () => fs.readdirSync(ROOT).filter((f) => f.endsWith('.hat')).sort();
const decodeSave = (name) => decode(new Uint8Array(load(name)));

const prop = (el, name) => el.properties.find((p) => p.name === name);

/** The LevelSaveInfo element the game keeps death wish progress in. */
const subcon = (doc) =>
  (doc.properties.find((p) => p.name === 'LevelSaveInfo')?.value ?? [])
    .find((el) => prop(el, 'Map')?.value === 'subconforest') ?? null;

const levelBits = (el) => (el ? (prop(el, 'LevelBits')?.value ?? []) : []);

/** IdName -> Bits, read straight out of the file. */
function bitsTable(doc) {
  const table = new Map();
  for (const b of levelBits(subcon(doc))) {
    const name = prop(b, 'IdName')?.value;
    if (typeof name === 'string') table.set(name, prop(b, 'Bits')?.value);
  }
  return table;
}

const rawBitsOf = (doc, id) => bitsTable(doc).get(id);
const maskOf = (row) => row.fields.reduce((n, f) => n | (f.value ? BIT[f.key] : 0), 0);

/** Every contract id in the file that this category is supposed to show. */
const isContract = (name) =>
  /^hat_snatchercontract_deathwish_/.test(name.toLowerCase()) && !/_\d$/.test(name);

const wantedIds = (doc) => {
  const ids = [...ORDER];
  for (const name of bitsTable(doc).keys()) {
    if (isContract(name) && !ids.includes(name)) ids.push(name);
  }
  return ids;
};

const { check, done } = harness();

// ------------------------------------------------------------- catalog -------

console.log('\ncatalog');

check('the Deathwishes section is complete', () => {
  assert.equal(ORDER.length, 38);
  assert.equal(new Set(ORDER).size, ORDER.length, 'duplicate catalog ids');
  assert.ok(ORDER.every((id) => /^Hat_SnatcherContract_DeathWish_/.test(id)));
});

check('the stamps are bit 1, 2 and 4 of one field', () => {
  assert.deepEqual(KEYS.map((k) => BIT[k]), [1, 2, 4]);
  const doc = decodeSave('Deathwish.hat');
  const row = dw.rows(doc).find((r) => ORDER.includes(r.id));
  assert.deepEqual(
    row.fields.map((f) => [f.key, f.label, f.text, f.type]),
    [
      ['stamp1', 'Stamp 1', '1', 'checkbox'],
      ['stamp2', 'Stamp 2', '2', 'checkbox'],
      ['stamp3', 'Stamp 3', '3', 'checkbox'],
    ]
  );
  assert.equal(row.fields.length, 3, 'three checkboxes, one per stamp');
});

check('every catalog contract has a row, in catalog order', () => {
  const doc = decodeSave('Deathwish.hat');
  const rows = dw.rows(doc);
  assert.equal(rows.length, ORDER.length);
  assert.deepEqual(rows.map((r) => r.id), ORDER);
  assert.ok(rows.every((r) => r.label === r.id), 'internal names stay as they are');
  assert.ok(rows.every((r) => !r.disabled));
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, 'duplicate rows');
});

check('the category renders one group plus a save-only group', () => {
  const doc = decodeSave('Deathwish.hat');
  assert.deepEqual([...new Set(dw.rows(doc).map((r) => r.group))], ['deathwishes']);
  assert.equal(dw.groupTitle('deathwishes'), 'All death wishes');
  assert.equal(dw.groupTitle('other'), 'Not in Collectibles.txt');
  assert.deepEqual(dw.filters, ['all', 'collected', 'uncollected']);
  assert.equal(dw.banner(doc), null);
});

// -------------------------------------------------------- rows vs. file ------

console.log('\nrows match the file');

for (const name of saves()) {
  const doc = decodeSave(name);
  const table = bitsTable(doc);

  check(`${name}: the stamp boxes equal the Bits in Subcon Forest`, () => {
    for (const row of dw.rows(doc)) {
      const want = (table.get(row.id) ?? 0) & 7;
      assert.equal(maskOf(row), want, `row ${row.id}: stamps were ${maskOf(row)}, file had ${want}`);
      assert.equal(row.checked, want !== 0, `row ${row.id}: checked flag`);
    }
  });

  check(`${name}: every contract in the file has a row`, () => {
    const rows = new Set(dw.rows(doc).map((r) => r.id));
    assert.deepEqual([...rows].sort(), [...wantedIds(doc)].sort());
    for (const id of table.keys()) {
      if (isContract(id) && !rows.has(id)) throw new Error(`${id} has bits but no row`);
    }
  });
}

check('a mod death wish is labelled, not hidden', () => {
  const doc = decodeSave('CDLC1 Hundo.hat');
  const others = dw.rows(doc).filter((r) => r.group === 'other');
  assert.equal(others.length, 145, 'mod contracts found in Subcon Forest');
  assert.ok(others.every((r) => r.note === 'not in Collectibles.txt'));
  assert.ok(others.every((r) => r.checked));
  assert.equal(dw.rows(doc).length, 38 + 145);
  assert.equal(dw.groupTitle('other'), 'Not in Collectibles.txt');
});

check('the per-tier bits beside a contract are never rows', () => {
  const doc = decodeSave('CDLC1 Hundo.hat');
  const ids = dw.rows(doc).map((r) => r.id);
  assert.ok(ids.includes('Hat_SnatcherContract_DeathWish_BossRush'));
  assert.ok(!ids.includes('Hat_SnatcherContract_DeathWish_BossRush_0'));
  assert.ok(!ids.includes('Hat_SnatcherContract_DeathWish_KillEverybody_2'));
  const digitEnders = ids.filter((id) => /_\d$/.test(id));
  assert.deepEqual(digitEnders, ['Hat_SnatcherContract_DeathWish_CameraTourist_1'],
    'CameraTourist_1 is the only contract id that ends in a digit');
});

// ------------------------------------------------------------- writing -------

console.log('\nwriting stamps');

check('a new stamp entry matches the shape the game uses', () => {
  const before = decodeSave('Deathwish.hat');
  const doc = decodeSave('Deathwish.hat');
  const id = 'Hat_SnatcherContract_DeathWish_BossRush';

  assert.equal(dw.setField(doc, id, 'stamp3', true), true);
  onlyIn(diff(flatten(before), flatten(doc)), '.LevelSaveInfo[');

  const entries = levelBits(subcon(doc));
  const entry = entries.at(-1);
  assert.equal(entries.length, levelBits(subcon(before)).length + 1, 'exactly one entry appended');
  assert.deepEqual(Object.keys(entry), ['properties']);
  assert.deepEqual(
    entry.properties.map((p) => `${p.name}:${p.type}`),
    ['Id:StrProperty', 'Bits:IntProperty', 'IdName:NameProperty']
  );
  assert.equal(prop(entry, 'Id').value, id.toLowerCase());
  assert.equal(prop(entry, 'Bits').value, 4);
  assert.equal(prop(entry, 'IdName').value, id);
  assert.ok(entry.properties.every((p) => p.arrayIndex === 0));
});

check('every stamp combination 0..7 lands on the documented Bits value', () => {
  const doc = decodeSave('Deathwish.hat');
  const id = 'Hat_SnatcherContract_DeathWish_BossRush';

  for (let mask = 0; mask <= 7; mask++) {
    for (const key of KEYS) dw.setField(doc, id, key, (mask & BIT[key]) !== 0);
    assert.equal(rawBitsOf(doc, id) ?? 0, mask, `mask ${mask}`);
    const row = dw.rows(doc).find((r) => r.id === id);
    assert.equal(maskOf(row), mask, `row for mask ${mask}`);
    assert.equal(row.checked, mask !== 0, `checked for mask ${mask}`);
  }
});

check('clearing an entry this editor created removes it again', () => {
  const before = decodeSave('Deathwish.hat');
  const doc = decodeSave('Deathwish.hat');
  const id = 'Hat_SnatcherContract_DeathWish_BossRush';

  assert.equal(dw.set(doc, id, true), true);
  assert.equal(rawBitsOf(doc, id), 7);
  assert.equal(dw.set(doc, id, false), true);
  assert.equal(rawBitsOf(doc, id), undefined, 'the entry we made is gone');
  assert.deepEqual(doc, before, 'tick then untick should be a no-op');
});

check('a contract the save already tracks keeps its entry, at Bits 0', () => {
  const name = 'All Rifts DLC.hat';
  const before = decodeSave(name);
  const doc = decodeSave(name);
  const table = bitsTable(doc);
  const target = dw.rows(doc).find((r) => (table.get(r.id) ?? 0) === 1);
  assert.ok(target, `${name} is expected to have a one-stamp contract`);
  const original = table.get(target.id);

  assert.equal(dw.set(doc, target.id, false), true);
  assert.equal(rawBitsOf(doc, target.id), 0, 'the entry stays put at Bits 0');
  assert.ok(bitsTable(doc).has(target.id));

  // put the stamps back exactly as they were
  for (const key of KEYS) dw.setField(doc, target.id, key, (original & BIT[key]) !== 0);
  assert.deepEqual(doc, before, 'restoring the stamps should restore the document');
});

check('bits above 7 are not stamps and are never touched', () => {
  const doc = decodeSave('CDLC1 Hundo.hat');
  const target = dw.rows(doc).find((r) => r.checked);
  const table = bitsTable(doc);
  assert.equal(table.get(target.id), 7, `${target.id} should start fully stamped`);

  // 21 = 16 (some other flag) + 5 (first and third stamp)
  const entry = levelBits(subcon(doc)).find((b) => prop(b, 'IdName')?.value === target.id);
  prop(entry, 'Bits').value = 21;

  const row = dw.rows(doc).find((r) => r.id === target.id);
  assert.equal(maskOf(row), 5, 'only the low three bits are shown as stamps');
  assert.equal(row.checked, true);

  assert.equal(dw.set(doc, target.id, false), true);
  assert.equal(rawBitsOf(doc, target.id), 16, 'clearing must leave the other flags alone');

  assert.equal(dw.set(doc, target.id, true), true);
  assert.equal(rawBitsOf(doc, target.id), 23, 'stamping again must not swallow them either');
});

check('asking for nothing on a contract the save does not track is a no-op', () => {
  const doc = decodeSave('Deathwish.hat');
  const before = flatten(doc);
  const id = 'Hat_SnatcherContract_DeathWish_BossRush';
  assert.equal(dw.set(doc, id, false), false);
  assert.equal(dw.setField(doc, id, 'stamp1', false), false);
  assert.deepEqual(flatten(doc), before);
});

check('re-stamping what is already stamped changes nothing', () => {
  const doc = decodeSave('CDLC1 Hundo.hat');
  const target = dw.rows(doc).find((r) => r.checked);
  assert.equal(dw.set(doc, target.id, true), false);
  for (const key of KEYS) assert.equal(dw.setField(doc, target.id, key, true), false);
  assert.equal(dw.set(doc, target.id, false), true, 'but clearing it does move');
});

check('an unknown field key is refused', () => {
  const doc = decodeSave('Deathwish.hat');
  const before = flatten(doc);
  assert.equal(dw.setField(doc, ORDER[0], 'stamp9', true), false);
  assert.equal(dw.setField(doc, ORDER[0], 'collected', true), false);
  assert.deepEqual(flatten(doc), before);
});

check('an entry with no Bits field is refused, not repaired', () => {
  const doc = decodeSave('CDLC1 Hundo.hat');
  const target = dw.rows(doc).find((r) => r.checked);
  const entry = levelBits(subcon(doc)).find((b) => prop(b, 'IdName')?.value === target.id);
  entry.properties = entry.properties.filter((p) => p.name !== 'Bits');

  const without = flatten(doc);
  assert.equal(dw.set(doc, target.id, true), false);
  assert.equal(dw.set(doc, target.id, false), false);
  assert.equal(dw.setField(doc, target.id, 'stamp1', true), false);
  assert.deepEqual(flatten(doc), without, 'nothing should be invented for it');
});

// ------------------------------------------------ building what is missing ---

console.log('\nbuilding what is missing');

const SUBCON = 'subconforest';
const listOf = (doc) => doc.properties.find((p) => p.name === 'LevelSaveInfo');

const withoutLevelSaveInfo = (doc) => {
  const i = doc.properties.findIndex((p) => p.name === 'LevelSaveInfo');
  if (i >= 0) doc.properties.splice(i, 1);
};

const withoutSubconForest = (doc) => {
  const list = listOf(doc);
  list.value = list.value.filter((el) => prop(el, 'Map')?.value !== SUBCON);
};

check('a save with no LevelSaveInfo is read, not grown', () => {
  const doc = decodeSave('Deathwish.hat');
  withoutLevelSaveInfo(doc);
  const before = flatten(doc);

  assert.equal(dw.banner(doc), null, 'it is still editable — the entry gets built');
  assert.ok(dw.rows(doc).every((r) => !r.disabled));
  assert.equal(dw.rows(doc).filter((r) => r.checked).length, 0);
  assert.deepEqual(flatten(doc), before, 'looking at the list must not create anything');
});

check('asking for "no stamps" never builds a LevelSaveInfo', () => {
  const doc = decodeSave('Deathwish.hat');
  withoutLevelSaveInfo(doc);
  const before = flatten(doc);

  assert.equal(dw.set(doc, ORDER[0], false), false);
  assert.equal(dw.setField(doc, ORDER[0], 'stamp1', false), false);
  assert.equal(dw.setField(doc, ORDER[0], 'stamp3', false), false);
  assert.equal(listOf(doc), undefined, 'nothing wanted, nothing built');
  assert.deepEqual(flatten(doc), before);
});

check('stamping builds the list, the Subcon Forest entry and the LevelBits field', () => {
  const original = flatten(decodeSave('Deathwish.hat'));
  const doc = decodeSave('Deathwish.hat');
  withoutLevelSaveInfo(doc);

  const id = 'Hat_SnatcherContract_DeathWish_BossRush';
  assert.equal(dw.setField(doc, id, 'stamp2', true), true);
  onlyIn(diff(original, flatten(doc)), '.LevelSaveInfo[');

  const list = listOf(doc);
  assert.equal(list.type, 'ArrayProperty');
  assert.equal(list.elementType, 'struct');
  assert.equal(list.arrayIndex, 0);
  assert.equal(list.value.length, 1);
  assert.equal(doc.properties.at(-1), list, 'a brand new top-level list goes at the end');

  const element = list.value[0];
  assert.deepEqual(element.properties.map((p) => p.name), ['Map', 'LevelBits'],
    'exactly the shape every real save uses');
  assert.equal(prop(element, 'Map').type, 'StrProperty');
  assert.equal(prop(element, 'Map').value, SUBCON);
  assert.equal(prop(element, 'LevelBits').type, 'ArrayProperty');
  assert.equal(prop(element, 'LevelBits').elementType, 'struct');
  assert.ok(element.properties.every((p) => p.arrayIndex === 0));

  const bits = prop(element, 'LevelBits').value;
  assert.equal(bits.length, 1);
  const entry = bits.at(-1);
  assert.deepEqual(entry.properties.map((p) => `${p.name}:${p.type}`),
    ['Id:StrProperty', 'Bits:IntProperty', 'IdName:NameProperty']);
  assert.equal(prop(entry, 'Id').value, id.toLowerCase());
  assert.equal(prop(entry, 'Bits').value, 2, 'the second stamp is bit 1');
  assert.equal(prop(entry, 'IdName').value, id);
});

check('clearing the stamps takes the whole chain back out', () => {
  const doc = decodeSave('Deathwish.hat');
  withoutLevelSaveInfo(doc);
  const before = flatten(doc);

  const id = 'Hat_SnatcherContract_DeathWish_BossRush';
  assert.equal(dw.set(doc, id, true), true);
  assert.ok(listOf(doc), 'the chain should be built');

  assert.equal(dw.set(doc, id, false), true);
  assert.equal(listOf(doc), undefined, 'the whole LevelSaveInfo goes away again');
  assert.deepEqual(flatten(doc), before, 'create then clear must be a no-op');
});

check('a save with LevelSaveInfo but no Subcon Forest entry grows just the entry', () => {
  const doc = decodeSave('Deathwish.hat');
  const withSubcon = listOf(doc).value.length;
  withoutSubconForest(doc);
  const before = flatten(doc);
  assert.ok(!listOf(doc).value.some((el) => prop(el, 'Map')?.value === SUBCON));

  const id = 'Hat_SnatcherContract_DeathWish_BossRush';
  assert.equal(dw.set(doc, id, true), true);
  assert.equal(listOf(doc).value.length, withSubcon, 'the other maps are untouched');
  assert.equal(prop(listOf(doc).value.at(-1), 'Map').value, SUBCON);

  assert.equal(dw.set(doc, id, false), true);
  assert.equal(listOf(doc).value.length, withSubcon - 1, 'our entry is taken back out');
  assert.deepEqual(flatten(doc), before, 'the maps this save had are exactly as they were');
});

check('a freshly built entry survives the encoder', () => {
  const doc = decodeSave('Deathwish.hat');
  withoutLevelSaveInfo(doc);

  const id = 'Hat_SnatcherContract_DeathWish_BossRush';
  assert.equal(dw.setField(doc, id, 'stamp1', true), true);
  assert.equal(dw.setField(doc, id, 'stamp3', true), true);

  const bytes = encode(doc);
  const back = decode(new Uint8Array(bytes));
  assert.deepEqual(Object.fromEntries(bitsTable(back)), Object.fromEntries(bitsTable(doc)));
  assert.equal(maskOf(dw.rows(back).find((r) => r.id === id)), 5, 'first + third');
  assert.equal(prop(listOf(back).value[0], 'Map').value, SUBCON);
  assert.ok(Buffer.from(encode(back)).equals(bytes), 're-encoding what we built must be stable');
});

check('a LevelSaveInfo that is not a struct list gets a banner, not a guess', () => {
  const doc = decodeSave('Deathwish.hat');
  const list = listOf(doc);
  list.elementType = 'string';
  list.value = ['somewhere', 'elsewhere'];

  const before = flatten(doc);
  assert.match(dw.banner(doc), /LevelSaveInfo/);
  assert.ok(dw.rows(doc).every((r) => r.disabled), 'rows must be inert');
  assert.equal(dw.rows(doc).filter((r) => r.checked).length, 0);
  assert.equal(dw.set(doc, ORDER[0], true), false);
  assert.equal(dw.setField(doc, ORDER[0], 'stamp1', true), false);
  assert.equal(list.elementType, 'string', 'an unreadable list must be left alone');
  assert.deepEqual(flatten(doc), before);
});

// ------------------------------------------------- the things we must not do -

console.log('\nnothing else moves');

for (const name of saves()) {
  check(`${name}: a stamp edit stays inside LevelSaveInfo`, () => {
    const before = decodeSave(name);
    const doc = decodeSave(name);

    const open = dw.rows(doc).find((r) => !r.checked);
    const taken = dw.rows(doc).find((r) => r.checked);
    assert.ok(open || taken, `${name} has no contracts at all`);
    // a save that is all-stamped loses one; one with none open gains its first
    if (open) assert.equal(dw.setField(doc, open.id, 'stamp1', true), true);
    if (taken) assert.equal(dw.set(doc, taken.id, false), true);

    onlyIn(diff(flatten(before), flatten(doc)), '.LevelSaveInfo[');
  });

  check(`${name}: hats, time pieces and the Snatcher contract lists survive`, () => {
    const doc = decodeSave(name);
    const outside = () => ({
      hats: hats.rows(doc).map((r) => `${r.id}=${r.checked}`),
      pieces: timePieces.rows(doc).map((r) => `${r.id}=${r.checked}`),
      contracts: doc.properties
        .filter((p) => /SnatcherContracts$/.test(p.name))
        .map((p) => p.value),
      actBits: doc.properties.find((p) => p.name === 'ActBits')?.value,
      timeObjects: doc.properties.find((p) => p.name === 'TimeObjects')?.value.length,
      levelSaveInfo: (doc.properties.find((p) => p.name === 'LevelSaveInfo')?.value ?? [])
        .map((el) => el.properties.find((q) => q.name === 'Map')?.value),
    });
    const snapshot = outside();
    const hadSubcon = snapshot.levelSaveInfo.includes('subconforest');

    // flip every stamp of every contract, i.e. the most destructive edit there is
    for (const row of dw.rows(doc)) {
      for (const key of KEYS) {
        dw.setField(doc, row.id, key, !row.fields.find((f) => f.key === key).value);
      }
    }

    const now = outside();
    if (!hadSubcon) {
      // The one thing this edit is allowed to build: the Subcon Forest entry a
      // save that has never tracked a contract has never needed. (The two
      // default files were made by leaving the title screen straight away.)
      assert.equal(now.levelSaveInfo.length, snapshot.levelSaveInfo.length + 1,
        'the Subcon Forest entry should have been appended');
      assert.equal(now.levelSaveInfo.at(-1), 'subconforest', 'and appended at the end');
      now.levelSaveInfo.pop();
    }
    assert.deepEqual(now, snapshot, 'something outside the stamp bits moved');
  });
}

check('the pre-2017 save is editable here — it has a Subcon Forest entry', () => {
  const before = decodeSave('1.0 Hundo.hat');
  const doc = decodeSave('1.0 Hundo.hat');
  assert.equal(dw.banner(doc), null);
  assert.ok(dw.rows(doc).every((r) => !r.disabled));
  assert.ok(dw.rows(doc).every((r) => r.checked === false), 'a v1.0 save has no death wishes yet');

  const id = 'Hat_SnatcherContract_DeathWish_BossRush';
  assert.equal(dw.setField(doc, id, 'stamp2', true), true);
  onlyIn(diff(flatten(before), flatten(doc)), '.LevelSaveInfo[');
  assert.equal(rawBitsOf(doc, id), 2);
});

// ------------------------------------------------------- survives a file -----

console.log('\nthe edit survives being written out');

for (const name of saves()) {
  check(`${name}: stamps round-trip through the encoder`, () => {
    const doc = decodeSave(name);
    const target = dw.rows(doc).find((r) => !r.checked) ?? dw.rows(doc)[0];
    const before = bitsTable(doc);

    dw.setField(doc, target.id, 'stamp1', true);
    dw.setField(doc, target.id, 'stamp3', true);

    const back = decode(new Uint8Array(encode(doc)));
    assert.deepEqual(Object.fromEntries(bitsTable(back)), Object.fromEntries(bitsTable(doc)));

    const row = dw.rows(back).find((r) => r.id === target.id);
    const want = ((before.get(target.id) ?? 0) & 7) | 5;
    assert.equal(maskOf(row), want, `${target.id} should read back with mask ${want}`);
    assert.deepEqual(row.fields, dw.rows(doc).find((r) => r.id === target.id).fields);
  });
}

check('reading the rows never disturbs the file, and re-stamping is a no-op', () => {
  for (const name of saves()) {
    const bytes = load(name);
    const doc = decode(new Uint8Array(bytes));

    const rows = dw.rows(doc);
    assert.ok(Buffer.from(encode(doc)).equals(bytes), `${name}: rows() wrote something`);

    // put every stamp back exactly where it already is — nothing to do
    for (const row of rows) {
      for (const key of KEYS) {
        const on = row.fields.find((f) => f.key === key).value;
        assert.equal(dw.setField(doc, row.id, key, on), false, `${name}: ${row.id}.${key} moved`);
      }
    }
    assert.ok(Buffer.from(encode(doc)).equals(bytes), `${name}: a no-op edit changed the bytes`);
  }
});

check('set() to whatever the save already has does exactly the documented work', () => {
  for (const name of saves()) {
    const doc = decodeSave(name);
    for (const row of dw.rows(doc)) {
      const raw = rawBitsOf(doc, row.id) ?? 0;
      const want = row.checked ? 7 : 0;
      // stamping a contract that already has three stamps writes nothing;
      // stamping anything else writes, and clearing anything with stamps writes
      assert.equal(
        dw.set(doc, row.id, row.checked),
        (raw & 7) !== want,
        `${name}: ${row.id} (Bits ${raw})`
      );
    }
  }
});

done();
