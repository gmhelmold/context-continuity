import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { createJobContext, assertJobContext, exportJobContext, restoreJobContext,
  parseJobContextRecord, parseJobContextRef, parseSnapshotRecord, decodeJobProposal, assertJobProposal,
  decodeProposal, verifyManifest, sealFrame, hashPayload, MAX_MISSION_BYTES } from '../../packages/core/src/index.ts';
import { citationFixture, proposal, id, binding, frameFixture } from './context-fixtures.mjs';
const copy = x => JSON.parse(JSON.stringify(x));
const reject = fn => assert.throws(fn, e => ['E_SCHEMA','E_STALE','E_SCOPE','E_SOURCE','E_TOOL','E_PROTOCOL','E_NO_GAIN'].includes(e.code));
const sha = text => createHash('sha256').update(text,'utf8').digest('hex');
function fixture(b=binding(), format='messages') {
  const c=citationFixture(b), f=frameFixture(format,b);
  const frame=sealFrame(b,f.capture,f.registry,f.body,f.layout,f.profile);
  const roots=frame.roots.map(r=>r.root_coverage[0]);
  const entities=[...c.verified.manifest.entries.map(e=>e.entity),...frame.roots.flatMap(r=>r.source_refs.map(ref=>({kind:'source',ref})))];
  const fields={view_revision:0,policy_revision:2,owner_fence:3,frame_id:frame.frame_id,
    logical_coverage:[roots[0].unit_id],root_coverage:[roots[0]],read_dependencies:entities,
    prefix_digest:hashPayload([]),coverage_digest:hashPayload([roots[0]]),config_digest:frame.config_digest,
    effective_input_digest:frame.input_digest,feedback_ids:[id(90)],work:frame.capture.work,created_at:'2026-09-18T00:00:00.000Z'};
  const mission='  Maintenance only.\r\nKeep é and 🔥 exactly.\uFEFF';
  const job=createJobContext(b,fields,c.verified,mission);
  return {...c,frame,fields,mission,job};
}
const result = f => decodeJobProposal(f.binding,f.job,f.job.ref,JSON.stringify(proposal({feedback_applied:[id(90)]})),'complete');
function rehash(r) {
  r.snapshot_digest=hashPayload(r.snapshot);r.mission_digest=sha(r.mission);
  const {context_digest,...body}=r;r.context_digest=hashPayload(body);return r;
}
for(const format of ['messages','contents']) test(`T06.contract Job: ${format} frame identity is retained with the frozen snapshot`,()=>{
  const f=fixture(binding(),format),r=f.job.record;
  assert.equal(r.snapshot.frame_id,f.frame.frame_id);assert.equal(r.snapshot.effective_input_digest,f.frame.input_digest);
  assert.equal(r.snapshot.config_digest,f.frame.config_digest);assert.deepEqual(r.snapshot.work,f.frame.capture.work);
  assert.equal(r.mission,f.mission);assert.equal(r.mission_digest,sha(f.mission));
  assert.equal(r.snapshot_digest,hashPayload(r.snapshot));
  assert.deepEqual(r.snapshot.feedback_ids,[id(90)]);assert.equal(assertJobContext(f.binding,f.job,f.job.ref),f.job);
  assert.equal(assertJobProposal(f.binding,f.job,f.job.ref,result(f)).ref,f.job.ref);
  assert.deepEqual(parseSnapshotRecord(r.snapshot),r.snapshot);
});
test('T02.contract Job: same manifest never makes different generations interchangeable',()=>{
  const f=fixture(), second=createJobContext(f.binding,{...f.fields,feedback_ids:[id(91)]},f.verified,f.mission);
  assert.notEqual(f.job.ref.job_id,second.ref.job_id);assert.notEqual(f.job.ref.snapshot_id,second.ref.snapshot_id);
  assert.equal(f.job.record.snapshot.manifest_id,second.record.snapshot.manifest_id);
  reject(()=>assertJobContext(f.binding,second,f.job.ref));
  reject(()=>assertJobProposal(f.binding,second,second.ref,result(f)));
  reject(()=>decodeJobProposal(f.binding,second,second.ref,JSON.stringify(proposal({feedback_applied:[id(90)]})),'complete'));
  const valid=decodeJobProposal(f.binding,second,second.ref,JSON.stringify(proposal({feedback_applied:[id(91)]})),'complete');
  assert.equal(valid.validated.proposal.feedback_applied[0],id(91));
});
for(const key of ['job_id','snapshot_id','snapshot_digest','context_digest']) test(`T02.contract Job: expected ${key} cannot be substituted`,()=>{
  const f=fixture(),expected={...f.job.ref,[key]:key.endsWith('_id')?id(300):'a'.repeat(64)};
  reject(()=>assertJobContext(f.binding,f.job,expected));
  assert.throws(()=>decodeJobProposal(f.binding,f.job,expected,'not JSON','error'),e=>e.code==='E_STALE');
});
test('T02.contract Job: binding remains mandatory during decoding, export and restoration',()=>{
  const f=fixture();
  for(const wrong of [binding('other'),binding('host-A',id(99)),{...f.binding,incarnation:id(99)},{...f.binding,host_epoch:1}]) {
    reject(()=>assertJobContext(wrong,f.job,f.job.ref));reject(()=>exportJobContext(wrong,f.job,f.job.ref));
    reject(()=>restoreJobContext(wrong,f.job.record,f.verified,f.job.ref));
    reject(()=>decodeJobProposal(wrong,f.job,f.job.ref,JSON.stringify(proposal()),'complete'));
    reject(()=>createJobContext(wrong,f.fields,f.verified,f.mission));
  }
});
test('T06.contract Job: all input aliases are copied deeply without retaining mutable data',()=>{
  const f=fixture(),r=f.job.record;
  f.fields.feedback_ids.push(id(91));f.fields.work={task_id:'other',phase_id:null};f.fields.root_coverage[0]={...f.fields.root_coverage[0],revision:10};
  assert.deepEqual(r.snapshot.feedback_ids,[id(90)]);assert.notEqual(r.snapshot.work.task_id,'other');
  for(const value of [f.job,f.job.ref,r,r.snapshot,r.snapshot.work,r.snapshot.read_dependencies,r.snapshot.root_coverage,r.manifest.entries,r.snapshot.root_coverage[0]]) assert.ok(Object.isFrozen(value));
  assert.throws(()=>{r.snapshot.feedback_ids.push(id(91));},TypeError);
});
test('T06.contract Job: parser output and serialized handles cannot acquire execution identity',()=>{
  const f=fixture(),record=parseJobContextRecord(copy(f.job.record));
  assert.deepEqual(record,f.job.record);assert.equal(exportJobContext(f.binding,f.job,f.job.ref),f.job.record);
  for(const value of [record,copy(f.job),{...f.job},null]) reject(()=>assertJobContext(f.binding,value,f.job.ref));
  const plain=decodeProposal(JSON.stringify(proposal()),'complete',f.binding,f.verified);
  reject(()=>assertJobProposal(f.binding,f.job,f.job.ref,plain));
  reject(()=>assertJobProposal(f.binding,f.job,f.job.ref,copy(result(f))));
});
test('T06.contract Job: same generation permits pure repeated validation without creating attempts',()=>{
  const f=fixture(),a=result(f),b=result(f);
  assert.equal(a.ref,b.ref);assert.equal(a.validated.proposal_digest,b.validated.proposal_digest);
  assert.equal('attempts' in f.job.record,false);assert.equal('status' in f.job.record,false);
  const noop=decodeJobProposal(f.binding,f.job,f.job.ref,'{"schema_version":1,"action":"noop","reason":"nothing removable"}','complete');
  assert.equal(noop.validated.proposal.action,'noop');
  for(const finish of ['length','tool_call','error','cancelled'])reject(()=>decodeJobProposal(f.binding,f.job,f.job.ref,JSON.stringify(proposal()),finish));
});
test('T37.contract Job: job IDs and scope cannot be injected through snapshot fields or model output',()=>{
  const f=fixture();
  for(const key of ['job_id','snapshot_id','binding','session_key','manifest_id','manifest_digest','host_epoch','incarnation','dispatch']) {
    reject(()=>createJobContext(f.binding,{...f.fields,[key]:id(900)},f.verified,f.mission));
    reject(()=>decodeJobProposal(f.binding,f.job,f.job.ref,JSON.stringify(proposal({[key]:id(900)})),'complete'));
  }
});
test('T06.contract Job: missing and contradictory dependencies cannot hide received material',()=>{
  const f=fixture();
  for(let i=0;i<f.verified.manifest.entries.length;i++) {
    const key=hashPayload(f.verified.manifest.entries[i].entity);
    reject(()=>createJobContext(f.binding,{...f.fields,read_dependencies:f.fields.read_dependencies.filter(e=>hashPayload(e)!==key)},f.verified,f.mission));
  }
  const e=f.fields.read_dependencies[0];
  reject(()=>createJobContext(f.binding,{...f.fields,read_dependencies:[...f.fields.read_dependencies,e]},f.verified,f.mission));
  reject(()=>createJobContext(f.binding,{...f.fields,read_dependencies:[...f.fields.read_dependencies,{...e,ref:{...e.ref,digest:'a'.repeat(64)}}]},f.verified,f.mission));
  // Non-cited tail dependencies remain available to future invalidation, not discarded.
  assert.ok(f.job.record.snapshot.read_dependencies.length>f.verified.manifest.entries.length);
});
test('T37.contract Job: coverage is ordered, nonempty and unique without text-based merging',()=>{
  const f=fixture();
  for(const patch of [{logical_coverage:[]},{root_coverage:[]},{logical_coverage:[id(1),id(1)]},{root_coverage:[...f.fields.root_coverage,...f.fields.root_coverage]}]) reject(()=>createJobContext(f.binding,{...f.fields,...patch},f.verified,f.mission));
  const fields={...f.fields,logical_coverage:f.frame.roots.map(r=>r.unit_id),root_coverage:f.frame.roots.map(r=>r.root_coverage[0])};
  const j=createJobContext(f.binding,fields,f.verified,f.mission);
  assert.deepEqual(j.record.snapshot.logical_coverage,fields.logical_coverage);
});
test('T37.contract Job: calendar, Unicode and finite controls are validated',()=>{
  const f=fixture();
  for(const created_at of ['2026-02-30T00:00:00.000Z','2026-09-18','2026-09-18T00:00:00Z','2026-09-18T00:00:00.000+00:00','invalid']) reject(()=>createJobContext(f.binding,{...f.fields,created_at},f.verified,f.mission));
  for(const value of [-1,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1])for(const key of ['owner_fence','view_revision','policy_revision']) reject(()=>createJobContext(f.binding,{...f.fields,[key]:value},f.verified,f.mission));
  reject(()=>createJobContext(f.binding,{...f.fields,work:{task_id:'\ud800',phase_id:null}},f.verified,f.mission));
  assert.equal(createJobContext(f.binding,{...f.fields,created_at:'2024-02-29T00:00:00.000Z'},f.verified,f.mission).record.snapshot.created_at,'2024-02-29T00:00:00.000Z');
});
test('T37.contract Job: mission byte budget is exact and whitespace is not rewritten',()=>{
  const f=fixture(),mission='é'.repeat(MAX_MISSION_BYTES/2);
  assert.equal(createJobContext(f.binding,f.fields,f.verified,mission).record.mission,mission);
  for(const value of [mission+'x','', ' \r\n ', '\ud800',null])reject(()=>createJobContext(f.binding,f.fields,f.verified,value));
});
test('T37.contract Job: hidden fields and accessors are rejected without invocation',()=>{
  const f=fixture();let called=false;
  const fields={...f.fields};Object.defineProperty(fields,'work',{enumerable:true,get(){called=true;return f.fields.work;}});
  reject(()=>createJobContext(f.binding,fields,f.verified,f.mission));assert.equal(called,false);
  const sparse=[];sparse.length=1;reject(()=>createJobContext(f.binding,{...f.fields,feedback_ids:sparse},f.verified,f.mission));
  const a=[id(90)];a[Symbol('ignored')]=true;reject(()=>createJobContext(f.binding,{...f.fields,feedback_ids:a},f.verified,f.mission));
  reject(()=>createJobContext(f.binding,{...f.fields,feedback_ids:Array.from({length:33},(_,i)=>id(100+i))},f.verified,f.mission));
});
test('T06.contract Job: changed snapshot, mission and manifest hashes reject persisted data',()=>{
  const f=fixture();
  for(const mutate of [r=>r.snapshot.owner_fence++,r=>r.mission+='x',r=>r.manifest.entries[0].locator='changed',r=>r.context_digest='a'.repeat(64),r=>r.job_id=id(100)]) {
    const r=copy(f.job.record);mutate(r);reject(()=>parseJobContextRecord(r));
  }
});
for(const key of ['frame_id','config_digest','effective_input_digest','prefix_digest','coverage_digest','policy_revision','owner_fence','view_revision','feedback_ids','work','created_at']) test(`T06.contract Job: recalculated ${key} cannot replace the admitted snapshot`,()=>{
  const f=fixture(),r=copy(f.job.record);
  r.snapshot[key]=key.endsWith('_digest')?'a'.repeat(64):key==='frame_id'?id(70):key==='feedback_ids'?[id(91)]:key==='work'?{task_id:'new',phase_id:null}:key==='created_at'?'2026-09-19T00:00:00.000Z':99;
  rehash(r);parseJobContextRecord(r);reject(()=>restoreJobContext(f.binding,r,f.verified,f.job.ref));
});
test('T06.contract Job: restore requires externally expected identity and newly verified manifest',()=>{
  const f=fixture(),r=copy(f.job.record);
  reject(()=>restoreJobContext(f.binding,r,r.manifest,f.job.ref));
  reject(()=>restoreJobContext(f.binding,r,citationFixture(f.binding).verified,f.job.ref));
  const verified=verifyManifest(r.manifest,f.binding,f.resolver);
  const restored=restoreJobContext(f.binding,r,verified,f.job.ref);
  assert.deepEqual(restored.ref,f.job.ref);assert.notEqual(restored,f.job);
  assert.equal(assertJobProposal(f.binding,restored,f.job.ref,result(f)).ref,f.job.ref);
  f.records[0].bytes[0]=0x58;reject(()=>verifyManifest(r.manifest,f.binding,f.resolver));
});
test('T37.contract Job: 200 deterministic bad expectations never reuse a callback',()=>{
  const f=fixture();
  for(let n=0;n<200;n++)reject(()=>decodeJobProposal(f.binding,f.job,{...f.job.ref,job_id:id(n+1000)},JSON.stringify(proposal()),'complete'));
  for(const bad of [null,[],{},new Date(),{...f.job.ref,extra:true}])reject(()=>parseJobContextRef(bad));
});
test('T06.contract Job: fresh process revalidates records without recreating a generation',()=>{
  const f=fixture(),module=fileURLToPath(new URL('../../packages/core/src/index.ts',import.meta.url));
  const script=`import{readFileSync}from'node:fs';import{verifyManifest,restoreJobContext,decodeJobProposal}from ${JSON.stringify(module)};
const x=JSON.parse(readFileSync(0,'utf8'));const materials=x.materials.map(r=>({...r,bytes:r.bytes===null?null:Buffer.from(r.bytes,'base64')}));
const manifest=verifyManifest(x.record.manifest,x.record.binding,e=>materials.find(r=>JSON.stringify(r.entity)===JSON.stringify(e))??null);
const job=restoreJobContext(x.record.binding,x.record,manifest,x.ref);
const p=decodeJobProposal(x.record.binding,job,x.ref,x.response,'complete');console.log(JSON.stringify({ref:job.ref,digest:p.validated.proposal_digest}));`;
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const run=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',script],{env,encoding:'utf8',timeout:10000,maxBuffer:1024*1024,
    input:JSON.stringify({record:f.job.record,ref:f.job.ref,materials:f.records.map(r=>({...r,bytes:r.bytes?.toString('base64')??null})),response:JSON.stringify(proposal({feedback_applied:[id(90)]}))})});
  assert.equal(run.error,undefined);assert.equal(run.status,0,run.stderr);
  const loaded=JSON.parse(run.stdout);assert.deepEqual(loaded.ref,f.job.ref);assert.equal(loaded.digest,result(f).validated.proposal_digest);
});

test('T06.contract Job: declared feedback cannot augment the frozen delivery batch',()=>{
  const f=fixture();
  reject(()=>decodeJobProposal(f.binding,f.job,f.job.ref,JSON.stringify(proposal({feedback_applied:[id(91)]})),'complete'));
  assert.equal(result(f).validated.proposal.feedback_applied[0],id(90));
});
test('T06.contract Job: self-consistent records still require internally matching manifest and scope',()=>{
  const f=fixture();
  for(const update of [r=>r.snapshot.manifest_id=id(123),r=>r.snapshot.manifest_digest='a'.repeat(64),r=>r.snapshot.session_key='a'.repeat(64),r=>r.snapshot.incarnation=id(123),r=>r.snapshot.host_epoch++]) {
    const r=copy(f.job.record);update(r);rehash(r);reject(()=>parseJobContextRecord(r));
  }
  reject(()=>createJobContext(f.binding,f.fields,f.verified.manifest,f.mission));
  for(const update of [
    r=>r.snapshot.logical_coverage=[id(1001)],
    r=>r.snapshot.root_coverage[0].revision++,
    r=>r.snapshot.read_dependencies.push({kind:'source',ref:{source_id:id(1001),revision:0,digest:'a'.repeat(64)}}),
    r=>r.mission+=' changed suffix',
  ]) {
    const r=copy(f.job.record);update(r);rehash(r);parseJobContextRecord(r);
    reject(()=>restoreJobContext(f.binding,r,f.verified,f.job.ref));
  }
  const second=createJobContext(f.binding,{...f.fields,feedback_ids:[id(90),id(91)]},f.verified,f.mission);
  const reordered=copy(second.record);reordered.snapshot.feedback_ids.reverse();rehash(reordered);
  parseJobContextRecord(reordered);reject(()=>restoreJobContext(f.binding,reordered,f.verified,second.ref));
});
