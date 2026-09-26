/** Six controlled incorrect copies; neither setup failures nor timeouts are evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url));
const pinRecoveryStart='  recoverSourcePin(bindingInput: unknown, idInput: unknown): SourcePinRecovery {';
const pinRecoveryEnd='\n  /** Retirement is only storage-record reconciliation, never permission to clean a job. */';
function pinRecoveryRegion(source){
 const start=source.indexOf(pinRecoveryStart),end=source.indexOf(pinRecoveryEnd,start);
 assert.notEqual(start,-1,'recoverSourcePin: declaration exists');assert.equal(source.indexOf(pinRecoveryStart,start+1),-1,'recoverSourcePin: declaration unique');
 assert.notEqual(end,-1,'recoverSourcePin: bounded end exists');
 return [source.slice(0,start),source.slice(start,end),source.slice(end)];
}
const cases=[
 ['busy','if (!recoveryFile.tryLock())','if (false)','Pin recovery: live original owner remains held regardless of elapsed session time'],
 ['identity','if (!sameFile(recoveryFile.identity, original.identity)) return capability();','void original.identity;','Pin recovery: a different inode at the same pathname cannot authorize release'],
 ['final-identity','this.#guard(); recoveryFile?.guard();','this.#guard();','Pin recovery: final identity guard rolls back replacement during the transaction'],
 ['release','releaseSourcePin(this.#handle.db, binding, id, original);','void original;','Pin recovery: read_pin releases only the requested reservation'],
 ['retired','if (original.state !== \'active\')','if (false)','Pin recovery: an active pin with retired owner is inconsistent rather than eligible'],
 ['inspection-cleanup','finally { recoveryFile?.close(); }','finally { /* incorrect leaked inspection */ }','Pin recovery: inspection lock remains held at COMMIT and is closed afterwards'],
];
for(const [name,from,to,selected] of cases)test(`Pin recovery mutation: ${name} rejects the incorrect implementation`,{timeout:90000},()=>{
 for(const mutant of [false,true]){
  const directory=mkdtempSync(join(tmpdir(),'cc-pin-recovery-mutation-'));
  try{
   for(const path of ['packages/core/src','packages/storage/src','packages/storage/native/build'])cpSync(join(root,path),join(directory,path),{recursive:true});
   mkdirSync(join(directory,'tests/coordination'),{recursive:true});mkdirSync(join(directory,'tests/storage'),{recursive:true});
   cpSync(join(root,'tests/storage/job-fixtures.mjs'),join(directory,'tests/storage/job-fixtures.mjs'));
   for(const file of ['source-pin-recovery.test.mjs','source-pin-fixtures.mjs','coordinator-fixtures.mjs'])cpSync(join(root,'tests/coordination',file),join(directory,'tests/coordination',file));
   writeFileSync(join(directory,'package.json'),'{"type":"module"}');
    const path=join(directory,'packages/storage/src/workspace-coordinator.ts'),source=readFileSync(path,'utf8');
    const [before,recovery,after]=pinRecoveryRegion(source);
    assert.equal(recovery.split(from).length-1,1,name+': unique recoverSourcePin mutation anchor');
    if(mutant){const changed=before+recovery.replace(from,to)+after;assert.equal(changed.slice(0,before.length),before,name+': staging recovery unchanged');writeFileSync(path,changed);}
   const pattern='^'+selected.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$',env={...process.env};delete env.NODE_TEST_CONTEXT;
   const result=spawnSync(process.execPath,['--experimental-strip-types','--test','--test-reporter=tap','--test-name-pattern='+pattern,'tests/coordination/source-pin-recovery.test.mjs'],{cwd:directory,env,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
   assert.equal(result.error,undefined,name+': setup or timeout is not detection');assert.equal(result.signal,null);assert.match(result.stdout,/^# tests 1$/m);
   if(!mutant)assert.equal(result.status,0,result.stdout+result.stderr);
   else{assert.equal(result.status,1,name+': incorrect implementation survived');assert.ok(result.stdout.split('\n').some(l=>l.startsWith('not ok ')&&l.endsWith(' - '+selected)),result.stdout);assert.match(result.stdout,/ERR_ASSERTION/);console.log('PIN_RECOVERY_MUTATION',name,'control_passed mutant_rejected_by_assertion');}
  }finally{rmSync(directory,{recursive:true,force:true});}
 }
});
