#!/usr/bin/env python3
"""Mutation tests for the DOCUMENT checker only; no host/runtime tests."""
from __future__ import annotations
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def mutate(root,name):
    spec=root/'specs/v0.1'
    if name in ('wrong_test','wrong_owner'):
        p=spec/'06-acceptance.md';lines=p.read_text().splitlines()
        for i,line in enumerate(lines):
            if line.startswith('| R08 |'):
                cells=line.split('|');cells[5]=' T01.host ' if name=='wrong_test' else cells[5]
                if name=='wrong_owner':cells[4]=' WP-00 '
                lines[i]='|'.join(cells)
        p.write_text('\n'.join(lines)+'\n')
    elif name=='bad_fragment':
        p=root/'README.md';p.write_text(p.read_text()+'\n[broken](specs/v0.1/01-contracts.md#missing-fragment-xyz)\n')
    elif name in ('cycle','future_dod','fake_pass'):
        p=spec/'traceability.json';reg=json.loads(p.read_text())
        if name=='cycle':reg['work_packages'][1]['dependencies']=['WP-07']
        if name=='future_dod':next(t for t in reg['tests'] if t['id']=='T37.contract')['requires_packages']=['WP-03']
        if name=='fake_pass':reg['tests'][0]['initial_status']='pass'
        p.write_text(json.dumps(reg,ensure_ascii=False))
    elif name=='missing_axiom':
        p=spec/'WORK-PACKAGES.md';p.write_text(p.read_text().replace('### Invariants','### Other',1))
    elif name=='archive_changed':
        p=root/'docs/history/RFC-CSC-001-v0.1.md';p.write_bytes(p.read_bytes()+b'\n')
    elif name=='missing_unique_index':
        p=spec/'03-ledger.md';s=p.read_text();s=s.replace("CREATE UNIQUE INDEX one_active_job ON jobs(session_key)\n  WHERE status IN ('queued','running','ready');",'')
        p.write_text(s)
    elif name=='broken_reciprocity':
        p=spec/'WORK-PACKAGES.md';p.write_text(p.read_text().replace('**Casos de conclusão:** T01.host','**Casos de conclusão:** T33.host',1))
    else:raise ValueError(name)

def main():
    names=['wrong_test','wrong_owner','bad_fragment','cycle','future_dod','fake_pass','missing_axiom','archive_changed','missing_unique_index','broken_reciprocity']
    baseline=subprocess.run([sys.executable,str(ROOT/'scripts/check-spec.py')],capture_output=True,text=True)
    if baseline.returncode:raise RuntimeError(baseline.stdout+baseline.stderr)
    for name in names:
        with tempfile.TemporaryDirectory(prefix='cc-doc-mutation-') as tmp:
            dst=Path(tmp)/'repo';shutil.copytree(ROOT,dst,ignore=shutil.ignore_patterns('.git','__pycache__'))
            mutate(dst,name)
            run=subprocess.run([sys.executable,str(dst/'scripts/check-spec.py')],capture_output=True,text=True,timeout=20)
            if run.returncode==0:raise RuntimeError('Mutation escaped: '+name)
            print('PASS (rejected):',name)
    print(f'PASS: {len(names)} controlled document mutations rejected. No product test executed.')
    return 0
if __name__=='__main__':sys.exit(main())
