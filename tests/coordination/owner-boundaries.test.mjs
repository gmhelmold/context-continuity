/** Limits of the raw primitive, NOT tests of a workspace manager implementation.
 * Every file/process/database below is a synthetic fixture owned by this test. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, openSync, closeSync, writeFileSync, renameSync, statSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { SqliteSessionStore } from '../../packages/storage/src/index.ts';
const nativePath = fileURLToPath(new URL('../../packages/storage/native/build/locks.node', import.meta.url));
const locks = createRequire(import.meta.url)(nativePath);
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'cc-owner-boundary-'));
  const path = join(directory, 'workspace.lock'), descriptors = [];
  writeFileSync(path, 'synthetic lock', { mode: 0o600 });
  const open = p => { const fd = openSync(p ?? path, 'r+'); descriptors.push(fd); return fd; };
  const close = fd => { closeSync(fd); descriptors.splice(descriptors.indexOf(fd), 1); };
  const cleanup = () => { for (const fd of descriptors) closeSync(fd); rmSync(directory, { recursive: true, force: true }); };
  try { const value = run({ directory, path, open, close }); if (value?.then) return value.finally(cleanup); cleanup(); return value; }
  catch (error) { cleanup(); throw error; }
}
function witness(path) {
  const code = `import os,fcntl,sys
fd=os.open(sys.argv[1],os.O_RDWR)
try:
 try:
  fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
  print('acquired')
 except BlockingIOError:
  print('busy')
finally:
 os.close(fd)`;
  const result = spawnSync('python3', ['-c', code, path], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.error, undefined, 'witness timeout/setup is not evidence');
  assert.equal(result.signal, null); assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
test('Owner boundary: a replaced pathname is a different lock domain, not a release of the old inode', () => fixture(f => {
  const first = f.open(), original = statSync(f.path), moved = join(f.directory, 'previous.lock');
  assert.equal(locks.tryLock(first), true); assert.equal(witness(f.path), 'busy');
  renameSync(f.path, moved); writeFileSync(f.path, 'new synthetic inode', { mode: 0o600 });
  const replacement = statSync(f.path);
  assert.notEqual(replacement.ino, original.ino); assert.equal(statSync(moved).ino, original.ino);
  assert.equal(witness(f.path), 'acquired'); assert.equal(witness(moved), 'busy');
  const second = f.open(); assert.equal(locks.tryLock(second), true);
  assert.equal(witness(f.path), 'busy'); assert.equal(witness(moved), 'busy');
  locks.unlock(second); locks.unlock(first);
  assert.equal(witness(f.path), 'acquired'); assert.equal(witness(moved), 'acquired');
}));
test('Owner boundary: releasing a kernel lock does not update a persisted active owner', () => fixture(f => {
  const store = SqliteSessionStore.create(f.directory, { installation_id: id(1), workspace_id: id(2) });
  const db = new DatabaseSync(join(f.directory, 'ledger.sqlite'));
  try {
    const key = 'owners/' + id(3) + '.lock', ownerPath = join(f.directory, key);
    mkdirSync(join(f.directory, 'owners'), { mode: 0o700 }); writeFileSync(ownerPath, 'synthetic owner', { mode: 0o600 });
    const fd = f.open(ownerPath); assert.equal(locks.tryLock(fd), true);
    db.prepare("INSERT INTO storage_owners VALUES (?,?,?,'active',?)").run(id(3), id(4), key, '2026-09-19T00:00:00.000Z');
    const before = db.prepare('SELECT * FROM storage_owners').all();
    assert.equal(witness(ownerPath), 'busy'); f.close(fd); assert.equal(witness(ownerPath), 'acquired');
    assert.deepEqual(db.prepare('SELECT * FROM storage_owners').all(), before);
    assert.equal(before[0].state, 'active');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n, 0);
  } finally { db.close(); store.close(); }
}));
test('Owner boundary: a child can release its lock and still respond, so unlocked is not proof of process death', () => fixture(async f => {
  const program = String.raw`import {createRequire} from 'node:module';import {openSync,closeSync,writeSync} from 'node:fs';import {createInterface} from 'node:readline';
const lock=createRequire(import.meta.url)(${JSON.stringify(nativePath)});let fd=openSync(${JSON.stringify(f.path)},'r+');
if(!lock.tryLock(fd))throw Error('fixture could not acquire lock');
const input=createInterface({input:process.stdin});
input.on('line',line=>{if(line==='RELEASE'){closeSync(fd);fd=null;writeSync(1,'RELEASED\n');}else if(line==='PING'){writeSync(1,'PONG\n');}else if(line==='QUIT'){input.close();}});
input.on('close',()=>{if(fd!==null)closeSync(fd);process.exitCode=0;});writeSync(1,'HELD\n');`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', program], { stdio: ['pipe', 'pipe', 'pipe'] });
  let pending = null, buffered = '', stderr = '', timer, terminal = null;
  const queue = [];
  child.stderr.on('data', bytes => { stderr += bytes; });
  child.stdout.on('data', bytes => {
    buffered += bytes;
    let newline;
    while ((newline = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, newline); buffered = buffered.slice(newline + 1);
      if (pending) { const waiting = pending; pending = null; clearTimeout(timer); waiting.resolve(line); } else queue.push(line);
    }
  });
  const exited = new Promise(resolve => {
    child.once('error', error => { terminal = error; pending?.reject(error); pending = null; clearTimeout(timer); resolve({ error }); });
    child.once('exit', (code, signal) => { terminal = Error('fixture exited: ' + stderr); pending?.reject(terminal); pending = null; clearTimeout(timer); resolve({ code, signal }); });
  });
  const next = () => queue.length ? Promise.resolve(queue.shift()) : terminal ? Promise.reject(terminal) : new Promise((resolve, reject) => {
    pending = { resolve, reject }; timer = setTimeout(() => { pending = null; reject(Error('fixture barrier timeout: ' + stderr)); }, 10000);
  });
  try {
    assert.equal(await next(), 'HELD'); assert.equal(witness(f.path), 'busy');
    child.stdin.write('RELEASE\n'); assert.equal(await next(), 'RELEASED');
    assert.equal(witness(f.path), 'acquired');
    child.stdin.write('PING\n'); assert.equal(await next(), 'PONG');
    child.stdin.end('QUIT\n');
    const outcome = await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('fixture exit timeout')), 10000); })]);
    assert.deepEqual(outcome, { code: 0, signal: null });
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
  }
}));
