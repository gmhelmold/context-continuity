import test from 'node:test';
import assert from 'node:assert/strict';
import {lstatSync,readdirSync,renameSync,writeFileSync,unlinkSync,mkdirSync,rmSync,readFileSync,utimesSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {WorkspaceCoordinator,assertWorkspaceHold} from '../../packages/storage/src/workspace-coordinator.ts';
import {fixture,workspace,id,sql,exec,reject,pythonTry,ownerPath} from './coordinator-fixtures.mjs';
const anchorKey='coordinator.anchor.v1';
const key=id=>`coordinator.owner.v1:${id}`;

test('Coordinator: initialization anchors existing resources atomically without creating an owner',()=>fixture(f=>{
 const row=sql(f,'SELECT value FROM meta WHERE key=?',anchorKey)[0],a=JSON.parse(row.value);
 assert.deepEqual(a.workspace,workspace);assert.equal(a.resources.lock.ino,lstatSync(f.lock,{bigint:true}).ino.toString());
 assert.equal(sql(f,'SELECT * FROM storage_owners').length,0);assert.equal(pythonTry(f.lock),'acquired');
 WorkspaceCoordinator.initialize(f.directory,workspace);assert.deepEqual(sql(f,'SELECT value FROM meta WHERE key=?',anchorKey),[row]);
}));
test('Coordinator: ordinary open cannot initialize missing anchor or filesystem resources',()=>fixture(f=>{
 const before=readdirSync(f.directory).sort();reject(()=>f.open(),'E_CAPABILITY');assert.deepEqual(readdirSync(f.directory).sort(),before);
 assert.equal(sql(f,'SELECT * FROM storage_owners').length,0);
},{initialize:false}));
test('Coordinator: explicit initialize cannot recreate a missing anchored lock',()=>fixture(f=>{
 const before=sql(f,'SELECT * FROM meta');unlinkSync(f.lock);
 reject(()=>WorkspaceCoordinator.initialize(f.directory,workspace),'E_CAPABILITY');assert.equal(readdirSync(f.directory).includes('workspace.lock'),false);
 assert.deepEqual(sql(f,'SELECT * FROM meta'),before);
}));
for(const resource of ['lock','owners'])test(`Coordinator: new instance refuses replaced ${resource} against durable anchor`,()=>fixture(f=>{
 const path=f[resource],old=path+'.old';renameSync(path,old);
 if(resource==='lock')writeFileSync(path,'',{mode:0o600});else mkdirSync(path,{mode:0o700});
 const before=sql(f,'SELECT * FROM meta');reject(()=>f.open(),'E_CAPABILITY');reject(()=>WorkspaceCoordinator.initialize(f.directory,workspace),'E_CAPABILITY');
 assert.deepEqual(sql(f,'SELECT * FROM meta'),before);assert.equal(sql(f,'SELECT * FROM storage_owners').length,0);
}));
test('Coordinator: different workspace fails without publishing an owner',()=>fixture(f=>{
 reject(()=>WorkspaceCoordinator.open(f.directory,{...workspace,workspace_id:id(3)}),'E_SCOPE');
 assert.equal(sql(f,'SELECT * FROM storage_owners').length,0);assert.deepEqual(readdirSync(f.owners),[]);
}));
test('Coordinator: open publishes one owner only while its actual file is locked',()=>fixture(f=>{
 const a=f.open(),row=a.readOwner(a.owner_id);assert.equal(row.state,'active');
 assert.equal(pythonTry(ownerPath(f,a.owner_id)),'busy');assert.equal(pythonTry(f.lock),'acquired');
 assert.equal(row.identity.ino,lstatSync(ownerPath(f,a.owner_id),{bigint:true}).ino.toString());
 assert.ok(Object.isFrozen(row.identity));assert.ok(Object.isFrozen(a));
 assert.deepEqual(Object.keys(a).sort(),['owner_id','process_instance','workspace']);assert.equal('fd' in a,false);
 const b=f.open();assert.notEqual(a.owner_id,b.owner_id);assert.notEqual(a.process_instance,b.process_instance);
}));
test('Coordinator: Python witnesses section exclusion and handles expire after return',()=>fixture(f=>{
 const a=f.open(),b=f.open();let escaped;
 a.withWorkspaceLock(hold=>{escaped=hold;assert.equal(assertWorkspaceHold(workspace,hold),hold);assert.equal(pythonTry(f.lock),'busy');reject(()=>b.withWorkspaceLock(()=>{}),'E_CONFLICT');});
 assert.equal(pythonTry(f.lock),'acquired');reject(()=>assertWorkspaceHold(workspace,escaped),'E_OWNER');b.withWorkspaceLock(h=>assertWorkspaceHold(workspace,h));
}));
test('Coordinator: copied and foreign-scoped holds cannot gain authority',()=>fixture(f=>{
 const a=f.open();a.withWorkspaceLock(h=>{
  reject(()=>assertWorkspaceHold({...workspace,workspace_id:id(5)},h),'E_SCOPE');
  for(const x of [{...h},JSON.parse(JSON.stringify(h)),null])reject(()=>assertWorkspaceHold(workspace,x),'E_OWNER');
 });
}));
test('Coordinator: reentrancy and close inside a borrowed section preserve its original hold',()=>fixture(f=>{
 const a=f.open();a.withWorkspaceLock(h=>{
  reject(()=>a.withWorkspaceLock(()=>{}),'E_CONFLICT');reject(()=>a.readOwner(a.owner_id),'E_CONFLICT');reject(()=>a.close(),'E_CONFLICT');
  assertWorkspaceHold(workspace,h);assert.equal(pythonTry(f.lock),'busy');
 });assert.equal(a.readOwner(a.owner_id).state,'active');
}));
test('Coordinator: async and generator callbacks are refused before executing their bodies',()=>fixture(f=>{
 const a=f.open();let ran=false;
 for(const callback of [async()=>{ran=true;},function*(){ran=true;},async function*(){ran=true;},null,{}])reject(()=>a.withWorkspaceLock(callback),'E_CAPABILITY');
 assert.equal(ran,false);assert.equal(pythonTry(f.lock),'acquired');
}));
test('Coordinator: Promise and thenable results revoke authority without invoking accessors',async()=>fixture(async f=>{
 const a=f.open();let h,read=false;
 reject(()=>a.withWorkspaceLock(x=>{h=x;return Promise.resolve(1);}),'E_CAPABILITY');reject(()=>assertWorkspaceHold(workspace,h),'E_OWNER');
 reject(()=>a.withWorkspaceLock(()=>({get then(){read=true;throw Error('must not run');}})),'E_CAPABILITY');assert.equal(read,false);
 reject(()=>a.withWorkspaceLock(()=>Promise.reject(Error('synthetic rejection'))),'E_CAPABILITY');
 await new Promise(resolve=>setImmediate(resolve));assert.equal(pythonTry(f.lock),'acquired');
}));
test('Coordinator: callback failure releases exclusion and invalidates the borrowed hold',()=>fixture(f=>{
 const a=f.open();let h;reject(()=>a.withWorkspaceLock(x=>{h=x;throw Error('private callback');}),'E_STORAGE');
 reject(()=>assertWorkspaceHold(workspace,h),'E_OWNER');assert.equal(pythonTry(f.lock),'acquired');
 a.withWorkspaceLock(()=>{});
}));
test('Coordinator: close retires before releasing the owner and never removes lock files',()=>fixture(f=>{
 const a=f.open(),b=f.open(),path=ownerPath(f,a.owner_id),ino=lstatSync(path,{bigint:true}).ino;
 a.close();a.close();assert.equal(b.readOwner(a.owner_id).state,'retired');assert.equal(pythonTry(path),'acquired');
 assert.equal(lstatSync(path,{bigint:true}).ino,ino);assert.equal(readFileSync(path).length,0);
 reject(()=>a.withWorkspaceLock(()=>{}),'E_OWNER');reject(()=>a.readOwner(a.owner_id),'E_OWNER');
}));
test('Coordinator: self and old-but-held owner are not retired by inspection',()=>fixture(f=>{
 const a=f.open(),b=f.open();utimesSync(ownerPath(f,a.owner_id),1,1);
 assert.equal(a.retireOwner(a.owner_id).state,'held');assert.equal(b.retireOwner(a.owner_id).state,'held');
 assert.equal(b.readOwner(a.owner_id).state,'active');assert.equal(pythonTry(ownerPath(f,a.owner_id)),'busy');
}));
test('Coordinator: absent and already-retired records are idempotent diagnostics',()=>fixture(f=>{
 const a=f.open(),b=f.open();assert.deepEqual(a.retireOwner(id(500)),{state:'absent',owner:null});
 b.close();const row=a.retireOwner(b.owner_id);assert.equal(row.state,'retired');assert.deepEqual(a.retireOwner(b.owner_id),row);
}));
test('Coordinator: failed close revokes its instance but preserves active record for later inspection',()=>fixture(f=>{
 const a=f.open(),b=f.open();b.withWorkspaceLock(()=>reject(()=>a.close(),'E_CONFLICT'));
 assert.equal(b.readOwner(a.owner_id).state,'active');assert.equal(pythonTry(ownerPath(f,a.owner_id)),'acquired');
 reject(()=>a.withWorkspaceLock(()=>{}),'E_OWNER');assert.equal(b.retireOwner(a.owner_id).state,'retired');
}));
for(const kind of ['staging','read_pin','export_pin'])test(`Coordinator: ${kind} reservation prevents automatic retirement and is preserved`,()=>fixture(f=>{
 const a=f.open(),b=f.open();sql(f,`INSERT INTO storage_reservations(reservation_id,owner_id,operation_id,kind,size_bytes,created_at) VALUES (?,?,?,?,?,?)`,id(7),a.owner_id,id(8),kind,123,'synthetic');
 const before=sql(f,'SELECT * FROM storage_reservations');reject(()=>a.close(),'E_CAPABILITY');reject(()=>b.retireOwner(a.owner_id),'E_CAPABILITY');
 assert.equal(b.readOwner(a.owner_id).state,'active');assert.deepEqual(sql(f,'SELECT * FROM storage_reservations'),before);
 assert.equal(pythonTry(ownerPath(f,a.owner_id)),'acquired');
}));
test('Coordinator: missing owner file cannot be recreated by inspection',()=>fixture(f=>{
 const a=f.open(),b=f.open();b.withWorkspaceLock(()=>reject(()=>a.close(),'E_CONFLICT'));unlinkSync(ownerPath(f,a.owner_id));
 reject(()=>b.retireOwner(a.owner_id),'E_CAPABILITY');assert.equal(b.readOwner(a.owner_id).state,'active');
 assert.equal(readdirSync(f.owners).includes(a.owner_id+'.lock'),false);
}));
test('Coordinator: replacing an old owner file does not provide retirement authority',()=>fixture(f=>{
 const a=f.open(),b=f.open();b.withWorkspaceLock(()=>reject(()=>a.close(),'E_CONFLICT'));
 const path=ownerPath(f,a.owner_id);renameSync(path,path+'.old');writeFileSync(path,'',{mode:0o600});
 reject(()=>b.retireOwner(a.owner_id),'E_CAPABILITY');assert.equal(b.readOwner(a.owner_id).state,'active');
}));
test('Coordinator: malformed persisted metadata is never silently adopted',()=>fixture(f=>{
 const a=f.open(),b=f.open();b.close();sql(f,'UPDATE meta SET value=? WHERE key=?','{}',key(b.owner_id));
 reject(()=>a.readOwner(b.owner_id),'E_CAPABILITY');reject(()=>a.retireOwner(b.owner_id),'E_CAPABILITY');
}));
test('Coordinator: registration rollback leaves neither an owner row nor its identity row',()=>fixture(f=>{
 exec(f,"CREATE TRIGGER fixture_reject BEFORE INSERT ON meta WHEN NEW.key LIKE 'coordinator.owner.v1:%' BEGIN SELECT RAISE(ABORT,'synthetic'); END");
 reject(()=>f.open(),'E_STORAGE');assert.equal(sql(f,'SELECT * FROM storage_owners').length,0);
 assert.equal(sql(f,"SELECT * FROM meta WHERE key LIKE 'coordinator.owner.v1:%'").length,0);
 exec(f,'DROP TRIGGER fixture_reject');for(const file of readdirSync(f.owners))assert.equal(pythonTry(join(f.owners,file)),'acquired');
 const a=f.open();assert.equal(a.readOwner(a.owner_id).state,'active');
}));
test('Coordinator: anchor rollback is explicit and retry never adopts an existing owner',()=>fixture(f=>{
 exec(f,"CREATE TRIGGER fixture_reject BEFORE INSERT ON meta WHEN NEW.key='coordinator.anchor.v1' BEGIN SELECT RAISE(ABORT,'synthetic'); END");
 reject(()=>WorkspaceCoordinator.initialize(f.directory,workspace),'E_STORAGE');assert.equal(sql(f,'SELECT * FROM meta WHERE key=?',anchorKey).length,0);
 exec(f,'DROP TRIGGER fixture_reject');WorkspaceCoordinator.initialize(f.directory,workspace);assert.equal(sql(f,'SELECT * FROM meta WHERE key=?',anchorKey).length,1);
},{initialize:false}));
test('Coordinator: unknown prior owner rows prevent publishing an invented anchor',()=>fixture(f=>{
 sql(f,'INSERT INTO storage_owners VALUES (?,?,?,?,?)',id(8),id(9),`owners/${id(8)}.lock`,'active','synthetic');
 reject(()=>WorkspaceCoordinator.initialize(f.directory,workspace),'E_CAPABILITY');assert.equal(sql(f,'SELECT * FROM meta WHERE key=?',anchorKey).length,0);
},{initialize:false}));
test('Coordinator: workspace lock contention happens before a write transaction is opened',()=>fixture(f=>{
 const a=f.open(),b=f.open(),original=DatabaseSync.prototype.exec;let writes=0;
 a.withWorkspaceLock(()=>{DatabaseSync.prototype.exec=function(q){if(q==='BEGIN IMMEDIATE')writes++;return original.call(this,q);};
  try{reject(()=>b.retireOwner(a.owner_id),'E_CONFLICT');}finally{DatabaseSync.prototype.exec=original;}
 });assert.equal(writes,0);
}));
test('Coordinator: retirement failure rolls back its record and releases only inspection resources',()=>fixture(f=>{
 const a=f.open(),b=f.open();b.withWorkspaceLock(()=>reject(()=>a.close(),'E_CONFLICT'));
 exec(f,"CREATE TRIGGER fixture_reject BEFORE UPDATE ON storage_owners BEGIN SELECT RAISE(ABORT,'synthetic'); END");
 reject(()=>b.retireOwner(a.owner_id),'E_STORAGE');assert.equal(b.readOwner(a.owner_id).state,'active');
 assert.equal(pythonTry(ownerPath(f,a.owner_id)),'acquired');exec(f,'DROP TRIGGER fixture_reject');
 assert.equal(b.retireOwner(a.owner_id).state,'retired');
}));
test('Coordinator: stored anchor changes revoke borrowed authority and cannot be silently repaired',()=>fixture(f=>{
 const a=f.open(),saved=sql(f,'SELECT value FROM meta WHERE key=?',anchorKey)[0].value;
 try{a.withWorkspaceLock(h=>{sql(f,'UPDATE meta SET value=? WHERE key=?','{}',anchorKey);reject(()=>assertWorkspaceHold(workspace,h),'E_CAPABILITY');});assert.fail('guard must fail');}
 catch(e){assert.equal(e.code,'E_CAPABILITY');}finally{sql(f,'UPDATE meta SET value=? WHERE key=?',saved,anchorKey);}
}));
test('Coordinator: closing does not change job state, quotas or create a session',()=>fixture(f=>{
 const a=f.open();a.close();for(const table of ['jobs','attempts','aux_runs','sessions','storage_reservations','chapters'])assert.equal(sql(f,`SELECT count(*) AS n FROM ${table}`)[0].n,0);
}));
test('Coordinator: an old hold stays expired even inside a later valid section',()=>fixture(f=>{
 const a=f.open();let old,observed;a.withWorkspaceLock(h=>{old=h;});a.withWorkspaceLock(h=>{assertWorkspaceHold(workspace,h);try{assertWorkspaceHold(workspace,old);}catch(e){observed=e.code;}});assert.equal(observed,'E_OWNER');
}));
test('Coordinator: owner lock is already held when its active row is first inserted',()=>fixture(f=>{
 const original=DatabaseSync.prototype.prepare;let seen=0;
 DatabaseSync.prototype.prepare=function(query){
  const statement=original.call(this,query);
  if(query.includes('INSERT INTO storage_owners')){const run=statement.run;statement.run=function(...args){seen++;assert.equal(pythonTry(ownerPath(f,args[0])),'busy');return run.apply(this,args);};}
  return statement;
 };
 try{const a=f.open();assert.equal(seen,1);assert.equal(a.readOwner(a.owner_id).state,'active');}finally{DatabaseSync.prototype.prepare=original;}
}));
test('Coordinator: inspection lock is still held at the retirement COMMIT',()=>fixture(f=>{
 const a=f.open(),b=f.open();b.withWorkspaceLock(()=>reject(()=>a.close(),'E_CONFLICT'));
 const original=DatabaseSync.prototype.exec;let commits=0;
 DatabaseSync.prototype.exec=function(q){if(q==='COMMIT'){commits++;assert.equal(pythonTry(ownerPath(f,a.owner_id)),'busy');}return original.call(this,q);};
 try{assert.equal(b.retireOwner(a.owner_id).state,'retired');assert.equal(commits,1);}finally{DatabaseSync.prototype.exec=original;}
 assert.equal(pythonTry(ownerPath(f,a.owner_id)),'acquired');
}));
test('Coordinator review: rollback failure cannot leave a usable borrowed section',()=>fixture(f=>{
 const a=f.open(),b=f.open();b.withWorkspaceLock(()=>reject(()=>a.close(),'E_CONFLICT'));
 const original=DatabaseSync.prototype.exec;let rollback=0;
 DatabaseSync.prototype.exec=function(q){if(q==='COMMIT')throw Error('synthetic commit failure');if(q==='ROLLBACK'){rollback++;throw Error('synthetic rollback failure');}return original.call(this,q);};
 try{reject(()=>b.retireOwner(a.owner_id),'E_STORAGE');}finally{DatabaseSync.prototype.exec=original;}
 try{
  assert.equal(rollback,1);let executed=false;
  reject(()=>b.withWorkspaceLock(()=>{executed=true;}),'E_STORAGE');assert.equal(executed,false);
 }finally{try{b.close();}catch(e){assert.equal(e.code,'E_STORAGE');}}
 assert.equal(sql(f,'SELECT state FROM storage_owners WHERE owner_id=?',a.owner_id)[0].state,'active');
 assert.equal(pythonTry(f.lock),'acquired');
}));
test('Coordinator review: connection cleanup errors never expose raw driver details',()=>fixture(f=>{
 const original=DatabaseSync.prototype.close;let calls=0;
 // A read-only inspector closes first; inject only on the final connection cleanup.
 DatabaseSync.prototype.close=function(){const result=original.call(this);calls++;if(calls===2)throw Error('private driver fixture');return result;};
 try{assert.throws(()=>WorkspaceCoordinator.initialize(f.directory,workspace),e=>e.code==='E_STORAGE'&&!e.message.includes('private driver'));assert.equal(calls,2);}
 finally{DatabaseSync.prototype.close=original;}
 assert.equal(pythonTry(f.lock),'acquired');
}));
test('Coordinator review: binding an async function cannot execute it inside a synchronous hold',()=>fixture(f=>{
 const a=f.open();let ran=false;const callback=(async()=>{ran=true;}).bind(null);
 reject(()=>a.withWorkspaceLock(callback),'E_CAPABILITY');assert.equal(ran,false);
}));

// TypeScript private constructors are erased for JavaScript consumers.
test('Coordinator review: direct JavaScript construction is rejected before acquiring resources',()=>{
 const record={owner_id:id(90),process_instance:id(91)},access=[];
 const resources=new Proxy({}, {get(_target,name){access.push(name);throw Error('fixture resource must not be accessed');}});
 for(const key of [undefined,null,Symbol('WorkspaceCoordinator construction')]){
  reject(()=>Reflect.construct(WorkspaceCoordinator,[resources,{identity:workspace},{},record,key]),'E_OWNER');
 }
 assert.deepEqual(access,[]);
});
