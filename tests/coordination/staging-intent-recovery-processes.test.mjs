/** Real child liveness lock: process exit permits one explicit F3 recovery. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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
