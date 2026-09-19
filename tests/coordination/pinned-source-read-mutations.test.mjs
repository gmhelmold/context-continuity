/** Disposable mutations only; compilation and execution belong to Actions. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../../', import.meta.url));
const cases = [
  ['active-pin', 'source-pins.ts', "!pinned || pinned.state !== 'active'", '!pinned',
    'Pinned read: unknown and released pins cannot authorize byte access'],
  ['original-owner', 'source-pins.ts', 'owns(pinned, owner);', 'void owner;',
    'Pinned read: another participant may inspect metadata but cannot read through the pin'],
  ['current-policy', 'source-pins.ts', 'pinned.policy_revision !== currentPolicy(db, binding)', 'false',
    'Pinned read: changed policy refuses bytes but still permits explicit owner cleanup'],
  ['tombstone', 'source-pins.ts', "db.prepare('SELECT 1 FROM tombstones WHERE scope_hash=? LIMIT 1').get(binding.session_key)", 'false',
    'Pinned read: tombstone refuses byte access even with an intact active pin'],
  ['content-digest', 'source-records.ts', 'row.size_bytes !== bytes.length || hashSource(bytes) !== ref.digest', 'row.size_bytes !== bytes.length',
    'Pinned read: same-length content corruption is rejected after a previous successful read'],
];
for (const [name, file, from, to, selected] of cases) {
  test(`Pinned read mutation: ${name} distinguishes control and incorrect implementation`, { timeout: 90000 }, () => {
    for (const mutant of [false, true]) {
      const directory = mkdtempSync(join(tmpdir(), 'cc-pinned-read-mutation-'));
      try {
        for (const path of ['packages/core/src', 'packages/storage/src', 'packages/storage/native/build']) {
          cpSync(join(root, path), join(directory, path), { recursive: true });
        }
        mkdirSync(join(directory, 'tests/coordination'), { recursive: true });
        mkdirSync(join(directory, 'tests/storage'), { recursive: true });
        for (const path of ['pinned-source-read.test.mjs', 'source-pin-fixtures.mjs', 'coordinator-fixtures.mjs']) {
          cpSync(join(root, 'tests/coordination', path), join(directory, 'tests/coordination', path));
        }
        cpSync(join(root, 'tests/storage/job-fixtures.mjs'), join(directory, 'tests/storage/job-fixtures.mjs'));
        writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
        const path = join(directory, 'packages/storage/src', file), source = readFileSync(path, 'utf8');
        assert.equal(source.split(from).length - 1, 1, name + ': unique mutation anchor');
        if (mutant) writeFileSync(path, source.replace(from, to));
        const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
        const pattern = '^' + selected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
        const run = spawnSync(process.execPath, ['--experimental-strip-types', '--test', '--test-reporter=tap',
          '--test-name-pattern=' + pattern, 'tests/coordination/pinned-source-read.test.mjs'],
          { cwd: directory, env, encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
        assert.equal(run.error, undefined, name + ': timeout/setup is not detection');
        assert.equal(run.signal, null); assert.match(run.stdout, /^# tests 1$/m);
        if (!mutant) assert.equal(run.status, 0, run.stdout + run.stderr);
        else {
          assert.equal(run.status, 1, name + ': incorrect implementation survived');
          assert.ok(run.stdout.split('\n').some(line => line.startsWith('not ok ') && line.endsWith(' - ' + selected)), run.stdout);
          assert.match(run.stdout, /ERR_ASSERTION/);
          console.log('PINNED_READ_MUTATION', name, 'control_passed mutant_rejected_by_assertion');
        }
      } finally { rmSync(directory, { recursive: true, force: true }); }
    }
  });
}
