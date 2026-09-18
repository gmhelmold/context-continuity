import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createSessionBinding, createManifest, hashPayload, RootIdentityRegistry, createCapture } from '../../packages/core/src/index.ts';
export const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const binding = (session = 'host-A', workspace = id(2)) => createSessionBinding({ installation_id: id(1), workspace_id: workspace, adapter_id: 'synthetic', host_session_id: session }, id(3), 0);
export function citationFixture(b = binding()) {
  const source = Buffer.from('Olá 🔥\r\nEvidence remains literal.');
  const block = Buffer.from('Keep protocol v1.');
  const chapter = Buffer.from('{"result":"tests pending"}');
  const records = [
    { binding: b, entity: { kind: 'source', ref: { source_id: id(10), revision: 2, digest: sha(source) } }, authority: 'external', bytes: source },
    { binding: b, entity: { kind: 'block', ref: { block_id: id(11), version: 1, digest: hashPayload({version:1,text:block.toString()}) } }, authority: 'user', bytes: block },
    { binding: b, entity: { kind: 'chapter', ref: { chapter_id: id(12), digest: hashPayload({record:'chapter-v1'}) } }, authority: 'agent', bytes: chapter },
    { binding: b, entity: { kind: 'source', ref: { source_id: id(13), revision: 0, digest: sha('unavailable original') } }, authority: 'external', bytes: null },
  ];
  const selections = records.map((r, i) => ({ entity: r.entity, authority: r.authority,
    range: { start_byte: 0, end_byte: r.bytes?.length ?? 0 }, excerpt_digest: sha(r.bytes ?? new Uint8Array()),
    presented_as: r.bytes === null ? 'reference_only' : 'full', locator: `record-${i+1}` }));
  const resolver = entity => records.find(r => JSON.stringify(r.entity) === JSON.stringify(entity)) ?? null;
  const verified = createManifest(b, selections, resolver);
  return { binding: b, records, selections, resolver, verified };
}
export const proposal = (patch = {}) => ({ schema_version: 1, action: 'replace', title: '  Decision retained  ',
  outcome: [{ text: 'Tests remain pending.', sources: [1, 3] }], decisions: [], open_items: [],
  constraints: [{ text: 'Keep protocol v1.', sources: [2] }], evidence: [], warnings: [], feedback_applied: [], ...patch });
export function frameFixture(format = 'messages', b = binding()) {
  const data = format === 'messages' ? [
    [{ role:'user',content:'Olá 🔥' }],
    [{ role:'assistant',tool_calls:[{id:'call1',type:'function',function:{name:'read',arguments:'{}'}}] }, {role:'tool',tool_call_id:'call1',content:'source1'}],
  ] : [
    [{role:'user',parts:[{text:'Olá 🔥'}]}],
    [{role:'model',parts:[{functionCall:{id:'call1',name:'read',args:{}}}]}],
    [{role:'user',parts:[{functionResponse:{id:'call1',name:'read',response:{text:'source1'}}}]}],
  ];
  const prefix = format === 'messages' ? [{role:'system',content:'Never drop an open task.'}] : [];
  const body = format === 'messages' ? {model:'test-model',messages:[...prefix,...data.flat()],tools:[{type:'function',function:{name:'read'}}],temperature:0,custom_metadata:{nested:[1.0,-0.0]}}
    : {model:'test-model',contents:data.flat(),systemInstruction:{parts:[{text:'Never drop an open task.'}]},toolDeclarations:[{name:'read'}],generationConfig:{temperature:0},custom_metadata:{nested:[1.0,-0.0]}};
  const registry = new RootIdentityRegistry(b);
  const map = data.map((payload,i) => ({native_identity:`native-${i}`,native_refs:payload.map((_,j)=>`native-${i}-part-${j}`)}));
  for (let i=0;i<data.length;i++) registry.observe({...map[i],authority:i===0?'user':'agent',protocol_group:`group-${i}`,completed:true,protected:false,
    source_refs:[{source_id:id(100+i),revision:0,digest:sha(JSON.stringify(data[i]))}],payload_ref:`memory-${i}`,payload:data[i],estimated_tokens:10});
  const capture = createCapture(b,{kind:'primary',work:{task_id:'task-A',phase_id:null},native_identity_map:map});
  const layout = {route_id:'synthetic-route',model_id:'test-model',variant:null,history_key:format,prefix_length:prefix.length,
    system_keys:format==='messages'?[]:['systemInstruction'],tool_keys:format==='messages'?['tools']:['toolDeclarations'],
    groups:map.map((m,i)=>({native_identity:m.native_identity,count:data[i].length})),input_estimate:100};
  return { binding:b,registry,capture,body,layout,map,data };
}
