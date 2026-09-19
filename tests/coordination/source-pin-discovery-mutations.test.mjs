/** Disposable controlled variants; compilation/setup failures are never detection. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../../', import.meta.url));
const cases = [
  ['bounded-fetch', 'source-pins.ts', ".all(request.after ?? '', request.limit + 1)", ".all(request.after ?? '', 4097)",
    'Pin discovery: maximum page size is inclusive and validates only one lookahead'],
  ['strict-cursor', 'source-pins.ts', 'AND reservation_id > ?', 'AND reservation_id >= ?',
    'Pin discovery: keyset pages are ordered without duplicates or skipped lookahead'],
  ['checksum', 'source-pins.ts', 'e.digest !== hashPayload(pin)', 'false',
    'Pin discovery: invalid digest in selected or lookahead record 102 refuses the whole page'],
  ['workspace-scope', 'source-pins.ts', 'try { pinBinding(pin.binding, workspace); } catch { return invalid(); }', 'void workspace;',
    'Pin discovery: foreign workspace in a self-consistent envelope is refused'],
  ['active-owner', 'source-pins.ts', "if (!owner || owner.state !== 'active') return invalid();", 'void owner;',
    'Pin discovery: an active pin with a retired original participant is not silently accepted'],
  ['read-only', 'workspace-coordinator.ts',
    'return this.#locked(() => transaction(this.#handle, false,\n      () => listActiveSourcePins',
    'return this.#locked(() => transaction(this.#handle, true,\n      () => listActiveSourcePins',
    'Pin discovery: discovery uses only a read transaction and never accesses source payloads'],
];
for (const [name, file, from, to, selected] of cases) {
  test(`Pin discovery mutation: ${name} rejects the incorrect implementation`, { timeout: 90000 }, () => {
    for (const mutant of [false, true]) {
      const directory = mkdtempSync(join(tmpdir(), 'cc-pin-discovery-mutation-'));
      try {
        for (const path of ['packages/core/src', 'packages/storage/src', 'packages/storage/native/build']) {
          cpSync(join(root, path), join(directory, path), { recursive: true });
        }
        mkdirSync(join(directory, 'tests/coordination'), { recursive: true });
        mkdirSync(join(directory, 'tests/storage'), { recursive: true });
        cpSync(join(root, 'tests/storage/job-fixtures.mjs'), join(directory, 'tests/storage/job-fixtures.mjs'));
        for (const name of ['source-pin-discovery.test.mjs', 'source-pin-fixtures.mjs', 'coordinator-fixtures.mjs']) {
          cpSync(join(root, 'tests/coordination', name), join(directory, 'tests/coordination', name));
        }
        writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
        const path = join(directory, 'packages/storage/src', file), source = readFileSync(path, 'utf8');
        assert.equal(source.split(from).length - 1, 1, name + ': unique mutation anchor');
        if (mutant) writeFileSync(path, source.replace(from, to));
        const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
        const pattern = '^' + selected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
        const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', '--test-reporter=tap',
          '--test-name-pattern=' + pattern, 'tests/coordination/source-pin-discovery.test.mjs'],
          { cwd: directory, env, encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
        assert.equal(result.error, undefined, name + ': timeout/setup is not detection');
        assert.equal(result.signal, null); assert.match(result.stdout, /^# tests 1$/m);
        if (!mutant) assert.equal(result.status, 0, result.stdout + result.stderr);
        else {
          assert.equal(result.status, 1, name + ': incorrect implementation survived');
          assert.ok(result.stdout.split('\n').some(line => line.startsWith('not ok ') && line.endsWith(' - ' + selected)), result.stdout);
          assert.match(result.stdout, /ERR_ASSERTION/);
          console.log('PIN_DISCOVERY_MUTATION', name, 'control_passed mutant_rejected_by_assertion');
        }
      } finally { rmSync(directory, { recursive: true, force: true }); }
    }
  });
}
