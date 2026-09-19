/** Deliberately incorrect copies are private fixtures; never patched into the checkout. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url));
const cases=[
 ['construction-origin', 'if (key !== constructionKey)', 'if (false)', 'Coordinator review: direct JavaScript construction is rejected before acquiring resources'],
 ['bound-async', 'Object.getPrototypeOf(callback) !== Function.prototype || ', '', 'Coordinator review: binding an async function cannot execute it inside a synchronous hold'],
 ['rollback-poison', "poisoned.add(handle);\n        try { handle.db.close(); } catch { /* Remains unusable even when driver close fails. */ }", 'void handle;', 'Coordinator review: rollback failure cannot leave a usable borrowed section'],
 ['cleanup-error', 'try { handle?.db.close(); } catch (cause) { failure ??= cause; }', 'handle?.db.close();', 'Coordinator review: connection cleanup errors never expose raw driver details'],
 ['anchor','if (!r || !equal(data(r.value), anchor(resources, handle.identity)))','if (!r)','Coordinator: new instance refuses replaced lock against durable anchor'],
 ['owner-lock','if (!owner.tryLock())','if (false)','Coordinator: open publishes one owner only while its actual file is locked'],
 ['hold-expiry','finally { holds.delete(hold); }','finally { /* incorrect retained hold */ }','Coordinator: an old hold stays expired even inside a later valid section'],
 ['busy-owner','if (!inspected.tryLock())','if (false)','Coordinator: self and old-but-held owner are not retired by inspection'],
 ['reservation','noReservations(this.#handle, id);','void id;','Coordinator: staging reservation prevents automatic retirement and is preserved'],
 ['owner-identity','if (!sameFile(inspected.identity, row.identity)) return capability();','void row.identity;','Coordinator: replacing an old owner file does not provide retirement authority'],
];
test('Coordinator proof: ten positive controls reject ten incorrect coordinator implementations',{timeout:180000},()=>{
 for(const [name,from,to,expected]of cases)for(const mutant of [false,true]){
  const directory=mkdtempSync(join(tmpdir(),'cc-coordinator-mut-'));
  try{
   for(const path of ['packages/core/src','packages/storage/src','packages/storage/native/build'])cpSync(join(root,path),join(directory,path),{recursive:true});
   mkdirSync(join(directory,'tests/coordination'),{recursive:true});
   for(const file of ['coordinator-fixtures.mjs','workspace-coordinator.test.mjs'])cpSync(join(root,'tests/coordination',file),join(directory,'tests/coordination',file));
   writeFileSync(join(directory,'package.json'),'{"type":"module"}');
   const path=join(directory,'packages/storage/src/workspace-coordinator.ts'),source=readFileSync(path,'utf8');
   assert.equal(source.split(from).length-1,1,name+': mutation anchor must be unique');if(mutant)writeFileSync(path,source.replace(from,to));
   const env={...process.env};delete env.NODE_TEST_CONTEXT;
   const result=spawnSync(process.execPath,['--experimental-strip-types','--test','--test-reporter=tap','--test-name-pattern=^'+expected+'$','tests/coordination/workspace-coordinator.test.mjs'],{cwd:directory,env,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
   assert.equal(result.error,undefined,name+': timeout or initialization is not detection');assert.equal(result.signal,null);assert.match(result.stdout,/^# tests 1$/m);
   if(!mutant)assert.equal(result.status,0,result.stdout+result.stderr);
   else{assert.equal(result.status,1,name+': incorrect implementation survived');assert.ok(result.stdout.split('\n').some(l=>l.startsWith('not ok ')&&l.endsWith(' - '+expected)));assert.match(result.stdout,/ERR_ASSERTION/);console.log('COORDINATOR_MUTATION',name,'control_passed mutant_rejected_by_assertion');}
  }finally{rmSync(directory,{recursive:true,force:true});}
 }
});
