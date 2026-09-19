/** Pure observation tests; identities below are synthetic, not persisted authority. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { observeLocalCompletion, assertLocalCompletion } from '../../packages/storage/src/local-completion.ts';
import { createSessionBinding } from '../../packages/core/src/identity.ts';
const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const ownership = () => ({ schema_version: 1,
  binding: createSessionBinding({ installation_id: id(1), workspace_id: id(2), adapter_id: 'synthetic', host_session_id: 'A' }, id(3), 0),
  job: { job_id: id(4), snapshot_id: id(5), snapshot_digest: '1'.repeat(64), context_digest: '2'.repeat(64) },
  attempt: { job_id: id(4), attempt_id: id(6), run_id: id(7), attempt_no: 1 },
  session_owner_id: id(8), owner_fence: 1, storage_owner_id: id(9), process_instance: id(10) });

test('Observation: evidence is issued only after the native Promise settles', async () => {
  const owner = ownership(); let complete, received;
  const pending = new Promise(resolve => { complete = resolve; });
  const done = observeLocalCompletion(owner, pending).then(value => { received = value; return value; });
  await Promise.resolve(); assert.equal(received, undefined);
  complete('synthetic'); const result = await done;
  assert.equal(result.fulfilled, true); assert.equal(result.value, 'synthetic');
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.observation));
  assert.equal(assertLocalCompletion(owner, result.observation), result.observation);
});

test('Observation: a rejected native Promise still records local settlement', async () => {
  const owner = ownership(), result = await observeLocalCompletion(owner, Promise.reject(Error('private fixture')));
  assert.equal(result.fulfilled, false); assert.equal(result.value, undefined);
  assertLocalCompletion(owner, result.observation);
  assert.equal(JSON.stringify(result).includes('private fixture'), false);
});

test('Observation: arbitrary thenables are refused without reading their accessor', () => {
  let reads = 0;
  const value = { get then() { reads++; throw Error('must not execute'); } };
  assert.throws(() => observeLocalCompletion(ownership(), value), e => e.code === 'E_CAPABILITY');
  assert.equal(reads, 0);
});

test('Observation: an overridden then cannot manufacture early settlement', async () => {
  const owner = ownership(); let complete, calls = 0, observed = false;
  const pending = new Promise(resolve => { complete = resolve; });
  pending.then = () => { calls++; throw Error('must not execute'); };
  const done = observeLocalCompletion(owner, pending).then(r => { observed = true; return r; });
  await Promise.resolve(); assert.equal(observed, false); assert.equal(calls, 0);
  complete(null); assert.equal((await done).fulfilled, true); assert.equal(calls, 0);
});

test('Observation: copies and other identities do not inherit issued evidence', async () => {
  const owner = ownership(), { observation } = await observeLocalCompletion(owner, Promise.resolve(null));
  for (const copy of [{ ...observation }, JSON.parse(JSON.stringify(observation)), {}, null, true]) {
    assert.throws(() => assertLocalCompletion(owner, copy), e => e.code === 'E_OWNER');
  }
  assert.throws(() => assertLocalCompletion({ ...owner, owner_fence: 2 }, observation), e => e.code === 'E_OWNER');
});

test('Observation: identity is captured before waiting rather than after mutation', async () => {
  const owner = ownership(), expected = structuredClone(owner); let complete;
  const done = observeLocalCompletion(owner, new Promise(resolve => { complete = resolve; }));
  owner.process_instance = id(99); complete(null); const { observation } = await done;
  assertLocalCompletion(expected, observation);
  assert.throws(() => assertLocalCompletion(owner, observation), e => e.code === 'E_OWNER');
});
