/** Integration review of WP-02/A. Real SQLite files; only fixture-owned children are interrupted. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { SqliteSessionStore } from '../../packages/storage/src/index.ts';
import { createSessionBinding, resolveConfig } from '../../packages/core/src/index.ts';
const workspace={installation_id:'00000000-0000-4000-8000-000000000001',workspace_id:'00000000-0000-4000-8000-000000000002'};
const binding=createSessionBinding({...workspace,adapter_id:'synthetic',host_session_id:'storage-review'},'00000000-0000-4000-8000-000000000003',0);
const config=resolveConfig({}, {context_window:100000,output_reserve:4096});
const moduleURL=new URL('../../packages/storage/src/index.ts',import.meta.url).href;
function fixture(fn) {
  const directory=mkdtempSync(join(tmpdir(),'cc-storage-review-'));
  const handles=[];
  const f={directory,path:join(directory,'ledger.sqlite'),
    create(){const s=SqliteSessionStore.create(directory,workspace,()=>100000);handles.push(s);return s;},
    open(){const s=SqliteSessionStore.open(directory,workspace,()=>100000);handles.push(s);return s;}};
  const clean=()=>{for(const s of handles)s.close();rmSync(directory,{recursive:true,force:true});};
  try {const result=fn(f);if(result?.then)return result.finally(clean);clean();return result;}catch(e){clean();throw e;}
}
const objects={
  table:'CREATE TABLE sqlitex_fixture(value TEXT)',
  index:'CREATE INDEX sqlitex_fixture ON meta(value)',
  view:'CREATE VIEW sqlitex_fixture AS SELECT value FROM meta',
  trigger:'CREATE TRIGGER sqlitex_fixture AFTER INSERT ON views BEGIN SELECT 1; END',
};
for(const [kind,sql] of Object.entries(objects)) {
  test(`WP02A review: application ${kind} cannot hide behind a reserved-prefix wildcard`,()=>fixture(f=>{
    f.create().close();const db=new DatabaseSync(f.path);
    try {db.exec(sql);}finally{db.close();}
    const before=readFileSync(f.path);
    assert.throws(()=>f.open(),e=>e.code==='E_STORAGE'&&e.reason==='schema structure mismatch');
    assert.deepEqual(readFileSync(f.path),before,'inspection must not repair the foreign schema');
  }));
}

test('WP02A review: internal indexes and SQLite statistics do not look like an application migration',()=>fixture(f=>{
  const s=f.create();s.createSession(binding,config);s.close();
  const db=new DatabaseSync(f.path);try{db.exec('ANALYZE');}finally{db.close();}
  assert.deepEqual(f.open().readSession(binding).config,config);
}));

test('WP02A review: main file made read-only is rejected without modification',()=>fixture(f=>{
  f.create().close();const before=readFileSync(f.path);chmodSync(f.path,0o400);
  try {assert.throws(()=>f.open(),e=>e.code==='E_STORAGE');assert.deepEqual(readFileSync(f.path),before);}
  finally{chmodSync(f.path,0o600);}
}));

async function interruptAt(f,phase) {
  const barrier=join(f.directory,'child-barrier');
  const params=JSON.stringify({directory:f.directory,workspace,binding,config,barrier,phase});
  const script=`import {SqliteSessionStore} from ${JSON.stringify(moduleURL)};
import {DatabaseSync} from 'node:sqlite';import {writeFileSync} from 'node:fs';
const p=${params};
const wait=()=>{writeFileSync(p.barrier,p.phase,{mode:0o600});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);};
const original=DatabaseSync.prototype.exec;
if(p.phase==='session-after') {
 const s=SqliteSessionStore.open(p.directory,p.workspace,()=>100000);
 DatabaseSync.prototype.exec=function(sql){const result=original.call(this,sql);if(sql==='COMMIT')wait();return result;};
 s.createSession(p.binding,p.config);
} else {
 DatabaseSync.prototype.exec=function(sql){
  if(p.phase==='bootstrap-before'&&sql.includes('CREATE TABLE meta')){
   original.call(this,'CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');wait();
  }
  const result=original.call(this,sql);
  if(p.phase==='bootstrap-after'&&sql.includes('PRAGMA application_id=')&&sql.includes('COMMIT'))wait();
  return result;
 };
 SqliteSessionStore.create(p.directory,p.workspace,()=>100000);
}
throw new Error('fixture did not stop at the requested barrier');`;
  const child=spawn(process.execPath,['--experimental-strip-types','--input-type=module','-e',script],{stdio:['ignore','ignore','pipe']});
  let stderr='';child.stderr.setEncoding('utf8');child.stderr.on('data',s=>stderr+=s);
  const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
  try {
    const end=Date.now()+5000;
    while(!existsSync(barrier)) {
      assert.equal(child.exitCode,null,stderr);assert.equal(child.signalCode,null,stderr);
      assert.ok(Date.now()<end,'fixture barrier not reached: '+stderr);
      await new Promise(r=>setTimeout(r,5));
    }
    assert.equal(readFileSync(barrier,'utf8'),phase);
    assert.equal(child.kill('SIGKILL'),true);
    const ended=await exited;assert.equal(ended.signal,'SIGKILL');
  } finally {if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}}
}

test('WP02A review: interrupted bootstrap publishes neither schema nor metadata',{timeout:10000},()=>fixture(async f=>{
  await interruptAt(f,'bootstrap-before');
  const db=new DatabaseSync(f.path,{readOnly:true});
  try {
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'").get().n,0);
    assert.equal(db.prepare('PRAGMA application_id').get().application_id,0);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version,0);
  }finally{db.close();}
  assert.throws(()=>f.open(),e=>e.code==='E_CAPABILITY');
  const before=readFileSync(f.path);
  assert.throws(()=>f.create(),e=>e.code==='E_CONFLICT');
  assert.deepEqual(readFileSync(f.path),before,'incomplete file must not be silently recreated');
}));

test('WP02A review: process death after bootstrap COMMIT retains a usable complete database',{timeout:10000},()=>fixture(async f=>{
  await interruptAt(f,'bootstrap-after');
  const s=f.open();assert.equal(s.readSession(binding),null);assert.equal(s.diagnostics().journal_mode,'wal');
  assert.deepEqual(s.createSession(binding,config).config,config);
}));

test('WP02A review: process death after Session COMMIT retains both records without replay',{timeout:10000},()=>fixture(async f=>{
  f.create().close();await interruptAt(f,'session-after');
  const s=f.open(),row=s.readSession(binding);assert.deepEqual(row.config,config);assert.equal(row.owner_fence,0);
  assert.deepEqual(s.createSession(binding,config),row);
  const db=new DatabaseSync(f.path,{readOnly:true});
  try {
    assert.equal(db.prepare('SELECT count(*) AS n FROM sessions').get().n,1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM views').get().n,1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM jobs').get().n,0);
  }finally{db.close();}
}));
