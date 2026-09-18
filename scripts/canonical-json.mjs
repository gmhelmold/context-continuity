/** Canonical JSON reference for controlled tests. Not a product API.
 * ECMAScript binary64 serialization + UTF-16 key order (RFC 8785).
 * Never apply to the original bytes of an archived source.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export function canonical(value) {
  const ancestors = new Set();
  function encode(v, depth) {
    if (depth > 128) throw new Error('E_JSON_DEPTH');
    if (v === null || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'string') {
      if (!v.isWellFormed()) throw new Error('E_UTF8');
      return JSON.stringify(v);
    }
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new Error('E_JSON_NUMBER');
      return JSON.stringify(v);
    }
    if (typeof v !== 'object' || ancestors.has(v)) throw new Error('E_JSON_VALUE');
    ancestors.add(v);
    let result;
    if (Array.isArray(v)) {
      if (Object.keys(v).length !== v.length) throw new Error('E_JSON_ARRAY');
      result = '[' + Array.from(v, x => encode(x, depth + 1)).join(',') + ']';
    } else {
      if (![Object.prototype, null].includes(Object.getPrototypeOf(v)) || Object.getOwnPropertySymbols(v).length) throw new Error('E_JSON_OBJECT');
      result = '{' + Object.keys(v).sort().map(k => {
        if (!Object.getOwnPropertyDescriptor(v, k)?.hasOwnProperty('value')) throw new Error('E_JSON_ACCESSOR');
        return encode(k, depth + 1) + ':' + encode(v[k], depth + 1);
      }).join(',') + '}';
    }
    ancestors.delete(v);
    return result;
  }
  return encode(value, 0);
}
export const hash = value => createHash('sha256').update(canonical(value), 'utf8').digest('hex');

// Detect duplicate decoded keys BEFORE JSON.parse loses them. JSON.parse remains
// the grammar/value authority; this scanner only adds duplicate/depth validation.
export function parseJSON(text) {
  let i = 0;
  const ws = () => { while (/\s/.test(text[i] ?? '') && i < text.length) i++; };
  const string = () => {
    const start = i++;
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue; }
      if (text[i++] === '"') return JSON.parse(text.slice(start, i));
    }
    throw new Error('E_JSON_STRING');
  };
  function scan(depth) {
    if (depth > 128) throw new Error('E_JSON_DEPTH');
    ws();
    if (text[i] === '"') { string(); return; }
    if (text[i] === '{') {
      i++; ws(); const keys = new Set();
      if (text[i] === '}') { i++; return; }
      while (i < text.length) {
        ws(); if (text[i] !== '"') throw new Error('E_JSON_OBJECT');
        const key = string();
        if (keys.has(key)) throw new Error('E_JSON_DUPLICATE');
        keys.add(key); ws(); if (text[i++] !== ':') throw new Error('E_JSON_OBJECT');
        scan(depth + 1); ws();
        if (text[i] === '}') { i++; return; }
        if (text[i++] !== ',') throw new Error('E_JSON_OBJECT');
      }
      throw new Error('E_JSON_OBJECT');
    }
    if (text[i] === '[') {
      i++; ws(); if (text[i] === ']') { i++; return; }
      while (i < text.length) {
        scan(depth + 1); ws(); if (text[i] === ']') { i++; return; }
        if (text[i++] !== ',') throw new Error('E_JSON_ARRAY');
      }
      throw new Error('E_JSON_ARRAY');
    }
    const m = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));
    if (!m) throw new Error('E_JSON_VALUE');
    i += m[0].length;
  }
  scan(0); ws(); if (i !== text.length) throw new Error('E_JSON_TRAILING');
  const result = JSON.parse(text);
  canonical(result); // finite numbers and valid Unicode, including decoded keys
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.stdout.write(canonical(parseJSON(readFileSync(0, 'utf8')))); }
  catch (e) { process.stderr.write(e.message + '\n'); process.exitCode = 1; }
}
