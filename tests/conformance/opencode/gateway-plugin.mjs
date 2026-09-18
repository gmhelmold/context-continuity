/** WP-00 integration probe, NOT the production Context Continuity plugin.
 * Only synthetic, explicitly configured loopback fixtures are accepted.
 * No provider credentials, remote URLs, host internals, or session forks.
 */
import { createServer } from "node:http";
import { readFileSync, appendFileSync, writeFileSync, renameSync, existsSync, realpathSync } from "node:fs";
import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
const canonical = v => v === null || typeof v !== "object" ? JSON.stringify(v)
  : Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
  : `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
const hash = v => createHash("sha256").update(canonical(v)).digest("hex");
const text = value => typeof value === "string" ? value : (value ?? []).filter(x=>x.type==="text").map(x=>x.text).join("\n");
const safeEqual = (a,b) => typeof a === "string" && Buffer.byteLength(a)===Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
const error = code => Object.assign(new Error(code),{code});
function setting(name) { const v=process.env[name]; if(!v) throw error(`MISSING_${name}`);return v; }

// Ordered native IDs -> exact known wire groups. Unknown lowering fails closed.
function rootsFor(body, source) {
  const wire=body.messages; const roots=[]; let at=0;
  while(at<wire.length && ["system","developer"].includes(wire[at].role)) {
    roots.push({id:`system:${at}`,parts:[wire[at]],protected:true}); at++;
  }
  for(const item of source) {
    if(item.info.role==="assistant"&&item.info.error) continue;
    const parts=item.parts.flatMap(p=>p.type==="text"&&!p.ignored?[p.text]
      :p.type==="compaction"?["What did we do so far?"]:[]);
    const value=parts.join("\n");
    const tools=item.parts.filter(p=>p.type==="tool");
    if(!value&&!tools.length) continue;
    const first=wire[at]; if(!first||first.role!==item.info.role) throw error("E_CODEC_ROLE");
    if(text(first.content)!==value) throw error("E_CODEC_TEXT");
    const group=[first];at++;
    if(tools.length) {
      const calls=first.tool_calls??[];
      if(calls.length!==tools.length) throw error("E_CODEC_CALLS");
      for(let i=0;i<tools.length;i++) {
        const t=tools[i],c=calls[i],result=wire[at];
        if(t.state.status!=="completed"||c.id!==t.callID||c.function.name!==t.tool||hash(JSON.parse(c.function.arguments))!==hash(t.state.input)) throw error("E_CODEC_CALL");
        if(!result||result.role!=="tool"||result.tool_call_id!==c.id||text(result.content)!==t.state.output) throw error("E_CODEC_RESULT");
        group.push(result);at++;
      }
    } else if(first.tool_calls?.length) throw error("E_CODEC_UNEXPECTED_CALL");
    roots.push({id:item.info.id,parts:group,protected:item.parts.some(p=>p.type==="compaction")});
  }
  if(at!==wire.length) throw error("E_CODEC_REMAINDER");
  return roots.map(r=>({...r,digest:hash(r.parts)}));
}
// Probe projection: every replacement is flattened to immutable native roots.
// This checkpoint is a fixture, not the product's ledger or storage engine.
function project(roots,replacements) {
  const result=[];let at=0;
  const sorted=replacements.map(r=>({...r,start:roots.findIndex(x=>x.id===r.ids[0])})).sort((a,b)=>a.start-b.start);
  const original=r=>({...r,coverage:[r.id]});
  for(const r of sorted) {
    if(!r.ids.length||r.start<at||r.start<0) throw error("E_STALE_VIEW");
    const covered=roots.slice(r.start,r.start+r.ids.length);
    if(covered.some(x=>x.protected)||hash(covered.map(x=>[x.id,x.digest]))!==r.sourceHash) throw error("E_STALE_VIEW");
    const parts=[{role:"assistant",content:r.summary}];
    result.push(...roots.slice(at,r.start).map(original),{id:`summary:${r.id}`,parts,coverage:r.ids,digest:hash(parts),protected:false});
    at=r.start+r.ids.length;
  }
  return [...result,...roots.slice(at).map(original)];
}
const apply=(roots,replacements)=>project(roots,replacements).flatMap(x=>x.parts);

async function completion(response) {
  if(!(response.headers.get("content-type")??"").includes("text/event-stream")) return response.json();
  let pending="",content="",finish=null,toolCalled=false,total=0;
  const decoder=new TextDecoder();
  const event=block=>{
    const data=block.split(/\r?\n/).filter(line=>line.startsWith("data:")).map(line=>line.slice(5).trimStart()).join("\n");
    if(!data||data==="[DONE]")return;
    const value=JSON.parse(data),choice=value.choices?.[0];
    if(!choice)return;
    content+=choice.delta?.content??"";toolCalled ||= Boolean(choice.delta?.tool_calls?.length);
    finish=choice.finish_reason??finish;
  };
  for await(const chunk of response.body){
    total+=chunk.length;if(total>256*1024)throw error("E_AUX_BYTES");
    pending+=decoder.decode(chunk,{stream:true});
    let match;while((match=/\r?\n\r?\n/.exec(pending))!==null){event(pending.slice(0,match.index));pending=pending.slice(match.index+match[0].length);}
  }
  pending+=decoder.decode();if(pending.trim())throw error("E_SSE_TRUNCATED");
  return {choices:[{finish_reason:toolCalled?"tool_calls":finish,message:{content}}]};
}

export default async function gatewayPlugin(ctx) {
  const upstream=new URL(setting("CC_FIXTURE_UPSTREAM"));
  if(upstream.protocol!=="http:"||upstream.hostname!=="127.0.0.1") throw error("FIXTURE_LOOPBACK_ONLY");
  const secret=setting("CC_LOCAL_SECRET"),trace=setting("CC_TRACE"),port=Number(setting("CC_GATEWAY_PORT"));
  const controls=()=>JSON.parse(readFileSync(setting("CC_CONTROL"),"utf8"));
  const emit=(kind,data={})=>appendFileSync(trace,JSON.stringify({at:Date.now(),...data,kind})+"\n");
  const checkpoint=setting("CC_CHECKPOINT");
  const workspace=hash(realpathSync(ctx.directory));
  const captures=new Map(),pending=new Map(),sessions=new Map();let closing=false;
  const save=()=>{
    const rows=[...sessions].map(([id,s])=>({id,epoch:s.epoch,view:s.view,seen:[...s.seen],pending_job:s.job&&!s.job.localStopped?s.job.id:null,reset_pending:s.resetPending}));
    const tmp=checkpoint+".tmp";
    writeFileSync(tmp,JSON.stringify({schema_version:1,probe_only:true,workspace,host_version:"1.18.31",sessions:rows}),{mode:0o600});
    renameSync(tmp,checkpoint);
  };
  if(existsSync(checkpoint)) {
    const saved=JSON.parse(readFileSync(checkpoint,"utf8"));
    if(saved.schema_version!==1||saved.probe_only!==true||saved.workspace!==workspace||saved.host_version!=="1.18.31"||!Array.isArray(saved.sessions))throw error("E_CHECKPOINT");
    for(const row of saved.sessions) {
      if(typeof row.id!=="string"||!Array.isArray(row.view)||!Array.isArray(row.seen)||!Number.isSafeInteger(row.epoch))throw error("E_CHECKPOINT");
      sessions.set(row.id,{epoch:row.epoch,view:row.view,seen:new Set(row.seen),job:null,resetPending:Boolean(row.reset_pending)});
      emit("checkpoint-restored",{session:row.id,epoch:row.epoch,replacements:row.view.length,orphaned_job:row.pending_job??null});
    }
  }
  const state=id=>{if(!sessions.has(id))sessions.set(id,{epoch:0,view:[],job:null,seen:new Set(),resetPending:false});return sessions.get(id);};
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
          await new Promise(resolve=>setTimeout(resolve,wait)); continue;
        }
        if(!response.ok)throw error("E_UPSTREAM");
        const output=await completion(response);
        const choice=output.choices?.[0];
        if(choice?.finish_reason==="tool_calls"||choice?.message?.tool_calls?.length)throw error("E_TOOL");
        if(choice?.finish_reason!=="stop")throw error("E_FINISH");
        let proposal;try {proposal=JSON.parse(choice.message.content);}catch { if(attempt===2)throw error("E_SCHEMA");continue; }
        if(typeof proposal.summary!=="string"||proposal.summary.length>4000)throw error("E_SCHEMA");
        if(job.terminal||s.epoch!==job.epoch||controller.signal.aborted)throw error("E_CANCELLED");
        job.ready=proposal.summary;emit("aux-ready",{session:capture.session,job:id,attempts:attempt});return;
      }
    } catch(e) {job.terminal=true;emit("aux-failed",{session:capture.session,job:id,code:e.code??e.name,attempts:job.attempts});}
    finally {clearTimeout(timer);job.localStopped=true;save();emit("aux-local-stopped",{session:capture.session,job:id});}
  }
  const server=createServer(async(req,res)=>{
    let capture;
    const reply=(status,code)=>{res.writeHead(status,{"content-type":"application/json"});res.end(JSON.stringify({error:{message:code,type:"invalid_request_error"}}));};
    try {
      if(req.method!=="POST"||req.url!=="/v1/chat/completions"||req.headers.origin||!/^127\.0\.0\.1:\d+$/.test(req.headers.host??"")) throw error("E_LOCAL_REQUEST");
      if(!safeEqual(req.headers["x-cc-local"],secret))throw error("E_LOCAL_AUTH");
      const token=req.headers["x-cc-capture"];capture=captures.get(token);if(!capture)throw error("E_CAPTURE");
      let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>1024*1024)throw error("E_BODY_LIMIT");chunks.push(chunk);}
      const bytes=Buffer.concat(chunks);const body=JSON.parse(bytes.toString("utf8"));
      if(body.model!=="probe"||!Array.isArray(body.messages))throw error("E_PROFILE");
      if(capture.bodyHash&&capture.bodyHash!==hash(body))throw error("E_RETRY_BODY");capture.bodyHash=hash(body);
      const s=state(capture.session),control=controls();
      const config=hash({...body,messages:body.messages.filter(m=>["system","developer"].includes(m.role))});
      let selected=body;
      if(capture.kind==="primary") {
        const roots=rootsFor(body,capture.messages);
        if(s.resetPending)throw error("E_NATIVE_PENDING");
        if(s.job?.ready&&!s.job.terminal){
          const job=s.job;
          if(job.epoch!==s.epoch||job.config!==config){job.terminal=true;emit("proposal-stale",{session:capture.session,job:job.id});}
          else {
            const r={id:job.id,ids:job.ids,sourceHash:job.sourceHash,summary:job.ready};
            const next=[...s.view.filter(v=>!v.ids.some(id=>r.ids.includes(id))),r];
            apply(roots,next);s.view=next;job.terminal=true;save();
            emit("view-applied",{session:capture.session,job:job.id,ids:r.ids});
          }
        }
        selected={...body,messages:apply(roots,s.view)};
        emit("sealed",{session:capture.session,request_kind:capture.kind,rawHash:hash(body),effectiveHash:hash(selected),rootIds:roots.map(x=>x.id)});
        if(control.session===capture.session&&control.run&&!s.seen.has(control.run)&&(!s.job||(s.job.terminal&&s.job.localStopped))) {
          void auxiliary(s,capture,selected,roots,config,control).catch(e=>emit("aux-setup-failed",{code:e.code??e.name}));
        }
      } else emit("other-request",{session:capture.session,request_kind:capture.kind});
      // Fresh header allowlist: correlation/local auth NEVER leaves the listener.
      const result=await fetch(upstream,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(selected),redirect:"error"});
      if(capture.kind==="compaction"&&!result.ok) {
        s.resetPending=false;save();emit("native-failed",{session:capture.session,status:result.status,epoch:s.epoch,preserved_replacements:s.view.length});
      }
      res.writeHead(result.status,{"content-type":result.headers.get("content-type")??"application/json"});
      for await(const chunk of result.body??[]){if(res.destroyed)break;res.write(chunk);}res.end();
    } catch(e){emit("request-rejected",{session:capture?.session??null,code:e.code??e.name});if(!res.headersSent)reply(400,e.code??"E_REQUEST");else res.destroy();}
  });
  server.requestTimeout=30000;
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(port,"127.0.0.1",resolve);});
  emit("loaded",{profile:"OC-V1-HTTP-LOCAL",probe:true});
  return {
    "experimental.chat.messages.transform":async(_input,output)=>{
      const ids=[...new Set(output.messages.map(x=>x.info.sessionID))];if(ids.length!==1)throw error("E_SCOPE");
      const capture={session:ids[0],messages:structuredClone(output.messages),kind:"primary"};pending.set(ids[0],capture);emit("capture",{session:ids[0],messageIds:output.messages.map(x=>x.info.id)});
    },
    "chat.headers":async(input,output)=>{
      const c=pending.get(input.sessionID);
      const primary=!["compaction","title","summary"].includes(input.agent);
      const capture=primary&&c?c:{session:input.sessionID,kind:input.agent,messages:[]};
      const token=randomUUID();captures.set(token,capture);
      output.headers["x-cc-capture"]=token;output.headers["x-cc-local"]=secret;
      emit("correlated",{session:input.sessionID,request_kind:capture.kind});
    },
    "chat.message":async input=>{cancel(input.sessionID,"user-input");},
    "experimental.session.compacting":async (input,output)=>{
      cancel(input.sessionID,"native-compaction");state(input.sessionID).resetPending=true;save();
      output.context.push(`CC_NATIVE_RESET::${input.sessionID}`);
      emit("native-start",{session:input.sessionID});
    },
    event:async({event})=>{
      if(event.type==="session.compacted") {
        const id=event.properties?.sessionID,s=state(id);
        s.view=[];s.epoch++;s.resetPending=false;save();emit("native-ended",{session:id,epoch:s.epoch});
      }
    },
    tool:{cc_probe:{description:"Synthetic counter for an isolated conformance fixture.",args:{},execute:async(_args,context)=>{emit("tool-effect",{session:context.sessionID});await new Promise(r=>setTimeout(r,250));return "CC_TOOL_RESULT: local-test-only";}}},
    dispose:async()=>{closing=true;for(const id of sessions.keys())cancel(id,"dispose");server.closeAllConnections();await new Promise(resolve=>server.close(resolve));emit("disposed",{});}
  };
}
