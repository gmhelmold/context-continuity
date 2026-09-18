#!/usr/bin/env python3
"""Executable contract examples, NOT the plugin and NOT host/provider certification."""
from __future__ import annotations
import copy
import hashlib
import json
import unittest


from canonical_json import canonical_bytes

def digest(value):
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def project(roots, replacements):
    positions={x:i for i,x in enumerate(roots)}
    if len(positions)!=len(roots): raise ValueError('duplicate roots')
    covered=set(); starts={}
    for summary,coverage in replacements:
        if not coverage or any(x not in positions for x in coverage): raise ValueError('stale')
        indexes=[positions[x] for x in coverage]
        if indexes!=list(range(indexes[0],indexes[0]+len(indexes))): raise ValueError('noncontiguous')
        if covered.intersection(coverage): raise ValueError('overlap')
        starts[indexes[0]]=(summary,len(coverage));covered.update(coverage)
    out=[]; i=0
    while i<len(roots):
        if i in starts:
            summary,size=starts[i];out.append(summary);i+=size
        else:out.append(roots[i]);i+=1
    return out

def consolidate(roots,view,logical,summary):
    effective=project(roots,view)
    start=effective.index(logical[0])
    if effective[start:start+len(logical)]!=logical:raise ValueError('logical interval')
    lookup=dict(view);flatten=[]
    for item in logical:flatten.extend(lookup.get(item,[item]))
    remaining=[(name,cov) for name,cov in view if name not in logical]
    candidate=remaining+[(summary,flatten)]
    project(roots,candidate)
    return candidate

def pages(text,limit):
    data=text.encode('utf-8');position=0;out=[]
    if not data:return [(0,0,b'')]
    while position<len(data):
        end=min(position+limit,len(data))
        while end>position:
            try:data[position:end].decode('utf-8');break
            except UnicodeDecodeError:end-=1
        if end==position:raise ValueError('E_BUDGET')
        out.append((position,end,data[position:end]));position=end
    return out

def allowed(required,fidelity,gate):
    return len(required)==12 and all(x=='verified' for x in required) and fidelity=='verified' and gate=='pass'

def closure(edges, origin):
    invalid={origin};changed=True
    while changed:
        changed=False
        for dependent,source,kind in edges:
            if kind=='content' and source in invalid and dependent not in invalid:
                invalid.add(dependent);changed=True
    return invalid

class ContractModels(unittest.TestCase):
    def test_01_repeated_consolidation_raw_restart(self):
        for count in (2,10,64):
            roots=['A']+[f'B{i}' for i in range(count)]+['Z'];view=[]
            for index in range(count):
                logical=[f'B{index}'] if index==0 else [f'S{index-1}',f'B{index}']
                view=consolidate(roots,view,logical,f'S{index}')
                roots.append(f'tail{index}')
                # Simulate persistence/restart by round-tripping only flattened current plan.
                view=json.loads(json.dumps(view))
                self.assertEqual(project(roots,view),['A',f'S{index}']+[f'B{i}' for i in range(index+1,count)]+['Z']+[f'tail{i}' for i in range(index+1)])
    def test_02_overlap_and_stale_ref_rejected(self):
        for view in [[('S',['B','D'])],[('S',['B','C']),('T',['C','D'])],[('S',['gone'])]]:
            with self.assertRaises(ValueError):project(list('ABCDE'),view)
    def test_03_payload_role_metadata_hash(self):
        value={'source_refs':['same'],'role':'assistant','payload':'v1','metadata':{'signature':'a'}}
        original=digest(value)
        for field,val in [('role','user'),('payload','v2'),('metadata',{'signature':'b'})]:
            altered=copy.deepcopy(value);altered[field]=val;self.assertNotEqual(original,digest(altered))
        self.assertEqual(original,digest(json.loads(json.dumps(value))))
    def test_04_manifest_mixed_round_trip(self):
        m=[{'index':i+1,'kind':kind,'id':kind+'-old','revision':1,'range':[0,2],'excerpt_digest':digest(kind),'authority':authority} for i,(kind,authority) in enumerate([('source','external'),('block','user'),('chapter','agent')])]
        claims=[{'text':'claim','sources':[2,3]}]
        imported=copy.deepcopy(m)
        for entry in imported:entry['origin_id']=entry['id'];entry['id']='new-'+entry['id']
        for claim in claims:
            for index in claim['sources']:
                a=m[index-1];b=imported[index-1]
                self.assertEqual((a['index'],a['kind'],a['range'],a['authority'],a['excerpt_digest']),(b['index'],b['kind'],b['range'],b['authority'],b['excerpt_digest']))
    def test_05_paging_large_utf8_crlf(self):
        text=('é🔥x'*30000)+'\r\nlast\n'
        for budget in (4,17,65536):
            result=pages(text,budget)
            self.assertEqual(b''.join(x[2] for x in result),text.encode())
            self.assertTrue(all(end>start for start,end,_ in result))
            self.assertTrue(all(result[i][1]==result[i+1][0] for i in range(len(result)-1)))
    def test_06_empty_and_minimum_page(self):
        self.assertEqual(pages('',1),[(0,0,b'')])
        with self.assertRaises(ValueError):pages('🔥',3)
    def test_07_capability_truth_table(self):
        self.assertTrue(allowed(['verified']*12,'verified','pass'))
        self.assertFalse(allowed([],'verified','pass'))
        self.assertFalse(allowed(['verified']*11,'verified','pass'))
        for index in range(12):
            for state in ('unknown','declared','missing'):
                flags=['verified']*12;flags[index]=state
                self.assertFalse(allowed(flags,'verified','pass'))
        for fidelity in ('unverified','different'):
            self.assertFalse(allowed(['verified']*12,fidelity,'pass'))
        for gate in ('fail','blocked','not_run'):
            self.assertFalse(allowed(['verified']*12,'verified',gate))
    def test_08_transitive_content_not_history(self):
        edges=[('A','X','content'),('B','A','content'),('C','B','history')]
        self.assertEqual(closure(edges,'X'),{'X','A','B'})
    def test_09_restore_expansion(self):
        roots=list('ABCDEFG');view=[('S',['B','C','D'])]
        selected={'C'};expanded=set(selected)
        for _,coverage in view:
            if selected.intersection(coverage):expanded.update(coverage)
        self.assertEqual(expanded,{'B','C','D'})
        # No consent means unchanged; consent materializes all coverage without effects.
        self.assertEqual(project(roots,view),['A','S','E','F','G'])
        self.assertEqual(project(roots,[]),roots)
    def test_10_retention_scope_and_expiry(self):
        reads=[{'call':str(i),'task':'A','range':pair} for i,pair in enumerate([(0,20),(5,30),(10,40)])]
        start=max(x['range'][0] for x in reads);end=min(x['range'][1] for x in reads)
        self.assertEqual((start,end),(10,20))
        self.assertEqual(len({x['call'] for x in reads}),3)
        reads[-1]['task']='B';self.assertNotEqual(len({x['task'] for x in reads}),1)
        created=30;expiry=created+2
        self.assertEqual([seq for seq in (30,31,32,33) if seq<expiry],[30,31])

if __name__=='__main__':
    unittest.main(verbosity=2)
