/**
 * Time Pieces category.
 *
 * Save representation
 *   TimeObjects[]                    { Id, Collected, Paid, Highscore|HighScore,
 *                                      IsAct, [IsMod, ModPackage] }
 *   CurrentCollectedTimePieces       count of collected non-mod pieces (optional)
 *   CurrentCollectedTimePieces_Mods  count of collected mod pieces     (optional)
 *
 * What this category touches
 *   - TimeObjects[].Collected                       (always)
 *   - appends a TimeObjects[] entry                 (when collecting an id the
 *                                                     save does not know yet)
 *   - creates the TimeObjects list itself           (only on that append —
 *                                                     rows() never writes)
 *   - the two counters above, *only if they exist*  (recomputed, never created)
 *
 * Deliberately left alone: SpeedrunTimeObjects (best-times table),
 * UnlockedSecretLevels (secret level unlocks, editable in **More**),
 * ActBits and LevelSaveInfo (Death Wishes writes the Subcon element, More the
 * ActBits flags), and everything outside TimeObjects.
 */
import { ORDER, CHAPTERS, TEMPLATES } from '../data/time-pieces.js';

const top = (doc, name) => doc.properties.find((p) => p.name === name);
const prop = (el, name) => el.properties.find((q) => q.name === name);
const boolOf = (el, name) => {
  const p = prop(el, name);
  return p ? !!p.value : false;
};
const idOf = (el) => prop(el, 'Id')?.value;

/* ------------------------ animation-seen flags --------------------------- */

/** id -> { chapter, actId }, read from this save's own speedrun table. */
function speedrunIndex(doc) {
  const map = new Map();
  const speedrun = top(doc, 'SpeedrunTimeObjects');
  if (Array.isArray(speedrun?.value)) {
    for (const el of speedrun.value) {
      const id = prop(el, 'Id')?.value;
      if (id !== undefined) map.set(id, { chapter: prop(el, 'ChapterName')?.value, actId: prop(el, 'ActID')?.value });
    }
  }
  return map;
}

const chapterSlot = (chapter) => /^Chapter(\d+)_/.exec(chapter ?? '')?.[1] ?? null;
const modInfo = (id) => /^Mod:(\d+):(.+)$/.exec(id)?.slice(1) ?? null;

/** Every LevelBits entry whose Id starts with actselectanimation_, keyed by Id. */
function animBits(doc) {
  const idx = new Map();
  const lsb = top(doc, 'LevelSaveInfo');
  if (!Array.isArray(lsb?.value)) return idx;
  for (const el of lsb.value) {
    const lb = prop(el, 'LevelBits');
    if (!Array.isArray(lb?.value)) continue;
    for (const entry of lb.value) {
      const id = idOf(entry);
      if (typeof id === 'string' && id.startsWith('actselectanimation_')) idx.set(id, { entry, list: lb.value });
    }
  }
  return idx;
}

/** hash -> Set of numeric slot strings seen on act masks or freeroam keys. */
function hashSlots(idx) {
  const out = new Map();
  for (const key of idx.keys()) {
    const m = /^actselectanimation_(?:unlock|complete|finalefill)_(\d+):(-?\d+)$/.exec(key)
      ?? /^actselectanimation_unlock_freeroam_(\d+):(-?\d+)$/.exec(key);
    if (m) {
      if (!out.has(m[1])) out.set(m[1], new Set());
      out.get(m[1]).add(m[2]);
    }
  }
  return out;
}

/** The unlock/complete key names for a time piece, plus its bit if it's an act. */
function animTarget(doc, id, isRift) {
  const speedrun = speedrunIndex(doc).get(id);
  const rift = isRift ?? (speedrun ? speedrun.actId === -1 : /^(TimeRift|Spaceship_)/.test(id));
  const chapter = speedrun?.chapter ?? CHAPTERS[id] ?? null;
  const slot = chapterSlot(chapter);
  const idx = animBits(doc);
  const mod = modInfo(id);

  if (mod) {
    const [hash, suffix] = mod;
    if (rift) {
      const stem = `${hash}:${suffix.toLowerCase()}`;
      return { unlock: `actselectanimation_unlock_${stem}`, complete: `actselectanimation_complete_${stem}`, rift: true, bit: null };
    }
    const slots = hashSlots(idx).get(hash);
    const one = slots && slots.size === 1 ? [...slots][0] : null;
    const bit = Number.isInteger(speedrun?.actId) && speedrun.actId >= 0 ? speedrun.actId - 1 : null;
    if (one === null || bit === null) return null;
    return { unlock: `actselectanimation_unlock_${hash}:${one}`, complete: `actselectanimation_complete_${hash}:${one}`, rift: false, bit };
  }

  if (rift) {
    const stem = id.toLowerCase();
    return { unlock: `actselectanimation_unlock_${stem}`, complete: `actselectanimation_complete_${stem}`, rift: true, bit: null };
  }
  const bit = Number.isInteger(speedrun?.actId) && speedrun.actId >= 0 ? speedrun.actId - 1 : null;
  if (slot === null || bit === null) return null;
  return { unlock: `actselectanimation_unlock_${slot}`, complete: `actselectanimation_complete_${slot}`, rift: false, bit };
}

/** The finale key for a chapter the save groups pieces under. */
function finaleTarget(doc, groupKey) {
  const slot = chapterSlot(groupKey);
  if (slot !== null) return `actselectanimation_finalefill_${slot}`;

  const speedrun = speedrunIndex(doc);
  const hashes = new Set();
  for (const [id, info] of speedrun) {
    if (info.chapter === groupKey) {
      const mod = modInfo(id);
      if (mod) hashes.add(mod[0]);
    }
  }
  const slots = hashSlots(animBits(doc));
  for (const hash of hashes) {
    const set = slots.get(hash);
    if (set && set.size === 1) return `actselectanimation_finalefill_${hash}:${[...set][0]}`;
  }
  return null;
}

/** Where a new animation entry for this key gets filed. */
function targetBitsList(doc, key) {
  const lsb = top(doc, 'LevelSaveInfo');
  if (!Array.isArray(lsb?.value)) return null;
  const entries = lsb.value.filter((el) => Array.isArray(prop(el, 'LevelBits')?.value));
  let entry = entries.find((el) => {
    const lb = prop(el, 'LevelBits').value;
    return lb.some((bitsEntry) => {
      const id = idOf(bitsEntry);
      if (typeof id !== 'string' || !id.startsWith('actselectanimation_')) return false;
      if (key.includes(':')) return id.includes(':') && id.split(':')[0] === key.split(':')[0];
      return !id.includes(':');
    });
  });
  if (!entry) entry = entries.find((el) => prop(el, 'Map')?.value === 'hub_spaceship');
  const lb = (entry ?? entries[0])?.properties.find((q) => q.name === 'LevelBits');
  return lb && Array.isArray(lb.value) ? lb.value : null;
}

function makeBitsEntry(key, value) {
  return {
    properties: [
      { name: 'Id', type: 'StrProperty', arrayIndex: 0, value: key },
      { name: 'Bits', type: 'IntProperty', arrayIndex: 0, value },
      { name: 'IdName', type: 'NameProperty', arrayIndex: 0, value: key },
    ],
  };
}

/** Write one animation flag. For acts `bit` toggles a bit in the chapter mask; otherwise it is a plain on/off key. */
function setAnimFlag(doc, key, bit, on, valueIfOn) {
  const found = animBits(doc).get(key);

  if (bit !== null) {
    if (on) {
      if (!found) {
        const list = targetBitsList(doc, key);
        if (!list) return false;
        list.push(makeBitsEntry(key, 1 << bit));
        return true;
      }
      const bits = prop(found.entry, 'Bits');
      if (!bits) return false;
      const next = bits.value | (1 << bit);
      if (next === bits.value) return false;
      bits.value = next;
      return true;
    }
    if (!found) return false;
    const bits = prop(found.entry, 'Bits');
    if (!bits) return false;
    const next = bits.value & ~(1 << bit);
    if (next === bits.value) return false;
    if (next === 0) found.list.splice(found.list.indexOf(found.entry), 1);
    else bits.value = next;
    return true;
  }

  if (on) {
    if (found) {
      const bits = prop(found.entry, 'Bits');
      if (bits && bits.value > 0) return false;
      if (bits) bits.value = valueIfOn;
      return true;
    }
    const list = targetBitsList(doc, key);
    if (!list) return false;
    list.push(makeBitsEntry(key, valueIfOn));
    return true;
  }
  if (!found) return false;
  found.list.splice(found.list.indexOf(found.entry), 1);
  return true;
}

/** Is the given flag key on? bitmask for acts (bit set), non-zero bits for the rest. */
function flagOn(doc, key, bit) {
  const found = animBits(doc).get(key);
  if (!found) return false;
  const bits = prop(found.entry, 'Bits');
  if (!bits) return false;
  return bit === null ? bits.value > 0 : !!(bits.value & (1 << bit));
}

/**
 * Display titles for the game's own `ChapterName` values. The raw key stays on
 * the group header as a tooltip.
 *
 * NOTE: `Chapter2_Subcon` and `Chapter3_Trainwreck` are *not* the real chapter
 * numbers — in game Subcon is chapter 3 and Battle of the Birds is chapter 2.
 * The keys are used as-is (they come straight out of the save); only the labels
 * and the ordering below follow the real game.
 */
const CHAPTER_TITLES = {
  Chapter1_MafiaTown: 'Mafia Town (Chapter 1)',
  Chapter3_Trainwreck: 'Battle of the Birds (Chapter 2)',
  Chapter2_Subcon: 'The Subcon Forest (Chapter 3)',
  Chapter4_Sand: 'Alpine Skyline (Chapter 4)',
  Chapter5_Finale: 'The Finale (Chapter 5)',
  Chapter6_Cruise: 'The Arctic Cruise (Chapter 6)',
  Chapter7_Metro: 'Nyakuza Metro (Chapter 7)',
  Location_Spaceship: 'Spaceship',
};
const CHAPTER_ORDER = [
  'Chapter1_MafiaTown',
  'Chapter3_Trainwreck',   // Battle of the Birds — real chapter 2
  'Chapter2_Subcon',       // The Subcon Forest — real chapter 3
  'Chapter4_Sand',
  'Chapter5_Finale',
  'Chapter6_Cruise',
  'Chapter7_Metro',
  'Location_Spaceship',
];

/**
 * Ids whose chapter the save gets wrong. The save stamps `TimeRift_Cave_Tour`
 * with `Chapter5_Finale`; it belongs with the Spaceship rifts.
 */
const GROUP_OVERRIDES = {
  'TimeRift_Cave_Tour': 'Location_Spaceship',
};

const OTHER = '__other__';

const humanize = (key) => key.replace(/_/g, ' ').replace(/^Chapter/, 'Chapter ');

function groupTitle(key) {
  if (key === OTHER) return 'Other / unknown chapter';
  return CHAPTER_TITLES[key] ?? humanize(key);
}

function groupRank(key) {
  const i = CHAPTER_ORDER.indexOf(key);
  return i === -1 ? CHAPTER_ORDER.length : i;
}

/** Which field names this particular save uses on a TimeObjects element. */
function schemaOf(elements) {
  const names = new Set();
  for (const el of elements) for (const p of el.properties) names.add(p.name);
  if (names.size === 0) return { high: 'HighScore', mod: true };  // fresh save: assume current build
  return { high: names.has('Highscore') ? 'Highscore' : 'HighScore', mod: names.has('IsMod') };
}

/** id -> ChapterName, read from this save's own speedrun table (falls back to the baked data). */
function chaptersOf(doc) {
  const map = new Map();
  const speedrun = top(doc, 'SpeedrunTimeObjects');
  if (Array.isArray(speedrun?.value)) {
    for (const el of speedrun.value) {
      const id = prop(el, 'Id')?.value;
      const chapter = prop(el, 'ChapterName')?.value;
      if (id && chapter) map.set(id, chapter);
    }
  }
  return map;
}

function elementFor(doc, id) {
  const arr = top(doc, 'TimeObjects');
  if (!Array.isArray(arr?.value)) return null;
  return arr.value.find((el) => idOf(el) === id) ?? null;
}

/** The list as it stands — reading a save is never an edit, so this never creates it. */
function timeObjects(doc) {
  const arr = top(doc, 'TimeObjects');
  return Array.isArray(arr?.value) ? arr : null;
}

/** Only ever called from a path that is about to write. */
function ensureTimeObjects(doc) {
  let arr = timeObjects(doc);
  if (!arr) {
    arr = { name: 'TimeObjects', type: 'ArrayProperty', arrayIndex: 0, elementType: 'struct', value: [] };
    doc.properties.unshift(arr);
  }
  if (!Array.isArray(arr.value)) arr.value = [];
  return arr;
}

function rebuildCounters(doc) {
  const elements = timeObjects(doc)?.value ?? [];
  const isMod = (el) => boolOf(el, 'IsMod');
  const collected = (el) => boolOf(el, 'Collected');
  const vanilla = elements.filter((el) => collected(el) && !isMod(el)).length;
  const mods = elements.filter((el) => collected(el) && isMod(el)).length;

  const main = top(doc, 'CurrentCollectedTimePieces');
  if (main && Number.isInteger(main.value)) main.value = vanilla;
  const mod = top(doc, 'CurrentCollectedTimePieces_Mods');
  if (mod && Number.isInteger(mod.value)) mod.value = mods;
}

function buildElement(id, collected) {
  const t = TEMPLATES[id] ?? {
    IsAct: !/^(TimeRift|Spaceship)_/.test(id),
    Paid: false,
    HighScore: 0,
    IsMod: id.startsWith('Mod:'),
    ModPackage: '',
  };
  const bool = (value) => ({ type: 'BoolProperty', arrayIndex: 0, value });
  const int = (value) => ({ type: 'IntProperty', arrayIndex: 0, value });
  const str = (value) => ({ type: 'StrProperty', arrayIndex: 0, value });

  const properties = [
    { name: 'Id', ...str(id) },
    { name: 'Collected', ...bool(collected) },
    { name: 'Paid', ...bool(t.Paid) },
    { name: 'HighScore', ...int(t.HighScore) },
    { name: 'IsAct', ...bool(t.IsAct) },
    { name: 'IsMod', ...bool(t.IsMod) },
    { name: 'ModPackage', ...str(t.ModPackage) },
  ];
  return { properties };
}

/** Rename/trim a freshly built element so its fields match the target save. */
function adaptElement(element, schema, id) {
  const wanted = ['Id', 'Collected', 'Paid', schema.high, 'IsAct'];
  if (schema.mod) wanted.push('IsMod', 'ModPackage');

  const out = [];
  for (const name of wanted) {
    const source = name === schema.high
      ? element.properties.find((p) => p.name === 'Highscore' || p.name === 'HighScore')
      : element.properties.find((p) => p.name === name);
    const p = source
      ? { ...source }
      : { name, arrayIndex: 0, value: name === 'IsMod' ? id.startsWith('Mod:') : name === 'ModPackage' ? '' : name === 'IsAct' ? !/^(TimeRift|Spaceship)_/.test(id) : name === 'Paid' ? false : 0 };
    p.name = name;
    out.push(p);
  }
  return { properties: out };
}

export default {
  id: 'time-pieces',
  title: 'Time Pieces',

  rows(doc) {
    // Read only. Creating the list here would mean that merely *looking* at a
    // brand-new save (which has no TimeObjects at all) edited it, and the next
    // download would hand back a file that differs from the one loaded.
    const elements = timeObjects(doc)?.value ?? [];
    const byId = new Map();
    for (const el of elements) {
      const id = idOf(el);
      if (id !== undefined && !byId.has(id)) byId.set(id, el);
    }
    const chapters = chaptersOf(doc);

    const ids = [...new Set([...ORDER, ...byId.keys()])];
    const out = ids.map((id) => {
      const el = byId.get(id) ?? null;
      const chapter = GROUP_OVERRIDES[id] ?? chapters.get(id) ?? CHAPTERS[id] ?? OTHER;
      // the element's own IsAct is the most trustworthy source of rift vs act
      const anim = animTarget(doc, id, el ? !boolOf(el, 'IsAct') : undefined);
      const row = {
        id,
        label: id,
        group: chapter,
        checked: el ? boolOf(el, 'Collected') : false,
        present: el !== null,
        mod: id.startsWith('Mod:'),
      };
      if (anim) {
        row.box = true;  // keep the main Collected box alongside the anim ones
        // Alpine Skyline and Nyakuza Metro: acts only "appear" once beaten, so their
        // telescope grid never plays the new-act unlock card for them — offering the
        // box would mean toggling a flag the game never writes.
        const noUnlockFlag =
          !anim.rift && (chapter === 'Chapter4_Sand' || chapter === 'Chapter7_Metro');
        row.fields = [];
        if (!noUnlockFlag) {
          row.fields.push({
            key: 'anim_unlock',
            label: anim.rift ? 'Time rift detected animation seen' : 'New level animation seen',
            text: anim.rift ? 'rift seen' : 'new anim',
            type: 'checkbox',
            value: flagOn(doc, anim.unlock, anim.bit),
          });
        }
        row.fields.push({
          key: 'anim_complete',
          label: 'Beaten animation seen',
          text: 'beaten anim',
          type: 'checkbox',
          value: flagOn(doc, anim.complete, anim.bit),
        });
      } else if (id.startsWith('Mod:')) {
        row.note = 'animation slot not recorded in this save';
      }
      return row;
    });

    // Per-chapter finale checkbox: the save only records a finale counter at
    // chapters whose telescope grid actually shows it.
    const groups = new Set(out.map((r) => r.group));
    const FINALE_SLOTS = new Set(['2', '3', '4', '6', '7']);
    for (const group of groups) {
      const target = finaleTarget(doc, group);
      if (!target) continue;
      const slot = chapterSlot(group);
      const found = animBits(doc).has(target);
      // only offer the box up front where the game writes this counter: the four
      // vanilla chapters seen with one, every mod chapter that already has the key
      if (!found) {
        if (slot !== null && FINALE_SLOTS.has(slot)) { /* offer */ }
        else continue;
      }
      out.push({
        id: `finale:${group}`,
        label: 'Finale animation',
        group,
        checked: flagOn(doc, target, null),
        present: true,
        finale: true,
        fields: [{ key: 'seen', label: 'Finale animation seen', text: 'finale seen', type: 'checkbox', value: flagOn(doc, target, null) }],
      });
    }

    return out;
  },

  groupTitle,

  compareGroups(a, b) {
    const ra = groupRank(a);
    const rb = groupRank(b);
    if (ra !== rb) return ra - rb;
    return a < b ? -1 : a > b ? 1 : 0;
  },

  /**
   * @param {object} doc     decoded save (mutated in place)
   * @param {string} id      time piece id
   * @param {boolean} checked desired collected state
   * @returns {boolean} whether the document changed
   */
  set(doc, id, checked) {
    if (id.startsWith('finale:')) {
      const group = id.slice('finale:'.length);
      const target = finaleTarget(doc, group);
      if (!target) return false;
      return setAnimFlag(doc, target, null, !!checked, 1);
    }
    const list = timeObjects(doc);
    const existing = list ? list.value.find((el) => idOf(el) === id) : null;

    if (existing) {
      const flag = prop(existing, 'Collected');
      if (!flag) return false;
      if (flag.value === checked) return false;
      flag.value = checked;
      rebuildCounters(doc);
      return true;
    }

    if (!checked) return false;  // not in the save and not wanted -> nothing to do

    // Reaching here means we are about to append, so the list may be created.
    // (finale: rows never reach this line — set() intercepts them above.)
    const arr = ensureTimeObjects(doc);
    const schema = schemaOf(arr.value);
    arr.value.push(adaptElement(buildElement(id, checked), schema, id));
    rebuildCounters(doc);
    return true;
  },

  /**
   * @param {object} doc  decoded save (mutated in place)
   * @param {string} id   row id — a time piece id, or 'finale:<chapterGroup>'
   * @param {string} key  'anim_unlock' | 'anim_complete' | 'seen'
   * @param {boolean} value
   * @returns {boolean} whether the document changed
   */
  setField(doc, id, key, value) {
    if (id.startsWith('finale:')) {
      if (key !== 'seen' || typeof value !== 'boolean') return false;
      return set(doc, id, value);
    }
    if (key !== 'anim_unlock' && key !== 'anim_complete') return false;
    if (typeof value !== 'boolean') return false;
    const el = elementFor(doc, id);
    const target = animTarget(doc, id, el ? !boolOf(el, 'IsAct') : undefined);
    if (!target) return false;
    const isUnlock = key === 'anim_unlock';
    // real saves write 1 for rift unlocks and 2 for rift beatens
    return setAnimFlag(doc, isUnlock ? target.unlock : target.complete, target.bit, value, isUnlock ? 1 : 2);
  },

  /** What a toggle in this category writes to the file. */
  notes: [
    'Checking a box sets TimeObjects[<id>].Collected = true; unchecking sets it to false.',
    'If a checked time piece is not in this save yet, a TimeObjects entry is appended, built from a template harvested from a real save (Id, Collected, Paid, HighScore, IsAct, and IsMod/ModPackage when this save uses them).',
    'CurrentCollectedTimePieces and CurrentCollectedTimePieces_Mods are recomputed — but only if that save already has them; they are never created.',
    'The two small boxes on each row toggle the "appeared"/"time rift detected" and "beaten" Level Bits the telescope writes for that piece: act rows flip their bit in the chapter mask (act index = ActID − 1), rift rows set the key\'s on/off value. The finale "Finale animation" box appears once per chapter group where the counter exists.',
    'Left untouched on purpose: SpeedrunTimeObjects, UnlockedSecretLevels and ActBits (both editable in More), LevelSaveInfo (Death Wishes), and everything else outside Time filtering.',
  ],
};
