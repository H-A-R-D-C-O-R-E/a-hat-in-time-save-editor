/**
 * Shared helpers for the `test/edit-*.js` suites (all synchronous).
 *
 *   const { check, done } = harness();
 *   ...
 *   done();   // prints the tally and exits non-zero on failure
 */

/** Every property path -> value in the document, flattened. */
export function flatten(doc) {
  const out = new Map();
  (function walk(props, scope) {
    for (const p of props) {
      const here = `${scope}.${p.name}[${p.arrayIndex}]`;
      if (p.type === 'ArrayProperty') {
        if (p.elementType === 'struct') p.value.forEach((el, i) => walk(el.properties, `${here}#${i}`));
        else out.set(here, JSON.stringify(p.value));
      } else if (p.type === 'StructProperty' && Array.isArray(p.value)) {
        walk(p.value, here);
      } else {
        out.set(here, JSON.stringify(p.value));
      }
    }
  })(doc.properties, '');
  return out;
}

export const diff = (before, after) => ({
  removed: [...before.keys()].filter((k) => !after.has(k)),
  added: [...after.keys()].filter((k) => !before.has(k)),
  changed: [...before.keys()].filter((k) => after.has(k) && before.get(k) !== after.get(k)),
});

/**
 * Assert that a diff is confined to paths containing `where`.
 * An empty diff is fine — use `onlyIn` when something must have changed.
 */
export function confined(d, where) {
  const stray = [...d.removed, ...d.added, ...d.changed].filter((k) => !k.includes(where));
  if (stray.length) {
    throw new Error(`expected only ${where} to change, but also: ${stray.slice(0, 5).join(', ')}`);
  }
}

/** Assert that a diff is confined to `where` *and* that it changed something. */
export function onlyIn(d, where) {
  confined(d, where);
  if (!d.removed.length && !d.added.length && !d.changed.length) {
    throw new Error(`${where} changed nothing`);
  }
}

export function harness() {
  const state = { failures: 0 };

  state.check = (label, fn) => {
    try {
      fn();
      console.log(`  ok   ${label}`);
    } catch (err) {
      state.failures += 1;
      console.log(`  FAIL ${label}\n       ${err.message.split('\n').join('\n       ')}`);
    }
  };

  state.done = () => {
    console.log(state.failures ? `\n${state.failures} FAILURES\n` : '\nall checks passed\n');
    process.exit(state.failures ? 1 : 0);
  };

  return state;
}
