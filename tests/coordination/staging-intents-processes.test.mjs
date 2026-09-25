/** Crash only synthetic child coordinators at exact SQLite COMMIT boundaries. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { WORKSPACE_CONTENT_QUOTA_BYTES as QUOTA } from '../../packages/storage/src/index.ts';
import { stagingFixture, workspace, sql } from './staging-intents-fixtures.mjs';

const moduleURL = new URL('../../packages/storage/src/index.ts', import.meta.url).href;
const environment = () => { const env = { ...process.env }; delete env.NODE_TEST_CONTEXT; return env; };
async function atBarrier(program, action) {
  const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', program],
    { env: environment(), stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '', timer;
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = new Promise((resolve, reject) => { child.once('exit', (code, signal) => resolve({ code, signal })); child.once('error', reject); });
  try {
    const message = await new Promise((resolve, reject) => {
      let stdout = ''; timer = setTimeout(() => reject(Error('staging barrier deadline: ' + stderr)), 15000);
      child.stdout.on('data', chunk => {
        stdout += chunk; const line = stdout.indexOf('\n');
        if (line >= 0) { clearTimeout(timer); try { resolve(JSON.parse(stdout.slice(0, line))); } catch (error) { reject(error); } }
      });
      child.once('error', reject); child.once('exit', () => reject(Error('staging child exited before barrier: ' + stderr)));
    });
    await action(message, child, exited);
  } finally {
    clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
  }
}

for (const operation of ['reserve', 'cancel']) for (const boundary of ['before', 'after']) {
  test(`Staging process: crash ${operation} ${boundary} COMMIT preserves only confirmed state`, { timeout: 30000 }, () => stagingFixture(async f => {
    const params = { directory: f.directory, workspace, binding: f.b, request: f.request, operation, boundary };
    const program = String.raw`
      import {WorkspaceCoordinator} from ${JSON.stringify(moduleURL)};
      import {DatabaseSync} from 'node:sqlite'; import {writeSync} from 'node:fs';
      const p=${JSON.stringify(params)}, c=WorkspaceCoordinator.open(p.directory,p.workspace);
      if(p.operation==='cancel') c.reserveStaging(p.binding,p.request);
      const prepare=DatabaseSync.prototype.prepare, exec=DatabaseSync.prototype.exec; let armed=false;
      DatabaseSync.prototype.prepare=function(query){
        if((p.operation==='reserve'&&query.startsWith('INSERT INTO storage_reservations'))||
          (p.operation==='cancel'&&query.startsWith('DELETE FROM storage_reservations'))) armed=true;
        return prepare.call(this,query);
      };
      const barrier=()=>{writeSync(1,JSON.stringify({owner:c.owner_id,operation:p.operation,boundary:p.boundary})+'\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);};
      DatabaseSync.prototype.exec=function(query){if(armed&&query==='COMMIT'&&p.boundary==='before')barrier();const value=exec.call(this,query);if(armed&&query==='COMMIT'&&p.boundary==='after')barrier();return value;};
      if(p.operation==='reserve')c.reserveStaging(p.binding,p.request);else c.cancelStaging(p.binding,p.request.reservation_id);
      throw Error('staging child missed COMMIT barrier');`;
    await atBarrier(program, async (message, child, exited) => {
      assert.equal(message.operation, operation); assert.equal(message.boundary, boundary);
      child.kill('SIGKILL'); assert.equal((await exited).signal, 'SIGKILL');
      const readerCode = `import {WorkspaceCoordinator} from ${JSON.stringify(moduleURL)};
        const c=WorkspaceCoordinator.open(${JSON.stringify(f.directory)},${JSON.stringify(workspace)});
        try{console.log(JSON.stringify(c.readStaging(${JSON.stringify(f.b)},${JSON.stringify(f.request.reservation_id)})))}finally{c.close();}`;
      const reader = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', readerCode],
        { env: environment(), encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
      assert.equal(reader.error, undefined); assert.equal(reader.signal, null); assert.equal(reader.status, 0, reader.stderr);
      const actual = JSON.parse(reader.stdout), expected = operation === 'reserve'
        ? (boundary === 'before' ? null : 'reserved') : (boundary === 'before' ? 'reserved' : 'cancelled');
      assert.equal(actual?.state ?? null, expected);
      assert.equal(sql(f, 'SELECT * FROM storage_reservations WHERE reservation_id=?', f.request.reservation_id).length, expected === 'reserved' ? 1 : 0);
      for (const table of ['jobs', 'attempts', 'aux_runs', 'chapters', 'managed_files']) assert.equal(sql(f, `SELECT count(*) AS n FROM ${table}`)[0].n, 0);
    });
  }));
}

test('Staging process: restart reads history but never adopts, replays, or cancels another owner intent', { timeout: 30000 }, () => stagingFixture(f => {
  const params = { directory: f.directory, workspace, binding: f.b, request: f.request };
  const program = `import {WorkspaceCoordinator} from ${JSON.stringify(moduleURL)};
    const p=${JSON.stringify(params)}, c=WorkspaceCoordinator.open(p.directory,p.workspace);
    c.reserveStaging(p.binding,p.request);try{c.close()}catch(error){if(error.code!=='E_CAPABILITY')throw error;}`;
  const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', program],
    { env: environment(), encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, 0, child.stderr);
  const other = WorkspaceCoordinator.open(f.directory, workspace);
  try {
    assert.equal(other.readStaging(f.b, f.request.reservation_id).state, 'reserved');
    assert.throws(() => other.reserveStaging(f.b, f.request), error => error.code === 'E_OWNER');
    assert.throws(() => other.cancelStaging(f.b, f.request.reservation_id), error => error.code === 'E_OWNER');
    assert.equal(sql(f, 'SELECT count(*) AS n FROM storage_reservations')[0].n, 1);
  } finally { other.close(); }
}));

test('Staging process: fresh owners contest final shared capacity without a cached budget', { timeout: 30000 }, () => stagingFixture(f => {
  const used = f.coordinator.readStorageBudget().used_bytes;
  sql(f, "INSERT INTO blobs(digest,size_bytes,created_at) VALUES (?,?,?)", 'e'.repeat(64), QUOTA - used - 1, '2026-01-01T00:00:00.000Z');
  const reserve = request => {
    const params = { directory: f.directory, workspace, binding: f.b, request };
    const program = `import {WorkspaceCoordinator} from ${JSON.stringify(moduleURL)};
      const p=${JSON.stringify(params)},c=WorkspaceCoordinator.open(p.directory,p.workspace);let result;
      try{c.reserveStaging(p.binding,p.request);result='committed'}catch(error){result=error.code}
      try{c.close()}catch(error){if(error.code!=='E_CAPABILITY')throw error}console.log(result);`;
    return spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', program],
      { env: environment(), encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  };
  const first = reserve(f.request), second = reserve({ ...f.request, reservation_id: '00000000-0000-4000-8000-000000009999', operation_id: '00000000-0000-4000-8000-000000009998' });
  for (const run of [first, second]) { assert.equal(run.error, undefined); assert.equal(run.signal, null); assert.equal(run.status, 0, run.stderr); }
  assert.equal(first.stdout.trim(), 'committed'); assert.equal(second.stdout.trim(), 'E_BUDGET');
  assert.equal(f.coordinator.readStorageBudget().used_bytes, QUOTA);
}));
