/** Synthetic adapters; promise lifetime includes every resource the adapter starts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {LocalAttemptSupervisor,WorkspaceCoordinator} from '../../packages/storage/src/index.ts';
import {fixture,workspace,amount,response,sql,id} from '../storage/job-fixtures.mjs';
const reject=(fn,code)=>assert.throws(fn,e=>e.code===code);
const rejects=(value,code)=>assert.rejects(value,e=>e.code===code);
const result=()=>{const {local_stopped,...data}=response();return data;};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function pythonTry(path){
 const p=spawnSync('python3',['-c',`import os,fcntl,sys
f=os.open(sys.argv[1],os.O_RDWR)
try:
 try:
  fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  print('acquired')
 except BlockingIOError:
  print('busy')
finally:
 os.close(f)`,path],{encoding:'utf8',timeout:10000});
 assert.equal(p.error,undefined);assert.equal(p.status,0,p.stderr);assert.equal(p.signal,null);return p.stdout.trim();
}
function supervised(body){return fixture(async f=>{
 f.s.releaseLease(f.lease);WorkspaceCoordinator.initialize(f.directory,workspace);
 const supervisor=LocalAttemptSupervisor.open(f.directory,workspace,f.time);f.useLease(supervisor.store.acquireLease(f.b));
 const job=f.job();supervisor.store.admitJob(f.lease,job,job.ref);
 try{return await body({...f,supervisor,store:supervisor.store,job,lease:f.lease});}
 finally{supervisor.close();}
});}

test('Supervisor: reservation binds both owner identities before the single invocation',()=>supervised(async f=>{
 let calls=0,ownership;
 const done=await f.supervisor.start(f.lease,f.job.ref,amount,async signal=>{
  calls++;assert.equal(signal.aborted,false);
  const a=f.store.readJob(f.b,f.job.ref).attempts[0];
  ownership=f.store.readAttemptOwnership(f.b,f.job.ref,a.ref);
  assert.equal(a.state,'dispatched');assert.equal(ownership.session_owner_id,f.store.owner_id);
  assert.equal(ownership.owner_fence,f.lease.owner_fence);assert.deepEqual(ownership.job,f.job.ref);
  assert.equal(ownership.binding.incarnation,f.b.incarnation);assert.deepEqual(ownership.attempt,a.ref);
  assert.equal(pythonTry(join(f.directory,'owners',ownership.storage_owner_id+'.lock')),'busy');
  assert.ok(Object.isFrozen(ownership));assert.ok(Object.isFrozen(ownership.binding.scope));return result();
 });
 assert.equal(calls,1);assert.equal(done.status,'ready');assert.equal(done.attempts[0].local_state,'stopped');
 assert.equal(done.attempts[0].remote_state,'confirmed');assert.notEqual(ownership.storage_owner_id,ownership.session_owner_id);
}));
test('Supervisor: adopts exact retained reservation without reserving again',()=>supervised(async f=>{
  const prototype=Object.getPrototypeOf(f.store),dispatched=prototype.markJobAttemptDispatched,cancelled=prototype.cancelJob;
  let calls=0;
  prototype.markJobAttemptDispatched=function(){throw Error('synthetic dispatch refusal');};
  prototype.cancelJob=function(){throw Error('synthetic reconcile refusal');};
  try{await rejects(f.supervisor.start(f.lease,f.job.ref,amount,async()=>{calls++;return result();}),'E_STORAGE');}
  finally{prototype.markJobAttemptDispatched=dispatched;prototype.cancelJob=cancelled;}
  const before=f.store.readJob(f.b,f.job.ref),attempt=before.attempts[0],counters=sql(f,'SELECT counters_json FROM sessions');
  assert.equal(attempt.state,'reserved');assert.equal(before.attempts.length,1);assert.equal(calls,0);
  let adopted;await assert.doesNotReject(async()=>{adopted=await f.supervisor.adopt(f.lease,f.job.ref,attempt.ref,async()=>{calls++;return result();});});
  assert.equal(calls,1);assert.equal(adopted.status,'ready');assert.equal(adopted.attempts.length,1);
  assert.equal(adopted.attempts[0].ref.attempt_id,attempt.ref.attempt_id);
  assert.deepEqual(sql(f,'SELECT counters_json FROM sessions'),counters);
}));
test('Supervisor: rejected adoption leaves foreign reservation unchanged and never invokes adapter',()=>supervised(async f=>{
  const coordinator=WorkspaceCoordinator.open(f.directory,workspace);let calls=0;
  try{
   const attempt=coordinator.withWorkspaceLock(hold=>f.store.reserveJobAttempt(f.lease,f.job.ref,amount,hold));
   const before={job:f.store.readJob(f.b,f.job.ref),attempts:sql(f,'SELECT * FROM attempts'),runs:sql(f,'SELECT * FROM aux_runs'),counters:sql(f,'SELECT counters_json FROM sessions')};
   reject(()=>f.supervisor.adopt(f.lease,f.job.ref,attempt,async()=>{calls++;return result();}),'E_OWNER');
   assert.equal(calls,0);assert.deepEqual(f.store.readJob(f.b,f.job.ref),before.job);assert.deepEqual(sql(f,'SELECT * FROM attempts'),before.attempts);
   assert.deepEqual(sql(f,'SELECT * FROM aux_runs'),before.runs);assert.deepEqual(sql(f,'SELECT counters_json FROM sessions'),before.counters);
  }finally{coordinator.close();}
}));
test('Supervisor: cancel persists quarantine and keeps its owner until pending cleanup ends',()=>supervised(async f=>{
 const d=deferred();let signal;
 const done=f.supervisor.start(f.lease,f.job.ref,amount,async s=>{signal=s;return d.promise;});
 try{
  const a=f.store.readJob(f.b,f.job.ref).attempts[0],owner=f.store.readAttemptOwnership(f.b,f.job.ref,a.ref);
  const cancelled=f.supervisor.cancel(f.lease,f.job.ref);
  assert.equal(cancelled.status,'cancelled');assert.equal(signal.aborted,true);
  assert.equal(cancelled.attempts[0].local_state,'quarantine');assert.equal(cancelled.attempts[0].local_stopped,false);
  reject(()=>f.supervisor.close(),'E_CONFLICT');assert.equal(pythonTry(join(f.directory,'owners',owner.storage_owner_id+'.lock')),'busy');
  assert.equal(f.store.readJob(f.b,f.job.ref).attempts[0].local_stopped,false);
 }finally{d.resolve(result());}
 const settled=await done;assert.equal(settled.status,'cancelled');assert.equal(settled.proposal,null);
 assert.equal(settled.attempts[0].local_stopped,true);assert.equal(settled.attempts[0].remote_state,'unknown');
 assert.equal(sql(f,'SELECT input_reserved FROM attempts')[0].input_reserved,amount.input_tokens);
}));
test('Supervisor: legacy result and stop APIs cannot write a supervised attempt without its hold',()=>supervised(async f=>{
 const d=deferred(),done=f.supervisor.start(f.lease,f.job.ref,amount,()=>d.promise);
 try{
  const a=f.store.readJob(f.b,f.job.ref).attempts[0];
  reject(()=>f.store.recordJobAttemptResult(f.lease,f.job.ref,a.ref,response()),'E_OWNER');
  f.supervisor.cancel(f.lease,f.job.ref);
  reject(()=>f.store.confirmJobAttemptStopped(f.lease,f.job.ref,a.ref),'E_OWNER');
  assert.equal(f.store.readJob(f.b,f.job.ref).attempts[0].local_state,'quarantine');
 }finally{d.resolve(result());await done;}
}));
test('Supervisor: another live participant cannot substitute its hold for the registered owner',()=>supervised(async f=>{
 const other=WorkspaceCoordinator.open(f.directory,workspace),d=deferred(),done=f.supervisor.start(f.lease,f.job.ref,amount,()=>d.promise);
 try{
  const a=f.store.readJob(f.b,f.job.ref).attempts[0];
  reject(()=>other.withWorkspaceLock(h=>f.store.recordJobAttemptResult(f.lease,f.job.ref,a.ref,response(),h)),'E_OWNER');
  assert.equal(f.store.readJob(f.b,f.job.ref).attempts[0].state,'dispatched');
 }finally{other.close();d.resolve(result());await done;}
}));
test('Supervisor: invalid budget never invokes adapter or creates a reservation',()=>supervised(async f=>{
 let calls=0;reject(()=>f.supervisor.start(f.lease,f.job.ref,{...amount,output_tokens:1},async()=>{calls++;return result();}),'E_BUDGET');
 assert.equal(calls,0);assert.equal(f.store.readJob(f.b,f.job.ref).attempts.length,0);
}));
test('Supervisor: cancelling before start preserves terminal status without invocation',()=>supervised(async f=>{
 f.supervisor.cancel(f.lease,f.job.ref);let calls=0;
 reject(()=>f.supervisor.start(f.lease,f.job.ref,amount,async()=>{calls++;return result();}),'E_CONFLICT');
 assert.equal(calls,0);assert.equal(f.store.readJob(f.b,f.job.ref).status,'cancelled');
}));
test('Supervisor: parallel start of the same session cannot invoke an extra adapter',()=>supervised(async f=>{
 let calls=0;const d=deferred(),done=f.supervisor.start(f.lease,f.job.ref,amount,()=>{calls++;return d.promise;});
 try{reject(()=>f.supervisor.start(f.lease,f.job.ref,amount,async()=>{calls++;return result();}),'E_CONFLICT');assert.equal(calls,1);}
 finally{d.resolve(result());await done;}
}));
test('Supervisor: adapter rejection is a terminal unknown result without retry or private error',()=>supervised(async f=>{
 const done=await f.supervisor.start(f.lease,f.job.ref,amount,async()=>{throw Error('private adapter fixture');});
 assert.equal(done.status,'failed');assert.equal(done.error_code,'E_PROTOCOL');assert.equal(done.retry,null);
 assert.equal(done.attempts[0].state,'unknown');assert.equal(done.attempts[0].local_stopped,true);
 assert.equal(JSON.stringify(done).includes('private adapter fixture'),false);
}));
test('Supervisor: malformed adapter result does not create ready or enable repair',()=>supervised(async f=>{
 const done=await f.supervisor.start(f.lease,f.job.ref,amount,async()=>({...result(),local_stopped:true}));
 assert.equal(done.status,'failed');assert.equal(done.retry,null);assert.equal(done.proposal,null);assert.equal(done.attempts.length,1);
}));
test('Supervisor: HTTP transient response records eligibility but never retries automatically',()=>supervised(async f=>{
 let calls=0;const done=await f.supervisor.start(f.lease,f.job.ref,amount,async()=>{calls++;return {kind:'http_error',status:503,retry_after_ms:null};});
 assert.equal(done.status,'running');assert.equal(done.retry.kind,'retry');assert.equal(calls,1);assert.equal(done.attempts.length,1);
}));
test('Supervisor: a renewed lease within the same generation can persist completion',()=>supervised(async f=>{
 const d=deferred(),done=f.supervisor.start(f.lease,f.job.ref,amount,()=>d.promise);
 f.advance(10000);f.store.renewLease(f.lease);d.resolve(result());assert.equal((await done).status,'ready');
}));
test('Supervisor: owner takeover does not permit late result or infer local stop in the ledger',()=>supervised(async f=>{
 const d=deferred(),done=f.supervisor.start(f.lease,f.job.ref,amount,()=>d.promise),settled=rejects(done,'E_OWNER');
 f.advance(30001);const other=f.open(),lease=other.acquireLease(f.b);other.recoverJobs(lease);d.resolve(result());await settled;
 const stored=other.readJob(f.b,f.job.ref);assert.equal(stored.status,'failed');assert.equal(stored.attempts[0].local_state,'quarantine');assert.equal(stored.attempts[0].remote_state,'unknown');
}));
test('Supervisor: close after completion retires storage identity but reopening never replays work',()=>supervised(async f=>{
 let calls=0;await f.supervisor.start(f.lease,f.job.ref,amount,async()=>{calls++;return result();});
 const before=sql(f,'SELECT * FROM attempts');f.supervisor.close();f.supervisor.close();
 const next=LocalAttemptSupervisor.open(f.directory,workspace,f.time);try{assert.deepEqual(sql(f,'SELECT * FROM attempts'),before);assert.equal(calls,1);}
 finally{next.close();}
 reject(()=>f.supervisor.start(f.lease,f.job.ref,amount,async()=>result()),'E_OWNER');
}));
test('Supervisor: ownership checksum and field shape are rechecked on diagnostic reads',()=>supervised(async f=>{
 await f.supervisor.start(f.lease,f.job.ref,amount,async()=>result());const a=f.store.readJob(f.b,f.job.ref).attempts[0];
 const saved=sql(f,'SELECT usage_json FROM attempts WHERE attempt_id=?',a.ref.attempt_id)[0].usage_json;
 const value=JSON.parse(saved);value.value.owner_fence++;sql(f,'UPDATE attempts SET usage_json=? WHERE attempt_id=?',JSON.stringify(value),a.ref.attempt_id);
 reject(()=>f.store.readAttemptOwnership(f.b,f.job.ref,a.ref),'E_STORAGE');
 sql(f,'UPDATE attempts SET usage_json=? WHERE attempt_id=?',saved,a.ref.attempt_id);
 assert.equal(f.store.readAttemptOwnership(f.b,f.job.ref,a.ref).owner_fence,f.lease.owner_fence);
}));
test('Supervisor: ownership and reservation rollback together when binding cannot be persisted',()=>supervised(async f=>{
 const old=DatabaseSync.prototype.prepare;let writes=0,calls=0;
 DatabaseSync.prototype.prepare=function(q){if(q.startsWith('UPDATE attempts SET usage_json=')){writes++;throw Error('fixture binding persistence failure');}return old.call(this,q);};
 try{reject(()=>f.supervisor.start(f.lease,f.job.ref,amount,async()=>{calls++;return result();}),'E_STORAGE');}
 finally{DatabaseSync.prototype.prepare=old;}
 assert.equal(writes,1);assert.equal(calls,0);assert.equal(sql(f,'SELECT count(*) AS n FROM attempts')[0].n,0);
 assert.equal(sql(f,'SELECT count(*) AS n FROM aux_runs')[0].n,0);assert.equal(f.store.readJob(f.b,f.job.ref).status,'queued');
}));
test('Supervisor: unavailable workspace lock refuses start before invoking callback',()=>supervised(async f=>{
 const other=WorkspaceCoordinator.open(f.directory,workspace);let calls=0;
 try{other.withWorkspaceLock(()=>reject(()=>f.supervisor.start(f.lease,f.job.ref,amount,async()=>{calls++;return result();}),'E_CONFLICT'));}
 finally{other.close();}assert.equal(calls,0);assert.equal(f.store.readJob(f.b,f.job.ref).attempts.length,0);
}));
test('Supervisor: constructor is factory-only for JavaScript consumers',()=>{
 for(const key of [undefined,Symbol('LocalAttemptSupervisor')])reject(()=>Reflect.construct(LocalAttemptSupervisor,[{}, {}, key]),'E_OWNER');
});
test('Supervisor: cancelling an unrelated job cannot abort the tracked operation',()=>supervised(async f=>{
 const d=deferred();let signal;const done=f.supervisor.start(f.lease,f.job.ref,amount,s=>{signal=s;return d.promise;});
 try{reject(()=>f.supervisor.cancel(f.lease,{...f.job.ref,job_id:id(111)}),'E_CONFLICT');assert.equal(signal.aborted,false);}
 finally{d.resolve(result());await done;}
}));


test('Supervisor review: a non-Promise adapter cannot publish a successful result',()=>supervised(async f=>{
 const job=await f.supervisor.start(f.lease,f.job.ref,amount,()=>result());
 assert.equal(job.status,'failed');assert.equal(job.proposal,null);assert.equal(job.retry,null);
}));
test('Supervisor review: failed dispatch reconciles the unused reservation without invoking adapter',()=>supervised(async f=>{
 const old=DatabaseSync.prototype.prepare;let injected=0,calls=0;
 DatabaseSync.prototype.prepare=function(q){
  const st=old.call(this,q);
  if(q==='UPDATE attempts SET state=? WHERE session_key=? AND attempt_id=? AND state=?'){
   const run=st.run;st.run=function(...args){if(args[0]==='dispatched'){injected++;throw Error('synthetic pre-dispatch write failure');}return run.apply(this,args);};
  }
  return st;
 };
 try{await rejects(f.supervisor.start(f.lease,f.job.ref,amount,async()=>{calls++;return result();}),'E_STORAGE');}
 finally{DatabaseSync.prototype.prepare=old;}
 assert.equal(injected,1);assert.equal(calls,0);const stored=f.store.readJob(f.b,f.job.ref);
 assert.equal(stored.status,'cancelled');assert.equal(stored.attempts[0].state,'cancelled');
 assert.equal(stored.attempts[0].local_stopped,true);assert.equal(stored.attempts[0].input_reserved,amount.input_tokens);
}));
test('Supervisor: retry is explicit, belongs to a new attempt, and retains the original deadline',()=>supervised(async f=>{
 const a=await f.supervisor.start(f.lease,f.job.ref,amount,async()=>({kind:'http_error',status:503,retry_after_ms:1}));
 f.advance(1);const b=await f.supervisor.start(f.lease,f.job.ref,amount,async()=>result());
 assert.equal(b.status,'ready');assert.equal(b.attempts.length,2);assert.equal(a.deadline_at,b.deadline_at);
 assert.notEqual(b.attempts[0].ref.run_id,b.attempts[1].ref.run_id);
 assert.equal(f.store.readAttemptOwnership(f.b,f.job.ref,b.attempts[1].ref).attempt.attempt_no,2);
}));
test('Supervisor: terminal empty response creates neither repair nor chapter',()=>supervised(async f=>{
 const done=await f.supervisor.start(f.lease,f.job.ref,amount,async()=>({...result(),text:'  \r\n'}));
 assert.equal(done.status,'rejected');assert.equal(done.error_code,'E_NO_GAIN');assert.equal(done.retry,null);
 assert.equal(sql(f,'SELECT count(*) AS n FROM chapters')[0].n,0);
}));
test('Supervisor: persisted ownership is not a replacement for the live issued hold',()=>supervised(async f=>{
 const d=deferred(),done=f.supervisor.start(f.lease,f.job.ref,amount,()=>d.promise);
 try{
  const a=f.store.readJob(f.b,f.job.ref).attempts[0],r=f.store.readAttemptOwnership(f.b,f.job.ref,a.ref);
  const copied={workspace,owner_id:r.storage_owner_id,process_instance:r.process_instance};
  reject(()=>f.store.recordJobAttemptResult(f.lease,f.job.ref,a.ref,response(),copied),'E_OWNER');
 }finally{d.resolve(result());await done;}
}));
test('Supervisor: an invalid ownership envelope is refused rather than treated as legacy',()=>supervised(async f=>{
 await f.supervisor.start(f.lease,f.job.ref,amount,async()=>result());const a=f.store.readJob(f.b,f.job.ref).attempts[0];
 for(const value of ['{}','[]','{"value":{},"digest":"invalid"}']){
  sql(f,'UPDATE attempts SET usage_json=? WHERE attempt_id=?',value,a.ref.attempt_id);
  reject(()=>f.store.readAttemptOwnership(f.b,f.job.ref,a.ref),'E_STORAGE');
 }
}));

// S01 acceptance must include the absence of a local-completion observation.
test('Supervisor review: invalid return leaves local completion unknown',()=>supervised(async f=>{
 let signal;const job=await f.supervisor.start(f.lease,f.job.ref,amount,s=>{signal=s;return result();});
 assert.equal(job.attempts[0].local_stopped,false);
 assert.equal(job.attempts[0].local_state,'quarantine');assert.equal(job.attempts[0].remote_state,'unknown');
 assert.equal(signal.aborted,true);assert.equal(job.proposal,null);
 assert.equal(job.attempts[0].input_reserved,amount.input_tokens);
}));
test('Supervisor review: synchronous adapter throw cannot prove local cleanup',()=>supervised(async f=>{
 const job=await f.supervisor.start(f.lease,f.job.ref,amount,()=>{throw Error('private synchronous fixture');});
 assert.equal(job.status,'failed');assert.equal(job.attempts[0].local_stopped,false);
 assert.equal(job.attempts[0].local_state,'quarantine');assert.equal(job.retry,null);
 assert.equal(JSON.stringify(job).includes('private synchronous fixture'),false);
}));
test('Supervisor review: a foreign thenable is not assimilated as a completion signal',()=>supervised(async f=>{
 let reads=0;
 const job=await f.supervisor.start(f.lease,f.job.ref,amount,()=>({get then(){reads++;return resolve=>resolve(result());}}));
 assert.equal(reads,0,'a non-Promise then accessor must not be executed');
 assert.equal(job.status,'failed');assert.equal(job.attempts[0].local_stopped,false);assert.equal(job.proposal,null);
}));
test('Supervisor: rejected Promise records stop only after its cleanup has settled',()=>supervised(async f=>{
 const d=deferred();let observed=false;
 const done=f.supervisor.start(f.lease,f.job.ref,amount,async()=>{try{return await d.promise;}finally{observed=true;}});
 try{
  const cancelled=f.supervisor.cancel(f.lease,f.job.ref);assert.equal(observed,false);
  assert.equal(cancelled.attempts[0].local_stopped,false);reject(()=>f.supervisor.close(),'E_CONFLICT');
 }finally{d.reject(Error('private pending cleanup'));}
 const job=await done;assert.equal(observed,true);assert.equal(job.status,'cancelled');
 assert.equal(job.attempts[0].local_stopped,true);assert.equal(job.attempts[0].remote_state,'unknown');
}));
test('Supervisor: failed dispatch with an expired lease preserves its reservation without invocation',()=>supervised(async f=>{
 const old=DatabaseSync.prototype.prepare;let injected=0,calls=0;
 DatabaseSync.prototype.prepare=function(q){
  const st=old.call(this,q);
  if(q==='UPDATE attempts SET state=? WHERE session_key=? AND attempt_id=? AND state=?'){
   const run=st.run;st.run=function(...args){if(args[0]==='dispatched'){injected++;f.advance(30001);throw Error('synthetic write failure after lease expiry');}return run.apply(this,args);};
  }return st;
 };
 try{await rejects(f.supervisor.start(f.lease,f.job.ref,amount,async()=>{calls++;return result();}),'E_STORAGE');}
 finally{DatabaseSync.prototype.prepare=old;}
 assert.equal(injected,1);assert.equal(calls,0);const job=f.store.readJob(f.b,f.job.ref);
 assert.equal(job.status,'running');assert.equal(job.attempts[0].state,'reserved');assert.equal(job.attempts[0].input_reserved,amount.input_tokens);
 const next=f.open(),lease=next.acquireLease(f.b);next.recoverJobs(lease);
 const recovered=next.readJob(f.b,f.job.ref);assert.equal(recovered.attempts[0].state,'cancelled');
 assert.equal(recovered.attempts.length,1);assert.equal(calls,0);
}));
test('Supervisor: independent sessions keep separate pending operations and cancellation',()=>supervised(async f=>{
 const b={...f.b,scope:{...f.b.scope,host_session_id:'B'}};
 // Use the core to derive a different canonical binding rather than editing a key.
 const {createSessionBinding,createManifest,createJobContext,hashPayload,hashSource}=await import('../../packages/core/src/index.ts');
 const binding=createSessionBinding(b.scope,b.incarnation,b.host_epoch);
 f.store.createSession(binding,f.cfg);const lease=f.store.acquireLease(binding);
 const old=f.store.readRootCatalog(binding),catalog=f.store.retainRoots(lease,{expected_catalog_digest:old.catalog_digest,sources:[f.source],observations:[f.observation]});
 const entity={kind:'source',ref:f.source.ref},bytes=f.source.bytes;
 const manifest=createManifest(binding,[{entity,authority:'agent',range:{start_byte:0,end_byte:bytes.length},excerpt_digest:hashSource(bytes),presented_as:'full',locator:'s1'}],()=>({binding,entity,authority:'agent',bytes}));
 const roots=catalog.entries.map(e=>e.unit.root_coverage[0]);
 const {snapshot_id,schema_version,session_key,incarnation,host_epoch,manifest_id,manifest_digest,...snapshot}=f.job.record.snapshot;
 const context=createJobContext(binding,{...snapshot,owner_fence:lease.owner_fence,root_coverage:roots,logical_coverage:roots.map(x=>x.unit_id),coverage_digest:hashPayload(roots)},manifest,'Maintain the second synthetic session.');
 f.store.admitJob(lease,context,context.ref);
 const a=deferred(),c=deferred();let sa,sb;
 const pa=f.supervisor.start(f.lease,f.job.ref,amount,s=>{sa=s;return a.promise;});
 const pb=f.supervisor.start(lease,context.ref,amount,s=>{sb=s;return c.promise;});
 try{f.supervisor.cancel(f.lease,f.job.ref);assert.equal(sa.aborted,true);assert.equal(sb.aborted,false);}
 finally{a.resolve(result());c.resolve(result());}
 assert.equal((await pa).status,'cancelled');assert.equal((await pb).status,'ready');
}));

test('Supervisor: cancel ordering is observed outside the adapter and before settlement',()=>supervised(async f=>{
 const d=deferred();let observed=null,signals=0;
 const done=f.supervisor.start(f.lease,f.job.ref,amount,signal=>{
  signal.addEventListener('abort',()=>{signals++;observed=f.store.readJob(f.b,f.job.ref);},{once:true});
  return d.promise;
 });
 const cancelled=f.supervisor.cancel(f.lease,f.job.ref),pending=f.store.readJob(f.b,f.job.ref);
 d.resolve(result());const completed=await done;
 assert.equal(signals,1);assert.equal(observed.status,'cancelled');
 assert.equal(observed.attempts[0].local_state,'quarantine');
 assert.equal(cancelled.attempts[0].local_stopped,false);assert.equal(pending.attempts[0].local_stopped,false);
 assert.equal(completed.status,'cancelled');assert.equal(completed.attempts[0].local_stopped,true);
 assert.equal(completed.attempts[0].remote_state,'unknown');
}));

test('Supervisor: reservation ownership is observable before dispatch admission',()=>supervised(async f=>{
 const coordinator=WorkspaceCoordinator.open(f.directory,workspace);
 try{
  const ref=coordinator.withWorkspaceLock(hold=>f.store.reserveJobAttempt(f.lease,f.job.ref,amount,hold));
  const ownership=f.store.readAttemptOwnership(f.b,f.job.ref,ref);
  assert.notEqual(ownership,null,'the reservation must already carry its ownership');
  assert.equal(ownership.storage_owner_id,coordinator.owner_id);assert.deepEqual(ownership.attempt,ref);
  assert.equal(f.store.readJob(f.b,f.job.ref).attempts[0].state,'reserved');
 }finally{f.store.cancelJob(f.lease,f.job.ref);coordinator.close();}
}));

// Completion observations and pre-invocation failures exercise the public supervisor.
test('Supervisor resolution: invalid adapter cancellation observes durable quarantine',()=>supervised(async f=>{
 let observed,signals=0;
 const job=await f.supervisor.start(f.lease,f.job.ref,amount,signal=>{
  signal.addEventListener('abort',()=>{signals++;observed=f.store.readJob(f.b,f.job.ref);},{once:true});
  return result();
 });
 assert.equal(signals,1);assert.equal(observed.status,'failed');
 assert.equal(observed.attempts[0].local_state,'quarantine');assert.equal(observed.attempts[0].local_stopped,false);
 assert.equal(job.attempts[0].remote_state,'unknown');
 let calls=0;reject(()=>f.supervisor.start(f.lease,f.job.ref,amount,async()=>{calls++;return result();}),'E_CONFLICT');
 assert.equal(calls,0);const before=sql(f,'SELECT * FROM aux_runs');
 f.supervisor.close();assert.deepEqual(sql(f,'SELECT * FROM aux_runs'),before);
 assert.equal(sql(f,'SELECT count(*) AS n FROM attempts')[0].n,1);
}));
test('Supervisor resolution: native Promise observation does not call an overridden then',()=>supervised(async f=>{
 const d=deferred();let reads=0;
 Object.defineProperty(d.promise,'then',{get(){reads++;throw Error('private then override');}});
 const done=f.supervisor.start(f.lease,f.job.ref,amount,()=>d.promise);
 assert.equal(f.store.readJob(f.b,f.job.ref).attempts[0].local_stopped,false);
 d.resolve(result());const job=await done;
 assert.equal(reads,0);assert.equal(job.status,'ready');assert.equal(job.attempts[0].local_stopped,true);
}));
test('Supervisor resolution: post-commit dispatch failure stops an uninvoked attempt without replay',()=>supervised(async f=>{
 const prototype=Object.getPrototypeOf(f.store),original=prototype.markJobAttemptDispatched;
 let committed=0,calls=0;
 prototype.markJobAttemptDispatched=function(...args){
  original.apply(this,args);committed++;
  const error=new Error('synthetic post-commit dispatch failure');error.code='E_STORAGE';throw error;
 };
 try{await rejects(f.supervisor.start(f.lease,f.job.ref,amount,async()=>{calls++;return result();}),'E_STORAGE');}
 finally{prototype.markJobAttemptDispatched=original;}
 assert.equal(committed,1);assert.equal(calls,0);
 const job=f.store.readJob(f.b,f.job.ref);
 assert.equal(job.status,'cancelled');assert.equal(job.attempts[0].state,'unknown');
 assert.equal(job.attempts[0].local_state,'stopped');assert.equal(job.attempts[0].local_stopped,true);
 assert.equal(job.attempts[0].remote_state,'unknown');assert.equal(job.attempts[0].input_reserved,amount.input_tokens);
 assert.equal(job.attempts.length,1);assert.equal(job.proposal,null);
}));
test('Supervisor resolution: failed reconciliation preserves reservation and original dispatch error',()=>supervised(async f=>{
 const original=DatabaseSync.prototype.prepare;let attempts=0,cancellations=0,calls=0;
 DatabaseSync.prototype.prepare=function(q){
  const st=original.call(this,q);
  if(q==='UPDATE attempts SET state=? WHERE session_key=? AND attempt_id=? AND state=?'){
   const run=st.run;st.run=function(...args){
    if(args[0]==='dispatched'){attempts++;throw Error('private initial failure');}
    if(args[0]==='cancelled'){cancellations++;throw Error('private cleanup failure');}
    return run.apply(this,args);
   };
  }return st;
 };
 try{await assert.rejects(f.supervisor.start(f.lease,f.job.ref,amount,async()=>{calls++;return result();}),e=>e.code==='E_STORAGE'&&!e.message.includes('private'));}
 finally{DatabaseSync.prototype.prepare=original;}
 assert.equal(attempts,1);assert.equal(cancellations,1);assert.equal(calls,0);
 const before=f.store.readJob(f.b,f.job.ref);
 assert.equal(before.status,'running');assert.equal(before.attempts[0].state,'reserved');
 assert.equal(before.attempts[0].input_reserved,amount.input_tokens);
 const cancelled=f.supervisor.cancel(f.lease,f.job.ref);
 assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.attempts[0].local_stopped,true);
 assert.equal(cancelled.attempts.length,1);assert.equal(calls,0);
}));
