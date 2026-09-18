/** Regression assertions for D02/D03. Real gateway and HTTP; only the hooks are controlled. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import gatewayPlugin from './gateway-plugin.mjs';
import { Captures } from './probe-captures.mjs';
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(f) { for (let i=0; i<800; i++) { if (f()) return; await wait(5); } throw Error('TEST_DEADLINE'); }
async function listen(f) { const s=createServer(f); await new Promise(r=>s.listen(0,'127.0.0.1',r)); return s; }
async function close(s) { s.closeAllConnections(); await new Promise(r=>s.close(r)); }
const stream=text=>'data: '+JSON.stringify({choices:[{index:0,delta:{content:text},finish_reason:null}]})+'\n\n'+
  'data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\n'+'data: [DONE]\n\n';
async function fixture(fn) {
  const directory=mkdtempSync(join(tmpdir(),'cc-r004-')),env={...process.env},records=[];
  const up=await listen(async(req,res)=>{
    const chunks=[]; for await(const c of req)chunks.push(c);
    const b=JSON.parse(Buffer.concat(chunks));records.push(b);
    const aux=b.messages.at(-1).content.startsWith('CC_AUXILIARY::');
    res.writeHead(200,{'content-type':'text/event-stream'});res.end(stream(aux?'{"summary":"REVIEW_SUMMARY"}':'ok'));
  });
  const reservation=await listen((_q,r)=>r.end());const port=reservation.address().port;await close(reservation);
  const trace=join(directory,'events.jsonl'),control=join(directory,'control.json'),checkpoint=join(directory,'state.json');
  writeFileSync(control,'{}');
  Object.assign(process.env,{CC_FIXTURE_UPSTREAM:`http://127.0.0.1:${up.address().port}/v1/chat/completions`,CC_LOCAL_SECRET:'synthetic-review-only',CC_TRACE:trace,CC_CONTROL:control,CC_CHECKPOINT:checkpoint,CC_GATEWAY_PORT:String(port)});
  let plugin=await gatewayPlugin({directory});
  const sources=[{info:{id:'u1',sessionID:'s',role:'user'},parts:[{type:'text',text:'seed'}]},
    {info:{id:'a1',sessionID:'s',role:'assistant'},parts:[{type:'text',text:'done'}]},
    {info:{id:'u2',sessionID:'s',role:'user'},parts:[{type:'text',text:'current'}]}];
  const body={model:'probe',stream:true,messages:[{role:'user',content:'seed'},{role:'assistant',content:'done'},{role:'user',content:'current'}]};
  const events=()=>readFileSync(trace,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const headers=async()=>{await plugin['experimental.chat.messages.transform']({}, {messages:sources});const o={headers:{}};await plugin['chat.headers']({sessionID:'s',agent:'build'},o);return o.headers;};
  const send=async()=>{const r=await fetch(`http://127.0.0.1:${port}/v1/chat/completions`,{method:'POST',headers:await headers(),body:JSON.stringify(body)});return {status:r.status,text:await r.text()};};
  const state=()=>JSON.parse(readFileSync(checkpoint)).sessions.find(x=>x.id==='s');
  const restart=async()=>{await plugin.dispose();plugin=await gatewayPlugin({directory});};
  try {return await fn({get plugin(){return plugin;},body,sources,events,headers,send,state,restart,control,port,records});}
  finally {await plugin.dispose();await close(up);for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);rmSync(directory,{recursive:true,force:true});}
}
for (const reason of ['none','user','native','dispose']) {
  test(`D02: acquired request at a deterministic body barrier, ${reason}`,async()=>fixture(async c=>{
    let acquired=false;const original=Captures.prototype.acquire,originalRelease=Captures.prototype.release;let released;const done=new Promise(r=>released=r);
    Captures.prototype.release=function(...args){try{return originalRelease.apply(this,args);}finally{released();}};
    Captures.prototype.acquire=function(...args){const r=original.apply(this,args);acquired=true;return r;};
    writeFileSync(c.control,JSON.stringify({session:'s',run:'old-request',scenario:'component'}));
    let req;const h=await c.headers(),raw=JSON.stringify(c.body);
    const response=new Promise(resolve=>{
      req=request({hostname:'127.0.0.1',port:c.port,path:'/v1/chat/completions',method:'POST',headers:{...h,'content-type':'application/json','content-length':Buffer.byteLength(raw)}},res=>{
        res.resume();res.on('end',()=>resolve(res.statusCode));res.on('error',()=>resolve(null));
      });req.on('error',()=>resolve(null));req.write(raw.slice(0,1));
    });
    try {
      await until(()=>acquired);assert.equal(c.records.length,0);
      if(reason==='user')await c.plugin['chat.message']({sessionID:'s'});
      if(reason==='native')await c.plugin['experimental.session.compacting']({sessionID:'s'},{context:[]});
      if(reason==='dispose')await c.plugin.dispose();
      req.end(raw.slice(1));const status=await response;await done;
      if(reason==='none') {assert.equal(status,200);await until(()=>c.events().some(e=>e.kind==='aux-ready'));assert.equal(c.records.length,2);}
      else {assert.notEqual(status,200);assert.equal(c.records.length,0);assert.equal(c.events().filter(e=>e.kind==='aux-start').length,0);}
    } finally {Captures.prototype.acquire=original;Captures.prototype.release=originalRelease;req?.destroy();}
  }));
}
async function publish(c) {
  writeFileSync(c.control,JSON.stringify({session:'s',run:'one',scenario:'component'}));
  await c.send();await until(()=>c.events().some(e=>e.kind==='aux-ready'));await c.send();
  assert.equal(c.state().view.length,1);writeFileSync(c.control,'{}');
}
test('D03: edited covered root reconciles, survives restart and reverts without resurrecting a summary',async()=>fixture(async c=>{
  await publish(c);c.sources[0].parts[0].text='corrected source';c.body.messages[0].content='corrected source';
  await c.plugin['chat.message']({sessionID:'s'});
  assert.equal((await c.send()).status,200);
  assert.deepEqual(c.records.at(-1),c.body);assert.equal(c.state().view.length,0);
  assert.ok(c.events().some(e=>e.kind==='published-roots-invalidated'));
  await c.restart();assert.equal((await c.send()).status,200);assert.deepEqual(c.records.at(-1),c.body);
  c.sources[0].parts[0].text='seed';c.body.messages[0].content='seed';
  assert.equal((await c.send()).status,200);assert.equal(c.state().view.length,0);assert.deepEqual(c.records.at(-1),c.body);
}));
test('D03: expansion beyond fixture budget persists an explicit hold and native rebase clears it',async()=>fixture(async c=>{
  await publish(c);c.sources[0].parts[0].text='large'.repeat(500);c.body.messages[0].content='large'.repeat(500);
  writeFileSync(c.control,JSON.stringify({maximum_primary_bytes:500}));
  const before=c.records.length;
  const held=await c.send();assert.equal(held.status,400);assert.match(held.text,/E_INPUT_BUDGET/);
  assert.equal(c.state().view.length,0);assert.equal(c.state().hold.code,'E_INPUT_BUDGET');assert.equal(c.records.length,before);
  await c.restart();assert.equal((await c.send()).status,400);assert.equal(c.state().hold.code,'E_INPUT_BUDGET');assert.equal(c.records.length,before);
  // Simulate the next public base after successful native compaction, not editing private DB.
  c.sources.splice(0,2,{info:{id:'native-summary',sessionID:'s',role:'assistant',summary:true,finish:'stop'},parts:[{type:'text',text:'native summary'}]});
  c.body.messages.splice(0,2,{role:'assistant',content:'native summary'});
  assert.equal((await c.send()).status,200);assert.equal(c.state().hold,null);assert.equal(c.state().epoch,1);assert.deepEqual(c.records.at(-1),c.body);
}));
