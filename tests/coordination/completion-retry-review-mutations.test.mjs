/** Test-only mutation in disposable copies. Never modify the checked-out implementation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../../', import.meta.url));
const selected = 'Completion retry review: a new eligible job cannot overwrite an unacknowledged receipt';
test('Completion retry review mutation: pending admission guard distinguishes control and regression', { timeout: 90000 }, () => {
  for (const mutant of [false, true]) {
    const directory = mkdtempSync(join(tmpdir(), 'cc-receipt-review-mutation-'));
    try {
      for (const path of ['packages/core/src', 'packages/storage/src', 'packages/storage/native/build']) {
        cpSync(join(root, path), join(directory, path), { recursive: true });
      }
      mkdirSync(join(directory, 'tests/coordination'), { recursive: true });
      mkdirSync(join(directory, 'tests/storage'), { recursive: true });
      cpSync(join(root, 'tests/coordination/completion-retry-review.test.mjs'), join(directory, 'tests/coordination/completion-retry-review.test.mjs'));
      cpSync(join(root, 'tests/storage/job-fixtures.mjs'), join(directory, 'tests/storage/job-fixtures.mjs'));
      writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
      const path = join(directory, 'packages/storage/src/local-attempt-supervisor.ts');
      const source = readFileSync(path, 'utf8'), from = ' || this.#pendingCompletions.has(session.binding.session_key)';
      assert.equal(source.split(from).length - 1, 1, 'unique pending guard');
      if (mutant) writeFileSync(path, source.replace(from, ''));
      const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
      const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', '--test-reporter=tap',
        '--test-name-pattern=^' + selected + '$', 'tests/coordination/completion-retry-review.test.mjs'],
        { cwd: directory, env, encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
      assert.equal(result.error, undefined, 'timeout/setup is not detection');
      assert.equal(result.signal, null); assert.match(result.stdout, /^# tests 1$/m);
      if (!mutant) assert.equal(result.status, 0, result.stdout + result.stderr);
      else {
        assert.equal(result.status, 1, 'removed admission guard survived');
        assert.ok(result.stdout.split('\n').some(line => line.startsWith('not ok ') && line.endsWith(' - ' + selected)), result.stdout);
        assert.match(result.stdout, /ERR_ASSERTION/);
        assert.match(result.stdout, /pending receipt must block new admission/);
        console.log('COMPLETION_RETRY_MUTATION pending-admission control_passed mutant_rejected_by_assertion');
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
});
