/** Named negative controls of the production accountant and its write integration. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../../', import.meta.url));
const cases = [
  ['reservations','storage-budget.ts',"const reserved_bytes = sizedRows(db, 'storage_reservations');",'const reserved_bytes = 0;',
    'Budget: all reservation kinds remain charged after owner retirement','BUDGET_RESERVATIONS'],
  ['catalog-blobs','storage-budget.ts',"const blob_bytes = sizedRows(db, 'blobs');",'const blob_bytes = 0;',
    'Budget: catalog blobs are charged once even with multiple source references','BUDGET_BLOBS_ONCE'],
  ['actual-inline','storage-budget.ts','THEN length(inline_bytes) ELSE 0','THEN size_bytes ELSE 0',
    'Budget: inline accounting uses stored bytes rather than source size metadata','BUDGET_ACTUAL_INLINE'],
  ['inclusive','storage-budget.ts','bytes > budget.remaining_bytes','bytes >= budget.remaining_bytes',
    'Budget: admission includes the last byte and rejects the next write atomically','BUDGET_INCLUSIVE'],
  ['write-admission','source-records.ts','assertStorageCapacity(db, source.bytes.length);','void db;',
    'Budget: a stale diagnostic never authorizes later admission','BUDGET_ADMISSION_FRESH'],
  ['transaction','storage-budget.ts','if (!db.isTransaction)','if (false)',
    'Budget: the internal reader refuses a missing transaction before queries','BUDGET_TRANSACTION'],
  ['safe-total','storage-budget.ts','count(count(inline_bytes + blob_bytes) + reserved_bytes)','inline_bytes + blob_bytes + reserved_bytes',
    'Budget: unsafe aggregate totals fail closed rather than losing precision','BUDGET_SAFE_TOTAL'],
  ['invalid-charge','storage-budget.ts','if (!row || count(row.invalid) !== 0)','if (!row)',
    'Budget: fractional catalog charge is refused rather than rounded or omitted','BUDGET_INVALID_CHARGE'],
];
for (const [name, file, from, to, title, marker] of cases) {
  test(`Budget mutation: ${name} rejects its named regression`, { timeout: 60000 }, () => {
    const directory = mkdtempSync(join(tmpdir(), 'cc-budget-mutation-'));
    try {
      for (const path of ['packages','tests','package.json']) cpSync(join(root,path), join(directory,path), { recursive: true });
      const target = join(directory,'packages/storage/src',file), original = readFileSync(target,'utf8');
      assert.equal(original.split(from).length, 2, 'mutation anchor must be unique');
      for (const mutant of [false,true]) {
        if (mutant) writeFileSync(target,original.replace(from,to));
        const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
        const run = spawnSync(process.execPath, ['--experimental-strip-types','--test','--test-reporter=tap',
          '--test-name-pattern=^' + title + '$','tests/coordination/storage-budget.test.mjs'],
          { cwd: directory, env, encoding:'utf8', timeout:25000, maxBuffer:2*1024*1024 });
        const output = run.stdout + run.stderr;
        assert.equal(run.error, undefined, 'startup or timeout is not detection');
        assert.equal(run.signal, null, 'signal is not detection');
        assert.equal(run.status, mutant ? 1 : 0, output);
        for (const [key,value] of Object.entries({ tests:1, pass:mutant?0:1, fail:mutant?1:0, skipped:0, cancelled:0, todo:0 })) {
          assert.match(run.stdout, new RegExp(`^# ${key} ${value}$`,'m'), output);
        }
        if (mutant) {
          assert.ok(run.stdout.split('\n').some(line => line.startsWith('not ok ') && line.endsWith(' - ' + title)), output);
          assert.match(run.stdout, /ERR_ASSERTION/, output);
          assert.ok(run.stdout.includes(marker), output);
          console.log('STORAGE_BUDGET_MUTATION', name, 'control_passed mutant_rejected_by_named_assertion');
        }
      }
    } finally { rmSync(directory,{ recursive:true, force:true }); }
  });
}
