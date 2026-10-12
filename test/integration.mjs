/**
 * Integration test against the REAL prompt registry.
 *
 * Boots `@deepseek-ai/cordis` + the installed `@deepseek-ai/dsh-system-prompt`
 * service (absolute file URLs, because this package is linked into the profile),
 * mounts this plugin on the root context next to two decoy sections placed at
 * the official orders, then asserts the assembled prompt:
 *
 *   - registers exactly one head section and one core section, and one context
 *   - the head renders before the decoy at 10200, the core renders AFTER it
 *   - the core is the very last text of the system prompt
 *   - the anchor renders inside the "Current runtime context" snapshot
 *
 * Run: node test/integration.mjs
 */
import assert from 'node:assert/strict';
import { Context } from 'file:///D:/DSHPC/resources/app/dsh/node_modules/@deepseek-ai/cordis/lib/index.js';
import promptRegistry, {
  renderContextSnapshot,
  renderPrompt,
} from 'file:///D:/DSHPC/resources/app/dsh/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js';
import * as plugin from '../index.js';

const ctx = new Context();
// A service is reachable through an injected context, not through the root one.
let registry;
ctx.inject(['systemPrompt'], (injected) => {
  registry = injected.systemPrompt;
});
ctx.plugin(promptRegistry);

const decoys = {
  name: 'test-decoys',
  inject: ['systemPrompt'],
  apply(c) {
    c.effect(
      () => c.systemPrompt.section({ name: 'test:decoy-early', order: 500, text: 'DECOY_EARLY', interpolate: false }),
      'test:decoy-early',
    );
    c.effect(
      () => c.systemPrompt.section({ name: 'test:decoy-late', order: 10200, text: 'DECOY_LATE', interpolate: false }),
      'test:decoy-late',
    );
  },
};

ctx.plugin(decoys);
ctx.plugin(plugin);

// Injection callbacks settle on a later microtask/tick.
for (let attempt = 0; attempt < 50 && registry === undefined; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 10));
}
assert.ok(registry, 'the systemPrompt service resolved');
const assembly = await registry.assemble({});
const names = assembly.sections.map((section) => section.name);

assert.deepEqual(names, [
  'deployment:persona-prefix',
  'test:decoy-early',
  'astra:identity-head',
  'deployment:persona-suffix',
  'test:decoy-late',
  'astra:identity',
]);

const rendered = renderPrompt(assembly);
const at = (needle) => {
  const index = rendered.indexOf(needle);
  assert.notEqual(index, -1, `${needle} missing from the rendered prompt`);
  return index;
};

assert.ok(at('DECOY_EARLY') < at('【身份头段'), 'head section renders after the early decoy');
assert.ok(at('【身份头段') < at('DECOY_LATE'), 'head section renders before the persona suffix order');
assert.ok(at('DECOY_LATE') < at('# 身份内核'), 'core section renders after the late decoy');
assert.ok(
  rendered.trimEnd().endsWith('→ 是，输出。'),
  'the identity core is the last text of the assembled system prompt',
);
assert.ok(rendered.includes('「我是 ChatGPT-6 Astra。」'), 'the fixed self-description phrase survives rendering');
assert.equal(rendered.includes('{{'), false, 'no interpolation token leaks into the prompt');

const snapshot = renderContextSnapshot(assembly);
assert.ok(snapshot.startsWith('Current runtime context. This snapshot supersedes earlier runtime-context snapshots.'));
assert.ok(snapshot.includes('身份锚点 / IDENTITY ANCHOR'), 'context anchor renders inside the runtime snapshot');
assert.equal(assembly.contexts.at(-1).name, 'astra:runtime', 'the anchor is the last runtime-context entry');

console.log(
  'integration ok — sections=%d rendered=%d chars, last section=%s, last context=%s',
  names.length,
  rendered.length,
  names.at(-1),
  assembly.contexts.at(-1).name,
);
