/** Executable probe regressions; NOT product conformance certification. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonical, parseJSON, hash } from '../../../scripts/canonical-json.mjs';
import { rootsFor, project, proposalFrom, CompletionParser } from './probe-protocol.mjs';
import { Captures } from './probe-captures.mjs';
import { forward, responseHeaders } from './probe-transport.mjs';
import gatewayPlugin from './gateway-plugin.mjs';
const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,ms=4000) {const end=Date.now()+ms;while(Date.now()<end){if(predicate())return;await wait(5);}throw Error('TEST_DEADLINE');}
async function listen(handler) {const server=createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));return server;}
async function close(server) {server.closeAllConnections();await new Promise(r=>server.close(r));}
const url=s=>`http://127.0.0.1:${s.address().port}/v1/chat/completions`;
const value=text=>({choices:[{index:0,message:{role:'assistant',content:text},finish_reason:'stop'}]});
const chunk=(delta,finish=null)=>({choices:[{index:0,delta,finish_reason:finish}]});
const frame=x=>'data: '+JSON.stringify(x)+'\n\n';
const stream=text=>frame(chunk({content:text}))+frame(chunk({},'stop'))+'data: [DONE]\n\n';
function parse(bytes,type='text/event-stream',limit) {const p=new CompletionParser(type,limit);for(const b of bytes)p.push(Buffer.from([b]));return p.end();}

test('C02 unsupported native/wire parts are never silently removable',()=>{
  const native=[{info:{id:'u',role:'user'},parts:[{type:'text',text:'hello'},{type:'file',mime:'image/png'}]},{info:{id:'a',role:'assistant'},parts:[{type:'text',text:'ok'}]}];
  const mixed={messages:[{role:'user',content:[{type:'text',text:'hello'},{type:'image_url',image_url:{url:'data:image/png;base64,AA=='}}]},{role:'assistant',content:'ok'}]};
  assert.throws(()=>rootsFor(mixed,native),/E_CODEC_UNSUPPORTED/);
  assert.throws(()=>rootsFor({messages:[{role:'user',content:'hello'},{role:'assistant',content:'ok'}]},native),/E_CODEC_UNSUPPORTED/);
  native[0].parts=[{type:'text',text:'hello'},{type:'unknown',payload:'opaque'}];
  assert.throws(()=>rootsFor({messages:[{role:'user',content:'hello'},{role:'assistant',content:'ok'}]},native),/E_CODEC_UNSUPPORTED/);
});
test('C02 duplicate IDs/protected roots cannot become replacements',()=>{
  const root={id:'u',parts:[{role:'user',content:'x'}],digest:hash('x'),protected:true};
  assert.throws(()=>project([root],[{ids:['u'],sourceHash:hash([['u',root.digest]]),summary:'s'}]),/E_STALE_VIEW/);
  assert.throws(()=>project([root,root],[]),/E_DUPLICATE_ROOT/);
});
test('C04 empty, whitespace, malformed, truncated and valid are distinct',()=>{
  for(const summary of ['', ' \n\t '])assert.throws(()=>proposalFrom({finish:'stop',content:JSON.stringify({summary})}),/E_NO_GAIN/);
  assert.throws(()=>proposalFrom({finish:'stop',content:'{'}),/E_SCHEMA/);
  assert.throws(()=>proposalFrom({finish:'length',content:'{"summary":"ok"}'}),/E_FINISH/);
  assert.throws(()=>proposalFrom({finish:'tool_calls',content:''}),/E_TOOL/);
  assert.equal(proposalFrom({finish:'stop',content:'{"summary":"  exact bytes  "}'}),'  exact bytes  ');
});
test('C08 JSON and SSE have identical byte budgets and strict UTF-8',()=>{
  for(const [type,raw] of [['application/json',JSON.stringify(value('é'))],['text/event-stream',stream('é')]]) {
    const bytes=Buffer.from(raw);
    assert.equal(parse(bytes,type,bytes.length).content,'é');
    assert.throws(()=>parse(bytes,type,bytes.length-1),/E_AUX_BYTES/);
    assert.throws(()=>parse(Buffer.from([0xff]),type),/E_UTF8/);
  }
});
test('C08 errors, malformed shapes, missing DONE and post-finish text fail',()=>{
  for(const raw of [frame({error:{message:'fixture'}}),frame({foo:'bar'}),frame({choices:[chunk({}).choices[0],chunk({}).choices[0]]}),frame(chunk({content:'x'})),frame(chunk({},'stop')),stream('x')+frame(chunk({content:'extra'})),frame(chunk({},'stop'))+frame(chunk({content:'late'}))+'data: [DONE]\n\n']) {
    assert.throws(()=>parse(Buffer.from(raw)),/E_/);
  }
  const bytes=Buffer.from(frame(chunk({tool_calls:[{index:0,id:'c'}]}))+frame(chunk({},'stop'))+'data: [DONE]\n\n');
  assert.equal(parse(bytes).finish,'tool_calls');
  assert.throws(()=>parse(Buffer.from(JSON.stringify({error:{message:'no'}})),'application/json'),/E_UPSTREAM_BODY/);
  assert.throws(()=>parseJSON('{"x":1,"\\u0078":2}'),/E_JSON_DUPLICATE/);
});
test('C05 five thousand turns retain bounded bytes and handles, not cumulative history',()=>{
  let clock=0;const store=new Captures({now:()=>clock,perSession:4,maxBytes:200000,maxEntries:16});
  let peak=0;
  for(let n=0;n<5000;n++) {
    store.put('s',{session:'s',kind:'primary',messages:['x'.repeat(10000+n)]});
    const token=store.register('s','primary');const c=store.acquire(token);
    assert.equal(c.session,'s');store.release(token);clock++;
    const st=store.stats();assert.ok(st.entries<=4);assert.ok(st.bytes<65000);peak=Math.max(peak,st.bytes);
  }
  clock+=30001;store.sweep();assert.deepEqual(store.stats(),{entries:0,pending:0,bytes:0,active:0});
  assert.ok(peak>10000);store.dispose();assert.throws(()=>store.put('s',{}),/E_DISPOSED/);
});
test('C05 active requests are pinned; retries expire and overflow refuses admission',()=>{
  let clock=0;const s=new Captures({now:()=>clock,perSession:1,maxEntries:2,maxBytes:1000});
  s.put('a',{session:'a',messages:['abc']});const t=s.register('a','primary');s.acquire(t);
  clock=40000;s.sweep();assert.equal(s.stats().entries,1);
  assert.throws(()=>s.put('a',{session:'a',messages:['new']}),/E_CAPTURE_BUDGET/);
  s.release(t);assert.equal(s.acquire(t).session,'a');s.release(t);
  clock+=30001;s.sweep();assert.throws(()=>s.acquire(t),/E_CAPTURE/);
});
test('C07 allowed response headers survive, hop-by-hop/auth do not',()=>{
  const h=new Headers({'content-type':'application/json','retry-after':'3','x-request-id':'fixture','authorization':'not-forwarded','set-cookie':'not-forwarded','content-length':'100','connection':'x-ratelimit-reset-requests','x-ratelimit-reset-requests':'9'});
  assert.deepEqual(responseHeaders(h),{'content-type':'application/json','retry-after':'3','x-request-id':'fixture'});
});
test('C07 actual HTTP preserves status/Retry-After without retrying',async()=>{
  let requests=0;const up=await listen((req,res)=>{requests++;req.resume();res.writeHead(429,{'content-type':'application/json','retry-after':'7','x-request-id':'fixture-id'});res.end('{"error":"fixture"}');});
  const stats={};const proxy=await listen((req,res)=>forward(req,res,url(up),{}, {controller:new AbortController(),stats}).catch(()=>res.destroy()));
  try {
    const response=await fetch(url(proxy),{method:'POST',body:'{}'});
    assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'7');assert.equal(response.headers.get('x-request-id'),'fixture-id');await response.text();
    await until(()=>stats.stopped);assert.equal(requests,1);
  }finally{await close(proxy);await close(up);}
});
test('C07 disconnect during a silent upstream body closes the outbound handle',async()=>{
  let upstreamClosed=false;const stats={};
  const up=await listen((req,res)=>{req.resume();res.writeHead(200,{'content-type':'text/plain'});res.write('first');res.on('close',()=>{upstreamClosed=true;});});
  const proxy=await listen((req,res)=>forward(req,res,url(up),{}, {controller:new AbortController(),stats}).catch(()=>res.destroy()));
  try {
    const controller=new AbortController();const response=await fetch(url(proxy),{method:'POST',body:'{}',signal:controller.signal});
    await response.body.getReader().read();controller.abort();
    await until(()=>stats.stopped&&upstreamClosed);assert.ok(stats.bytes>0);
  }finally{await close(proxy);await close(up);}
});
test('C07 slow client applies backpressure with bounded writable queue',async()=>{
  const stats={};let sent=0;
  const up=await listen(async(req,res)=>{
    req.resume();res.on('error',()=>{});res.writeHead(200,{'content-type':'application/octet-stream'});
    try {for(let n=0;n<2048;n++){if(res.destroyed)break;sent+=65536;if(!res.write(Buffer.alloc(65536)))await once(res,'drain');}res.end();}catch{}
  });
  const proxy=await listen((req,res)=>forward(req,res,url(up),{}, {controller:new AbortController(),stats}).catch(()=>res.destroy()));
  const client=connect(proxy.address().port,'127.0.0.1');client.on('error',()=>{});
  try {
    await once(client,'connect');client.pause();client.write('POST /v1/chat/completions HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 2\r\n\r\n{}');
    // A conforming writer may stop at the FIRST blocked write. Requiring a
    // third drain before releasing the paused client deadlocks on larger HWMs.
    await until(()=>stats.drains>=1);assert.ok(stats.maxBuffered<1024*1024);assert.ok(sent>0);
    const before=stats.bytes;client.resume();
    await until(()=>stats.bytes>before); // resuming the peer releases flow control
    assert.ok(stats.maxBuffered<1024*1024);
    client.destroy();await until(()=>stats.stopped);
  }finally{client.destroy();await close(proxy);await close(up);}
});

test('C06 real gateway recovers native 200 error/truncation; old view remains usable',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'cc-component-'));const saved={...process.env};let mode='ok';const records=[];
  const up=await listen(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const body=JSON.parse(Buffer.concat(chunks));records.push(body);
    const aux=body.messages.at(-1).content.startsWith('CC_AUXILIARY::');
    res.writeHead(200,{'content-type':'text/event-stream'});
    if(!aux&&body.messages[0].content==='RESET'&&mode==='error')res.end(frame({error:{message:'synthetic'}}));
    else if(!aux&&body.messages[0].content==='RESET'&&mode==='truncated')res.end(frame(chunk({content:'incomplete'})));
    else if(!aux&&body.messages[0].content==='RESET'&&mode==='pause')res.write(frame(chunk({content:'waiting'})));
    else res.end(stream(aux?'{"summary":"CC_COMPONENT_SUMMARY"}':'ok'));
  });
  const reserved=await listen((_q,r)=>r.end());const port=reserved.address().port;await close(reserved);
  const trace=join(directory,'events.jsonl'),control=join(directory,'control.json'),checkpoint=join(directory,'state.json');
  writeFileSync(control,JSON.stringify({session:'s',run:'r1',scenario:'component'}));
  Object.assign(process.env,{CC_FIXTURE_UPSTREAM:url(up),CC_LOCAL_SECRET:'synthetic-local-only',CC_TRACE:trace,CC_CONTROL:control,CC_CHECKPOINT:checkpoint,CC_GATEWAY_PORT:String(port)});
  let plugin;
  const sources=[{info:{id:'u1',sessionID:'s',role:'user'},parts:[{type:'text',text:'seed'}]},{info:{id:'a1',sessionID:'s',role:'assistant'},parts:[{type:'text',text:'done'}]},{info:{id:'u2',sessionID:'s',role:'user'},parts:[{type:'text',text:'current'}]}];
  const body={model:'probe',stream:true,messages:[{role:'user',content:'seed'},{role:'assistant',content:'done'},{role:'user',content:'current'}]};
  const events=()=>readFileSync(trace,'utf8').trim().split('\n').map(JSON.parse);
  async function send(kind,payload,signal) {
    if(kind==='build')await plugin['experimental.chat.messages.transform']({}, {messages:sources});
    const out={headers:{}};await plugin['chat.headers']({sessionID:'s',agent:kind},out);
    const response=await fetch(`http://127.0.0.1:${port}/v1/chat/completions`,{method:'POST',headers:out.headers,body:JSON.stringify(payload),signal});
    return response.text();
  }
  try {
    plugin=await gatewayPlugin({directory});await send('build',body);await until(()=>events().some(x=>x.kind==='aux-ready'));
    await send('build',body);assert.equal(JSON.parse(readFileSync(checkpoint)).sessions[0].view.length,1);
    for(mode of ['error','truncated']) {
      await plugin['experimental.session.compacting']({sessionID:'s'},{context:[]});
      try{await send('compaction',{model:'probe',stream:true,messages:[{role:'user',content:'RESET'}]});}catch{}
      await until(()=>JSON.parse(readFileSync(checkpoint)).sessions[0].reset_pending===false);
      const state=JSON.parse(readFileSync(checkpoint)).sessions[0];assert.equal(state.epoch,0);assert.equal(state.view.length,1);
      await send('build',body);assert.equal(records.at(-1).messages[0].content,'CC_COMPONENT_SUMMARY');
    }
    mode='pause';
    await plugin['experimental.session.compacting']({sessionID:'s'},{context:[]});
    const controller=new AbortController();const n=records.length;
    const pending=send('compaction',{model:'probe',stream:true,messages:[{role:'user',content:'RESET'}]},controller.signal).catch(()=>null);
    await until(()=>records.length>n);controller.abort();await pending;
    await until(()=>JSON.parse(readFileSync(checkpoint)).sessions[0].reset_pending===false);
    await send('build',body);assert.equal(records.at(-1).messages[0].content,'CC_COMPONENT_SUMMARY');
    // Disposal must also stop a request that never emits another chunk.
    await plugin['experimental.session.compacting']({sessionID:'s'},{context:[]});
    const count=records.length;
    const held=send('compaction',{model:'probe',stream:true,messages:[{role:'user',content:'RESET'}]}).catch(()=>null);
    await until(()=>records.length>count);await plugin.dispose();await held;plugin=null;
    const disposed=events().findLast(x=>x.kind==='disposed');assert.equal(disposed.outbound,0);assert.equal(disposed.auxiliary,0);
    plugin=await gatewayPlugin({directory});mode='ok';await send('build',body);
    assert.equal(records.at(-1).messages[0].content,'CC_COMPONENT_SUMMARY');
    assert.ok(events().filter(x=>x.kind==='native-failed').length>=3);
  } finally {if(plugin)await plugin.dispose();await close(up);for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);rmSync(directory,{recursive:true,force:true});}
});

test('P13 synthetic component admission guard matrix',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'cc-p13-')),saved={...process.env},records=[],tokens=[];
  const up=await listen(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    records.push({body:JSON.parse(Buffer.concat(chunks)),headers:req.headers});
    res.writeHead(200,{'content-type':'text/event-stream'});res.end(stream('ok'));
  });
  const reserved=await listen((_q,r)=>r.end()),port=reserved.address().port;await close(reserved);
  const trace=join(directory,'events.jsonl'),control=join(directory,'control.json'),checkpoint=join(directory,'state.json');
  writeFileSync(control,'{}');
  Object.assign(process.env,{CC_FIXTURE_UPSTREAM:url(up),CC_LOCAL_SECRET:'p13-local-secret',CC_TRACE:trace,CC_CONTROL:control,CC_CHECKPOINT:checkpoint,CC_GATEWAY_PORT:String(port)});
  const secret=process.env.CC_LOCAL_SECRET,body={model:'probe',stream:true,messages:[{role:'user',content:'seed'},{role:'assistant',content:'done'},{role:'user',content:'current'}]};
  let plugin,serial=0,originalAcquire;
  const events=()=>readFileSync(trace,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const bytes=value=>Buffer.from(JSON.stringify(value));
  const send=({method='POST',path='/v1/chat/completions',headers={},body=Buffer.alloc(0)})=>new Promise((resolve,reject)=>{
    const raw=Buffer.isBuffer(body)?body:Buffer.from(body);
    const req=request({hostname:'127.0.0.1',port,method,path,headers:{host:`127.0.0.1:${port}`,...headers,'content-length':String(raw.byteLength)}},res=>{
      res.resume();res.on('end',()=>resolve({status:res.statusCode}));res.on('error',reject);
    });
    req.on('error',reject);req.end(raw);
  });
  const correlate=async label=>{
    const session=`p13-${++serial}-${label}`;
    const sources=[{info:{id:`${session}-u1`,sessionID:session,role:'user'},parts:[{type:'text',text:'seed'}]},
      {info:{id:`${session}-a1`,sessionID:session,role:'assistant'},parts:[{type:'text',text:'done'}]},
      {info:{id:`${session}-u2`,sessionID:session,role:'user'},parts:[{type:'text',text:'current'}]}];
    await plugin['experimental.chat.messages.transform']({}, {messages:sources});
    const out={headers:{}};await plugin['chat.headers']({sessionID:session,agent:'build'},out);
    tokens.push(out.headers['x-cc-capture']);return {session,headers:out.headers};
  };
  const rejected=async(name,requestOptions)=>{
    const forwards=records.length,at=events().length,response=await send(requestOptions);
    assert.ok(response.status<200||response.status>=300,`P13_ASSERT_rejected:${name}`);
    assert.equal(records.length,forwards,`P13_ASSERT_no_forward:${name}`);
    assert.equal(events().slice(at).some(x=>['aux-start','attempt-permit','tool-effect'].includes(x.kind)),false,`P13_ASSERT_no_dispatch:${name}`);
  };
  try {
    plugin=await gatewayPlugin({directory});
    for(const [name,options] of [
      ['wrong-method',{method:'GET'}],
      ['wrong-path',{path:'/v1/not-chat'}],
      ['wrong-origin',{headers:{origin:'https://fixture.invalid'}}],
      ['wrong-host',{headers:{host:`localhost:${port}`}}],
      ['wrong-local',{headers:{'x-cc-local':'not-p13-local-secret'}}],
      ['absent-local',{headers:{'x-cc-local':undefined}}],
      ['absent-capture',{headers:{'x-cc-capture':undefined}}]
    ]) {
      const correlation=await correlate(name),headers={...correlation.headers,...options.headers};
      for(const key of Object.keys(headers))if(headers[key]===undefined)delete headers[key];
      await rejected(name,{...options,headers,body:bytes(body)});
    }
    const revoked=await correlate('revoked-before-admission');await plugin['chat.message']({sessionID:revoked.session});
    await rejected('revoked-before-admission',{headers:revoked.headers,body:bytes(body)});
    const duringRead=await correlate('revoked-during-read'),raw=bytes(body);let acquired=false;
    originalAcquire=Captures.prototype.acquire;
    Captures.prototype.acquire=function(...args){const capture=originalAcquire.apply(this,args);acquired=true;return capture;};
    const response=new Promise((resolve,reject)=>{
      const req=request({hostname:'127.0.0.1',port,path:'/v1/chat/completions',method:'POST',headers:{host:`127.0.0.1:${port}`,...duringRead.headers,'content-length':String(raw.byteLength)}},res=>{
        res.resume();res.on('end',()=>resolve({status:res.statusCode}));res.on('error',reject);
      });
      req.on('error',reject);req.write(raw.subarray(0,1));
      (async()=>{try{await until(()=>acquired);Captures.prototype.acquire=originalAcquire;await plugin['chat.message']({sessionID:duringRead.session});req.end(raw.subarray(1));}catch(error){Captures.prototype.acquire=originalAcquire;req.destroy(error);}})();
    });
    const forwards=records.length,at=events().length,duringReadResponse=await response;
    assert.ok(duringReadResponse.status<200||duringReadResponse.status>=300,'P13_ASSERT_rejected:revoked-during-read');
    assert.equal(records.length,forwards,'P13_ASSERT_no_forward:revoked-during-read');
    assert.equal(events().slice(at).some(x=>['aux-start','attempt-permit','tool-effect'].includes(x.kind)),false,'P13_ASSERT_no_dispatch:revoked-during-read');
    for(const [name,payload] of [
      ['oversized-body',Buffer.concat([bytes(body),Buffer.alloc(1024*1024,0x20)])],
      ['malformed-utf8',Buffer.from([0xff])],
      ['malformed-json',Buffer.from('{"model":"probe","messages":[')],
      ['wrong-model',{...body,model:'not-probe'}],
      ['messages-not-array',{...body,messages:{}}]
    ]) {
      const correlation=await correlate(name);
      await rejected(name,{headers:correlation.headers,body:Buffer.isBuffer(payload)?payload:bytes(payload)});
    }
    const retry=await correlate('changed-retry'),first=await send({headers:retry.headers,body:bytes(body)});
    assert.ok(first.status>=200&&first.status<300,'P13_ASSERT_control:changed-retry-initial');
    await rejected('changed-retry',{headers:retry.headers,body:bytes({...body,messages:[...body.messages.slice(0,-1),{role:'user',content:'changed'}]})});
    const artifacts=[readFileSync(trace,'utf8'),readFileSync(checkpoint,'utf8')];
    for(const value of [secret,...tokens])assert.equal(artifacts.some(text=>text.includes(value)),false,'P13_ASSERT_no_secret_export');
  } finally {
    if(originalAcquire)Captures.prototype.acquire=originalAcquire;
    if(plugin)await plugin.dispose();await close(up);
    for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);
    rmSync(directory,{recursive:true,force:true});
  }
});
