import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtempSync, chmodSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { SqliteSessionStore } from '../../packages/storage/src/index.ts';
import { APPLICATION_ID, SCHEMA_VERSION } from '../../packages/storage/src/sqlite-database.ts';
import { createSessionBinding, resolveConfig } from '../../packages/core/src/index.ts';
const root=fileURLToPath(new URL('../../',import.meta.url));
const id=n=>`00000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
const workspace={installation_id:id(1),workspace_id:id(2)};
const binding=createSessionBinding({...workspace,adapter_id:'scheduler-fixture',host_session_id:'A'},id(3),0);
const config=()=>resolveConfig({}, {context_window:100000,output_reserve:4096});
const digest=n=>n.toString(16).padStart(64,'0');
const input=(patch={})=>({host_epoch:0,coverage_digest:digest(1),policy_revision:0,config_digest:digest(2),eligible_tokens:100,observed_at_ms:100000,below_rearm_threshold:false,...patch});
const rearm=(patch={})=>{const {configuration=config(),...rest}=patch,value=input(rest);delete value.below_rearm_threshold;return {...value,configuration};};
const reject=(fn,code)=>assert.throws(fn,error=>error.code===code);
function fixture(fn){const directory=mkdtempSync(join(tmpdir(),'cc-scheduler-')),handles=[];let now=100000;
  const create=()=>{const s=SqliteSessionStore.create(directory,workspace,()=>now);handles.push(s);return s;};
  const open=()=>{const s=SqliteSessionStore.open(directory,workspace,()=>now);handles.push(s);return s;};
  try{return fn({directory,path:join(directory,'ledger.sqlite'),create,open,advance:n=>now+=n});}finally{for(const s of handles)s.close();rmSync(directory,{recursive:true,force:true});}}
function makeV1(directory){const path=join(directory,'ledger.sqlite'),ddl=readFileSync(join(root,'packages/storage/src/schema-v1.sql'),'utf8');
  const db=new DatabaseSync(path);db.exec(ddl);const digest=createHash('sha256').update(ddl).digest('hex');
  for(const [key,value] of Object.entries({...workspace,schema_digest:digest,clock_high_water_ms:'0'}))db.prepare('INSERT INTO meta VALUES (?,?)').run(key,value);
  db.exec(`PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=1`);db.close();chmodSync(path,0o600);return path;}
test('C-SCHED-01 migration: v1 upgrade produces v2 without scheduler rows',()=>fixture(f=>{
  const old=makeV1(f.directory),store=f.open();const db=new DatabaseSync(old);try{assert.equal(db.prepare('PRAGMA user_version').get().user_version,SCHEMA_VERSION);assert.equal(db.prepare('SELECT count(*) AS n FROM scheduler_state').get().n,0);}finally{db.close();}
  store.createSession(binding,config());assert.equal(store.readSchedulerState(binding),null);
}));
test('C-SCHED-01 migration: v2 failure rolls back DDL, metadata and version together',()=>fixture(f=>{
  makeV1(f.directory);const exec=DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec=function(sql){if(sql===`PRAGMA user_version=${SCHEMA_VERSION}`)throw Error('fixture migration failure');return exec.call(this,sql);};
  try{reject(()=>f.open(),'E_STORAGE');}finally{DatabaseSync.prototype.exec=exec;}
  const db=new DatabaseSync(f.path);try{assert.equal(db.prepare('PRAGMA user_version').get().user_version,1);assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name='scheduler_state'").get().n,0);}
  finally{db.close();}
}));
test('C-SCHED-01 migration: v1 authority is verified before upgrade',()=>fixture(f=>{
  makeV1(f.directory);const db=new DatabaseSync(f.path);db.prepare("UPDATE meta SET value='forged' WHERE key='schema_digest'").run();db.close();
  reject(()=>f.open(),'E_STORAGE');const unchanged=new DatabaseSync(f.path);try{assert.equal(unchanged.prepare('PRAGMA user_version').get().user_version,1);assert.equal(unchanged.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name='scheduler_state'").get().n,0);}
  finally{unchanged.close();}
}));
test('C-SCHED-01 observation: closed input, frozen state, primary fields and valid low-water persist',()=>fixture(f=>{
  const s=f.create();s.createSession(binding,config());const lease=s.acquireLease(binding);
  reject(()=>s.recordPrimaryObservation(lease,{...input(),extra:true}),'E_SCHEMA');
  const low=s.recordPrimaryObservation(lease,input({below_rearm_threshold:true}));assert.equal(low.armed,true);assert.deepEqual(low.low_water,{host_epoch:0,policy_revision:0,config_digest:digest(2)});assert.ok(Object.isFrozen(low));assert.ok(Object.isFrozen(low.low_water));
  f.advance(1);const next=s.recordPrimaryObservation(lease,input({eligible_tokens:101,observed_at_ms:100001}));assert.equal(next.last_observed_eligible_tokens,101);assert.equal(next.armed,true);assert.deepEqual(next.low_water,low.low_water);assert.equal(next.last_attempt,null);
}));
test('C-SCHED-01 observation: stale control, lease and backward observation roll back',()=>fixture(f=>{
  const s=f.create();s.createSession(binding,config());const lease=s.acquireLease(binding);s.recordPrimaryObservation(lease,input({below_rearm_threshold:true}));
  reject(()=>s.recordPrimaryObservation({...lease,owner_fence:lease.owner_fence+1},input({observed_at_ms:100001})),'E_OWNER');
  reject(()=>s.recordPrimaryObservation(lease,input({host_epoch:1,observed_at_ms:100001})),'E_CONFLICT');
  reject(()=>s.recordPrimaryObservation(lease,input({observed_at_ms:99999})),'E_CONFLICT');assert.equal(s.readSchedulerState(binding).last_observed_at_ms,100000);
}));
test('C-SCHED-01 observation: stale scheduler incarnation never receives primary update',()=>fixture(f=>{
  const s=f.create();s.createSession(binding,config());const lease=s.acquireLease(binding);s.recordPrimaryObservation(lease,input());
  const db=new DatabaseSync(f.path);db.prepare('UPDATE scheduler_state SET incarnation=? WHERE session_key=?').run(id(4),binding.session_key);db.close();
  reject(()=>s.recordPrimaryObservation(lease,input({observed_at_ms:100001})),'E_CONFLICT');reject(()=>s.readSchedulerState(binding),'E_CONFLICT');
}));
test('C-SCHED-01 observation: false clears stale low-water scope but never arms or records attempt',()=>fixture(f=>{
  const s=f.create();s.createSession(binding,config());const lease=s.acquireLease(binding);s.recordPrimaryObservation(lease,input({below_rearm_threshold:true}));
  f.advance(1);const result=s.recordPrimaryObservation(lease,input({config_digest:digest(3),observed_at_ms:100001}));assert.equal(result.low_water,null);assert.equal(result.armed,true);assert.equal(result.last_attempt,null);
}));
test('C-SCHED rearm: atomically records U and rearms from low-water only at T',()=>fixture(f=>{
  const s=f.create();s.createSession(binding,config());const lease=s.acquireLease(binding);
  const initial=s.observePrimaryAndRearm(lease,rearm({eligible_tokens:40000}));assert.equal(initial.reason,null);assert.equal(initial.state.low_water,null);
  f.advance(1);const low=s.observePrimaryAndRearm(lease,rearm({eligible_tokens:39999,observed_at_ms:100001}));assert.deepEqual(low.state.low_water,{host_epoch:0,policy_revision:0,config_digest:digest(2)});
  const db=new DatabaseSync(f.path);db.prepare('UPDATE scheduler_state SET armed=0 WHERE session_key=?').run(binding.session_key);db.close();
  f.advance(1);const result=s.observePrimaryAndRearm(lease,rearm({eligible_tokens:50000,observed_at_ms:100002}));assert.equal(result.reason,'low_water');assert.equal(result.state.armed,true);assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.state));assert.equal(result.state.last_attempt,null);
}));
test('C-SCHED rearm: growth needs N, inclusive cooldown, and changed last-attempt coverage',()=>fixture(f=>{
  const s=f.create();s.createSession(binding,config());const lease=s.acquireLease(binding);s.observePrimaryAndRearm(lease,rearm());
  const db=new DatabaseSync(f.path);db.prepare(`UPDATE scheduler_state SET armed=0,last_attempt_host_epoch=0,last_attempt_coverage_digest=?,last_attempt_policy_revision=0,last_attempt_config_digest=? WHERE session_key=?`).run(digest(1),digest(2),binding.session_key);db.close();
  f.advance(29999);const renewed=s.renewLease(lease);f.advance(1);const result=s.observePrimaryAndRearm(renewed,rearm({coverage_digest:digest(3),eligible_tokens:5100,observed_at_ms:130000}));assert.equal(result.reason,'growth');assert.equal(result.state.armed,true);
}));
test('C-SCHED rearm: rejects stale config and retains disarmed state without exact growth proof',()=>fixture(f=>{
  const s=f.create();s.createSession(binding,config());const lease=s.acquireLease(binding);s.observePrimaryAndRearm(lease,rearm());
  const db=new DatabaseSync(f.path);db.prepare(`UPDATE scheduler_state SET armed=0,last_attempt_host_epoch=0,last_attempt_coverage_digest=?,last_attempt_policy_revision=0,last_attempt_config_digest=? WHERE session_key=?`).run(digest(1),digest(2),binding.session_key);db.close();
  reject(()=>s.observePrimaryAndRearm(lease,rearm({configuration:resolveConfig({cooldown_ms:0},{context_window:100000,output_reserve:4096})})),'E_CONFLICT');
  f.advance(29999);const renewed=s.renewLease(lease);f.advance(1);const result=s.observePrimaryAndRearm(renewed,rearm({coverage_digest:digest(3),eligible_tokens:5099,observed_at_ms:130000}));assert.equal(result.reason,null);assert.equal(result.state.armed,false);assert.equal(result.state.last_observed_eligible_tokens,5099);
}));
test('C-SCHED rearm: growth never rearms unchanged last-attempt coverage',()=>fixture(f=>{
  const s=f.create();s.createSession(binding,config());const lease=s.acquireLease(binding);s.observePrimaryAndRearm(lease,rearm());
  const db=new DatabaseSync(f.path);db.prepare(`UPDATE scheduler_state SET armed=0,last_attempt_host_epoch=0,last_attempt_coverage_digest=?,last_attempt_policy_revision=0,last_attempt_config_digest=? WHERE session_key=?`).run(digest(1),digest(2),binding.session_key);db.close();
  f.advance(29999);const renewed=s.renewLease(lease);f.advance(1);const result=s.observePrimaryAndRearm(renewed,rearm({eligible_tokens:5100,observed_at_ms:130000}));assert.equal(result.reason,null);assert.equal(result.state.armed,false);
}));
