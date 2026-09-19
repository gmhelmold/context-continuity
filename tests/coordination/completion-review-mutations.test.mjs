/** SPEC-20 negative controls mutate disposable copies, never the checkout or user data. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../../', import.meta.url));
const cases = [
  ['observation-origin', 'local-completion.ts', 'observations.get(input) !== hashPayload(ownership)', 'false',
    'completion-observation.test.mjs', 'Observation: copies and other identities do not inherit issued evidence'],
  ['observation-required', 'attempt-owner.ts', 'assertLocalCompletion(ownership, observation);', 'void observation;',
    'completion-receipts.test.mjs', 'Completion: unissued and copied observations cannot create a receipt'],
  ['receipt-integrity', 'attempt-owner.ts', 'if (!equal(receipt, completionReceipt(ownership))) invalid();', 'void receipt;',
    'completion-receipts.test.mjs', 'Completion: corrupted receipt rolls recovery back without releasing its slot'],
  ['receipt-required', 'attempt-owner.ts', "if (!Object.hasOwn(envelope, 'local_stop')) continue;", 'void envelope;',
    'completion-receipts.test.mjs', 'Completion: missing receipt cannot be replaced by closing or retiring the owner'],
  ['original-store', 'session-store.ts', "if (lease.owner_id !== this.owner_id) throw new StorageError('E_OWNER', 'completion requires original store');", 'void this.owner_id;',
    'completion-receipts.test.mjs', 'Completion: original store is required even when another connection knows its lease'],
  ['original-fence', 'attempt-owner.ts', 'if (ownership.owner_fence !== job.context.snapshot.owner_fence) invalid();', 'void ownership.owner_fence;',
    'completion-receipts.test.mjs', 'Completion: recovery verifies receipt ownership fence against the original job'],
  ['retain-before-owner-check', 'local-attempt-supervisor.ts', 'if (observation !== undefined) this.store.recordObservedLocalCompletion(task.lease, task.expected, task.attempt, observation, hold);', 'void observation;',
    'completion-receipts.test.mjs', 'Completion: settled old supervisor lets current owner reconcile without replay'],
];
for (const [name, sourceFile, from, to, testFile, testName] of cases) {
  test(`Completion review mutation: ${name} rejects the incorrect implementation`, { timeout: 90000 }, () => {
    for (const mutant of [false, true]) {
      const directory = mkdtempSync(join(tmpdir(), 'cc-completion-review-'));
      try {
        for (const path of ['packages/core/src', 'packages/storage/src', 'packages/storage/native/build']) {
          cpSync(join(root, path), join(directory, path), { recursive: true });
        }
        mkdirSync(join(directory, 'tests/coordination'), { recursive: true });
        mkdirSync(join(directory, 'tests/storage'), { recursive: true });
        cpSync(join(root, 'tests/storage/job-fixtures.mjs'), join(directory, 'tests/storage/job-fixtures.mjs'));
        for (const file of ['completion-observation.test.mjs', 'completion-receipts.test.mjs']) {
          cpSync(join(root, 'tests/coordination', file), join(directory, 'tests/coordination', file));
        }
        writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
        const path = join(directory, 'packages/storage/src', sourceFile), source = readFileSync(path, 'utf8');
        assert.equal(source.split(from).length - 1, 1, name + ': unique mutation anchor');
        if (mutant) writeFileSync(path, source.replace(from, to));
        const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
        const pattern = '^' + testName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
        const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', '--test-reporter=tap',
          '--test-name-pattern=' + pattern, 'tests/coordination/' + testFile],
          { cwd: directory, env, encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
        assert.equal(result.error, undefined, name + ': timeout/setup is not detection');
        assert.equal(result.signal, null); assert.match(result.stdout, /^# tests 1$/m);
        if (!mutant) assert.equal(result.status, 0, result.stdout + result.stderr);
        else {
          assert.equal(result.status, 1, name + ': mutation survived');
          assert.ok(result.stdout.split('\n').some(line => line.startsWith('not ok ') && line.endsWith(' - ' + testName)), result.stdout);
          assert.match(result.stdout, /ERR_ASSERTION/);
          console.log('COMPLETION_REVIEW_MUTATION', name, 'control_passed mutant_rejected_by_assertion');
        }
      } finally { rmSync(directory, { recursive: true, force: true }); }
    }
  });
}
