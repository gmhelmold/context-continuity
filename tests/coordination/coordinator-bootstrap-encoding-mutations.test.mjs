/** One control/regression pair; imports, signals and timeouts are not detections. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const suite = 'tests/coordination/coordinator-bootstrap-encoding.test.mjs';
const sourcePath = 'packages/storage/src/workspace-coordinator.ts';
const guard = "      // Refuse unsupported encoding before creating any coordinator resources.\n" +
  "      if (handle.db.prepare('PRAGMA encoding').get()?.encoding !== 'UTF-8') return capability();\n";

function execute(directory) {
  const env = {...process.env};
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath,
    ['--experimental-strip-types', '--test', '--test-reporter=tap', suite],
    {cwd: directory, env, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024});
  assert.equal(run.error, undefined, 'child startup/timeout is not a mutation result');
  assert.equal(run.signal, null, 'child signal is not a mutation result');
  return {status: run.status, text: run.stdout + run.stderr};
}
function summary(text, pass, fail) {
  for (const [key, value] of Object.entries({tests: 3, pass, fail, skipped: 0, cancelled: 0, todo: 0})) {
    assert.match(text, new RegExp(`^# ${key} ${value}$`, 'm'), `unexpected child ${key}`);
  }
}

test('Bootstrap encoding mutation: omitting preflight is rejected at both named boundaries', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cc-bootstrap-encoding-mutation-'));
  try {
    // Includes the already-built native bridge; no compiler is invoked here.
    for (const path of ['packages', 'tests', 'package.json']) {
      cpSync(join(root, path), join(directory, path), {recursive: true});
    }
    const control = execute(directory);
    assert.equal(control.status, 0, control.text);
    summary(control.text, 3, 0);
    const target = join(directory, sourcePath), original = readFileSync(target, 'utf8');
    assert.equal(original.split(guard).length, 2, 'bootstrap guard must have one exact location');
    writeFileSync(target, original.replace(guard, ''), 'utf8');
    const mutant = execute(directory);
    assert.equal(mutant.status, 1, mutant.text);
    summary(mutant.text, 1, 2);
    for (const encoding of ['UTF-16le', 'UTF-16be']) {
      assert.match(mutant.text, new RegExp(`^not ok \\d+ - Bootstrap encoding: ${encoding} refuses before coordinator initialization$`, 'm'));
    }
    assert.equal((mutant.text.match(/error: 'Missing expected exception: IDENTITY_BOOTSTRAP_ENCODING'/g) ?? []).length, 2);
    assert.equal((mutant.text.match(/code: 'ERR_ASSERTION'/g) ?? []).length, 2);
    assert.match(mutant.text, /^ok \d+ - Bootstrap encoding: UTF-8 initializes and opens normally$/m);
    console.log('BOOTSTRAP_ENCODING_MUTATION preflight control_passed mutant_rejected_by_named_assertions');
  } finally { rmSync(directory, {recursive: true, force: true}); }
});
