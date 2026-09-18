/** Shared canonical JSON primitive for the core and reference tools.
 * ECMAScript binary64 serialization + UTF-16 key order (RFC 8785).
 * Never apply to the original bytes of an archived source.
 */
import { createHash } from 'node:crypto';
/** @param {unknown} value @returns {string} */
export function canonical(value) {
  const ancestors = new Set();
  /** @param {unknown} v @param {number} depth @returns {string} */
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
      if (Object.getPrototypeOf(v) !== Array.prototype || Reflect.ownKeys(v).length !== v.length + 1) throw new Error('E_JSON_ARRAY');
      const items = [];
      for (let i = 0; i < v.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(v, String(i));
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('E_JSON_ARRAY');
        items.push(encode(descriptor.value, depth + 1));
      }
      result = '[' + items.join(',') + ']';
    } else {
      if (![Object.prototype, null].includes(Object.getPrototypeOf(v))) throw new Error('E_JSON_OBJECT');
      const keys = Reflect.ownKeys(v);
      if (keys.some(k => typeof k !== 'string')) throw new Error('E_JSON_OBJECT');
      const strings = /** @type {string[]} */ (keys);
      result = '{' + strings.sort().map(k => {
        const descriptor = Object.getOwnPropertyDescriptor(v, k);
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('E_JSON_ACCESSOR');
        return encode(k, depth + 1) + ':' + encode(descriptor.value, depth + 1);
      }).join(',') + '}';
    }
    ancestors.delete(v);
    return result;
  }
  return encode(value, 0);
}
/** @param {unknown} value @returns {string} */
export const hash = value => createHash('sha256').update(canonical(value), 'utf8').digest('hex');

// Detect duplicate decoded keys BEFORE JSON.parse loses them. JSON.parse remains
// the grammar/value authority; this scanner only adds duplicate/depth validation.
/** @param {string} text @returns {unknown} */
export function parseJSON(text) {
  if (typeof text !== "string") throw new Error("E_JSON_VALUE");
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
  /** @param {number} depth @returns {void} */
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
