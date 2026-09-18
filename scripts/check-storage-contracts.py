#!/usr/bin/env python3
"""Executable examples of the revised archive/liveness contracts.
Not the future storage engine, migration, importer or product conformance suite.
"""
from __future__ import annotations
import copy,fcntl,hashlib,json,os,re,select,subprocess,sys,tempfile,unittest
from pathlib import Path

def origin_catalog(archive):
    if archive.get('schema_version')!=2:raise ValueError('archive version')
    seen={}
    for chapter in archive['chapters']:
        c=chapter['origin_coverage']
        if any(c[k]!=archive['origin'][k] for k in ('adapter_id','session_key','incarnation')):raise ValueError('origin')
        if c['host_epoch']!=chapter['host_epoch'] or c['host_epoch']<0:raise ValueError('epoch')
        if len(set(c['logical_ids']))!=len(c['logical_ids']):raise ValueError('logical duplicate')
        local=set()
        for root in c['roots']:
            key=(c['host_epoch'],root['unit_id'],root['revision'])
            if key in local or not re.fullmatch('[0-9a-f]{64}',root['unit_digest']):raise ValueError('root')
            local.add(key)
            if key in seen and seen[key]!=root['unit_digest']:raise ValueError('conflicting origin digest')
            seen[key]=root['unit_digest']
    return seen

class StateContracts(unittest.TestCase):
    def test_origin_coverage_is_opaque_preserved_and_consistent(self):
        origin={'adapter_id':'fixture','session_key':'s','incarnation':'i'}
        roots=[{'unit_id':x,'revision':0,'unit_digest':hashlib.sha256(x.encode()).hexdigest()} for x in 'BCD']
        chapters=[{'chapter_id':'c1','host_epoch':0,'origin_coverage':{**origin,'host_epoch':0,'roots':roots[:2],'logical_ids':['B','C']}}, {'chapter_id':'c2','host_epoch':0,'origin_coverage':{**origin,'host_epoch':0,'roots':roots,'logical_ids':['summary-c1','D']}}]
        a={'schema_version':2,'origin':origin,'chapters':chapters}; catalog=origin_catalog(a)
        imported=json.loads(json.dumps(a))
        for c in imported['chapters']:c['chapter_id']='archive-local-'+c['chapter_id']
        self.assertEqual(origin_catalog(imported),catalog)
        for before,after in zip(a['chapters'],imported['chapters']):self.assertEqual(before['origin_coverage'],after['origin_coverage'])
        broken=copy.deepcopy(imported);broken['chapters'][1]['origin_coverage']['roots'][0]['unit_digest']='0'*64
        with self.assertRaisesRegex(ValueError,'conflicting'):origin_catalog(broken)
        broken=copy.deepcopy(imported);broken['schema_version']=1
        with self.assertRaisesRegex(ValueError,'version'):origin_catalog(broken)
        # No root materialization API or access to a former host exists here.

    def test_liveness_lock_survives_slow_owner_and_releases_after_exit(self):
        for kind in ('staging','read_pin','export_pin'):
            with self.subTest(kind=kind),tempfile.TemporaryDirectory(prefix='cc-lock-contract-') as directory:
                path=Path(directory)/'unique-owner.lock'
                program="import fcntl,sys;f=open(sys.argv[1],'a+');fcntl.flock(f,fcntl.LOCK_EX);print('held',flush=True);sys.stdin.readline()"
                child=subprocess.Popen([sys.executable,'-c',program,str(path)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
                try:
                    self.assertTrue(select.select([child.stdout],[],[],5)[0],'liveness fixture startup timeout')
                    self.assertEqual(child.stdout.readline().strip(),'held')
                    with path.open('a+') as probe:
                        with self.assertRaises(BlockingIOError):fcntl.flock(probe,fcntl.LOCK_EX|fcntl.LOCK_NB)
                    # Terminate only the owned test child to model process death.
                    child.kill();child.wait(timeout=5)
                    with path.open('a+') as probe:
                        fcntl.flock(probe,fcntl.LOCK_EX|fcntl.LOCK_NB)
                        reservations=[{'owner':'dead','kind':kind},{'owner':'live','kind':kind}]
                        retained=[r for r in reservations if r['owner']!='dead']
                        self.assertEqual(retained,[{'owner':'live','kind':kind}])
                        fcntl.flock(probe,fcntl.LOCK_UN)
                finally:
                    if child.poll() is None:child.kill();child.wait(timeout=5)
                    child.stdin.close();child.stdout.close()

if __name__=='__main__':unittest.main(verbosity=2)
