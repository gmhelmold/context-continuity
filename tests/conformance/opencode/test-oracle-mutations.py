#!/usr/bin/env python3
"""Real stock-host mutation tests of the oracle, in disposable synthetic copies.
A killed mutation is NOT product conformance. The original tree is never edited.
"""
from __future__ import annotations
import argparse,hashlib,json,shutil,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
TARGET='tests/conformance/opencode/gateway-plugin.mjs'
STATEMENT='selected={...body,messages:apply(roots,s.view)};'
MUTATIONS={
 'content': 'selected.messages=selected.messages.map(m=>m.role==="tool"?{...m,content:"CC_REVIEW_CORRUPTED_TAIL"}:m);',
 'remove': 'const ix=selected.messages.findIndex(m=>m.role==="tool");if(ix>=0)selected.messages.splice(ix,1);',
 'duplicate': 'const ix=selected.messages.findIndex(m=>m.role==="tool");if(ix>=0)selected.messages.splice(ix,0,structuredClone(selected.messages[ix]));',
 'swap': 'const xs=selected.messages.map((m,i)=>m.role==="tool"?i:-1).filter(i=>i>=0);if(xs.length>1)[selected.messages[xs[0]],selected.messages[xs[1]]]=[selected.messages[xs[1]],selected.messages[xs[0]]];',
 'metadata': 'selected.messages=selected.messages.map(m=>m.role==="tool"?{...m,name:"unexpected_mutation"}:m);',
 'protected': 'selected.messages=selected.messages.map(m=>m.role==="system"?{...m,content:m.content+" CORRUPTED_PROTECTED"}:m);'
}
PRE_ANCHOR='if(body.model!=="probe"||!Array.isArray(body.messages))throw error("E_PROFILE");'
PRE_MUTATIONS={
 'pre-ingress-system': 'body.messages=body.messages.map(m=>m.role==="system"?{...m,content:m.content+" REVIEW004_CHANGED_SYSTEM"}:m);',
 'pre-ingress-metadata': 'body.review_mutation="unexpected-pre-ingress-field";',
}
CHECK='native-load-tool-loop-concurrent-pruning-and-prefix'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--binary',required=True,type=Path);parser.add_argument('--out',required=True,type=Path);args=parser.parse_args()
 out=args.out.resolve();out.mkdir(parents=True,exist_ok=False);rows=[]
 for name,mutation in [('control',None),*MUTATIONS.items(),*PRE_MUTATIONS.items()]:
  with tempfile.TemporaryDirectory(prefix='cc-oracle-mutation-') as folder:
   copy=Path(folder)/'repo';shutil.copytree(ROOT,copy,ignore=shutil.ignore_patterns('.git','__pycache__','node_modules'))
   path=copy/TARGET;text=path.read_text();anchor=PRE_ANCHOR if name in PRE_MUTATIONS else STATEMENT
   assert text.count(anchor)==1,'Mutation insertion point changed'
   if mutation:path.write_text(text.replace(anchor,anchor+'\n        '+mutation,1))
   run=Path(folder)/'run'
   result=subprocess.run([sys.executable,str(copy/'tests/conformance/opencode/run.py'),'--binary',str(args.binary.resolve()),'--out',str(run),'--only',CHECK],capture_output=True,text=True,timeout=260)
   report=json.loads((run/'report.json').read_text()) if (run/'report.json').exists() else {}
   checks=report.get('checks',[]);matches=[c for c in checks if c['check']==CHECK]
   assert len(matches)==1, f'{name}: setup failure is not a killed mutation: {result.stdout[-2000:]}'
   observed=matches[0]
   if mutation:
    assert result.returncode!=0 and observed['result']=='fail' and 'E_ORACLE_' in observed.get('error',''), f'{name}: mutation survived or failed for the wrong reason: {observed}'
    if name in PRE_MUTATIONS:assert 'E_ORACLE_WITNESS_PAYLOAD' in observed.get('error',''),f'{name}: external ingress witness must reject the change'
   else:assert result.returncode==0 and observed['result']=='pass',f'Broken unmutated control: {observed}'
   row={'mutation':name,'result':'rejected_by_oracle' if mutation else 'pass','exit_code':result.returncode,'error':observed.get('error'),'mutated_file_sha256':sha(path),'host_binary_sha256':sha(args.binary),'live_inference':False}
   rows.append(row);print('PASS',name,row['result'],row['error'] or '',flush=True)
   (out/'report.json').write_text(json.dumps({'probe_only':True,'control_and_mutations':rows,'complete_enabled':False},indent=2)+'\n')
 print(f'PASS: control + {len(MUTATIONS)+len(PRE_MUTATIONS)} incorrect implementations distinguished by stock-host oracle.')
 return 0
if __name__=='__main__':raise SystemExit(main())
