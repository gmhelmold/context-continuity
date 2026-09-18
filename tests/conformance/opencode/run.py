#!/usr/bin/env python3
"""WP-00 executable integration probe. No real model, credentials, or user workspace.

Runs an unmodified OpenCode binary using public plugin/provider/server interfaces.
This probe is deliberately separate from the future product implementation.
"""
from __future__ import annotations
import argparse,base64,concurrent.futures,hashlib,json,os,secrets,socket,subprocess,threading,time
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.request import Request,urlopen
from urllib.error import HTTPError

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
  self.records=[];self.lock=threading.Lock();self.stages={};self.aux_counts={};self.releases={}
 def record(self,path,headers,body):
  with self.lock:
   # auth values/capture tokens never enter retained artifacts
   row={'path':path,'at':time.monotonic(),'header_names':sorted(k.lower() for k in headers),'body':body}
   self.records.append(row)
  return row

class ResponseHandler(BaseHTTPRequestHandler):
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
  content='CC_FINAL: synthetic response';reason='stop';calls=None
  if auxiliary:
   _,scenario,rest=last.split('::',2);run=rest.split('.',1)[0]
   with self.server.lock:
    n=self.server.aux_counts.get(run,0)+1;self.server.aux_counts[run]=n
    release=self.server.releases.setdefault(run,threading.Event())
   if scenario in ('happy','stale'):release.wait(5)
   if scenario=='cancel':release.wait(3)
   if scenario=='rate' and n<=2:
    raw=json.dumps({'error':{'message':'synthetic rate limit','type':'rate_limit'}}).encode()
    self.send_response(429);self.send_header('Content-Type','application/json');self.send_header('Retry-After','0');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw);return
   if scenario=='tool':
    reason='tool_calls';calls=[{'id':'aux_forbidden','type':'function','function':{'name':'cc_probe','arguments':'{}'}}];content=None
   elif scenario=='repair' and n==1:content='deliberately invalid fixture JSON'
   else:content=json.dumps({'summary':'CC_SUMMARY: completed seed; retain protocol v1.'})
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
  self.binary=binary;self.binary_hash=digest(binary.read_bytes());self.root=root;root.mkdir(parents=True,exist_ok=False)
  self.workspace=root/'workspace';self.workspace.mkdir();self.home=root/'home';self.home.mkdir()
  self.recorder=Recorder();threading.Thread(target=self.recorder.serve_forever,daemon=True).start()
  self.port=free_port();self.gateway=free_port();self.secret=secrets.token_hex(24);self.password=secrets.token_hex(24)
  self.control=root/'control.json';write_json(self.control,{})
  self.trace=root/'hooks.jsonl';self.results=[];self.process=None;self.log=None
  self.config={'$schema':'https://opencode.ai/config.json','model':'cc-fixture/probe','small_model':'cc-fixture/probe','enabled_providers':['cc-fixture'],'share':'disabled','autoupdate':False,'compaction':{'auto':True,'prune':False},'permission':{'*':'deny','cc_probe':'allow'},'plugin':[(HERE/'gateway-plugin.mjs').as_uri(),(HERE/'later-plugin.mjs').as_uri()],'provider':{'cc-fixture':{'npm':'@ai-sdk/openai-compatible','name':'CC OFFLINE FIXTURE','options':{'baseURL':f'http://127.0.0.1:{self.gateway}/v1','apiKey':'synthetic-not-a-real-key'},'models':{'probe':{'name':'Probe','limit':{'context':100000,'output':4096},'tool_call':True}}}}}
  write_json(self.workspace/'opencode.json',self.config)
  self.env={'PATH':os.environ['PATH'],'HOME':str(self.home),'TMPDIR':str(root),'XDG_DATA_HOME':str(root/'data'),'XDG_CONFIG_HOME':str(root/'config'),'XDG_CACHE_HOME':str(root/'cache'),'XDG_STATE_HOME':str(root/'state'),'CC_TRACE':str(self.trace),'CC_CONTROL':str(self.control),'CC_GATEWAY_PORT':str(self.gateway),'CC_FIXTURE_UPSTREAM':f'http://127.0.0.1:{self.recorder.server_port}/v1/chat/completions','CC_LOCAL_SECRET':self.secret,'OPENCODE_SERVER_PASSWORD':self.password,'OPENCODE_DISABLE_AUTOUPDATE':'true','OPENCODE_DISABLE_DEFAULT_PLUGINS':'true','OPENCODE_DISABLE_LSP_DOWNLOAD':'true','OPENCODE_DISABLE_MODELS_FETCH':'true','NO_PROXY':'127.0.0.1,localhost'}
 def call(self,path,body=None,method=None):
  headers={'Content-Type':'application/json','Authorization':'Basic '+base64.b64encode(('opencode:'+self.password).encode()).decode()}
  req=Request(f'http://127.0.0.1:{self.port}'+path,data=None if body is None else json.dumps(body).encode(),headers=headers,method=method)
  try:
   with urlopen(req,timeout=60) as r:
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
  s=self.call('/session',{'title':'CC synthetic '+tag})['id'];self.prompt(s,'SEED::'+tag);return s
 def check(self,name,fn):
  before=len(self.recorder.records)
  try:
   data=fn() or {};self.results.append({'check':name,'result':'pass','evidence':data,'requests':len(self.recorder.records)-before});print('PASS',name,flush=True)
  except Exception as e:
   self.results.append({'check':name,'result':'fail','error':str(e),'requests':len(self.recorder.records)-before});print('FAIL',name,str(e),flush=True)
 def run(self):
  self.start()
  version=subprocess.check_output([str(self.binary),'--version'],env=self.env,text=True).strip();assert version==HOST_VERSION,version
  initial_sessions=self.call('/session')
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
   assert 'CC_SUMMARY' in joined and 'SEED::happy' not in joined
   assert len([m for m in final['messages'] if m['role']=='tool'])==3
   ready=self.wait_event('aux-ready',s)
   effects=[e for e in self.events() if e['kind']=='tool-effect' and e['session']==s];assert len(effects)==3
   assert effects[0]['at']<ready['at'],'parent did not progress before clone was ready'
   transcript=self.call('/session/'+s+'/message');assert 'SEED::happy' in json.dumps(transcript) and 'CC_SUMMARY' not in json.dumps(transcript)
   assert all('x-cc-local' not in r['header_names'] and 'x-cc-capture' not in r['header_names'] for r in self.recorder.records)
   return {'session':s,'primary_requests':4,'tool_effects':3,'prefix_equal':True,'native_transcript_preserved':True,'covered_native_ids':event['ids']}
  self.check('native-load-tool-loop-concurrent-pruning-and-prefix',happy)
  def rejected_aux(scenario):
   s=self.session(scenario);write_json(self.control,{'session':s,'run':scenario+'1','scenario':scenario})
   self.prompt(s,f'RUN::{scenario}::{scenario}')
   ev=self.wait_event('aux-failed' if scenario!='repair' else 'aux-ready',s)
   counts=self.recorder.aux_counts[scenario+'1'];assert counts==(2 if scenario in ('rate','repair') else 1),counts
   if scenario=='tool':assert ev['code']=='E_TOOL';assert len([e for e in self.events() if e['kind']=='tool-effect' and e['session']==s])==3
   if scenario=='rate':assert ev['code']=='E_RATE'
   return {'session':s,'physical_auxiliary_requests':counts,'result':ev.get('code','ready')}
  for scenario in ('tool','rate','repair'):self.check('auxiliary-'+scenario,lambda scenario=scenario:rejected_aux(scenario))
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
  assert len(final_sessions)==len(initial_sessions)+10,'unexpected auxiliary host session'
  assert digest(self.binary.read_bytes())==self.binary_hash,'host binary changed'
  return {'schema_version':1,'probe_only':True,'host_version':version,'host_binary_sha256':digest(self.binary.read_bytes()),'platform':os.uname().sysname+'-'+os.uname().machine,'product_base':'81d790abbba236a75b29648487602eade93336ea','checks':self.results,'gate_status':'in_progress','initial_host_sessions':len(initial_sessions),'final_host_sessions':len(final_sessions),'physical_requests':len(self.recorder.records),'physical_auxiliary_requests':sum(self.recorder.aux_counts.values()),'live_inference':False,'product_complete_enabled':False}

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--binary',required=True,type=Path);parser.add_argument('--out',required=True,type=Path);args=parser.parse_args()
 root=args.out.resolve();probe=Probe(args.binary.resolve(),root)
 try:
  report=probe.run();write_json(root/'report.json',report)
  # Traces contain exclusively generated fixtures. Local authorization values are excluded.
  write_json(root/'wire-records.json',probe.recorder.records)
  print('RESULT',json.dumps({'pass':sum(x['result']=='pass' for x in report['checks']),'fail':sum(x['result']=='fail' for x in report['checks']),'out':str(root)}),flush=True)
  return int(any(x['result']=='fail' for x in report['checks']))
 finally:probe.close()
if __name__=='__main__':raise SystemExit(main())
