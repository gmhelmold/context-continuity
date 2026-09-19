/** Independent tests of assertions, using only disposable copies of this repository. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,cpSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url));
const cancellation='const job = this.#coordinator.withWorkspaceLock(() => this.store.cancelJob(lease, expected));';
const cases=[
 ['s01-assimilation','local-attempt-supervisor.ts','const pending = operation(task.controller.signal);','const pending = Promise.resolve(operation(task.controller.signal));',
  'Supervisor review: a foreign thenable is not assimilated as a completion signal'],
 ['s01-sync-stop','local-attempt-supervisor.ts','let result: AttemptResult, localStopped = false;','let result: AttemptResult, localStopped = true;',
  'Supervisor review: synchronous adapter throw cannot prove local cleanup'],
 ['s01-confirm','local-attempt-supervisor.ts','if (result.local_stopped && job.attempts.some','if (job.attempts.some',
  'Supervisor review: invalid return leaves local completion unknown'],
 ['s01-signal','local-attempt-supervisor.ts','try { if (!result.local_stopped) task.controller.abort(); }','try { /* missing cancellation */ }',
  'Supervisor review: invalid return leaves local completion unknown'],
 ['s02-reconcile','local-attempt-supervisor.ts','const job = this.store.cancelJob(owned, expected);','const job = this.store.readJob(owned.binding, expected)!;',
  'Supervisor review: failed dispatch reconciles the unused reservation without invoking adapter'],
 ['s02-post-commit','local-attempt-supervisor.ts','this.store.confirmJobAttemptStopped(owned, expected, attempt, hold);','void hold;',
  'Supervisor resolution: post-commit dispatch failure stops an uninvoked attempt without replay'],
 ['reservation-binding','session-store.ts','bindAttemptOwner(this.#db, leaseValue(leaseInput), expected, result, ownerHold);','void result;',
  'Supervisor: reservation ownership is observable before dispatch admission'],
 ['ownership-digest','attempt-owner.ts',' || envelope.digest !== hashPayload(value)','',
  'Supervisor: ownership checksum and field shape are rechecked on diagnostic reads'],
 ['invalid-is-legacy','attempt-owner.ts','} catch { return invalid(); }','} catch { return null; }',
  'Supervisor: an invalid ownership envelope is refused rather than treated as legacy'],
 ['cancel-order','local-attempt-supervisor.ts',cancellation,'task?.controller.abort(); '+cancellation,
  'Supervisor: cancel ordering is observed outside the adapter and before settlement'],
 ['premature-stop','local-attempt-supervisor.ts',cancellation,
  'const job = this.#coordinator.withWorkspaceLock(hold => { const value = this.store.cancelJob(lease, expected); return task ? this.store.confirmJobAttemptStopped(lease, expected, task.attempt, hold) : value; });',
  'Supervisor: cancel ordering is observed outside the adapter and before settlement'],
];
for(const [name,file,from,to,expected] of cases){
 test(`Supervisor proof: ${name} distinguishes its positive control and incorrect implementation`,{timeout:90000},()=>{
  for(const mutant of [false,true]){
   const directory=mkdtempSync(join(tmpdir(),'cc-supervisor-mut-'));
   try{
    for(const path of ['packages/core/src','packages/storage/src','packages/storage/native/build'])cpSync(join(root,path),join(directory,path),{recursive:true});
    for(const path of ['tests/storage/job-fixtures.mjs','tests/coordination/attempt-supervisor.test.mjs']){
     mkdirSync(join(directory,path,'..'),{recursive:true});cpSync(join(root,path),join(directory,path));
    }
    writeFileSync(join(directory,'package.json'),'{"type":"module"}');
    const path=join(directory,'packages/storage/src',file),source=readFileSync(path,'utf8');
    assert.equal(source.split(from).length-1,1,name+': exactly one mutation site');
    if(mutant)writeFileSync(path,source.replace(from,to));
    const env={...process.env};delete env.NODE_TEST_CONTEXT;
    const run=spawnSync(process.execPath,['--experimental-strip-types','--test','--test-reporter=tap','--test-name-pattern=^'+expected+'$','tests/coordination/attempt-supervisor.test.mjs'],{cwd:directory,env,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
    assert.equal(run.error,undefined,'setup or timeout is not detection');assert.equal(run.signal,null);assert.match(run.stdout,/^# tests 1$/m);
    if(!mutant)assert.equal(run.status,0,run.stdout+run.stderr);
    else{
     assert.equal(run.status,1,'incorrect implementation survived');
     assert.ok(run.stdout.split('\n').some(line=>line.startsWith('not ok ')&&line.endsWith(' - '+expected)));
     assert.match(run.stdout,/ERR_ASSERTION/);console.log('SUPERVISOR_MUTATION',name,'control_passed mutant_rejected_by_assertion');
    }
   }finally{rmSync(directory,{recursive:true,force:true});}
  }
 });
}
