import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {SqliteSessionStore} from '../../packages/storage/src/index.ts';
import {createSessionBinding,hashSource,hashPayload,resolveConfig,createManifest,createJobContext} from '../../packages/core/src/index.ts';
export const id=n=>`00000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
export const workspace={installation_id:id(1),workspace_id:id(2)};
export const binding=(name='A')=>createSessionBinding({...workspace,adapter_id:'synthetic',host_session_id:name},id(3),0);
export const proposal=()=>({schema_version:1,action:'replace',title:'Retained result',outcome:[{text:'Synthetic result',sources:[1]}],decisions:[],open_items:[],constraints:[],evidence:[],warnings:[],feedback_applied:[]});
export const response=(patch={})=>({kind:'response',text:JSON.stringify(proposal()),finish:'complete',local_stopped:true,parent_input_tokens:5000,candidate_input_tokens:1000,...patch});
export const amount={input_tokens:8192,output_tokens:4096};
export function fixture(fn,settings={}) {
 const directory=mkdtempSync(join(tmpdir(),'cc-jobs-')),handles=[];let now=100000;
 const open=()=>{const s=SqliteSessionStore.open(directory,workspace,()=>now);handles.push(s);return s;};
 const store=SqliteSessionStore.create(directory,workspace,()=>now);handles.push(store);
 const b=binding(),cfg=resolveConfig(settings,{context_window:100000,output_reserve:4096});store.createSession(b,cfg);
 let lease=store.acquireLease(b);const bytes=Buffer.from('\ufeffSynthetic é evidence\r\n');
 const source={ref:{source_id:id(10),revision:0,digest:hashSource(bytes)},native_refs:['m1'],media_type:'text/plain',bytes};
 const observation={native_identity:'r1',authority:'agent',protocol_group:'r1',completed:true,protected:false,native_refs:['m1'],source_refs:[source.ref],payload_ref:'m1',payload:[{role:'assistant',content:bytes.toString()}],estimated_tokens:5000};
 const catalog=store.retainRoots(lease,{expected_catalog_digest:store.readRootCatalog(b).catalog_digest,sources:[source],observations:[observation]});
 const f={directory,path:join(directory,'ledger.sqlite'),s:store,b,cfg,source,observation,catalog,
  get lease(){return lease;},time:()=>now,advance:n=>now+=n,setTime:n=>now=n,open,
  useLease:l=>lease=l,renew:()=>lease=store.renewLease(lease)};
 f.job=(fields={},manifestOverride)=>{
  const entity={kind:'source',ref:source.ref};
  const verified=manifestOverride??createManifest(b,[{entity,authority:'agent',range:{start_byte:0,end_byte:bytes.length},excerpt_digest:hashSource(bytes),presented_as:'full',locator:'s1'}],()=>({binding:b,entity,authority:'agent',bytes}));
  const roots=catalog.entries.map(e=>e.unit.root_coverage[0]);
  return createJobContext(b,{view_revision:0,policy_revision:0,owner_fence:lease.owner_fence,frame_id:id(30),
   logical_coverage:roots.map(r=>r.unit_id),root_coverage:roots,read_dependencies:[entity],prefix_digest:hashPayload([]),coverage_digest:hashPayload(roots),
   config_digest:hashPayload(cfg),effective_input_digest:hashPayload([]),feedback_ids:[],work:{task_id:'task',phase_id:'phase'},created_at:new Date(now).toISOString(),...fields},verified,'  Maintain synthetic context only.\r\n');
 };
 const finish=()=>{for(const h of handles)h.close();rmSync(directory,{recursive:true,force:true});};
 try{const result=fn(f);if(result?.then)return result.finally(finish);finish();return result;}catch(e){finish();throw e;}
}
export function sql(f,query,...args){const db=new DatabaseSync(f.path);try{return db.prepare(query).all(...args);}finally{db.close();}}
export function exec(f,query){const db=new DatabaseSync(f.path);try{db.exec(query);}finally{db.close();}}
export function begin(f,job=f.job()) {
 f.s.admitJob(f.lease,job,job.ref);const attempt=f.s.reserveJobAttempt(f.lease,job.ref,amount);
 f.s.markJobAttemptDispatched(f.lease,job.ref,attempt);return {job,attempt};
}
