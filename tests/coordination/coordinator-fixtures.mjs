/** Only synthetic local databases, paths and child processes. */
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {SqliteSessionStore} from '../../packages/storage/src/index.ts';
import {WorkspaceCoordinator} from '../../packages/storage/src/workspace-coordinator.ts';
export const id=n=>`00000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
export const workspace={installation_id:id(1),workspace_id:id(2)};
export const reject=(fn,...codes)=>assert.throws(fn,e=>codes.includes(e.code));
export function sql(f,query,...args){const db=new DatabaseSync(f.path);try{return db.prepare(query).all(...args);}finally{db.close();}}
export function exec(f,query){const db=new DatabaseSync(f.path);try{db.exec(query);}finally{db.close();}}
export function fixture(action,{initialize=true}={}){
 const directory=mkdtempSync(join(tmpdir(),'cc-coordinator-fixture-')),owners=[];
 SqliteSessionStore.create(directory,workspace).close();
 if(initialize)WorkspaceCoordinator.initialize(directory,workspace);
 const f={directory,path:join(directory,'ledger.sqlite'),lock:join(directory,'workspace.lock'),owners:join(directory,'owners'),workspace,
  open:()=>{const c=WorkspaceCoordinator.open(directory,workspace);owners.push(c);return c;}};
 const close=()=>{let error;for(const c of owners){try{c.close();}catch(e){error??=e;}}rmSync(directory,{recursive:true,force:true});if(error)throw error;};
 try{const result=action(f);if(result?.then)return result.finally(close);close();return result;}catch(e){try{close();}catch{}throw e;}
}
export function pythonTry(path){
 const code=`import os,fcntl,sys\nfd=os.open(sys.argv[1],os.O_RDWR)\ntry:\n try:\n  fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)\n  print('acquired')\n except BlockingIOError:\n  print('busy')\nfinally:\n os.close(fd)`;
 const r=spawnSync('python3',['-c',code,path],{encoding:'utf8',timeout:10000});
 assert.equal(r.error,undefined,'witness startup or timeout is not a result');assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr);return r.stdout.trim();
}
export const ownerPath=(f,id)=>join(f.owners,id+'.lock');
