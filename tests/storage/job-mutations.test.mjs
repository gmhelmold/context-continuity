/** Selected controls and deliberately incorrect copies. A red control is never detection. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url));
const cases=[
 ['expectation','!equal(ref, expected) || ','','WP02C: incorrect expected identity and scope cannot import another generation'],
 ['one-dispatch',"a.state !== 'reserved' || ",'','WP02C: repeated dispatch intent and cross-attempt substitution are refused'],
 ['source-admission','  verifyJobSources(db, b, record);','  void record;','WP02C: source bytes are reverified at admission and before dispatch'],
 ['output-budget','amount.output_tokens !== cfg.limits.output_reserve || ','','WP02C: quota, frozen output reserve and input limit are enforced before allocation'],
 ['source-classification','if (error instanceof ContractError || error instanceof ManifestError)','if (false)','WP02C: caller cannot promote source authority through its manifest'],
 ['proposal-immutability','return parseModelProposal(canonical(r.value), context.manifest, context.snapshot.feedback_ids);','return json(canonical(r.value)) as ModelProposal;','WP02C review: ready proposal returned by storage is deeply immutable'],
 ['proposal-checksum','if (r.digest !== hashPayload({ ref, value: r.value }))','if (false)','WP02C review: stored proposal corruption does not survive a plain diagnostic read'],
 ['blank-result',"if (result.finish === 'complete' && !result.text.trim().length)",'if (false)','WP02C review: blank output is terminal no-gain, not a repair opportunity'],
 ['source-stage',"status = cause.code === 'E_BUDGET' ? 'failed' : 'rejected';","status = 'running'; retry = { kind: 'repair', not_before_ms: now };",'WP02C review: malformed persisted source is not repaired by another model call'],
];
test('WP02C: nine selected positive controls reject their incorrect durable-job implementations',{timeout:180000},()=>{
 for(const [name,from,to,expected] of cases)for(const mutant of [false,true]){
  const directory=mkdtempSync(join(tmpdir(),'cc-job-mut-'));
  try{
   for(const path of ['packages/core/src','packages/storage/src'])cpSync(join(root,path),join(directory,path),{recursive:true});
   mkdirSync(join(directory,'tests/storage'),{recursive:true});
   for(const file of ['jobs.test.mjs','job-fixtures.mjs'])cpSync(join(root,'tests/storage',file),join(directory,'tests/storage',file));
   writeFileSync(join(directory,'package.json'),'{"type":"module"}');
   const file=join(directory,'packages/storage/src/job-records.ts'),source=readFileSync(file,'utf8');
   assert.equal(source.split(from).length-1,1,name+': mutation target must be unique');
   if(mutant)writeFileSync(file,source.replace(from,to));
   const env={...process.env};delete env.NODE_TEST_CONTEXT;
   const result=spawnSync(process.execPath,['--experimental-strip-types','--test','--test-reporter=tap','--test-name-pattern=^'+expected+'$','tests/storage/jobs.test.mjs'],{cwd:directory,env,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
   assert.equal(result.error,undefined,name+': timeout/setup is not detection');assert.equal(result.signal,null);
   assert.match(result.stdout,/^# tests 1$/m,name+': one selected test must execute');
   if(!mutant)assert.equal(result.status,0,result.stdout+result.stderr);
   else{assert.equal(result.status,1,name+': mutant survived');assert.ok(result.stdout.split('\n').some(l=>l.startsWith('not ok ')&&l.endsWith(' - '+expected)));assert.match(result.stdout,/ERR_ASSERTION/);console.log('WP02C_MUTATION',name,'control_passed mutant_rejected_by_assertion');}
  }finally{rmSync(directory,{recursive:true,force:true});}
 }
});
