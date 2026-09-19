/** Persisted schema-only data must never turn into a validated capability. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseModelProposal} from '../../packages/core/src/proposal.ts';
import {assertProposalContext} from '../../packages/core/src/index.ts';
import {citationFixture,proposal} from './context-fixtures.mjs';

test('Proposal data: schema-only parse returns deeply immutable data, never a verified handle',()=>{
 const f=citationFixture(),text=JSON.stringify(proposal());
 const parsed=parseModelProposal(text,f.verified.manifest);
 assert.deepEqual(parsed,JSON.parse(text));
 assert.ok(Object.isFrozen(parsed));assert.ok(Object.isFrozen(parsed.outcome));
 assert.ok(Object.isFrozen(parsed.outcome[0].sources));
 assert.throws(()=>assertProposalContext(f.binding,f.verified,parsed),e=>e.code==='E_SCHEMA');
});
test('Proposal data: persisted parsing retains citation, shape and feedback checks',()=>{
 const f=citationFixture();
 for(const patch of [{extra:true},{outcome:[{text:'bad index',sources:[999]}]},{feedback_applied:['00000000-0000-4000-8000-000000000099']}]){
  assert.throws(()=>parseModelProposal(JSON.stringify(proposal(patch)),f.verified.manifest));
 }
});
