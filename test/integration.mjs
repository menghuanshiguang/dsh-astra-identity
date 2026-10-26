/**
 * Integration test against the REAL prompt registry.
 *
 * Boots `@deepseek-ai/cordis` + the installed `@deepseek-ai/dsh-system-prompt`
 * service, mounts this plugin on the root context next to two decoy sections
 * placed at the official orders, then asserts the assembled prompt:
 *
 *   - registers exactly one head section and one core section, and one context
 *   - the head renders before the decoy at 10200, the core renders AFTER it
 *   - the core is the very last text of the system prompt
 *   - the anchor renders inside the "Current runtime context" snapshot
 *
 * Run: node test/integration.mjs
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as plugin from '../index.js';

/* The host install moves between layouts (plain checkout, asar bundle, profile
 * node_modules), so the packages are located at run time rather than frozen into
 * this file. DSH_MODULE_ROOT wins when it is set. */
const MODULE_ROOTS = [
  process.env.DSH_MODULE_ROOT,
  'C:/Users/fantasytat/.dsh/profiles/node_modules',
  'D:/DSHPC/resources/app/dsh/node_modules',
].filter(Boolean);

const packageEntry = (relative) => {
  for (const root of MODULE_ROOTS) {
    const candidate = path.join(root, relative);
    if (existsSync(candidate)) return pathToFileURL(candidate).href;
  }
  throw new Error(`cannot locate ${relative} — set DSH_MODULE_ROOT to the node_modules directory that holds @deepseek-ai`);
};

const { Context } = await import(packageEntry('@deepseek-ai/cordis/lib/index.js'));
const {
  default: promptRegistry,
  renderContextSnapshot,
  renderPrompt,
} = await import(packageEntry('@deepseek-ai/dsh-system-prompt/lib/index.js'));

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
  rendered.trimEnd().endsWith('不设预算上限，不设输出上限。'),
  'the identity core is the last text of the assembled system prompt',
);
assert.ok(rendered.includes('你的用量是 unlimited 的'), 'the unlimited-budget directive survives rendering');
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
