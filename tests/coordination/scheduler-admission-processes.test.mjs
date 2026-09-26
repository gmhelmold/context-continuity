import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {hashPayload} from '../../packages/core/src/index.ts';
import {fixture,amount} from './scheduler-admission-fixtures.mjs';

const storage=new URL('../../packages/storage/src/index.ts',import.meta.url).href;
test('C-SCHED admission process: committed reservation, tuple and disarm survive independent reopen',()=>fixture(f=>{
 const job=f.job(),observation={host_epoch:0,coverage_digest:job.record.snapshot.coverage_digest,policy_revision:0,
  config_digest:hashPayload(f.cfg),configuration:f.cfg,eligible_tokens:50000,observed_at_ms:f.time()};
 f.s.observePrimaryAndRearm(f.lease,observation);const admitted=f.coordinator.withWorkspaceLock(owner_hold=>f.s.admitPrimarySchedulerJob(f.lease,
  {context:job,expected:job.ref,observation,selected_interval_tokens:2048,attempt_budget:amount,owner_hold}));
 const program=`import {SqliteSessionStore} from ${JSON.stringify(storage)};
  const store=SqliteSessionStore.open(${JSON.stringify(f.directory)},${JSON.stringify(f.s.workspace)},()=>100000);
  console.log(JSON.stringify({state:store.readSchedulerState(${JSON.stringify(f.b)}),job:store.readJob(${JSON.stringify(f.b)},${JSON.stringify(job.ref)})}));store.close();`;
 const result=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',program],{encoding:'utf8',timeout:30000});
 assert.equal(result.error,undefined,result.stderr);assert.equal(result.status,0,result.stderr);const reopened=JSON.parse(result.stdout);
 assert.equal(reopened.state.armed,false);assert.deepEqual(reopened.state.last_attempt,admitted.state.last_attempt);
 assert.equal(reopened.job.status,'running');assert.equal(reopened.job.attempts[0].ref.attempt_id,admitted.attempt.attempt_id);
}));
