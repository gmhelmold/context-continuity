/** Closed text/function-tool codec for the synthetic WP-00 probe only. */
import { hash, parseJSON } from '../../../scripts/canonical-json.mjs';
export { hash, parseJSON };
export const error = code => Object.assign(new Error(code), {code});
export function text(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (!Array.isArray(value) || value.some(x => !x || x.type !== 'text' || typeof x.text !== 'string' || Object.keys(x).some(k => !['type','text'].includes(k)))) throw error('E_CODEC_UNSUPPORTED');
  return value.map(x => x.text).join('\n');
}
export function rootsFor(body, source) {
  if (!Array.isArray(body.messages)) throw error('E_CODEC_MESSAGES');
  // Inspect ALL parts before matching any text. No media/opaque payload can be
  // classified as a removable text root just because its text happens to match.
  for (const m of body.messages) {
    text(m.content);
    if (!['system','developer','user','assistant','tool'].includes(m.role)) throw error('E_CODEC_ROLE');
    if (Object.keys(m).some(k => !['role','content','tool_calls','tool_call_id','name'].includes(k))) throw error('E_CODEC_UNSUPPORTED');
  }
  const roots = []; let at = 0;
  while (at < body.messages.length && ['system','developer'].includes(body.messages[at].role)) {
    roots.push({id:`system:${at}`,parts:[body.messages[at]],protected:true}); at++;
  }
  for (const item of source) {
    if (!Array.isArray(item.parts)) throw error('E_CODEC_PARTS');
    for (const p of item.parts) {
      if (!['text','tool','compaction','step-start','step-finish'].includes(p.type)) throw error('E_CODEC_UNSUPPORTED');
      if (p.type === 'tool' && ((p.state?.attachments?.length ?? 0) > 0 || p.metadata?.providerExecuted)) throw error('E_CODEC_UNSUPPORTED');
      if (p.type === 'text' && p.metadata && Object.keys(p.metadata).length) throw error('E_CODEC_UNSUPPORTED');
    }
    if (item.info.role === 'assistant' && item.info.error) continue;
    const value = item.parts.flatMap(p => p.type === 'text' && !p.ignored ? [p.text] : p.type === 'compaction' ? ['What did we do so far?'] : []).join('\n');
    const tools = item.parts.filter(p => p.type === 'tool');
    if (!value && !tools.length) continue;
    const first = body.messages[at];
    if (!first || first.role !== item.info.role) throw error('E_CODEC_ROLE');
    if (text(first.content) !== value) throw error('E_CODEC_TEXT');
    const group = [first]; at++;
    if (tools.length) {
      const calls = first.tool_calls ?? [];
      if (calls.length !== tools.length) throw error('E_CODEC_CALLS');
      for (let i = 0; i < tools.length; i++) {
        const t = tools[i], c = calls[i], result = body.messages[at];
        if (t.state.status !== 'completed' || c.type !== 'function' || c.id !== t.callID || c.function.name !== t.tool || hash(parseJSON(c.function.arguments)) !== hash(t.state.input)) throw error('E_CODEC_CALL');
        if (!result || result.role !== 'tool' || result.tool_call_id !== c.id || text(result.content) !== t.state.output) throw error('E_CODEC_RESULT');
        group.push(result); at++;
      }
    } else if (first.tool_calls?.length) throw error('E_CODEC_UNEXPECTED_CALL');
    roots.push({id:item.info.id,parts:group,protected:item.parts.some(p => p.type === 'compaction')});
  }
  if (at !== body.messages.length) throw error('E_CODEC_REMAINDER');
  return roots.map(r => ({...r,digest:hash(r.parts)}));
}
export function project(roots, replacements) {
  if (new Set(roots.map(r => r.id)).size !== roots.length) throw error('E_DUPLICATE_ROOT');
  const result = []; let at = 0;
  const sorted = replacements.map(r => ({...r,start:roots.findIndex(x => x.id === r.ids[0])})).sort((a,b) => a.start-b.start);
  const original = r => ({...r,coverage:[r.id]});
  for (const r of sorted) {
    if (!r.ids.length || r.start < at || r.start < 0) throw error('E_STALE_VIEW');
    const covered = roots.slice(r.start,r.start+r.ids.length);
    if (hash(covered.map(x => x.id)) !== hash(r.ids) || covered.some(x => x.protected) || hash(covered.map(x => [x.id,x.digest])) !== r.sourceHash) throw error('E_STALE_VIEW');
    const parts = [{role:'assistant',content:r.summary}];
    result.push(...roots.slice(at,r.start).map(original),{id:`summary:${r.id}`,parts,coverage:r.ids,digest:hash(parts),protected:false});
    at = r.start+r.ids.length;
  }
  return [...result,...roots.slice(at).map(original)];
}
export const apply = (roots, replacements) => project(roots,replacements).flatMap(x => x.parts);
export function proposalFrom(output) {
  if (output.finish === 'tool_calls') throw error('E_TOOL');
  if (output.finish !== 'stop') throw error('E_FINISH');
  let p; try { p = parseJSON(output.content); } catch { throw error('E_SCHEMA'); }
  if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).join(',') !== 'summary' || typeof p.summary !== 'string' || [...p.summary].length > 4000) throw error('E_SCHEMA');
  if (!p.summary.trim()) throw error('E_NO_GAIN');
  return p.summary; // validate without changing the submitted bytes
}

export class CompletionParser {
  constructor(contentType, limit = 256*1024) {
    this.sse = /^text\/event-stream(?:;|$)/i.test(contentType);
    if (!this.sse && !/^application\/json(?:;|$)/i.test(contentType)) throw error('E_CONTENT_TYPE');
    this.limit=limit; this.bytes=0; this.pending=''; this.content=''; this.finish=null;
    this.done=false; this.toolCalled=false; this.decoder=new TextDecoder('utf-8',{fatal:true});
  }
  push(chunk) {
    this.bytes += chunk.byteLength;
    if (this.bytes > this.limit) throw error('E_AUX_BYTES');
    try { this.pending += this.decoder.decode(chunk,{stream:true}); } catch { throw error('E_UTF8'); }
    if (this.sse) {
      let m;
      while ((m=/\r?\n\r?\n/.exec(this.pending))) {
        this.event(this.pending.slice(0,m.index)); this.pending=this.pending.slice(m.index+m[0].length);
      }
    }
  }
  event(block) {
    if (!block.trim() || block.split(/\r?\n/).every(x => !x || x.startsWith(':'))) return;
    if (this.done) throw error('E_SSE_AFTER_DONE');
    const lines=block.split(/\r?\n/);
    if (lines.some(x => x && !x.startsWith(':') && !x.startsWith('data:'))) throw error('E_SSE_FIELD');
    const data=lines.filter(x => x.startsWith('data:')).map(x => x.slice(5).replace(/^ /,'')).join('\n');
    if (data === '[DONE]') {
      if (this.finish === null) throw error('E_SSE_FINISH');
      this.done=true; return;
    }
    const value=parseJSON(data);
    if (value.error) throw error('E_UPSTREAM_BODY');
    if (!Array.isArray(value.choices)) throw error('E_COMPLETION_SHAPE');
    if (value.choices.length === 0 && value.usage && typeof value.usage === 'object') return;
    if (value.choices.length !== 1) throw error('E_COMPLETION_CHOICES');
    const c=value.choices[0];
    if (c.index !== 0 || !c.delta || typeof c.delta !== 'object' || Array.isArray(c.delta)) throw error('E_COMPLETION_SHAPE');
    if (this.finish !== null) throw error('E_SSE_AFTER_FINISH');
    if (c.delta.refusal != null) throw error('E_REFUSAL');
    if (c.delta.role != null && c.delta.role !== 'assistant') throw error('E_COMPLETION_ROLE');
    if (c.delta.content != null && typeof c.delta.content !== 'string') throw error('E_COMPLETION_CONTENT');
    if (Object.keys(c.delta).some(k => !['role','content','tool_calls','refusal'].includes(k))) throw error('E_COMPLETION_SHAPE');
    this.content += c.delta.content ?? '';
    if (c.delta.tool_calls != null) {
      if (!Array.isArray(c.delta.tool_calls)) throw error('E_COMPLETION_SHAPE');
      this.toolCalled ||= c.delta.tool_calls.length > 0;
    }
    if (c.finish_reason != null) {
      if (!['stop','length','tool_calls','content_filter'].includes(c.finish_reason)) throw error('E_FINISH');
      this.finish=c.finish_reason;
    }
  }
  end() {
    try { this.pending += this.decoder.decode(); } catch { throw error('E_UTF8'); }
    if (this.sse) {
      if (this.pending.trim() || !this.done || this.finish === null) throw error('E_SSE_TRUNCATED');
    } else {
      const p=parseJSON(this.pending);
      if (p.error) throw error('E_UPSTREAM_BODY');
      if (!Array.isArray(p.choices) || p.choices.length !== 1) throw error('E_COMPLETION_CHOICES');
      const c=p.choices[0];
      if (c.index !== 0 || c.message?.role !== 'assistant' || !['stop','length','tool_calls','content_filter'].includes(c.finish_reason)) throw error('E_COMPLETION_SHAPE');
      if (c.message.refusal != null) throw error('E_REFUSAL');
      if (Object.keys(c.message).some(k=>!['role','content','tool_calls','refusal'].includes(k))) throw error('E_COMPLETION_SHAPE');
      if (c.message.content != null && typeof c.message.content !== 'string') throw error('E_COMPLETION_CONTENT');
      if (c.message.tool_calls != null && !Array.isArray(c.message.tool_calls)) throw error('E_COMPLETION_SHAPE');
      this.content=c.message.content ?? ''; this.finish=c.finish_reason;
      this.toolCalled=Boolean(c.message.tool_calls?.length);
    }
    return {content:this.content,finish:this.toolCalled?'tool_calls':this.finish};
  }
}
export async function completion(response, limit) {
  const parser=new CompletionParser(response.headers.get('content-type') ?? '',limit);
  for await (const chunk of response.body) parser.push(chunk);
  return parser.end();
}
