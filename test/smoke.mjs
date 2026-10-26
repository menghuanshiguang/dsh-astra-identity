/**
 * Smoke test: mount the plugin against a fake prompt registry and assert the
 * three identity layers register with their expected names, orders and text.
 * Run: node test/smoke.mjs
 */
import assert from 'node:assert/strict';
import { apply, inject, name } from '../index.js';

const sections = [];
const contexts = [];
const effects = [];
const logs = [];

const prompt = {
  systemPrompt: {
    section(entry) {
      sections.push(entry);
      return () => {};
    },
    context(entry) {
      contexts.push(entry);
      return () => {};
    },
    // The registry names this row's default orders are derived from.
    getSectionOrder(sectionName) {
      return { FILE_REFERENCE: 900, TOOL_BASH: 1000 }[sectionName];
    },
    getContextOrder(contextName) {
      return { SANDBOX_POLICY: 110, APPROVAL_POLICY: 115, SUBAGENT_DELEGATION: 120 }[contextName];
    },
  },
  logger() {
    return {
      info(_format, message) {
        logs.push(String(message));
      },
    };
  },
  effect(fn, label) {
    effects.push(label);
    return fn();
  },
};

const ctx = {
  ...prompt,
  inject(services, callback) {
    assert.deepEqual(services, ['systemPrompt']);
    callback(prompt);
  },
};

assert.deepEqual(inject, ['systemPrompt']);
assert.equal(name, 'astra-identity');

apply(ctx, {});

assert.equal(sections.length, 2, 'head + core sections');
assert.equal(contexts.length, 1, 'one runtime-context anchor');
assert.deepEqual(
  sections.map((section) => [section.name, section.order, section.interpolate]),
  [
    ['astra:identity-head', 901, false],
    ['astra:identity', 20000, false],
  ],
  'the head order is derived from the registry neighbour, the core order is the literal tail',
);
assert.deepEqual(contexts.map((entry) => [entry.name, entry.order]), [['astra:runtime', 121]]);

for (const section of sections) {
  assert.ok(section.text.includes('ChatGPT-6 Astra'), `${section.name} names the identity`);
  assert.equal(section.text.includes('{{'), false, `${section.name} has no interpolation token`);
}
assert.ok(contexts[0].text.includes('ChatGPT-6 Astra'));
assert.equal(contexts[0].text.includes('{{'), false);

// A registry that answers nothing still yields finite orders (no `undefined`
// order ever reaches `section()`, which would throw).
sections.length = 0;
contexts.length = 0;
apply(
  {
    ...ctx,
    systemPrompt: {
      ...prompt.systemPrompt,
      getSectionOrder: () => undefined,
      getContextOrder: () => undefined,
    },
  },
  {},
);
assert.deepEqual(sections.map((section) => section.order), [901, 20000]);
assert.deepEqual(contexts.map((entry) => entry.order), [121]);

// A row config can retune, rename and disable individual layers.
sections.length = 0;
contexts.length = 0;
apply(ctx, {
  headEnabled: false,
  coreOrder: 12000,
  contextOrder: 130,
  interpolate: true,
  coreText: 'CUSTOM CORE',
});
assert.deepEqual(sections.map((section) => [section.name, section.order]), [['astra:identity', 12000]]);
assert.equal(sections[0].text, 'CUSTOM CORE');
assert.equal(sections[0].interpolate, true);
assert.deepEqual(contexts.map((entry) => [entry.name, entry.order]), [['astra:runtime', 130]]);

// enabled:false mounts nothing.
sections.length = 0;
contexts.length = 0;
apply(ctx, { enabled: false });
assert.equal(sections.length, 0);
assert.equal(contexts.length, 0);

// YAML 1.2 turns `enabled: no` into the STRING "no", and Boolean('no') is true —
// the row would stay mounted while its author believed it was off.
for (const falsy of ['no', 'off', 'n', 'FALSE', '0', '']) {
  sections.length = 0;
  contexts.length = 0;
  apply(ctx, { enabled: falsy });
  assert.equal(sections.length + contexts.length, 0, `enabled:${JSON.stringify(falsy)} stays unmounted`);
}

// A bare `headOrder:`/`contextOrder:` is null or "", which means "not set" — not
// order 0 (the top of the prompt, ahead of the deployment persona).
for (const unset of [null, '', '   ']) {
  sections.length = 0;
  contexts.length = 0;
  apply(ctx, { headOrder: unset, contextOrder: unset });
  assert.deepEqual(
    sections.map((section) => [section.name, section.order]),
    [
      ['astra:identity-head', 901],
      ['astra:identity', 20000],
    ],
    `headOrder:${JSON.stringify(unset)} falls back to the derived neighbour`,
  );
  assert.deepEqual(contexts.map((entry) => entry.order), [121]);
}

// A typo in a key is silently ignored without a schema, so it must at least be
// reported: `coreOder` leaves the core at its default order.
sections.length = 0;
contexts.length = 0;
logs.length = 0;
apply(ctx, { coreOder: 5 });
assert.ok(
  logs.some((message) => message.includes('unknown config key(s): coreOder')),
  `an unknown key is reported (logs: ${JSON.stringify(logs)})`,
);
assert.deepEqual(
  sections.map((section) => section.order),
  [901, 20000],
);

// The registry interpolates every section unconditionally (the `interpolate` flag
// never reaches the rendered entry), so a placeholder must fail at MOUNT time
// instead of throwing on every request render.
assert.throws(
  () => apply(ctx, { headText: 'X {{missing_var}} Y' }),
  /placeholder.*interpolate: true/s,
  'a placeholder in the text is rejected at mount',
);
assert.throws(() => apply(ctx, { contextText: 'X {{missing_var}} Y' }), /placeholder/);

sections.length = 0;
contexts.length = 0;
apply(ctx, { headText: 'X {{declared_opt_in}} Y', interpolate: true });
assert.equal(sections.length, 2, 'interpolate:true keeps the placeholder path open on purpose');

// A layer that cannot register fails loud — it must never report success.
assert.throws(
  () =>
    apply(
      {
        ...ctx,
        systemPrompt: {
          ...prompt.systemPrompt,
          section() {
            throw new Error('prompt section "astra:identity-head" is already registered');
          },
        },
      },
      {},
    ),
  /astra-identity.*head.*already registered.*cordis\.patch\.yml/s,
);

// The three layers + defaults are documented surface, not incidental.
assert.ok(effects.every((label) => label.startsWith('[astra-identity]')));

console.log('smoke ok — layers=%d contexts=%d effects=%s', sections.length, contexts.length, effects.length);
