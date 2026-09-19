/** Review regression: observe the public hold boundary before its outer catch.
 * Real SQLite query failures in private synthetic fixtures; no product telemetry. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {assertWorkspaceHold} from '../../packages/storage/src/workspace-coordinator.ts';
import {StorageError} from '../../packages/storage/src/errors.ts';
import {fixture,workspace,sql,pythonTry,ownerPath} from './coordinator-fixtures.mjs';

const anchorKey='coordinator.anchor.v1';
const snapshot=f=>({
 meta:sql(f,'SELECT key,CAST(value AS BLOB) AS bytes FROM meta ORDER BY key'),
 owners:sql(f,'SELECT * FROM storage_owners ORDER BY owner_id'),
 reservations:sql(f,'SELECT * FROM storage_reservations ORDER BY reservation_id'),
 sessions:sql(f,'SELECT * FROM sessions'),
 jobs:sql(f,'SELECT * FROM jobs'),attempts:sql(f,'SELECT * FROM attempts'),runs:sql(f,'SELECT * FROM aux_runs'),
});

function failQueryOnce(selected,key,action){
 const original=DatabaseSync.prototype.prepare;let failures=0;
 DatabaseSync.prototype.prepare=function(query){
  const db=this,statement=original.call(db,query);
  return new Proxy(statement,{get(target,property){
   if(property==='get')return(...args)=>{
    const matches=selected==='encoding'?query==='PRAGMA encoding':query.includes('FROM meta')&&args.includes(key);
    if(matches&&failures===0){
     failures++;
     // SQLite itself creates the diagnostic; the missing table is fixture-only.
     return original.call(db,'SELECT * FROM private_identity_review_table').get();
    }
    return target.get(...args);
   };
   const value=Reflect.get(target,property,target);
   return typeof value==='function'?value.bind(target):value;
  }});
 };
 try{action();}finally{DatabaseSync.prototype.prepare=original;}
 return failures;
}

for(const selected of ['encoding','anchor','owner']){
 test(`Identity review: caller catches ${selected} query failure only as StorageError`,()=>fixture(f=>{
  const a=f.open(),b=f.open(),before=snapshot(f);
  const key=selected==='owner'?`coordinator.owner.v1:${a.owner_id}`:anchorKey;
  let caught,issued,returned,failures,resumed,heldDuring;
  a.withWorkspaceLock(hold=>{
   issued=hold;
   failures=failQueryOnce(selected,key,()=>{
    try{returned=assertWorkspaceHold(workspace,hold);}catch(error){caught=error;}
   });
   // The caller catches the error before withWorkspaceLock can normalize it.
   // Keep assertions outside that catch boundary so their failure stays visible.
   heldDuring=pythonTry(f.lock);
   resumed=assertWorkspaceHold(workspace,hold);
  });
  assert.equal(failures,1,'IDENTITY_REVIEW_FAULT_REACHED');
  assert.equal(returned,undefined,'a failed guard must not return authority');
  assert.equal(caught?.code,'E_STORAGE','IDENTITY_GUARD_SANITIZED');
  assert.ok(caught instanceof StorageError,'IDENTITY_GUARD_SANITIZED');
  assert.equal(caught.reason,'operation failed','IDENTITY_GUARD_SANITIZED');
  assert.equal(caught.message,'storage: operation failed','IDENTITY_GUARD_SANITIZED');
  assert.equal(caught.cause,undefined,'private driver cause must not be retained');
  assert.ok(!String(caught.stack).includes('private_identity_review_table'),'IDENTITY_GUARD_SANITIZED');
  assert.equal(resumed,issued,'fresh validation may succeed after a transient read failure');
  assert.equal(heldDuring,'busy','failed validation must not drop the surrounding lock');
  assert.throws(()=>assertWorkspaceHold(workspace,issued),error=>error.code==='E_OWNER');
  assert.equal(pythonTry(f.lock),'acquired');
  assert.equal(pythonTry(ownerPath(f,a.owner_id)),'busy');
  assert.equal(pythonTry(ownerPath(f,b.owner_id)),'busy');
  assert.deepEqual(snapshot(f),before,'guard failure and retry must not mutate durable records');
  assert.equal(a.readOwner(b.owner_id).state,'active');
 }));
}
