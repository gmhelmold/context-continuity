/** Process/reopen proof for synthetic scheduler-state storage only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { APPLICATION_ID, SCHEMA_VERSION } from '../../packages/storage/src/sqlite-database.ts';
import { SqliteSessionStore } from '../../packages/storage/src/index.ts';
import { createSessionBinding, resolveConfig } from '../../packages/core/src/index.ts';

const root=fileURLToPath(new URL('../../',import.meta.url));
const storage=new URL('../../packages/storage/src/index.ts',import.meta.url).href;
const id=n=>`00000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
const workspace={installation_id:id(21),workspace_id:id(22)};
const binding=createSessionBinding({...workspace,adapter_id:'scheduler-process-fixture',host_session_id:'A'},id(23),0);
const config=()=>resolveConfig({}, {context_window:100000,output_reserve:4096});
const digest=n=>n.toString(16).padStart(64,'0');
const observation={host_epoch:0,coverage_digest:digest(1),policy_revision:0,config_digest:digest(2),eligible_tokens:100,observed_at_ms:100000,below_rearm_threshold:true};
function fixture(fn){const directory=mkdtempSync(join(tmpdir(),'cc-scheduler-process-'));try{return fn({directory,path:join(directory,'ledger.sqlite')});}finally{rmSync(directory,{recursive:true,force:true});}}
function makeV1(directory){const path=join(directory,'ledger.sqlite'),ddl=readFileSync(join(root,'packages/storage/src/schema-v1.sql'),'utf8');
  const db=new DatabaseSync(path);db.exec(ddl);const schema_digest=createHash('sha256').update(ddl).digest('hex');
  for(const [key,value] of Object.entries({...workspace,schema_digest,clock_high_water_ms:'0'}))db.prepare('INSERT INTO meta VALUES (?,?)').run(key,value);
  db.exec(`PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=1`);db.close();chmodSync(path,0o600);}
function child(program){const result=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',program],{encoding:'utf8',timeout:30000});
  assert.equal(result.error,undefined,result.stderr);assert.equal(result.signal,null,result.stderr);return result;}
function stateProgram(directory, action){return `
  import {SqliteSessionStore} from ${JSON.stringify(storage)};
  const workspace=${JSON.stringify(workspace)},binding=${JSON.stringify(binding)},observation=${JSON.stringify(observation)};
  const store=SqliteSessionStore.open(${JSON.stringify(directory)},workspace,()=>100000);
  ${action}
`;}

test('C-SCHED-01 process: v1 migration commits once and survives independent reopen',()=>fixture(f=>{
  makeV1(f.directory);
  const first=child(stateProgram(f.directory,"console.log(JSON.stringify(store.diagnostics()));store.close();"));
  assert.equal(first.status,0,first.stderr);assert.equal(JSON.parse(first.stdout).sqlite_version.length>0,true);
  const before=new DatabaseSync(f.path);let snapshot;try{snapshot={version:before.prepare('PRAGMA user_version').get().user_version,digest:before.prepare("SELECT value FROM meta WHERE key='schema_digest'").get().value,rows:before.prepare('SELECT count(*) AS n FROM scheduler_state').get().n};}finally{before.close();}
  assert.deepEqual(snapshot,{version:SCHEMA_VERSION,digest:createHash('sha256').update(readFileSync(join(root,'packages/storage/src/schema-v1.sql'),'utf8')+readFileSync(join(root,'packages/storage/src/schema-v2.sql'),'utf8')).digest('hex'),rows:0});
  const initialized=SqliteSessionStore.open(f.directory,workspace,()=>100000);initialized.createSession(binding,config());initialized.close();
  const second=child(stateProgram(f.directory,"console.log(store.readSchedulerState(binding));store.close();"));
  assert.equal(second.status,0,second.stderr);assert.equal(second.stdout.trim(),'null');
  const after=new DatabaseSync(f.path);try{assert.deepEqual({version:after.prepare('PRAGMA user_version').get().user_version,digest:after.prepare("SELECT value FROM meta WHERE key='schema_digest'").get().value,rows:after.prepare('SELECT count(*) AS n FROM scheduler_state').get().n},snapshot);}finally{after.close();}
}));

test('C-SCHED-01 process: separate store cannot mutate primary state with foreign lease',()=>fixture(f=>{
  const initial=SqliteSessionStore.create(f.directory,workspace,()=>100000);initial.createSession(binding,config());const lease=initial.acquireLease(binding);initial.close();
  const result=child(stateProgram(f.directory,`try{store.recordPrimaryObservation(${JSON.stringify(lease)},observation);process.exitCode=1;}catch(error){console.log(error.code);}store.close();`));
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'E_OWNER');
  const reopened=SqliteSessionStore.open(f.directory,workspace,()=>100000);try{assert.equal(reopened.readSchedulerState(binding),null);}finally{reopened.close();}
}));

test('C-SCHED-01 process: crash after confirmed observation preserves state on reopen',{timeout:30000},async()=>{
  const directory=mkdtempSync(join(tmpdir(),'cc-scheduler-process-'));
  try{const initial=SqliteSessionStore.create(directory,workspace,()=>100000);initial.createSession(binding,config());initial.close();
  const program=stateProgram(directory,`const lease=store.acquireLease(binding);const exec=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){const value=exec.call(this,sql);if(sql==='COMMIT'){writeSync(1,'committed\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}return value;};store.recordPrimaryObservation(lease,observation);`)
    .replace("import {SqliteSessionStore}", "import {writeSync} from 'node:fs';import {DatabaseSync} from 'node:sqlite';import {SqliteSessionStore}");
  const childProcess=spawn(process.execPath,['--experimental-strip-types','--input-type=module','-e',program],{stdio:['ignore','pipe','pipe']});let stderr='';childProcess.stderr.on('data',data=>stderr+=data);
  const exited=new Promise((resolve,reject)=>{childProcess.once('exit',resolve);childProcess.once('error',reject);});
  try{await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('commit barrier deadline '+stderr)),15000);childProcess.stdout.on('data',data=>{output+=data;if(output.includes('committed\n')){clearTimeout(timer);resolve();}});childProcess.once('exit',()=>reject(Error('child exited before commit '+stderr)));});childProcess.kill('SIGKILL');await exited;
    const reopened=SqliteSessionStore.open(directory,workspace,()=>100000);try{assert.deepEqual(reopened.readSchedulerState(binding),{binding,armed:true,last_attempt:null,low_water:{host_epoch:0,policy_revision:0,config_digest:digest(2)},last_observed_eligible_tokens:100,last_observed_at_ms:100000});}finally{reopened.close();}
  }finally{if(childProcess.exitCode===null&&childProcess.signalCode===null){childProcess.kill('SIGKILL');await exited;}}
  }finally{rmSync(directory,{recursive:true,force:true});}
});
