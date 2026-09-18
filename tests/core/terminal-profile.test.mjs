import test from 'node:test';
import assert from 'node:assert/strict';
import { sealFrame, assertFrameUnchanged, createJSONFrameProfile, RootIdentityRegistry, createCapture } from '../../packages/core/src/index.ts';
import { frameFixture, fixtureProfile, fixtureProtocol, id, sha } from './context-fixtures.mjs';

test('D04: both positive layouts keep function call and result in one atomic root',()=>{
  for(const format of ['messages','contents']) {
    const f=frameFixture(format);
    const frame=sealFrame(f.binding,f.capture,f.registry,f.body,f.layout,f.profile);
    assert.equal(frame.roots.length,2);
    assert.equal(f.layout.groups[1].count,2);
  }
});
test('D05: changed wire model cannot be sealed against an old resolved identity',()=>{
  const f=frameFixture();
  assert.throws(()=>sealFrame(f.binding,f.capture,f.registry,{...f.body,model:'actual-new-model'},f.layout,f.profile),e=>e.code==='E_PROTOCOL');
});

const seal=f=>sealFrame(f.binding,f.capture,f.registry,f.body,f.layout,f.profile);
const rejects=f=>assert.throws(f,e=>['E_SCHEMA','E_PROTOCOL','E_STALE'].includes(e.code));
function regroup(f, data, incomplete=false) {
  f.registry=new RootIdentityRegistry(f.binding);f.data=data;
  f.map=data.map((payload,i)=>({native_identity:`g-${i}`,native_refs:payload.map((_,j)=>`g-${i}-${j}`)}));
  data.forEach((payload,i)=>f.registry.observe({...f.map[i],authority:'agent',protocol_group:'group-'+i,completed:!(incomplete&&i===data.length-1),protected:false,
    source_refs:[{source_id:id(700+i),revision:0,digest:sha(JSON.stringify(payload))}],payload_ref:'memory-'+i,payload,estimated_tokens:10}));
  f.capture=createCapture(f.binding,{kind:'primary',work:{task_id:null,phase_id:null},native_identity_map:f.map});
  const key=f.layout.history_key;f.body[key]=[...f.body[key].slice(0,f.layout.prefix_length),...data.flat()];
  f.layout.groups=f.map.map((m,i)=>({native_identity:m.native_identity,count:data[i].length}));return f;
}
test('D04: unsafe split agreeing with registry and payload is still refused by the codec',()=>{
  for(const format of ['messages','contents']) {
    const f=frameFixture(format);const [call,result]=f.data[1];
    regroup(f,[f.data[0],[call],[result]]);
    const before=f.registry.exportState();rejects(()=>seal(f));assert.deepEqual(f.registry.exportState(),before);
  }
});
test('D04: multiple calls/results can only be omitted as a whole and retain allowed result order',()=>{
  const f=frameFixture('contents');
  const call=n=>({functionCall:{id:'c'+n,name:'read',args:{}}});
  const result=n=>({functionResponse:{id:'c'+n,name:'read',response:{text:'r'+n}}});
  const exchange=[{role:'model',parts:[call(1),call(2)]},{role:'user',parts:[result(2),result(1)]}];
  regroup(f,[f.data[0],exchange]);assert.equal(seal(f).roots.length,2);
  regroup(f,[f.data[0],exchange.slice(0,1)]);rejects(()=>seal(f));
  regroup(f,[f.data[0],exchange.slice(0,1)],true);
  const frame=seal(f);assert.equal(frame.roots[1].protected,true);assert.equal(frame.roots[1].completed,false);
  regroup(f,[f.data[0],[exchange[0],{role:'user',parts:[result(1),result(1)]}]]);rejects(()=>seal(f));
});
test('D04: unsupported fixture parts and orphan function results cannot be text roots',()=>{
  const f=frameFixture('contents');
  for(const payload of [
    [{role:'user',parts:[{inlineData:{mimeType:'image/png',data:'synthetic'}}]}],
    [{role:'user',parts:[{functionResponse:{id:'orphan',name:'read',response:{}}}]}],
  ]) {regroup(f,[payload]);rejects(()=>seal(f));}
});
test('D04: absence, failure or exception in protocol checker is not a successful check',()=>{
  const f=frameFixture(),before=f.registry.exportState();
  rejects(()=>createJSONFrameProfile(f.profile.spec,undefined));
  for(const check of [()=>false,()=>{throw Error('PRIVATE-DATA');},()=>undefined]){
    f.profile=createJSONFrameProfile(f.profile.spec,check);rejects(()=>seal(f));assert.deepEqual(f.registry.exportState(),before);
  }
});
test('D05: aliases must be explicit, exact and unambiguous within the selected profile',()=>{
  const f=frameFixture();f.profile=fixtureProfile('messages',{model_aliases:['test-model','wire-alias-v1']});
  f.body.model='wire-alias-v1';const a=seal(f);assert.equal(a.model_id,'test-model');assert.equal(a.envelope.model,'wire-alias-v1');
  for(const value of ['WIRE-ALIAS-V1','other',null]){f.body.model=value;rejects(()=>seal(f));}
  for(const aliases of [[],['wire','wire'],[1]])rejects(()=>fixtureProfile('messages',{model_aliases:aliases}));
});
test('D05: profile is required and JSON alone does not recreate it',()=>{
  const f=frameFixture();
  for(const profile of [undefined,JSON.parse(JSON.stringify(f.profile)),f.profile.spec])rejects(()=>sealFrame(f.binding,f.capture,f.registry,f.body,f.layout,profile));
});
test('D05: layout route/model/variant/history identity must agree with its profile',()=>{
  const f=frameFixture();
  for(const patch of [{route_id:'other-route'},{model_id:'other-model'},{variant:'other'},{history_key:'other'}]){
    rejects(()=>sealFrame(f.binding,f.capture,f.registry,f.body,{...f.layout,...patch},f.profile));
  }
});
test('D05: variant has an explicit request field, not a stale diagnostic label',()=>{
  const f=frameFixture();f.profile=fixtureProfile('messages',{variant:'quality',variant_key:'variant'});f.layout.variant='quality';
  rejects(()=>seal(f));f.body.variant='quality';assert.equal(seal(f).variant,'quality');f.body.variant='fast';rejects(()=>seal(f));
  rejects(()=>fixtureProfile('messages',{variant:'quality'}));rejects(()=>fixtureProfile('messages',{variant_key:'variant'}));
  rejects(()=>fixtureProfile('messages',{model_key:'messages'}));
});
test('D05: limits and profile revision bind the same frame identity used at terminal validation',()=>{
  const f=frameFixture(),old=seal(f);assert.deepEqual(old.limits,f.profile.spec.limits);
  for(const patch of [{revision:2},{limits:{context_window:80000,output_reserve:4000,input_limit:null}}]){
    const updated=fixtureProfile('messages',patch);
    const next=sealFrame(f.binding,f.capture,f.registry,f.body,f.layout,updated);
    assert.notEqual(next.profile_digest,old.profile_digest);assert.notEqual(next.config_digest,old.config_digest);
    rejects(()=>assertFrameUnchanged(f.binding,old,f.body,updated));
  }
  assertFrameUnchanged(f.binding,old,f.body,f.profile);
  assert.ok(Object.isFrozen(old.limits));assert.ok(Object.isFrozen(f.profile.spec.model_aliases));
});
test('D05: ambiguous keys, invalid limits and unknown configuration fields fail closed',()=>{
  for(const patch of [{unknown:1},{model_key:'messages'},{limits:{}},{revision:0},{variant:'quality',variant_key:'model'}])rejects(()=>fixtureProfile('messages',patch));
  const f=frameFixture();f.profile=createJSONFrameProfile({...f.profile.spec,model_key:'route_model'},fixtureProtocol('messages'));
  rejects(()=>seal(f));f.body.route_model='test-model';assert.equal(seal(f).model_id,'test-model');
});
