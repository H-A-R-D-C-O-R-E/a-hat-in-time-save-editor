/**
 * Boots web/app.js against a real DOM (linkedom) and drives it end to end:
 * drop a save on it, read the list, toggle a time piece, filter, bulk-edit,
 * download and revert.
 *
 *   node test/web-smoke.js
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';
import { OBJECTS as HAT_OBJECTS, FLAIR_OBJECTS } from '../web/data/hats.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p));

const { window, document } = parseHTML(read('web/index.html').toString('utf8'));

// Browser globals app.js uses as bare identifiers. linkedom does not provide
// location / history / CSS, so stand in for them — these are the only shims.
const CSS_ESC = (value) =>
  String(value).replace(/[^a-zA-Z0-9\u00a0-\uffff]/g, (ch) => `\\${ch}`);

Object.assign(globalThis, {
  window,
  document,
  CSS: { escape: CSS_ESC },
  location: { hash: '' },
  history: {
    replaceState(_state, _title, url) {
      globalThis.location.hash = String(url);
    },
  },
});
window.location = globalThis.location;
window.history = globalThis.history;

const $ = (id) => document.getElementById(id);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const fire = (target, type, extra = {}) => {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, extra);
  target.dispatchEvent(event);
  return event;
};
const chips = (label) =>
  [...document.querySelectorAll('#chips .chip')].find((c) => c.textContent === label);

let failures = 0;
async function check(label, fn) {
  try {
    await fn();
    console.log(`  ok   ${label}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${label}\n       ${err.message.split('\n').join('\n       ')}`);
  }
}

const rows = () => document.querySelectorAll('#list .row');
const tally = () => $('tally').textContent;

// every download goes through these; a check swaps them in around the click
let blob = null;
const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;

// --------------------------------------------------------------- boot -------

console.log('\nboot');

await check('importing app.js does not throw', async () => {
  await import(pathToFileURL(path.join(ROOT, 'web', 'app.js')).href);
});

await check('nav lists every category', () => {
  const items = document.querySelectorAll('#nav .nav-item');
  assert.equal(items.length, 12);
  assert.deepEqual([...items].map((i) => i.textContent),
    ['Time Pieces', 'Death Wishes', 'Hats', 'Hat Flairs', 'Badges', 'Dyes',
     'Stickers', 'Weapons', 'Remixes', 'Filters', 'Backpack', 'More']);
  assert.ok([...items].every((i) => i.disabled), 'nav should be disabled before a file loads');
});

await check('shows the drop zone, hides the editor', () => {
  assert.equal($('empty').hidden, false);
  assert.equal($('editor').hidden, true);
  assert.equal($('character').hidden, true, 'there is no character to pick without a file');
  assert.equal($('status').textContent, 'Open a .hat file to begin.');
});

// --------------------------------------------------------------- load -------

console.log('\nload');

await check('dropping Deathwish.hat decodes it', async () => {
  const bytes = read('Deathwish.hat');
  fire(document, 'drop', {
    dataTransfer: {
      files: [{
        name: 'Deathwish.hat',
        arrayBuffer: async () =>
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      }],
    },
  });
  await tick();

  assert.equal($('empty').hidden, true);
  assert.equal($('editor').hidden, false);
  assert.equal($('file-name').textContent, 'Deathwish.hat');
  assert.match($('file-meta').textContent, /no pending changes/);
  assert.equal($('nav').querySelector('.nav-item').disabled, false);
});

await check('the drop zone is really gone, not merely flagged hidden', () => {
  assert.equal($('empty').hidden, true);
  assert.equal($('editor').hidden, false);

  // `.empty` and `.editor` both set their own `display`, so the `hidden`
  // attribute on its own would leave the drop zone laid out over the editor —
  // the stylesheet has to win that fight, and the editor then fills the space.
  const css = read('web/style.css').toString('utf8');
  assert.match(
    css,
    /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/,
    'style.css needs an [hidden] rule that beats the layout rules'
  );
  assert.match(css, /\.editor\s*\{[^}]*flex:\s*1/,
    'the editor must be able to take the room the drop zone leaves behind');
});

await check('renders one row per known time piece, grouped in game order', () => {
  assert.equal(rows().length, 56);
  const groups = [...document.querySelectorAll('#list .group')].map(
    (g) => g.querySelector('.group-title')
  );
  assert.deepEqual(
    groups.map((g) => g.title),
    [
      'Chapter1_MafiaTown',
      'Chapter3_Trainwreck',   // real chapter 2
      'Chapter2_Subcon',       // real chapter 3
      'Chapter4_Sand',
      'Chapter5_Finale',
      'Chapter6_Cruise',
      'Chapter7_Metro',
      'Location_Spaceship',
    ],
    `titles were ${groups.map((g) => g.title).join(', ')}`
  );
  assert.ok(groups.some((g) => g.textContent === 'Mafia Town (Chapter 1)'));
  assert.ok(groups.some((g) => g.textContent === 'Battle of the Birds (Chapter 2)'));
  assert.ok(groups.some((g) => g.textContent === 'The Subcon Forest (Chapter 3)'));
  assert.ok(!groups.some((g) => /Birdhouse/.test(g.textContent)),
    'the stale "The Birdhouse" label should be gone');
  assert.ok(groups.some((g) => g.textContent === 'Nyakuza Metro (Chapter 7)'));
});

await check('the internal chapter order follows the real game, not ChapterName', () => {
  const titles = [...document.querySelectorAll('#list .group-title')].map((n) => n.textContent);
  assert.deepEqual(titles.slice(0, 4), [
    'Mafia Town (Chapter 1)',
    'Battle of the Birds (Chapter 2)',
    'The Subcon Forest (Chapter 3)',
    'Alpine Skyline (Chapter 4)',
  ], `titles were ${titles.join(', ')}`);
});

await check('TimeRift_Cave_Tour sits with the Spaceship rifts, not Chapter 5', () => {
  const tour = document.querySelector('#list .row[data-id="TimeRift_Cave_Tour"]');
  assert.ok(tour, 'tour row not rendered');
  const spaceshipGroup = [...document.querySelectorAll('#list .group')].find(
    (g) => g.querySelector('.group-title').title === 'Location_Spaceship'
  );
  assert.ok(spaceshipGroup, 'Spaceship group not rendered');
  assert.ok(spaceshipGroup.contains(tour), 'tour is in the wrong group');
  assert.ok(
    [...spaceshipGroup.querySelectorAll('.row-name')].map((n) => n.textContent).sort().join(', ')
      === 'Spaceship_WaterRift_Gallery, Spaceship_WaterRift_MailRoom, TimeRift_Cave_Tour',
    `Spaceship group was: ${[...spaceshipGroup.querySelectorAll('.row-name')].map((n) => n.textContent).join(', ')}`
  );

  const finaleGroup = [...document.querySelectorAll('#list .group')].find(
    (g) => g.querySelector('.group-title').title === 'Chapter5_Finale'
  );
  assert.ok(finaleGroup, 'Chapter 5 group disappeared');
  assert.equal(finaleGroup.querySelectorAll('.row').length, 1);
  assert.match(finaleGroup.textContent, /TheFinale_FinalBoss/);
});

await check('the file as loaded is 100% collected', () => {
  assert.equal(tally(), '56 / 56 collected');
  assert.ok([...rows()].every((r) => r.querySelector('input').checked));
});

// ---------------------------------------------------------- character ---------

console.log('\ncharacter');

const charButton = (target) => document.querySelector(`#character [data-character="${target}"]`);

await check('the switch appears with the file, showing Hat Kid', () => {
  assert.equal($('character').hidden, false);
  assert.equal(charButton('hat').classList.contains('is-active'), true);
  assert.equal(charButton('bow').classList.contains('is-active'), false);
  assert.equal(charButton('hat').getAttribute('aria-pressed'), 'true');
  assert.equal(charButton('bow').disabled, false, 'this save can become Bow Kid');
  assert.match(charButton('bow').title, /PlayerCharacterType/);
});

await check('picking Bow Kid writes the flag and counts as one change', async () => {
  fire(charButton('bow'), 'click');

  assert.equal(charButton('bow').classList.contains('is-active'), true);
  assert.equal(charButton('hat').classList.contains('is-active'), false);
  assert.match($('file-meta').textContent, /1 pending change/);
  assert.match($('status').textContent, /Bow Kid/);
  assert.match($('status').textContent, /PlayerCharacterType/);

  URL.createObjectURL = (b) => { blob = b; return 'blob:test'; };
  URL.revokeObjectURL = () => {};
  try {
    fire($('btn-save'), 'click');
  } finally {
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
  }
  assert.ok(blob instanceof Blob, 'no Blob produced');
  assert.match($('file-meta').textContent, /no pending changes/);

  const { decode } = await import(pathToFileURL(path.join(ROOT, 'src', 'hat.js')).href);
  const doc = decode(new Uint8Array(await blob.arrayBuffer()));
  const flag = doc.properties.find((p) => p.name === 'PlayerCharacterType');
  assert.ok(flag, 'PlayerCharacterType should be in the downloaded file');
  assert.equal(flag.type, 'IntProperty');
  assert.equal(flag.value, 1, '1 is Bow Kid');
  assert.equal(
    doc.properties.find((p) => p.name === 'Loadouts').value.length,
    2,
    'and she needs the second loadout to come with it'
  );
});

await check('revert puts the file, and the switch, back to Hat Kid', () => {
  fire($('btn-revert'), 'click');
  assert.equal(charButton('hat').classList.contains('is-active'), true);
  assert.equal(charButton('bow').classList.contains('is-active'), false);
  assert.match($('file-meta').textContent, /no pending changes/);
  assert.match($('status').textContent, /Reverted/);
});

// ------------------------------------------------------------ toggle --------

console.log('\ntoggle');

await check('uncollecting a time piece updates the tally and change count', () => {
  const row = document.querySelector('#list .row[data-id="chapter1_tutorial"]');
  assert.ok(row, 'row not rendered');
  const box = row.querySelector('input');
  box.checked = false;
  fire(box, 'change');

  assert.equal(tally(), '55 / 56 collected');
  assert.match($('file-meta').textContent, /1 pending change/);
  assert.equal($('btn-save').disabled, false);
});

await check('the row keeps its new state after the list re-renders', () => {
  const row = document.querySelector('#list .row[data-id="chapter1_tutorial"]');
  assert.equal(row.querySelector('input').checked, false);
  assert.match($('list').textContent, /chapter1_tutorial/);
});

// ------------------------------------------------------------ filter --------

console.log('\nfilter');

await check('search narrows the list', () => {
  $('search').value = 'chapter1';
  fire($('search'), 'input');
  assert.equal(rows().length, 4);
  for (const row of rows()) assert.match(row.textContent, /chapter1/);
});

await check('an empty result shows a message', () => {
  $('search').value = 'zzzz-no-such-piece';
  fire($('search'), 'input');
  assert.equal(rows().length, 0);
  assert.ok(document.querySelector('#list .no-match'));
});

await check('clearing the search restores every row', () => {
  $('search').value = '';
  fire($('search'), 'input');
  assert.equal(rows().length, 56);
});

await check('"Not in this save" is empty in a complete save', () => {
  fire(chips('Not in this save'), 'click');
  assert.equal(rows().length, 0);
  assert.ok(document.querySelector('#list .no-match'));

  fire(chips('All'), 'click');
  assert.equal(rows().length, 56);
});

// ------------------------------------------------------------- bulk ---------

console.log('\nbulk');

await check('Select none clears the whole save', () => {
  fire(document.querySelector('[data-bulk="false"]'), 'click');
  assert.equal(tally(), '0 / 56 collected');
  assert.match($('file-meta').textContent, /56 pending changes/);
});

await check('Select all restores it', () => {
  fire(document.querySelector('[data-bulk="true"]'), 'click');
  assert.equal(tally(), '56 / 56 collected');
  assert.match($('file-meta').textContent, /no pending changes/);
});

// ------------------------------------------------- download & revert --------

console.log('\ndownload & revert');

await check('download re-encodes the save and clears the change count', () => {
  URL.createObjectURL = (b) => { blob = b; return 'blob:test'; };
  URL.revokeObjectURL = () => {};
  try {
    fire($('btn-save'), 'click');
  } finally {
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
  }

  assert.ok(blob instanceof Blob, 'no Blob produced');
  assert.ok(blob.size > 500_000, `blob was only ${blob.size} bytes`);
  assert.match($('file-meta').textContent, /no pending changes/);
  assert.match($('status').textContent, /Wrote .* bytes/);
});

await check('the downloaded bytes decode back to a complete save', async () => {
  const { decode } = await import(pathToFileURL(path.join(ROOT, 'src', 'hat.js')).href);
  const doc = decode(new Uint8Array(await blob.arrayBuffer()));
  const timeObjects = doc.properties.find((p) => p.name === 'TimeObjects');
  assert.equal(timeObjects.value.length, 56);
  assert.ok(timeObjects.value.every(
    (e) => e.properties.find((q) => q.name === 'Collected').value === true
  ));
});

await check('revert restores the file as it was loaded', () => {
  fire($('btn-revert'), 'click');
  assert.equal(tally(), '56 / 56 collected');
  assert.match($('file-meta').textContent, /no pending changes/);
  assert.match($('status').textContent, /Reverted/);
});

// ---------------------------------------------------- hats & flairs ----------

console.log('\nhats & flairs');

const goto = (id) => {
  const btn = [...document.querySelectorAll('#nav .nav-item')].find((b) => b.dataset.id === id);
  assert.ok(btn, `nav item ${id} is missing`);
  fire(btn, 'click');
};
const groupTitles = () =>
  [...document.querySelectorAll('#list .group-title')].map((n) => n.textContent);

await check('the Hats category lists the six ability hats', () => {
  goto('hats');
  assert.equal(rows().length, 6);
  assert.equal(tally(), '6 / 6 collected');
  assert.deepEqual(groupTitles(), ['All hats']);
  assert.equal($('banner').hidden, true, 'a modern save needs no banner');
  assert.equal(
    $('chips').querySelector('[data-filter="absent"]'),
    null,
    '"Not in this save" would mean the same thing as "Not collected" here'
  );
  assert.match($('file-meta').textContent, /no pending changes/);
});

await check('uncollecting a hat drops it from the tally', () => {
  const row = document.querySelector('#list .row[data-id="Hat_Ability_TimeStop"]');
  assert.ok(row, 'Hat_Ability_TimeStop not rendered');
  const box = row.querySelector('input');
  box.checked = false;
  fire(box, 'change');

  assert.equal(tally(), '5 / 6 collected');
  assert.match($('file-meta').textContent, /1 pending change/);
});

await check('Hat Flairs lists every cosmetic, grouped by the hat it fits', () => {
  goto('hat-flairs');
  assert.equal(rows().length, 47);
  assert.equal(tally(), '30 / 47 collected');
  assert.deepEqual(
    groupTitles(),
    ['Default Hat', 'Sprint Hat', 'Brewer Hat', 'Ice Hat', 'Dweller Mask', 'Time Stop Hat'],
    `groups were ${groupTitles().join(', ')}`
  );
  assert.equal($('banner').hidden, true);
});

await check('the change made under Hats is still counted from here', () => {
  assert.match($('file-meta').textContent, /1 pending change/);
});

let addedFlair = null;
await check('checking an unchecked flair is counted as a second pending change', () => {
  const row = [...rows()].find((r) => !r.querySelector('input').checked);
  assert.ok(row, 'expected at least one unchecked flair');
  addedFlair = row.dataset.id;
  assert.ok(addedFlair in FLAIR_OBJECTS, `${addedFlair} is not in the catalog`);

  const box = row.querySelector('input');
  box.checked = true;
  fire(box, 'change');

  assert.equal(tally(), '31 / 47 collected');
  assert.match($('file-meta').textContent, /2 pending changes/);
});

await check('the download contains the new hat and flair entries', async () => {
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;
  URL.createObjectURL = (b) => { blob = b; return 'blob:test'; };
  URL.revokeObjectURL = () => {};
  try {
    fire($('btn-save'), 'click');
  } finally {
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
  }
  assert.ok(blob instanceof Blob, 'no Blob produced');
  assert.match($('file-meta').textContent, /no pending changes/);

  const { decode } = await import(pathToFileURL(path.join(ROOT, 'src', 'hat.js')).href);
  const doc = decode(new Uint8Array(await blob.arrayBuffer()));
  const bag = doc.properties.find((p) => p.name === 'MyBackpack2017');
  const array = bag.value.find((p) => p.name === 'Hats');
  const plain = array.value.filter(
    (e) => !e.properties.find((q) => q.name === 'ItemQualityInfoName')
  );

  assert.equal(plain.length, 5, 'the un-collected TimeStop hat should be gone');
  assert.ok(!plain.some((e) => e.properties.find((q) => q.value?.endsWith?.('TimeStop'))));

  const added = array.value.at(-1);
  assert.deepEqual(
    added.properties.map((p) => p.name),
    ['ItemQualityInfo', 'ItemQualityInfoName', 'BackpackClass']
  );
  assert.equal(added.properties.find((p) => p.name === 'ItemQualityInfoName').value, addedFlair);
  assert.equal(added.properties.find((p) => p.name === 'ItemQualityInfo').value,
    FLAIR_OBJECTS[addedFlair].object);
  assert.equal(
    added.properties.find((p) => p.name === 'BackpackClass').value,
    HAT_OBJECTS[FLAIR_OBJECTS[addedFlair].hat],
    'the flair should be attached to the hat it fits'
  );
});

await check('revert puts both categories back as they were', () => {
  fire($('btn-revert'), 'click');
  goto('hats');
  assert.equal(tally(), '6 / 6 collected');
  goto('hat-flairs');
  assert.equal(tally(), '30 / 47 collected');
  assert.match($('file-meta').textContent, /no pending changes/);
});

// ------------------------------------------------------------- badges --------

console.log('\nbadges');

await check('the Badges category lists the catalog, with the missing one unchecked', () => {
  goto('badges');
  assert.equal(rows().length, 17);
  assert.equal(tally(), '16 / 17 collected');
  assert.deepEqual(groupTitles(), ['All badges']);
  assert.equal($('banner').hidden, true);
  assert.equal($('chips').querySelector('[data-filter="absent"]'), null);
  assert.match($('file-meta').textContent, /no pending changes/);

  const missing = document.querySelector('#list .row[data-id="Hat_Badge_Scooter_Subcon"]');
  assert.ok(missing, 'the catalog badge this save lacks should still be listed');
  assert.equal(missing.querySelector('input').checked, false);
});

await check('dropping a badge counts as one pending change', () => {
  const row = document.querySelector('#list .row[data-id="Hat_Badge_Scooter"]');
  assert.ok(row, 'Hat_Badge_Scooter not rendered');
  const box = row.querySelector('input');
  box.checked = false;
  fire(box, 'change');

  assert.equal(tally(), '15 / 17 collected');
  assert.match($('file-meta').textContent, /1 pending change/);
});

await check('the download has one field per badge and leaves the slot upgrades alone', async () => {
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;
  URL.createObjectURL = (b) => { blob = b; return 'blob:test'; };
  URL.revokeObjectURL = () => {};
  try {
    fire($('btn-save'), 'click');
  } finally {
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
  }
  assert.ok(blob instanceof Blob, 'no Blob produced');
  assert.match($('file-meta').textContent, /no pending changes/);

  const { decode } = await import(pathToFileURL(path.join(ROOT, 'src', 'hat.js')).href);
  const doc = decode(new Uint8Array(await blob.arrayBuffer()));
  const bag = doc.properties.find((p) => p.name === 'MyBackpack2017');
  const array = bag.value.find((p) => p.name === 'Badges');

  assert.equal(array.value.length, 15);
  assert.ok(array.value.every((e) => e.class === 'hatintimegamecontent.Hat_BackpackItem'));
  assert.ok(array.value.every(
    (e) => e.properties.length === 1 && e.properties[0].name === 'BackpackClass'
  ), 'a modern badge entry is exactly one BackpackClass');
  assert.ok(!array.value.some((e) => /BadgeSlot/.test(e.properties[0].value)),
    'the slot upgrades must never land in the Badges array');
  assert.equal(
    doc.properties.find((p) => p.name === 'MyBadgeSlots').value,
    2,
    'MyBadgeSlots must not move'
  );
  assert.equal(bag.value.find((p) => p.name === 'Collectibles').value.length, 31,
    'the slot upgrades live in Collectibles and must be untouched');
});

await check('revert restores every badge', () => {
  fire($('btn-revert'), 'click');
  assert.equal(tally(), '16 / 17 collected');
  assert.match($('file-meta').textContent, /no pending changes/);
});

// ------------------------------------------- the other simple backpack lists --

console.log('\ndyes, stickers, weapons, remixes, filters');

await check('Dyes are a flat list of everything unlocked', () => {
  goto('dyes');
  assert.equal(rows().length, 53);
  assert.equal(tally(), '44 / 53 collected');
  assert.deepEqual(groupTitles(), ['All dyes']);
  assert.equal($('banner').hidden, true);
  assert.equal($('chips').querySelector('[data-filter="absent"]'), null);
  assert.ok([...rows()].every((r) => !r.querySelector('input').disabled));
});

await check('a save that has never had a sticker can still gain one', () => {
  goto('stickers');
  assert.equal(rows().length, 78);
  assert.equal(tally(), '0 / 78 collected');
  assert.equal($('banner').hidden, true, 'a modern save can grow a Stickers list');
  assert.ok([...rows()].every((r) => !r.querySelector('input').disabled),
    'no sticker row should be locked');
});

await check('checking a sticker appends a list and writes the entry', async () => {
  const id = 'Hat_Collectible_Sticker_3DRod_Bleeh';
  const row = document.querySelector(`#list .row[data-id="${id}"]`);
  assert.ok(row, 'sticker row not rendered');
  const box = row.querySelector('input');
  box.checked = true;
  fire(box, 'change');

  assert.equal(tally(), '1 / 78 collected');
  assert.match($('file-meta').textContent, /1 pending change/);

  try {
    URL.createObjectURL = (b) => { blob = b; return 'blob:test'; };
    URL.revokeObjectURL = () => {};
    fire($('btn-save'), 'click');
  } finally {
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
  }
  assert.ok(blob instanceof Blob, 'no Blob produced');

  const { decode } = await import(pathToFileURL(path.join(ROOT, 'src', 'hat.js')).href);
  const doc = decode(new Uint8Array(await blob.arrayBuffer()));
  const bag = doc.properties.find((p) => p.name === 'MyBackpack2017');
  const stickers = bag.value.find((p) => p.name === 'Stickers');

  assert.ok(stickers, 'the save should have grown a Stickers list');
  assert.equal(stickers.value.length, 1);
  assert.equal(bag.value.at(-1).name, 'Stickers', 'new lists go at the end of the bag');
  assert.deepEqual(Object.keys(stickers.value[0]).sort(), ['class', 'properties']);
  assert.equal(stickers.value[0].class, 'hatintimegamecontent.Hat_BackpackItem');
  assert.deepEqual(stickers.value[0].properties.map((p) => p.name), ['BackpackClass']);
  assert.equal(stickers.value[0].properties[0].value, `hatintimegamecontent.${id}`);
});

await check('weapons, remixes and camera filters all render and count', () => {
  goto('weapons');
  assert.equal(rows().length, 11);
  assert.equal(tally(), '2 / 11 collected');
  assert.equal($('banner').hidden, true);

  goto('remixes');
  assert.equal(rows().length, 9);
  assert.equal(tally(), '5 / 9 collected');
  assert.deepEqual(groupTitles(), ['All remixes']);

  goto('filters');
  assert.equal(rows().length, 17);
  assert.equal(tally(), '4 / 17 collected');
  assert.deepEqual(groupTitles(), ['All camera filters']);
});

await check('revert takes the sticker back out', () => {
  fire($('btn-revert'), 'click');
  goto('stickers');
  assert.equal(tally(), '0 / 78 collected');
  assert.match($('file-meta').textContent, /no pending changes/);
});

// -------------------------------------------------------- death wishes -------

console.log('\ndeath wishes');

const DW = 'Hat_SnatcherContract_DeathWish_BossRush';
const stamp = (id, i) =>
  [...document.querySelectorAll(`#list .row[data-id="${id}"] .row-fields input`)][i];

await check('Death Wishes lists every contract with three stamp boxes', () => {
  goto('deathwishes');
  assert.equal(rows().length, 38);
  assert.equal(tally(), '0 / 38 collected');
  assert.deepEqual(groupTitles(), ['All death wishes']);
  assert.equal($('banner').hidden, true);
  assert.equal($('chips').querySelector('[data-filter="absent"]'), null,
    '"Not in this save" would mean the same thing as "Not collected" here');
  assert.match($('file-meta').textContent, /no pending changes/);

  assert.equal(document.querySelectorAll('#list .row input').length, 38 * 3,
    'three checkboxes per death wish');
  const row = document.querySelector(`#list .row[data-id="${DW}"]`);
  assert.ok(row, 'BossRush not rendered');
  assert.equal(row.querySelectorAll('.row-field').length, 3);
  assert.equal(row.querySelector('.row-name').textContent, DW, 'internal names stay put');
  assert.equal(row.querySelector('.row-label').tagName.toLowerCase(), 'span',
    'a multi-field row has no single box for its name to label');
  assert.deepEqual(
    [...row.querySelectorAll('.row-field')].map((f) => f.title),
    [`Stamp 1 of ${DW}`, `Stamp 2 of ${DW}`, `Stamp 3 of ${DW}`]
  );
  assert.deepEqual([...row.querySelectorAll('.row-field-key')].map((k) => k.textContent),
    ['1', '2', '3']);
});

await check('ticking stamps writes the documented bit field', async () => {
  const first = stamp(DW, 0);
  first.checked = true;
  fire(first, 'change');

  assert.equal(tally(), '1 / 38 collected');
  assert.match($('file-meta').textContent, /1 pending change/);

  // the second stamp belongs to the same row, so it is still one pending change
  const second = stamp(DW, 1);
  second.checked = true;
  fire(second, 'change');
  assert.equal(tally(), '1 / 38 collected');
  assert.match($('file-meta').textContent, /1 pending change/);
  assert.equal(stamp(DW, 0).checked, true, 'the first stamp must stay ticked');
  assert.equal(stamp(DW, 2).checked, false);

  URL.createObjectURL = (b) => { blob = b; return 'blob:test'; };
  URL.revokeObjectURL = () => {};
  try {
    fire($('btn-save'), 'click');
  } finally {
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
  }
  assert.ok(blob instanceof Blob, 'no Blob produced');
  assert.match($('file-meta').textContent, /no pending changes/);

  const { decode } = await import(pathToFileURL(path.join(ROOT, 'src', 'hat.js')).href);
  const doc = decode(new Uint8Array(await blob.arrayBuffer()));
  const subcon = doc.properties.find((p) => p.name === 'LevelSaveInfo').value
    .find((e) => e.properties.find((q) => q.name === 'Map')?.value === 'subconforest');
  const entry = subcon.properties.find((q) => q.name === 'LevelBits').value
    .find((b) => b.properties.find((q) => q.name === 'IdName')?.value === DW);
  assert.ok(entry, 'the contract should now have a LevelBits entry');
  assert.deepEqual(entry.properties.map((p) => p.name), ['Id', 'Bits', 'IdName']);
  assert.equal(entry.properties.find((p) => p.name === 'Id').value, DW.toLowerCase());
  assert.equal(entry.properties.find((p) => p.name === 'Bits').value, 3,
    'first + second stamp is 1 | 2 = 3');
  assert.equal(entry.properties.find((p) => p.name === 'IdName').value, DW);
});

await check('revert takes the stamps back out', () => {
  fire($('btn-revert'), 'click');
  goto('deathwishes');
  assert.equal(tally(), '0 / 38 collected');
  assert.match($('file-meta').textContent, /no pending changes/);
  assert.equal(stamp(DW, 0).checked, false);
  assert.equal(stamp(DW, 1).checked, false);
});

// ------------------------------------------------------------ backpack -------

console.log('\nbackpack');

const BP = 'Hat_Collectible_BirdPassport';
const bpInputs = (id) => [...document.querySelectorAll(`#list .row[data-id="${id}"] input`)];

await check('Backpack lists the key items with a box and a count', () => {
  goto('backpack');
  assert.equal(rows().length, 24);
  assert.equal(tally(), '12 / 24 collected');
  assert.deepEqual(groupTitles(), ['All backpack items']);
  assert.equal($('banner').hidden, true);
  assert.match($('blurb').textContent, /vault codes, badge parts/);
  assert.equal($('chips').querySelector('[data-filter="absent"]'), null,
    '"Not in this save" would mean the same thing as "Not collected" here');
  assert.match($('file-meta').textContent, /no pending changes/);

  const row = document.querySelector(`#list .row[data-id="${BP}"]`);
  assert.ok(row, 'BirdPassport not rendered');
  assert.equal(row.querySelectorAll('.row-field').length, 2, 'a box and a count');
  assert.deepEqual(
    [...row.querySelectorAll('.row-field-key')].map((k) => k.textContent),
    ['have', 'count']
  );
  assert.equal(row.querySelector('.row-name').textContent, BP, 'internal names stay put');
  assert.equal(row.querySelector('.row-label').tagName.toLowerCase(), 'span',
    'a multi-field row has no single box for its name to label');

  const [box, num] = row.querySelectorAll('input');
  assert.equal(box.type, 'checkbox');
  assert.equal(num.type, 'number');
  assert.equal(num.getAttribute('min'), '0');
  assert.equal(num.value, '0', 'this save has none');
  assert.equal(box.checked, false);
  assert.deepEqual(
    [...row.querySelectorAll('.row-field')].map((f) => f.title),
    [`Owned of ${BP}`, `Count of ${BP}`]
  );
});

await check('typing a count writes that many to Amount', async () => {
  const [, num] = document.querySelector(`#list .row[data-id="${BP}"]`).querySelectorAll('input');
  num.value = '7';
  fire(num, 'change');

  assert.equal(tally(), '13 / 24 collected');
  assert.match($('file-meta').textContent, /1 pending change/);

  const after = bpInputs(BP);
  assert.equal(after[0].checked, true, 'a count above zero means you have it');
  assert.equal(after[1].value, '7', 'the box and the number stay in step');

  URL.createObjectURL = (b) => { blob = b; return 'blob:test'; };
  URL.revokeObjectURL = () => {};
  try {
    fire($('btn-save'), 'click');
  } finally {
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
  }
  assert.ok(blob instanceof Blob, 'no Blob produced');
  assert.match($('file-meta').textContent, /no pending changes/);

  const { decode } = await import(pathToFileURL(path.join(ROOT, 'src', 'hat.js')).href);
  const doc = decode(new Uint8Array(await blob.arrayBuffer()));
  const list = doc.properties.find((p) => p.name === 'MyBackpack2017').value
    .find((p) => p.name === 'Collectibles');
  const entry = list.value.find((e) => e.properties.some(
    (q) => q.name === 'BackpackClass' &&
      q.value === 'hatintimegamecontent.Hat_Collectible_BirdPassport'
  ));
  assert.ok(entry, 'the passport should now be in the save');
  assert.equal(entry.class, 'hatintimegamecontent.Hat_CollectibleBackpackItem');
  assert.deepEqual(entry.properties.map((p) => p.name), ['Amount', 'BackpackClass']);
  assert.equal(entry.properties.find((p) => p.name === 'Amount').value, 7);
});

await check('unticking the box takes the passport, and its count, away', () => {
  const [box] = bpInputs(BP);
  box.checked = false;
  fire(box, 'change');

  assert.equal(tally(), '12 / 24 collected');
  assert.match($('file-meta').textContent, /1 pending change/);
  assert.equal(bpInputs(BP)[1].value, '0', 'the count goes with the entry');

  fire($('btn-revert'), 'click');
  goto('backpack');
  assert.equal(tally(), '12 / 24 collected');
  assert.match($('file-meta').textContent, /no pending changes/);
});

// --------------------------------------------------------------- more ---------

console.log('\nmore');

/** The first Challenge Road in Collectibles.txt; Deathwish.hat has banked none. */
const ROAD = '1758385712_1757019439_1747469442';

await check('More lists the fields nothing else covers, in order', () => {
  goto('more');
  assert.equal(rows().length, 123);
  assert.equal(tally(), '19 / 123 collected');
  assert.deepEqual(groupTitles(),
    ['Stats', 'Play time', 'Save state', 'Secret levels', 'Challenge roads',
      'Snatcher contracts', 'ActBits'],
    `groups were ${groupTitles().join(', ')}`);
  assert.equal($('banner').hidden, true, 'nothing here is ever refused as a whole');
  assert.equal(document.querySelectorAll('#list .tag-absent').length, 10,
    'the fields and flags this save has no record of');
  assert.equal(document.querySelectorAll('#list .row input').length, 154,
    '11 counts plus TotalPlayTime h/m/s/cs and one box, 10 levels, 79 roads, three boxes per contract, 7 flag counts');
  assert.equal(document.querySelectorAll('#list .tag-mod').length, 0,
    'an unmodded save must not be shown a rift it cannot reach');
  assert.ok([...document.querySelectorAll('#list .row-name')]
    .every((n) => !n.textContent.startsWith('Mod:')),
    'no mod-made secret level in an unmodded save');
  assert.match($('file-meta').textContent, /no pending changes/);

  // labels stay the raw property names and raw ids, nothing prettified
  const names = [...document.querySelectorAll('#list .row .row-name')].map((n) => n.textContent);
  for (const id of ['MyEnergyBits', 'TotalPlayTime', 'LastPlayTime', 'AllowSaving',
    'Sands_PurpleRiftSandSails', ROAD, 'Hat_SnatcherContract_IceWall', 'uncollectedpons']) {
    assert.ok(names.includes(id), `${id} should be a row label`);
  }
});

await check('the "Not in this save" filter shows only what the save lacks', () => {
  fire(chips('Not in this save'), 'click');
  assert.equal(rows().length, 10);
  assert.ok([...rows()].every((r) => r.querySelector('.tag-absent')));
  fire(chips('All'), 'click');
  assert.equal(rows().length, 123);
});

await check('typing a pons count creates the field the save was missing', () => {
  const row = document.querySelector('#list .row[data-id="MyEnergyBits"]');
  assert.ok(row, 'MyEnergyBits row not rendered');
  assert.ok(row.querySelector('.tag-absent'), 'and this save has none');
  const num = row.querySelector('input');
  num.value = '4242';
  fire(num, 'change');

  assert.match($('file-meta').textContent, /1 pending change/);
  const after = document.querySelector('#list .row[data-id="MyEnergyBits"]');
  assert.equal(after.querySelector('input').value, '4242');
  assert.ok(!after.querySelector('.tag-absent'), 'it is in the save now');
  assert.equal(tally(), '20 / 123 collected', 'a non-zero value ticks the row');
});

await check('a locked secret level is one string away', () => {
  const row = document.querySelector('#list .row[data-id="Sands_PurpleRiftSandSails"]');
  assert.ok(row, 'that level should be locked here');
  const box = row.querySelector('input');
  assert.equal(box.checked, false);
  box.checked = true;
  fire(box, 'change');

  assert.match($('file-meta').textContent, /2 pending changes/);
  assert.equal(tally(), '21 / 123 collected');
});

await check('a challenge road is one string away', () => {
  const row = document.querySelector(`#list .row[data-id="${ROAD}"]`);
  assert.ok(row, 'the road should be offered even though this save has banked none');
  assert.equal(row.querySelector('.tag-absent'), null, 'a ticked-or-not box is never "absent"');
  const box = row.querySelector('input');
  assert.equal(box.checked, false);
  box.checked = true;
  fire(box, 'change');

  assert.match($('file-meta').textContent, /3 pending changes/);
  assert.equal(tally(), '22 / 123 collected');
  assert.ok(document.querySelector(`#list .row[data-id="${ROAD}"] input`).checked,
    'and the row reads it back');
});

await check('the three contract boxes move independently', () => {
  const boxAt = (i) => document
    .querySelector('#list .row[data-id="Hat_SnatcherContract_FeedSpider"]')
    .querySelectorAll('input')[i];
  assert.equal(
    document.querySelectorAll('#list .row[data-id="Hat_SnatcherContract_FeedSpider"] input').length,
    3, 'completed / turned in / offered'
  );
  assert.deepEqual([boxAt(0).checked, boxAt(1).checked, boxAt(2).checked],
    [false, false, false], 'this contract has never been touched');

  boxAt(0).checked = true;
  fire(boxAt(0), 'change');

  assert.deepEqual([boxAt(0).checked, boxAt(1).checked, boxAt(2).checked],
    [true, false, false], 'only Completed moved');
  assert.match($('file-meta').textContent, /4 pending changes/);
});

await check('an ActBits count writes the flag', () => {
  const row = document.querySelector('#list .row[data-id="hasenteredwater"]');
  assert.ok(row, 'the flag is offered even though this save has never tracked it');
  assert.ok(row.querySelector('.tag-absent'));
  const num = row.querySelector('input');
  num.value = '1';
  fire(num, 'change');

  assert.match($('file-meta').textContent, /5 pending changes/);
  assert.equal(tally(), '24 / 123 collected');
});

await check('the download carries all five edits', async () => {
  URL.createObjectURL = (b) => { blob = b; return 'blob:test'; };
  URL.revokeObjectURL = () => {};
  try {
    fire($('btn-save'), 'click');
  } finally {
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
  }
  assert.ok(blob instanceof Blob, 'no Blob produced');
  assert.match($('file-meta').textContent, /no pending changes/);

  const { decode } = await import(pathToFileURL(path.join(ROOT, 'src', 'hat.js')).href);
  const doc = decode(new Uint8Array(await blob.arrayBuffer()));
  const top = (name) => doc.properties.find((p) => p.name === name);

  assert.deepEqual(top('MyEnergyBits'),
    { name: 'MyEnergyBits', type: 'IntProperty', arrayIndex: 0, value: 4242 },
    'the field is written the way the game writes it');
  const names = doc.properties.map((p) => p.name);
  assert.equal(names.indexOf('MyEnergyBits'),
    names.indexOf('MyLifeTimeBadgePoints') + 1, 'and it landed among its neighbours');

  assert.ok(top('UnlockedSecretLevels').value.includes('Sands_PurpleRiftSandSails'),
    'the secret level is one string in the list');
  assert.deepEqual(top('ChallengeRoadIDs').value, [ROAD],
    'and so is the challenge road, in a list this save did not have');
  assert.equal(top('ChallengeRoadIDs').elementType, 'string');
  assert.ok(top('CompletedSnatcherContracts').value
    .includes('hatintimegamecontent.Hat_SnatcherContract_FeedSpider'),
  'the contract is written qualified');
  assert.equal(top('SnatcherContracts'), undefined, 'the other two boxes stayed off');

  const flag = top('ActBits').value
    .find((e) => e.properties.find((q) => q.name === 'IdName')?.value === 'hasenteredwater');
  assert.ok(flag, 'the flag is tracked now');
  assert.deepEqual(flag.properties.map((q) => [q.name, q.value]),
    [['Id', 'hasenteredwater'], ['Bits', 1], ['IdName', 'hasenteredwater']]);
});

await check('Select all ticks boxes but never rewrites a number', () => {
  const numbers = () => [...document.querySelectorAll('#list input[type="number"]')]
    .map((i) => i.value);
  const before = numbers();
  assert.equal(before.length, 22, '11 scalar counts plus TotalPlayTime h/m/s/cs and 7 flag counts');

  fire(document.querySelector('[data-bulk="true"]'), 'click');

  assert.deepEqual(numbers(), before, 'a number has no "checked" state to bulk-set');
  assert.ok([...document.querySelectorAll('#list .row input[type="checkbox"]')]
    .every((b) => b.checked), 'every box in sight is on');
  assert.match($('file-meta').textContent, /pending change/);
});

await check('revert puts the file back as it was loaded', () => {
  fire($('btn-revert'), 'click');
  goto('more');
  assert.equal(tally(), '19 / 123 collected');
  assert.equal(document.querySelectorAll('#list .tag-absent').length, 10);
  assert.match($('file-meta').textContent, /no pending changes/);
});

// --------------------------------------------------- a pre-2017 save ---------

console.log('\nthe pre-2017 save');

await check('1.0 Hundo.hat renders hats and badges but refuses flairs', async () => {
  const bytes = read('1.0 Hundo.hat');
  fire(document, 'drop', {
    dataTransfer: {
      files: [{
        name: '1.0 Hundo.hat',
        arrayBuffer: async () =>
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      }],
    },
  });
  await tick();

  goto('hats');
  assert.equal(rows().length, 6);
  assert.equal(tally(), '6 / 6 collected');
  assert.equal($('banner').hidden, true, 'hats are still editable here');

  goto('badges');
  assert.equal(rows().length, 17);
  assert.equal(tally(), '11 / 17 collected');
  assert.equal($('banner').hidden, true, 'badges are editable in the old format too');
  assert.ok([...rows()].every((r) => !r.querySelector('input').disabled));

  goto('dyes');
  assert.equal(rows().length, 53);
  assert.equal(tally(), '6 / 53 collected');
  assert.equal($('banner').hidden, true, 'the pre-2017 save does have a Skins list');

  // Unlike Weapons, the old backpack does have a Collectibles list — the same
  // one the counts live in, minus the per-element class the current format has.
  goto('backpack');
  assert.equal(rows().length, 24);
  assert.equal(tally(), '8 / 24 collected');
  assert.equal($('banner').hidden, true, 'the pre-2017 save does have a Collectibles list');
  assert.ok([...rows()].every((r) => !r.querySelector('input').disabled));
  assert.equal(document.querySelectorAll('#list .row input').length, 24 * 2,
    'a box and a count per item');

  goto('weapons');
  assert.equal($('banner').hidden, false, 'the pre-2017 save has no weapon list');
  assert.match($('banner').textContent, /pre-2017 backpack/);
  assert.equal(tally(), '0 / 11 collected');
  assert.ok([...rows()].every((r) => r.querySelector('input').disabled),
    'rows with no list behind them must be inert');

  goto('hat-flairs');
  assert.match($('banner').textContent, /pre-2017/);
  assert.equal($('banner').hidden, false);
  assert.equal(rows().length, 47);
  assert.equal(tally(), '0 / 47 collected');
  assert.ok([...rows()].every((r) => r.querySelector('input').disabled),
    'every flair checkbox should be inert');

  fire(document.querySelector('[data-bulk="true"]'), 'click');
  assert.equal(tally(), '0 / 47 collected', 'bulk edit must skip disabled rows');
  assert.match($('file-meta').textContent, /no pending changes/);

  // Death Wishes are not a backpack list — the pre-2017 save has a perfectly
  // good Subcon Forest entry to store its stamps in, so it stays editable.
  goto('deathwishes');
  assert.equal(rows().length, 38);
  assert.equal(tally(), '0 / 38 collected');
  assert.equal($('banner').hidden, true);
  assert.ok([...rows()].every((r) => !r.querySelector('input').disabled));
  assert.equal(document.querySelectorAll('#list .row input').length, 38 * 3);
});

// --------------------------------------------------- a save with mod pieces --

console.log('\na heavily modded save');

await check('CDLC1 renders its 625 pieces and marks the mod ones', async () => {
  const bytes = read('CDLC1 Hundo.hat');
  fire(document, 'drop', {
    dataTransfer: {
      files: [{
        name: 'CDLC1 Hundo.hat',
        arrayBuffer: async () =>
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      }],
    },
  });
  await tick();

  goto('time-pieces');
  assert.equal($('file-name').textContent, 'CDLC1 Hundo.hat');
  assert.equal(rows().length, 625);
  assert.equal(tally(), '625 / 625 collected');
  assert.ok(document.querySelectorAll('#list .tag-mod').length > 500,
    'mod pieces should be badged');

  // A known vanilla id from the list must still be toggleable.
  const row = document.querySelector('#list .row[data-id="Metro_RouteA"]');
  assert.ok(row, 'Metro_RouteA not rendered');
  row.querySelector('input').checked = false;
  fire(row.querySelector('input'), 'change');
  assert.equal(tally(), '624 / 625 collected');

  // 296 of this save's 304 remix entries are empty placeholders — they must
  // never turn into rows. Collectibles is padded the same way, 133 of 170.
  goto('remixes');
  assert.equal(rows().length, 9);
  assert.equal(tally(), '8 / 9 collected');

  goto('backpack');
  assert.equal(rows().length, 24, '133 empty Collectibles entries are not rows');
  assert.equal(tally(), '19 / 24 collected');
  assert.equal($('banner').hidden, true);
  assert.deepEqual(groupTitles(), ['All backpack items']);

  // This save also carries 145 mod death wishes next to the 38 vanilla ones.
  goto('deathwishes');
  assert.equal(rows().length, 183, '38 catalog contracts plus 145 mod ones');
  assert.equal(tally(), '183 / 183 collected');
  assert.deepEqual(groupTitles(), ['All death wishes', 'Not in Collectibles.txt']);
  assert.ok(
    [...document.querySelectorAll('#list .row .tag')].some((t) => t.textContent === 'not in Collectibles.txt'),
    'mod contracts should be badged'
  );
  assert.ok(
    !document.querySelector('#list .row[data-id="Hat_SnatcherContract_DeathWish_BossRush_0"]'),
    'the per-tier bits beside a contract are not death wishes'
  );
  assert.ok(
    document.querySelector('#list .row[data-id="Hat_SnatcherContract_DeathWish_CameraTourist_1"]'),
    'CameraTourist_1 is a real contract that happens to end in a digit'
  );
});

console.log(failures ? `\n${failures} FAILURES\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
