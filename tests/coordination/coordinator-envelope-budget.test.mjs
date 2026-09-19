/** Actual SQLite results and kernel locks; synthetic fixture data only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {DatabaseSync} from 'node:sqlite';
import {WorkspaceCoordinator,assertWorkspaceHold} from '../../packages/storage/src/workspace-coordinator.ts';
import {fixture,workspace,id,sql,pythonTry,ownerPath} from './coordinator-fixtures.mjs';

const anchorKey='coordinator.anchor.v1';
const ownerKey=id=>`coordinator.owner.v1:${id}`;
const read=(f,key)=>sql(f,'SELECT value FROM meta WHERE key=?',key)[0].value;
const set=(f,key,value)=>sql(f,'UPDATE meta SET value=? WHERE key=?',value,key);
const snapshot=f=>({
 meta:sql(f,'SELECT key,CAST(value AS BLOB) AS bytes FROM meta ORDER BY key'),
 owners:sql(f,'SELECT * FROM storage_owners ORDER BY owner_id'),
 reservations:sql(f,'SELECT * FROM storage_reservations ORDER BY reservation_id'),
 jobs:sql(f,'SELECT * FROM jobs'),attempts:sql(f,'SELECT * FROM attempts'),
 sessions:sql(f,'SELECT * FROM sessions'),runs:sql(f,'SELECT * FROM aux_runs'),
});

function observe(key,action){
 const original=DatabaseSync.prototype.prepare,transfers=[];let observations=0,result,error;
 DatabaseSync.prototype.prepare=function(query){
  const statement=original.call(this,query);
  return new Proxy(statement,{get(target,property){
   if(property==='get')return(...args)=>{
    const row=target.get(...args);
    if(query.includes('FROM meta')&&args.includes(key)&&row){
     observations++;
     if(typeof row.value==='string')transfers.push({type:'text',bytes:Buffer.byteLength(row.value)});
     else if(row.value instanceof Uint8Array)transfers.push({type:'binary',bytes:row.value.byteLength});
    }
    return row;
   };
   const value=Reflect.get(target,property,target);
   return typeof value==='function'?value.bind(target):value;
  }});
 };
 try{try{result=action();}catch(e){error=e;}}
 finally{DatabaseSync.prototype.prepare=original;}
 return {result,error,transfers,observations};
}
function rejected(out,marker='IDENTITY_REJECTION'){
 assert.equal(out.error?.code,'E_CAPABILITY',marker);
 assert.equal(out.error?.message,'storage: coordinator identity unavailable or inconsistent',marker);
}
function bounded(out){
 assert.ok(out.observations>0,'observer must see the selected metadata query');
 assert.ok(out.transfers.every(x=>x.type==='text'&&x.bytes<=8192),'IDENTITY_PREMATERIALIZATION');
}
const paths=[
 ['anchor-open','anchor',(f,a,b)=>f.open()],
 ['anchor-initialize','anchor',(f,a,b)=>WorkspaceCoordinator.initialize(f.directory,workspace)],
 ['anchor-hold','anchor',(f,a,b)=>a.withWorkspaceLock(()=>{})],
 ['anchor-close','anchor',(f,a,b)=>a.close()],
 ['owner-read-self','self',(f,a,b)=>a.readOwner(a.owner_id)],
 ['owner-hold','self',(f,a,b)=>a.withWorkspaceLock(()=>{})],
 ['owner-read-foreign','foreign',(f,a,b)=>a.readOwner(b.owner_id)],
 ['owner-retire-foreign','foreign',(f,a,b)=>a.retireOwner(b.owner_id)],
];
for(const [name,kind,action] of paths)test(`Identity envelope: ${name} refuses excess before transfer`,()=>fixture(f=>{
 const a=f.open(),b=f.open(),key=kind==='anchor'?anchorKey:ownerKey(kind==='self'?a.owner_id:b.owner_id);
 const saved=read(f,key);
 try{
  set(f,key,saved+' '.repeat(8193));const before=snapshot(f);
  const out=observe(key,()=>action(f,a,b));rejected(out);bounded(out);
  assert.deepEqual(snapshot(f),before,'identity failure must preserve all persisted records');
  assert.equal(pythonTry(f.lock),'acquired');assert.equal(pythonTry(ownerPath(f,b.owner_id)),'busy');
 }finally{set(f,key,saved);}
 assert.equal(b.readOwner(b.owner_id).state,'active');
}));

for(const kind of ['anchor','owner'])for(const payload of ['unicode','binary'])test(`Identity envelope: ${kind} ${payload} is bounded by bytes and type`,()=>fixture(f=>{
 const a=f.open(),b=f.open(),key=kind==='anchor'?anchorKey:ownerKey(b.owner_id),saved=read(f,key);
 try{
  set(f,key,payload==='unicode'?saved+'é'.repeat(5000):Buffer.alloc(9000,65));const before=snapshot(f);
  const out=observe(key,()=>kind==='anchor'?a.withWorkspaceLock(()=>{}):a.readOwner(b.owner_id));
  rejected(out);bounded(out);assert.deepEqual(snapshot(f),before);
 }finally{set(f,key,saved);}
 assert.equal(pythonTry(f.lock),'acquired');assert.equal(pythonTry(ownerPath(f,b.owner_id)),'busy');
}));

for(const kind of ['anchor','owner'])for(const edge of ['short','exact'])test(`Identity envelope: ${kind} ${edge} NUL suffix is not complete text`,()=>fixture(f=>{
 const a=f.open(),b=f.open(),key=kind==='anchor'?anchorKey:ownerKey(b.owner_id),saved=read(f,key);
 const value=saved+'\0'+(edge==='exact'?'x'.repeat(8192-Buffer.byteLength(saved)-1):'hidden');
 try{
  set(f,key,value);const before=snapshot(f);
  const out=observe(key,()=>kind==='anchor'?a.withWorkspaceLock(()=>{}):a.readOwner(b.owner_id));
  rejected(out,'IDENTITY_TEXT_COMPLETENESS');bounded(out);assert.deepEqual(snapshot(f),before);
 }finally{set(f,key,saved);}
 assert.equal(a.readOwner(b.owner_id).state,'active');
}));

for(const kind of ['anchor','owner'])for(const bytes of [8191,8192])test(`Identity envelope: ${kind} valid ${bytes} bytes remains inclusive`,()=>fixture(f=>{
 const a=f.open(),b=f.open(),key=kind==='anchor'?anchorKey:ownerKey(b.owner_id),saved=read(f,key);
 try{
  set(f,key,saved+' '.repeat(bytes-Buffer.byteLength(saved)));const before=snapshot(f);
  const out=observe(key,()=>kind==='anchor'?a.withWorkspaceLock(()=> 'valid'):a.readOwner(b.owner_id));
  assert.equal(out.error,undefined,'IDENTITY_INCLUSIVE_BOUND');bounded(out);
  assert.ok(out.transfers.some(x=>x.bytes===bytes),'driver must actually return the full valid boundary');
  assert.deepEqual(snapshot(f),before);
 }finally{set(f,key,saved);}
}));

test('Identity envelope: absent owner differs from orphan metadata without adoption',()=>fixture(f=>{
 const a=f.open(),unknown=id(901),key=ownerKey(unknown);
 assert.equal(a.readOwner(unknown),null);const before=snapshot(f);
 sql(f,'INSERT INTO meta(key,value) VALUES (?,?)',key,'{}');
 try{rejected(observe(key,()=>a.readOwner(unknown)));assert.equal(sql(f,'SELECT * FROM storage_owners WHERE owner_id=?',unknown).length,0);}
 finally{sql(f,'DELETE FROM meta WHERE key=?',key);}
 assert.deepEqual(snapshot(f),before);
}));

test('Identity envelope: incomplete anchor revokes an already issued hold',()=>fixture(f=>{
 const a=f.open(),saved=read(f,anchorKey);let hold,inner;
 try{
  const out=observe(anchorKey,()=>a.withWorkspaceLock(h=>{
   hold=h;set(f,anchorKey,saved+'\0suffix');
   try{assertWorkspaceHold(workspace,h);}catch(e){inner=e;}
  }));
  assert.equal(inner?.code,'E_CAPABILITY','IDENTITY_HOLD_COMPLETENESS');
  rejected(out);bounded(out);
 }finally{set(f,anchorKey,saved);}
 assert.throws(()=>assertWorkspaceHold(workspace,hold),e=>e.code==='E_OWNER');
 assert.equal(pythonTry(f.lock),'acquired');assert.equal(pythonTry(ownerPath(f,a.owner_id)),'busy');
}));

test('Identity envelope: concurrent write cannot split scalar and value snapshots',()=>fixture(f=>{
 const a=f.open(),b=f.open(),key=ownerKey(b.owner_id),saved=read(f,key),original=DatabaseSync.prototype.prepare;
 let writes=0;
 DatabaseSync.prototype.prepare=function(query){
  const statement=original.call(this,query);
  return new Proxy(statement,{get(target,property){
   if(property==='get')return(...args)=>{
    const row=target.get(...args);
    if(!writes&&query.includes('FROM meta')&&args.includes(key)&&typeof row?.value==='string'){
     writes++;const writer=new DatabaseSync(f.path);
     try{writer.prepare('UPDATE meta SET value=? WHERE key=?').run(saved+' '.repeat(8193),key);}finally{writer.close();}
    }
    return row;
   };
   const value=Reflect.get(target,property,target);return typeof value==='function'?value.bind(target):value;
  }});
 };
 try{
  assert.equal(a.readOwner(b.owner_id).process_instance,b.process_instance);
  assert.equal(writes,1,'concurrent writer must commit between retrieval and validation');
 }finally{DatabaseSync.prototype.prepare=original;}
 try{const out=observe(key,()=>a.readOwner(b.owner_id));rejected(out);bounded(out);}
 finally{set(f,key,saved);}
 assert.equal(a.readOwner(b.owner_id).state,'active');
}));
