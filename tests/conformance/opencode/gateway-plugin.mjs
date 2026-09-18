/** WP-00 synthetic integration probe only. Not the production plugin. */
import { createServer } from 'node:http';
import { readFileSync, appendFileSync, writeFileSync, renameSync, existsSync, realpathSync } from 'node:fs';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { error, hash, parseJSON, rootsFor, project, apply, completion, proposalFrom, CompletionParser } from './probe-protocol.mjs';
import { Captures } from './probe-captures.mjs';
import { forward } from './probe-transport.mjs';
import { setTimeout as abortableDelay } from 'node:timers/promises';
const safeEqual=(a,b)=>typeof a==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
function setting(name) {const v=process.env[name];if(!v)throw error(`MISSING_${name}`);return v;}
export default async function gatewayPlugin(ctx) {
  const upstream=new URL(setting("CC_FIXTURE_UPSTREAM"));
  if(upstream.protocol!=="http:"||upstream.hostname!=="127.0.0.1") throw error("FIXTURE_LOOPBACK_ONLY");
  const secret=setting("CC_LOCAL_SECRET"),trace=setting("CC_TRACE"),port=Number(setting("CC_GATEWAY_PORT"));
  const controls=()=>JSON.parse(readFileSync(setting("CC_CONTROL"),"utf8"));
  const emit=(kind,data={})=>appendFileSync(trace,JSON.stringify({at:Date.now(),...data,kind})+"\n");
  const checkpoint=setting("CC_CHECKPOINT");
  const workspace=hash(realpathSync(ctx.directory));
  const captures=new Captures(),sessions=new Map(),outbound=new Set(),auxiliaryRuns=new Set(),inbound=new Set();let closing=false,disposal=null;
  const sweeper=setInterval(()=>captures.sweep(),5000);sweeper.unref?.();
  const save=()=>{
    const rows=[...sessions].map(([id,s])=>({id,epoch:s.epoch,view:s.view,seen:[...s.seen],pending_job:s.job&&!s.job.localStopped?s.job.id:null,reset_pending:s.resetPending,native_summary_id:s.nativeSummaryId??null,hold:s.hold??null}));
    const tmp=checkpoint+".tmp";
    writeFileSync(tmp,JSON.stringify({schema_version:1,probe_only:true,workspace,host_version:"1.18.31",sessions:rows}),{mode:0o600});
    renameSync(tmp,checkpoint);
  };
  if(existsSync(checkpoint)) {
    const saved=JSON.parse(readFileSync(checkpoint,"utf8"));
    if(saved.schema_version!==1||saved.probe_only!==true||saved.workspace!==workspace||saved.host_version!=="1.18.31"||!Array.isArray(saved.sessions))throw error("E_CHECKPOINT");
    for(const row of saved.sessions) {
      if(typeof row.id!=="string"||!Array.isArray(row.view)||!Array.isArray(row.seen)||!Number.isSafeInteger(row.epoch))throw error("E_CHECKPOINT");
      sessions.set(row.id,{epoch:row.epoch,view:row.view,seen:new Set(row.seen),job:null,resetPending:Boolean(row.reset_pending),nativeSummaryId:row.native_summary_id??null,resetId:null,hold:row.hold??null});
      emit("checkpoint-restored",{session:row.id,epoch:row.epoch,replacements:row.view.length,orphaned_job:row.pending_job??null});
    }
  }
  const state=id=>{if(!sessions.has(id))sessions.set(id,{epoch:0,view:[],job:null,seen:new Set(),resetPending:false,nativeSummaryId:null,resetId:null,hold:null});return sessions.get(id);};
  function cancel(id,why) {
    const s=state(id),j=s.job;
    if(j&&!j.terminal){j.terminal=true;j.controller.abort();emit("aux-cancelled",{session:id,job:j.id,why,remote_state:"unknown"});}
    save();
  }
  async function auxiliary(s,capture,body,roots,config,control) {
    const id=randomUUID(),controller=new AbortController();
    const logical=project(roots,s.view);
    const removable=logical.filter(r=>!r.protected);
    const lastUser=removable.findLastIndex(r=>r.parts[0]?.role==="user");
    // The fixture may request all earlier closed turns to exercise consolidation.
    // The current user turn and its subsequent tool results always stay in the tail.
    const selected=control.consolidate?removable.slice(0,lastUser):removable.slice(0,2);
    if(selected.length<1||(!control.consolidate&&selected.length!==2))throw error("PROBE_INTERVAL");
    const ids=selected.flatMap(x=>x.coverage),start=roots.findIndex(r=>r.id===ids[0]);
    const covered=roots.slice(start,start+ids.length);
    if(hash(covered.map(x=>x.id))!==hash(ids)||covered.some(x=>x.protected))throw error("PROBE_COVERAGE");
    const job={id,controller,terminal:false,localStopped:false,epoch:s.epoch,config,ids,sourceHash:hash(covered.map(x=>[x.id,x.digest])),attempts:0,ready:null};
    s.job=job;s.seen.add(control.run);save();
    const mission=`CC_AUXILIARY::${control.scenario}::${control.run}. Return JSON with a summary of the selected closed history. Do not call tools.`;
    const clone={...structuredClone(body),messages:[...structuredClone(body.messages),{role:"user",content:mission}]};
    const reference={...clone,messages:clone.messages.slice(0,-1)};
    if(hash(reference)!==hash(body)) throw error("E_FIDELITY");
    emit("aux-start",{session:capture.session,job:id,parentHash:hash(body),clonePrefixHash:hash(reference),sourceIds:job.ids});
    const timer=setTimeout(()=>controller.abort(),10000);
    try {
      for(let attempt=1;attempt<=2;attempt++) {
        if(closing||job.terminal||controller.signal.aborted||s.epoch!==job.epoch)throw error("E_CANCELLED");
        job.attempts=attempt;
        emit("attempt-permit",{session:capture.session,job:id,attempt});
        const response=await fetch(upstream,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(clone),redirect:"error",signal:controller.signal});
        if(response.status===429||response.status>=500) {
          await response.body?.cancel();
          if(attempt===2)throw error("E_RATE");
          const retryAfter=response.headers.get("retry-after");
          const wait=retryAfter===null?2000:Number(retryAfter)*1000;
          if(!Number.isFinite(wait)||wait<0||wait>60000)throw error("E_RATE_WAIT");
          await abortableDelay(wait,undefined,{signal:controller.signal}); continue;
        }
        if(!response.ok){await response.body?.cancel();throw error("E_UPSTREAM");}
        let summary;
        try { summary=proposalFrom(await completion(response)); }
        catch(e) { if(e.code==='E_SCHEMA'&&attempt<2)continue;throw e; }
        if(job.terminal||s.epoch!==job.epoch||controller.signal.aborted)throw error('E_CANCELLED');
        job.ready=summary;emit('aux-ready',{session:capture.session,job:id,attempts:attempt});return;
      }
    } catch(e) {job.terminal=true;emit("aux-failed",{session:capture.session,job:id,code:e.code??e.name,attempts:job.attempts});}
    finally {clearTimeout(timer);job.localStopped=true;save();emit("aux-local-stopped",{session:capture.session,job:id});}
  }
  const server=createServer(async(req,res)=>{
    let capture,token,transport,settleInbound;
    const incoming={req,res,done:new Promise(resolve=>{settleInbound=resolve;})};
    inbound.add(incoming);
    const assertAdmission=()=>{
      if(closing||req.aborted||res.destroyed)throw error('E_CANCELLED');
      captures.assertActive(token,capture);
    };
    const reply=(status,code)=>{res.writeHead(status,{"content-type":"application/json"});res.end(JSON.stringify({error:{message:code,type:"invalid_request_error"}}));};
    try {
      if(closing)throw error('E_DISPOSED');
      if(req.method!=="POST"||req.url!=="/v1/chat/completions"||req.headers.origin||!/^127\.0\.0\.1:\d+$/.test(req.headers.host??"")) throw error("E_LOCAL_REQUEST");
      if(!safeEqual(req.headers["x-cc-local"],secret))throw error("E_LOCAL_AUTH");
      token=req.headers["x-cc-capture"];capture=captures.acquire(token);
      let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>1024*1024)throw error("E_BODY_LIMIT");chunks.push(chunk);}
      assertAdmission(); // A user/reset hook may have revoked the acquired ticket while reading.
      const bytes=Buffer.concat(chunks);const body=parseJSON(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
      if(body.model!=="probe"||!Array.isArray(body.messages))throw error("E_PROFILE");
      if(capture.bodyHash&&capture.bodyHash!==hash(body))throw error("E_RETRY_BODY");capture.bodyHash=hash(body);
      const s=state(capture.session),control=controls();
      // Synthetic-only ingress evidence. This immutable pre-transform value is
      // compared against an independent upstream recorder by the test oracle.
      emit('ingress',{session:capture.session,request_kind:capture.kind,body});
      const config=hash({...body,messages:body.messages.filter(m=>["system","developer"].includes(m.role))});
      let selected=body;
      assertAdmission();
      if(capture.kind==="primary") {
        const roots=rootsFor(body,capture.messages);
        const nativeId=capture.nativeSummaryId??null;
        if(nativeId!==s.nativeSummaryId) {
          cancel(capture.session,'observed-native-base');s.view=[];s.epoch++;
          s.nativeSummaryId=nativeId;s.resetPending=false;save();
          emit('native-base-observed',{session:capture.session,epoch:s.epoch});
        }
        if(s.resetPending) {
          if([...outbound].some(x=>x.session===capture.session&&x.kind==='compaction'))throw error('E_NATIVE_PENDING');
        }
        if(s.view.some(v=>v.config!==config)) {
          cancel(capture.session,'published-context-changed');
          const count=s.view.length;s.view=[];save();
          emit('published-view-invalidated',{session:capture.session,count});
        }
        // A covered source can change without changing system/config. In this
        // probe all replacements share the observed context; discard them together.
        // Unknown codec/protocol errors are not recoverable by dropping a view.
        try {apply(roots,s.view);} catch(e) {
          if(e.code!=='E_STALE_VIEW')throw e;
          apply(roots,[]); // Check the verified current roots before changing state.
          cancel(capture.session,'published-roots-changed');
          const count=s.view.length;s.view=[];save();
          emit('published-roots-invalidated',{session:capture.session,count});
        }
        if(s.resetPending) {
          s.resetPending=false;save();
          emit('native-reconciled',{session:capture.session,epoch:s.epoch,outcome:'no-confirmed-new-base'});
        }
        if(s.job?.ready!==null&&s.job?.ready!==undefined&&!s.job.terminal){
          const job=s.job;
          if(job.epoch!==s.epoch||job.config!==config){job.terminal=true;emit("proposal-stale",{session:capture.session,job:job.id});}
          else {
            const r={id:job.id,ids:job.ids,sourceHash:job.sourceHash,summary:job.ready,config:job.config};
            const next=[...s.view.filter(v=>!v.ids.some(id=>r.ids.includes(id))),r];
            try {
              apply(roots,next);assertAdmission();s.view=next;job.terminal=true;save();
              emit("view-applied",{session:capture.session,job:job.id,ids:r.ids});
            } catch(e) {
              if(e.code!=='E_STALE_VIEW')throw e;
              job.terminal=true;save();
              emit('proposal-stale',{session:capture.session,job:job.id,code:e.code});
            }
          }
        }
        selected={...body,messages:apply(roots,s.view)};
        // Synthetic byte admission only: NOT a live-model tokenizer or a quota increase.
        const limit=control.maximum_primary_bytes??1024*1024;
        if(!Number.isSafeInteger(limit)||limit<1||limit>1024*1024)throw error('E_FIXTURE_BUDGET');
        const inputBytes=Buffer.byteLength(JSON.stringify(selected));
        if(inputBytes>limit) {
          cancel(capture.session,'input-budget');
          s.hold={code:'E_INPUT_BUDGET',action:'native-rebase-required',input_bytes:inputBytes,limit_bytes:limit};save();
          emit('input-held',{session:capture.session,...s.hold});throw error('E_INPUT_BUDGET');
        }
        if(s.hold!==null){s.hold=null;save();emit('input-hold-cleared',{session:capture.session});}
        assertAdmission();
        emit("sealed",{session:capture.session,request_kind:capture.kind,rawHash:hash(body),effectiveHash:hash(selected),rootIds:roots.map(x=>x.id)});
        if(control.session===capture.session&&control.run&&!s.seen.has(control.run)&&(!s.job||(s.job.terminal&&s.job.localStopped))) {
          const run=auxiliary(s,capture,selected,roots,config,control).catch(e=>emit('aux-setup-failed',{code:e.code??e.name})).finally(()=>auxiliaryRuns.delete(run));
          auxiliaryRuns.add(run);
        }
      } else emit("other-request",{session:capture.session,request_kind:capture.kind});
      assertAdmission(); // Last synchronous check before starting the outbound request.
      const controller=new AbortController(),stats={};
      let settle;const done=new Promise(resolve=>{settle=resolve;});
      transport={session:capture.session,kind:capture.kind,controller,stats,done,settle};outbound.add(transport);
      const result=await forward(req,res,upstream,selected,{
        controller,stats,
        observer:capture.kind==='compaction'?headers=>new CompletionParser(headers.get('content-type')??''):null,
        onHeaders:status=>{if(capture.kind==='compaction'&&status>=400)nativeFailed(capture,'HTTP_'+status,status);}
      });
      if(capture.kind==='compaction'&&result.status<400&&result.completion?.finish!=='stop')nativeFailed(capture,'E_NATIVE_FINISH',result.status);
    } catch(e) {
      if(capture?.kind==='compaction')nativeFailed(capture,e.code??e.message,null);
      emit('request-rejected',{session:capture?.session??null,code:e.code??e.message??e.name});
      if(!res.headersSent&&!res.destroyed)reply(400,e.code??'E_REQUEST');else res.destroy();
    } finally {
      try {
        if(transport){outbound.delete(transport);emit('transport-stopped',{session:transport.session,...transport.stats});transport.settle();}
        if(capture)captures.release(token);
        emit('capture-retention',captures.stats());
      } finally {inbound.delete(incoming);settleInbound();}
    }
  });
  function nativeFailed(capture,code,status) {
    const s=state(capture.session);
    if(capture.resetId!==s.resetId)return;
    s.resetPending=false;save();
    emit('native-failed',{session:capture.session,status,code,epoch:s.epoch,preserved_replacements:s.view.length});
  }
  server.requestTimeout=30000;
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(port,"127.0.0.1",resolve);});
  emit("loaded",{profile:"OC-V1-HTTP-LOCAL",probe:true});
  return {
    "experimental.chat.messages.transform":async(_input,output)=>{
      if(closing)throw error('E_DISPOSED');
      const ids=[...new Set(output.messages.map(x=>x.info.sessionID))];if(ids.length!==1)throw error("E_SCOPE");
      const capture={session:ids[0],messages:structuredClone(output.messages),kind:"primary"};capture.nativeSummaryId=output.messages.findLast(x=>x.info.summary&&!x.info.error&&x.info.finish==='stop')?.info.id??null;
      captures.put(ids[0],capture);emit("capture",{session:ids[0],messageIds:output.messages.map(x=>x.info.id)});
    },
    "chat.headers":async(input,output)=>{
      if(closing)throw error('E_DISPOSED');
      const kind=['compaction','title','summary'].includes(input.agent)?input.agent:'primary';
      const token=captures.register(input.sessionID,kind,{resetId:state(input.sessionID).resetId});
      output.headers["x-cc-capture"]=token;output.headers["x-cc-local"]=secret;
      emit("correlated",{session:input.sessionID,request_kind:kind});
    },
    "chat.message":async input=>{if(closing)throw error('E_DISPOSED');cancel(input.sessionID,"user-input");captures.clearSession(input.sessionID);},
    "experimental.session.compacting":async (input,output)=>{
      if(closing)throw error('E_DISPOSED');
      captures.clearSession(input.sessionID);
      cancel(input.sessionID,"native-compaction");state(input.sessionID).resetPending=true;state(input.sessionID).resetId=randomUUID();save();
      output.context.push(`CC_NATIVE_RESET::${input.sessionID}`);
      emit("native-start",{session:input.sessionID});
    },
    event:async({event})=>{
      if(closing)return;
      if(event.type==="session.compacted") {
        const id=event.properties?.sessionID,s=state(id);
        if(s.resetPending)emit('native-ended',{session:id,epoch:s.epoch+1,awaiting_public_base:true});
      }
    },
    tool:{cc_probe:{description:"Synthetic counter for an isolated conformance fixture.",args:{},execute:async(_args,context)=>{const output=`CC_TOOL_RESULT::${context.sessionID}::${context.messageID}:local-test-only`;
      emit('tool-effect',{session:context.sessionID,messageID:context.messageID});await new Promise(r=>setTimeout(r,250));return output;}}},
    dispose:()=>{
      if(disposal)return disposal;
      closing=true;clearInterval(sweeper);
      disposal=(async()=>{
      for(const id of sessions.keys())cancel(id,'dispose');
      for(const item of outbound)item.controller.abort(error('E_DISPOSED'));
      captures.dispose();
      for(const {req,res} of inbound){req.destroy();res.destroy();}
      server.closeAllConnections();
      let timer;
      try {
        await Promise.race([
          Promise.all([...auxiliaryRuns,...[...outbound].map(x=>x.done),...[...inbound].map(x=>x.done),new Promise(resolve=>server.close(resolve))]),
          new Promise((_,reject)=>{timer=setTimeout(()=>reject(error('E_DISPOSE_TIMEOUT')),2000);})
        ]);
      } finally {clearTimeout(timer);}
      emit('disposed',{inbound:inbound.size,outbound:outbound.size,auxiliary:auxiliaryRuns.size});
      })();return disposal;
    }
  };
}
