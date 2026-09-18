/** One-hop SYNTHETIC loopback transport; never accepts a live provider. */
import { once } from 'node:events';
import { error } from './probe-protocol.mjs';
const ALLOWED=['content-type','retry-after','request-id','x-request-id','x-ratelimit-limit-requests','x-ratelimit-remaining-requests','x-ratelimit-reset-requests'];
export function responseHeaders(headers) {
  const nominated=(headers.get('connection')??'').toLowerCase().split(',').map(x=>x.trim());
  const out={};
  for(const k of ALLOWED) {
    const value=headers.get(k);
    if(value!==null&&!nominated.includes(k)&&value.length<=4096) out[k]=value;
  }
  return out; // No auth/cookies or length/encoding of a body fetch may decode.
}
export async function forward(req,res,url,body,{controller,timeoutMs=60000,observer=null,onHeaders=()=>{},stats={}}) {
  const upstream=new URL(url);
  if(upstream.protocol!=='http:'||upstream.hostname!=='127.0.0.1') throw error('FIXTURE_LOOPBACK_ONLY');
  const stop=()=>controller.abort(error('E_PARENT_DISCONNECTED'));
  const closed=()=>{if(!res.writableFinished)stop();};
  req.once('aborted',stop);res.once('close',closed);
  const timer=setTimeout(()=>controller.abort(error('E_PARENT_TIMEOUT')),timeoutMs);timer.unref?.();
  Object.assign(stats,{writes:0,drains:0,maxBuffered:0,bytes:0,stopped:false});
  try {
    if(req.aborted||res.destroyed) stop();
    const result=await fetch(upstream,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:controller.signal});
    onHeaders(result.status);
    const inspect=result.ok&&observer?observer(result.headers):null;
    res.writeHead(result.status,responseHeaders(result.headers));
    for await(const chunk of result.body??[]) {
      if(controller.signal.aborted||res.destroyed) throw error('E_PARENT_DISCONNECTED');
      inspect?.push(chunk);
      const writable=res.write(chunk);
      stats.writes++;stats.bytes+=chunk.byteLength;stats.maxBuffered=Math.max(stats.maxBuffered,res.writableLength);
      if(!writable) {stats.drains++;await once(res,'drain',{signal:controller.signal});}
    }
    const completion=inspect?.end();
    res.end();return {status:result.status,completion};
  } finally {
    clearTimeout(timer);req.removeListener('aborted',stop);res.removeListener('close',closed);
    if(!res.writableEnded) controller.abort(error('E_FORWARD_ENDED'));
    stats.stopped=true;
  }
}
