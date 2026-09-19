/** Actual kernel locks, private synthetic files, and an independent Python witness. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {mkdtempSync,rmSync,openSync,closeSync,chmodSync,linkSync,unlinkSync,statSync,readFileSync,writeFileSync,utimesSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
const modulePath=process.env.CC_TEST_LOCK_MODULE || fileURLToPath(new URL('../../packages/storage/native/build/locks.node',import.meta.url));
const locks=createRequire(import.meta.url)(modulePath);
function fixture(fn) {
 const directory=mkdtempSync(join(tmpdir(),'cc-os-lock-')),path=join(directory,'workspace.lock'),fds=[];
 writeFileSync(path,'private synthetic lock identity',{mode:0o600});
 const open=()=>{const fd=openSync(path,'r+');fds.push(fd);return fd;};
 const close=fd=>{closeSync(fd);fds.splice(fds.indexOf(fd),1);};
 const done=()=>{for(const fd of fds)closeSync(fd);rmSync(directory,{recursive:true,force:true});};
 try{const r=fn({directory,path,open,close});if(r?.then)return r.finally(done);done();return r;}catch(e){done();throw e;}
}
function pythonTry(path) {
 const program=`import os,fcntl,sys\nfd=os.open(sys.argv[1],os.O_RDWR)\ntry:\n try:\n  fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)\n  print('acquired')\n except BlockingIOError:\n  print('busy')\nfinally:\n os.close(fd)`;
 const r=spawnSync('python3',['-c',program,path],{encoding:'utf8',timeout:10000});
 assert.equal(r.error,undefined,'witness startup/timeout is not a result');assert.equal(r.status,0,r.stderr);
 return r.stdout.trim();
}
const refusal=fn=>assert.throws(fn,e=>e.code==='E_CAPABILITY');
test('OS lock: independent Python witness observes exclusion and explicit release',()=>fixture(f=>{
 const fd=f.open(),before=statSync(f.path),bytes=readFileSync(f.path);
 assert.equal(pythonTry(f.path),'acquired');assert.equal(locks.tryLock(fd),true);
 assert.equal(pythonTry(f.path),'busy','native success must represent an actual kernel lock');
 assert.equal(locks.unlock(fd),true);assert.equal(pythonTry(f.path),'acquired');
 assert.equal(statSync(f.path).ino,before.ino);assert.deepEqual(readFileSync(f.path),bytes);
}));
test('OS lock: independent opens in the same process conflict rather than acting reentrant',()=>fixture(f=>{
 const a=f.open(),b=f.open();assert.equal(locks.tryLock(a),true);
 assert.equal(locks.tryLock(b),false);assert.equal(locks.unlock(a),true);assert.equal(locks.tryLock(b),true);
}));
test('OS lock: closing the owning descriptor releases but closing an unrelated open does not',()=>fixture(f=>{
 const a=f.open(),b=f.open();assert.equal(locks.tryLock(a),true);f.close(b);
 assert.equal(pythonTry(f.path),'busy');f.close(a);assert.equal(pythonTry(f.path),'acquired');
}));
test('OS lock: repeating on the same descriptor is raw flock semantics, not a new permit',()=>fixture(f=>{
 const fd=f.open();assert.equal(locks.tryLock(fd),true);assert.equal(locks.tryLock(fd),true);
 locks.unlock(fd);assert.equal(pythonTry(f.path),'acquired');
}));
test('OS lock: independent workspace inodes can be held simultaneously',()=>fixture(f=>fixture(g=>{
 assert.equal(locks.tryLock(f.open()),true);assert.equal(locks.tryLock(g.open()),true);
 assert.equal(pythonTry(f.path),'busy');assert.equal(pythonTry(g.path),'busy');
})));
test('OS lock: file age does not unlock a live holder',()=>fixture(f=>{
 assert.equal(locks.tryLock(f.open()),true);utimesSync(f.path,1,1);
 assert.equal(pythonTry(f.path),'busy');
}));
for(const mode of [0o400,0o640,0o660,0o644])test(`OS lock: mode ${mode.toString(8)} is refused without taking the lock`,()=>fixture(f=>{
 const fd=f.open();chmodSync(f.path,mode);refusal(()=>locks.tryLock(fd));chmodSync(f.path,0o600);
 assert.equal(pythonTry(f.path),'acquired');
}));
test('OS lock: multiply-linked inode is rejected',()=>fixture(f=>{
 const fd=f.open(),alias=join(f.directory,'alias');linkSync(f.path,alias);
 refusal(()=>locks.tryLock(fd));unlinkSync(alias);assert.equal(locks.tryLock(fd),true);
}));
test('OS lock: nonregular descriptors and invalid descriptors are rejected',()=>fixture(f=>{
 const fd=openSync(f.directory,'r');try{refusal(()=>locks.tryLock(fd));}finally{closeSync(fd);}
 const closed=f.open();f.close(closed);refusal(()=>locks.tryLock(closed));refusal(()=>locks.unlock(closed));
}));
test('OS lock: malformed numeric inputs are refused before a descriptor conversion',()=>{
 for(const input of [NaN,Infinity,-Infinity,-1,0.5,2147483648,'1',null,{},undefined,1n]){
  refusal(()=>locks.tryLock(input));refusal(()=>locks.localProfile(input));refusal(()=>locks.unlock(input));
 }
});
test('OS lock: selected local filesystem reports a supported capability',()=>fixture(f=>{
 assert.equal(locks.localProfile(f.open()),true);
}));
async function childHolder(f,body) {
 const program=`import {createRequire} from 'node:module';import {openSync,writeSync} from 'node:fs';
const lock=createRequire(import.meta.url)(${JSON.stringify(modulePath)});const fd=openSync(${JSON.stringify(f.path)},'r+');
if(!lock.tryLock(fd))throw Error('fixture lock unavailable');writeSync(1,'HELD\\n');setInterval(()=>{},1000);`;
 const child=spawn(process.execPath,['--input-type=module','-e',program],{stdio:['ignore','pipe','pipe']});
 let stderr='',timer;child.stderr.on('data',x=>stderr+=x);
 const exit=new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});
 try{
  await new Promise((resolve,reject)=>{let out='';timer=setTimeout(()=>reject(Error('child barrier timed out: '+stderr)),10000);
   child.stdout.on('data',x=>{out+=x;if(out==='HELD\n'){clearTimeout(timer);resolve();}});
   child.once('error',reject);child.once('exit',()=>reject(Error('early child exit: '+stderr)));
  });
  await body(child,exit);
 }finally{clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exit;}}
}
test('OS lock: killing only the fixture child releases its kernel lock',()=>fixture(async f=>{
 await childHolder(f,async(child,exited)=>{
  const contender=f.open();assert.equal(locks.tryLock(contender),false);assert.equal(pythonTry(f.path),'busy');
  child.kill('SIGKILL');await exited;assert.equal(locks.tryLock(contender),true);
  locks.unlock(contender);assert.equal(pythonTry(f.path),'acquired');
 });
}));
test('OS lock: another native process sees busy while Python owns the inode',()=>fixture(async f=>{
 const program=`import os,fcntl,sys,time\nfd=os.open(sys.argv[1],os.O_RDWR)\nfcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)\nprint('HELD',flush=True)\ntime.sleep(30)`;
 const child=spawn('python3',['-c',program,f.path],{stdio:['ignore','pipe','pipe']});let timer,err='';child.stderr.on('data',x=>err+=x);
 const exited=new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});
 try{
  await new Promise((resolve,reject)=>{let out='';timer=setTimeout(()=>reject(Error('Python barrier: '+err)),10000);
   child.stdout.on('data',x=>{out+=x;if(out==='HELD\n'){clearTimeout(timer);resolve();}});child.once('error',reject);child.once('exit',()=>reject(Error('Python early exit '+err)));
  });
  const fd=f.open();assert.equal(locks.tryLock(fd),false,'busy must not be reported as acquired');
  child.kill('SIGTERM');await exited;assert.equal(locks.tryLock(fd),true);
 }finally{clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}}
}));
