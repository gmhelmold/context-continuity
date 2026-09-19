/** Interrupt only children created by these fixtures, on exact SQLite COMMIT barriers. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pinFixture, sql, workspace, metadataKey } from './source-pin-fixtures.mjs';
import { pythonTry } from './coordinator-fixtures.mjs';
const module=new URL('../../packages/storage/src/index.ts',import.meta.url).href;
async function atBarrier(program,action){
  const child=spawn(process.execPath,['--experimental-strip-types','--input-type=module','-e',program],{stdio:['ignore','pipe','pipe']});
  let err='',timer;child.stderr.on('data',b=>err+=b);
  const exit=new Promise((resolve,reject)=>{child.once('exit',(code,signal)=>resolve({code,signal}));child.once('error',reject);});
  try{
    const message=await new Promise((resolve,reject)=>{
      let out='';timer=setTimeout(()=>reject(Error('pin fixture barrier deadline '+err)),15000);
      child.stdout.on('data',b=>{out+=b;const n=out.indexOf('\n');if(n>=0){clearTimeout(timer);try{resolve(JSON.parse(out.slice(0,n)));}catch(e){reject(e);}}});
      child.once('error',reject);child.once('exit',()=>reject(Error('pin fixture exited before barrier '+err)));
    });
    await action(message,child,exit);
  }finally{
    clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exit;}
  }
}
for(const operation of ['acquire','release'])for(const boundary of ['before','after']){
  test(`Source pin crash: ${operation} ${boundary} COMMIT preserves one consistent reservation state`,{timeout:30000},()=>pinFixture(async f=>{
    const p={directory:f.directory,workspace,binding:f.b,request:f.request,operation,boundary};
    const program=String.raw`
import {WorkspaceCoordinator} from ${JSON.stringify(module)};
import {DatabaseSync} from 'node:sqlite';import {writeSync} from 'node:fs';
const p=${JSON.stringify(p)},c=WorkspaceCoordinator.open(p.directory,p.workspace);
if(p.operation==='release')c.pinSource(p.binding,p.request);
const prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec;let armed=false;
DatabaseSync.prototype.prepare=function(q){
 if((p.operation==='acquire'&&q.startsWith('INSERT INTO storage_reservations'))||
    (p.operation==='release'&&q.startsWith('DELETE FROM storage_reservations')))armed=true;
 return prepare.call(this,q);
};
const barrier=()=>{writeSync(1,JSON.stringify({owner:c.owner_id,operation:p.operation,boundary:p.boundary})+'\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);};
DatabaseSync.prototype.exec=function(q){if(armed&&q==='COMMIT'&&p.boundary==='before')barrier();const v=exec.call(this,q);if(armed&&q==='COMMIT'&&p.boundary==='after')barrier();return v;};
if(p.operation==='acquire')c.pinSource(p.binding,p.request);else c.releaseSourcePin(p.binding,p.request.reservation_id);
throw Error('pin fixture failed to reach its barrier');`;
    await atBarrier(program,async(m,child,exit)=>{
      assert.equal(m.operation,operation);assert.equal(m.boundary,boundary);
      assert.equal(pythonTry(join(f.directory,'workspace.lock')),'busy');
      assert.equal(pythonTry(join(f.directory,'owners',m.owner+'.lock')),'busy');
      child.kill('SIGKILL');assert.equal((await exit).signal,'SIGKILL');
      assert.equal(pythonTry(join(f.directory,'workspace.lock')),'acquired');
      const code=`import {WorkspaceCoordinator} from ${JSON.stringify(module)};const c=WorkspaceCoordinator.open(${JSON.stringify(f.directory)},${JSON.stringify(workspace)});try{console.log(JSON.stringify(c.readSourcePin(${JSON.stringify(f.b)},${JSON.stringify(f.request.reservation_id)})));}finally{c.close();}`;
      const read=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',code],{encoding:'utf8',timeout:15000});
      assert.equal(read.error,undefined);assert.equal(read.status,0,read.stderr);assert.equal(read.signal,null);
      const actual=JSON.parse(read.stdout),expected=operation==='acquire'?(boundary==='before'?null:'active'):(boundary==='before'?'active':'released');
      assert.equal(actual?.state??null,expected);
      const rows=sql(f,'SELECT * FROM storage_reservations WHERE reservation_id=?',f.request.reservation_id);
      assert.equal(rows.length,expected==='active'?1:0);
      assert.equal(sql(f,'SELECT value FROM meta WHERE key=?',metadataKey(f.request.reservation_id)).length,expected===null?0:1);
      if(expected==='active'){
        assert.throws(()=>f.coordinator.retireOwner(m.owner),e=>e.code==='E_CAPABILITY');
        assert.equal(rows[0].owner_id,m.owner);
      }
      for(const table of ['jobs','attempts','aux_runs','chapters','managed_files'])assert.equal(sql(f,`SELECT count(*) AS n FROM ${table}`)[0].n,0);
    });
  }));
}
