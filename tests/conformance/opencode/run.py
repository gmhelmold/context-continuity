#!/usr/bin/env python3
"""WP-00 executable integration probe. No real model, credentials, or user workspace.

Runs an unmodified OpenCode binary using public plugin/provider/server interfaces.
This probe is deliberately separate from the future product implementation.
"""
from __future__ import annotations
import traceback
import argparse,base64,concurrent.futures,hashlib,json,os,secrets,socket,subprocess,threading,time
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from oracle import exact_retained, native_tools, protocol

HERE=Path(__file__).resolve().parent
HOST_VERSION="1.18.31"
def digest(data:bytes)->str:return hashlib.sha256(data).hexdigest()
def write_json(path:Path,value:object)->None:
 tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(value,indent=2,ensure_ascii=False)+'\n');tmp.replace(path)
def free_port()->int:
 with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]

class Recorder(ThreadingHTTPServer):
 daemon_threads=True
 def __init__(self):
  super().__init__(('127.0.0.1',0),ResponseHandler)
  self.records=[];self.lock=threading.Lock();self.stages={};self.aux_counts={};self.releases={};self.native_fault_sessions=set();self.transport_disconnects=0
 def record(self,path,headers,body):
  with self.lock:
   # auth values/capture tokens never enter retained artifacts
   row={'path':path,'at':time.monotonic(),'header_names':sorted(k.lower() for k in headers),'body':body}
   self.records.append(row)
  return row

class ResponseHandler(BaseHTTPRequestHandler):
 protocol_version="HTTP/1.1"
 def handle(self):
  try:super().handle()
  except (ConnectionResetError,BrokenPipeError):
   # Deliberate cancellation/crash closes keep-alive connections. Count only
   # transport disconnects here; all other exceptions remain visible failures.
   with self.server.lock:self.server.transport_disconnects+=1
 def log_message(self,*_):pass
 def do_POST(self):
  size=int(self.headers.get('Content-Length','0'))
  if size>1024*1024:self.send_error(413);return
  body=json.loads(self.rfile.read(size));row=self.server.record(self.path,self.headers,body)
  messages=body.get('messages',[])
  texts=[m.get('content','') for m in messages if m.get('role')=='user']
  def flatten(v):return v if isinstance(v,str) else '\n'.join(x.get('text','') for x in v if isinstance(x,dict))
  texts=list(map(flatten,texts));last=texts[-1] if texts else ''
  auxiliary=last.startswith('CC_AUXILIARY::')
  if any('CC_NATIVE_RESET::'+sid in last for sid in self.server.native_fault_sessions):
   row['native_failure']=True
   raw=json.dumps({'error':{'message':'controlled native compaction failure','type':'invalid_request_error'}}).encode()
   self.send_response(400);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw);return
  content='CC_FINAL: synthetic response';reason='stop';calls=None
  if auxiliary:
   _,scenario,rest=last.split('::',2);run=rest.split('.',1)[0]
   with self.server.lock:
    n=self.server.aux_counts.get(run,0)+1;self.server.aux_counts[run]=n
    release=self.server.releases.setdefault(run,threading.Event())
   if scenario in ('happy','stale'):release.wait(5)
   if scenario=='cancel':release.wait(3)
   if scenario in ('rate','server-error') and n<=2:
    raw=json.dumps({'error':{'message':'synthetic rate limit','type':'rate_limit'}}).encode()
    self.send_response(503 if scenario=='server-error' else 429);self.send_header('Content-Type','application/json');self.send_header('Retry-After','0');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw);return
   if scenario=='tool':
    reason='tool_calls';calls=[{'id':'aux_forbidden','type':'function','function':{'name':'cc_probe','arguments':'{}'}}];content=None
   elif scenario=='repair' and n==1:content='deliberately invalid fixture JSON'
   elif scenario=='empty':content=json.dumps({'summary':''})
   else:content=json.dumps({'summary':'CC_SUMMARY::'+run+': completed history; retain protocol v1.'})
  else:
   markers=[t for t in texts if t.startswith('RUN::')]
   if markers:
    _,tag,scenario=markers[-1].split('::',2)
    with self.server.lock:
     stage=self.server.stages.get(tag,0)+1;self.server.stages[tag]=stage
     if stage>=2:
      for event in self.server.releases.values():event.set()
    if stage<=3 and scenario not in ('cancel','native'):
     reason='tool_calls';calls=[{'id':f'call_{tag}_{stage}','type':'function','function':{'name':'cc_probe','arguments':'{}'}}];content=None
  row['auxiliary']=auxiliary;row['response_finish']=reason
  try:
   if body.get('stream'):
    delta={'role':'assistant'}
    if content is not None:delta['content']=content
    if calls:delta['tool_calls']=[dict(c,index=i) for i,c in enumerate(calls)]
    frames=[{'id':'chatcmpl-fixture','object':'chat.completion.chunk','created':1,'model':'probe','choices':[{'index':0,'delta':delta,'finish_reason':None}]},{'id':'chatcmpl-fixture','object':'chat.completion.chunk','created':1,'model':'probe','choices':[{'index':0,'delta':{},'finish_reason':reason}],'usage':{'prompt_tokens':100,'completion_tokens':10,'total_tokens':110}}]
    raw=(''.join('data: '+json.dumps(x)+'\n\n' for x in frames)+'data: [DONE]\n\n').encode()
    self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Content-Length',str(len(raw)));self.end_headers()
    # Real streaming transport, fragmented independently of SSE event boundaries.
    for at in range(0,len(raw),37):self.wfile.write(raw[at:at+37]);self.wfile.flush()
   else:
    msg={'role':'assistant','content':content}
    if calls:msg['tool_calls']=calls
    raw=json.dumps({'id':'chatcmpl-fixture','object':'chat.completion','created':1,'model':'probe','choices':[{'index':0,'message':msg,'finish_reason':reason}],'usage':{'prompt_tokens':100,'completion_tokens':10,'total_tokens':110}}).encode()
    self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
  except (BrokenPipeError,ConnectionResetError):row['connection_closed']=True

class Probe:
 def __init__(self,binary:Path,root:Path):
  self.only=None;self.binary=binary;self.binary_hash=digest(binary.read_bytes());self.root=root;root.mkdir(parents=True,exist_ok=False)
  self.workspace=root/'workspace';self.workspace.mkdir();self.home=root/'home';self.home.mkdir()
  self.recorder=Recorder();threading.Thread(target=self.recorder.serve_forever,daemon=True).start()
  self.port=free_port();self.gateway=free_port();self.secret=secrets.token_hex(24);self.password=secrets.token_hex(24)
  self.control=root/'control.json';write_json(self.control,{})
  self.trace=root/'hooks.jsonl';self.checkpoint=root/'probe-checkpoint.json';self.created_sessions=[];self.results=[];self.process=None;self.log=None
  self.config={'$schema':'https://opencode.ai/config.json','model':'cc-fixture/probe','small_model':'cc-fixture/probe','enabled_providers':['cc-fixture'],'share':'disabled','autoupdate':False,'compaction':{'auto':True,'prune':False},'permission':{'*':'deny','cc_probe':'allow'},'plugin':[(HERE/'gateway-plugin.mjs').as_uri(),(HERE/'later-plugin.mjs').as_uri()],'provider':{'cc-fixture':{'npm':'@ai-sdk/openai-compatible','name':'CC OFFLINE FIXTURE','options':{'baseURL':f'http://127.0.0.1:{self.gateway}/v1','apiKey':'synthetic-not-a-real-key'},'models':{'probe':{'name':'Probe','limit':{'context':100000,'output':4096},'tool_call':True}}}}}
  write_json(self.workspace/'opencode.json',self.config)
  self.env={'PATH':os.environ['PATH'],'HOME':str(self.home),'TMPDIR':str(root),'XDG_DATA_HOME':str(root/'data'),'XDG_CONFIG_HOME':str(root/'config'),'XDG_CACHE_HOME':str(root/'cache'),'XDG_STATE_HOME':str(root/'state'),'CC_TRACE':str(self.trace),'CC_CHECKPOINT':str(self.checkpoint),'CC_CONTROL':str(self.control),'CC_GATEWAY_PORT':str(self.gateway),'CC_FIXTURE_UPSTREAM':f'http://127.0.0.1:{self.recorder.server_port}/v1/chat/completions','CC_LOCAL_SECRET':self.secret,'OPENCODE_SERVER_PASSWORD':self.password,'OPENCODE_DISABLE_AUTOUPDATE':'true','OPENCODE_DISABLE_DEFAULT_PLUGINS':'true','OPENCODE_DISABLE_LSP_DOWNLOAD':'true','OPENCODE_DISABLE_MODELS_FETCH':'true','NO_PROXY':'127.0.0.1,localhost'}
 def call(self,path,body=None,method=None,timeout=60):
  headers={'Content-Type':'application/json','Authorization':'Basic '+base64.b64encode(('opencode:'+self.password).encode()).decode()}
  req=Request(f'http://127.0.0.1:{self.port}'+path,data=None if body is None else json.dumps(body).encode(),headers=headers,method=method)
  try:
   with urlopen(req,timeout=timeout) as r:
    data=r.read();return json.loads(data) if data else None
  except HTTPError as e:raise RuntimeError(f'host HTTP {e.code}: {e.read()[:500]!r}') from e
 def start(self):
  self.log=(self.root/'host.log').open('a')
  self.process=subprocess.Popen([str(self.binary),'serve','--hostname','127.0.0.1','--port',str(self.port),'--print-logs'],cwd=self.workspace,env=self.env,stdout=self.log,stderr=subprocess.STDOUT)
  for _ in range(160):
   if self.process.poll() is not None:raise RuntimeError('host exited')
   try:self.call('/global/health');return
   except Exception:time.sleep(.25)
  raise RuntimeError('startup timeout')
 def stop(self):
  if self.process and self.process.poll() is None:
   self.process.terminate()
   try:self.process.wait(timeout=10)
   except subprocess.TimeoutExpired:self.process.kill();self.process.wait()
  if self.log:self.log.close()
 def close(self):self.stop();self.recorder.shutdown();self.recorder.server_close()
 def events(self):
  if not self.trace.exists():return []
  lines=self.trace.read_text().splitlines();return [json.loads(line) for line in lines if line]
 def wait_event(self,kind,session,timeout=10):
  until=time.monotonic()+timeout
  while time.monotonic()<until:
   rows=[e for e in self.events() if e['kind']==kind and e.get('session')==session]
   if rows:return rows[-1]
   time.sleep(.025)
  raise AssertionError(f'no {kind} for {session}')
 def prompt(self,session,text):
  reply=self.call('/session/'+session+'/message',{'model':{'providerID':'cc-fixture','modelID':'probe'},'parts':[{'type':'text','text':text}]})
  if reply.get('info',{}).get('error'):raise AssertionError(json.dumps(reply['info']['error']))
  return reply
 def session(self,tag):
  s=self.call('/session',{'title':'CC synthetic '+tag})['id'];self.created_sessions.append(s);self.prompt(s,'SEED::'+tag);return s
 def check(self,name,fn):
  if self.only and name not in self.only:return
  before=len(self.recorder.records)
  try:
   data=fn() or {};self.results.append({'check':name,'result':'pass','evidence':data,'requests':len(self.recorder.records)-before});print('PASS',name,flush=True)
  except Exception as e:
   location=traceback.extract_tb(e.__traceback__)[-1];e=AssertionError(f'{type(e).__name__}: {e}; line {location.lineno}: {location.line}')
   self.results.append({'check':name,'result':'fail','error':str(e),'requests':len(self.recorder.records)-before});print('FAIL',name,str(e),flush=True)
 def run(self):
  self.start()
  version=subprocess.check_output([str(self.binary),'--version'],env=self.env,text=True).strip();assert version==HOST_VERSION,version
  print('BOOTSTRAP isolated host workspace',flush=True)
  initial_sessions=self.call('/session',timeout=180)
  def happy():
   s=self.session('happy');write_json(self.control,{'session':s,'run':'happy1','scenario':'happy'})
   self.prompt(s,'RUN::happy::happy')
   event=self.wait_event('view-applied',s)
   starts=[e for e in self.events() if e['kind']=='aux-start' and e['session']==s];assert len(starts)==1
   assert starts[0]['parentHash']==starts[0]['clonePrefixHash']
   records=[r for r in self.recorder.records if not r.get('auxiliary') and 'RUN::happy::happy' in json.dumps(r['body'])]
   assert len(records)==4,len(records)
   aux=[r for r in self.recorder.records if r.get('auxiliary') and 'CC_AUXILIARY::happy::happy1' in json.dumps(r['body'])]
   assert len(aux)==1
   recorded_prefix=dict(aux[0]['body']);recorded_prefix['messages']=recorded_prefix['messages'][:-1]
   assert recorded_prefix==records[0]['body'],'independent recorder detected a changed fork prefix'
   final=records[-1]['body'];joined=json.dumps(final)
   assert 'CC_SUMMARY' in joined and 'SEED::happy' not in joined, 'E_ORACLE_COVERAGE'
   assert len([m for m in final['messages'] if m['role']=='tool'])==3, 'E_ORACLE_CARDINALITY'
   ready=self.wait_event('aux-ready',s)
   effects=[e for e in self.events() if e['kind']=='tool-effect' and e['session']==s];assert len(effects)==3
   assert effects[0]['at']<ready['at'],'parent did not progress before clone was ready'
   transcript=self.call('/session/'+s+'/message');native_tools(transcript,final['messages'])
   raw=[e['body'] for e in self.events() if e['kind']=='ingress' and e.get('session')==s and e['request_kind']=='primary' and 'RUN::happy::happy' in json.dumps(e['body'])][-1]
   exact_retained(raw,final,'RUN::happy::happy','CC_SUMMARY::happy1: completed history; retain protocol v1.')
   assert 'SEED::happy' in json.dumps(transcript) and 'CC_SUMMARY' not in json.dumps(transcript)
   assert all('x-cc-local' not in r['header_names'] and 'x-cc-capture' not in r['header_names'] for r in self.recorder.records)
   return {'session':s,'primary_requests':4,'tool_effects':3,'prefix_equal':True,'native_transcript_preserved':True,'covered_native_ids':event['ids']}
  self.check('native-load-tool-loop-concurrent-pruning-and-prefix',happy)
  def rejected_aux(scenario):
   s=self.session(scenario);write_json(self.control,{'session':s,'run':scenario+'1','scenario':scenario})
   self.prompt(s,f'RUN::{scenario}::{scenario}')
   ev=self.wait_event('aux-failed' if scenario!='repair' else 'aux-ready',s)
   counts=self.recorder.aux_counts[scenario+'1'];assert counts==(2 if scenario in ('rate','server-error','repair') else 1),counts
   if scenario=='tool':assert ev['code']=='E_TOOL';assert len([e for e in self.events() if e['kind']=='tool-effect' and e['session']==s])==3
   if scenario in ('rate','server-error'):assert ev['code']=='E_RATE'
   return {'session':s,'physical_auxiliary_requests':counts,'result':ev.get('code','ready')}
  for scenario in ('tool','rate','server-error','repair'):self.check('auxiliary-'+scenario,lambda scenario=scenario:rejected_aux(scenario))
  def stale():
   s=self.session('stale');write_json(self.control,{'session':s,'run':'stale1','scenario':'stale','policy':0})
   with concurrent.futures.ThreadPoolExecutor() as pool:
    future=pool.submit(self.prompt,s,'RUN::stale::stale');self.wait_event('aux-start',s)
    write_json(self.control,{'session':s,'run':'stale1','scenario':'stale','policy':1});future.result()
   self.wait_event('proposal-stale',s)
   outputs=[r for r in self.recorder.records if not r.get('auxiliary') and 'RUN::stale::stale' in json.dumps(r['body'])]
   assert all('CC_SUMMARY' not in json.dumps(r['body']) for r in outputs)
   assert any('CC_POLICY=1' in json.dumps(r['body']) for r in outputs)
   return {'session':s,'stale_proposal_sent':False,'later_plugin_change_observed':True}
  self.check('same-turn-later-plugin-invalidates-ready',stale)
  def isolation():
   write_json(self.control,{})
   with concurrent.futures.ThreadPoolExecutor() as pool:ids=list(pool.map(self.session,['scope-A','scope-B']))
   for row in self.recorder.records:
    value=json.dumps(row['body']);assert not ('SEED::scope-A' in value and 'SEED::scope-B' in value)
   return {'sessions':ids,'crossed':False}
  self.check('two-real-sessions-isolated',isolation)
  def admission():
   count=len(self.recorder.records)
   req=Request(f'http://127.0.0.1:{self.gateway}/v1/chat/completions',data=b'{}',headers={'Content-Type':'application/json'})
   try:urlopen(req,timeout=2);raise AssertionError('unauthorized local fixture forwarded')
   except HTTPError as e:assert e.code==400
   assert len(self.recorder.records)==count
   return {'forwarded':False}
  self.check('unregistered-local-request-refused',admission)
  def native():
   s=self.session('native');write_json(self.control,{'session':s,'run':'native1','scenario':'native'})
   self.prompt(s,'RUN::native::native');self.wait_event('aux-ready',s)
   self.call('/session/'+s+'/summarize',{'providerID':'cc-fixture','modelID':'probe','auto':False})
   self.wait_event('native-start',s);self.wait_event('native-ended',s)
   write_json(self.control,{})
   self.prompt(s,'AFTER_NATIVE');return {'session':s,'native_reset_seen':True}
  self.check('native-compaction-public-route',native)
  def cancellation():
   s=self.session('cancel');write_json(self.control,{'session':s,'run':'cancel1','scenario':'cancel'})
   self.prompt(s,'RUN::cancel::cancel');self.wait_event('aux-start',s)
   write_json(self.control,{})
   self.prompt(s,'CANCEL_BY_NEW_USER_INPUT')
   event=self.wait_event('aux-cancelled',s);self.wait_event('aux-local-stopped',s)
   assert event['remote_state']=='unknown'
   assert not [e for e in self.events() if e['kind']=='view-applied' and e['session']==s]
   return {'session':s,'local_stop_observed':True,'remote_state':'unknown','late_publish':False}
  self.check('real-auxiliary-cancellation-no-late-publication',cancellation)
  def repeated_consolidation():
   sid=self.session('chain');prior=None;rounds=[];covered_count=0
   for index in range(4):
    if index==3:
     write_json(self.control,{})
     self.stop();self.start()
     start=len(self.recorder.records)
     self.prompt(sid,'AFTER_RESTART::chain')
     restored=self.wait_event('checkpoint-restored',sid)
     assert restored['replacements']==1
     resumed=[r for r in self.recorder.records[start:] if not r.get('auxiliary')]
     assert len(resumed)==1
     value=json.dumps(resumed[0]['body'])
     assert prior in value and 'SEED::chain' not in value
    run=f'chain{index}';marker=f'RUN::chain-{index}::happy'
    before=self.call('/session/'+sid+'/message')
    write_json(self.control,{'session':sid,'run':run,'scenario':'happy','consolidate':True})
    begin=len(self.recorder.records)
    self.prompt(sid,marker)
    records=self.recorder.records[begin:]
    primary=[r for r in records if not r.get('auxiliary') and marker in json.dumps(r['body'])]
    auxiliary=[r for r in records if r.get('auxiliary') and '::'+run+'.' in json.dumps(r['body'])]
    assert len(primary)==4 and len(auxiliary)==1,(len(primary),len(auxiliary))
    prefix=dict(auxiliary[0]['body']);prefix['messages']=prefix['messages'][:-1]
    assert prefix==primary[0]['body'],'fork did not inherit the projected view'
    if prior:assert prior in json.dumps(prefix) and 'SEED::chain' not in json.dumps(prefix)
    newest='CC_SUMMARY::'+run+': completed history; retain protocol v1.'
    final_body=primary[-1]['body'];final=final_body['messages']
    raw=[e['body'] for e in self.events() if e['kind']=='ingress' and e.get('session')==sid and e['request_kind']=='primary' and marker in json.dumps(e['body'])][-1]
    exact_retained(raw,final_body,marker,newest)
    native_tools(self.call('/session/'+sid+'/message'),final)
    user_index=next(i for i,m in enumerate(final) if m.get('content')==marker)
    assert final[user_index-1]=={'role':'assistant','content':newest}
    assert all(m['role'] in ('system','developer') for m in final[:user_index-1])
    assert len([m for m in final if m['role']=='tool'])==3
    assert 'SEED::chain' not in json.dumps(final)
    if prior:assert prior not in json.dumps(final)
    current=self.wait_event('view-applied',sid)
    expected_ids=[m['info']['id'] for m in before if m['parts'] and not m['info'].get('error')]
    assert current['ids']==expected_ids,'coverage must flatten to the original native IDs'
    assert len(current['ids'])>covered_count
    plan=next(x for x in json.loads(self.checkpoint.read_text())['sessions'] if x['id']==sid)
    assert len(plan['view'])==1 and plan['view'][0]['ids']==expected_ids
    assert all(not ident.startswith('summary:') for ident in expected_ids)
    covered_count=len(expected_ids);prior=newest;rounds.append({'round':index+1,'covered_native_roots':covered_count,'prefix_equal':True})
   transcript=self.call('/session/'+sid+'/message')
   assert 'SEED::chain' in json.dumps(transcript) and 'CC_SUMMARY' not in json.dumps(transcript)
   return {'session':sid,'rounds':rounds,'restart_after_round':3,'native_history_preserved':True,'active_replacements':1}
  self.check('repeated-consolidation-flattened-and-restart',repeated_consolidation)
  def failed_native_reset():
   sid=self.session('native-failure');write_json(self.control,{'session':sid,'run':'native-failure1','scenario':'happy'})
   self.prompt(sid,'RUN::native-failure::happy');self.wait_event('view-applied',sid)
   row=lambda:next(x for x in json.loads(self.checkpoint.read_text())['sessions'] if x['id']==sid)
   old=row();assert len(old['view'])==1
   self.recorder.native_fault_sessions.add(sid)
   self.call('/session/'+sid+'/summarize',{'providerID':'cc-fixture','modelID':'probe','auto':False})
   failure=self.wait_event('native-failed',sid)
   assert failure['status']==400 and failure['preserved_replacements']==1
   assert row()['epoch']==old['epoch'] and row()['view']==old['view']
   assert not [e for e in self.events() if e['kind']=='native-ended' and e.get('session')==sid]
   history=self.call('/session/'+sid+'/message')
   assert any(m['info'].get('summary') and m['info'].get('error') for m in history),'host did not record the failed compaction'
   write_json(self.control,{})
   # This host retries the unfinished native compaction on continuation.
   # Prove preservation across failure/restart before allowing that retry to succeed.
   self.stop();self.start()
   self.call('/session/'+sid+'/message')
   recovery=self.wait_event('checkpoint-restored',sid)
   assert recovery['epoch']==old['epoch'] and recovery['replacements']==1
   assert row()['view']==old['view']
   self.recorder.native_fault_sessions.remove(sid)
   begin=len(self.recorder.records);self.prompt(sid,'AFTER_FAILED_NATIVE_RESET')
   self.wait_event('native-ended',sid)
   assert row()['epoch']==old['epoch'], 'event alone must not advance the unobserved base'
   self.prompt(sid,'AFTER_SUCCESSFUL_NATIVE_RESET')
   assert row()['epoch']==old['epoch']+1 and row()['view']==[]
   after=[r for r in self.recorder.records[begin:] if not r.get('auxiliary')]
   assert after and 'AFTER_SUCCESSFUL_NATIVE_RESET' in json.dumps(after[-1]['body'])
   assert len([e for e in self.events() if e['kind']=='native-ended' and e.get('session')==sid])==1
   return {'session':sid,'failed_reset_preserves_view':True,'preserved_across_restart':True,'epoch_advances_only_on_success':True,'host_retries_pending_reset':True}
  self.check('failed-native-reset-preserves-published-view',failed_native_reset)
  def crash_auxiliary():
   sid=self.session('crash');write_json(self.control,{'session':sid,'run':'crash1','scenario':'cancel'})
   self.prompt(sid,'RUN::crash::cancel');event=self.wait_event('aux-start',sid)
   saved=next(x for x in json.loads(self.checkpoint.read_text())['sessions'] if x['id']==sid)
   assert saved['pending_job']==event['job']
   # Kill only this fixture's child, not an installed/user OpenCode process.
   self.process.kill();self.process.wait(timeout=10)
   if self.log:self.log.close()
   self.start();self.prompt(sid,'AFTER_CRASH_NO_REPLAY')
   recovery=self.wait_event('checkpoint-restored',sid)
   assert recovery['orphaned_job']==event['job']
   assert self.recorder.aux_counts['crash1']==1
   assert not [e for e in self.events() if e['kind']=='view-applied' and e.get('session')==sid]
   return {'session':sid,'orphaned_job_recorded':True,'auxiliary_requests':1,'replayed':False,'late_published':False}
  self.check('process-crash-does-not-replay-auxiliary',crash_auxiliary)
  def published_change():
   sid=self.session('published-policy');write_json(self.control,{'session':sid,'run':'published1','scenario':'happy','policy':0})
   self.prompt(sid,'RUN::published-policy::happy');self.wait_event('view-applied',sid)
   write_json(self.control,{'policy':1})
   start=len(self.recorder.records);self.prompt(sid,'AFTER_PUBLISHED_POLICY_CHANGE')
   self.wait_event('published-view-invalidated',sid)
   body=[x['body'] for x in self.recorder.records[start:] if not x.get('auxiliary')][-1]
   assert 'CC_POLICY=1' in json.dumps(body) and 'CC_SUMMARY' not in json.dumps(body)
   assert 'SEED::published-policy' in json.dumps(body)
   raw=[e['body'] for e in self.events() if e['kind']=='ingress' and e.get('session')==sid and 'AFTER_PUBLISHED_POLICY_CHANGE' in json.dumps(e['body'])][-1]
   assert body==raw, 'E_ORACLE_RETAINED_PAYLOAD'
   return {'invalidated_published':True,'raw_preserved':True}
  self.check('published-policy-change-invalidates-derived-view',published_change)
  def empty_recovery():
   sid=self.session('empty');write_json(self.control,{'session':sid,'run':'empty1','scenario':'empty'})
   with concurrent.futures.ThreadPoolExecutor() as pool:
    future=pool.submit(self.prompt,sid,'RUN::empty-recovery::happy')
    failure=self.wait_event('aux-failed',sid);assert failure['code']=='E_NO_GAIN'
    write_json(self.control,{'session':sid,'run':'empty2','scenario':'happy'})
    future.result()
   self.wait_event('view-applied',sid)
   assert self.recorder.aux_counts['empty1']==1 and self.recorder.aux_counts['empty2']==1
   return {'empty_terminal':True,'next_job_without_user_input':True}
  self.check('empty-summary-terminates-and-rearms-without-user',empty_recovery)
  def handoff():
   # Small raw history fits: prove route restoration without writing host internals.
   write_json(self.control,{})
   self.stop();self.config['plugin']=[];self.config['provider']['cc-fixture']['options']['baseURL']=f'http://127.0.0.1:{self.recorder.server_port}/v1'
   write_json(self.workspace/'opencode.json',self.config);self.start();s=self.session('after-removal')
   original=self.results[0].get('evidence',{}).get('session')
   if original:self.prompt(original,'AFTER_PLUGIN_REMOVAL')
   records=[r for r in self.recorder.records if 'SEED::after-removal' in json.dumps(r['body'])]
   assert records and all('x-cc-capture' not in r['header_names'] for r in records)
   return {'new_session':s,'direct_route_works':True,'no_host_database_edits':True}
  self.check('route-restoration-and-plugin-removal',handoff)
  final_sessions=self.call('/session')
  assert len(final_sessions)==len(initial_sessions)+len(self.created_sessions),'unexpected auxiliary host session'
  assert digest(self.binary.read_bytes())==self.binary_hash,'host binary changed'
  return {'schema_version':1,'probe_only':True,'host_version':version,'host_binary_sha256':digest(self.binary.read_bytes()),'platform':os.uname().sysname+'-'+os.uname().machine,'product_base':'8f844ed5798146c9626653627d67916df0737583','checks':self.results,'gate_status':'in_progress','initial_host_sessions':len(initial_sessions),'final_host_sessions':len(final_sessions),'physical_requests':len(self.recorder.records),'physical_auxiliary_requests':sum(self.recorder.aux_counts.values()),'transport_disconnects':self.recorder.transport_disconnects,'probe_sources':{str(p.relative_to(HERE.parents[2])):digest(p.read_bytes()) for p in sorted(HERE.glob('*.mjs'))+sorted(HERE.glob('*.py'))+[HERE.parents[2]/'scripts/canonical-json.mjs']},'live_inference':False,'product_complete_enabled':False}

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--binary',required=True,type=Path);parser.add_argument('--out',required=True,type=Path);parser.add_argument('--only',help='Comma-separated probe checks, for controlled mutation tests');args=parser.parse_args()
 root=args.out.resolve();probe=Probe(args.binary.resolve(),root);probe.only=set(args.only.split(',')) if args.only else None
 try:
  try:report=probe.run()
  except Exception as exc:
   report={'schema_version':1,'probe_only':True,'gate_status':'in_progress','live_inference':False,'product_complete_enabled':False,'checks':[*probe.results,{'check':'fixture-setup-or-run','result':'fail','error':type(exc).__name__+': '+str(exc)}]}
  write_json(root/'report.json',report)
  # Traces contain exclusively generated fixtures. Local authorization values are excluded.
  write_json(root/'wire-records.json',probe.recorder.records)
  print('RESULT',json.dumps({'pass':sum(x['result']=='pass' for x in report['checks']),'fail':sum(x['result']=='fail' for x in report['checks']),'out':str(root)}),flush=True)
  return int(any(x['result']=='fail' for x in report['checks']))
 finally:probe.close()
if __name__=='__main__':raise SystemExit(main())
