"""Synthetic fixture ingress witness, outside the gateway under test.
Records request bytes before forwarding unchanged to loopback. Not a product service.
"""
from __future__ import annotations
import hashlib, http.client, json, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

class IngressWitness(ThreadingHTTPServer):
 daemon_threads=True
 def __init__(self, target_port):
  super().__init__(("127.0.0.1",0), WitnessHandler)
  self.target_port=target_port;self.records=[];self.lock=threading.Lock()

class WitnessHandler(BaseHTTPRequestHandler):
 protocol_version="HTTP/1.1"
 def log_message(self,*args):pass
 def do_POST(self):
  connection=None
  try:
   size=int(self.headers.get("Content-Length","-1"))
   if size<0 or size>1024*1024 or self.headers.get("Transfer-Encoding"):
    self.send_error(411 if size<0 else 413);return
   raw=self.rfile.read(size)
   if len(raw)!=size:self.send_error(400);return
   # JSON is exclusively synthetic; secrets/correlation header values are not recorded.
   body=json.loads(raw)
   with self.server.lock:
    self.server.records.append({"sequence":len(self.server.records),"raw_sha256":hashlib.sha256(raw).hexdigest(),"body":body})
   connection=http.client.HTTPConnection("127.0.0.1",self.server.target_port,timeout=90)
   headers={k:v for k,v in self.headers.items() if k.lower() not in ("host","connection","content-length","transfer-encoding")}
   headers["Content-Length"]=str(len(raw))
   connection.request("POST",self.path,body=raw,headers=headers)
   response=connection.getresponse()
   self.send_response(response.status)
   for k,v in response.getheaders():
    if k.lower() in ("content-type","retry-after","x-request-id"):self.send_header(k,v)
   self.send_header("Transfer-Encoding","chunked");self.end_headers()
   while True:
    chunk=response.read1(65536)
    if not chunk:break
    self.wfile.write(("%x\r\n"%len(chunk)).encode()+chunk+b"\r\n");self.wfile.flush()
   self.wfile.write(b"0\r\n\r\n");self.wfile.flush()
  except (ConnectionResetError,BrokenPipeError):pass
  finally:
   if connection:connection.close()
