/** Tests of resource proofs; incorrect copies exist only in disposable fixture directories. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,cpSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url));
const cases=[
 ['identity', 'if (!sameFile(identity(path), this.identity) || !sameFile(identity(current), this.identity)) fail();', 'void path;', 'Resources: replaced workspace pathname invalidates the existing manager'],
 ['busy', "if (!this.#workspace.tryLock()) throw new StorageError('E_CONFLICT', 'workspace lock busy');", 'this.#workspace.tryLock();', 'Resources: independent managers and Python agree about workspace exclusion'],
 ['children', '[...this.#owned, this.#workspace, this.#owners, this.#root]', '[this.#workspace, this.#owners, this.#root]', 'Resources review: parent close closes outstanding owners and revokes child reuse'],
 ['init-data', "typeof initialize !== 'boolean' || ", '', 'Resources review: initialization flag must be explicitly boolean'],
 ['owner-data', "typeof ownerId !== 'string' || ", '', 'Resources review: owner identifiers are strict data without coercion'],
 ['final-path', String.raw`input.replace(/\/+$/, '') || '/'`, 'input', 'Resources review: trailing slash must not hide a symlink workspace'],
];
test('Resources proof: six positive controls reject six incorrect resource implementations',{timeout:180000},()=>{
 for(const [name,from,to,expected] of cases)for(const mutate of [false,true]){
  const directory=mkdtempSync(join(tmpdir(),'cc-resource-mut-'));
  try{
   const dst=join(directory,'packages/storage/src');mkdirSync(dst,{recursive:true});
   for(const name of ['errors.ts','lock-resources.ts'])cpSync(join(root,'packages/storage/src',name),join(dst,name));
   mkdirSync(join(directory,'packages/storage/native/build'),{recursive:true});
   cpSync(join(root,'packages/storage/native/build/locks.node'),join(directory,'packages/storage/native/build/locks.node'));
   mkdirSync(join(directory,'tests/coordination'),{recursive:true});cpSync(join(root,'tests/coordination/lock-resources.test.mjs'),join(directory,'tests/coordination/lock-resources.test.mjs'));
   writeFileSync(join(directory,'package.json'),'{"type":"module"}');
   const file=join(dst,'lock-resources.ts'),source=readFileSync(file,'utf8');assert.equal(source.split(from).length-1,1,name+': unique mutation site');
   if(mutate)writeFileSync(file,source.replace(from,to));
   const env={...process.env};delete env.NODE_TEST_CONTEXT;
   const r=spawnSync(process.execPath,['--experimental-strip-types','--test','--test-reporter=tap','--test-name-pattern=^'+expected+'$','tests/coordination/lock-resources.test.mjs'],{cwd:directory,env,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
   assert.equal(r.error,undefined,name+': setup or timeout is not detection');assert.equal(r.signal,null);assert.match(r.stdout,/^# tests 1$/m);
   if(!mutate)assert.equal(r.status,0,r.stdout+r.stderr);
   else{assert.equal(r.status,1,name+': mutant survived');assert.ok(r.stdout.split('\n').some(l=>l.startsWith('not ok ')&&l.endsWith(' - '+expected)));assert.match(r.stdout,/ERR_ASSERTION/);console.log('RESOURCE_MUTATION',name,'control_passed mutant_rejected_by_assertion');}
  }finally{rmSync(directory,{recursive:true,force:true});}
 }
});
