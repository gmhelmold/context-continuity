/** Each incorrect F2 variant must fail its selected assertion, never setup or timeout. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cases = [
  ['quota', 'staging-intents.ts', 'assertStorageCapacity(db, request.max_bytes);', 'void db;',
    'Staging intents: shared quota competes with inline retention in both directions and sessions', 'STAGING_QUOTA_GATE'],
  ['owner', 'staging-intents.ts', 'if (intent.owner_id !== owner.owner_id || intent.process_instance !== owner.process_instance) {', 'if (false) {',
    'Staging intents: original active owner alone can replay or cancel', 'STAGING_OWNER_GATE'],
  ['replay-policy', 'staging-intents.ts', 'if (request.expected_policy_revision !== policy || existing.policy_revision !== policy) {', 'if (false) {',
    'Staging intents: exact replay preserves timestamp and charge, changed input or cancellation cannot replay', 'STAGING_REPLAY_POLICY'],
  ['managed-file', 'staging-intents.ts', "if (db.prepare('SELECT 1 FROM managed_files WHERE operation_id=? LIMIT 1').get(operationId)) {", 'if (false) {',
    'Staging intents: staging managed file blocks pre-file cancellation', 'STAGING_MANAGED_FILE_FENCE'],
  ['source-pin-history', 'staging-intents.ts', 'if (hasSourcePinHistory(db, request.reservation_id))', 'if (false)',
    'Staging intents: active source-pin history blocks same reservation ID', 'STAGING_FOREIGN_META_SCALAR'],
  ['scope-bound', 'staging-intents.ts', "CASE WHEN typeof(scope_json)='text' AND octet_length(scope_json) <= 16384 THEN scope_json END AS scope_json,", 'scope_json AS scope_json,',
    'Staging intents: oversized JSON session scope is refused before text materialization', 'STAGING_SCOPE_PREMATERIALIZATION'],
  ['foreign-materialization', 'reservation-metadata.ts', 'SELECT 1 FROM meta WHERE key=? LIMIT 1', 'SELECT value FROM meta WHERE key=? LIMIT 1',
    'Staging intents: reserved history blocks source-pin admission without reading foreign payload', 'STAGING_FOREIGN_META_SCALAR'],
];
for (const [name, file, from, to, selected, marker] of cases) {
  test(`Staging intent mutation: ${name} rejects its named regression`, { timeout: 90000 }, () => {
    for (const mutant of [false, true]) {
      const directory = mkdtempSync(join(tmpdir(), 'cc-staging-mutation-'));
      try {
        for (const path of ['packages/core/src', 'packages/storage/src', 'packages/storage/native/build']) {
          cpSync(join(root, path), join(directory, path), { recursive: true });
        }
        mkdirSync(join(directory, 'tests/coordination'), { recursive: true });
        mkdirSync(join(directory, 'tests/storage'), { recursive: true });
        for (const file of ['staging-intents.test.mjs', 'staging-intents-fixtures.mjs']) {
          cpSync(join(root, 'tests/coordination', file), join(directory, 'tests/coordination', file));
        }
        cpSync(join(root, 'tests/storage/job-fixtures.mjs'), join(directory, 'tests/storage/job-fixtures.mjs'));
        writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
        const path = join(directory, 'packages/storage/src', file), source = readFileSync(path, 'utf8');
        assert.equal(source.split(from).length - 1, 1, name + ': mutation anchor must be unique');
        if (mutant) writeFileSync(path, source.replace(from, to));
        const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
        const pattern = '^' + selected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
        const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', '--test-reporter=tap',
          '--test-name-pattern=' + pattern, 'tests/coordination/staging-intents.test.mjs'],
          { cwd: directory, env, encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
        const output = result.stdout + result.stderr;
        assert.equal(result.error, undefined, name + ': setup or timeout is not detection'); assert.equal(result.signal, null, output);
        assert.match(result.stdout, /^# tests 1$/m, output);
        if (!mutant) assert.equal(result.status, 0, output);
        else {
          assert.equal(result.status, 1, name + ': incorrect implementation survived');
          assert.ok(result.stdout.split('\n').some(line => line.startsWith('not ok ') && line.endsWith(' - ' + selected)), output);
          assert.match(result.stdout, /ERR_ASSERTION/, output); assert.ok(output.includes(marker), output);
          console.log('STAGING_INTENT_MUTATION', name, 'control_passed mutant_rejected_by_named_assertion');
        }
      } finally { rmSync(directory, { recursive: true, force: true }); }
    }
  });
}
