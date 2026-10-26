/**
 * Profile audit: is this row actually mounted in a DSH profile, and does anything
 * downstream filter it out?
 *
 * This reads the profile's `package.json` as JSON and its `cordis.patch.yml` as
 * TEXT — no YAML parser is available from a linked package directory, so the patch
 * checks are line/window heuristics, not a full parse. Treat a WARN as "look at the
 * file", not as a verdict.
 *
 * Run: node test/audit.mjs [profileName]      (default: desktop, or $DSH_PROFILE)
 */
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PROFILE = process.argv[2] ?? process.env.DSH_PROFILE ?? 'desktop';
/** Section names are a public contract: profile patches list them literally. */
const SECTION_NAMES = ['astra:identity-head', 'astra:identity'];
const CONTEXT_NAMES = ['astra:runtime'];
const PACKAGE = '@local/dsh-astra-identity';

const root = path.join(os.homedir(), '.dsh', 'profiles', PROFILE);
const pkgPath = path.join(root, 'package.json');
const patchPath = path.join(root, 'cordis.patch.yml');

const results = [];
const record = (level, message) => results.push({ level, message });

if (!existsSync(root)) {
  record('FAIL', `profile not found: ${root}`);
} else {
  record('OK', `profile: ${root}`);

  /* ---- package.json: dependency + bundle registration ---- */
  let pkg = {};
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch (error) {
    record('FAIL', `cannot read ${pkgPath}: ${error.message}`);
  }
  const dependency = pkg.dependencies?.[PACKAGE];
  if (typeof dependency !== 'string') {
    record('FAIL', `${PACKAGE} is missing from dependencies — the bundle cannot resolve`);
  } else {
    record('OK', `dependency: ${dependency}`);
  }
  const bundles = pkg.dsh?.profile?.bundles ?? [];
  if (bundles.includes(PACKAGE)) {
    record('OK', `listed in dsh.profile.bundles`);
  } else {
    record('FAIL', `${PACKAGE} is not in dsh.profile.bundles — the row is never composed`);
  }

  /* ---- patch: row enabled? keepSections intact? ---- */
  if (!existsSync(patchPath)) {
    record('WARN', `no ${patchPath} — fine only if the row comes from the bundle itself`);
  } else {
    const patch = readFileSync(patchPath, 'utf8');
    const rows = (id) => {
      const out = [];
      const pattern = new RegExp(`^(\\s*)- id: ${id}\\b`, 'gm');
      let match;
      while ((match = pattern.exec(patch)) !== null) out.push(match.index);
      return out;
    };

    const astraRows = rows('astra-identity');
    if (astraRows.length === 0) {
      record('OK', 'no astra-identity row in the profile patch — the bundle supplies it');
    }
    for (const at of astraRows) {
      const window = patch.slice(at, at + 400);
      if (/disabled:\s*true/.test(window)) record('FAIL', `astra-identity row at byte ${at} is disabled`);
      else record('OK', `astra-identity row at byte ${at} is enabled`);
      const config = window.match(/config:\s*(\{[^}]*\}|\n(?:\s+.*\n)*)/);
      if (config) record('INFO', `row config near byte ${at}: ${config[1].trim().slice(0, 160)}`);
    }

    const ccRows = rows('claudecode-prompt');
    if (ccRows.length === 0) {
      record('INFO', 'no claudecode-prompt row — no section whitelist can drop the identity');
    }
    for (const at of ccRows) {
      const window = patch.slice(at, at + 1200);
      // Two spellings in the wild: flow style `keepSections: [a, b]` and block
      // style `keepSections:` followed by `- a` lines.
      const flow = window.match(/keepSections:\s*\[([^\]]*)\]/s);
      const block = window.match(/keepSections:\s*\n((?:\s*-\s*\S+[^\n]*\n)+)/);
      const kept = flow
        ? flow[1].split(',').map((entry) => entry.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
        : block
          ? [...block[1].matchAll(/-\s*(\S+)/g)].map((entry) => entry[1].replace(/^['"]|['"]$/g, ''))
          : null;
      if (kept === null) {
        record('INFO', 'claudecode-prompt row has no keepSections — it keeps everything');
        continue;
      }
      // keepSections filters SECTIONS only: dsh-claudecode-prompt passes `contexts`
      // through untouched, so `astra:runtime` (a context) is never at risk here.
      const missing = SECTION_NAMES.filter((name) => !kept.includes(name));
      if (missing.length === 0) record('OK', `keepSections covers both astra sections (${kept.length} kept)`);
      else record('WARN', `keepSections would DROP: ${missing.join(', ')} — the identity vanishes silently`);
      record('INFO', `contexts pass through untouched — ${CONTEXT_NAMES.join(', ')} is a context, not a section`);
      if (!bundles.includes('dsh-claudecode-prompt')) {
        record('WARN', 'claudecode-prompt is patched but not in dsh.profile.bundles — this row may be inert');
      }
    }
  }
}

const width = Math.max(...results.map((entry) => entry.level.length));
for (const { level, message } of results) console.log(`${level.padEnd(width)}  ${message}`);
const failures = results.filter((entry) => entry.level === 'FAIL').length;
const warnings = results.filter((entry) => entry.level === 'WARN').length;
console.log(`\naudit ${failures === 0 ? 'ok' : 'FAILED'} — failures=${failures} warnings=${warnings}`);
process.exitCode = failures === 0 ? 0 : 1;
