import test from 'node:test';
import assert from 'node:assert/strict';
import {hashPayload} from '../../packages/core/src/index.ts';
import {fixture,amount,sql} from './scheduler-admission-fixtures.mjs';

const digest=n=>n.toString(16).padStart(64,'0');
const reject=(fn,...codes)=>assert.throws(fn,error=>codes.includes(error.code));
function input(f,job,patch={}) {
 const observation={host_epoch:0,coverage_digest:job.record.snapshot.coverage_digest,policy_revision:0,
  config_digest:hashPayload(f.cfg),configuration:f.cfg,eligible_tokens:50000,observed_at_ms:f.time(),...patch.observation};
 return {context:job,expected:job.ref,observation,selected_interval_tokens:2048,attempt_budget:amount,...patch.input};
}
function admit(f,job,patch={}) {
 const value=input(f,job,patch);f.s.observePrimaryAndRearm(f.lease,value.observation);
 return f.coordinator.withWorkspaceLock(hold=>f.s.admitPrimarySchedulerJob(f.lease,{...value,owner_hold:hold}));
}

test('C-SCHED admission: primary threshold atomically admits, reserves, binds tuple and disarms',()=>fixture(f=>{
 const job=f.job(),result=admit(f,job);assert.equal(result.job.status,'running');assert.equal(result.attempt.attempt_no,1);
 assert.equal(result.state.armed,false);assert.deepEqual(result.state.last_attempt,{host_epoch:0,coverage_digest:job.record.snapshot.coverage_digest,policy_revision:0,config_digest:hashPayload(f.cfg)});
 assert.deepEqual(JSON.parse(sql(f,'SELECT counters_json FROM sessions')[0].counters_json).job_budget,{calls:1,input_tokens:8192,output_tokens:4096});
 const owner=f.s.readAttemptOwnership(f.b,job.ref,result.attempt);assert.equal(owner.storage_owner_id,f.coordinator.owner_id);assert.equal(owner.process_instance,f.coordinator.process_instance);
}));

test('C-SCHED admission: closed input, issued context and live workspace hold are mandatory',()=>fixture(f=>{
 const job=f.job(),value=input(f,job);f.s.observePrimaryAndRearm(f.lease,value.observation);
 reject(()=>f.s.admitPrimarySchedulerJob(f.lease,{...value,owner_hold:{}}),'E_OWNER');
 f.coordinator.withWorkspaceLock(hold=>reject(()=>f.s.admitPrimarySchedulerJob(f.lease,{...value,context:JSON.parse(JSON.stringify(job)),owner_hold:hold}),'E_SCHEMA'));
 assert.equal(sql(f,'SELECT * FROM jobs').length,0);assert.equal(f.s.readSchedulerState(f.b).armed,true);
}));

for(const [name,patch] of [
 ['U',{observation:{eligible_tokens:49999}}],
 ['selected interval',{input:{selected_interval_tokens:2047}}],
 ['current observation',{observation:{observed_at_ms:99999}}],
 ['tuple',{observation:{coverage_digest:digest(9)}}],
]) test(`C-SCHED admission: ${name} guard rolls back job, reservation and state`,()=>fixture(f=>{
 const job=f.job(),base=input(f,job,name==='U'?patch:{});f.s.observePrimaryAndRearm(f.lease,base.observation);const value=input(f,job,patch);
 f.coordinator.withWorkspaceLock(hold=>reject(()=>f.s.admitPrimarySchedulerJob(f.lease,{...value,owner_hold:hold}),'E_BUDGET','E_CONFLICT'));
 assert.equal(sql(f,'SELECT * FROM jobs').length,0);assert.equal(sql(f,'SELECT * FROM attempts').length,0);assert.equal(f.s.readSchedulerState(f.b).armed,true);
}));

test('C-SCHED admission: duplicate tuple, active work and quarantine cannot create another reservation',()=>fixture(f=>{
 const first=f.job(),result=admit(f,first);const second=f.job();
 const replay=input(f,first);f.s.observePrimaryAndRearm(f.lease,replay.observation);
 f.coordinator.withWorkspaceLock(hold=>reject(()=>f.s.admitPrimarySchedulerJob(f.lease,{...replay,owner_hold:hold}),'E_CONFLICT'));
 const next=input(f,second,{observation:{coverage_digest:second.record.snapshot.coverage_digest}});f.s.observePrimaryAndRearm(f.lease,next.observation);
 f.coordinator.withWorkspaceLock(hold=>reject(()=>f.s.admitPrimarySchedulerJob(f.lease,{...next,owner_hold:hold}),'E_CONFLICT'));
 assert.equal(sql(f,'SELECT * FROM attempts').length,1);assert.equal(f.s.readJob(f.b,first.ref).attempts[0].ref.attempt_id,result.attempt.attempt_id);
}));

test('C-SCHED admission: disarmed state cannot admit even with current primary observation',()=>fixture(f=>{
 const job=f.job(),value=input(f,job);f.s.observePrimaryAndRearm(f.lease,value.observation);
 sql(f,'UPDATE scheduler_state SET armed=0 WHERE session_key=?',f.b.session_key);
 f.coordinator.withWorkspaceLock(hold=>reject(()=>f.s.admitPrimarySchedulerJob(f.lease,{...value,owner_hold:hold}),'E_CONFLICT'));
 assert.equal(sql(f,'SELECT * FROM jobs').length,0);
}));

test('C-SCHED admission: last admitted tuple cannot be reused after prior work is gone',()=>fixture(f=>{
 const job=f.job(),value=input(f,job);f.s.observePrimaryAndRearm(f.lease,value.observation);
 sql(f,`UPDATE scheduler_state SET last_attempt_host_epoch=0,last_attempt_coverage_digest=?,last_attempt_policy_revision=0,
  last_attempt_config_digest=? WHERE session_key=?`,value.observation.coverage_digest,value.observation.config_digest,f.b.session_key);
 f.coordinator.withWorkspaceLock(hold=>reject(()=>f.s.admitPrimarySchedulerJob(f.lease,{...value,owner_hold:hold}),'E_CONFLICT'));
 assert.equal(sql(f,'SELECT * FROM jobs').length,0);
}));
