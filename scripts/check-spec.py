#!/usr/bin/env python3
"""Verifica documentos/registro/DDL de referência. NÃO executa o produto."""
from __future__ import annotations
import hashlib
import json
import re
import sqlite3
import sys
import unicodedata
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / 'specs/v0.1'
AXIOMS = ('Success Criteria','Quality Standards','Completeness Criteria','Definition of Done','Invariants')

def require(ok, message):
    if not ok:
        raise ValueError(message)

def plain_markdown(text):
    out=[]
    fence=None
    for line in text.splitlines():
        mark=re.match(r'^\s*(`{3,}|~{3,})',line)
        if mark:
            token=mark.group(1)
            if fence is None: fence=token
            elif token[0]==fence[0] and len(token)>=len(fence): fence=None
            out.append('')
        else: out.append(line if fence is None else '')
    require(fence is None,'Unclosed code fence')
    return '\n'.join(out)

def anchors(text):
    counts={}; result=set()
    for heading in re.findall(r'^#{1,6}\s+(.+?)\s*#*$',plain_markdown(text),re.M):
        heading=re.sub(r'<[^>]*>','',heading).replace('`','').replace('*','').replace('_','_')
        slug=''.join(ch for ch in heading.lower() if ch in ('-','_',' ') or unicodedata.category(ch)[0] in 'LN').replace(' ','-')
        index=counts.get(slug,0); counts[slug]=index+1
        result.add(slug if index==0 else f'{slug}-{index}')
    result.update(re.findall(r'<a\s+(?:id|name)=["\']([^"\']+)',text))
    return result

def validate_markdown():
    paths=[ROOT/'README.md',ROOT/'AGENTS.md',*sorted((ROOT/'docs').rglob('*.md')),*sorted((ROOT/'specs').rglob('*.md'))]
    for path in paths:
        text=path.read_text(encoding='utf-8')
        visible=plain_markdown(text)
        for target in re.findall(r'\[[^\]\n]+\]\(([^)\s]+)\)',visible):
            url=urlsplit(target)
            if url.scheme or url.netloc: continue
            dest=(path.parent/unquote(url.path)).resolve() if url.path else path.resolve()
            require(dest.is_relative_to(ROOT),f'Link escapes repository: {target}')
            require(dest.exists(),f'Broken link: {path.relative_to(ROOT)} -> {target}')
            if url.fragment:
                require(dest.is_file() and dest.suffix=='.md',f'Fragment on unsupported file: {target}')
                require(unquote(url.fragment) in anchors(dest.read_text()),f'Broken fragment: {path.relative_to(ROOT)} -> {target}')
    return len(paths)

def table_rows(text, pattern):
    return [[x.strip() for x in line.split('|')[1:-1]] for line in text.splitlines() if re.match(pattern,line)]

def validate_traceability():
    reg=json.loads((SPEC/'traceability.json').read_text())
    require(set(reg)=={'schema_version','revision','requirements','tests','work_packages'},'Unexpected registry keys')
    require(reg['schema_version']==1,'Unsupported registry schema')
    reqs=reg['requirements']; cases=reg['tests']; work=reg['work_packages']
    rd={x['id']:x for x in reqs}; td={x['id']:x for x in cases}; wd={x['id']:x for x in work}
    require(list(rd)==[f'R{i:02}' for i in range(1,37)] and len(rd)==len(reqs),'Requirement identity/duplicate')
    require(list(wd)==[f'WP-{i:02}' for i in range(8)] and len(wd)==len(work),'Work package identity/duplicate')
    require(len(td)==len(cases),'Duplicate test case')
    closure={}; visiting=set()
    def visit(wp):
        require(wp in wd,f'Unknown dependency {wp}')
        require(wp not in visiting,f'Dependency cycle at {wp}')
        if wp in closure: return closure[wp]
        visiting.add(wp); deps=set()
        for dep in wd[wp]['dependencies']:
            deps.add(dep); deps.update(visit(dep))
        visiting.remove(wp); closure[wp]=deps; return deps
    for wp in wd: visit(wp)
    for case in cases:
        require(re.fullmatch(r'T\d{2}\.[a-z]+',case['id']) is not None,'Malformed case ID')
        require(case['family']==case['id'].split('.')[0],'Case/family mismatch')
        require(case['owner'] in wd,'Unknown case owner')
        require(case['initial_status']=='not_run','Initial runtime status cannot be PASS')
        available=closure[case['owner']]|{case['owner']}
        require(set(case['requires_packages'])<=available,f"Retroactive DoD: {case['id']}")
        require(bool(case['oracle'].strip()),'Missing oracle')
    require({c['family'] for c in cases}=={f'T{i:02}' for i in range(1,41)},'Missing test family')
    for req in reqs:
        require(req['owner'] in wd and req['cases'],'Requirement has no owner/cases')
        require(len(set(req['cases']))==len(req['cases']),'Duplicate requirement mapping')
        for case in req['cases']:
            require(case in td and td[case]['family']==req['family'],'Wrong requirement/test family')
    for wp in work:
        expected_cases=[x['id'] for x in cases if x['owner']==wp['id']]
        expected_reqs=[q['id'] for q in reqs if q['owner']==wp['id'] or any(td[c]['owner']==wp['id'] for c in q['cases'])]
        require(wp['cases']==expected_cases,f"Non-reciprocal cases: {wp['id']}")
        require(wp['requirements']==expected_reqs,f"Non-reciprocal requirements: {wp['id']}")
    acceptance=(SPEC/'06-acceptance.md').read_text()
    rows=table_rows(acceptance,r'^\| R\d{2} \|')
    require(rows==[[q['id'],q['obligation'],q['contract'],q['owner'],', '.join(q['cases'])] for q in reqs],'Requirement table differs from canonical registry')
    rows=table_rows(acceptance,r'^\| T\d{2}\.[a-z]+ \|')
    expected=[[x['id'],x['owner'],', '.join(x['requires_packages']) or 'nenhum',x['class'],'not_run'] for x in cases]
    require(rows==expected,'Case table differs from canonical registry')
    for case in cases:
        require(f"**{case['id']}:** {case['oracle']}" in acceptance, f"Case oracle differs: {case['id']}")
    require(re.findall(r'^### (T\d{2}) —',acceptance,re.M)==[f'T{i:02}' for i in range(1,41)],'Family headings missing/duplicated')
    wt=(SPEC/'WORK-PACKAGES.md').read_text(); parts=re.split(r'^## (WP-\d{2}) —',wt,flags=re.M)
    require(parts[1::2]==list(wd),'WP sections missing/duplicated')
    for wp_id,body in zip(parts[1::2],parts[2::2]):
        for ax in AXIOMS:
            require(len(re.findall(r'^### '+re.escape(ax)+r'$',body,re.M))==1,f'{wp_id}: {ax} missing/duplicated')
        wp=wd[wp_id]
        def ids(label, pattern):
            line=re.search(r'^\*\*'+re.escape(label)+r':\*\* (.+)$',body,re.M)
            require(line is not None,f'{wp_id}: {label} missing')
            return re.findall(pattern,line.group(1))
        require(ids('Dependências',r'WP-\d{2}')==wp['dependencies'],f'{wp_id}: dependencies differ')
        require(ids('Requisitos vinculados',r'R\d{2}')==wp['requirements'],f'{wp_id}: requirements differ')
        require(ids('Casos de conclusão',r'T\d{2}\.[a-z]+')==wp['cases'],f'{wp_id}: completion cases differ')
        require('**Evidência esperada:**' in body,'Missing evidence statement')
    for path in SPEC.glob('*.md'):
        text=path.read_text()
        for ident in re.findall(r'\bT\d{2}\.[a-z]+\b',text): require(ident in td,f'Unknown case {ident} in {path.name}')
    return reg

def validate_archive():
    data=(ROOT/'docs/history/RFC-CSC-001-v0.1.md').read_bytes()
    blob=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
    require(blob=='701d9fa06f8bf39065085048b6be6bb20b52b112','Historical RFC changed')

def reference_ddl():
    blocks=re.findall(r'```sql\n(.*?)\n```',(SPEC/'03-ledger.md').read_text(),re.S)
    require(len(blocks)==1,'Expected one normative DDL block')
    return blocks[0]

def validate_reference_ddl():
    with sqlite3.connect(':memory:') as db:
        db.execute('PRAGMA foreign_keys=ON');db.executescript(reference_ddl())
        def add(table, **row):
            keys=','.join(row); placeholders=','.join('?' for _ in row)
            db.execute(f'INSERT INTO {table}({keys}) VALUES({placeholders})',tuple(row.values()))
        def rejected(fn, label):
            try: fn()
            except sqlite3.IntegrityError: return
            raise ValueError(label+' was accepted')
        for key in ('one','two'):
            add('sessions',session_key=key,incarnation=key,scope_json='{}',mode='complete',config_json='{}',counters_json='{}',created_at='fixture')
        j=dict(session_key='one',incarnation='one',status='queued',snapshot_json='{}',manifest_json='{}',owner_fence=1,deadline_at='fixture',created_at='fixture',updated_at='fixture')
        add('jobs',job_id='j1',**j)
        rejected(lambda:add('jobs',job_id='j2',**j),'Duplicate active job')
        db.execute("UPDATE jobs SET status='published' WHERE job_id='j1'")
        add('jobs',job_id='j2',**j)
        add('aux_runs',run_id='run1',session_key='one',job_id='j2',attempt_no=1,state='quarantine',remote_state='unknown',local_stopped=0)
        rejected(lambda:add('aux_runs',run_id='run2',session_key='one',job_id='j2',attempt_no=1,state='running',remote_state='unknown',local_stopped=0),'Concurrent quarantined run')
        rejected(lambda:add('aux_runs',run_id='cross',session_key='two',job_id='j2',attempt_no=1,state='running',remote_state='unknown',local_stopped=0),'Cross-scope auxiliary')
        source=dict(session_key='one',source_id='empty',revision=0,digest=hashlib.sha256(b'').hexdigest(),native_refs_json='[]',availability='captured',media_type='text/plain',size_bytes=0,policy_revision=0,created_at='fixture')
        add('sources',inline_bytes=b'',**source)
        rejected(lambda:add('sources',**{**source,'source_id':'absent'}),'Captured source without bytes')
        add('operations',operation_id='manual',session_key='one',request_id='manual-request',input_digest='hash',kind='correction',actor='user',job_id=None,status='committed',expected_revision=0,result_revision=1,created_at='fixture')
        ch=dict(chapter_id='c1',session_key='one',operation_id='manual',host_epoch=0,digest='h',coverage_json='[]',logical_json='[]',dependencies_json='[]',parents_json='[]',manifest_json='{}',proposal_json='{}',status='published',created_at='fixture')
        add('chapters',**ch)
        rejected(lambda:add('chapters',**{**ch,'chapter_id':'cross','session_key':'two'}),'Cross-scope chapter')
        add('retrievals',retrieval_id='r1',incarnation='one',host_epoch=0,host_message_id='m1',tool_call_id='call1',request_digest='a'*64,response_digest='b'*64,session_key='one',chapter_id='c1',work_json='{}',range_json='{}',text_digest='h',reason='lookup',declared_by='agent',created_at='fixture',consumed_by_job='j1')
        receipt=dict(incarnation='one',host_epoch=0,host_message_id='m1',tool_call_id='call1',request_digest='a'*64,response_digest='b'*64,session_key='one',work_json='{}',range_json='{}',text_digest='h',reason='lookup',declared_by='agent',created_at='fixture')
        rejected(lambda:add('retrievals',retrieval_id='replay',**receipt),'Duplicate tool execution receipt')
        rejected(lambda:add('retrievals',retrieval_id='conflict',**{**receipt,'request_digest':'c'*64}),'Conflicting receipt identity')
        for i in (2,3):add('retrievals',retrieval_id='read'+str(i),**{**receipt,'tool_call_id':'call'+str(i)})
        require(db.execute("SELECT count(*) FROM retrievals WHERE session_key='one'").fetchone()[0]==3,'Distinct reads were collapsed')
        add('views',session_key='one',revision=1,host_epoch=0,policy_revision=0,replacements_json='[]',blocks_json='[]',suppressed_json='[]',created_at='fixture')
        add('attempts',attempt_id='a1',session_key='one',job_id='j2',attempt_no=1,state='reserved',input_reserved=1,output_reserved=1)
        rejected(lambda:add('attempts',attempt_id='a3',session_key='one',job_id='j2',attempt_no=3,state='reserved',input_reserved=1,output_reserved=1),'Third physical attempt row')
        require(not list(db.execute('PRAGMA foreign_key_check')),'FK violation')
        # Check declared deletion order with populated, interdependent rows.
        for table in ('emissions','retrievals','dependencies','views','blocks','root_units','sources','chapters','operations','attempts','aux_runs','jobs','sessions'):
            db.execute(f'DELETE FROM {table} WHERE session_key=?',('one',))
        require(db.execute('SELECT count(*) FROM sessions').fetchone()[0]==1,'Other scope deleted')
        require(not list(db.execute('PRAGMA foreign_key_check')),'FK violation after deletion')

def main():
    try:
        docs=validate_markdown();reg=validate_traceability();validate_archive();validate_reference_ddl()
    except (OSError,ValueError,KeyError,TypeError,sqlite3.Error) as exc:
        print('SPEC CHECK FAILED:',exc,file=sys.stderr);return 1
    print(f'PASS: {docs} Markdown files; local links AND fragments; fences.')
    print(f"PASS: canonical mapping, reciprocity and acyclic DoDs: {len(reg['requirements'])} requirements, {len(reg['tests'])} atomic cases, {len(reg['work_packages'])} packages.")
    print('PASS: historical blob intact; reference DDL constraints and populated deletion order.')
    print('NOT TESTED: installed plugin, host/provider conformance, cache, semantic quality or performance. Runtime cases remain not_run.')
    return 0
if __name__=='__main__': sys.exit(main())
