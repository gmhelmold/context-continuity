/** Remove only the public-boundary sanitizer in disposable copies. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url));
const guarded='try { holds.get(input)!(); } catch (cause) { return storageFailure(cause); }';
for(const selected of ['encoding','anchor','owner'])test(`Identity guard mutation: ${selected} preserves the public error boundary`,{timeout:90000},()=>{
 const name=`Identity review: caller catches ${selected} query failure only as StorageError`;
 for(const mutant of [false,true]){
  const directory=mkdtempSync(join(tmpdir(),'cc-identity-guard-mut-'));
  try{
   for(const path of ['packages/core/src','packages/storage/src','packages/storage/native/build'])
    cpSync(join(root,path),join(directory,path),{recursive:true});
   mkdirSync(join(directory,'tests/coordination'),{recursive:true});
   for(const file of ['coordinator-fixtures.mjs','coordinator-identity-review.test.mjs'])
    cpSync(join(root,'tests/coordination',file),join(directory,'tests/coordination',file));
   writeFileSync(join(directory,'package.json'),'{"type":"module"}');
   const path=join(directory,'packages/storage/src/workspace-coordinator.ts'),source=readFileSync(path,'utf8');
   assert.equal(source.split(guarded).length-1,1,'public sanitizer mutation anchor must be unique');
   if(mutant)writeFileSync(path,source.replace(guarded,'holds.get(input)!();'));
   const env={...process.env};delete env.NODE_TEST_CONTEXT;
   const result=spawnSync(process.execPath,['--experimental-strip-types','--test','--test-reporter=tap',
    '--test-name-pattern=^'+name+'$','tests/coordination/coordinator-identity-review.test.mjs'],
    {cwd:directory,env,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
   assert.equal(result.error,undefined,'timeout or startup is not detection');
   assert.equal(result.signal,null);assert.match(result.stdout,/^# tests 1$/m);
   if(!mutant)assert.equal(result.status,0,result.stdout+result.stderr);
   else{
    assert.equal(result.status,1,'unsanitized public guard regression survived');
    assert.ok(result.stdout.split('\n').some(line=>line.startsWith('not ok ')&&line.endsWith(' - '+name)));
    assert.match(result.stdout,/ERR_ASSERTION/);
    assert.ok(result.stdout.includes('IDENTITY_GUARD_SANITIZED'),result.stdout+result.stderr);
    console.log('IDENTITY_GUARD_MUTATION',selected,'control_passed mutant_rejected_by_named_assertion');
   }
  }finally{rmSync(directory,{recursive:true,force:true});}
 }
});
