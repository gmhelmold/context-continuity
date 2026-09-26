/** SPEC-25 controlled mutants: stock must pass; each defect must fail named assertion. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const start = '  recoverStaging(bindingInput: unknown, idInput: unknown): StagingRecovery {';
const end = '\n  readOwner(idInput: unknown): StorageOwner | null {';
function region(source) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.notEqual(first, -1, 'recoverStaging declaration exists');
  assert.equal(source.indexOf(start, first + 1), -1, 'recoverStaging declaration unique');
  assert.notEqual(last, -1, 'recoverStaging bounded end exists');
  return [source.slice(0, first), source.slice(first, last), source.slice(last)];
}
const cases = [
  ['foreign-owner-lock-busy', 'workspace-coordinator.ts', 'if (!recoveryFile.tryLock())', 'if (false)',
    'Staging recovery: busy foreign owner lock remains held'],
  ['original-inode-identity', 'workspace-coordinator.ts', 'if (!sameFile(recoveryFile.identity, original.identity)) return capability();', 'if (false) return capability();',
    'Staging recovery: replaced owner file is E_CAPABILITY and preserves charge'],
  ['owner-self-match', 'workspace-coordinator.ts', 'if (original.owner_id === this.owner_id)', 'if (original.owner_id !== this.owner_id)',
    'Staging recovery: live owner stays held; closed foreign owner releases one pre-file charge'],
  ['managed-pre-file-fence', 'staging-intents.ts', "if (db.prepare('SELECT 1 FROM managed_files WHERE operation_id=? LIMIT 1').get(operationId)) {", 'if (false) {',
    'Staging recovery: staging managed file keeps reservation charged'],
  ['exact-atomic-cas', 'staging-intents.ts', 'WHERE key=? AND value=?', 'WHERE key=?',
    'Staging recovery: exact envelope CAS rolls back reservation on concurrent envelope change'],
];
for (const [name, file, from, to, selected] of cases) test(`Staging recovery mutation: ${name} rejects incorrect implementation`, { timeout: 90000 }, () => {
  for (const mutant of [false, true]) {
    const directory = mkdtempSync(join(tmpdir(), 'cc-staging-recovery-mutation-'));
    try {
      for (const path of ['packages/core/src', 'packages/storage/src', 'packages/storage/native/build']) cpSync(join(root, path), join(directory, path), { recursive: true });
      mkdirSync(join(directory, 'tests/coordination'), { recursive: true });
      mkdirSync(join(directory, 'tests/storage'), { recursive: true });
      for (const testFile of ['staging-intent-recovery.test.mjs', 'staging-intents-fixtures.mjs', 'coordinator-fixtures.mjs']) {
        cpSync(join(root, 'tests/coordination', testFile), join(directory, 'tests/coordination', testFile));
      }
      cpSync(join(root, 'tests/storage/job-fixtures.mjs'), join(directory, 'tests/storage/job-fixtures.mjs'));
      writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
      const path = join(directory, 'packages/storage/src', file), source = readFileSync(path, 'utf8');
      let changed;
      if (file === 'workspace-coordinator.ts') {
        const [before, recovery, after] = region(source);
        assert.equal(recovery.split(from).length - 1, 1, name + ': unique recoverStaging mutation anchor');
        changed = before + recovery.replace(from, to) + after;
      } else {
        const recoveryStart = name === 'managed-pre-file-fence' ? 0 : source.indexOf('export function recoverStagingIntent('), recovery = source.slice(recoveryStart);
        assert.notEqual(recoveryStart, -1, name + ': recoverStagingIntent exists');
        assert.equal(recovery.split(from).length - 1, 1, name + ': unique recovery mutation anchor');
        changed = source.slice(0, recoveryStart) + recovery.replace(from, to);
      }
      if (mutant) writeFileSync(path, changed);
      const pattern = '^' + selected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
      const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
      const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', '--test-reporter=tap', '--test-name-pattern=' + pattern,
        'tests/coordination/staging-intent-recovery.test.mjs'], { cwd: directory, env, encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
      const output = result.stdout + result.stderr;
      assert.equal(result.error, undefined, name + ': setup or timeout is not detection'); assert.equal(result.signal, null, output);
      assert.match(result.stdout, /^# tests 1$/m, output);
      if (!mutant) {
        assert.equal(result.status, 0, output);
        console.log('F3_STAGING_RECOVERY_MUTATION', name, 'control_passed');
      } else {
        assert.equal(result.status, 1, name + ': incorrect implementation survived');
        assert.ok(result.stdout.split('\n').some(line => line.startsWith('not ok ') && line.endsWith(' - ' + selected)), output);
        assert.match(result.stdout, /ERR_ASSERTION/, output);
        console.log('F3_STAGING_RECOVERY_MUTATION', name, 'mutant_rejected_by_named_assertion');
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
});
