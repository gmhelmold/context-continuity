import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeProposal, assertProposalContext, MAX_PROPOSAL_BYTES } from '../../packages/core/src/index.ts';
import { binding, citationFixture, id, proposal } from './context-fixtures.mjs';
const reject=fn=>assert.throws(fn,e=>['E_SCHEMA','E_SOURCE','E_SCOPE','E_NO_GAIN','E_TOOL','E_PROTOCOL'].includes(e.code));
const decode=(f,p=proposal(),feedback=[])=>decodeProposal(JSON.stringify(p),'complete',f.binding,f.verified,feedback);
test('T06.contract Proposal: retains literal claims and is bound to exact manifest, not just source indices',()=>{
  const f=citationFixture(),p=proposal(),v=decode(f,p);
  assert.equal(v.proposal.title,p.title);assert.equal(v.manifest_digest,f.verified.digest);
  assert.equal(assertProposalContext(f.binding,f.verified,v),v);
  assert.ok(Object.isFrozen(v.proposal.outcome[0].sources));assert.ok(Object.isFrozen(v.proposal));
  p.outcome[0].text='changed';assert.notEqual(v.proposal.outcome[0].text,'changed');
  const other=citationFixture();reject(()=>assertProposalContext(f.binding,other.verified,v));
  reject(()=>assertProposalContext(f.binding,f.verified,JSON.parse(JSON.stringify(v))));
});
test('T02.contract Proposal: identical source text cannot move a proposal between sessions',()=>{
  const a=citationFixture(),b=citationFixture(binding('host-B'));
  reject(()=>decodeProposal(JSON.stringify(proposal()),'complete',b.binding,a.verified));
  reject(()=>assertProposalContext(b.binding,b.verified,decode(a)));
});
test('T06.contract Proposal: noop is explicit, mixed/no-claim responses cannot masquerade as replacement',()=>{
  const f=citationFixture();const v=decode(f,{schema_version:1,action:'noop',reason:'  Nothing dispensable.  '});
  assert.equal(v.proposal.action,'noop');assert.equal(v.proposal.reason,'  Nothing dispensable.  ');
  reject(()=>decode(f,proposal({outcome:[],constraints:[]})));
  reject(()=>decode(f,{schema_version:1,action:'noop',reason:' ',title:'extra'}));
  reject(()=>decode(f,proposal({reason:'not allowed'})));
});
test('T37.contract Proposal: citations require actual presented entries and nonempty unique indices',()=>{
  const f=citationFixture();
  for(const refs of [[],[0],[5],[1,1],[4],[1.1],['1'],[null]]) reject(()=>decode(f,proposal({outcome:[{text:'claim',sources:refs}]})));
  for(const text of ['', ' ', '\ud800', 'x'.repeat(4001)]) reject(()=>decode(f,proposal({outcome:[{text,sources:[1]}]})));
  assert.equal(decode(f,proposal({outcome:[{text:'🔥'.repeat(4000),sources:[1]}]})).proposal.outcome[0].text.length,8000);
});
test('T37.contract Proposal: title/reason/warnings and total claims have exact limits',()=>{
  const f=citationFixture(),claim={text:'c',sources:[1]};
  decode(f,proposal({title:'🔥'.repeat(160),outcome:Array(127).fill(claim)}));
  reject(()=>decode(f,proposal({title:'x'.repeat(161)})));
  reject(()=>decode(f,proposal({outcome:Array(128).fill(claim)})));
  decode(f,proposal({warnings:Array(16).fill('w'.repeat(1000))}));
  reject(()=>decode(f,proposal({warnings:Array(17).fill('w')})));
  reject(()=>decode(f,proposal({warnings:['x'.repeat(1001)]})));
  decode(f,{schema_version:1,action:'noop',reason:'x'.repeat(2000)});
  reject(()=>decode(f,{schema_version:1,action:'noop',reason:'x'.repeat(2001)}));
});
test('T37.contract Proposal: byte cap includes JSON/envelope whitespace; exact cap accepted',()=>{
  const f=citationFixture();const raw=JSON.stringify(proposal());const padded=raw+' '.repeat(MAX_PROPOSAL_BYTES-Buffer.byteLength(raw));
  decodeProposal(padded,'complete',f.binding,f.verified);
  reject(()=>decodeProposal(padded+' ','complete',f.binding,f.verified));
});
test('T37.contract Proposal: duplicate keys, malformed Unicode, overflow and field injection are rejected',()=>{
  const f=citationFixture();
  for(const raw of ['{"schema_version":1,"schema_version":1,"action":"noop","reason":"x"}',
    '{"schema_version":1,"action":"noop","reason":"\\ud800"}', '{"a":NaN}', '{"a":1e400}', '{', 'null', '[]']) reject(()=>decodeProposal(raw,'complete',f.binding,f.verified));
  for(const mutate of [p=>p.tool='read',p=>p.outcome[0].role='system',p=>delete p.warnings,p=>p.schema_version=2,p=>p.title=1,p=>p.action='publish']){
    const p=proposal();mutate(p);reject(()=>decode(f,p));
  }
});
test('T06.contract Proposal: transport finisher overrides valid-looking JSON',()=>{
  const f=citationFixture();
  for(const finish of ['length','tool_call','cancelled','error']) reject(()=>decodeProposal(JSON.stringify(proposal()),finish,f.binding,f.verified));
  assert.throws(()=>decodeProposal(JSON.stringify(proposal()),'tool_call',f.binding,f.verified),e=>e.code==='E_TOOL');
  reject(()=>decodeProposal(JSON.stringify(proposal()),'complete',f.binding,f.verified.manifest));
});
test('T06.contract Proposal: feedback is only a declared subset of delivered IDs',()=>{
  const f=citationFixture();
  const v=decode(f,proposal({feedback_applied:[id(1)]}),[id(1),id(2)]);assert.deepEqual(v.proposal.feedback_applied,[id(1)]);
  reject(()=>decode(f,proposal({feedback_applied:[id(2)]}),[id(1)]));
  reject(()=>decode(f,proposal({feedback_applied:[id(1),id(1)]}),[id(1)]));
  reject(()=>decode(f,proposal(),[id(1),id(1)]));
  reject(()=>decode(f,proposal(),Array.from({length:33},(_,i)=>id(i+1))));
});
test('T37.contract Proposal: deterministic valid/mutated schema campaign checks 300 distinct cases',()=>{
  const f=citationFixture();
  for(let i=0;i<300;i++){
    const p=proposal({title:'case-'+i,outcome:[{text:'é '+i,sources:[1+(i%3)]}],feedback_applied:i%2?[id(40)]:[]});
    decode(f,p,[id(40)]);
    if(i%3===0)p.outcome[0].sources=[4];
    else if(i%3===1)p.feedback_applied=[id(41)];
    else p.outcome[0].unknown_field='must reject';
    reject(()=>decode(f,p,[id(40)]));
  }
});
