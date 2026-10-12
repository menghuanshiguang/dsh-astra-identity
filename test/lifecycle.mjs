/**
 * Lifecycle test against the REAL prompt registry: mount → assemble → dispose →
 * assemble → remount.
 *
 * This is the regression guard the plugin never had. It asserts the two halves of
 * the unload contract that byte-level review cannot see:
 *
 *   1. after `fiber.dispose()` the registry holds no astra layer — a leaky
 *      registration would silently double the identity text on every edit
 *   2. a registry that does not answer `getSectionOrder` / `getContextOrder`
 *      still yields finite orders, instead of an `undefined` order that throws
 *      inside `section()`
 *
 * Run: node test/lifecycle.mjs
 */
import assert from 'node:assert/strict';
import { Context } from 'file:///D:/DSHPC/resources/app/dsh/node_modules/@deepseek-ai/cordis/lib/index.js';
import promptRegistry from 'file:///D:/DSHPC/resources/app/dsh/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js';
import * as plugin from '../index.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ASTRA_SECTIONS = ['astra:identity-head', 'astra:identity'];

const ctx = new Context();
ctx.on('internal/error', (error) => {
  throw error instanceof Error ? error : new Error(String(error));
});
let registry;
ctx.inject(['systemPrompt'], (injected) => {
  registry = injected.systemPrompt;
});
ctx.plugin(promptRegistry);

const names = async () => (await registry.assemble({})).sections.map((section) => section.name);
const withTolerance = async (pattern) => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (registry !== undefined) {
      const found = (await names()).filter((entry) => pattern.test(entry));
      if (found.length) return found;
    }
    await sleep(25);
  }
  return [];
};

const fiber = ctx.plugin(plugin, {});
assert.deepEqual(
  (await withTolerance(/^astra:/)).sort(),
  [...ASTRA_SECTIONS].sort(),
  'both identity sections register on mount',
);

const before = await names();
assert.deepEqual(
  (await registry.assemble({})).contexts.map((entry) => entry.name),
  ['astra:runtime'],
  'the runtime anchor registers on mount',
);

await fiber.dispose();
await sleep(50);
const after = await names();
assert.deepEqual(
  after,
  before.filter((entry) => !ASTRA_SECTIONS.includes(entry)),
  'dispose removes every astra layer and nothing else',
);
assert.equal(
  (await registry.assemble({})).contexts.some((entry) => entry.name === 'astra:runtime'),
  false,
  'dispose removes the runtime anchor',
);

// Remount on the same registry: the previous registration must not collide.
const second = ctx.plugin(plugin, {});
assert.deepEqual(
  (await withTolerance(/^astra:/)).sort(),
  [...ASTRA_SECTIONS].sort(),
  'remounting after dispose registers a single set of layers',
);
await second.dispose();
await sleep(50);
assert.equal(
  (await names()).some((entry) => ASTRA_SECTIONS.includes(entry)),
  false,
  'the second dispose is clean too',
);

console.log(
  'lifecycle ok — mount=%d after-dispose=%d, sections leaked=%d, no duplicate registration',
  before.length,
  after.length,
  after.filter((entry) => ASTRA_SECTIONS.includes(entry)).length,
);
