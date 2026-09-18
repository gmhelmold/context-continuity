import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, chmodSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync, linkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SqliteSessionStore, OWNER_LEASE_MS } from '../../packages/storage/src/index.ts';
import { APPLICATION_ID, SCHEMA_VERSION } from '../../packages/storage/src/sqlite-database.ts';
import { createSessionBinding, resolveConfig } from '../../packages/core/src/index.ts';
const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
const workspace = { installation_id:id(1), workspace_id:id(2) };
const binding = (session='A', incarnation=id(3), patch={}) => createSessionBinding({ ...workspace, adapter_id:'synthetic', host_session_id:session, ...patch }, incarnation, 0);
const config = () => resolveConfig({}, { context_window:100000, output_reserve:4096 });
const root = fileURLToPath(new URL('../../', import.meta.url));
const reject = (fn, code) => assert.throws(fn, error => error.code===code);
function fixture(fn) {
  const directory=mkdtempSync(join(tmpdir(),'cc-storage-a-')),handles=[];
  let clock=100000;
  const create=()=>{const db=SqliteSessionStore.create(directory,workspace,()=>clock);handles.push(db);return db;};
  const open=()=>{const db=SqliteSessionStore.open(directory,workspace,()=>clock);handles.push(db);return db;};
  const path=join(directory,'ledger.sqlite');
  const f={directory,path,create,open,advance:n=>{clock+=n;},time:()=>clock};
  const clean=()=>{for(const db of handles)db.close();rmSync(directory,{recursive:true,force:true});};
  try {const result=fn(f);if(result?.then)return result.finally(clean);clean();return result;}catch(error){clean();throw error;}
}
const rows=(file,sql,...params)=>{const db=new DatabaseSync(file);try{return db.prepare(sql).all(...params);}finally{db.close();}};
const mutate=(file,sql)=>{const db=new DatabaseSync(file);try{db.exec(sql);}finally{db.close();}};

test('WP02A schema: executable asset matches the normative DDL byte for byte',()=>{
  const text=readFileSync(join(root,'specs/v0.1/03-ledger.md'),'utf8');
  assert.equal(readFileSync(join(root,'packages/storage/src/schema-v1.sql'),'utf8'),text.split('```sql\n')[1].split('\n```')[0]+'\n');
});
test('WP02A bootstrap: WAL, FULL, foreign keys and one complete supported schema',()=>fixture(f=>{
  const store=f.create();assert.equal(store.readSession(binding()),null);
  const d=store.diagnostics();assert.equal(d.journal_mode,'wal');assert.equal(d.synchronous,2);assert.equal(d.foreign_keys,1);assert.equal(d.busy_timeout,250);
  const db=new DatabaseSync(f.path);
  try {
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode,'wal');
    assert.equal(db.prepare('PRAGMA user_version').get().user_version,SCHEMA_VERSION);
    assert.equal(db.prepare('PRAGMA application_id').get().application_id,APPLICATION_ID);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
    assert.ok(db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().length>15);
  } finally {db.close();}
  for(const name of readdirSync(f.directory))assert.equal(statSync(join(f.directory,name)).mode&0o777,0o600);
  assert.equal(store.workspace.workspace_id,workspace.workspace_id);
}));
test('WP02A bootstrap: open missing does not create a file',()=>fixture(f=>{
  reject(()=>f.open(),'E_STORAGE');assert.deepEqual(readdirSync(f.directory),[]);
}));
test('WP02A bootstrap: create existing never truncates or resets data',()=>fixture(f=>{
  const store=f.create();store.createSession(binding(),config());store.close();
  const before=readFileSync(f.path);reject(()=>f.create(),'E_CONFLICT');assert.deepEqual(readFileSync(f.path),before);
  assert.equal(f.open().readSession(binding()).binding.incarnation,id(3));
}));
test('WP02A bootstrap: foreign/future/incomplete databases fail without migration',()=>{
  for(const mode of ['foreign','future','incomplete'])fixture(f=>{
    if(mode==='foreign'){const d=new DatabaseSync(f.path);d.exec('CREATE TABLE unrelated(value TEXT)');d.close();chmodSync(f.path,0o600);}
    else if(mode==='incomplete')writeFileSync(f.path,'',{mode:0o600});
    else {f.create().close();mutate(f.path,'PRAGMA user_version=99');}
    const before=readFileSync(f.path);reject(()=>f.open(),'E_CAPABILITY');assert.deepEqual(readFileSync(f.path),before);
  });
});
test('WP02A bootstrap: altered schema or metadata is rejected, not repaired',()=>{
  for(const change of ["DROP INDEX one_active_job", "UPDATE meta SET value='bad' WHERE key='schema_digest'"])fixture(f=>{
    f.create().close();mutate(f.path,change);reject(()=>f.open(),'E_STORAGE');
  });
});
test('WP02A scope: wrong workspace cannot open a valid ledger',()=>fixture(f=>{
  f.create().close();reject(()=>SqliteSessionStore.open(f.directory,{...workspace,workspace_id:id(9)}),'E_SCOPE');
}));
test('WP02A path: reject public directories, symlinks and multiply-linked database',()=>fixture(f=>{
  chmodSync(f.directory,0o755);reject(()=>f.create(),'E_STORAGE');chmodSync(f.directory,0o700);
  writeFileSync(join(f.directory,'external'),'sentinel',{mode:0o600});symlinkSync(join(f.directory,'external'),f.path);
  reject(()=>f.open(),'E_STORAGE');assert.equal(readFileSync(join(f.directory,'external'),'utf8'),'sentinel');rmSync(f.path);
  f.create().close();linkSync(f.path,join(f.directory,'second-link'));reject(()=>f.open(),'E_STORAGE');
}));
test('WP02A path: sidecar symlinks and changed permissions are rejected',()=>fixture(f=>{
  const store=f.create();store.createSession(binding(),config());
  chmodSync(f.path,0o644);reject(()=>store.readSession(binding()),'E_STORAGE');chmodSync(f.path,0o600);store.close();
  symlinkSync(join(f.directory,'external'),f.path+'-wal');reject(()=>f.open(),'E_STORAGE');
}));
test('WP02A initialization: Session and View0 persist and are deeply immutable',()=>fixture(f=>{
  const s=f.create(),cfg=config(),a=s.createSession(binding(),cfg);
  assert.equal(a.mode,'unsupported');assert.equal(a.view_revision,0);assert.equal(a.owner_fence,0);
  assert.ok(Object.isFrozen(a.config.settings));assert.ok(Object.isFrozen(a.binding.scope));
  assert.equal(rows(f.path,'SELECT * FROM sessions').length,1);assert.equal(rows(f.path,'SELECT * FROM views').length,1);
  s.close();assert.deepEqual(f.open().readSession(binding()),a);
}));
test('WP02A initialization: identical replay is idempotent, conflicting config is not overwrite',()=>fixture(f=>{
  const s=f.create(),a=s.createSession(binding(),config());assert.deepEqual(s.createSession(binding(),config()),a);
  reject(()=>s.createSession(binding(),resolveConfig({trigger_ratio:0.6},config().limits)),'E_CONFLICT');
  assert.deepEqual(s.readSession(binding()),a);assert.equal(rows(f.path,'SELECT * FROM views').length,1);
}));
test('WP02A initialization: second insert failure rolls back Session and timestamp together',()=>fixture(f=>{
  const s=f.create();
  mutate(f.path,"CREATE TRIGGER fixture_failure BEFORE INSERT ON views BEGIN SELECT RAISE(ABORT,'synthetic private message'); END");
  assert.throws(()=>s.createSession(binding(),config()),e=>e.code==='E_STORAGE'&&!e.message.includes('private message'));
  assert.equal(rows(f.path,'SELECT * FROM sessions').length,0);assert.equal(rows(f.path,'SELECT * FROM views').length,0);
  assert.equal(rows(f.path,"SELECT value FROM meta WHERE key='clock_high_water_ms'")[0].value,'0');
  mutate(f.path,'DROP TRIGGER fixture_failure');assert.ok(s.createSession(binding(),config()));
}));
test('WP02A scope: same external ID in another installation/workspace/incarnation cannot cross',()=>fixture(f=>{
  const s=f.create();s.createSession(binding(),config());
  for(const b of [binding('A',id(99)),binding('A',id(3),{workspace_id:id(9)}),binding('A',id(3),{installation_id:id(9)})])reject(()=>s.readSession(b),'E_SCOPE');
  assert.equal(s.readSession(binding('B')),null);reject(()=>s.acquireLease(binding('B')),'E_SCOPE');
  assert.equal(rows(f.path,'SELECT * FROM sessions').length,1);
}));
test('WP02A tombstone: initialization and reads never reactivate a suppressed scope',()=>fixture(f=>{
  const s=f.create(),b=binding();
  const d=new DatabaseSync(f.path);d.prepare('INSERT INTO tombstones VALUES (?,?,?)').run(b.session_key,b.incarnation,'synthetic exclusion');d.close();
  reject(()=>s.createSession(b,config()),'E_SCOPE');reject(()=>s.readSession(b),'E_SCOPE');
  reject(()=>s.acquireLease(b),'E_SCOPE');assert.equal(rows(f.path,'SELECT * FROM sessions').length,0);
}));
test('WP02A lease: competitor cannot acquire and stale owner cannot renew/release after takeover',()=>fixture(f=>{
  const a=f.create(),b=f.open();a.createSession(binding(),config());const first=a.acquireLease(binding());
  assert.equal(first.owner_fence,1);reject(()=>b.acquireLease(binding()),'E_OWNER');
  f.advance(OWNER_LEASE_MS);const second=b.acquireLease(binding());assert.equal(second.owner_fence,2);
  reject(()=>a.renewLease(first),'E_OWNER');reject(()=>a.releaseLease(first),'E_OWNER');
  assert.equal(b.readSession(binding()).owner_id,second.owner_id);
}));
test('WP02A lease: renewal invalidates old deadline and release never resets fence',()=>fixture(f=>{
  const s=f.create();s.createSession(binding(),config());const a=s.acquireLease(binding());
  assert.deepEqual(s.acquireLease(binding()),a);f.advance(10000);const b=s.renewLease(a);
  assert.equal(b.owner_fence,a.owner_fence);assert.equal(b.lease_until_ms,a.lease_until_ms+10000);
  reject(()=>s.releaseLease(a),'E_OWNER');s.releaseLease(b);
  assert.equal(s.readSession(binding()).owner_id,null);assert.equal(s.acquireLease(binding()).owner_fence,2);
}));
test('WP02A lease: closed owner does not implicitly release or replay work',()=>fixture(f=>{
  const s=f.create();s.createSession(binding(),config());const before=s.acquireLease(binding());s.close();
  const next=f.open();assert.equal(next.readSession(binding()).owner_id,before.owner_id);reject(()=>next.acquireLease(binding()),'E_OWNER');
  assert.equal(rows(f.path,'SELECT * FROM jobs').length,0);f.advance(OWNER_LEASE_MS);assert.equal(next.acquireLease(binding()).owner_fence,2);
}));
test('WP02A lease: backward clock and fence exhaustion fail without wraparound',()=>fixture(f=>{
  const s=f.create();s.createSession(binding(),config());const a=s.acquireLease(binding());f.advance(-1);reject(()=>s.renewLease(a),'E_OWNER');
  f.advance(1);s.releaseLease(a);mutate(f.path,`UPDATE sessions SET owner_fence=${Number.MAX_SAFE_INTEGER}`);
  reject(()=>s.acquireLease(binding()),'E_OWNER');assert.equal(s.readSession(binding()).owner_fence,Number.MAX_SAFE_INTEGER);
}));
test('WP02A close: idempotent and all subsequent operations are refused',()=>fixture(f=>{
  const s=f.create();s.close();s.close();reject(()=>s.readSession(binding()),'E_STORAGE');reject(()=>s.createSession(binding(),config()),'E_STORAGE');
}));
test('WP02A SQLite: held writer transaction refuses another write without partial changes',()=>fixture(f=>{
  const s=f.create();const d=new DatabaseSync(f.path);d.exec('BEGIN IMMEDIATE');
  try {reject(()=>s.createSession(binding(),config()),'E_STORAGE');}
  finally {d.exec('ROLLBACK');d.close();}
  assert.equal(s.readSession(binding()),null);assert.ok(s.createSession(binding(),config()));
}));

const moduleURL=new URL('../../packages/storage/src/index.ts',import.meta.url).href;
const coreURL=new URL('../../packages/core/src/index.ts',import.meta.url).href;
const childPrefix=`import {SqliteSessionStore} from ${JSON.stringify(moduleURL)};import {createSessionBinding,resolveConfig} from ${JSON.stringify(coreURL)};`;
function childArgs(f){return JSON.stringify({directory:f.directory,workspace,b:binding(),config:config(),now:f.time()});}
function childScript(f,code){return childPrefix+`const p=${childArgs(f)};`+code;}
function runChild(script){const r=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',script],{encoding:'utf8',timeout:10000});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
test('WP02A restart: fresh process reads exact committed scope/configuration',()=>fixture(f=>{
  const s=f.create(),expected=s.createSession(binding(),config());s.close();
  const actual=runChild(childScript(f,"const s=SqliteSessionStore.open(p.directory,p.workspace,()=>p.now);console.log(JSON.stringify(s.readSession(p.b)));s.close();"));
  assert.deepEqual(actual,expected);
}));
test('WP02A concurrent processes: exactly one owner wins under shared SQLite transaction',{timeout:15000},async()=>fixture(async f=>{
  const s=f.create();s.createSession(binding(),config());
  const script=childScript(f,"const s=SqliteSessionStore.open(p.directory,p.workspace,()=>p.now);process.send('ready');process.once('message',()=>{try{process.send({lease:s.acquireLease(p.b)});}catch(e){process.send({code:e.code});}finally{s.close();process.disconnect();}});");
  const children=[];
  try {
    for(let i=0;i<2;i++) {
      const child=spawn(process.execPath,['--experimental-strip-types','--input-type=module','-e',script],{stdio:['ignore','ignore','pipe','ipc']});children.push(child);
      await new Promise((resolve,reject)=>{child.once('message',m=>m==='ready'?resolve():reject(Error('bad readiness')));child.once('error',reject);child.once('exit',code=>code&&reject(Error('child early exit')));});
    }
    const results=await Promise.all(children.map(c=>new Promise((resolve,reject)=>{c.once('message',resolve);c.once('error',reject);c.send('go');})));
    assert.equal(results.filter(r=>r.lease).length,1);assert.equal(results.filter(r=>r.code==='E_OWNER').length,1);
    assert.equal(s.readSession(binding()).owner_fence,1);
    await Promise.all(children.map(c=>new Promise(resolve=>c.exitCode!==null?resolve():c.once('exit',resolve))));
  } finally {for(const c of children)if(c.exitCode===null)c.kill();}
}));
test('WP02A crash: kill before COMMIT leaves neither Session nor View0',{timeout:15000},async()=>fixture(async f=>{
  const s=f.create();s.close();
  const script=childScript(f,`import {DatabaseSync} from 'node:sqlite';const s=SqliteSessionStore.open(p.directory,p.workspace,()=>p.now);
    const original=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){if(sql==='COMMIT'){process.stdout.write('commit-barrier\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}return original.call(this,sql);};s.createSession(p.b,p.config);`);
  const c=spawn(process.execPath,['--experimental-strip-types','--input-type=module','-e',script],{stdio:['ignore','pipe','pipe']});
  try {
    await new Promise((resolve,reject)=>{let output='';const t=setTimeout(()=>reject(Error('commit barrier not reached')),5000);c.stdout.on('data',b=>{output+=b;if(output.includes('commit-barrier')){clearTimeout(t);resolve();}});c.once('error',reject);});
    c.kill('SIGKILL');await new Promise(resolve=>c.once('exit',resolve));
    const reopened=f.open();assert.equal(reopened.readSession(binding()),null);assert.equal(rows(f.path,'SELECT * FROM views').length,0);
    assert.ok(reopened.createSession(binding(),config()));
  } finally {if(c.exitCode===null&&c.signalCode===null)c.kill();}
}));

test('WP02A immutable owner: public identity cannot change authority or workspace',()=>fixture(f=>{
  const s=f.create();assert.ok(Object.isFrozen(s));assert.ok(Object.isFrozen(s.workspace));
  assert.throws(()=>{s.owner_id=id(7);},TypeError);
  assert.throws(()=>{s.workspace.workspace_id=id(7);},TypeError);
}));
test('WP02A initialization: replay does not reset an existing owner',()=>fixture(f=>{
  const s=f.create();s.createSession(binding(),config());const owner=s.acquireLease(binding());
  s.createSession(binding(),config());const row=s.readSession(binding());
  assert.equal(row.owner_id,owner.owner_id);assert.equal(row.owner_fence,owner.owner_fence);
  assert.equal(row.lease_until_ms,owner.lease_until_ms);
}));
test('WP02A consistency: absent current View never returns a usable session',()=>fixture(f=>{
  const s=f.create();s.createSession(binding(),config());mutate(f.path,'DELETE FROM views');
  reject(()=>s.readSession(binding()),'E_STORAGE');
}));

test('WP02A bootstrap: orphan sidecar prevents initialization without altering old bytes',()=>fixture(f=>{
  writeFileSync(f.path+'-wal','incomplete prior storage',{mode:0o600});
  reject(()=>f.create(),'E_CONFLICT');
  assert.deepEqual(readdirSync(f.directory),['ledger.sqlite-wal']);
  assert.equal(readFileSync(f.path+'-wal','utf8'),'incomplete prior storage');
}));

test('WP02A lease: malformed control is rejected before transaction timestamp changes',()=>fixture(f=>{
  const s=f.create();s.createSession(binding(),config());const lease=s.acquireLease(binding());
  f.advance(1000);
  reject(()=>s.renewLease({...lease,owner_fence:0}),'E_SCHEMA');
  reject(()=>s.releaseLease({...lease,unexpected:true}),'E_SCHEMA');
  assert.equal(rows(f.path,"SELECT value FROM meta WHERE key='clock_high_water_ms'")[0].value,String(f.time()-1000));
}));
