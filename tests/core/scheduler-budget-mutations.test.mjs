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
  ['cache-deduction', "integer(raw.effective_input_tokens, 0, MAX, 'input.effective_input_tokens')", "integer(raw.effective_input_tokens, 1000, MAX, 'input.effective_input_tokens') - 1000", 'T15.budget: M varies with U and U has no cache deduction'],
  ['growth-ceiling-omitted', 'Math.ceil(settings.growth_reserve_ratio * budget)', 'Math.floor(settings.growth_reserve_ratio * budget)', 'T15.budget: reserves round up while thresholds round down'],
  ['trigger-floor-reversed', 'Math.floor(Math.min(settings.trigger_ratio * limits.context_window, budget - growthReserve - missionReserve))', 'Math.ceil(Math.min(settings.trigger_ratio * limits.context_window, budget - growthReserve - missionReserve))', 'T15.budget: reserves round up while thresholds round down'],
  ['eligibility-comparator', 'effectiveInputTokens >= budget.trigger_threshold', 'effectiveInputTokens > budget.trigger_threshold', 'T15.budget: T-1 is ineligible and T is eligible'],
];

test('WP-03/A: stock control plus four incorrect trigger budgets are distinguished', { timeout: 120000 }, () => {
  for (const [name, from, to, expected] of cases) {
    const dir = mkdtempSync(join(tmpdir(), 'cc-scheduler-budget-mutation-'));
    try {
      mkdirSync(join(dir, 'packages/core'), { recursive: true });
      mkdirSync(join(dir, 'tests/core'), { recursive: true });
      cpSync(join(root, 'packages/core/src'), join(dir, 'packages/core/src'), { recursive: true });
      cpSync(join(root, 'tests/core/scheduler-budget.test.mjs'), join(dir, 'tests/core/scheduler-budget.test.mjs'));
      writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
      if (from) {
        const path = join(dir, 'packages/core/src/scheduler-budget.ts');
        const source = readFileSync(path, 'utf8');
        assert.equal(source.split(from).length, 2, name + ': mutation point must be unique');
        writeFileSync(path, source.replace(from, to));
      }
      const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
      const run = spawnSync(process.execPath, ['--experimental-strip-types', '--test', '--test-reporter=tap', 'tests/core/scheduler-budget.test.mjs'], { cwd: dir, env, encoding: 'utf8', timeout: 20000, maxBuffer: 2 * 1024 * 1024 });
      assert.equal(run.error, undefined, name + ': setup/timeout is not detection');
      assert.equal(run.signal, null, name + ': setup/timeout is not detection');
      assert.match(run.stdout, /^# tests 8$/m, name + ': every stock test must run');
      for (const metric of ['skipped', 'todo', 'cancelled']) assert.match(run.stdout, new RegExp('^# ' + metric + ' 0$', 'm'));
      if (name === 'control') assert.equal(run.status, 0, run.stdout + run.stderr);
      else {
        assert.equal(run.status, 1, name + ': incorrect implementation survived');
        assert.ok(run.stdout.split('\n').some(line => line.startsWith('not ok ') && line.endsWith(' - ' + expected)), name + ': unrelated failure is not detection');
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});
