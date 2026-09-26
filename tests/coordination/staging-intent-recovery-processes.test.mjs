/** Real child liveness lock: process exit permits one explicit F3 recovery. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { stagingFixture, workspace, sql } from './staging-intents-fixtures.mjs';
import { pythonTry } from './coordinator-fixtures.mjs';
import { join } from 'node:path';

const moduleURL = new URL('../../packages/storage/src/index.ts', import.meta.url).href;

test('Staging recovery process: live owner holds; exit permits explicit cancellation', { timeout: 30000 }, () => stagingFixture(async f => {
  const params = JSON.stringify({ directory: f.directory, workspace, binding: f.b, request: f.request });
  const program = `import {WorkspaceCoordinator} from ${JSON.stringify(moduleURL)};import {writeSync} from 'node:fs';
    const p=${params},c=WorkspaceCoordinator.open(p.directory,p.workspace);const i=c.reserveStaging(p.binding,p.request);
    writeSync(1,JSON.stringify({owner:i.owner_id})+'\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);`;
  const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', program], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  try {
    const message = await new Promise((resolve, reject) => {
      let text = ''; const timer = setTimeout(() => reject(Error('staging recovery child readiness: ' + stderr)), 15000);
      child.stdout.on('data', chunk => { text += chunk; const end = text.indexOf('\n'); if (end >= 0) { clearTimeout(timer); resolve(JSON.parse(text.slice(0, end))); } });
      child.once('exit', () => reject(Error('staging recovery child exited before readiness: ' + stderr)));
    });
    assert.equal(pythonTry(join(f.directory, 'owners', message.owner + '.lock')), 'busy');
    assert.equal(f.coordinator.recoverStaging(f.b, f.request.reservation_id).state, 'held');
    child.kill('SIGKILL');
    assert.equal((await exited).signal, 'SIGKILL');
    assert.equal(f.coordinator.recoverStaging(f.b, f.request.reservation_id).state, 'cancelled');
    assert.equal(sql(f, 'SELECT count(*) AS n FROM storage_reservations WHERE reservation_id=?', f.request.reservation_id)[0].n, 0);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
  }
}));

for (const boundary of ['before', 'after']) test(`Staging recovery process: ${boundary} COMMIT leaves one atomic intent state`, { timeout: 30000 }, () => stagingFixture(async f => {
  const intent = f.coordinator.reserveStaging(f.b, f.request);
  assert.throws(() => f.coordinator.close(), error => error.code === 'E_CAPABILITY');
  const params = JSON.stringify({ directory: f.directory, workspace, binding: f.b, reservation_id: intent.reservation_id, boundary });
  const program = `import {WorkspaceCoordinator} from ${JSON.stringify(moduleURL)};import {DatabaseSync} from 'node:sqlite';import {writeSync} from 'node:fs';
    const p=${params},c=WorkspaceCoordinator.open(p.directory,p.workspace),prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec;let armed=false;
    DatabaseSync.prototype.prepare=function(q){const s=prepare.call(this,q);if(q.startsWith('DELETE FROM storage_reservations WHERE reservation_id=? AND owner_id=? AND operation_id=?')){const run=s.run;s.run=function(...args){const r=run.apply(this,args);armed=true;return r;};}return s;};
    const barrier=()=>{writeSync(1,JSON.stringify({boundary:p.boundary})+'\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);};
    DatabaseSync.prototype.exec=function(q){if(armed&&q==='COMMIT'&&p.boundary==='before')barrier();const r=exec.call(this,q);if(armed&&q==='COMMIT'&&p.boundary==='after')barrier();return r;};
    c.recoverStaging(p.binding,p.reservation_id);throw Error('staging recovery fixture missed barrier');`;
  const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', program], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  try {
    const message = await new Promise((resolve, reject) => {
      let text = ''; const timer = setTimeout(() => reject(Error('staging recovery commit barrier: ' + stderr)), 15000);
      child.stdout.on('data', chunk => { text += chunk; const end = text.indexOf('\n'); if (end >= 0) { clearTimeout(timer); resolve(JSON.parse(text.slice(0, end))); } });
      child.once('exit', () => reject(Error('staging recovery child exited before commit barrier: ' + stderr)));
    });
    assert.equal(message.boundary, boundary);
    assert.equal(pythonTry(join(f.directory, 'workspace.lock')), 'busy');
    assert.equal(pythonTry(join(f.directory, 'owners', intent.owner_id + '.lock')), 'busy');
    child.kill('SIGKILL'); assert.equal((await exited).signal, 'SIGKILL');
    const reader = `import {WorkspaceCoordinator} from ${JSON.stringify(moduleURL)};const p=${JSON.stringify({ directory: f.directory, workspace, binding: f.b, reservation_id: intent.reservation_id })},c=WorkspaceCoordinator.open(p.directory,p.workspace);try{console.log(JSON.stringify(c.readStaging(p.binding,p.reservation_id)));}finally{c.close();}`;
    const read = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', reader], { encoding: 'utf8', timeout: 15000 });
    assert.equal(read.error, undefined); assert.equal(read.signal, null); assert.equal(read.status, 0, read.stderr);
    assert.equal(JSON.parse(read.stdout).state, boundary === 'before' ? 'reserved' : 'cancelled');
    assert.equal(sql(f, 'SELECT count(*) AS n FROM storage_reservations WHERE reservation_id=?', intent.reservation_id)[0].n, boundary === 'before' ? 1 : 0);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
  }
}));
