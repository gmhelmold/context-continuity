/** Commit barriers on our own disposable SQLite databases and child processes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fixture,workspace,sql,reject,ownerPath,pythonTry} from './coordinator-fixtures.mjs';
const module=new URL('../../packages/storage/src/workspace-coordinator.ts',import.meta.url).href;
const coreStore=new URL('../../packages/storage/src/index.ts',import.meta.url).href;
async function stoppedAtBarrier(code,body){
 const child=spawn(process.execPath,['--experimental-strip-types','--input-type=module','-e',code],{stdio:['ignore','pipe','pipe']});
 let stderr='',timer;child.stderr.on('data',d=>stderr+=d);
 const exited=new Promise((resolve,reject)=>{child.once('exit',(c,s)=>resolve({code:c,signal:s}));child.once('error',reject);});
 try{
  const message=await new Promise((resolve,reject)=>{let out='';timer=setTimeout(()=>reject(Error('commit barrier deadline '+stderr)),15000);
   child.stdout.on('data',d=>{out+=d;const n=out.indexOf('\n');if(n>=0){clearTimeout(timer);try{resolve(JSON.parse(out.slice(0,n)));}catch(e){reject(e);}}});
   child.once('error',reject);child.once('exit',()=>reject(Error('early fixture exit '+stderr)));
  });await body(message,child,exited);
 }finally{clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}}
}
for(const operation of ['initialize','register','retire'])for(const boundary of ['before','after']){
 test(`Coordinator crash: ${operation} ${boundary} COMMIT preserves exactly the confirmed records`,{timeout:30000},()=>fixture(async f=>{
  let target=null;
  if(operation==='retire'){const a=f.open(),b=f.open();target=a.owner_id;b.withWorkspaceLock(()=>reject(()=>a.close(),'E_CONFLICT'));b.close();}
  const args={directory:f.directory,workspace,operation,boundary,target};
  const program=String.raw`
import {WorkspaceCoordinator} from ${JSON.stringify(module)};
import {DatabaseSync} from 'node:sqlite';import {writeSync} from 'node:fs';
const p=${JSON.stringify(args)};
const c=p.operation==='retire'?WorkspaceCoordinator.open(p.directory,p.workspace):null;
const prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec;let armed=false;
DatabaseSync.prototype.prepare=function(q){
 if((p.operation==='initialize'&&q==='INSERT INTO meta(key,value) VALUES (?,?)')||
    (p.operation==='register'&&q.includes('INSERT INTO storage_owners'))||
    (p.operation==='retire'&&q.startsWith("UPDATE storage_owners SET state='retired'")))armed=true;
 return prepare.call(this,q);
};
const barrier=()=>{writeSync(1,JSON.stringify({operation:p.operation,boundary:p.boundary})+'\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);};
DatabaseSync.prototype.exec=function(q){if(armed&&q==='COMMIT'&&p.boundary==='before')barrier();const value=exec.call(this,q);if(armed&&q==='COMMIT'&&p.boundary==='after')barrier();return value;};
if(p.operation==='initialize')WorkspaceCoordinator.initialize(p.directory,p.workspace);
if(p.operation==='register')WorkspaceCoordinator.open(p.directory,p.workspace);
if(p.operation==='retire')c.retireOwner(p.target);
throw Error('barrier not reached');`;
  await stoppedAtBarrier(program,async(message,child,exited)=>{
   assert.deepEqual(message,{operation,boundary});assert.equal(pythonTry(f.lock),'busy');
   child.kill('SIGKILL');const exit=await exited;assert.equal(exit.signal,'SIGKILL');assert.equal(pythonTry(f.lock),'acquired');
   if(operation==='initialize')assert.equal(sql(f,"SELECT * FROM meta WHERE key='coordinator.anchor.v1'").length,boundary==='before'?0:1);
   if(operation==='register'){
    assert.equal(sql(f,'SELECT * FROM storage_owners').length,boundary==='before'?0:1);
    assert.equal(sql(f,"SELECT * FROM meta WHERE key LIKE 'coordinator.owner.v1:%'").length,boundary==='before'?0:1);
   }
   if(operation==='retire')assert.equal(sql(f,'SELECT state FROM storage_owners WHERE owner_id=?',target)[0].state,boundary==='before'?'active':'retired');
   for(const name of readdirSync(f.owners))assert.equal(pythonTry(join(f.owners,name)),'acquired');
   const before=sql(f,'SELECT * FROM storage_owners');
   const code=`import {SqliteSessionStore} from ${JSON.stringify(coreStore)};const s=SqliteSessionStore.open(${JSON.stringify(f.directory)},${JSON.stringify(workspace)});s.close();console.log('opened');`;
   const run=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',code],{encoding:'utf8',timeout:15000});
   assert.equal(run.error,undefined);assert.equal(run.status,0,run.stderr);assert.equal(run.stdout.trim(),'opened');assert.deepEqual(sql(f,'SELECT * FROM storage_owners'),before);
   for(const table of ['sessions','jobs','attempts','aux_runs','storage_reservations'])assert.equal(sql(f,`SELECT count(*) AS n FROM ${table}`)[0].n,0);
   if(operation==='initialize'&&boundary==='before'){
    reject(()=>f.open(),'E_CAPABILITY');
    const retry=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',`import {WorkspaceCoordinator} from ${JSON.stringify(module)};WorkspaceCoordinator.initialize(${JSON.stringify(f.directory)},${JSON.stringify(workspace)});`],{encoding:'utf8',timeout:15000});
    assert.equal(retry.error,undefined);assert.equal(retry.status,0,retry.stderr);
   }
   const reopened=f.open();for(const row of before)if(row.state==='active')assert.equal(reopened.retireOwner(row.owner_id).state,'retired');
  });
 },{initialize:operation!=='initialize'}));
}
test('Coordinator: a live independent owner stays held until its own process exits',{timeout:30000},()=>fixture(async f=>{
 const observer=f.open();
 const code=String.raw`import {WorkspaceCoordinator} from ${JSON.stringify(module)};import {writeSync} from 'node:fs';const c=WorkspaceCoordinator.open(${JSON.stringify(f.directory)},${JSON.stringify(workspace)});writeSync(1,JSON.stringify({id:c.owner_id})+'\n');setInterval(()=>{},1000);`;
 await stoppedAtBarrier(code,async(message,child,exited)=>{
  assert.equal(observer.retireOwner(message.id).state,'held');assert.equal(pythonTry(ownerPath(f,message.id)),'busy');
  child.kill('SIGKILL');await exited;assert.equal(observer.readOwner(message.id).state,'active');
  assert.equal(observer.retireOwner(message.id).state,'retired');assert.equal(pythonTry(ownerPath(f,message.id)),'acquired');
 });
}));
test('Coordinator: concurrent explicit initializers converge to one stable anchor',{timeout:30000},()=>fixture(async f=>{
 const code=`import {WorkspaceCoordinator} from ${JSON.stringify(module)};try{WorkspaceCoordinator.initialize(${JSON.stringify(f.directory)},${JSON.stringify(workspace)});console.log('ok');}catch(e){if(e.code!=='E_CONFLICT')throw e;console.log('busy');}`;
 const run=()=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--experimental-strip-types','--input-type=module','-e',code],{stdio:['ignore','pipe','pipe']});let out='',err='';
  child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.once('error',reject);child.once('exit',c=>{try{assert.equal(c,0,err);resolve(out.trim());}catch(e){reject(e);}});
 });
 const results=await Promise.all([run(),run(),run()]);assert.ok(results.includes('ok'));assert.ok(results.every(x=>['ok','busy'].includes(x)));
 assert.equal(sql(f,"SELECT * FROM meta WHERE key='coordinator.anchor.v1'").length,1);assert.equal(sql(f,'SELECT * FROM storage_owners').length,0);
 const a=f.open();a.withWorkspaceLock(()=>assert.equal(pythonTry(f.lock),'busy'));
},{initialize:false}));
