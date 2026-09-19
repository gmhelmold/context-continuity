/** Mutants are private copies; an assertion, not timeout/setup failure, must reject them. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url));
const cases=[
 ['availability','sourceMetadata(db, binding, request.source_ref);','void request.source_ref;','Source pins: source availability and exact digest must match at admission'],
 ['ownership','pin.owner_id !== owner.owner_id || pin.process_instance !== owner.process_instance','false','Source pins: another participant can inspect but cannot release or adopt a pin'],
 ['checksum','e.digest !== hashPayload(pin)','false','Source pins: metadata checksum detects a changed source digest'],
 ['resurrection',"existing.state !== 'active' || ",'','Source pins: release is idempotent but its identifier cannot be resurrected'],
 ['limit','>= MAX_ACTIVE_SOURCE_PINS','> MAX_ACTIVE_SOURCE_PINS','Source pins: active limit is inclusive and replay consumes no extra slot'],
];
for(const [name,from,to,title]of cases)test(`Source pin proof: ${name} distinguishes control and incorrect implementation`,{timeout:90000},()=>{
  for(const mutate of [false,true]){
    const dir=mkdtempSync(join(tmpdir(),'cc-pin-mutation-'));
    try{
      for(const p of ['packages/core/src','packages/storage/src','packages/storage/native/build'])cpSync(join(root,p),join(dir,p),{recursive:true});
      mkdirSync(join(dir,'tests/coordination'),{recursive:true});mkdirSync(join(dir,'tests/storage'),{recursive:true});
      for(const p of ['source-pin-fixtures.mjs','source-pins.test.mjs','coordinator-fixtures.mjs'])cpSync(join(root,'tests/coordination',p),join(dir,'tests/coordination',p));
      cpSync(join(root,'tests/storage/job-fixtures.mjs'),join(dir,'tests/storage/job-fixtures.mjs'));
      writeFileSync(join(dir,'package.json'),'{"type":"module"}');
      const path=join(dir,'packages/storage/src/source-pins.ts'),source=readFileSync(path,'utf8');
      assert.equal(source.split(from).length-1,1,'mutation anchor must be unique');if(mutate)writeFileSync(path,source.replace(from,to));
      const env={...process.env};delete env.NODE_TEST_CONTEXT;
      const run=spawnSync(process.execPath,['--experimental-strip-types','--test','--test-reporter=tap','--test-name-pattern=^'+title+'$','tests/coordination/source-pins.test.mjs'],{cwd:dir,env,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
      assert.equal(run.error,undefined,'setup/timeout is not detection');assert.equal(run.signal,null);assert.match(run.stdout,/^# tests 1$/m);
      if(!mutate)assert.equal(run.status,0,run.stdout+run.stderr);
      else{
        assert.equal(run.status,1,'incorrect implementation survived');assert.match(run.stdout,/ERR_ASSERTION/);
        assert.ok(run.stdout.split('\n').some(l=>l.startsWith('not ok ')&&l.endsWith(' - '+title)));
        console.log('SOURCE_PIN_MUTATION',name,'control_passed mutant_rejected_by_assertion');
      }
    }finally{rmSync(dir,{recursive:true,force:true});}
  }
});
