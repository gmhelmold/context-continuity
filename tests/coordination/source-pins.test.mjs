import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { WorkspaceCoordinator, MAX_ACTIVE_SOURCE_PINS } from '../../packages/storage/src/index.ts';
import { createSessionBinding } from '../../packages/core/src/index.ts';
import { pinFixture, workspace, id, sql, metadataKey } from './source-pin-fixtures.mjs';
import { pythonTry } from './coordinator-fixtures.mjs';
const fails = (fn, code) => assert.throws(fn, e => e.code === code);

for (const kind of ['read_pin','export_pin']) test(`Source pins: ${kind} binds exact source and owner without copying content`, () => pinFixture(f => {
  const before=sql(f,'SELECT * FROM sources'), pin=f.coordinator.pinSource(f.b,{...f.request,kind});
  assert.equal(pin.kind,kind); assert.equal(pin.owner_id,f.coordinator.owner_id);
  assert.equal(pin.process_instance,f.coordinator.process_instance); assert.deepEqual(pin.source_ref,f.source.ref);
  assert.deepEqual(pin.binding,f.b); assert.equal(pin.state,'active');
  assert.ok(Object.isFrozen(pin)); assert.ok(Object.isFrozen(pin.binding.scope)); assert.ok(Object.isFrozen(pin.source_ref));
  const row=sql(f,'SELECT * FROM storage_reservations')[0]; assert.equal(row.size_bytes,0); assert.equal(row.blob_digest,null);
  assert.equal(row.staging_path_key,null); assert.deepEqual(sql(f,'SELECT * FROM sources'),before);
  assert.equal(pythonTry(join(f.directory,'owners',pin.owner_id+'.lock')),'busy');
  assert.equal(pythonTry(join(f.directory,'workspace.lock')),'acquired');
}));
test('Source pins: exact admission replay keeps one reservation and timestamp',()=>pinFixture(f=>{
  const first=f.coordinator.pinSource(f.b,f.request), second=f.coordinator.pinSource(f.b,f.request);
  assert.deepEqual(first,second); assert.equal(sql(f,'SELECT count(*) AS n FROM storage_reservations')[0].n,1);
}));
test('Source pins: release is idempotent but its identifier cannot be resurrected',()=>pinFixture(f=>{
  f.coordinator.pinSource(f.b,f.request);
  assert.equal(f.coordinator.releaseSourcePin(f.b,f.request.reservation_id),true);
  assert.equal(f.coordinator.releaseSourcePin(f.b,f.request.reservation_id),false);
  assert.equal(f.coordinator.readSourcePin(f.b,f.request.reservation_id).state,'released');
  assert.equal(sql(f,'SELECT count(*) AS n FROM storage_reservations')[0].n,0);
  fails(()=>f.coordinator.pinSource(f.b,f.request),'E_CONFLICT');
}));
test('Source pins: changed operation kind or source cannot reuse an active identifier',()=>pinFixture(f=>{
  f.coordinator.pinSource(f.b,f.request);
  for(const patch of [{operation_id:id(200)},{kind:'export_pin'},{source_ref:{...f.source.ref,revision:1}}])
    fails(()=>f.coordinator.pinSource(f.b,{...f.request,...patch}),'E_CONFLICT');
  assert.equal(sql(f,'SELECT count(*) AS n FROM storage_reservations')[0].n,1);
}));
test('Source pins: another participant can inspect but cannot release or adopt a pin',()=>pinFixture(f=>{
  const p=f.coordinator.pinSource(f.b,f.request), other=WorkspaceCoordinator.open(f.directory,workspace);
  try {
    assert.deepEqual(other.readSourcePin(f.b,p.reservation_id),p);
    fails(()=>other.releaseSourcePin(f.b,p.reservation_id),'E_OWNER');
    fails(()=>other.pinSource(f.b,f.request),'E_OWNER');
  } finally { other.close(); }
  assert.equal(f.coordinator.readSourcePin(f.b,p.reservation_id).state,'active');
}));
test('Source pins: workspace and full session binding are checked before admission',()=>pinFixture(f=>{
  const foreign=createSessionBinding({...f.b.scope,workspace_id:id(9)},f.b.incarnation,0);
  fails(()=>f.coordinator.pinSource(foreign,f.request),'E_SCOPE');
  for(const binding of [createSessionBinding(f.b.scope,id(99),0),createSessionBinding(f.b.scope,f.b.incarnation,1),
    createSessionBinding({...f.b.scope,host_session_id:'absent'},f.b.incarnation,0)])
    fails(()=>f.coordinator.pinSource(binding,f.request),'E_SCOPE');
  assert.equal(sql(f,'SELECT count(*) AS n FROM storage_reservations')[0].n,0);
}));
test('Source pins: read and release reject another binding even for the same pin ID',()=>pinFixture(f=>{
  f.coordinator.pinSource(f.b,f.request);
  const foreign=createSessionBinding({...f.b.scope,host_session_id:'B'},f.b.incarnation,0);
  fails(()=>f.coordinator.readSourcePin(foreign,f.request.reservation_id),'E_SCOPE');
  fails(()=>f.coordinator.releaseSourcePin(foreign,f.request.reservation_id),'E_SCOPE');
}));
test('Source pins: tombstones prohibit new admission and exact replays',()=>pinFixture(f=>{
  f.coordinator.pinSource(f.b,f.request);
  sql(f,'INSERT INTO tombstones VALUES (?,?,?)',f.b.session_key,'all','synthetic');
  fails(()=>f.coordinator.pinSource(f.b,f.request),'E_SCOPE');
  fails(()=>f.coordinator.pinSource(f.b,{...f.request,reservation_id:id(202)}),'E_SCOPE');
  assert.equal(f.coordinator.releaseSourcePin(f.b,f.request.reservation_id),true);
}));
test('Source pins: source availability and exact digest must match at admission',()=>pinFixture(f=>{
  fails(()=>f.coordinator.pinSource(f.b,{...f.request,source_ref:{...f.source.ref,digest:'0'.repeat(64)}}),'E_SOURCE');
  sql(f,"UPDATE sources SET availability='excluded',inline_bytes=NULL WHERE source_id=?",f.source.ref.source_id);
  fails(()=>f.coordinator.pinSource(f.b,f.request),'E_SOURCE');
  assert.equal(sql(f,'SELECT count(*) AS n FROM storage_reservations')[0].n,0);
}));
test('Source pins: policy change rejects replay but cannot prevent explicit cleanup',()=>pinFixture(f=>{
  f.coordinator.pinSource(f.b,f.request);sql(f,'UPDATE sessions SET policy_revision=1');
  fails(()=>f.coordinator.pinSource(f.b,f.request),'E_CONFLICT');
  assert.equal(f.coordinator.releaseSourcePin(f.b,f.request.reservation_id),true);
}));
test('Source pins: deletion of captured source does not prevent releasing its reservation',()=>pinFixture(f=>{
  f.coordinator.pinSource(f.b,f.request);sql(f,'DELETE FROM sources');
  assert.equal(f.coordinator.readSourcePin(f.b,f.request.reservation_id).state,'active');
  assert.equal(f.coordinator.releaseSourcePin(f.b,f.request.reservation_id),true);
}));
test('Source pins: unsupported blob representation never gains an inline pin',()=>pinFixture(f=>{
  sql(f,"UPDATE sources SET inline_bytes=NULL,blob_key='synthetic-blob' WHERE source_id=?",f.source.ref.source_id);
  fails(()=>f.coordinator.pinSource(f.b,f.request),'E_SOURCE');
  assert.equal(sql(f,'SELECT count(*) AS n FROM storage_reservations')[0].n,0);
}));
test('Source pins: metadata checksum detects a changed source digest',()=>pinFixture(f=>{
  f.coordinator.pinSource(f.b,f.request);const k=metadataKey(f.request.reservation_id);
  const original=sql(f,'SELECT value FROM meta WHERE key=?',k)[0].value;
  const changed=JSON.parse(original);changed.value.source_ref.digest='0'.repeat(64);
  sql(f,'UPDATE meta SET value=? WHERE key=?',JSON.stringify(changed),k);
  fails(()=>f.coordinator.readSourcePin(f.b,f.request.reservation_id),'E_STORAGE');
  fails(()=>f.coordinator.releaseSourcePin(f.b,f.request.reservation_id),'E_STORAGE');
  sql(f,'UPDATE meta SET value=? WHERE key=?',original,k);
}));
for(const side of ['metadata','reservation'])test(`Source pins: missing ${side} refuses partial persisted state`,()=>pinFixture(f=>{
  f.coordinator.pinSource(f.b,f.request);
  if(side==='metadata')sql(f,'DELETE FROM meta WHERE key=?',metadataKey(f.request.reservation_id));
  else sql(f,'DELETE FROM storage_reservations WHERE reservation_id=?',f.request.reservation_id);
  fails(()=>f.coordinator.readSourcePin(f.b,f.request.reservation_id),'E_STORAGE');
  fails(()=>f.coordinator.releaseSourcePin(f.b,f.request.reservation_id),'E_STORAGE');
}));
test('Source pins: reservation row cannot contradict the scoped envelope',()=>pinFixture(f=>{
  f.coordinator.pinSource(f.b,f.request);sql(f,'UPDATE storage_reservations SET size_bytes=1');
  fails(()=>f.coordinator.readSourcePin(f.b,f.request.reservation_id),'E_STORAGE');
}));
test('Source pins: reservation and metadata insertion roll back together',()=>pinFixture(f=>{
  const original=DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare=function(q){
    const st=original.call(this,q);
    if(q==='INSERT INTO meta(key,value) VALUES (?,?)'){const run=st.run;st.run=function(...args){
      if(args[0]===metadataKey(f.request.reservation_id))throw Error('synthetic pin metadata failure');return run.apply(this,args);
    };}return st;
  };
  try{fails(()=>f.coordinator.pinSource(f.b,f.request),'E_STORAGE');}finally{DatabaseSync.prototype.prepare=original;}
  assert.equal(sql(f,'SELECT count(*) AS n FROM storage_reservations')[0].n,0);
  assert.equal(f.coordinator.readSourcePin(f.b,f.request.reservation_id),null);
  assert.equal(f.coordinator.pinSource(f.b,f.request).state,'active');
}));
test('Source pins: failed release metadata update restores the reservation',()=>pinFixture(f=>{
  const p=f.coordinator.pinSource(f.b,f.request),original=DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare=function(q){if(q==='UPDATE meta SET value=? WHERE key=? AND value=?')throw Error('synthetic release failure');return original.call(this,q);};
  try{fails(()=>f.coordinator.releaseSourcePin(f.b,p.reservation_id),'E_STORAGE');}finally{DatabaseSync.prototype.prepare=original;}
  assert.deepEqual(f.coordinator.readSourcePin(f.b,p.reservation_id),p);
  assert.equal(f.coordinator.releaseSourcePin(f.b,p.reservation_id),true);
}));
test('Source pins: contention prevents a write transaction and never discards the existing pin',()=>pinFixture(f=>{
  const p=f.coordinator.pinSource(f.b,f.request),other=WorkspaceCoordinator.open(f.directory,workspace);
  const original=DatabaseSync.prototype.exec;let writes=0;
  try{other.withWorkspaceLock(()=>{
    DatabaseSync.prototype.exec=function(q){if(q==='BEGIN IMMEDIATE')writes++;return original.call(this,q);};
    try{fails(()=>f.coordinator.releaseSourcePin(f.b,p.reservation_id),'E_CONFLICT');}finally{DatabaseSync.prototype.exec=original;}
  });}finally{other.close();}
  assert.equal(writes,0);assert.equal(f.coordinator.readSourcePin(f.b,p.reservation_id).state,'active');
}));
test('Source pins: unconsumed pins survive close and keep owner retirement blocked',()=>pinFixture(f=>{
  const p=f.coordinator.pinSource(f.b,f.request);fails(()=>f.coordinator.close(),'E_CAPABILITY');
  assert.equal(pythonTry(join(f.directory,'owners',p.owner_id+'.lock')),'acquired');
  const other=WorkspaceCoordinator.open(f.directory,workspace);
  try{
    assert.equal(other.readSourcePin(f.b,p.reservation_id).state,'active');
    fails(()=>other.retireOwner(p.owner_id),'E_CAPABILITY');
    fails(()=>other.releaseSourcePin(f.b,p.reservation_id),'E_OWNER');
  }finally{other.close();}
}));
test('Source pins: release never changes source bytes jobs or token reservations',()=>pinFixture(f=>{
  const before=sql(f,'SELECT * FROM sources'),counters=sql(f,'SELECT counters_json FROM sessions');
  const p=f.coordinator.pinSource(f.b,f.request);f.coordinator.releaseSourcePin(f.b,p.reservation_id);
  assert.deepEqual(sql(f,'SELECT * FROM sources'),before);assert.deepEqual(sql(f,'SELECT counters_json FROM sessions'),counters);
  for(const table of ['jobs','attempts','aux_runs','chapters','managed_files','blobs'])assert.equal(sql(f,`SELECT count(*) AS n FROM ${table}`)[0].n,0);
}));
test('Source pins: malformed requests are refused without getter execution',()=>pinFixture(f=>{
  let reads=0;const getter={...f.request};Object.defineProperty(getter,'kind',{enumerable:true,get(){reads++;return 'read_pin';}});
  for(const request of [{...f.request,extra:1},{...f.request,kind:'staging'},{...f.request,reservation_id:1},getter])
    fails(()=>f.coordinator.pinSource(f.b,request),'E_SCHEMA');
  assert.equal(reads,0);assert.equal(sql(f,'SELECT count(*) AS n FROM storage_reservations')[0].n,0);
}));
test('Source pins: active limit is inclusive and replay consumes no extra slot',()=>pinFixture(f=>{
  const db=new DatabaseSync(f.path);
  try{
    db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
    const st=db.prepare("INSERT INTO storage_reservations(reservation_id,owner_id,operation_id,kind,size_bytes,created_at) VALUES (?,?,?,'read_pin',0,'synthetic')");
    for(let n=0;n<MAX_ACTIVE_SOURCE_PINS-1;n++)st.run(id(1000+n),f.coordinator.owner_id,id(999));db.exec('COMMIT');
  }finally{db.close();}
  const p=f.coordinator.pinSource(f.b,f.request);assert.deepEqual(f.coordinator.pinSource(f.b,f.request),p);
  fails(()=>f.coordinator.pinSource(f.b,{...f.request,reservation_id:id(8000)}),'E_BUDGET');
  assert.equal(sql(f,'SELECT count(*) AS n FROM storage_reservations')[0].n,MAX_ACTIVE_SOURCE_PINS);
}));
