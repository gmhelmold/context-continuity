/** Tests of transaction/isolation proofs; deliberately wrong code exists only in temporary copies. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url));
const cases=[
  ['control',null,null,null],
  ['incarnation-ignored','if (canonical(actual) !== canonical(binding))', 'if (false)', 'WP02A scope: same external ID in another installation/workspace/incarnation cannot cross'],
  ['competing-owner-accepted','if (row.owner_id !== this.owner_id)', 'if (false)', 'WP02A lease: competitor cannot acquire and stale owner cannot renew/release after takeover'],
  ['rollback-commits',"try { this.#db.exec('ROLLBACK'); }", "try { this.#db.exec('COMMIT'); }", 'WP02A initialization: second insert failure rolls back Session and timestamp together'],
  ['mutable-public-owner','Object.freeze(this);','void this;', 'WP02A immutable owner: public identity cannot change authority or workspace'],
];
test('WP02A proof: control plus four incorrect storage implementations are distinguished',{timeout:180000},()=>{
  for(const [name,from,to,expected] of cases){
    const dir=mkdtempSync(join(tmpdir(),'cc-storage-mutation-'));
    try{
      for(const path of ['packages/core/src','packages/storage/src'])cpSync(join(root,path),join(dir,path),{recursive:true});
      mkdirSync(join(dir,'tests/storage'),{recursive:true});mkdirSync(join(dir,'specs/v0.1'),{recursive:true});
      cpSync(join(root,'tests/storage/session-store.test.mjs'),join(dir,'tests/storage/session-store.test.mjs'));
      cpSync(join(root,'specs/v0.1/03-ledger.md'),join(dir,'specs/v0.1/03-ledger.md'));
      writeFileSync(join(dir,'package.json'),'{"type":"module"}');
      if(from){const path=join(dir,'packages/storage/src/session-store.ts'),s=readFileSync(path,'utf8');assert.equal(s.split(from).length,2,name+': mutation must be unique');writeFileSync(path,s.replace(from,to));}
      const env={...process.env};delete env.NODE_TEST_CONTEXT;
      const result=spawnSync(process.execPath,['--experimental-strip-types','--test','--test-reporter=tap','tests/storage/session-store.test.mjs'],{cwd:dir,env,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
      assert.equal(result.error,undefined,name+': setup/timeout is not detection');assert.equal(result.signal,null);
      assert.match(result.stdout,/^# tests 29$/m,name+': every selected test must finish');
      if(name==='control')assert.equal(result.status,0,result.stdout+result.stderr);
      else{
        assert.equal(result.status,1,name+': incorrect implementation survived');
        assert.ok(result.stdout.split('\n').some(line=>line.startsWith('not ok ')&&line.endsWith(' - '+expected)),name+': unrelated failure is not detection');
        assert.match(result.stdout,/ERR_ASSERTION/,name+': require assertion evidence');
      }
    } finally{rmSync(dir,{recursive:true,force:true});}
  }
});
