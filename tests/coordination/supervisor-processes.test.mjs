/** Isolated storage lifecycle observations. No HTTP or production provider. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {WorkspaceCoordinator} from '../../packages/storage/src/index.ts';
import {fixture,workspace,amount,response,sql} from '../storage/job-fixtures.mjs';
const storage=new URL('../../packages/storage/src/index.ts',import.meta.url).href;
const core=new URL('../../packages/core/src/index.ts',import.meta.url).href;
const snapshotModule=new URL('../../packages/core/src/snapshot.ts',import.meta.url).href;
async function childAtBarrier(code,body){
 const child=spawn(process.execPath,['--experimental-strip-types','--input-type=module','-e',code],{stdio:['ignore','pipe','pipe']});
 let stderr='',timer,exitTimer;child.stderr.on('data',x=>{stderr+=x;});
 const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
 const stop=async()=>{
  if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
  try{return await Promise.race([exited,new Promise((_,reject)=>{exitTimer=setTimeout(()=>reject(Error('own fixture child did not exit')),10000);})]);}
  finally{clearTimeout(exitTimer);}
 };
 try{
  const message=await new Promise((resolve,reject)=>{
   let output='';timer=setTimeout(()=>reject(Error('fixture barrier timeout: '+stderr)),15000);
   child.once('error',reject);child.once('exit',()=>reject(Error('fixture exited before barrier: '+stderr)));
   child.stdout.on('data',x=>{output+=x;const end=output.indexOf('\n');if(end>=0){clearTimeout(timer);try{resolve(JSON.parse(output.slice(0,end)));}catch(e){reject(e);}}});
  });
  await body(message,stop);
 }finally{clearTimeout(timer);await stop();}
}
for(const phase of ['reserve-before','reserve-after','cancel-pending','completed']){
 test(`Supervisor process: ${phase} reopens without replay or invented local completion`,{timeout:45000},()=>fixture(async f=>{
  f.s.releaseLease(f.lease);WorkspaceCoordinator.initialize(f.directory,workspace);
  const {local_stopped,...outcome}=response();
  const p={phase,directory:f.directory,workspace,binding:f.b,budget:amount,snapshot:f.job().record.snapshot,
   source:f.source.ref,bytes:Array.from(f.source.bytes),now:f.time(),outcome,marker:join(f.directory,'fixture-invocations.txt')};
  const code=String.raw`
import {LocalAttemptSupervisor} from ${JSON.stringify(storage)};
import {createManifest,createJobContext,hashSource} from ${JSON.stringify(core)};
import {SNAPSHOT_INPUT_FIELDS} from ${JSON.stringify(snapshotModule)};
import {DatabaseSync} from 'node:sqlite';import {writeSync,appendFileSync} from 'node:fs';
const p=${JSON.stringify(p)},supervisor=LocalAttemptSupervisor.open(p.directory,p.workspace,()=>p.now);
const lease=supervisor.store.acquireLease(p.binding),bytes=Buffer.from(p.bytes),entity={kind:'source',ref:p.source};
const manifest=createManifest(p.binding,[{entity,authority:'agent',range:{start_byte:0,end_byte:bytes.length},excerpt_digest:hashSource(bytes),presented_as:'full',locator:'s1'}],()=>({binding:p.binding,entity,authority:'agent',bytes}));
const fields=Object.fromEntries(SNAPSHOT_INPUT_FIELDS.map(key=>[key,p.snapshot[key]]));fields.owner_fence=lease.owner_fence;
const job=createJobContext(p.binding,fields,manifest,'Maintain only the synthetic child context.');
supervisor.store.admitJob(lease,job,job.ref);
const barrier=()=>{writeSync(1,JSON.stringify({phase:p.phase,ref:job.ref})+'\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);};
if(p.phase.startsWith('reserve-')){
 const prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec;let armed=false;
 DatabaseSync.prototype.prepare=function(q){const st=prepare.call(this,q);if(q.startsWith('UPDATE attempts SET usage_json=')){const run=st.run;st.run=function(...args){const value=run.apply(this,args);armed=true;return value;};}return st;};
 DatabaseSync.prototype.exec=function(q){if(armed&&q==='COMMIT'&&p.phase==='reserve-before')barrier();const value=exec.call(this,q);if(armed&&q==='COMMIT'&&p.phase==='reserve-after')barrier();return value;};
}
const done=supervisor.start(lease,job.ref,p.budget,()=>{
 appendFileSync(p.marker,'invoked\n',{mode:0o600});
 return p.phase==='cancel-pending'?new Promise(()=>{}):Promise.resolve(p.outcome);
});
if(p.phase==='cancel-pending'){supervisor.cancel(lease,job.ref);barrier();}
await done;if(p.phase==='completed')barrier();throw Error('expected barrier was not reached');`;
  await childAtBarrier(code,async(message,stop)=>{
   assert.equal(message.phase,phase);const exit=await stop();assert.equal(exit.signal,'SIGKILL');
   const invocations=existsSync(p.marker)?readFileSync(p.marker,'utf8'):'';
   assert.equal(invocations,phase.startsWith('reserve-')?'':'invoked\n');
   const before={jobs:sql(f,'SELECT * FROM jobs'),attempts:sql(f,'SELECT * FROM attempts'),runs:sql(f,'SELECT * FROM aux_runs'),counters:sql(f,'SELECT counters_json FROM sessions')};
   const store=f.open(),job=store.readJob(f.b,message.ref);
   assert.equal(job.attempts.length,phase==='reserve-before'?0:1);
   const expected={'reserve-before':['queued',null,null],'reserve-after':['running','reserved','reserved'],
    'cancel-pending':['cancelled','unknown','quarantine'],'completed':['ready','completed','stopped']}[phase];
   assert.equal(job.status,expected[0]);assert.equal(job.attempts[0]?.state??null,expected[1]);
   assert.equal(job.attempts[0]?.local_state??null,expected[2]);
   const reopened={jobs:sql(f,'SELECT * FROM jobs'),attempts:sql(f,'SELECT * FROM attempts'),runs:sql(f,'SELECT * FROM aux_runs'),counters:sql(f,'SELECT counters_json FROM sessions')};
   assert.deepEqual(reopened,before,'opening must not reconcile or replay implicitly');
   f.advance(30001);const lease=store.acquireLease(f.b);store.recoverJobs(lease);
   const recovered=store.readJob(f.b,message.ref),attempt=recovered.attempts[0];
   if(phase==='cancel-pending'){
    assert.equal(attempt.local_stopped,false);assert.equal(attempt.local_state,'quarantine');assert.equal(attempt.remote_state,'unknown');
   }
   if(phase==='reserve-after'){assert.equal(attempt.state,'cancelled');assert.equal(attempt.local_stopped,true);}
   assert.deepEqual(sql(f,'SELECT counters_json FROM sessions'),before.counters);
   assert.equal(recovered.attempts.length,before.attempts.length);
   assert.equal(sql(f,'SELECT count(*) AS n FROM chapters')[0].n,0);
   assert.equal(existsSync(p.marker)?readFileSync(p.marker,'utf8'):'',invocations);
  });
 }));
}
