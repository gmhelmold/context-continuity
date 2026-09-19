/** Deliberately incorrect private copies; failures must be in the selected assertion. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../../', import.meta.url));
const save = `      this.#pendingCompletions.set(task.lease.binding.session_key, Object.freeze({
        lease: task.lease, expected: task.expected, attempt: task.attempt, observation,
      }));`;
const write = `        if (observation !== undefined) this.store.recordObservedLocalCompletion(task.lease, task.expected, task.attempt, observation, hold);`;
const flushWrite = `    this.#coordinator.withWorkspaceLock(hold => this.store.recordObservedLocalCompletion(
      pending.lease, pending.expected, pending.attempt, pending.observation, hold));`;
const cases = [
  ['retain-observation', save, '      void observation;',
    'Completion retry: a transient write retains the fact without retaining or replaying the result'],
  ['acknowledge-before-write', write, `        this.#pendingCompletions.delete(task.lease.binding.session_key);\n${write}`,
    'Completion retry: a transient write retains the fact without retaining or replaying the result'],
  ['consume-failed-flush', flushWrite, `    this.#pendingCompletions.delete(binding.session_key);\n${flushWrite}`,
    'Completion retry: another write failure cannot consume the pending observation'],
  ['generation-check', "if (canonical(pending.expected) !== canonical(expected))", 'if (false)',
    'Completion retry: mismatched generation or binding cannot acknowledge a pending receipt'],
];
for (const [name, from, to, selected] of cases) {
  test(`Completion retry mutation: ${name} rejects the incorrect implementation`, { timeout: 90000 }, () => {
    for (const mutant of [false, true]) {
      const directory = mkdtempSync(join(tmpdir(), 'cc-receipt-retry-mutation-'));
      try {
        for (const path of ['packages/core/src', 'packages/storage/src', 'packages/storage/native/build']) {
          cpSync(join(root, path), join(directory, path), { recursive: true });
        }
        mkdirSync(join(directory, 'tests/coordination'), { recursive: true });
        mkdirSync(join(directory, 'tests/storage'), { recursive: true });
        cpSync(join(root, 'tests/coordination/completion-retry.test.mjs'), join(directory, 'tests/coordination/completion-retry.test.mjs'));
        cpSync(join(root, 'tests/storage/job-fixtures.mjs'), join(directory, 'tests/storage/job-fixtures.mjs'));
        writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
        const path = join(directory, 'packages/storage/src/local-attempt-supervisor.ts');
        const source = readFileSync(path, 'utf8');
        assert.equal(source.split(from).length - 1, 1, name + ': mutation anchor must be unique');
        if (mutant) writeFileSync(path, source.replace(from, to));
        const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
        const pattern = '^' + selected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
        const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', '--test-reporter=tap',
          '--test-name-pattern=' + pattern, 'tests/coordination/completion-retry.test.mjs'],
          { cwd: directory, env, encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
        assert.equal(result.error, undefined, 'timeout/setup is not a successful negative control');
        assert.equal(result.signal, null);
        assert.match(result.stdout, /^# tests 1$/m);
        if (!mutant) assert.equal(result.status, 0, result.stdout + result.stderr);
        else {
          assert.equal(result.status, 1, name + ': incorrect implementation survived');
          assert.ok(result.stdout.split('\n').some(line => line.startsWith('not ok ') && line.endsWith(' - ' + selected)), result.stdout);
          assert.match(result.stdout, /ERR_ASSERTION/);
          console.log('COMPLETION_RETRY_MUTATION', name, 'control_passed mutant_rejected_by_assertion');
        }
      } finally { rmSync(directory, { recursive: true, force: true }); }
    }
  });
}
