/** Actual child processes and private SQLite files; no user workspace or inference. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { WorkspaceCoordinator } from '../../packages/storage/src/index.ts';
import { pinFixture, workspace, sql } from './source-pin-fixtures.mjs';
import { pythonTry } from './coordinator-fixtures.mjs';
const moduleURL = new URL('../../packages/storage/src/index.ts', import.meta.url).href;

async function withPinnedChild(f, body) {
  const parameters = JSON.stringify({ directory: f.directory, workspace, binding: f.b, request: f.request });
  const program = String.raw`
    import { WorkspaceCoordinator } from ${JSON.stringify(moduleURL)};
    import { writeSync } from 'node:fs';
    const p = ${parameters}, c = WorkspaceCoordinator.open(p.directory, p.workspace);
    c.pinSource(p.binding, p.request);
    writeSync(1, 'PINNED\n');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  `;
  const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', program], { stdio: ['ignore', 'pipe', 'pipe'] });
  let timer, stderr = '';
  child.stderr.on('data', b => { stderr += b; });
  const exit = new Promise((resolve, reject) => { child.once('exit', (code, signal) => resolve({ code, signal })); child.once('error', reject); });
  try {
    await new Promise((resolve, reject) => {
      let text = '';
      timer = setTimeout(() => reject(Error('pin discovery barrier deadline: ' + stderr)), 15000);
      child.stdout.on('data', b => { text += b; if (text === 'PINNED\n') { clearTimeout(timer); resolve(); } });
      child.once('exit', () => reject(Error('pin discovery child exited before barrier: ' + stderr)));
      child.once('error', reject);
    });
    await body(child, exit);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exit; }
  }
}

test('Pin discovery process: candidates survive owner exit without automatic release', { timeout: 30000 }, () => pinFixture(async f => {
  await withPinnedChild(f, async (child, exit) => {
    const first = f.coordinator.listSourcePins({ limit: 1 });
    assert.equal(first.pins.length, 1); assert.equal(first.next_after, null);
    const pin = first.pins[0], path = join(f.directory, 'owners', pin.owner_id + '.lock');
    assert.equal(pythonTry(path), 'busy');
    assert.equal(f.coordinator.recoverSourcePin(pin.binding, pin.reservation_id).state, 'held');
    child.kill('SIGKILL'); assert.equal((await exit).signal, 'SIGKILL');
    assert.equal(pythonTry(path), 'acquired');
    assert.deepEqual(f.coordinator.listSourcePins({ limit: 1 }), first);
    assert.equal(sql(f, 'SELECT count(*) AS n FROM storage_reservations')[0].n, 1);
    assert.equal(f.coordinator.recoverSourcePin(pin.binding, pin.reservation_id).state, 'released');
    assert.deepEqual(f.coordinator.listSourcePins({ limit: 1 }), { pins: [], next_after: null });
    for (const table of ['jobs', 'attempts', 'aux_runs', 'chapters']) assert.equal(sql(f, `SELECT count(*) AS n FROM ${table}`)[0].n, 0);
  });
}));

test('Pin discovery process: a new process enumerates original bindings without adopting reservations', { timeout: 30000 }, () => pinFixture(f => {
  const original = f.coordinator.pinSource(f.b, f.request);
  assert.throws(() => f.coordinator.close(), e => e.code === 'E_CAPABILITY');
  const parameters = JSON.stringify({ directory: f.directory, workspace });
  const program = `import { WorkspaceCoordinator } from ${JSON.stringify(moduleURL)};
    const p = ${parameters}, c = WorkspaceCoordinator.open(p.directory, p.workspace);
    try { console.log(JSON.stringify(c.listSourcePins({limit:1}))); } finally { c.close(); }`;
  const run = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', program], { encoding: 'utf8', timeout: 15000 });
  assert.equal(run.error, undefined); assert.equal(run.signal, null); assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), { pins: [original], next_after: null });
  assert.equal(sql(f, 'SELECT count(*) AS n FROM storage_reservations')[0].n, 1);
  const fresh = WorkspaceCoordinator.open(f.directory, workspace);
  try {
    const found = fresh.listSourcePins({ limit: 1 }).pins[0];
    assert.equal(found.owner_id, original.owner_id); assert.notEqual(found.owner_id, fresh.owner_id);
    assert.equal(fresh.recoverSourcePin(found.binding, found.reservation_id).state, 'released');
  } finally { fresh.close(); }
}));
