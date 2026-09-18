/** REVIEW-004 observational reproductions against the audited source tree.
 * Not a product acceptance gate: emitted JSON records current behavior, including
 * defects. Uses only generated inputs, own loopback servers and disposable dirs.
 * Run on Node 22.17.1+ from the reviewed tree; see REVIEW-004-REPRODUCTION.md.
 */
import { createServer, request } from 'node:http';
import { mkdtempSync,readFileSync,writeFileSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import gatewayPlugin from '../../tests/conformance/opencode/gateway-plugin.mjs';
import { Captures } from '../../tests/conformance/opencode/probe-captures.mjs';
import { decodeProposal,assertProposalContext,sealFrame } from '../../packages/core/src/index.ts';
import { citationFixture,proposal,id,frameFixture } from '../../tests/core/context-fixtures.mjs';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(f){for(let i=0;i<400;i++){if(f())return;await wait(5);}throw new Error('PROBE_DEADLINE');}
async function listen(f){const s=createServer(f);await new Promise(r=>s.listen(0,'127.0.0.1',r));return s;}
async function close(s){s.closeAllConnections();await new Promise(r=>s.close(r));}
const stream=text=>'data: '+JSON.stringify({choices:[{index:0,delta:{content:text},finish_reason:null}]})+'\n\n'+'data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\n'+'data: [DONE]\n\n';
const output={};
const f=citationFixture();
const old=decodeProposal(JSON.stringify(proposal({feedback_applied:[id(90)]})),'complete',f.binding,f.verified,[id(90)]);
output.proposal_reuse={old_feedback:old.proposal.feedback_applied,current_expected_feedback:[id(91)],accepted_by_context_assertion:assertProposalContext(f.binding,f.verified,old)===old,binds_job_id:'job_id' in old,binds_feedback_batch:'feedback_ids' in old};
const cf=frameFixture('contents'),sealed=sealFrame(cf.binding,cf.capture,cf.registry,cf.body,cf.layout);
output.function_group={roots:sealed.roots.map((r,i)=>({completed:r.completed,protected:r.protected,group:r.protocol_group,parts:cf.data[i].map(x=>x.parts?.map(y=>Object.keys(y)[0]))})),call_and_result_share_group:sealed.roots[1].protocol_group===sealed.roots[2].protocol_group};
const mf=frameFixture();const mismatch=sealFrame(mf.binding,mf.capture,mf.registry,{...mf.body,model:'actual-new-model'},mf.layout);
output.model_identity={declared_model:mismatch.model_id,body_model:mismatch.envelope.model,issued:true};
async function fixture(fn){
 const directory=mkdtempSync('/tmp/cc-r004-fixture-'),env={...process.env},records=[];
 const up=await listen(async(req,res)=>{const chunks=[];for await(const ch of req)chunks.push(ch);const b=JSON.parse(Buffer.concat(chunks));records.push(b);const aux=b.messages.at(-1).content.startsWith('CC_AUXILIARY::');res.writeHead(200,{'content-type':'text/event-stream'});res.end(stream(aux?'{"summary":"REVIEW_SUMMARY"}':'ok'));});
 const reservation=await listen((_q,r)=>r.end());const port=reservation.address().port;await close(reservation);
 const trace=join(directory,'events.jsonl'),control=join(directory,'control.json'),checkpoint=join(directory,'state.json');writeFileSync(control,'{}');
 Object.assign(process.env,{CC_FIXTURE_UPSTREAM:`http://127.0.0.1:${up.address().port}/v1/chat/completions`,CC_LOCAL_SECRET:'synthetic-review-only',CC_TRACE:trace,CC_CONTROL:control,CC_CHECKPOINT:checkpoint,CC_GATEWAY_PORT:String(port)});
 const plugin=await gatewayPlugin({directory});
 const sources=[{info:{id:'u1',sessionID:'s',role:'user'},parts:[{type:'text',text:'seed'}]},{info:{id:'a1',sessionID:'s',role:'assistant'},parts:[{type:'text',text:'done'}]},{info:{id:'u2',sessionID:'s',role:'user'},parts:[{type:'text',text:'current'}]}];
 const body={model:'probe',stream:true,messages:[{role:'user',content:'seed'},{role:'assistant',content:'done'},{role:'user',content:'current'}]};
 const events=()=>readFileSync(trace,'utf8').trim().split('\n').map(JSON.parse);
 const headers=async()=>{await plugin['experimental.chat.messages.transform']({}, {messages:sources});const o={headers:{}};await plugin['chat.headers']({sessionID:'s',agent:'build'},o);return o.headers;};
 const send=async()=>{const r=await fetch(`http://127.0.0.1:${port}/v1/chat/completions`,{method:'POST',headers:await headers(),body:JSON.stringify(body)});return {status:r.status,text:await r.text()};};
 try{return await fn({plugin,body,sources,events,headers,send,control,checkpoint,port,records});}
 finally{await plugin.dispose();await close(up);for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);rmSync(directory,{recursive:true,force:true});}
}
output.stale_root=await fixture(async c=>{
 writeFileSync(c.control,JSON.stringify({session:'s',run:'one',scenario:'component'}));await c.send();await until(()=>c.events().some(e=>e.kind==='aux-ready'));await c.send();
 const initial=JSON.parse(readFileSync(c.checkpoint)).sessions[0].view.length;
 c.sources[0].parts[0].text='corrected source';c.body.messages[0].content='corrected source';
 await c.plugin['chat.message']({sessionID:'s'});
 const a=await c.send(),b=await c.send();
 return {initial_views:initial,first_status:a.status,first_body:a.text,second_status:b.status,retained_views:JSON.parse(readFileSync(c.checkpoint)).sessions[0].view.length};
});
output.cancel_before_dispatch=await fixture(async c=>{
 let acquired=false;const original=Captures.prototype.acquire;Captures.prototype.acquire=function(...args){const r=original.apply(this,args);acquired=true;return r;};
 writeFileSync(c.control,JSON.stringify({session:'s',run:'old-request',scenario:'component'}));
 const h=await c.headers(),data=JSON.stringify(c.body);
 let req;
 const response=new Promise((resolve,reject)=>{req=request({hostname:'127.0.0.1',port:c.port,path:'/v1/chat/completions',method:'POST',headers:{...h,'content-type':'application/json','content-length':Buffer.byteLength(data)}},res=>{let text='';res.on('data',ch=>text+=ch);res.on('end',()=>resolve({status:res.statusCode,text}));});req.on('error',reject);req.write(data.slice(0,1));});
 try{await until(()=>acquired);const before=c.records.length;await c.plugin['chat.message']({sessionID:'s'});req.end(data.slice(1));const r=await response;await until(()=>c.events().some(e=>e.kind==='transport-stopped'));return {acquired_before_cancel:acquired,requests_before_cancel:before,response_status:r.status,primary_forwarded:c.records.some(b=>b.messages.at(-1).content==='current'),auxiliary_started_after_cancel:c.events().some(e=>e.kind==='aux-start')};}
 finally{Captures.prototype.acquire=original;req?.destroy();}
});
console.log(JSON.stringify(output,null,2));
