/** Mutations run only in disposable copies. Setup failures never count as evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,cpSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url));
const cases=[
 ['control',null,null,null],
 ['job-ignored','actual.job_id !== e.job_id || ','','T02.contract Job: expected job_id cannot be substituted'],
 ['context-digest-ignored',' || actual.context_digest !== e.context_digest','','T02.contract Job: expected context_digest cannot be substituted'],
 ['restore-expectation-ignored','expectReference(reference(record), expected);','void expected;','T06.contract Job: recalculated frame_id cannot replace the admitted snapshot'],
 ['binding-ignored','assertSessionBinding(binding, context.record.binding);','void binding;','T02.contract Job: binding remains mandatory during decoding, export and restoration'],
 ['result-job-ignored','expectReference(result.ref, context.ref);','void result;','T02.contract Job: same manifest never makes different generations interchangeable'],
 ['feedback-expanded','manifest, context.record.snapshot.feedback_ids);',"manifest, [...context.record.snapshot.feedback_ids, '00000000-0000-4000-8000-00000000005b']);",'T06.contract Job: declared feedback cannot augment the frozen delivery batch'],
];
test('WP-01/D: positive control and six incorrect generation bindings are distinguished',{timeout:120000},()=>{
 for(const [name,from,to,expected] of cases){
  const dir=mkdtempSync(join(tmpdir(),'cc-job-mutation-'));
  try{
   mkdirSync(join(dir,'packages/core'),{recursive:true});mkdirSync(join(dir,'tests/core'),{recursive:true});
   cpSync(join(root,'packages/core/src'),join(dir,'packages/core/src'),{recursive:true});
   writeFileSync(join(dir,'package.json'),'{"type":"module"}');
   for(const file of ['context-fixtures.mjs','job-context.test.mjs'])cpSync(join(root,'tests/core',file),join(dir,'tests/core',file));
   if(from){const path=join(dir,'packages/core/src/job-context.ts'),s=readFileSync(path,'utf8');assert.equal(s.split(from).length,2,name+': mutation point must be unique');writeFileSync(path,s.replace(from,to));}
   const env={...process.env};delete env.NODE_TEST_CONTEXT;
   const run=spawnSync(process.execPath,['--experimental-strip-types','--test','--test-reporter=tap','tests/core/job-context.test.mjs'],{cwd:dir,env,encoding:'utf8',timeout:20000,maxBuffer:2*1024*1024});
   assert.equal(run.error,undefined,name+': setup/timeout is not detection');assert.equal(run.signal,null);
   assert.match(run.stdout,/^# tests 34$/m,name+': every test must run');
   for(const metric of ['skipped','todo','cancelled'])assert.match(run.stdout,new RegExp('^# '+metric+' 0$','m'));
   if(name==='control')assert.equal(run.status,0,run.stdout+run.stderr);
   else{
    assert.equal(run.status,1,name+': incorrect implementation survived');
    assert.ok(run.stdout.split('\n').some(line=>line.startsWith('not ok ')&&line.endsWith(' - '+expected)),name+': unrelated failure is not detection');
   }
  }finally{rmSync(dir,{recursive:true,force:true});}
 }
});
