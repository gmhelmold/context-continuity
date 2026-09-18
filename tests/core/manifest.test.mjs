import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createManifest, verifyManifest, parseManifest, assertVerifiedManifest, parseEntityRef, MAX_MANIFEST_ENTRIES } from '../../packages/core/src/index.ts';
import { binding, citationFixture, id, sha } from './context-fixtures.mjs';
const copy = x => JSON.parse(JSON.stringify(x));
const reject = fn => assert.throws(fn, e => ['E_SCHEMA','E_SOURCE','E_SCOPE'].includes(e.code));
test('T06.contract Manifest: mixed origins retain fixed indices, literal bytes and authority', () => {
  const f = citationFixture();
  assert.deepEqual(f.verified.manifest.entries.map(e=>[e.index,e.entity.kind,e.authority]), [[1,'source','external'],[2,'block','user'],[3,'chapter','agent'],[4,'source','external']]);
  assert.equal(f.verified.manifest.entries[0].excerpt_digest, sha(f.records[0].bytes));
  assert.equal(f.verified.manifest.entries[3].presented_as,'reference_only');
  for(const value of [f.verified,f.verified.manifest,f.verified.manifest.entries,...f.verified.manifest.entries]) assert.ok(Object.isFrozen(value));
  f.selections[0].range.end_byte=0;f.records[0].entity.ref.revision=99;
  assert.notEqual(f.verified.manifest.entries[0].range.end_byte,0);
  assert.equal(f.verified.manifest.entries[0].entity.ref.revision,2);
});
test('T06.contract Manifest: JSON reload is shape-only until every source is reverified',()=>{
  const f=citationFixture(), raw=copy(f.verified.manifest);
  assert.deepEqual(parseManifest(raw),f.verified.manifest);
  reject(()=>assertVerifiedManifest(f.binding,{binding:f.binding,manifest:raw,digest:f.verified.digest}));
  const restored=verifyManifest(raw,f.binding,f.resolver);
  assert.equal(restored.digest,f.verified.digest);
  assert.equal(assertVerifiedManifest(f.binding,restored),restored);
  f.records[0].bytes[0]=0x58;
  reject(()=>verifyManifest(raw,f.binding,f.resolver));
});
test('T02.contract Manifest: resolver cannot cross workspace, incarnation or epoch',()=>{
  for(const change of ['workspace','incarnation','epoch']) {
    const f=citationFixture(); const wrong=copy(f.binding);
    if(change==='workspace') Object.assign(wrong,binding('host-A',id(99)));
    if(change==='incarnation') wrong.incarnation=id(99);
    if(change==='epoch') wrong.host_epoch++;
    const resolve=e=>({...f.resolver(e),binding:wrong});
    reject(()=>verifyManifest(f.verified.manifest,f.binding,resolve));
  }
});
test('T06.contract Manifest: mismatched entity, authority, full hash and missing bytes fail',()=>{
  for(const mutation of [r=>({...r,authority:'host'}),r=>({...r,entity:{...r.entity,ref:{...r.entity.ref,digest:'0'.repeat(64)}}}),r=>({...r,bytes:null}),r=>({...r,bytes:Buffer.from('different')})]){
    const f=citationFixture();reject(()=>verifyManifest(f.verified.manifest,f.binding,e=>mutation(f.resolver(e))));
  }
  const f=citationFixture();reject(()=>verifyManifest(f.verified.manifest,f.binding,()=>null));
  assert.throws(()=>verifyManifest(f.verified.manifest,f.binding,()=>{throw Error('PRIVATE-DATA');}),e=>e.code==='E_SOURCE'&&!e.message.includes('PRIVATE-DATA'));
});
test('T06.contract Manifest: excerpt ranges are exact UTF-8 bytes, including CRLF/BOM',()=>{
  for(const text of ['aé🔥\r\nb','\uFEFFé']){
    const f=citationFixture(); const bytes=Buffer.from(text); const r=f.records[0];r.bytes=bytes;r.entity.ref.digest=sha(bytes);
    const s={...f.selections[0],entity:r.entity,range:{start_byte:0,end_byte:bytes.length},excerpt_digest:sha(bytes)};
    assert.equal(createManifest(f.binding,[s],f.resolver).manifest.entries[0].excerpt_digest,sha(bytes));
    for(let cut=1;cut<bytes.length;cut++) {
      const selection={...s,presented_as:'excerpt',range:{start_byte:cut,end_byte:bytes.length},excerpt_digest:sha(bytes.subarray(cut))};
      const boundary=(bytes[cut]&0xc0)!==0x80;
      if(boundary) createManifest(f.binding,[selection],f.resolver);else reject(()=>createManifest(f.binding,[selection],f.resolver));
    }
    reject(()=>createManifest(f.binding,[{...s,range:{start_byte:0,end_byte:bytes.length+1}}],f.resolver));
    reject(()=>createManifest(f.binding,[{...s,excerpt_digest:'1'.repeat(64)}],f.resolver));
  }
});
test('T06.contract Manifest: full cannot mean a subset and invalid UTF-8 is not replaced',()=>{
  const f=citationFixture(),s=f.selections[0];
  reject(()=>createManifest(f.binding,[{...s,range:{start_byte:0,end_byte:1},excerpt_digest:sha(f.records[0].bytes.subarray(0,1))}],f.resolver));
  const bytes=Uint8Array.of(0xff);f.records[0].bytes=bytes;f.records[0].entity.ref.digest=sha(bytes);
  reject(()=>createManifest(f.binding,[{...s,entity:f.records[0].entity,range:{start_byte:0,end_byte:1},excerpt_digest:sha(bytes)}],f.resolver));
});
test('T06.contract Manifest: empty captured source differs from a navigation-only reference',()=>{
  const f=citationFixture();f.records[0].bytes=Buffer.from('');f.records[0].entity.ref.digest=sha('');
  const v=createManifest(f.binding,[{...f.selections[0],entity:f.records[0].entity,range:{start_byte:0,end_byte:0},excerpt_digest:sha('')}],f.resolver);
  assert.equal(v.manifest.entries[0].presented_as,'full');
  reject(()=>createManifest(f.binding,[{...f.selections[3],range:{start_byte:1,end_byte:1}}],f.resolver));
});
test('T37.contract Manifest: schemas, indices, locators and array representation are closed',()=>{
  const f=citationFixture();
  for(const mutate of [x=>x.entries[1].index=1,x=>x.entries[1].index=3,x=>x.entries[1].locator=x.entries[0].locator,x=>x.entries[0].admin=true,x=>x.extra='secret',x=>x.entries[0].entity.ref.revision=1.5,x=>x.entries[0].entity.kind='unknown',x=>x.entries[0].locator=' ',x=>x.manifest_id='not-uuid']) {
    const raw=copy(f.verified.manifest);mutate(raw);reject(()=>parseManifest(raw));
  }
  reject(()=>parseManifest({...f.verified.manifest,entries:Array(MAX_MANIFEST_ENTRIES+1).fill(f.verified.manifest.entries[0])}));
  const raw=copy(f.verified.manifest);let invoked=false;
  Object.defineProperty(raw.entries[0],'locator',{enumerable:true,get(){invoked=true;return 'bad';}});
  reject(()=>parseManifest(raw));assert.equal(invoked,false);
  const sparse=[];sparse.length=1;reject(()=>parseManifest({...f.verified.manifest,entries:sparse}));
  const symbolic=[...f.verified.manifest.entries];symbolic[Symbol('hidden')]=1;reject(()=>parseManifest({...f.verified.manifest,entries:symbolic}));
});
test('T37.contract Manifest: deterministic invalid range fuzz never reaches a verified handle',()=>{
  const f=citationFixture();
  for(let i=0;i<256;i++){
    const s=copy(f.selections[0]);s.range={start_byte:i+1,end_byte:i};
    reject(()=>createManifest(f.binding,[s],f.resolver));
  }
  for(const value of [null,undefined,[],new Date(),{kind:'source',ref:{source_id:id(5),revision:0,digest:'x'}}]) reject(()=>parseEntityRef(value));
});

test('T37.contract Manifest: serialized size and reference-only material remain bounded/typed',()=>{
  const f=citationFixture();
  const entries=Array.from({length:1024},(_,i)=>({...f.verified.manifest.entries[0],index:i+1,locator:'x'.repeat(490)+String(i)}));
  reject(()=>parseManifest({...f.verified.manifest,entries}));
  reject(()=>createManifest(f.binding,[f.selections[3]],e=>({...f.resolver(e),bytes:undefined})));
  reject(()=>createManifest(f.binding,[f.selections[3]],e=>({...f.resolver(e),bytes:'not bytes'})));
});
