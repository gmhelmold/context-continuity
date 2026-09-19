/** SPEC-20 integration review: only disposable databases and our own child processes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WorkspaceCoordinator } from '../../packages/storage/src/index.ts';
import { fixture, workspace, amount, sql } from '../storage/job-fixtures.mjs';
const storage = new URL('../../packages/storage/src/index.ts', import.meta.url).href;
const core = new URL('../../packages/core/src/index.ts', import.meta.url).href;
const snapshot = new URL('../../packages/core/src/snapshot.ts', import.meta.url).href;
const completion = new URL('../../packages/storage/src/local-completion.ts', import.meta.url).href;
function witness(path) {
  const run = spawnSync('python3', ['-c', `import os,fcntl,sys
fd=os.open(sys.argv[1],os.O_RDWR)
try:
 try:
  fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
  print('acquired')
 except BlockingIOError:
  print('busy')
finally:
 os.close(fd)`, path], { encoding: 'utf8', timeout: 10000 });
  assert.equal(run.error, undefined); assert.equal(run.signal, null); assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim();
}
async function atBarrier(program, body) {
  const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', program], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '', barrierTimer, exitTimer;
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  // Observe errors immediately, even while waiting for the barrier.
  exited.catch(() => {});
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    try { return await Promise.race([exited, new Promise((_, reject) => {
      exitTimer = setTimeout(() => reject(Error('fixture child exit timeout')), 10000);
    })]); } finally { clearTimeout(exitTimer); }
  };
  try {
    const message = await new Promise((resolve, reject) => {
      let output = '';
      barrierTimer = setTimeout(() => reject(Error('fixture commit barrier timeout: ' + stderr)), 15000);
      child.once('error', reject);
      child.once('exit', () => reject(Error('fixture exited before barrier: ' + stderr)));
      child.stdout.on('data', chunk => {
        output += chunk; const end = output.indexOf('\n');
        if (end >= 0) { clearTimeout(barrierTimer); try { resolve(JSON.parse(output.slice(0, end))); } catch (error) { reject(error); } }
      });
    });
    await body(message, stop);
  } finally { clearTimeout(barrierTimer); await stop(); }
}
for (const operation of ['receipt', 'recovery']) for (const boundary of ['before', 'after']) {
  test(`Completion review process: ${operation} ${boundary} COMMIT preserves only durable evidence`, { timeout: 45000 }, () => fixture(async f => {
    f.s.releaseLease(f.lease); WorkspaceCoordinator.initialize(f.directory, workspace);
    const args = { operation, boundary, directory: f.directory, workspace, binding: f.b, budget: amount,
      fields: f.job().record.snapshot, source: f.source.ref, bytes: Array.from(f.source.bytes), now: f.time(),
      marker: join(f.directory, 'completion-fixture-invocations.txt') };
    const program = String.raw`
import {SqliteSessionStore,WorkspaceCoordinator} from ${JSON.stringify(storage)};
import {createManifest,createJobContext,hashSource} from ${JSON.stringify(core)};
import {SNAPSHOT_INPUT_FIELDS} from ${JSON.stringify(snapshot)};
import {observeLocalCompletion} from ${JSON.stringify(completion)};
import {DatabaseSync} from 'node:sqlite';import {writeSync,appendFileSync} from 'node:fs';
const p=${JSON.stringify(args)},store=SqliteSessionStore.open(p.directory,p.workspace,()=>p.now);
const owner=WorkspaceCoordinator.open(p.directory,p.workspace),lease=store.acquireLease(p.binding);
const bytes=Buffer.from(p.bytes),entity={kind:'source',ref:p.source};
const manifest=createManifest(p.binding,[{entity,authority:'agent',range:{start_byte:0,end_byte:bytes.length},excerpt_digest:hashSource(bytes),presented_as:'full',locator:'s1'}],()=>({binding:p.binding,entity,authority:'agent',bytes}));
const fields=Object.fromEntries(SNAPSHOT_INPUT_FIELDS.map(key=>[key,p.fields[key]]));fields.owner_fence=lease.owner_fence;
const job=createJobContext(p.binding,fields,manifest,'Synthetic completion persistence fixture.');
store.admitJob(lease,job,job.ref);
const attempt=owner.withWorkspaceLock(h=>store.reserveJobAttempt(lease,job.ref,p.budget,h));
owner.withWorkspaceLock(h=>store.markJobAttemptDispatched(lease,job.ref,attempt,h));
const ownership=store.readAttemptOwnership(p.binding,job.ref,attempt);
appendFileSync(p.marker,'invoked\n',{mode:0o600});
const {observation}=await observeLocalCompletion(ownership,Promise.resolve(undefined));
const prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec;let armed=false;
const barrier=()=>{writeSync(1,JSON.stringify({operation:p.operation,boundary:p.boundary,ref:job.ref,owner:owner.owner_id})+'\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);};
DatabaseSync.prototype.prepare=function(q){
 const st=prepare.call(this,q);
 const target=p.operation==='receipt'?q==='UPDATE attempts SET usage_json=? WHERE session_key=? AND attempt_id=? AND usage_json=?':q.startsWith("UPDATE aux_runs SET state='stopped',local_stopped=1");
 if(target){const run=st.run;st.run=function(...args){const value=run.apply(this,args);armed=true;return value;};}return st;
};
DatabaseSync.prototype.exec=function(q){if(armed&&q==='COMMIT'&&p.boundary==='before')barrier();const value=exec.call(this,q);if(armed&&q==='COMMIT'&&p.boundary==='after')barrier();return value;};
owner.withWorkspaceLock(h=>store.recordObservedLocalCompletion(lease,job.ref,attempt,observation,h));
if(p.operation==='recovery'){store.cancelJob(lease,job.ref);store.recoverJobs(lease);}
throw Error('completion barrier was not reached');`;
    await atBarrier(program, async (message, stop) => {
      assert.equal(message.operation, operation); assert.equal(message.boundary, boundary);
      const ownerPath = join(f.directory, 'owners', message.owner + '.lock');
      assert.equal(witness(ownerPath), 'busy');
      assert.equal((await stop()).signal, 'SIGKILL'); assert.equal(witness(ownerPath), 'acquired');
      const saved = { jobs: sql(f, 'SELECT * FROM jobs'), attempts: sql(f, 'SELECT * FROM attempts'),
        runs: sql(f, 'SELECT * FROM aux_runs'), counters: sql(f, 'SELECT counters_json FROM sessions') };
      const hasReceipt = operation === 'recovery' || boundary === 'after';
      assert.equal(saved.attempts.length, 1);
      assert.equal(Object.hasOwn(JSON.parse(saved.attempts[0].usage_json), 'local_stop'), hasReceipt);
      const store = f.open(), before = store.readJob(f.b, message.ref);
      assert.equal(before.attempts[0].local_state, operation === 'receipt' ? 'running' : boundary === 'before' ? 'quarantine' : 'stopped');
      assert.deepEqual({ jobs: sql(f, 'SELECT * FROM jobs'), attempts: sql(f, 'SELECT * FROM attempts'),
        runs: sql(f, 'SELECT * FROM aux_runs'), counters: sql(f, 'SELECT counters_json FROM sessions') }, saved);
      assert.equal(readFileSync(args.marker, 'utf8'), 'invoked\n');
      f.advance(30001); const lease = store.acquireLease(f.b); store.recoverJobs(lease);
      const recovered = store.readJob(f.b, message.ref);
      assert.equal(recovered.attempts[0].local_stopped, hasReceipt);
      assert.equal(recovered.attempts[0].local_state, hasReceipt ? 'stopped' : 'quarantine');
      assert.equal(recovered.attempts[0].remote_state, 'unknown');
      assert.equal(recovered.attempts[0].input_reserved, amount.input_tokens);
      assert.equal(recovered.proposal, null); assert.equal(recovered.attempts.length, 1);
      assert.deepEqual(sql(f, 'SELECT counters_json FROM sessions'), saved.counters);
      const first = store.readJob(f.b, message.ref); store.recoverJobs(lease);
      assert.deepEqual(store.readJob(f.b, message.ref), first);
      assert.equal(sql(f, 'SELECT count(*) AS n FROM chapters')[0].n, 0);
      assert.equal(readFileSync(args.marker, 'utf8'), 'invoked\n');
    });
  }));
}
