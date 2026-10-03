import { decode, encode } from '../src/hat.js';
import { CATEGORIES } from './registry.js';
import { characterOf, characterBlocker, setCharacter, characterSetting, CHARACTER_ROW } from './character.js';

const $ = (id) => document.getElementById(id);
const el = {
  fileName: $('file-name'),
  fileMeta: $('file-meta'),
  btnOpen: $('btn-open'),
  btnOpen2: $('btn-open-2'),
  btnRevert: $('btn-revert'),
  btnSave: $('btn-save'),
  fileInput: $('file-input'),
  nav: $('nav'),
  empty: $('empty'),
  editor: $('editor'),
  drop: $('drop'),
  character: $('character'),
  catTitle: $('cat-title'),
  blurb: $('blurb'),
  banner: $('banner'),
  tally: $('tally'),
  search: $('search'),
  chips: $('chips'),
  list: $('list'),
  notesBody: $('notes-body'),
  status: $('status'),
};

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'collected', label: 'Collected' },
  { id: 'uncollected', label: 'Not collected' },
  { id: 'absent', label: 'Not in this save' },
];

/**
 * Everything whose state counts toward "pending changes": the sidebar's
 * categories, plus settings that live outside them — currently just the
 * Hat Kid / Bow Kid switch in the top bar.
 */
const TRACKED = [...CATEGORIES, characterSetting];

const state = {
  bytes: null,      // bytes as loaded from disk (what Revert restores)
  doc: null,        // decoded, mutated in place
  fileName: '',
  category: CATEGORIES[0],
  baselines: new Map(),  // category id -> Map of row id -> signature in the file
  query: '',
  filter: 'all',
};

const h = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.append(child);
  }
  return node;
};

const formatBytes = (n) => `${n.toLocaleString('en-US')} bytes`;

// ------------------------------------------------------------------ status ----

let statusTimer = 0;
function setStatus(text, kind = '') {
  clearTimeout(statusTimer);
  el.status.textContent = text;
  el.status.className = `status${kind ? ' status-' + kind : ''}`;
  if (kind !== 'error') {
    statusTimer = setTimeout(() => {
      el.status.textContent = '';
      el.status.className = 'status';
    }, 6000);
  }
}

// ---------------------------------------------------------------- loading ----

async function loadFile(file) {
  let bytes;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (err) {
    setStatus(`Could not read the file: ${err.message}`, 'error');
    return;
  }
  loadBytes(bytes, file.name);
}

function loadBytes(bytes, name) {
  let doc;
  try {
    doc = decode(bytes);
  } catch (err) {
    setStatus(`Could not decode ${name}: ${err.message}`, 'error');
    return;
  }
  state.bytes = bytes;
  state.doc = doc;
  state.fileName = name;
  state.query = '';
  state.filter = 'all';
  el.search.value = '';

  el.empty.hidden = true;
  el.editor.hidden = false;
  el.btnRevert.disabled = false;
  el.btnSave.disabled = false;
  el.fileName.textContent = name;

  rebaseline();
  renderChips();
  renderEditor();
  renderCharacter();
  setStatus(`Loaded ${name} — ${doc.properties.length} top-level properties.`);
}

/**
 * One row's whole state as a comparable string.
 *
 * Most rows are a single checkbox, but Death Wishes carries three stamp boxes
 * per row and Backpack a checkbox plus a count, so "was this row different when
 * the file was loaded?" has to look at every field — and at their values, not
 * merely whether they are truthy, or 3 -> 5 would count as no change.
 */
function signatureOf(row) {
  if (Array.isArray(row.fields)) {
    return row.fields.map((f) => `${f.key}=${f.value ?? ''}`).join(' ');
  }
  return `checked=${row.checked ? 1 : 0}`;
}

/**
 * Snapshot what every category considers "collected" in the file as it stands.
 * Called on load and on download — never on a category switch, so a change made
 * under Hats stays counted while you are looking at Time Pieces.
 */
function rebaseline() {
  state.baselines.clear();
  if (!state.doc) return;
  for (const cat of TRACKED) {
    state.baselines.set(
      cat.id,
      new Map(cat.rows(state.doc).map((row) => [row.id, signatureOf(row)]))
    );
  }
}

// -------------------------------------------------------------- navigation ----

function renderNav() {
  el.nav.replaceChildren(
    ...CATEGORIES.map((cat) =>
      h('li', {}, [
        h('button', {
          type: 'button',
          class: 'nav-item',
          dataset: { id: cat.id },
          text: cat.title,
          onclick: () => selectCategory(cat.id),
        }),
      ])
    )
  );
  syncNav();
}

function syncNav() {
  for (const btn of el.nav.querySelectorAll('.nav-item')) {
    btn.classList.toggle('is-active', btn.dataset.id === state.category.id);
    btn.disabled = !state.doc;
    if (btn.dataset.id === state.category.id) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }
}

function selectCategory(id) {
  const cat = CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[0];
  state.category = cat;
  state.filter = 'all';
  state.query = '';
  el.search.value = '';
  history.replaceState(null, '', `#/${cat.id}`);
  renderChips();
  renderEditor();
}

// --------------------------------------------------------------- rendering ----

function renderChips() {
  // Each category declares which filters make sense for it; "Not in this save"
  // is a time-pieces concept that would just mean "not collected" for hats.
  const allowed = new Set(state.category.filters ?? FILTERS.map((f) => f.id));
  el.chips.replaceChildren(
    ...FILTERS.filter((f) => allowed.has(f.id)).map((f) =>
      h('button', {
        type: 'button',
        class: `chip${state.filter === f.id ? ' is-on' : ''}`,
        text: f.label,
        dataset: { filter: f.id },
        onclick: () => {
          state.filter = f.id;
          renderChips();
          renderList();
        },
      })
    )
  );
}

/**
 * The Hat Kid / Bow Kid switch. One button is lit for the character the save
 * already is; the other carries the reason it cannot be chosen, if any.
 */
function renderCharacter() {
  const doc = state.doc;
  el.character.hidden = !doc;
  const current = doc ? characterOf(doc) : null;

  for (const btn of el.character.querySelectorAll('[data-character]')) {
    const target = btn.dataset.character;
    const blocker = doc ? characterBlocker(doc, target) : 'No file is loaded.';
    const active = target === current;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    btn.disabled = !!blocker;
    btn.title = blocker ?? characterSetting.explain(CHARACTER_ROW, target === 'bow') ?? '';
  }
}

function renderEditor() {
  const cat = state.category;
  el.catTitle.textContent = cat.title;
  el.blurb.textContent = cat.blurb ?? '';
  el.notesBody.replaceChildren(
    ...(cat.notes ?? []).map((line) => h('p', { text: line }))
  );

  const bannerText = state.doc && typeof cat.banner === 'function' ? cat.banner(state.doc) : null;
  el.banner.textContent = bannerText ?? '';
  el.banner.hidden = !bannerText;

  if (state.doc) {
    renderList();
    refreshMeta();
  }
  syncNav();
}

function matches(row) {
  const q = state.query.trim().toLowerCase();
  if (q && !row.label.toLowerCase().includes(q)) return false;
  if (state.filter === 'collected') return row.checked;
  if (state.filter === 'uncollected') return !row.checked;
  if (state.filter === 'absent') return row.present === false;
  return true;
}

function renderList() {
  if (!state.doc) return;
  const cat = state.category;
  const rows = cat.rows(state.doc);

  const keepScroll = el.list.scrollTop;
  const active = document.activeElement;
  const activeRow = active?.closest?.('.row') ?? null;
  const focused = activeRow?.dataset.id ?? null;
  // stay on the *same control*: a row can hold a box and a count, and the
  // caret must come back to the number that was just edited
  const focusedIndex = activeRow ? [...activeRow.querySelectorAll('input')].indexOf(active) : -1;

  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.group)) groups.set(row.group, []);
    groups.get(row.group).push(row);
  }
  const keys = [...groups.keys()].sort(cat.compareGroups);

  const fragment = document.createDocumentFragment();
  let shown = 0;

  for (const key of keys) {
    const visible = groups.get(key).filter(matches);
    if (!visible.length) continue;
    shown += visible.length;

    const all = groups.get(key);
    const done = all.filter((r) => r.checked).length;
    const section = h('section', { class: 'group' }, [
      h('header', { class: 'group-head' }, [
        h('span', { class: 'group-title', text: cat.groupTitle(key), title: key }),
        h('span', { class: 'group-count', text: `${done}/${all.length}` }),
      ]),
      h(
        'ul',
        { class: 'group-list' },
        visible.map((row) => rowNode(row))
      ),
    ]);
    fragment.append(section);
  }

  if (!shown) {
    fragment.append(h('p', { class: 'no-match', text: 'Nothing matches this filter.' }));
  }

  el.list.replaceChildren(fragment);
  el.list.scrollTop = keepScroll;
  if (focused) {
    const inputs = el.list.querySelectorAll(`.row[data-id="${cssEscape(focused)}"] input`);
    (inputs[focusedIndex] ?? inputs[0])?.focus();
  }
}

function cssEscape(value) {
  return CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}

function rowNode(row) {
  const tags = [];
  if (row.present === false) tags.push(h('span', { class: 'tag tag-absent', text: 'not in this save' }));
  if (row.mod) tags.push(h('span', { class: 'tag tag-mod', text: 'mod' }));
  if (row.note) tags.push(h('span', { class: 'tag', text: row.note }));

  const kids = [];

  if (hasFields(row)) {
    // The row's state lives in its fields (three stamp boxes per death wish),
    // so there is no single box to click — the name stays inert text.
    kids.push(
      h('span', { class: 'row-label row-label--plain' }, [
        h('span', { class: 'row-name', text: row.label }),
      ]),
      h('span', { class: 'row-fields' }, row.fields.map((field) => fieldNode(row, field)))
    );
  } else {
    const box = h('input', {
      type: 'checkbox',
      disabled: row.disabled ? '' : null,
      onchange: (event) => applyToggle(row.id, event.target.checked),
    });
    box.checked = row.checked;
    kids.push(
      h('label', { class: 'row-label' }, [box, h('span', { class: 'row-name', text: row.label })])
    );
  }

  if (tags.length) kids.push(h('span', { class: 'row-tags' }, tags));

  return h('li', { class: `row${row.disabled ? ' is-disabled' : ''}`, dataset: { id: row.id } }, kids);
}

const hasFields = (row) => Array.isArray(row.fields) && row.fields.length > 0;

function fieldNode(row, field) {
  const isBox = field.type === 'checkbox' || !field.type;
  const props = {
    type: isBox ? 'checkbox' : field.type,
    disabled: row.disabled ? '' : null,
    'aria-label': `${field.label} of ${row.label}`,
    onchange: (event) => applyField(row.id, field.key, fieldValue(field, event.target)),
  };
  if (!isBox) {
    props.min = field.min ?? 0;
    props.step = field.step ?? 1;
    if (field.max !== undefined) props.max = field.max;
  }

  const input = h('input', props);
  if (isBox) input.checked = !!field.value;
  else input.value = field.value;

  return h('label', { class: 'row-field', title: `${field.label} of ${row.label}` }, [
    input,
    field.text === null || field.text === undefined
      ? null
      : h('span', { class: 'row-field-key', text: String(field.text) }),
  ]);
}

/** What a control holds, as the type the category expects. */
function fieldValue(field, target) {
  if (field.type === 'checkbox' || !field.type) return target.checked;
  if (field.type === 'number') {
    // an emptied box is "not a number yet", never a zero: clearing a count
    // must not quietly mean "you no longer have this"
    const text = target.value.trim();
    if (text === '') return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }
  return target.value;
}

function refreshMeta() {
  if (!state.doc) return;
  const rows = state.category.rows(state.doc);
  const selected = rows.filter((r) => r.checked).length;

  // Pending changes are counted across every category, not just the visible one.
  let changes = 0;
  for (const cat of TRACKED) {
    const base = state.baselines.get(cat.id);
    if (!base) continue;
    const now = new Map(cat.rows(state.doc).map((row) => [row.id, signatureOf(row)]));
    for (const id of new Set([...base.keys(), ...now.keys()])) {
      if (base.get(id) !== now.get(id)) changes += 1;
    }
  }

  el.tally.textContent = `${selected.toLocaleString('en-US')} / ${rows.length.toLocaleString('en-US')} collected`;
  el.fileMeta.textContent =
    `${formatBytes(state.bytes.length)}` +
    (changes ? ` · ${changes} pending change${changes === 1 ? '' : 's'}` : ' · no pending changes');
}

// ------------------------------------------------------------- editing ops ----

function applyToggle(id, checked) {
  if (!state.category.set(state.doc, id, checked)) {
    renderList();
    return;
  }
  renderList();
  refreshMeta();
}

/** The Hat Kid / Bow Kid switch in the top bar. */
function applyCharacterChoice(target) {
  if (!state.doc) return;
  const blocker = characterBlocker(state.doc, target);
  if (blocker) {
    setStatus(blocker, 'error');
    renderCharacter();
    return;
  }
  const changed = setCharacter(state.doc, target);
  renderCharacter();
  if (!changed) return;
  refreshMeta();
  setStatus(characterSetting.explain(CHARACTER_ROW, target === 'bow') ?? '');
}

/** One field of a multi-field row — e.g. the second stamp of a death wish. */
function applyField(id, key, value) {
  const setField = state.category.setField;
  const changed = typeof setField === 'function' && setField(state.doc, id, key, value);
  renderList();
  if (changed) refreshMeta();
}

function applyBulk(checked) {
  const visible = state.category.rows(state.doc).filter((row) => !row.disabled && matches(row));
  let changed = false;
  // `set` is idempotent and reports whether it actually wrote anything, so
  // there is nothing to pre-compare here: a partial row still needs all three
  // of its stamps set when you ask for "all".
  for (const row of visible) {
    if (state.category.set(state.doc, row.id, checked)) changed = true;
  }
  if (!changed) return;
  renderList();
  refreshMeta();
}

function download() {
  if (!state.doc) return;
  let bytes;
  try {
    bytes = encode(state.doc);
  } catch (err) {
    setStatus(`Could not encode: ${err.message}`, 'error');
    return;
  }
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: state.fileName || 'save.hat' });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  rebaseline();
  refreshMeta();
  setStatus(
    `Wrote ${formatBytes(bytes.length)} (loaded file was ${formatBytes(state.bytes.length)}).`
  );
}

function revert() {
  if (!state.bytes) return;
  loadBytes(state.bytes, state.fileName);
  setStatus('Reverted to the file as it was loaded.');
}

// ---------------------------------------------------------------- wiring ------

el.btnOpen.addEventListener('click', () => el.fileInput.click());
el.btnOpen2.addEventListener('click', () => el.fileInput.click());
el.fileInput.addEventListener('change', () => {
  const file = el.fileInput.files?.[0];
  if (file) loadFile(file);
  el.fileInput.value = '';
});
el.btnSave.addEventListener('click', download);
el.btnRevert.addEventListener('click', revert);

for (const btn of document.querySelectorAll('[data-character]')) {
  btn.addEventListener('click', () => applyCharacterChoice(btn.dataset.character));
}

el.search.addEventListener('input', () => {
  state.query = el.search.value;
  renderList();
});

for (const btn of document.querySelectorAll('[data-bulk]')) {
  btn.addEventListener('click', () => applyBulk(btn.dataset.bulk === 'true'));
}

/** Highlight the drop target: the drop zone before a load, the whole editor after. */
const setDragging = (on) => {
  el.drop.classList.toggle('is-hot', on);
  document.body.classList.toggle('is-dragging', on);
};

document.addEventListener('dragover', (event) => {
  event.preventDefault();
  setDragging(true);
});
document.addEventListener('dragleave', (event) => {
  if (!event.relatedTarget) setDragging(false);
});
document.addEventListener('drop', (event) => {
  event.preventDefault();
  setDragging(false);
  const file = event.dataTransfer?.files?.[0];
  if (file) loadFile(file);
});

document.addEventListener('keydown', (event) => {
  const mod = event.ctrlKey || event.metaKey;
  if (!mod) return;
  if (event.key === 'o') { event.preventDefault(); el.fileInput.click(); }
  if (event.key === 's') { event.preventDefault(); download(); }
});

// ------------------------------------------------------------------ start -----

renderNav();
renderCharacter();
selectCategory((location.hash || '').replace(/^#\//, '') || CATEGORIES[0].id);
setStatus('Open a .hat file to begin.');
