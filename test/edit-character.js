/**
 * Exercises the Hat Kid / Bow Kid switch — the one edit in the editor that is
 * not an item.
 *
 *   node test/edit-character.js
 *
 * Checks:
 *   1. every save on disk reads as Hat Kid, except the Bow Kid reference file
 *   2. the two reference files differ only in the flag, the second loadout and
 *      their timestamps
 *   3. the row agrees with the file, and asking for the character it already
 *      is changes nothing
 *   4. Hat Kid -> Bow Kid writes the flag and grows Loadouts, nothing else
 *   5. Bow Kid -> Hat Kid takes the flag back out and keeps her loadout
 *   6. a save that already has both loadouts only gains the flag — and loses
 *      it again byte for byte
 *   7. a save with one loadout gains a copy of it wearing the Bow Kid body
 *   8. the pre-2017 save, whose loadout has no body fields at all, gains them
 *   9. the copy shares nothing with the loadout it was copied from
 *  10. a save with no Loadouts list refuses instead of inventing one
 *  11. every switch survives being written out and read back
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode, encode } from '../src/hat.js';
import {
  characterOf,
  characterBlocker,
  setCharacter,
  characterSetting,
  CHARACTER_ROW,
} from '../web/character.js';
import { flatten, diff, harness } from './lib.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (name) => fs.readFileSync(path.join(ROOT, name));
const saves = () => fs.readdirSync(ROOT).filter((f) => f.endsWith('.hat')).sort();
const decodeSave = (name) => decode(new Uint8Array(load(name)));

const BOW_FILE = 'bow kid default file.hat';
const HAT_FILE = 'hat kid default file.hat';
const BOW_UPPER = 'hatintimegamecontent.Hat_CosmeticItem_BowKidUpperBody';
const BOW_LEGS = 'hatintimegamecontent.Hat_CosmeticItem_BowKidLegs';

const loadoutsOf = (doc) => doc.properties.find((p) => p.name === 'Loadouts');
const flagOf = (doc) => doc.properties.find((p) => p.name === CHARACTER_ROW);
const bodyOf = (element, name) => element.properties.find((p) => p.name === name)?.value;
const bytes = (doc) => Buffer.from(encode(doc));

const { check, done } = harness();

/** Assert that a diff touches only paths starting with one of `prefixes`. */
const confinedTo = (d, prefixes, what) => {
  const stray = [...d.removed, ...d.added, ...d.changed]
    .filter((k) => !prefixes.some((p) => k.startsWith(p)));
  if (stray.length) throw new Error(`${what}, but also: ${stray.slice(0, 5).join(', ')}`);
  if (!d.removed.length && !d.added.length && !d.changed.length) {
    throw new Error(`${what}: changed nothing`);
  }
};

// ------------------------------------------------------------ what is on disk --

console.log('\nwhat the saves already say');

check('every save reads as Hat Kid, except the Bow Kid reference file', () => {
  for (const name of saves()) {
    const doc = decodeSave(name);
    const expected = name === BOW_FILE ? 'bow' : 'hat';

    assert.equal(characterOf(doc), expected, `${name}: character`);
    const row = characterSetting.rows(doc)[0];
    assert.equal(row.id, CHARACTER_ROW, `${name}: the internal name stays put`);
    assert.equal(row.label, CHARACTER_ROW, `${name}: labels are raw ids`);
    assert.equal(row.checked, expected === 'bow', `${name}: the row`);
    assert.equal(characterSetting.banner(doc), null, `${name}: nothing to refuse`);
  }
});

check('the two reference files differ only in the flag, the second loadout and their stamps', () => {
  const hat = flatten(decodeSave(HAT_FILE));
  const bow = flatten(decodeSave(BOW_FILE));
  const d = diff(hat, bow);

  assert.deepEqual(d.removed, [], 'the Bow Kid file takes nothing away');
  assert.deepEqual(d.changed, ['.LastPlayTime[0]', '.CreationTimeStamp[0]'],
    `changed: ${d.changed.join(', ')}`);

  const loadout = d.added.filter((k) => k.startsWith('.Loadouts[0]#1'));
  assert.equal(loadout.length, 9, 'nine fields make up the second loadout');
  assert.ok(d.added.includes('.PlayerCharacterType[0]'), 'and the flag');
  assert.deepEqual(
    d.added.filter((k) => !loadout.includes(k) && k !== '.PlayerCharacterType[0]'),
    [],
    'there is nothing else'
  );
});

check('the Bow Kid file stores the flag and both loadouts where the game put them', () => {
  const bow = decodeSave(BOW_FILE);
  assert.deepEqual(flagOf(bow),
    { name: CHARACTER_ROW, type: 'IntProperty', arrayIndex: 0, value: 1 });

  const loadouts = loadoutsOf(bow);
  assert.equal(bow.properties.indexOf(flagOf(bow)), bow.properties.indexOf(loadouts) + 1,
    'straight after Loadouts');
  assert.equal(loadouts.value.length, 2);
  assert.equal(bodyOf(loadouts.value[0], 'UpperBody'),
    'hatintimegamecontent.Hat_CosmeticItem_HatKidUpperBody');
  assert.equal(bodyOf(loadouts.value[1], 'UpperBody'), BOW_UPPER);
  assert.equal(bodyOf(loadouts.value[1], 'Legs'), BOW_LEGS);

  const hat = decodeSave(HAT_FILE);
  assert.equal(flagOf(hat), undefined, 'a Hat Kid save has no such property at all');
  assert.equal(loadoutsOf(hat).value.length, 1);
});

check('asking for the character the save already is changes nothing', () => {
  for (const name of saves()) {
    const doc = decodeSave(name);
    const before = flatten(doc);
    const isBow = characterOf(doc) === 'bow';

    assert.equal(characterSetting.set(doc, CHARACTER_ROW, isBow), false, `${name}: as it is`);
    assert.equal(characterSetting.set(doc, 'not-the-flag', true), false, `${name}: unknown id`);
    assert.equal(setCharacter(doc, 'kid'), false, `${name}: not a character`);
    assert.deepEqual(flatten(doc), before, `${name}: nothing may be written`);
  }
});

// ------------------------------------------------------------- the switch ------

console.log('\nswitching character');

check('Hat Kid -> Bow Kid touches only the flag and Loadouts', () => {
  const before = decodeSave(HAT_FILE);
  const doc = decodeSave(HAT_FILE);

  assert.equal(setCharacter(doc, 'bow'), true);
  confinedTo(diff(flatten(before), flatten(doc)),
    ['.PlayerCharacterType[', '.Loadouts['], 'hat -> bow');

  assert.equal(characterOf(doc), 'bow');
  assert.equal(characterSetting.rows(doc)[0].checked, true);
  assert.equal(characterSetting.banner(doc), null, 'this save can hold a Bow Kid loadout');

  assert.deepEqual(flagOf(doc), flagOf(decodeSave(BOW_FILE)),
    'the flag is written exactly as the game writes it');
  assert.equal(doc.properties.indexOf(flagOf(doc)), doc.properties.indexOf(loadoutsOf(doc)) + 1);

  const loadouts = loadoutsOf(doc);
  assert.equal(loadouts.value.length, 2, 'a second loadout appears');
  assert.deepEqual(loadouts.value[0], loadoutsOf(before).value[0], "Hat Kid's own loadout must not move");
  assert.equal(bodyOf(loadouts.value[1], 'UpperBody'), BOW_UPPER);
  assert.equal(bodyOf(loadouts.value[1], 'Legs'), BOW_LEGS);
});

check('Bow Kid -> Hat Kid takes the flag back out and keeps her loadout', () => {
  const before = decodeSave(BOW_FILE);
  const doc = decodeSave(BOW_FILE);

  assert.equal(setCharacter(doc, 'hat'), true);
  confinedTo(diff(flatten(before), flatten(doc)), ['.PlayerCharacterType['], 'bow -> hat');

  assert.equal(characterOf(doc), 'hat');
  assert.equal(flagOf(doc), undefined, 'Hat Kid is the absence of the property');
  assert.equal(loadoutsOf(doc).value.length, 2, "Bow Kid's loadout stays where it is");

  assert.equal(setCharacter(doc, 'bow'), true, 'and it comes back');
  assert.deepEqual(doc, before, 'right where we started');
  assert.ok(bytes(doc).equals(bytes(before)), 'byte for byte');
});

check('a save that already has both loadouts only gains the flag', () => {
  const name = 'DLC1 Hundo.hat';
  const before = decodeSave(name);
  const doc = decodeSave(name);
  assert.equal(loadoutsOf(doc).value.length, 2, 'this save already carries both');

  assert.equal(setCharacter(doc, 'bow'), true);
  confinedTo(diff(flatten(before), flatten(doc)), ['.PlayerCharacterType['], 'flag only');
  assert.deepEqual(loadoutsOf(doc), loadoutsOf(before), 'nothing to add to Loadouts');

  assert.equal(setCharacter(doc, 'hat'), true);
  assert.deepEqual(doc, before, 'back to Hat Kid is the file we started with');
  assert.ok(bytes(doc).equals(bytes(before)), 'byte for byte');
});

check('a save with one loadout gains a copy of it wearing the Bow Kid body', () => {
  const name = 'Deathwish.hat';
  const before = decodeSave(name);
  const doc = decodeSave(name);
  assert.equal(loadoutsOf(doc).value.length, 1);

  assert.equal(setCharacter(doc, 'bow'), true);
  confinedTo(diff(flatten(before), flatten(doc)),
    ['.PlayerCharacterType[', '.Loadouts['], 'hat -> bow');

  const [hat, bow] = loadoutsOf(doc).value;
  assert.deepEqual(loadoutsOf(before).value[0], hat, "Hat Kid keeps hers untouched");
  assert.equal(bodyOf(bow, 'UpperBody'), BOW_UPPER);
  assert.equal(bodyOf(bow, 'Legs'), BOW_LEGS);
  const gear = (el) => el.properties
    .filter((p) => p.name !== 'UpperBody' && p.name !== 'Legs')
    .map((p) => JSON.stringify(p));
  assert.deepEqual(gear(bow), gear(hat), 'she keeps whatever Hat Kid had equipped');

  assert.equal(setCharacter(doc, 'hat'), true);
  confinedTo(diff(flatten(before), flatten(doc)), ['.Loadouts['], 'back to Hat Kid');
  assert.equal(flagOf(doc), undefined);
  assert.equal(loadoutsOf(doc).value.length, 2, 'and the loadout is still there');
});

check('the pre-2017 save, whose loadout has no body fields, gains them', () => {
  const before = decodeSave('1.0 Hundo.hat');
  const doc = decodeSave('1.0 Hundo.hat');
  const source = loadoutsOf(before).value[0];
  assert.equal(bodyOf(source, 'UpperBody'), undefined, 'this format has no body fields at all');

  assert.equal(setCharacter(doc, 'bow'), true);
  const [hat, bow] = loadoutsOf(doc).value;
  assert.deepEqual(hat, source, "Hat Kid's own loadout is untouched");
  assert.deepEqual(
    bow.properties.map((p) => p.name),
    [...source.properties.map((p) => p.name), 'UpperBody', 'Legs'],
    'the body fields go at the end, where the current format keeps them'
  );
  assert.equal(bodyOf(bow, 'UpperBody'), BOW_UPPER);
  assert.equal(bodyOf(bow, 'Legs'), BOW_LEGS);
});

check('the new loadout shares nothing with the one it was copied from', () => {
  const doc = decodeSave('1.0 Hundo.hat');
  assert.equal(setCharacter(doc, 'bow'), true);
  const [hat, bow] = loadoutsOf(doc).value;

  const badgesOf = (el) => el.properties.find((p) => p.name === 'Badges').value;
  assert.ok(badgesOf(hat).length > 0, 'this save equips badges');
  assert.notEqual(hat.properties, bow.properties, 'not even the property list is shared');
  assert.notEqual(badgesOf(hat), badgesOf(bow), 'nor the arrays inside it');
  assert.notEqual(badgesOf(hat)[0], badgesOf(bow)[0], 'nor the elements inside those');

  const size = badgesOf(hat).length;
  badgesOf(bow).length = 0;
  assert.equal(badgesOf(hat).length, size, "editing Bow Kid's loadout must not touch Hat Kid's");
});

check('a save with no Loadouts list refuses instead of inventing one', () => {
  const doc = decodeSave('Deathwish.hat');
  doc.properties.splice(doc.properties.findIndex((p) => p.name === 'Loadouts'), 1);
  const before = flatten(doc);

  const reason = characterBlocker(doc, 'bow');
  assert.ok(reason, 'expected a reason');
  assert.match(reason, /Loadouts/);
  assert.equal(setCharacter(doc, 'bow'), false);
  assert.deepEqual(flatten(doc), before, 'nothing may be written');
  assert.equal(characterOf(doc), 'hat');

  // coming back to Hat Kid needs no loadout at all
  const bowSave = decodeSave(BOW_FILE);
  bowSave.properties.splice(bowSave.properties.findIndex((p) => p.name === 'Loadouts'), 1);
  assert.equal(characterBlocker(bowSave, 'hat'), null, 'going back is always possible');
  assert.equal(setCharacter(bowSave, 'hat'), true);
  assert.equal(characterOf(bowSave), 'hat');
  assert.equal(flagOf(bowSave), undefined);
});

// ------------------------------------------------------------- round-trip ------

console.log('\nthe edit survives being written out');

for (const name of saves()) {
  check(`${name}: a character switch round-trips through the encoder`, () => {
    const doc = decodeSave(name);
    const was = characterOf(doc);

    assert.equal(setCharacter(doc, 'bow'), was !== 'bow', 'switching to Bow Kid');
    assert.equal(characterOf(doc), 'bow');
    assert.equal(loadoutsOf(doc).value.length >= 2, true, 'Bow Kid has a loadout to come back to');
    assert.deepEqual(decode(new Uint8Array(encode(doc))), doc);

    assert.equal(setCharacter(doc, 'hat'), true, 'switching back');
    assert.equal(characterOf(doc), 'hat');
    assert.deepEqual(decode(new Uint8Array(encode(doc))), doc);
  });
}

done();
