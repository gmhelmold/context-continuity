/** Negative component tests in disposable copies only. No host, provider or user data. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url));
const cases=[
 ['control',null,null,null,null,0],
 ['catalog-check','root-records.ts','if (before.catalog_digest !== input.expected_catalog_digest)','if (false)','WP02B: stale catalog rejects the whole batch before source insertion',1],
 ['source-hash','source-records.ts','hashSource(bytes) !== ref.digest','false','WP02B: mismatched supplied source hash is rejected before writes',2],
 ['source-read-integrity','source-records.ts','row.size_bytes !== bytes.length || hashSource(bytes) !== ref.digest','false','WP02B: corrupt retained bytes are not returned or accepted as root provenance',1],
 ['owner-check','session-store.ts','this.#owned(lease, this.#now());','void lease;','WP02B: expired and superseded owners cannot retain data',4],
];
const pattern='stale catalog rejects|mismatched supplied source hash|corrupt retained bytes|expired and superseded owners';
test('WP02B: positive control and four incorrect retention implementations are distinguished',{timeout:180000},()=>{
 for(const [name,file,from,to,expected,count] of cases){
  const dir=mkdtempSync(join(tmpdir(),'cc-retention-mut-'));
  try{
   for(const path of ['packages/core/src','packages/storage/src'])cpSync(join(root,path),join(dir,path),{recursive:true});
   mkdirSync(join(dir,'tests/storage'),{recursive:true});cpSync(join(root,'tests/storage/root-retention.test.mjs'),join(dir,'tests/storage/root-retention.test.mjs'));
   writeFileSync(join(dir,'package.json'),'{"type":"module"}');
   if(file){const path=join(dir,'packages/storage/src',file),s=readFileSync(path,'utf8');assert.equal(s.split(from).length-1,count,name);writeFileSync(path,s.replaceAll(from,to));}
   const env={...process.env};delete env.NODE_TEST_CONTEXT;
   const r=spawnSync(process.execPath,['--experimental-strip-types','--test','--test-reporter=tap','--test-name-pattern='+pattern,'tests/storage/root-retention.test.mjs'],{cwd:dir,env,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
   assert.equal(r.error,undefined,name+': setup/timeout is not detection');assert.equal(r.signal,null);
   assert.match(r.stdout,/^# tests 4$/m,name+': four selected cases must run');
   if(name==='control')assert.equal(r.status,0,r.stdout+r.stderr);
   else{assert.equal(r.status,1,name+': mutant survived');assert.ok(r.stdout.split('\n').some(l=>l.startsWith('not ok ')&&l.endsWith(' - '+expected)),name+': unrelated failure is not detection');assert.match(r.stdout,/ERR_ASSERTION/);}
  }finally{rmSync(dir,{recursive:true,force:true});}
 }
});
