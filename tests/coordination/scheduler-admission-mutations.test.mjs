import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=fileURLToPath(new URL('../../',import.meta.url));
const cases=[
 ['control',null,null,'C-SCHED admission: primary threshold atomically admits, reserves, binds tuple and disarms'],
 ['threshold','value.observation.eligible_tokens < budget.trigger_threshold','false','C-SCHED admission: U guard rolls back job, reservation and state'],
 ['interval','value.selected_interval_tokens < 2 * budget.minimum_gain_floor','false','C-SCHED admission: selected interval guard rolls back job, reservation and state'],
 ['tuple','scheduler.last_attempt !== null &&','false && scheduler.last_attempt !== null &&','C-SCHED admission: last admitted tuple cannot be reused after prior work is gone'],
 ['owner-bind','bindAttemptOwner(this.#db, lease, value.expected, attempt, value.owner_hold);','void attempt;','C-SCHED admission: primary threshold atomically admits, reserves, binds tuple and disarms'],
 ['disarm','UPDATE scheduler_state SET armed=0,last_attempt_host_epoch=?','UPDATE scheduler_state SET armed=1,last_attempt_host_epoch=?','C-SCHED admission: primary threshold atomically admits, reserves, binds tuple and disarms'],
];
test('C-SCHED admission: positive control and incorrect implementations are distinguished',{timeout:180000},()=>{
 for(const [name,from,to,expected] of cases){const directory=mkdtempSync(join(tmpdir(),'cc-scheduler-admission-mut-'));try{
  for(const path of ['packages/core/src','packages/storage/src'])cpSync(join(root,path),join(directory,path),{recursive:true});mkdirSync(join(directory,'tests/coordination'),{recursive:true});mkdirSync(join(directory,'tests/storage'),{recursive:true});
  mkdirSync(join(directory,'packages/storage/native/build'),{recursive:true});cpSync(join(root,'packages/storage/native/build/locks.node'),join(directory,'packages/storage/native/build/locks.node'));
  for(const file of ['scheduler-admission.test.mjs','scheduler-admission-fixtures.mjs'])cpSync(join(root,'tests/coordination',file),join(directory,'tests/coordination',file));cpSync(join(root,'tests/storage/job-fixtures.mjs'),join(directory,'tests/storage/job-fixtures.mjs'));writeFileSync(join(directory,'package.json'),'{"type":"module"}');
  if(from){const path=join(directory,'packages/storage/src/session-store.ts'),source=readFileSync(path,'utf8');assert.equal(source.split(from).length-1,1,name+': unique mutation target');writeFileSync(path,source.replace(from,to));}
  const env={...process.env};delete env.NODE_TEST_CONTEXT;const args=['--experimental-strip-types','--test','--test-reporter=tap','--test-name-pattern=^'+expected+'$','tests/coordination/scheduler-admission.test.mjs'];
  const result=spawnSync(process.execPath,args,{cwd:directory,env,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});assert.equal(result.error,undefined,name+': setup/timeout');assert.equal(result.signal,null);assert.match(result.stdout,/^# tests 1$/m,name+': one named test must execute');
  if(!from)assert.equal(result.status,0,result.stdout+result.stderr);else {assert.equal(result.status,1,name+': mutant survived');assert.ok(result.stdout.split('\n').some(line=>line.startsWith('not ok ')&&line.endsWith(' - '+expected)),name+': wrong failure');}
 }finally{rmSync(directory,{recursive:true,force:true});}}
});
