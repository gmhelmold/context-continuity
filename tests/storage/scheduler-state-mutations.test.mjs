import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url));
const cases=[
  ['control',null,null,null,0],
  ['lease-fence-bypassed','if (lease.owner_id !== this.owner_id || row.owner_id !== lease.owner_id || row.owner_fence !== lease.owner_fence ||\n        row.lease_until_ms !== lease.lease_until_ms || lease.lease_until_ms <= now)','if (false)', 'C-SCHED-01 observation: stale control, lease and backward observation roll back',1],
  ['incarnation-bypassed','if (r.incarnation !== row.binding.incarnation)','if (false)', 'C-SCHED-01 observation: stale scheduler incarnation never receives primary update',1],
  ['primary-update-clobbers-authority','UPDATE scheduler_state SET last_observed_eligible_tokens=?,last_observed_at_ms=?,low_water_observed=','UPDATE scheduler_state SET armed=0,last_observed_eligible_tokens=?,last_observed_at_ms=?,low_water_observed=', 'C-SCHED-01 observation: closed input, frozen state, primary fields and valid low-water persist',2],
  ['low-water-cleared','validLow ? 1 : 0,','0,', 'C-SCHED-01 observation: closed input, frozen state, primary fields and valid low-water persist',1],
  ['migration-authority-bypassed',"if (db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value !== value)",'if (false)', 'C-SCHED-01 migration: v1 authority is verified before upgrade',1],
];
test('C-SCHED-01 proof: control plus incorrect observation implementations are distinguished',{timeout:90000},()=>{
  for(const [name,from,to,expected,count] of cases){const dir=mkdtempSync(join(tmpdir(),'cc-scheduler-mutation-'));try{
    for(const path of ['packages/core/src','packages/storage/src'])cpSync(join(root,path),join(dir,path),{recursive:true});mkdirSync(join(dir,'tests/storage'),{recursive:true});
    cpSync(join(root,'tests/storage/scheduler-state.test.mjs'),join(dir,'tests/storage/scheduler-state.test.mjs'));writeFileSync(join(dir,'package.json'),'{"type":"module"}');
    if(from){const path=join(dir,'packages/storage/src',name==='migration-authority-bypassed'?'sqlite-database.ts':'session-store.ts'),text=readFileSync(path,'utf8'),matches=text.split(from).length-1;assert.equal(matches,count,name+': mutation target count');writeFileSync(path,text.replaceAll(from,to));}
    const env={...process.env};delete env.NODE_TEST_CONTEXT;const result=spawnSync(process.execPath,['--experimental-strip-types','--test','--test-reporter=tap','tests/storage/scheduler-state.test.mjs'],{cwd:dir,env,encoding:'utf8',timeout:30000});
    assert.equal(result.error,undefined,name+': setup/timeout not detection');assert.match(result.stdout,/^# tests 7$/m,name+': all tests finish\n'+result.stderr);
    if(name==='control')assert.equal(result.status,0,result.stdout+result.stderr);else {assert.equal(result.status,1,name+': incorrect implementation survived');assert.ok(result.stdout.split('\n').some(line=>line.startsWith('not ok ')&&line.endsWith(' - '+expected)),name+': unrelated failure');}
  }finally{rmSync(dir,{recursive:true,force:true});}}
});
