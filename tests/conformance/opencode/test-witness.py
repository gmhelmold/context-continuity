#!/usr/bin/env python3
"""Independent fixture input transport: byte preservation and observation boundary."""
import hashlib,json,threading,unittest
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.request import Request,urlopen
from ingress_witness import IngressWitness
from oracle import witnessed_sequence, same_json
class Echo(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):
  raw=self.rfile.read(int(self.headers['Content-Length']))
  self.server.received.append(raw)
  self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
class WitnessTests(unittest.TestCase):
 def test_literal_input_is_recorded_outside_target_before_forwarding(self):
  target=ThreadingHTTPServer(('127.0.0.1',0),Echo);target.received=[]
  witness=IngressWitness(target.server_port)
  for server in (target,witness):threading.Thread(target=server.serve_forever,daemon=True).start()
  raw=' {"messages":[{"role":"user","content":"Olá 🔥"}],"model":"probe"} '.encode()
  try:
   with urlopen(Request(f'http://127.0.0.1:{witness.server_port}/v1/chat/completions',data=raw,headers={'x-cc-local':'synthetic-secret'}),timeout=5) as r:self.assertEqual(r.read(),raw)
   self.assertEqual(target.received,[raw]);self.assertEqual(witness.records[0]['raw_sha256'],hashlib.sha256(raw).hexdigest())
   self.assertEqual(witness.records[0]['body'],json.loads(raw));self.assertNotIn('synthetic-secret',json.dumps(witness.records))
  finally:
   for server in (witness,target):server.shutdown();server.server_close()
 def test_expected_output_is_not_derived_from_target_telemetry(self):
  original={'messages':[{'role':'system','content':'original'},{'role':'user','content':'TASK'}],'model':'probe'}
  wrong={'messages':[{'role':'system','content':'changed'},{'role':'user','content':'TASK'}],'model':'probe'}
  witnessed_sequence([{'body':original}],[{'body':original}],[])
  with self.assertRaisesRegex(AssertionError,'E_ORACLE_WITNESS_PAYLOAD'):
   witnessed_sequence([{'body':original}],[{'body':wrong}],[])
 def test_json_types_are_part_of_exact_content(self):
  self.assertFalse(same_json({'nested':[True]}, {'nested':[1]}))
  self.assertFalse(same_json({'nested':[0]}, {'nested':[False]}))
  self.assertTrue(same_json({'number':1}, {'number':1.0}))
  self.assertFalse(same_json({'x':None}, {'x':'null'}))
if __name__=='__main__':unittest.main(verbosity=2)
