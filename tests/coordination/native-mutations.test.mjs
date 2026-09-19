/** Test-only incorrect builds in disposable directories; never replace the product binary. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url));
const cases=[
 ['fake-lock','if (flock(fd, LOCK_EX | LOCK_NB) == 0)','if (1)','OS lock: independent Python witness observes exclusion and explicit release'],
 ['busy-is-success','if (errno == EWOULDBLOCK || errno == EAGAIN) return boolean_result(env, 0);','if (errno == EWOULDBLOCK || errno == EAGAIN) return boolean_result(env, 1);','OS lock: independent opens in the same process conflict rather than acting reentrant'],
 ['private-mode','(st.st_mode & 07777) != 0600','0','OS lock: mode 644 is refused without taking the lock'],
 ['fake-unlock','if (flock(fd, LOCK_UN) != 0)','if (0)','OS lock: independent Python witness observes exclusion and explicit release'],
 ['hardlink-accepted','st.st_nlink != 1','0','OS lock: multiply-linked inode is rejected'],
];
test('OS lock proofs: five controls and five incorrect native builds are distinguished',{timeout:120000},()=>{
 for(const [name,from,to,expected] of cases)for(const incorrect of [false,true]){
  const directory=mkdtempSync(join(tmpdir(),'cc-lock-proof-'));
  try{
   for(const part of ['packages/storage/native','scripts','tests/coordination'])mkdirSync(join(directory,part),{recursive:true});
   const source=readFileSync(join(root,'packages/storage/native/locks.c'),'utf8');
   assert.equal(source.split(from).length-1,1,'unique mutation target '+name);
   writeFileSync(join(directory,'packages/storage/native/locks.c'),incorrect?source.replace(from,to):source);
   copyFileSync(join(root,'scripts/build-locks.mjs'),join(directory,'scripts/build-locks.mjs'));
   copyFileSync(join(root,'tests/coordination/native-locks.test.mjs'),join(directory,'tests/coordination/native-locks.test.mjs'));
   writeFileSync(join(directory,'package.json'),'{"type":"module"}');
   const env={...process.env};delete env.NODE_TEST_CONTEXT;delete env.CC_TEST_LOCK_MODULE;
   const build=spawnSync(process.execPath,['scripts/build-locks.mjs'],{cwd:directory,env,encoding:'utf8',timeout:15000});
   assert.equal(build.error,undefined,'build failure is not detection');assert.equal(build.status,0,build.stderr);
   const result=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^'+expected+'$','tests/coordination/native-locks.test.mjs'],{cwd:directory,env,encoding:'utf8',timeout:15000});
   assert.equal(result.error,undefined,'timeout/setup is not detection');assert.equal(result.signal,null);assert.match(result.stdout,/^# tests 1$/m);
   if(!incorrect)assert.equal(result.status,0,result.stdout+result.stderr);
   else{assert.equal(result.status,1,name+' survived');assert.ok(result.stdout.split('\n').some(l=>l.startsWith('not ok ')&&l.endsWith(' - '+expected)));assert.match(result.stdout,/ERR_ASSERTION/);console.log('LOCK_MUTATION',name,'control_passed mutant_rejected_by_assertion');}
  }finally{rmSync(directory,{recursive:true,force:true});}
 }
});
