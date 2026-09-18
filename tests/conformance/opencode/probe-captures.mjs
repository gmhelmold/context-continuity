/** Bounded in-memory correlation, only for synthetic WP-00 fixtures. */
import { randomUUID } from 'node:crypto';
import { error } from './probe-protocol.mjs';
export class Captures {
  constructor({ttl=30000,perSession=4,maxEntries=64,maxBytes=32*1024*1024,now=Date.now}={}) {
    Object.assign(this,{ttl,perSession,maxEntries,maxBytes,now});
    this.pending=new Map(); this.tokens=new Map(); this.closed=false;
  }
  stats() {
    const unique=new Set([...this.pending.values(),...Array.from(this.tokens.values(),x=>x.capture)]);
    return {entries:this.tokens.size,pending:this.pending.size,bytes:[...unique].reduce((s,c)=>s+c.bytes,0),active:[...this.tokens.values()].reduce((s,x)=>s+x.active,0)};
  }
  sweep() {
    const t=this.now();
    for(const [k,v] of this.tokens) if(!v.active&&(v.revoked||t-v.touched>=this.ttl)) this.tokens.delete(k);
    for(const [k,v] of this.pending) if(t-v.created>=this.ttl) this.pending.delete(k);
  }
  room(bytes,session) {
    this.sweep();
    while(true) {
      const st=this.stats(), count=[...this.tokens.values()].filter(x=>x.capture.session===session).length;
      if(st.bytes+bytes<=this.maxBytes&&st.entries+st.pending<this.maxEntries&&count<this.perSession) return;
      const evict=[...this.tokens].filter(([,x])=>!x.active&&(count<this.perSession||x.capture.session===session)).sort((a,b)=>a[1].touched-b[1].touched)[0];
      if(!evict) throw error('E_CAPTURE_BUDGET');
      this.tokens.delete(evict[0]);
    }
  }
  put(session,capture) {
    if(this.closed) throw error('E_DISPOSED');
    this.pending.delete(session);
    const bytes=Buffer.byteLength(JSON.stringify(capture)); this.room(bytes,session);
    this.pending.set(session,{...capture,bytes,created:this.now()});
  }
  register(session,kind,extra={}) {
    if(this.closed) throw error('E_DISPOSED');
    let capture=kind==='primary'?this.pending.get(session):null;
    if(kind==='primary'&&!capture) throw error('E_CAPTURE');
    if(capture) this.pending.delete(session);
    else capture={session,kind,messages:[],bytes:128,created:this.now()};
    this.room(capture.bytes,session); capture={...capture,...extra};
    const token=randomUUID(); this.tokens.set(token,{capture,active:0,touched:this.now(),revoked:false});
    return token;
  }
  acquire(token) {
    this.sweep(); const entry=this.tokens.get(token);
    if(!entry||entry.revoked) throw error('E_CAPTURE');
    entry.active++; entry.touched=this.now(); return entry.capture;
  }
  release(token) {
    const entry=this.tokens.get(token);
    if(entry) {entry.active=Math.max(0,entry.active-1);entry.touched=this.now();}
    this.sweep();
  }
  clearSession(session) {
    this.pending.delete(session);
    for(const [k,e] of this.tokens) if(e.capture.session===session) {
      if(e.active) e.revoked=true; else this.tokens.delete(k);
    }
  }
  dispose() {this.closed=true;this.pending.clear();this.tokens.clear();}
}
