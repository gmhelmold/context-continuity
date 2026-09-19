/** Each control/mutant executes the real loader in a disposable private copy. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url));
const cases=[
 ['projection',"CASE WHEN typeof(value)='text' AND octet_length(value) <= 8192 THEN value END AS value",'value AS value',
  'Identity envelope: owner-read-foreign refuses excess before transfer','IDENTITY_PREMATERIALIZATION'],
 ['byte-length','octet_length(value) <= 8192','length(value) <= 8192',
  'Identity envelope: owner unicode is bounded by bytes and type','IDENTITY_PREMATERIALIZATION'],
 ['inclusive','octet_length(value) <= 8192','octet_length(value) < 8192',
  'Identity envelope: anchor valid 8192 bytes remains inclusive','IDENTITY_INCLUSIVE_BOUND'],
 ['complete-text','Buffer.byteLength(r.value) !== r.size_bytes','false',
  'Identity envelope: owner short NUL suffix is not complete text','IDENTITY_TEXT_COMPLETENESS'],
 ['existence-only',"const existing = handle.db.prepare('SELECT 1 FROM meta WHERE key=?').get(ANCHOR_KEY);",
  "const existing = handle.db.prepare('SELECT value FROM meta WHERE key=?').get(ANCHOR_KEY);",
  'Identity envelope: anchor-initialize refuses excess before transfer','IDENTITY_PREMATERIALIZATION'],
];
for(const [name,from,to,selected,marker] of cases)test(`Identity envelope mutation: ${name} rejects its regression`,{timeout:90000},()=>{
 for(const mutant of [false,true]){
  const directory=mkdtempSync(join(tmpdir(),'cc-identity-envelope-mut-'));
  try{
   for(const path of ['packages/core/src','packages/storage/src','packages/storage/native/build'])
    cpSync(join(root,path),join(directory,path),{recursive:true});
   mkdirSync(join(directory,'tests/coordination'),{recursive:true});
   for(const file of ['coordinator-fixtures.mjs','coordinator-envelope-budget.test.mjs'])
    cpSync(join(root,'tests/coordination',file),join(directory,'tests/coordination',file));
   writeFileSync(join(directory,'package.json'),'{"type":"module"}');
   const path=join(directory,'packages/storage/src/workspace-coordinator.ts'),source=readFileSync(path,'utf8');
   assert.equal(source.split(from).length-1,1,name+': mutation anchor must be unique');
   if(mutant)writeFileSync(path,source.replace(from,to));
   const env={...process.env};delete env.NODE_TEST_CONTEXT;
   const result=spawnSync(process.execPath,['--experimental-strip-types','--test','--test-reporter=tap',
    '--test-name-pattern=^'+selected+'$','tests/coordination/coordinator-envelope-budget.test.mjs'],
    {cwd:directory,env,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
   assert.equal(result.error,undefined,name+': timeout or startup is not detection');
   assert.equal(result.signal,null);assert.match(result.stdout,/^# tests 1$/m);
   if(!mutant)assert.equal(result.status,0,result.stdout+result.stderr);
   else{
    assert.equal(result.status,1,name+': incorrect implementation survived');
    assert.ok(result.stdout.split('\n').some(line=>line.startsWith('not ok ')&&line.endsWith(' - '+selected)));
    assert.match(result.stdout,/ERR_ASSERTION/);assert.ok(result.stdout.includes(marker),result.stdout+result.stderr);
    console.log('IDENTITY_ENVELOPE_MUTATION',name,'control_passed mutant_rejected_by_named_assertion');
   }
  }finally{rmSync(directory,{recursive:true,force:true});}
 }
});
