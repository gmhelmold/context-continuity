import test from 'node:test';
import assert from 'node:assert/strict';
import { createCapture, sealFrame, assertSealedFrame, assertFrameUnchanged, RootIdentityRegistry } from '../../packages/core/src/index.ts';
import { frameFixture, binding, id, sha } from './context-fixtures.mjs';
const clone=x=>JSON.parse(JSON.stringify(x));
const reject=fn=>assert.throws(fn,e=>['E_SCHEMA','E_SCOPE','E_PROTOCOL','E_STALE'].includes(e.code));
const seal=f=>sealFrame(f.binding,f.capture,f.registry,f.body,f.layout);
for(const format of ['messages','contents']){
  test(`T30.contract Frame ${format}: same core seals whole final JSON without dropping native fields`,()=>{
    const f=frameFixture(format),v=seal(f);
    assert.deepEqual(v.envelope,f.body);assert.equal(v.roots.length,f.data.length);
    assert.equal(v.roots[0].unit_id,f.registry.lookup(f.binding,'native-0').unit_id);
    assert.equal(assertSealedFrame(f.binding,v),v);assertFrameUnchanged(f.binding,v,f.body);
    f.body.custom_metadata.nested[0]=77;reject(()=>assertFrameUnchanged(f.binding,v,f.body));
    assert.equal(v.envelope.custom_metadata.nested[0],1);
    assert.ok(Object.isFrozen(v.envelope.custom_metadata.nested));
    assert.ok(Object.isFrozen(v.roots));
  });
  test(`T06.contract Frame ${format}: every nonhistorical field is bound even if no special key names it`,()=>{
    const f=frameFixture(format),v=seal(f);
    for(const patch of [{custom_metadata:{new:'value'}},{unknown_provider_setting:true},{model:'new-model'}]){
      const newer=sealFrame(f.binding,f.capture,f.registry,{...f.body,...patch},f.layout);
      assert.notEqual(newer.config_digest,v.config_digest);
      assert.notEqual(newer.input_digest,v.input_digest);
    }
    const newer=sealFrame(f.binding,f.capture,f.registry,f.body,{...f.layout,variant:'different'});
    assert.notEqual(newer.config_digest,v.config_digest);
  });
}
test('T02.contract Frame: capture/registry/frame must agree on the entire session binding',()=>{
  const a=frameFixture(),b=frameFixture('messages',binding('host-B'));
  reject(()=>sealFrame(b.binding,a.capture,b.registry,b.body,b.layout));
  reject(()=>sealFrame(a.binding,a.capture,b.registry,a.body,a.layout));
  reject(()=>assertSealedFrame(b.binding,seal(a)));
  for(const wrong of [{...a.binding,incarnation:id(99)},{...a.binding,host_epoch:1}]) reject(()=>sealFrame(wrong,a.capture,a.registry,a.body,a.layout));
});
test('T06.contract Frame: a partial/serialized capture cannot authorize a sealed request',()=>{
  const f=frameFixture();reject(()=>assertSealedFrame(f.binding,f.capture));
  reject(()=>sealFrame(f.binding,clone(f.capture),f.registry,f.body,f.layout));
  reject(()=>assertSealedFrame(f.binding,clone(seal(f))));
  reject(()=>sealFrame(f.binding,{...f.capture,kind:'maintenance'},f.registry,f.body,f.layout));
});
test('T06.contract Frame: changed final payload is rejected without mutating root registry',()=>{
  const f=frameFixture(),before=clone(f.registry.exportState()),body=clone(f.body);
  body.messages[1].content='lost/replaced input';reject(()=>sealFrame(f.binding,f.capture,f.registry,body,f.layout));
  assert.deepEqual(f.registry.exportState(),before);
  body.messages[1]={...f.body.messages[1],provider_metadata:{signature:'new'}};
  reject(()=>sealFrame(f.binding,f.capture,f.registry,body,f.layout));
});
test('T06.contract Frame: exact group partition rejects omission, duplication and arbitrary ordering',()=>{
  const f=frameFixture();
  for(const mutate of [l=>l.groups.pop(),l=>l.groups.reverse(),l=>l.groups[1].native_identity='native-0',l=>l.groups[0].count=0,l=>l.groups[0].count=99,l=>l.prefix_length=0,l=>l.history_key='missing',l=>l.system_keys=['missing'],l=>l.tool_keys=['messages']]){
    const layout=clone(f.layout);mutate(layout);reject(()=>sealFrame(f.binding,f.capture,f.registry,f.body,layout));
  }
  const body=clone(f.body);body.messages.push({role:'user',content:'uncovered'});
  reject(()=>sealFrame(f.binding,f.capture,f.registry,body,f.layout));
});
test('T06.contract Frame: identity aliases and missing registry roots cannot be guessed by text',()=>{
  const f=frameFixture(),empty=new RootIdentityRegistry(f.binding);
  reject(()=>sealFrame(f.binding,f.capture,empty,f.body,f.layout));
  const map=clone(f.map);map[0].native_refs=['different-public-part'];
  const c=createCapture(f.binding,{kind:'primary',work:{task_id:null,phase_id:null},native_identity_map:map});
  reject(()=>sealFrame(f.binding,c,f.registry,f.body,f.layout));
});
test('T06.contract Frame: protected/incomplete groups remain intact, not approved for compaction',()=>{
  const f=frameFixture();
  f.registry.observe({...f.map[0],authority:'user',protocol_group:'group-0',completed:false,protected:false,source_refs:[],payload_ref:'unretained',payload:f.data[0],estimated_tokens:10});
  const v=seal(f);assert.equal(v.roots[0].protected,true);assert.equal(v.roots[0].completed,false);
  assert.deepEqual(v.envelope,f.body);
});
test('T37.contract Frame: unknown control fields and unsupported binary envelopes fail closed',()=>{
  const f=frameFixture();
  reject(()=>createCapture(f.binding,{kind:'primary',work:{task_id:null,phase_id:null},native_identity_map:f.map,dispatch:true}));
  reject(()=>sealFrame(f.binding,f.capture,f.registry,{...f.body,binary:Uint8Array.of(1)},f.layout));
  reject(()=>sealFrame(f.binding,f.capture,f.registry,f.body,{...f.layout,permit:true}));
  for(const val of [NaN,Infinity,-1,Number.MAX_SAFE_INTEGER+1]) reject(()=>sealFrame(f.binding,f.capture,f.registry,f.body,{...f.layout,input_estimate:val}));
});
test('T37.contract Frame: 200 revisions compare actual payloads, not only unchanged source refs',()=>{
  const f=frameFixture();
  for(let i=0;i<200;i++){
    const old=seal(f),payload=[{role:'user',content:'revision-'+i}];
    f.registry.observe({...f.map[0],authority:'user',protocol_group:'group-0',completed:true,protected:false,
      source_refs:[{source_id:id(100),revision:0,digest:sha('same source reference')}],payload_ref:'memory-0',payload,estimated_tokens:10});
    reject(()=>seal(f));
    f.body.messages[1]=payload[0];const now=seal(f);assert.notEqual(old.input_digest,now.input_digest);
    assert.equal(now.roots[0].revision,i+1);
  }
});

test('T06.contract Frame: a changed system prefix is configuration, never ordinary history',()=>{
  const f=frameFixture(),old=seal(f),body=clone(f.body);
  body.messages[0].content='Revised restriction';
  const newer=sealFrame(f.binding,f.capture,f.registry,body,f.layout);
  assert.notEqual(newer.system_digest,old.system_digest);
  assert.notEqual(newer.config_digest,old.config_digest);
  reject(()=>assertFrameUnchanged(f.binding,old,body));
});
