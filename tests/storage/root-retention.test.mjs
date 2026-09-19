import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { SqliteSessionStore, OWNER_LEASE_MS, MAX_INLINE_SOURCE_BYTES, WORKSPACE_CONTENT_QUOTA_BYTES } from '../../packages/storage/src/index.ts';
import { createSessionBinding, hashSource, resolveConfig } from '../../packages/core/src/index.ts';
const id=n=>`00000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
const workspace={installation_id:id(1),workspace_id:id(2)};
const binding=(name='A',incarnation=id(3))=>createSessionBinding({...workspace,adapter_id:'fixture',host_session_id:name},incarnation,0);
const config=()=>resolveConfig({}, {context_window:100000,output_reserve:4096});
const source=(n=10,text='original',revision=0)=>{const bytes=Buffer.isBuffer(text)?Buffer.from(text):Buffer.from(text,'utf8');return {ref:{source_id:id(n),revision,digest:hashSource(bytes)},native_refs:['source-'+n],media_type:'application/octet-stream',bytes};};
const observation=(s,name='root-A',patch={})=>({native_identity:name,authority:'agent',protocol_group:name,completed:true,protected:false,
  native_refs:[name],source_refs:s?[s.ref]:[],payload_ref:'public:'+name,payload:[{role:'assistant',content:s?s.bytes.toString('base64'):'opaque'}],estimated_tokens:10,...patch});
const reject=(fn,code)=>assert.throws(fn,e=>e.code===code);
function fixture(fn){
 const directory=mkdtempSync(join(tmpdir(),'cc-roots-')),handles=[];let now=100000;
 const s=SqliteSessionStore.create(directory,workspace,()=>now);handles.push(s);s.createSession(binding(),config());let lease=s.acquireLease(binding());
 const f={directory,path:join(directory,'ledger.sqlite'),s,get lease(){return lease;},b:binding(),advance:n=>now+=n,time:()=>now,
  open:()=>{const h=SqliteSessionStore.open(directory,workspace,()=>now);handles.push(h);return h;},renew:()=>lease=s.renewLease(lease)};
 const finish=()=>{for(const h of handles)h.close();rmSync(directory,{recursive:true,force:true});};
 try{const r=fn(f);if(r?.then)return r.finally(finish);finish();return r;}catch(e){finish();throw e;}
}
function batch(f,sources,observations,expected=f.s.readRootCatalog(f.b).catalog_digest){return {expected_catalog_digest:expected,sources,observations};}
function write(f,s=source(),name='root-A'){return f.s.retainRoots(f.lease,batch(f,[s],[observation(s,name)]));}
function sql(f,statement,...args){const db=new DatabaseSync(f.path);try{return db.prepare(statement).all(...args);}finally{db.close();}}
function exec(f,statement){const db=new DatabaseSync(f.path);try{db.exec(statement);}finally{db.close();}}

test('WP02B: sources and roots round-trip literal bytes and immutable identity',()=>fixture(f=>{
 const s=source(10,'\ufeffa\r\nç𐀀\0');const result=write(f,s),u=result.entries[0].unit;
 assert.equal(result.entries.length,1);assert.equal(u.revision,0);assert.equal(u.protected,false);
 assert.deepEqual(f.s.readRoot(f.b,u.root_coverage[0]),u);assert.deepEqual(Buffer.from(f.s.readSource(f.b,s.ref).bytes),s.bytes);
 const read=f.s.readSource(f.b,s.ref);read.bytes[0]^=255;assert.deepEqual(Buffer.from(f.s.readSource(f.b,s.ref).bytes),s.bytes);
 assert.ok(Object.isFrozen(result.entries[0].unit.source_refs));
}));
test('WP02B: empty and binary sources are not NULL or normalized',()=>fixture(f=>{
 for(const s of [source(10,''),source(11,Buffer.from([0,255,128,13,10]))]){
  write(f,s,'r'+s.ref.source_id);assert.deepEqual(Buffer.from(f.s.readSource(f.b,s.ref).bytes),s.bytes);
 }
 assert.equal(sql(f,'SELECT length(inline_bytes) AS n FROM sources WHERE source_id=?',id(10))[0].n,0);
}));
test('WP02B: repeated content with distinct identities is not conflated',()=>fixture(f=>{
 const a=source(10),b=source(11);const c=f.s.retainRoots(f.lease,batch(f,[a,b],[observation(a,'a'),observation(b,'b')]));
 assert.notEqual(c.entries[0].unit.unit_id,c.entries[1].unit.unit_id);assert.equal(sql(f,'SELECT * FROM sources').length,2);
}));
test('WP02B: root revisions survive edit and revert; old sources remain exact',()=>fixture(f=>{
 const a=source(),first=write(f,a).entries[0].unit;
 const b=source(10,'changed',1),second=write(f,b).entries[0].unit;
 const third=write(f,source(10,'original',2)).entries[0].unit;
 assert.equal(first.unit_id,second.unit_id);assert.equal(second.unit_id,third.unit_id);assert.equal(third.revision,2);
 assert.deepEqual(f.s.readRoot(f.b,first.root_coverage[0]),first);assert.equal(sql(f,'SELECT * FROM root_units').length,3);
 assert.deepEqual(Buffer.from(f.s.readSource(f.b,a.ref).bytes),a.bytes);
}));
test('WP02B: replay with current expectation does not duplicate records',()=>fixture(f=>{
 const a=source(),first=write(f,a);const again=write(f,a);assert.deepEqual(first,again);
 assert.equal(sql(f,'SELECT * FROM root_units').length,1);assert.equal(sql(f,'SELECT * FROM sources').length,1);
}));
test('WP02B: stale catalog rejects the whole batch before source insertion',()=>fixture(f=>{
 const old=f.s.readRootCatalog(f.b).catalog_digest;write(f);
 const b=source(11);reject(()=>f.s.retainRoots(f.lease,batch(f,[b],[observation(b,'B')],old)),'E_CONFLICT');
 assert.equal(sql(f,'SELECT * FROM sources WHERE source_id=?',id(11)).length,0);
}));
test('WP02B: expired and superseded owners cannot retain data',()=>fixture(f=>{
 const a=source();f.advance(OWNER_LEASE_MS);reject(()=>write(f,a),'E_OWNER');
 const other=f.open(),lease=other.acquireLease(f.b);reject(()=>write(f,a),'E_OWNER');
 other.retainRoots(lease,batch(f,[a],[observation(a)]));assert.equal(sql(f,'SELECT * FROM sources').length,1);
}));
test('WP02B: scope and incarnation cannot read retained content',()=>fixture(f=>{
 const a=source();write(f,a);reject(()=>f.s.readSource(binding('A',id(9)),a.ref),'E_SCOPE');
 f.s.createSession(binding('B'),config());reject(()=>f.s.readSource(binding('B'),a.ref),'E_SOURCE');
 assert.equal(f.s.readRootCatalog(binding('B')).entries.length,0);reject(()=>f.s.readRootCatalog(binding('missing')),'E_SCOPE');
}));
test('WP02B: unavailable source rejects root; no partial earlier source survives',()=>fixture(f=>{
 const a=source(),missing=source(11);reject(()=>f.s.retainRoots(f.lease,batch(f,[a],[observation(missing)])),'E_SOURCE');
 assert.equal(sql(f,'SELECT * FROM sources').length,0);assert.equal(sql(f,'SELECT * FROM root_units').length,0);
}));
test('WP02B: mismatched supplied source hash is rejected before writes',()=>fixture(f=>{
 const a=source();a.ref.digest='0'.repeat(64);reject(()=>write(f,a),'E_SOURCE');assert.equal(sql(f,'SELECT * FROM sources').length,0);
}));
test('WP02B: source revisions cannot rewrite content, skip or resurrect unavailable data',()=>fixture(f=>{
 const a=source();write(f,a);reject(()=>write(f,source(10,'other',0)),'E_SOURCE');
 reject(()=>write(f,source(10,'other',2)),'E_CONFLICT');reject(()=>write(f,source(11,'new',1)),'E_CONFLICT');
 exec(f,"UPDATE sources SET availability='deleted',inline_bytes=NULL WHERE source_id='"+id(10)+"'");
 reject(()=>f.s.readSource(f.b,a.ref),'E_SOURCE');reject(()=>write(f,source(10,'other',1)),'E_SOURCE');
}));
test('WP02B: corrupt retained bytes are not returned or accepted as root provenance',()=>fixture(f=>{
 const a=source();write(f,a);exec(f,"UPDATE sources SET inline_bytes=X'00'");
 reject(()=>f.s.readSource(f.b,a.ref),'E_SOURCE');reject(()=>f.s.readRootCatalog(f.b),'E_SOURCE');
}));
test('WP02B: root columns must agree with the serialized record',()=>fixture(f=>{
 const c=write(f),ref=c.entries[0].unit.root_coverage[0];exec(f,"UPDATE root_units SET payload_digest='"+'0'.repeat(64)+"'");
 reject(()=>f.s.readRootCatalog(f.b),'E_STORAGE');reject(()=>f.s.readRoot(f.b,ref),'E_STORAGE');
}));
test('WP02B: partial protocol and absent sources remain protected',()=>fixture(f=>{
 const c=f.s.retainRoots(f.lease,batch(f,[],[observation(null,'partial',{completed:false})]));assert.equal(c.entries[0].unit.protected,true);
}));
test('WP02B: duplicate public identities fail the batch without aliasing',()=>fixture(f=>{
 const a=source();reject(()=>f.s.retainRoots(f.lease,batch(f,[a],[observation(a,'a'),observation(a,'b',{native_refs:['a']})])),'E_CONFLICT');
 assert.equal(sql(f,'SELECT * FROM sources').length,0);
}));
test('WP02B: metadata-only change preserves semantic revision and updates the catalog',()=>fixture(f=>{
 const a=source(),first=write(f,a);const c=f.s.retainRoots(f.lease,batch(f,[],[observation(a,'root-A',{estimated_tokens:20,payload_ref:'new locator'})]));
 assert.equal(c.entries[0].unit.revision,0);assert.equal(c.entries[0].unit.unit_digest,first.entries[0].unit.unit_digest);
 assert.notEqual(c.catalog_digest,first.catalog_digest);assert.equal(sql(f,'SELECT * FROM root_units').length,1);assert.deepEqual(f.open().readRootCatalog(f.b),c);
}));
test('WP02B: catalog ordering is stable across insertion order and reopen',()=>fixture(f=>{
 const a=source();const c=f.s.retainRoots(f.lease,batch(f,[a],[observation(a,'z'),observation(a,'a')]));
 assert.deepEqual(c.entries.map(e=>e.native_identity),['a','z']);assert.deepEqual(f.open().readRootCatalog(f.b),c);
}));
test('WP02B: failed root INSERT rolls back source bytes and earlier roots',()=>fixture(f=>{
 exec(f,"CREATE TRIGGER fixture_fail BEFORE INSERT ON root_units WHEN NEW.native_identity='b' BEGIN SELECT RAISE(ABORT,'fixture-secret'); END");
 const a=source();assert.throws(()=>f.s.retainRoots(f.lease,batch(f,[a],[observation(a,'a'),observation(a,'b')])),e=>e.code==='E_STORAGE'&&!e.message.includes('fixture-secret'));
 assert.equal(sql(f,'SELECT * FROM sources').length,0);assert.equal(sql(f,'SELECT * FROM root_units').length,0);
 exec(f,'DROP TRIGGER fixture_fail');assert.equal(write(f,a).entries.length,1);
}));
test('WP02B: 256 KiB is inclusive; larger source never truncates or creates external files',()=>fixture(f=>{
 write(f,source(10,Buffer.alloc(MAX_INLINE_SOURCE_BYTES,17)));
 reject(()=>write(f,source(11,Buffer.alloc(MAX_INLINE_SOURCE_BYTES+1,17)),'other'),'E_CAPABILITY');assert.equal(sql(f,'SELECT * FROM sources').length,1);
}));
test('WP02B: workspace quota includes other sessions and outstanding reservations',()=>fixture(f=>{
 const a=source(10,'1234');write(f,a);const owner=id(80),reservation=id(81);
 const db=new DatabaseSync(f.path);try{
  db.prepare("INSERT INTO storage_owners VALUES (?,?,'fixture-lock','active','2026-01-01')").run(owner,id(82));
  db.prepare("INSERT INTO storage_reservations(reservation_id,owner_id,operation_id,kind,size_bytes,created_at) VALUES (?,?,?,'staging',?,'2026-01-01')").run(reservation,owner,id(83),WORKSPACE_CONTENT_QUOTA_BYTES-4);
 }finally{db.close();}
 f.s.createSession(binding('B'),config());const lease=f.s.acquireLease(binding('B')),b=source(11,'1');
 reject(()=>f.s.retainRoots(lease,{expected_catalog_digest:f.s.readRootCatalog(binding('B')).catalog_digest,sources:[b],observations:[observation(b)]}),'E_BUDGET');
 assert.equal(sql(f,'SELECT * FROM sources').length,1);
}));
test('WP02B: tombstone blocks reads and retention without reactivation',()=>fixture(f=>{
 const a=source();write(f,a);sql(f,'INSERT INTO tombstones VALUES (?,?,?)',f.b.session_key,f.b.incarnation,'fixture');
 reject(()=>f.s.readSource(f.b,a.ref),'E_SCOPE');reject(()=>f.s.readRootCatalog(f.b),'E_SCOPE');reject(()=>write(f,a),'E_SCOPE');
}));
test('WP02B: malformed batches and reference-only missing lookups cannot create sessions',()=>fixture(f=>{
 const a=source();reject(()=>f.s.retainRoots(f.lease,{...batch(f,[a],[observation(a)]),unknown:true}),'E_SCHEMA');
 reject(()=>f.s.retainRoots(f.lease,batch(f,[a],[observation(a),observation(a)])),'E_SCHEMA');
 assert.equal(f.s.readRoot(f.b,{unit_id:id(99),revision:0,unit_digest:'0'.repeat(64)}),null);
 assert.equal(sql(f,'SELECT * FROM sources').length,0);
}));
const moduleURL=new URL('../../packages/storage/src/index.ts',import.meta.url).href;
test('WP02B: a fresh process reads the exact catalog and source bytes',()=>fixture(f=>{
 const a=source(10,'保存\r\n'),c=write(f,a);const p={directory:f.directory,workspace,binding:f.b,ref:a.ref};
 const script=`import {SqliteSessionStore} from ${JSON.stringify(moduleURL)};const p=${JSON.stringify(p)};const s=SqliteSessionStore.open(p.directory,p.workspace);console.log(JSON.stringify({catalog:s.readRootCatalog(p.binding),bytes:Buffer.from(s.readSource(p.binding,p.ref).bytes).toString('base64')}));s.close();`;
 const r=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',script],{encoding:'utf8',timeout:15000});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);
 const read=JSON.parse(r.stdout);assert.deepEqual(read.catalog,c);assert.equal(read.bytes,a.bytes.toString('base64'));
}));
for(const phase of ['before','after'])test(`WP02B: process interruption ${phase} retention commit is atomic`,{timeout:20000},()=>fixture(async f=>{
 f.s.releaseLease(f.lease);const a=source();const p={directory:f.directory,workspace,binding:f.b,source:{...a,bytes:[...a.bytes]},observation:observation(a),expected:f.s.readRootCatalog(f.b).catalog_digest,phase};
 const script=`import {SqliteSessionStore} from ${JSON.stringify(moduleURL)};import {DatabaseSync} from 'node:sqlite';import {writeSync} from 'node:fs';const p=${JSON.stringify(p)};const s=SqliteSessionStore.open(p.directory,p.workspace,()=>100001);const lease=s.acquireLease(p.binding);const original=DatabaseSync.prototype.exec;function barrier(){writeSync(1,'barrier\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}DatabaseSync.prototype.exec=function(sql){if(sql==='COMMIT'&&p.phase==='before')barrier();const r=original.call(this,sql);if(sql==='COMMIT'&&p.phase==='after')barrier();return r;};s.retainRoots(lease,{expected_catalog_digest:p.expected,sources:[{...p.source,bytes:Buffer.from(p.source.bytes)}],observations:[p.observation]});`;
 const child=spawn(process.execPath,['--experimental-strip-types','--input-type=module','-e',script],{stdio:['ignore','pipe','pipe']});let err='';child.stderr.on('data',v=>err+=v);
 const exited=new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});
 try{
  await new Promise((resolve,reject)=>{let out='';const t=setTimeout(()=>reject(Error('barrier not reached '+err)),10000);child.stdout.on('data',v=>{out+=v;if(out.includes('barrier')){clearTimeout(t);resolve();}});child.once('exit',()=>{clearTimeout(t);reject(Error('early exit '+err));});});
  child.kill('SIGKILL');await exited;const n=phase==='before'?0:1;
  assert.equal(sql(f,'SELECT * FROM sources').length,n);assert.equal(sql(f,'SELECT * FROM root_units').length,n);assert.equal(f.open().readRootCatalog(f.b).entries.length,n);assert.equal(sql(f,'SELECT * FROM jobs').length,0);
 }finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}}
}));

test('WP02B: lease expiring inside a batch rolls back both sources and roots',()=>fixture(f=>{
 const a=source(),expected=f.s.readRootCatalog(f.b).catalog_digest,prepare=DatabaseSync.prototype.prepare;let hit=false;
 DatabaseSync.prototype.prepare=function(statement){if(statement.includes('INSERT INTO root_units')){hit=true;f.advance(OWNER_LEASE_MS);}return prepare.call(this,statement);};
 try{reject(()=>f.s.retainRoots(f.lease,{expected_catalog_digest:expected,sources:[a],observations:[observation(a)]}),'E_OWNER');}
 finally{DatabaseSync.prototype.prepare=prepare;}
 assert.equal(hit,true);assert.equal(sql(f,'SELECT * FROM sources').length,0);assert.equal(sql(f,'SELECT * FROM root_units').length,0);
}));
test('WP02B: source metadata is immutable within its revision',()=>fixture(f=>{
 const a=source();write(f,a);reject(()=>write(f,{...a,media_type:'text/plain'}),'E_CONFLICT');
 assert.equal(f.s.readSource(f.b,a.ref).media_type,'application/octet-stream');
}));
test('WP02B: retaining a batch does not delete omitted roots or create a chapter',()=>fixture(f=>{
 const a=source();const first=write(f,a);write(f,source(11),'second');
 const c=f.s.readRootCatalog(f.b);assert.equal(c.entries.length,2);assert.deepEqual(f.s.readRoot(f.b,first.entries[0].unit.root_coverage[0]),first.entries[0].unit);
 assert.equal(sql(f,'SELECT * FROM jobs').length,0);assert.equal(sql(f,'SELECT * FROM chapters').length,0);assert.equal(f.s.readSession(f.b).view_revision,0);
}));
test('WP02B: source revision-only intake keeps bytes retrievable without inventing roots',()=>fixture(f=>{
 const a=source(),b=source(10,'revision one',1);const c=f.s.retainRoots(f.lease,batch(f,[a,b],[]));
 assert.equal(c.entries.length,0);assert.equal(f.s.readSource(f.b,b.ref).ref.revision,1);assert.deepEqual(Buffer.from(f.s.readSource(f.b,a.ref).bytes),a.bytes);
}));
test('WP02B: shared source buffers and too many observations are refused before writes',()=>fixture(f=>{
 const a=source();reject(()=>write(f,{...a,bytes:new Uint8Array(new SharedArrayBuffer(8))}),'E_SCHEMA');
 reject(()=>f.s.retainRoots(f.lease,batch(f,[],Array.from({length:129},(_,i)=>observation(null,'r'+i)))),'E_SCHEMA');
 assert.equal(sql(f,'SELECT * FROM sources').length,0);
}));
test('WP02B: combined source byte limit rejects a batch without truncation',()=>fixture(f=>{
 const sources=Array.from({length:17},(_,i)=>source(100+i,Buffer.alloc(MAX_INLINE_SOURCE_BYTES,1)));
 reject(()=>f.s.retainRoots(f.lease,batch(f,sources,[])),'E_BUDGET');assert.equal(sql(f,'SELECT * FROM sources').length,0);
}));
