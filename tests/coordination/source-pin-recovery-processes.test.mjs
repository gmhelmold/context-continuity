/** Observe exact barriers; terminate only children created by these synthetic fixtures. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pinFixture, workspace, sql, metadataKey } from './source-pin-fixtures.mjs';
import { pythonTry } from './coordinator-fixtures.mjs';
import { WorkspaceCoordinator } from '../../packages/storage/src/index.ts';
const moduleURL = new URL('../../packages/storage/src/index.ts', import.meta.url).href;
async function atBarrier(program, action) {
  const child = spawn(process.execPath, ['--experimental-strip-types','--input-type=module','-e',program], { stdio: ['pipe','pipe','pipe'] });
  let timer, stderr = ''; child.stderr.on('data', b => { stderr += b; });
  const exit = new Promise((resolve, reject) => { child.once('exit',(code,signal)=>resolve({code,signal})); child.once('error',reject); });
  try {
    const m = await new Promise((resolve, reject) => {
      let text = ''; timer = setTimeout(()=>reject(Error('recovery fixture barrier deadline '+stderr)),15000);
      child.stdout.on('data', b => { text += b; const n=text.indexOf('\n'); if(n>=0){clearTimeout(timer);try{resolve(JSON.parse(text.slice(0,n)));}catch(e){reject(e);}} });
      child.once('exit',()=>reject(Error('recovery fixture exited before barrier '+stderr)));child.once('error',reject);
    });
    await action(m,child,exit);
  } finally {
    clearTimeout(timer);
    if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exit;}
  }
}
const pause = "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);";
const params = f => JSON.stringify({ directory:f.directory, workspace, binding:f.b, request:f.request });

test('Pin recovery process: a live original blocks recovery and its own exit permits explicit cleanup', {timeout:30000}, () => pinFixture(async f => {
  const program=`import {WorkspaceCoordinator} from ${JSON.stringify(moduleURL)};import {writeSync} from 'node:fs';const p=${params(f)},c=WorkspaceCoordinator.open(p.directory,p.workspace);c.pinSource(p.binding,p.request);writeSync(1,JSON.stringify({owner:c.owner_id})+'\n');${pause}`;
  await atBarrier(program,async(m,child,exit)=>{
    assert.equal(pythonTry(join(f.directory,'owners',m.owner+'.lock')),'busy');
    assert.equal(f.coordinator.recoverSourcePin(f.b,f.request.reservation_id).state,'held');
    assert.equal(sql(f,'SELECT count(*) AS n FROM storage_reservations')[0].n,1);
    child.kill('SIGKILL'); assert.equal((await exit).signal,'SIGKILL');
    // Process exit alone changed neither the reservation nor its metadata.
    assert.equal(f.coordinator.readSourcePin(f.b,f.request.reservation_id).state,'active');
    assert.equal(f.coordinator.recoverSourcePin(f.b,f.request.reservation_id).state,'released');
    assert.equal(sql(f,'SELECT count(*) AS n FROM storage_reservations')[0].n,0);
    assert.equal(f.coordinator.readOwner(m.owner).state,'active');
  });
}));

test('Pin recovery process: a revoked storage owner can be reconciled while its process remains alive', {timeout:30000}, () => pinFixture(async f => {
  const program=`import {WorkspaceCoordinator} from ${JSON.stringify(moduleURL)};import {writeSync} from 'node:fs';const p=${params(f)},c=WorkspaceCoordinator.open(p.directory,p.workspace);c.pinSource(p.binding,p.request);let closed=false;try{c.close();}catch(e){if(e.code!=='E_CAPABILITY')throw e;closed=true;}writeSync(1,JSON.stringify({owner:c.owner_id,closed})+'\n');process.stdin.on('data',()=>writeSync(1,'PONG\n'));`;
  await atBarrier(program,async(m,child)=>{
    assert.equal(m.closed,true);assert.equal(pythonTry(join(f.directory,'owners',m.owner+'.lock')),'acquired');
    assert.equal(f.coordinator.recoverSourcePin(f.b,f.request.reservation_id).state,'released');
    const pong=new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error('closed-owner fixture did not respond')),10000);child.stdout.on('data',b=>{out+=b;if(out.includes('PONG\n')){clearTimeout(timer);resolve();}});});
    child.stdin.write('PING\n');await pong;assert.equal(child.exitCode,null);assert.equal(child.signalCode,null);
  });
}));

for(const boundary of ['before','after'])test(`Pin recovery crash: ${boundary} COMMIT preserves an atomic reservation state`, {timeout:30000}, () => pinFixture(async f => {
  const pin=f.coordinator.pinSource(f.b,f.request);assert.throws(()=>f.coordinator.close(),e=>e.code==='E_CAPABILITY');
  const p=JSON.stringify({...JSON.parse(params(f)),boundary});
  const program=String.raw`
import {WorkspaceCoordinator} from ${JSON.stringify(moduleURL)};
import {DatabaseSync} from 'node:sqlite';import {writeSync} from 'node:fs';
const p=${p},c=WorkspaceCoordinator.open(p.directory,p.workspace),prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec;let armed=false;
DatabaseSync.prototype.prepare=function(q){const st=prepare.call(this,q);if(q==='DELETE FROM storage_reservations WHERE reservation_id=? AND owner_id=?'){const run=st.run;st.run=function(...args){const r=run.apply(this,args);armed=true;return r;};}return st;};
const barrier=()=>{writeSync(1,JSON.stringify({boundary:p.boundary})+'\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);};
DatabaseSync.prototype.exec=function(q){if(armed&&q==='COMMIT'&&p.boundary==='before')barrier();const r=exec.call(this,q);if(armed&&q==='COMMIT'&&p.boundary==='after')barrier();return r;};
c.recoverSourcePin(p.binding,p.request.reservation_id);throw Error('recovery fixture missed barrier');`;
  await atBarrier(program,async(m,child,exit)=>{
    assert.equal(m.boundary,boundary);
    assert.equal(pythonTry(join(f.directory,'workspace.lock')),'busy');
    assert.equal(pythonTry(join(f.directory,'owners',pin.owner_id+'.lock')),'busy');
    child.kill('SIGKILL');assert.equal((await exit).signal,'SIGKILL');
    assert.equal(pythonTry(join(f.directory,'workspace.lock')),'acquired');
    const reader=`import {WorkspaceCoordinator} from ${JSON.stringify(moduleURL)};const p=${params(f)},c=WorkspaceCoordinator.open(p.directory,p.workspace);try{console.log(JSON.stringify(c.readSourcePin(p.binding,p.request.reservation_id)));}finally{c.close();}`;
    const read=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',reader],{encoding:'utf8',timeout:15000});
    assert.equal(read.error,undefined);assert.equal(read.signal,null);assert.equal(read.status,0,read.stderr);
    const state=JSON.parse(read.stdout).state;assert.equal(state,boundary==='before'?'active':'released');
    assert.equal(sql(f,'SELECT count(*) AS n FROM storage_reservations')[0].n,boundary==='before'?1:0);
    assert.equal(JSON.parse(sql(f,'SELECT value FROM meta WHERE key=?',metadataKey(pin.reservation_id))[0].value).value.state,state);
    const c=WorkspaceCoordinator.open(f.directory,workspace);
    try{const result=c.recoverSourcePin(f.b,pin.reservation_id);assert.equal(result.state,'released');assert.deepEqual(c.recoverSourcePin(f.b,pin.reservation_id),result);}finally{c.close();}
    for(const table of ['jobs','attempts','aux_runs','chapters'])assert.equal(sql(f,`SELECT count(*) AS n FROM ${table}`)[0].n,0);
  });
}));
