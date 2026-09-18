/** Opening validates schema/metadata against one SQLite read snapshot. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteSessionStore } from '../../packages/storage/src/index.ts';
const workspace={installation_id:'00000000-0000-4000-8000-000000000001',workspace_id:'00000000-0000-4000-8000-000000000002'};
function fixture(fn){
  const directory=mkdtempSync(join(tmpdir(),'cc-inspection-')),stores=[];
  try{return fn(directory,stores);}finally{for(const s of stores)s.close();rmSync(directory,{recursive:true,force:true});}
}
for(const mode of ['create','open']) {
  test(`WP02A inspection: ${mode} checks run in a bounded read transaction`,()=>fixture((directory,stores)=>{
    if(mode==='open')SqliteSessionStore.create(directory,workspace).close();
    const prepare=DatabaseSync.prototype.prepare,states=[];
    DatabaseSync.prototype.prepare=function(sql){
      if(sql==='PRAGMA user_version')states.push(this.isTransaction);
      return prepare.call(this,sql);
    };
    try{stores.push(SqliteSessionStore[mode](directory,workspace));}
    finally{DatabaseSync.prototype.prepare=prepare;}
    assert.equal(states.length,mode==='open'?2:1);
    assert.deepEqual(states,states.map(()=>true),'schema inspection must observe one committed database snapshot');
    // Subsequent use must not encounter an inspection transaction left open.
    assert.equal(stores[0].diagnostics().journal_mode,'wal');
  }));
}
test('WP02A inspection: another writer can commit while the reader retains its original snapshot',()=>fixture((directory,stores)=>{
  SqliteSessionStore.create(directory,workspace).close();
  const writer=new DatabaseSync(join(directory,'ledger.sqlite'));
  const prepare=DatabaseSync.prototype.prepare,observations=[];let intercepted=false,reader;
  DatabaseSync.prototype.prepare=function(sql){
    if(sql==='PRAGMA user_version'&&!intercepted){
      intercepted=true;reader=this;
      observations.push(prepare.call(reader,"SELECT value FROM meta WHERE key='clock_high_water_ms'").get().value);
      writer.prepare("UPDATE meta SET value='123' WHERE key='clock_high_water_ms'").run();
    }
    if(sql==='PRAGMA foreign_key_check'&&this===reader){
      observations.push(prepare.call(reader,"SELECT value FROM meta WHERE key='clock_high_water_ms'").get().value);
    }
    return prepare.call(this,sql);
  };
  try{stores.push(SqliteSessionStore.open(directory,workspace));}
  finally{DatabaseSync.prototype.prepare=prepare;writer.close();}
  assert.deepEqual(observations,['0','0'],'one inspection must not mix committed versions');
  const fresh=new DatabaseSync(join(directory,'ledger.sqlite'),{readOnly:true});
  try{assert.equal(fresh.prepare("SELECT value FROM meta WHERE key='clock_high_water_ms'").get().value,'123');}
  finally{fresh.close();}
}));
test('WP02A inspection: failed validation rolls back and closes its read connection',()=>fixture((directory)=>{
  SqliteSessionStore.create(directory,workspace).close();
  const prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec,closed=DatabaseSync.prototype.close;
  const events=[];let reader;
  DatabaseSync.prototype.prepare=function(sql){
    if(sql==='PRAGMA user_version'&&!reader)reader=this;
    return prepare.call(this,sql);
  };
  DatabaseSync.prototype.exec=function(sql){if(this===reader&&sql==='ROLLBACK')events.push('rollback');return exec.call(this,sql);};
  DatabaseSync.prototype.close=function(){if(this===reader)events.push('close');return closed.call(this);};
  try{assert.throws(()=>SqliteSessionStore.open(directory,{...workspace,workspace_id:'00000000-0000-4000-8000-000000000009'}),e=>e.code==='E_SCOPE');}
  finally{DatabaseSync.prototype.prepare=prepare;DatabaseSync.prototype.exec=exec;DatabaseSync.prototype.close=closed;}
  assert.deepEqual(events,['rollback','close']);
  SqliteSessionStore.open(directory,workspace).close();
}));
