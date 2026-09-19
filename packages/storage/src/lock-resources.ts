/** Private resources for the local POSIX coordinator. Never exposes descriptors.
 * Advisory cooperation, not a sandbox against hostile code of the same user. */
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { createRequire } from 'node:module';
import { StorageError } from './errors.ts';
export type FileIdentity = Readonly<{ dev: string; ino: string }>;
type NativeLocks = { localProfile(fd: number): boolean; tryLock(fd: number): boolean; unlock(fd: number): boolean };
let loaded: NativeLocks | undefined;
function native(): NativeLocks {
  if (loaded) return loaded;
  try {
    const value = createRequire(import.meta.url)('../native/build/locks.node') as NativeLocks;
    if (!['localProfile', 'tryLock', 'unlock'].every(k => typeof value[k as keyof NativeLocks] === 'function')) throw Error();
    loaded = Object.freeze({ localProfile: value.localProfile, tryLock: value.tryLock, unlock: value.unlock });
    return loaded;
  } catch { throw new StorageError('E_CAPABILITY', 'native lock build unavailable'); }
}
function fail(): never { throw new StorageError('E_CAPABILITY', 'private lock resource unavailable or replaced'); }
function identity(s: BigIntStats): FileIdentity { return Object.freeze({ dev: s.dev.toString(), ino: s.ino.toString() }); }
export function sameFile(a: FileIdentity, b: FileIdentity): boolean { return a.dev === b.dev && a.ino === b.ino; }
function valid(s: BigIntStats, directory: boolean): void {
  if (s.uid !== BigInt(process.getuid!()) || (s.mode & 0o7777n) !== (directory ? 0o700n : 0o600n) ||
      (directory ? !s.isDirectory() : !s.isFile() || s.nlink !== 1n || s.size !== 0n)) fail();
}
class PrivateDescriptor {
  readonly identity: FileIdentity;
  #fd: number | null;
  #path: string;
  #directory: boolean;
  #held = false;
  #parentGuard: () => void;
  #onClose: () => void;
  private constructor(path: string, fd: number, directory: boolean, parentGuard: () => void, onClose: () => void) {
    this.#path = path; this.#fd = fd; this.#directory = directory;
    this.#parentGuard = parentGuard; this.#onClose = onClose;
    const s = fstatSync(fd, { bigint: true }); valid(s, directory); this.identity = identity(s);
    this.guard();
    if (!native().localProfile(fd)) throw new StorageError('E_CAPABILITY', 'local filesystem profile required');
    Object.freeze(this);
  }
  static open(path: string, directory: boolean, create: boolean, parentGuard: () => void = () => {}, onClose: () => void = () => {}): PrivateDescriptor {
    let fd: number | undefined;
    try {
      // EXCL creation and NOFOLLOW inspection do not truncate or adopt a symlink.
      const flags = (directory ? constants.O_RDONLY | constants.O_DIRECTORY : constants.O_RDWR) | constants.O_NOFOLLOW | constants.O_NONBLOCK;
      fd = openSync(path, flags | (create ? constants.O_CREAT | constants.O_EXCL : 0), 0o600);
      return new PrivateDescriptor(path, fd, directory, parentGuard, onClose);
    } catch (cause) {
      if (fd !== undefined) { try { closeSync(fd); } catch { return fail(); } }
      if (cause instanceof StorageError) throw cause;
      return fail();
    }
  }
  guard(): void {
    if (this.#fd === null) fail();
    this.#parentGuard();
    try {
      const path = lstatSync(this.#path, { bigint: true }), current = fstatSync(this.#fd, { bigint: true });
      valid(path, this.#directory); valid(current, this.#directory);
      if (!sameFile(identity(path), this.identity) || !sameFile(identity(current), this.identity)) fail();
    } catch { fail(); }
  }
  sync(): void { this.guard(); try { fsyncSync(this.#fd!); } catch { fail(); } }
  tryLock(): boolean {
    this.guard();
    if (this.#directory || this.#held) throw new StorageError('E_CONFLICT', 'lock acquisition is not reentrant');
    let acquired = false;
    try {
      acquired = native().tryLock(this.#fd!);
      if (acquired) { this.#held = true; this.guard(); }
      return acquired;
    } catch (cause) {
      if (acquired) this.unlock();
      if (cause instanceof StorageError) throw cause;
      return fail();
    }
  }
  unlock(): void {
    if (!this.#held) return;
    this.#held = false;
    try { native().unlock(this.#fd!); }
    catch { this.close(); fail(); }
  }
  close(): void {
    const fd = this.#fd; this.#fd = null; this.#held = false;
    if (fd !== null) {
      // Revoke before close, sanitize failure, and always remove the child handle.
      // Never retry a potentially reused descriptor number.
      try { closeSync(fd); } catch { fail(); } finally { this.#onClose(); }
    }
  }
}
/** Internal export for the coordinator, not an API that returns an fd. */
export class LockResources {
  readonly directory: string;
  readonly identity: Readonly<{ directory: FileIdentity; owners: FileIdentity; lock: FileIdentity }>;
  #root: PrivateDescriptor;
  #owners: PrivateDescriptor;
  #workspace: PrivateDescriptor;
  #closed = false;
  #owned = new Set<PrivateDescriptor>();
  private constructor(directory: string, root: PrivateDescriptor, owners: PrivateDescriptor, workspace: PrivateDescriptor) {
    this.directory = directory; this.#root = root; this.#owners = owners; this.#workspace = workspace;
    this.identity = Object.freeze({ directory: root.identity, owners: owners.identity, lock: workspace.identity });
    Object.freeze(this);
  }
  static open(input: unknown, initialize: boolean): LockResources {
    if (!['linux', 'darwin'].includes(process.platform)) throw new StorageError('E_CAPABILITY', 'local POSIX profile required');
    if (typeof initialize !== 'boolean' || typeof input !== 'string' || !input.isWellFormed() || !isAbsolute(input) || input.includes('\0') ||
        input.split('/').some(part => part === '.' || part === '..')) return fail();
    const suppliedPath = input.replace(/\/+$/, '') || '/';
    let root: PrivateDescriptor | undefined, owners: PrivateDescriptor | undefined, workspace: PrivateDescriptor | undefined;
    try {
      const supplied = lstatSync(suppliedPath, { bigint: true }); valid(supplied, true);
      const directory = realpathSync(suppliedPath);
      root = PrivateDescriptor.open(directory, true, false);
      if (!sameFile(identity(supplied), root.identity)) fail();
      if (initialize) {
        // Bootstrap is explicit. Existing resources are inspected, never replaced.
        try { mkdirSync(join(directory, 'owners'), { mode: 0o700 }); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
      }
      owners = PrivateDescriptor.open(join(directory, 'owners'), true, false);
      const lockPath = join(directory, 'workspace.lock');
      let missing = false;
      try { lstatSync(lockPath); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; missing = true; }
      if (missing && initialize) {
        // A racing initializer may create it; open the winner only after EEXIST.
        try {
          const fd = openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
          try { fsyncSync(fd); } finally { closeSync(fd); }
        } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
      }
      workspace = PrivateDescriptor.open(lockPath, false, false);
      root.guard(); owners.guard();
      if (initialize) { workspace.sync(); owners.sync(); root.sync(); }
      return new LockResources(directory, root, owners, workspace);
    } catch (cause) {
      try { workspace?.close(); } finally { try { owners?.close(); } finally { root?.close(); } }
      if (cause instanceof StorageError) throw cause;
      return fail();
    }
  }
  guard(): void {
    if (this.#closed) fail();
    this.#root.guard(); this.#owners.guard(); this.#workspace.guard();
  }
  acquire(): void {
    this.guard();
    if (!this.#workspace.tryLock()) throw new StorageError('E_CONFLICT', 'workspace lock busy');
    try { this.guard(); } catch (e) { this.release(); throw e; }
  }
  release(): void { this.#workspace.unlock(); }
  owner(ownerId: string, create: boolean): PrivateDescriptor {
    this.guard();
    if (typeof create !== 'boolean' || typeof ownerId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(ownerId)) return fail();
    let file: PrivateDescriptor | undefined;
    file = PrivateDescriptor.open(join(this.directory, 'owners', ownerId + '.lock'), false, create,
      () => this.guard(), () => { if (file) this.#owned.delete(file); });
    this.#owned.add(file);
    try {
      this.guard();
      if (create) { file.sync(); this.#owners.sync(); }
      return file;
    } catch (e) { file.close(); throw e; }
  }
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    let failed = false;
    for (const file of [...this.#owned, this.#workspace, this.#owners, this.#root]) {
      try { file.close(); } catch { failed = true; }
    }
    if (failed) fail();
  }
}
export type OwnerFile = ReturnType<LockResources['owner']>;
