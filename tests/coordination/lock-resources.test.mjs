/** Real private files and kernel locks; no user data or liveness claims. */
import test from 'node:test';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,cpSync,realpathSync,writeFileSync,readFileSync,lstatSync,readdirSync,renameSync,chmodSync,unlinkSync,symlinkSync,linkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {LockResources,sameFile} from '../../packages/storage/src/lock-resources.ts';
const id=n=>`00000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
const reject=(fn,code='E_CAPABILITY')=>assert.throws(fn,e=>e.code===code);
function fixture(fn){
 const directory=mkdtempSync(join(tmpdir(),'cc-managed-lock-')),resources=[];
 const open=(initialize=true)=>{const r=LockResources.open(directory,initialize);resources.push(r);return r;};
 const cleanup=()=>{try{for(const r of resources)r.close();}finally{rmSync(directory,{recursive:true,force:true});}};
 try{const value=fn({directory,open,lock:join(directory,'workspace.lock'),owners:join(directory,'owners')});
  if(value?.then)return value.finally(cleanup);cleanup();return value;
 }catch(e){cleanup();throw e;}
}
function pythonTry(path){
 const code=`import os,fcntl,sys\nfd=os.open(sys.argv[1],os.O_RDWR)\ntry:\n try:\n  fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)\n  print('acquired')\n except BlockingIOError:\n  print('busy')\nfinally:\n os.close(fd)`;
 const r=spawnSync('python3',['-c',code,path],{encoding:'utf8',timeout:10000});
 assert.equal(r.error,undefined,'witness timeout/setup is not proof');assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr);return r.stdout.trim();
}
test('Resources: explicit bootstrap is private and reopening preserves file identity',()=>fixture(f=>{
 const a=f.open(),b=f.open(false);assert.deepEqual(a.identity,b.identity);assert.ok(Object.isFrozen(a.identity.lock));
 assert.equal(lstatSync(f.owners).mode&0o7777,0o700);assert.equal(lstatSync(f.lock).mode&0o7777,0o600);
 assert.equal(readFileSync(f.lock).length,0);assert.deepEqual(readdirSync(f.directory).sort(),['owners','workspace.lock']);
 assert.deepEqual(Object.keys(a).sort(),['directory','identity']);assert.equal('fd' in a,false);
}));
test('Resources: open never creates absent lock paths',()=>fixture(f=>{
 reject(()=>f.open(false));assert.deepEqual(readdirSync(f.directory),[]);
 f.open().close();unlinkSync(f.lock);reject(()=>f.open(false));assert.equal(readdirSync(f.directory).includes('workspace.lock'),false);
}));
test('Resources review: initialization flag must be explicitly boolean',()=>fixture(f=>{
 for(const value of [undefined,null,0,1,'false',{},[]])reject(()=>LockResources.open(f.directory,value));
 assert.deepEqual(readdirSync(f.directory),[]);
}));
test('Resources: independent managers and Python agree about workspace exclusion',()=>fixture(f=>{
 const a=f.open(),b=f.open(false);assert.equal(pythonTry(f.lock),'acquired');a.acquire();assert.equal(pythonTry(f.lock),'busy');
 reject(()=>b.acquire(),'E_CONFLICT');a.release();b.acquire();b.release();assert.equal(pythonTry(f.lock),'acquired');
}));
test('Resources: reentrant acquisition is refused without releasing the original hold',()=>fixture(f=>{
 const a=f.open();a.acquire();reject(()=>a.acquire(),'E_CONFLICT');assert.equal(pythonTry(f.lock),'busy');a.release();
}));
test('Resources: release and close are idempotent without changing file bytes',()=>fixture(f=>{
 const a=f.open(),before=lstatSync(f.lock,{bigint:true});a.release();a.acquire();a.release();a.release();a.close();a.close();
 reject(()=>a.guard());reject(()=>a.acquire());assert.equal(pythonTry(f.lock),'acquired');assert.equal(lstatSync(f.lock,{bigint:true}).ino,before.ino);assert.equal(readFileSync(f.lock).length,0);
}));
test('Resources: workspace and owner locks have distinct exclusion domains',()=>fixture(f=>{
 const a=f.open(),owner=a.owner(id(1),true),path=join(f.owners,id(1)+'.lock');
 try{a.acquire();assert.equal(owner.tryLock(),true);assert.equal(pythonTry(path),'busy');a.release();assert.equal(pythonTry(f.lock),'acquired');assert.equal(pythonTry(path),'busy');}
 finally{owner.close();}assert.equal(pythonTry(path),'acquired');
}));
test('Resources: exclusive owner creation cannot reuse an existing UUID',()=>fixture(f=>{
 const a=f.open(),owner=a.owner(id(1),true),path=join(f.owners,id(1)+'.lock');
 try{owner.tryLock();reject(()=>a.owner(id(1),true));const b=a.owner(id(1),false);try{assert.equal(b.tryLock(),false);}finally{b.close();}assert.equal(pythonTry(path),'busy');}
 finally{owner.close();}
}));
test('Resources review: owner identifiers are strict data without coercion',()=>fixture(f=>{
 const a=f.open();let converted=false;
 for(const value of ['../outside', '00000000----------------------------', '',null, {toString(){converted=true;return id(1);}}])reject(()=>a.owner(value,true));
 assert.equal(converted,false);assert.deepEqual(readdirSync(f.owners),[]);
}));
test('Resources review: parent close closes outstanding owners and revokes child reuse',()=>fixture(f=>{
 const a=f.open(),owner=a.owner(id(1),true),path=join(f.owners,id(1)+'.lock');owner.tryLock();a.close();
 try{assert.equal(pythonTry(path),'acquired');reject(()=>owner.guard());reject(()=>owner.tryLock());reject(()=>owner.sync());}finally{owner.close();}
}));
test('Resources: closing one child does not release another owner',()=>fixture(f=>{
 const a=f.open(),x=a.owner(id(1),true),y=a.owner(id(2),true);x.tryLock();y.tryLock();x.close();
 try{assert.equal(pythonTry(join(f.owners,id(1)+'.lock')),'acquired');assert.equal(pythonTry(join(f.owners,id(2)+'.lock')),'busy');}finally{y.close();}
}));
test('Resources: replaced workspace pathname invalidates the existing manager',()=>fixture(f=>{
 const a=f.open();a.acquire();const old=f.lock+'.old';renameSync(f.lock,old);writeFileSync(f.lock,'',{mode:0o600});
 reject(()=>a.guard());reject(()=>a.acquire());assert.equal(pythonTry(old),'busy');a.release();assert.equal(pythonTry(old),'acquired');
}));
test('Resources: replaced owners directory invalidates the existing manager',()=>fixture(f=>{
 const a=f.open();renameSync(f.owners,f.owners+'.old');mkdirSync(f.owners,{mode:0o700});reject(()=>a.guard());reject(()=>a.owner(id(1),true));assert.deepEqual(readdirSync(f.owners),[]);
}));
test('Resources: replaced owner inode is refused by its original handle',()=>fixture(f=>{
 const a=f.open(),owner=a.owner(id(1),true),path=join(f.owners,id(1)+'.lock');owner.tryLock();renameSync(path,path+'.old');writeFileSync(path,'',{mode:0o600});
 try{reject(()=>owner.guard());reject(()=>owner.tryLock());assert.equal(pythonTry(path+'.old'),'busy');}finally{owner.close();}
}));
test('Resources review: parent identity is checked when using an already-open owner',()=>fixture(f=>{
 const a=f.open(),owner=a.owner(id(1),true);renameSync(f.owners,f.owners+'.old');mkdirSync(f.owners,{mode:0o700});
 try{reject(()=>owner.tryLock());}finally{owner.close();}
}));
for(const target of ['directory','owners','lock'])test(`Resources: altered ${target} permissions are refused without repair`,()=>fixture(f=>{
 const a=f.open(),path=target==='directory'?f.directory:target==='owners'?f.owners:f.lock;
 chmodSync(path,target==='lock'?0o640:0o755);try{reject(()=>a.guard());reject(()=>LockResources.open(f.directory,false));}finally{chmodSync(path,target==='lock'?0o600:0o700);}
}));
test('Resources: symlinks and hardlinks are refused without modifying their targets',()=>fixture(f=>{
 const a=f.open(),extra=join(f.directory,'extra');writeFileSync(extra,'unchanged',{mode:0o600});
 const ownerPath=join(f.owners,id(1)+'.lock');symlinkSync(extra,ownerPath);reject(()=>a.owner(id(1),false));reject(()=>a.owner(id(1),true));assert.equal(readFileSync(extra,'utf8'),'unchanged');
 unlinkSync(ownerPath);linkSync(f.lock,ownerPath);reject(()=>a.guard());reject(()=>a.owner(id(1),false));unlinkSync(ownerPath);a.guard();
}));
test('Resources: nonempty existing files are refused without truncating bytes',()=>fixture(f=>{
 const a=f.open();writeFileSync(f.lock,'preserve');reject(()=>a.guard());reject(()=>f.open());assert.equal(readFileSync(f.lock,'utf8'),'preserve');
}));
test('Resources: identities are exact strings and are not reduced to numeric precision',()=>{
 assert.equal(sameFile({dev:'1',ino:'9007199254740992'},{dev:'1',ino:'9007199254740993'}),false);
 assert.equal(sameFile({dev:'1',ino:'2'},{dev:'2',ino:'2'}),false);
});

test('Resources review: trailing slash must not hide a symlink workspace',()=>fixture(f=>{
 const alias=join(f.directory,'alias');symlinkSync(f.directory,alias);
 reject(()=>LockResources.open(alias+'/',true));assert.deepEqual(readdirSync(f.directory),['alias']);
}));
test('Resources: canonical directory with trailing slash remains supported',()=>fixture(f=>{
 const a=LockResources.open(f.directory+'/',true);try{assert.equal(a.directory,realpathSync(f.directory));}finally{a.close();}
}));
test('Resources: parent directory replacement revokes its existing resource',()=>fixture(f=>{
 const a=f.open(),old=f.directory+'.old';renameSync(f.directory,old);mkdirSync(f.directory,{mode:0o700});
 try{reject(()=>a.guard());reject(()=>a.acquire());}finally{rmSync(f.directory,{recursive:true});renameSync(old,f.directory);}
}));
test('Resources: fresh open has no durable authority to adopt the old lock identity',()=>fixture(f=>{
 const a=f.open();renameSync(f.lock,f.lock+'.old');writeFileSync(f.lock,'',{mode:0o600});const b=f.open(false);
 assert.equal(sameFile(a.identity.lock,b.identity.lock),false);reject(()=>a.guard());
 // Persistence must compare b.identity with its admitted anchor; this layer has no DB.
}));
test('Resources: failure after descriptor open closes it and never takes a kernel lock',()=>fixture(f=>{
 const a=f.open(),path=join(f.owners,id(1)+'.lock');writeFileSync(path,'',{mode:0o640});reject(()=>a.owner(id(1),false));
 chmodSync(path,0o600);assert.equal(pythonTry(path),'acquired');const good=a.owner(id(1),false);good.close();
}));
test('Resources: imports are lazy and a missing native build fails before initialization',()=>fixture(f=>{
 const copyRoot=mkdtempSync(join(tmpdir(),'cc-lock-loader-'));
 try{
  const dst=join(copyRoot,'packages/storage/src');mkdirSync(dst,{recursive:true});
  for(const name of ['errors.ts','lock-resources.ts'])cpSync(fileURLToPath(new URL('../../packages/storage/src/'+name,import.meta.url)),join(dst,name));
  writeFileSync(join(copyRoot,'package.json'),' {"type":"module"}');
  const code=`import assert from 'node:assert/strict';import {LockResources} from ${JSON.stringify(new URL('file://'+join(dst,'lock-resources.ts')).href)};console.log('imported');assert.throws(()=>LockResources.open(${JSON.stringify(f.directory)},true),e=>e.code==='E_CAPABILITY');console.log('rejected');`;
  const r=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',code],{encoding:'utf8',timeout:10000});
  assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),'imported\nrejected');assert.deepEqual(readdirSync(f.directory),[]);
 }finally{rmSync(copyRoot,{recursive:true,force:true});}
}));
test('Resources: fixture process exit releases its managed workspace and owner locks',()=>fixture(async f=>{
 const initialized=f.open();initialized.close();
 const module=new URL('../../packages/storage/src/lock-resources.ts',import.meta.url).href;
 const code=String.raw`import {LockResources} from ${JSON.stringify(module)};import {writeSync} from 'node:fs';const r=LockResources.open(${JSON.stringify(f.directory)},false);r.acquire();const o=r.owner(${JSON.stringify(id(1))},true);if(!o.tryLock())throw Error('busy');writeSync(1,'HELD\n');setInterval(()=>{},1000);`;
 const child=spawn(process.execPath,['--experimental-strip-types','--input-type=module','-e',code],{stdio:['ignore','pipe','pipe']});
 let stderr='',timer;child.stderr.on('data',x=>stderr+=x);
 const exited=new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});
 try{
  await new Promise((resolve,reject)=>{let out='';timer=setTimeout(()=>reject(Error('fixture barrier '+stderr)),10000);
   child.stdout.on('data',x=>{out+=x;if(out==='HELD\n'){clearTimeout(timer);resolve();}});child.once('error',reject);child.once('exit',()=>reject(Error('early fixture exit '+stderr)));
  });
  const path=join(f.owners,id(1)+'.lock');assert.equal(pythonTry(f.lock),'busy');assert.equal(pythonTry(path),'busy');
  child.kill('SIGTERM');await exited;assert.equal(pythonTry(f.lock),'acquired');assert.equal(pythonTry(path),'acquired');
  const again=f.open(false);again.acquire();again.release();
 }finally{clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}}
}));

function closeFault(file,body){
 const original=fs.closeSync;let fired=0;
 fs.closeSync=function(fd){
  const stat=fs.fstatSync(fd,{bigint:true}),mine=stat.dev.toString()===file.dev&&stat.ino.toString()===file.ino;
  original(fd);
  if(mine){fired++;throw Object.assign(new Error('private fixture close detail'),{code:'EIO'});}
 };
 syncBuiltinESMExports();
 try{body();assert.equal(fired,1,'the injected close path must execute once');}
 finally{fs.closeSync=original;syncBuiltinESMExports();}
}
test('Resources review: an owner close failure is sanitized and its handle stays revoked',()=>fixture(f=>{
 const r=f.open(),owner=r.owner(id(1),true),path=join(f.owners,id(1)+'.lock');owner.tryLock();
 closeFault(owner.identity,()=>assert.throws(()=>owner.close(),e=>e.code==='E_CAPABILITY'&&!e.message.includes('private fixture')));
 reject(()=>owner.tryLock());owner.close();assert.equal(pythonTry(path),'acquired');
}));
test('Resources: one close failure does not prevent closing other owned locks',()=>fixture(f=>{
 const r=f.open(),a=r.owner(id(1),true),b=r.owner(id(2),true);r.acquire();a.tryLock();b.tryLock();
 closeFault(a.identity,()=>reject(()=>r.close()));
 for(const path of [f.lock,join(f.owners,id(1)+'.lock'),join(f.owners,id(2)+'.lock')])assert.equal(pythonTry(path),'acquired');
 reject(()=>a.guard());reject(()=>b.guard());reject(()=>r.guard());
}));
