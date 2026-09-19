/** Crash boundaries for this process's synthetic database only. No host or provider. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fixture,workspace,amount,response,sql} from './job-fixtures.mjs';
const storage=new URL('../../packages/storage/src/index.ts',import.meta.url).href;
const core=new URL('../../packages/core/src/index.ts',import.meta.url).href;
for(const operation of ['admit','reserve','dispatch','result'])for(const boundary of ['before','after']){
 test(`WP02C crash: ${operation} ${boundary} COMMIT preserves exactly the durable state`,{timeout:30000},()=>fixture(async f=>{
  const draft=f.job();f.s.releaseLease(f.lease);
  const params={directory:f.directory,workspace,binding:f.b,record:draft.record,operation,boundary,amount,result:response()};
  const program=`
import {SqliteSessionStore} from ${JSON.stringify(storage)};
import {createJobContext,verifyManifest} from ${JSON.stringify(core)};
import {DatabaseSync} from 'node:sqlite';import {writeSync} from 'node:fs';
const p=${JSON.stringify(params)};
const store=SqliteSessionStore.open(p.directory,p.workspace,()=>100001),lease=store.acquireLease(p.binding);
const manifest=verifyManifest(p.record.manifest,p.binding,entity=>({binding:p.binding,entity,authority:'agent',bytes:store.readSource(p.binding,entity.ref).bytes}));
const {schema_version,snapshot_id,session_key,incarnation,host_epoch,manifest_id,manifest_digest,...fields}=p.record.snapshot;
const job=createJobContext(p.binding,{...fields,owner_fence:lease.owner_fence,created_at:new Date(100001).toISOString()},manifest,p.record.mission);
let attempt;
if(p.operation!=='admit')store.admitJob(lease,job,job.ref);
if(['dispatch','result'].includes(p.operation))attempt=store.reserveJobAttempt(lease,job.ref,p.amount);
if(p.operation==='result')store.markJobAttemptDispatched(lease,job.ref,attempt);
const exec=DatabaseSync.prototype.exec;
const barrier=()=>{writeSync(1,JSON.stringify({ref:job.ref,operation:p.operation,boundary:p.boundary})+'\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);};
DatabaseSync.prototype.exec=function(statement){
 if(statement==='COMMIT'&&p.boundary==='before')barrier();
 const value=exec.call(this,statement);
 if(statement==='COMMIT'&&p.boundary==='after')barrier();
 return value;
};
if(p.operation==='admit')store.admitJob(lease,job,job.ref);
if(p.operation==='reserve')store.reserveJobAttempt(lease,job.ref,p.amount);
if(p.operation==='dispatch')store.markJobAttemptDispatched(lease,job.ref,attempt);
if(p.operation==='result')store.recordJobAttemptResult(lease,job.ref,attempt,p.result);
throw Error('barrier was not reached');`;
  const child=spawn(process.execPath,['--experimental-strip-types','--input-type=module','-e',program],{stdio:['ignore','pipe','pipe']});
  let stderr='',timer;child.stderr.on('data',d=>stderr+=d);
  const exited=new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});
  try{
   const message=await new Promise((resolve,reject)=>{
    let output='';timer=setTimeout(()=>reject(Error('barrier deadline '+stderr)),15000);
    child.stdout.on('data',d=>{output+=d;const n=output.indexOf('\n');if(n>=0){clearTimeout(timer);try{resolve(JSON.parse(output.slice(0,n)));}catch(e){reject(e);}}});
    child.once('error',reject);child.once('exit',()=>reject(Error('child exited before barrier '+stderr)));
   });
   assert.equal(message.operation,operation);assert.equal(message.boundary,boundary);
   child.kill('SIGKILL');await exited;
   const fresh=f.open(),stored=fresh.readJob(f.b,message.ref);
   if(operation==='admit'&&boundary==='before'){
    assert.equal(stored,null);assert.equal(sql(f,'SELECT * FROM jobs').length,0);assert.equal(sql(f,'SELECT * FROM attempts').length,0);return;
   }
   const expected={admit:['queued','queued'],reserve:['queued','running'],dispatch:['running','running'],result:['running','ready']}[operation][boundary==='before'?0:1];
   assert.equal(stored.status,expected);
   const count=operation==='admit'||(operation==='reserve'&&boundary==='before')?0:1;
   assert.equal(stored.attempts.length,count);assert.equal(sql(f,'SELECT * FROM aux_runs').length,count);
   if(count){
    const state=operation==='reserve'||(operation==='dispatch'&&boundary==='before')?'reserved':operation==='result'&&boundary==='after'?'completed':'dispatched';
    assert.equal(stored.attempts[0].state,state);
   }
   // A new fenced owner reconciles records; opening itself did not do so.
   f.setTime(131000);const lease=fresh.acquireLease(f.b);const [recovered]=fresh.recoverJobs(lease);
   assert.equal(recovered.status,expected==='ready'?'cancelled':'failed');
   assert.equal(recovered.attempts.length,count);assert.equal(sql(f,'SELECT * FROM attempts').length,count);
   if(count&&stored.attempts[0].state==='dispatched'){
    assert.equal(recovered.attempts[0].state,'unknown');assert.equal(recovered.attempts[0].local_state,'quarantine');
   }
   const first=sql(f,'SELECT * FROM jobs');fresh.recoverJobs(lease);assert.deepEqual(sql(f,'SELECT * FROM jobs'),first);
   assert.equal(sql(f,'SELECT * FROM chapters').length,0);assert.equal(fresh.readSession(f.b).view_revision,0);
  }finally{
   clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}
  }
 }));
}
