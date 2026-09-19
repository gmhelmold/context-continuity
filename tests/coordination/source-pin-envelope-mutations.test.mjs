/** Controlled disposable variants. Run only in Actions; timeout/import/setup is not detection. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../../', import.meta.url));
const cases = [
  ['preflight-limit', 'size.size_bytes > 16384', 'false',
    'Pin envelope budget: by-id refuses excess bytes before materialization', 'PIN_METADATA_PREMATERIALIZATION'],
  ['byte-not-character', 'octet_length(value)', 'length(value)',
    'Pin envelope budget: multibyte is counted in bytes before materialization', 'PIN_METADATA_PREMATERIALIZATION'],
  ['inclusive-limit', 'size.size_bytes > 16384', 'size.size_bytes >= 16384',
    'Pin envelope budget: 16384 UTF-8 bytes remain readable', 'PIN_METADATA_INCLUSIVE_BOUND'],
  ['encoding', "if (size && db.prepare('PRAGMA encoding').get()?.encoding !== 'UTF-8') return invalid();", 'void size;',
    'Pin envelope budget: UTF-16le cannot understate UTF-8 bytes', 'PIN_METADATA_PREMATERIALIZATION'],
  ['delivered-size', 'if (!size || Buffer.byteLength(metadata.value) !== size.size_bytes) return invalid();', 'void size;',
    'Pin envelope budget: bounded NUL suffix cannot turn a valid prefix into a complete record', 'PIN_METADATA_TEXT_COMPLETENESS'],
];
for (const [name, from, to, selected, assertion] of cases) {
  test(`Pin envelope mutation: ${name} distinguishes control and regression`, { timeout: 90000 }, () => {
    for (const mutant of [false, true]) {
      const directory = mkdtempSync(join(tmpdir(), 'cc-pin-envelope-mutation-'));
      try {
        for (const path of ['packages/core/src', 'packages/storage/src', 'packages/storage/native/build']) {
          cpSync(join(root, path), join(directory, path), { recursive: true });
        }
        mkdirSync(join(directory, 'tests/coordination'), { recursive: true });
        mkdirSync(join(directory, 'tests/storage'), { recursive: true });
        cpSync(join(root, 'tests/storage/job-fixtures.mjs'), join(directory, 'tests/storage/job-fixtures.mjs'));
        for (const file of ['source-pin-envelope-budget.test.mjs', 'source-pin-fixtures.mjs', 'coordinator-fixtures.mjs']) {
          cpSync(join(root, 'tests/coordination', file), join(directory, 'tests/coordination', file));
        }
        writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
        const path = join(directory, 'packages/storage/src/source-pins.ts'), source = readFileSync(path, 'utf8');
        assert.equal(source.split(from).length - 1, 1, name + ': unique mutation anchor');
        if (mutant) writeFileSync(path, source.replace(from, to));
        const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
        const pattern = '^' + selected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
        const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', '--test-reporter=tap',
          '--test-name-pattern=' + pattern, 'tests/coordination/source-pin-envelope-budget.test.mjs'],
          { cwd: directory, env, encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
        assert.equal(result.error, undefined, name + ': timeout/setup is not detection');
        assert.equal(result.signal, null); assert.match(result.stdout, /^# tests 1$/m);
        if (!mutant) assert.equal(result.status, 0, result.stdout + result.stderr);
        else {
          assert.equal(result.status, 1, name + ': incorrect implementation survived');
          assert.ok(result.stdout.split('\n').some(line => line.startsWith('not ok ') && line.endsWith(' - ' + selected)), result.stdout);
          assert.match(result.stdout, /ERR_ASSERTION/);
          assert.ok(result.stdout.includes(assertion), name + ': wrong failure; ' + result.stdout + result.stderr);
          console.log('PIN_ENVELOPE_MUTATION', name, 'control_passed mutant_rejected_by_named_assertion');
        }
      } finally { rmSync(directory, { recursive: true, force: true }); }
    }
  });
}
