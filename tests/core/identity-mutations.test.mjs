/** Mutation checks of actual core modules, never the original checkout. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cases = [
  ['control', null, null, null, null],
  ['scope-omission', 'identity.ts', 'return hashPayload(parseScope(input));',
    'const { workspace_id: ignored, ...partial } = parseScope(input); return hashPayload(partial);',
    'WP-01/B: repeated external session IDs stay separate across every Scope coordinate'],
  ['payload-ignored', 'roots.ts', 'payload_digest: hashPayload(v.payload)',
    'payload_digest: hashPayload(null)',
    'T07.contract: payload, role, metadata and source changes create monotonic revisions'],
  ['revision-stuck', 'roots.ts', 'previous.revision + (changed ? 1 : 0)',
    'previous.revision',
    'T07.contract: payload, role, metadata and source changes create monotonic revisions'],
  ['alias-unbound', 'roots.ts', "if (this.exportState().catalog_digest !== expectedDigest) throw new ContractError('catalog.catalog_digest', 'mapping mismatch');",
    'void expectedDigest;',
    'T07.contract: persisted corruption and ambiguous identity maps fail closed'],
];

test('WP-01/B: positive control and four incorrect identity implementations are distinguished', { timeout: 30000 }, () => {
  for (const [name, file, from, to, expected] of cases) {
    const dir = mkdtempSync(join(tmpdir(), 'cc-core-identity-mutation-'));
    try {
      mkdirSync(join(dir, 'packages/core'), { recursive: true });
      mkdirSync(join(dir, 'tests/core'), { recursive: true });
      mkdirSync(join(dir, 'scripts'), { recursive: true });
      writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
      cpSync(join(root, 'packages/core/src'), join(dir, 'packages/core/src'), { recursive: true });
      for (const testFile of ['identity.test.mjs', 'roots.test.mjs']) cpSync(join(root, 'tests/core', testFile), join(dir, 'tests/core', testFile));
      cpSync(join(root, 'scripts/canonical-vectors.json'), join(dir, 'scripts/canonical-vectors.json'));
      if (file) {
        const path = join(dir, 'packages/core/src', file), text = readFileSync(path, 'utf8');
        assert.equal(text.split(from).length, 2, name + ': mutation point must be unique');
        writeFileSync(path, text.replace(from, to));
      }
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT; // Child must start its own runner, not inherit parent IPC mode.
      const run = spawnSync(process.execPath, ['--experimental-strip-types', '--test', '--test-reporter=tap',
        'tests/core/identity.test.mjs', 'tests/core/roots.test.mjs'], { cwd: dir, env, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
      assert.equal(run.error, undefined, name + ': runner failure is not detection');
      assert.equal(run.signal, null, name + ': signal is not detection');
      assert.match(run.stdout, /^# tests 25$/m, name + ': all selected tests must execute');
      if (name === 'control') assert.equal(run.status, 0, run.stdout + run.stderr);
      else {
        assert.equal(run.status, 1, name + ': incorrect implementation survived');
        const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        assert.match(run.stdout, new RegExp('not ok [0-9]+ - ' + escaped), name + ': unrelated failure is not detection');
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});
