/** Issue #28 negative proof: a bounded read contract must detect incorrect implementations. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../../', import.meta.url));
const variants = [
  ['historical-sweep', 'root-records.ts', 'const before = loadRootIndex(db, binding);',
    'const before = loadRootCatalog(db, binding);', 'one-source retention with 8 roots'],
  ['byte-limit', 'source-records.ts', 'usedBytes + metadata.size_bytes > MAX_RETENTION_SOURCE_READ_BYTES',
    'false', 'byte budget stops before'],
  ['count-limit', 'source-records.ts', 'verified.size >= MAX_RETENTION_SOURCE_READS',
    'false', 'zero-byte sources still'],
  ['affected-integrity', 'root-records.ts', 'verifySources(unit, verified, read);',
    'void unit;', 'a structural retention return'],
];
test('I28: positive controls and four incorrect verification paths are distinguished', { timeout: 180000 }, () => {
  for (const [name, file, before, after, pattern] of variants) {
    const directory = mkdtempSync(join(tmpdir(), 'cc-budget-mut-'));
    try {
      for (const path of ['packages/core/src', 'packages/storage/src']) cpSync(join(root, path), join(directory, path), { recursive: true });
      mkdirSync(join(directory, 'tests/storage'), { recursive: true });
      cpSync(join(root, 'tests/storage/retention-budget.test.mjs'), join(directory, 'tests/storage/retention-budget.test.mjs'));
      writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
      const path = join(directory, 'packages/storage/src', file), text = readFileSync(path, 'utf8');
      assert.equal(text.split(before).length - 1, 1, name + ': mutation must be exact');
      const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
      for (const mutated of [false, true]) {
        writeFileSync(path, mutated ? text.replace(before, after) : text);
        const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', '--test-reporter=tap',
          '--test-name-pattern=' + pattern, 'tests/storage/retention-budget.test.mjs'],
          { cwd: directory, env, encoding: 'utf8', timeout: 20000, maxBuffer: 2 * 1024 * 1024 });
        assert.equal(result.error, undefined, name + ': timeout/setup is not detection');
        assert.equal(result.signal, null); assert.match(result.stdout, /^# tests 1$/m);
        assert.equal(result.status, mutated ? 1 : 0, name + ': ' + result.stdout + result.stderr);
        if (mutated) {
          assert.match(result.stdout, /^not ok .* - I28:/m); assert.match(result.stdout, /ERR_ASSERTION/);
          assert.match(result.stdout, /^# fail 1$/m);
        }
      }
      console.log('I28_MUTATION', name, 'control_passed', 'mutant_rejected_by_assertion');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
});
