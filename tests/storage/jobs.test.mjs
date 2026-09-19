import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {OWNER_LEASE_MS} from '../../packages/storage/src/index.ts';
import {hashPayload,hashSource,createManifest} from '../../packages/core/src/index.ts';
import {fixture,begin,binding,id,amount,response,sql,exec} from './job-fixtures.mjs';
const reject=(fn,...codes)=>assert.throws(fn,e=>codes.includes(e.code));
const copy=x=>JSON.parse(JSON.stringify(x));

test('WP02C: admission retains immutable context, manifest, expectation and fixed deadline',()=>fixture(f=>{
 const job=f.job(),stored=f.s.admitJob(f.lease,job,job.ref);
 assert.deepEqual(stored.context,job.record);assert.deepEqual(stored.ref,job.ref);assert.equal(stored.status,'queued');
 assert.equal(Date.parse(stored.deadline_at),f.time()+f.cfg.settings.job_timeout_ms);
 assert.deepEqual(f.open().readJob(f.b,job.ref),stored);assert.ok(Object.isFrozen(stored.context.snapshot.read_dependencies));
 const [row]=sql(f,'SELECT * FROM jobs');assert.deepEqual(JSON.parse(row.manifest_json),job.record.manifest);
 assert.equal(sql(f,'SELECT * FROM attempts').length,0);assert.equal(f.s.readSession(f.b).mode,'unsupported');
}));
test('WP02C: read does not create a job; JSON cannot impersonate issued context',()=>fixture(f=>{
 const job=f.job();assert.equal(f.s.readJob(f.b,job.ref),null);
 reject(()=>f.s.admitJob(f.lease,copy(job),job.ref),'E_SCHEMA');assert.equal(sql(f,'SELECT * FROM jobs').length,0);
}));
test('WP02C: replay never extends deadline, clears attempts or resurrects a terminal job',()=>fixture(f=>{
 const {job,attempt}=begin(f),first=f.s.readJob(f.b,job.ref);f.advance(50);
 assert.deepEqual(f.s.admitJob(f.lease,job,job.ref),first);
 f.s.cancelJob(f.lease,job.ref);const terminal=f.s.readJob(f.b,job.ref);
 assert.deepEqual(f.s.admitJob(f.lease,job,job.ref),terminal);assert.equal(terminal.attempts[0].ref.attempt_id,attempt.attempt_id);
}));
test('WP02C: active job and uncertain local run each prevent competing admission',()=>fixture(f=>{
 const {job,attempt}=begin(f),second=f.job();reject(()=>f.s.admitJob(f.lease,second,second.ref),'E_CONFLICT');
 f.s.cancelJob(f.lease,job.ref);reject(()=>f.s.admitJob(f.lease,second,second.ref),'E_CONFLICT');
 f.s.confirmJobAttemptStopped(f.lease,job.ref,attempt);assert.equal(f.s.admitJob(f.lease,second,second.ref).status,'queued');
}));
test('WP02C: incorrect expected identity and scope cannot import another generation',()=>fixture(f=>{
 const job=f.job();f.s.admitJob(f.lease,job,job.ref);
 for(const key of ['snapshot_id','snapshot_digest','context_digest']){
  const wrong={...job.ref,[key]:key.endsWith('_id')?id(99):'0'.repeat(64)};
  reject(()=>f.s.readJob(f.b,wrong),'E_CONFLICT');reject(()=>f.s.reserveJobAttempt(f.lease,wrong,amount),'E_CONFLICT');
 }
 f.s.createSession(binding('B'),f.cfg);assert.equal(f.s.readJob(binding('B'),job.ref),null);
 reject(()=>f.s.readJob({...f.b,incarnation:id(8)},job.ref),'E_SCOPE');
}));
test('WP02C: inconsistent stored control cannot be rehydrated by recomputing context digest',()=>fixture(f=>{
 const job=f.job();f.s.admitJob(f.lease,job,job.ref);
 const envelope=JSON.parse(sql(f,'SELECT snapshot_json FROM jobs')[0].snapshot_json);
 envelope.context.mission+=' changed';envelope.context.mission_digest=hashSource(Buffer.from(envelope.context.mission));
 const {context_digest,...body}=envelope.context;envelope.context.context_digest=hashPayload(body);
 sql(f,'UPDATE jobs SET snapshot_json=?',JSON.stringify(envelope));
 reject(()=>f.s.readJob(f.b,job.ref),'E_CONFLICT');
}));
test('WP02C: manifest column corruption fails rather than trusting the context copy',()=>fixture(f=>{
 const job=f.job();f.s.admitJob(f.lease,job,job.ref);exec(f,"UPDATE jobs SET manifest_json='{}'");
 reject(()=>f.s.readJob(f.b,job.ref),'E_CONFLICT');
}));
test('WP02C: source bytes are reverified at admission and before dispatch',()=>fixture(f=>{
 const job=f.job();exec(f,'UPDATE sources SET inline_bytes=zeroblob(length(inline_bytes))');
 reject(()=>f.s.admitJob(f.lease,job,job.ref),'E_SOURCE');assert.equal(sql(f,'SELECT * FROM jobs').length,0);
 sql(f,'UPDATE sources SET inline_bytes=?',f.source.bytes);f.s.admitJob(f.lease,job,job.ref);
 const attempt=f.s.reserveJobAttempt(f.lease,job.ref,amount);exec(f,'UPDATE sources SET inline_bytes=zeroblob(length(inline_bytes))');
 reject(()=>f.s.markJobAttemptDispatched(f.lease,job.ref,attempt),'E_SOURCE');
 assert.equal(f.s.readJob(f.b,job.ref).attempts[0].state,'reserved');
}));
test('WP02C: stale root and omitted root dependency fail admission',()=>fixture(f=>{
 const old=f.job();f.s.retainRoots(f.lease,{expected_catalog_digest:f.catalog.catalog_digest,sources:[],observations:[{...f.observation,payload:[{role:'assistant',content:'edited'}]}]});
 reject(()=>f.s.admitJob(f.lease,old,old.ref),'E_SOURCE');
}));
test('WP02C: metadata-only root update does not invalidate semantic coverage',()=>fixture(f=>{
 const job=f.job();f.s.retainRoots(f.lease,{expected_catalog_digest:f.catalog.catalog_digest,sources:[],observations:[{...f.observation,payload_ref:'new opaque locator',estimated_tokens:6000}]});
 assert.equal(f.s.admitJob(f.lease,job,job.ref).status,'queued');
}));
test('WP02C: future, expired or differently fenced snapshots cannot enter the queue',()=>fixture(f=>{
 for(const fields of [{created_at:new Date(f.time()+1).toISOString()},{created_at:new Date(0).toISOString(),owner_fence:9},{policy_revision:1},{view_revision:1},{owner_fence:0}]){
  const job=f.job(fields);reject(()=>f.s.admitJob(f.lease,job,job.ref),'E_CONFLICT');
 }
 const expired=f.job({created_at:'1970-01-01T00:00:00.000Z'});f.advance(300000);f.useLease(f.s.acquireLease(f.b));
 reject(()=>f.s.admitJob(f.lease,expired,expired.ref),'E_CONFLICT');
}));
test('WP02C: unsupported feedback remains explicit instead of being dropped',()=>fixture(f=>{
 const job=f.job({feedback_ids:[id(90)]});reject(()=>f.s.admitJob(f.lease,job,job.ref),'E_CAPABILITY');
 assert.equal(sql(f,'SELECT * FROM jobs').length,0);
}));
test('WP02C: caller cannot promote source authority through its manifest',()=>fixture(f=>{
 const entity={kind:'source',ref:f.source.ref},bytes=f.source.bytes;
 const m=createManifest(f.b,[{entity,authority:'user',range:{start_byte:0,end_byte:bytes.length},excerpt_digest:entity.ref.digest,presented_as:'full',locator:'x'}],()=>({binding:f.b,entity,authority:'user',bytes}));
 const job=f.job({},m);reject(()=>f.s.admitJob(f.lease,job,job.ref),'E_SOURCE');
}));
test('WP02C: attempt reservation commits run, count and quota before dispatch',()=>fixture(f=>{
 const job=f.job();f.s.admitJob(f.lease,job,job.ref);const a=f.s.reserveJobAttempt(f.lease,job.ref,amount);
 const stored=f.open().readJob(f.b,job.ref);assert.equal(stored.attempts.length,1);assert.equal(stored.attempts[0].state,'reserved');
 assert.equal(stored.attempts[0].ref.run_id,a.run_id);assert.equal(sql(f,'SELECT * FROM aux_runs').length,1);
 assert.deepEqual(JSON.parse(sql(f,'SELECT counters_json FROM sessions')[0].counters_json).job_budget,{calls:1,input_tokens:8192,output_tokens:4096});
}));
test('WP02C: repeated dispatch intent and cross-attempt substitution are refused',()=>fixture(f=>{
 const {job,attempt}=begin(f);
 reject(()=>f.s.markJobAttemptDispatched(f.lease,job.ref,attempt),'E_CONFLICT');
 reject(()=>f.s.recordJobAttemptResult(f.lease,job.ref,{...attempt,attempt_id:id(99)},response()),'E_CONFLICT');
 assert.equal(f.s.readJob(f.b,job.ref).attempts.length,1);
}));
test('WP02C: quota, frozen output reserve and input limit are enforced before allocation',()=>fixture(f=>{
 const job=f.job();f.s.admitJob(f.lease,job,job.ref);
 for(const a of [{...amount,input_tokens:95905},{...amount,output_tokens:0}])reject(()=>f.s.reserveJobAttempt(f.lease,job.ref,a),'E_BUDGET');
 const a=f.s.reserveJobAttempt(f.lease,job.ref,amount);f.s.markJobAttemptDispatched(f.lease,job.ref,a);
 f.s.recordJobAttemptResult(f.lease,job.ref,a,{kind:'http_error',status:503,retry_after_ms:0,local_stopped:true});
 reject(()=>f.s.reserveJobAttempt(f.lease,job.ref,amount),'E_BUDGET');assert.equal(f.s.readJob(f.b,job.ref).attempts.length,1);
},{max_calls_per_session:1}));
test('WP02C: Retry-After and two attempts survive reopen without resetting original deadline',()=>fixture(f=>{
 const {job,attempt}=begin(f),deadline=f.s.readJob(f.b,job.ref).deadline_at;
 f.s.recordJobAttemptResult(f.lease,job.ref,attempt,{kind:'http_error',status:429,retry_after_ms:2000,local_stopped:true});
 reject(()=>f.s.reserveJobAttempt(f.lease,job.ref,amount),'E_CONFLICT');f.advance(2000);
 const second=f.s.reserveJobAttempt(f.lease,job.ref,amount);assert.equal(second.attempt_no,2);
 f.s.markJobAttemptDispatched(f.lease,job.ref,second);
 const final=f.s.recordJobAttemptResult(f.lease,job.ref,second,{kind:'http_error',status:503,retry_after_ms:0,local_stopped:true});
 assert.equal(final.status,'failed');assert.equal(final.retry,null);assert.equal(final.deadline_at,deadline);
 reject(()=>f.s.reserveJobAttempt(f.lease,job.ref,amount),'E_CONFLICT');assert.deepEqual(f.open().readJob(f.b,job.ref),final);
}));
test('WP02C: malformed response can consume repair but cannot chain a third request',()=>fixture(f=>{
 const {job,attempt}=begin(f);const result=f.s.recordJobAttemptResult(f.lease,job.ref,attempt,response({text:'{invalid'}));
 assert.equal(result.status,'running');assert.equal(result.retry.kind,'repair');
 const second=f.s.reserveJobAttempt(f.lease,job.ref,amount);f.s.markJobAttemptDispatched(f.lease,job.ref,second);
 const done=f.s.recordJobAttemptResult(f.lease,job.ref,second,response({text:'{invalid'}));assert.equal(done.status,'failed');assert.equal(done.retry,null);
}));
for(const code of [400,401,403,404])test(`WP02C: HTTP ${code} never permits retry`,()=>fixture(f=>{
 const {job,attempt}=begin(f);const done=f.s.recordJobAttemptResult(f.lease,job.ref,attempt,{kind:'http_error',status:code,retry_after_ms:0,local_stopped:true});
 assert.equal(done.status,'failed');reject(()=>f.s.reserveJobAttempt(f.lease,job.ref,amount),'E_CONFLICT');
}));
for(const finish of ['tool_call','length','cancelled','error'])test(`WP02C: finisher ${finish} overrides valid JSON`,()=>fixture(f=>{
 const {job,attempt}=begin(f);const done=f.s.recordJobAttemptResult(f.lease,job.ref,attempt,response({finish}));
 assert.equal(done.status,'failed');assert.equal(done.retry,null);assert.equal(done.proposal,null);
}));
test('WP02C: valid proposal becomes ready without publishing a chapter or View',()=>fixture(f=>{
 const {job,attempt}=begin(f),done=f.s.recordJobAttemptResult(f.lease,job.ref,attempt,response());
 assert.equal(done.status,'ready');assert.equal(done.attempts[0].state,'completed');assert.equal(done.attempts[0].local_stopped,true);
 assert.deepEqual(done.proposal,JSON.parse(response().text));assert.equal(f.s.readSession(f.b).view_revision,0);
 assert.equal(sql(f,'SELECT * FROM chapters').length,0);assert.equal(sql(f,'SELECT * FROM operations').length,0);
}));
for(const patch of [{text:'{"schema_version":1,"action":"noop","reason":"none"}'},{candidate_input_tokens:4999}])test('WP02C: noop or insufficient numeric gain rejects without publication',()=>fixture(f=>{
 const {job,attempt}=begin(f),done=f.s.recordJobAttemptResult(f.lease,job.ref,attempt,response(patch));
 assert.equal(done.status,'rejected');assert.equal(done.error_code,'E_NO_GAIN');
}));
test('WP02C: source mutation after dispatch cannot enter ready',()=>fixture(f=>{
 const {job,attempt}=begin(f);exec(f,'UPDATE sources SET inline_bytes=zeroblob(length(inline_bytes))');
 const done=f.s.recordJobAttemptResult(f.lease,job.ref,attempt,response());assert.equal(done.status,'rejected');assert.equal(done.error_code,'E_SOURCE');assert.equal(done.proposal,null);
}));
test('WP02C: local stop is not inferred from response, TTL or terminal status',()=>fixture(f=>{
 const {job,attempt}=begin(f),done=f.s.recordJobAttemptResult(f.lease,job.ref,attempt,response({local_stopped:false}));
 assert.equal(done.status,'failed');assert.equal(done.attempts[0].local_state,'quarantine');assert.equal(done.attempts[0].remote_state,'unknown');
 const stopped=f.s.confirmJobAttemptStopped(f.lease,job.ref,attempt);assert.equal(stopped.attempts[0].local_state,'stopped');assert.equal(stopped.attempts[0].remote_state,'unknown');
}));
test('WP02C: late cancelled callback cannot rewrite result or release the uncertain run',()=>fixture(f=>{
 const {job,attempt}=begin(f),cancelled=f.s.cancelJob(f.lease,job.ref);
 assert.deepEqual(f.s.recordJobAttemptResult(f.lease,job.ref,attempt,response()),cancelled);
 assert.equal(cancelled.attempts[0].state,'unknown');assert.equal(cancelled.attempts[0].local_stopped,false);
 assert.deepEqual(f.s.cancelJob(f.lease,job.ref),cancelled);
}));
test('WP02C: cancelling reserved work records stop but retains quota',()=>fixture(f=>{
 const job=f.job();f.s.admitJob(f.lease,job,job.ref);const attempt=f.s.reserveJobAttempt(f.lease,job.ref,amount);
 const cancelled=f.s.cancelJob(f.lease,job.ref);assert.equal(cancelled.attempts[0].state,'cancelled');assert.equal(cancelled.attempts[0].local_stopped,true);
 reject(()=>f.s.markJobAttemptDispatched(f.lease,job.ref,attempt),'E_CONFLICT');
 assert.equal(JSON.parse(sql(f,'SELECT counters_json FROM sessions')[0].counters_json).job_budget.calls,1);
}));
test('WP02C: old owner cannot write or falsely confirm a stopped orphan',()=>fixture(f=>{
 const {job,attempt}=begin(f);f.advance(OWNER_LEASE_MS);const other=f.open(),lease=other.acquireLease(f.b);
 reject(()=>f.s.recordJobAttemptResult(f.lease,job.ref,attempt,response()),'E_OWNER');
 const [recovered]=other.recoverJobs(lease);assert.equal(recovered.status,'failed');assert.equal(recovered.error_code,'E_OWNER');
 assert.equal(recovered.attempts[0].state,'unknown');assert.equal(recovered.attempts[0].local_state,'quarantine');
 reject(()=>other.confirmJobAttemptStopped(lease,job.ref,attempt),'E_OWNER');assert.deepEqual(other.recoverJobs(lease),[recovered]);
}));
test('WP02C: explicit recovery terminates expired work; open and reads have no replay effects',()=>fixture(f=>{
 const {job,attempt}=begin(f);f.advance(1000);f.renew();
 assert.equal(f.open().readJob(f.b,job.ref).status,'running');
 const [done]=f.s.recoverJobs(f.lease);assert.equal(done.status,'failed');assert.equal(done.error_code,'E_TIMEOUT');
 assert.equal(done.attempts[0].ref.attempt_id,attempt.attempt_id);assert.equal(done.attempts.length,1);
},{job_timeout_ms:1000}));
test('WP02C: cancelled queued and recovered ready jobs release only already-stopped slots',()=>fixture(f=>{
 const queued=f.job();f.s.admitJob(f.lease,queued,queued.ref);f.s.cancelJob(f.lease,queued.ref);
 const {job,attempt}=begin(f);f.s.recordJobAttemptResult(f.lease,job.ref,attempt,response());
 f.advance(OWNER_LEASE_MS);const other=f.open(),lease=other.acquireLease(f.b);const [done]=other.recoverJobs(lease);
 assert.equal(done.status,'cancelled');assert.equal(done.attempts[0].local_stopped,true);assert.equal(done.proposal.action,'replace');
}));
test('WP02C: reservation failure rolls back run, count and quota atomically',()=>fixture(f=>{
 const job=f.job();f.s.admitJob(f.lease,job,job.ref);const before=sql(f,'SELECT counters_json FROM sessions')[0];
 exec(f,"CREATE TRIGGER fixture_fail BEFORE INSERT ON attempts BEGIN SELECT RAISE(ABORT,'test-private'); END");
 reject(()=>f.s.reserveJobAttempt(f.lease,job.ref,amount),'E_STORAGE');
 assert.equal(sql(f,'SELECT * FROM aux_runs').length,0);assert.equal(sql(f,'SELECT * FROM attempts').length,0);
 assert.equal(f.s.readJob(f.b,job.ref).status,'queued');assert.deepEqual(sql(f,'SELECT counters_json FROM sessions')[0],before);
 exec(f,'DROP TRIGGER fixture_fail');assert.equal(f.s.reserveJobAttempt(f.lease,job.ref,amount).attempt_no,1);
}));
test('WP02C: owner expiring during admission rolls back job and clock',()=>fixture(f=>{
 const job=f.job(),prepare=DatabaseSync.prototype.prepare,before=sql(f,"SELECT value FROM meta WHERE key='clock_high_water_ms'")[0];let hit=false;
 DatabaseSync.prototype.prepare=function(query){if(query.includes('INSERT INTO jobs')){hit=true;f.advance(OWNER_LEASE_MS);}return prepare.call(this,query);};
 try{reject(()=>f.s.admitJob(f.lease,job,job.ref),'E_OWNER');}finally{DatabaseSync.prototype.prepare=prepare;}
 assert.equal(hit,true);assert.equal(sql(f,'SELECT * FROM jobs').length,0);assert.deepEqual(sql(f,"SELECT value FROM meta WHERE key='clock_high_water_ms'")[0],before);
}));
test('WP02C: tombstone refuses all job methods without reactivation',()=>fixture(f=>{
 const {job,attempt}=begin(f);sql(f,'INSERT INTO tombstones VALUES (?,?,?)',f.b.session_key,f.b.incarnation,'synthetic');
 for(const run of [()=>f.s.readJob(f.b,job.ref),()=>f.s.reserveJobAttempt(f.lease,job.ref,amount),()=>f.s.recordJobAttemptResult(f.lease,job.ref,attempt,response()),()=>f.s.recoverJobs(f.lease)])reject(run,'E_SCOPE');
}));

test('WP02C review: ready proposal returned by storage is deeply immutable',()=>fixture(f=>{
 const {job,attempt}=begin(f);f.s.recordJobAttemptResult(f.lease,job.ref,attempt,response());
 const read=f.s.readJob(f.b,job.ref);assert.ok(Object.isFrozen(read.proposal));assert.ok(Object.isFrozen(read.proposal.outcome));
 assert.throws(()=>read.proposal.outcome.push({text:'invented',sources:[1]}),TypeError);
}));
test('WP02C review: blank output is terminal no-gain, not a repair opportunity',()=>fixture(f=>{
 const {job,attempt}=begin(f);const done=f.s.recordJobAttemptResult(f.lease,job.ref,attempt,response({text:' \r\n '}));
 assert.equal(done.status,'rejected');assert.equal(done.error_code,'E_NO_GAIN');assert.equal(done.retry,null);
}));
test('WP02C review: malformed persisted source is not repaired by another model call',()=>fixture(f=>{
 const {job,attempt}=begin(f);exec(f,"UPDATE sources SET native_refs_json='[]'");
 const done=f.s.recordJobAttemptResult(f.lease,job.ref,attempt,response());
 assert.equal(done.status,'rejected');assert.equal(done.error_code,'E_SOURCE');assert.equal(done.retry,null);
}));
test('WP02C review: stored proposal corruption does not survive a plain diagnostic read',()=>fixture(f=>{
 const {job,attempt}=begin(f);f.s.recordJobAttemptResult(f.lease,job.ref,attempt,response());
 const value=JSON.parse(sql(f,'SELECT proposal_json FROM jobs')[0].proposal_json);
 if(value.value)value.value.title='different';else value.title='different';
 sql(f,'UPDATE jobs SET proposal_json=?',JSON.stringify(value));reject(()=>f.s.readJob(f.b,job.ref),'E_STORAGE');
}));
test('WP02C review: a malformed source finisher cannot leave a ready job under changed policy',()=>fixture(f=>{
 const {job,attempt}=begin(f);exec(f,'UPDATE sessions SET policy_revision=1;UPDATE views SET policy_revision=1');
 reject(()=>f.s.recordJobAttemptResult(f.lease,job.ref,attempt,response()),'E_CONFLICT');
 assert.equal(f.s.readJob(f.b,job.ref).status,'running');f.s.cancelJob(f.lease,job.ref);assert.equal(f.s.readJob(f.b,job.ref).status,'cancelled');
}));

// Regressions for the diagnostic/data boundary: no transport or user databases.
test('WP02C review: proposal checksum is bound to the admitted generation',()=>fixture(f=>{
 const first=begin(f);f.s.recordJobAttemptResult(f.lease,first.job.ref,first.attempt,response());
 const saved=sql(f,'SELECT proposal_json FROM jobs WHERE job_id=?',first.job.ref.job_id)[0].proposal_json;
 f.s.cancelJob(f.lease,first.job.ref);const second=begin(f);
 f.s.recordJobAttemptResult(f.lease,second.job.ref,second.attempt,response());
 sql(f,'UPDATE jobs SET proposal_json=? WHERE job_id=?',saved,second.job.ref.job_id);
 reject(()=>f.s.readJob(f.b,second.job.ref),'E_STORAGE');
}));
test('WP02C review: consistent checksum never substitutes for proposal schema validation',()=>fixture(f=>{
 const {job,attempt}=begin(f);f.s.recordJobAttemptResult(f.lease,job.ref,attempt,response());
 const envelope=JSON.parse(sql(f,'SELECT proposal_json FROM jobs')[0].proposal_json);
 envelope.value.outcome[0].sources=[999];envelope.digest=hashPayload({ref:job.ref,value:envelope.value});
 sql(f,'UPDATE jobs SET proposal_json=?',JSON.stringify(envelope));
 reject(()=>f.s.readJob(f.b,job.ref),'E_STORAGE');
}));
test('WP02C review: diagnostic read authenticates proposal data without reattesting source bytes',()=>fixture(f=>{
 const {job,attempt}=begin(f);const done=f.s.recordJobAttemptResult(f.lease,job.ref,attempt,response());
 exec(f,'UPDATE sources SET inline_bytes=zeroblob(length(inline_bytes))');
 assert.deepEqual(f.open().readJob(f.b,job.ref).proposal,done.proposal);
 reject(()=>f.s.readSource(f.b,f.source.ref),'E_SOURCE');
 assert.equal(sql(f,'SELECT * FROM attempts').length,1);
}));
test('WP02C review: blank noncomplete response obeys the transport finisher',()=>fixture(f=>{
 const {job,attempt}=begin(f);const done=f.s.recordJobAttemptResult(f.lease,job.ref,attempt,response({text:' ',finish:'tool_call'}));
 assert.equal(done.status,'failed');assert.equal(done.error_code,'E_TOOL');assert.equal(done.retry,null);
}));
test('WP02C review: source failure wins over malformed response and cannot reserve repair',()=>fixture(f=>{
 const {job,attempt}=begin(f);exec(f,"UPDATE sources SET native_refs_json='[]'");
 const done=f.s.recordJobAttemptResult(f.lease,job.ref,attempt,response({text:'{bad'}));
 assert.equal(done.status,'rejected');assert.equal(done.error_code,'E_SOURCE');assert.equal(done.retry,null);
 reject(()=>f.s.reserveJobAttempt(f.lease,job.ref,amount),'E_CONFLICT');
 assert.equal(sql(f,'SELECT * FROM attempts').length,1);
}));
test('WP02C review: diagnostic ready requires a completed stopped attempt',()=>fixture(f=>{
 const {job,attempt}=begin(f);f.s.recordJobAttemptResult(f.lease,job.ref,attempt,response());
 exec(f,"UPDATE attempts SET state='failed'");
 reject(()=>f.s.readJob(f.b,job.ref),'E_STORAGE');
}));
test('WP02C review: terminal attempt cannot retain a running local state',()=>fixture(f=>{
 const {job,attempt}=begin(f);f.s.recordJobAttemptResult(f.lease,job.ref,attempt,{kind:'http_error',status:400,retry_after_ms:0,local_stopped:true});
 exec(f,"UPDATE aux_runs SET state='running',local_stopped=0");
 reject(()=>f.s.readJob(f.b,job.ref),'E_STORAGE');
}));
