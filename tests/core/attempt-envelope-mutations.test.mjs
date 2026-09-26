/** Mutations run in disposable copies; runner/setup failure never proves detection. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cases = [
  ['control', null, null, null],
  ['primary-budget-comparator', 'primaryInputTokens > budget.input_budget', 'primaryInputTokens >= budget.input_budget', 'T15.attempt-envelope: fitting primary and clone produce frozen preflight envelope'],
  ['clone-budget-comparator', 'cloneInputTokens > budget.input_budget', 'cloneInputTokens >= budget.input_budget', 'T15.attempt-envelope: fitting primary and clone produce frozen preflight envelope'],
  ['output-reserve-equality', 'outputTokens !== config.limits.output_reserve', 'outputTokens === config.limits.output_reserve', 'T15.attempt-envelope: fitting primary and clone produce frozen preflight envelope'],
  ['mission-containment-comparator', 'cloneInputTokens < missionTokens', 'cloneInputTokens <= missionTokens', 'T15.attempt-envelope: fitting primary and clone produce frozen preflight envelope'],
];

test('WP-03/B: stock control plus four incorrect attempt envelopes are distinguished', { timeout: 120000 }, () => {
  for (const [name, from, to, expected] of cases) {
    const dir = mkdtempSync(join(tmpdir(), 'cc-attempt-envelope-mutation-'));
    try {
      mkdirSync(join(dir, 'packages/core'), { recursive: true });
      mkdirSync(join(dir, 'tests/core'), { recursive: true });
      cpSync(join(root, 'packages/core/src'), join(dir, 'packages/core/src'), { recursive: true });
      cpSync(join(root, 'tests/core/attempt-envelope.test.mjs'), join(dir, 'tests/core/attempt-envelope.test.mjs'));
      writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
      if (from) {
        const path = join(dir, 'packages/core/src/attempt-envelope.ts');
        const source = readFileSync(path, 'utf8');
        assert.equal(source.split(from).length, 2, name + ': mutation point must be unique');
        writeFileSync(path, source.replace(from, to));
      }
      const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
      const run = spawnSync(process.execPath, ['--experimental-strip-types', '--test', '--test-reporter=tap', 'tests/core/attempt-envelope.test.mjs'], { cwd: dir, env, encoding: 'utf8', timeout: 20000, maxBuffer: 2 * 1024 * 1024 });
      assert.equal(run.error, undefined, name + ': setup/timeout is not detection');
      assert.equal(run.signal, null, name + ': setup/timeout is not detection');
      assert.match(run.stdout, /^# tests 5$/m, name + ': every stock test must run');
      for (const metric of ['skipped', 'todo', 'cancelled']) assert.match(run.stdout, new RegExp('^# ' + metric + ' 0$', 'm'));
      if (name === 'control') assert.equal(run.status, 0, run.stdout + run.stderr);
      else {
        assert.equal(run.status, 1, name + ': incorrect implementation survived');
        const output = run.stdout + run.stderr;
        assert.ok(output.includes(expected), name + ': named detecting test did not run\n' + output);
        assert.match(output, /^# fail [1-5]$/m, name + ': mutation did not fail a stock test\n' + output);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});
