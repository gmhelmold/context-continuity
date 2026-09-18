/** SPEC-01: validated identity values. No persistence, host discovery or authority inference. */
import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { canonical } from './canonical.mjs';
import { closedRecord, ContractError, integer } from './validation.ts';

export type Scope = Readonly<{
  installation_id: string; adapter_id: string; workspace_id: string; host_session_id: string;
}>;
export type WorkContext = Readonly<{ task_id: string | null; phase_id: string | null }>;
export type SessionBinding = Readonly<{
  schema_version: 1; session_key: string; scope: Scope; incarnation: string; host_epoch: number;
}>;
export type ToolExecutionRef = Readonly<{ host_epoch: number; host_message_id: string; tool_call_id: string }>;

export class IdentityError extends Error {
  readonly code: 'E_SCOPE' | 'E_CONFLICT';
  constructor(code: 'E_SCOPE' | 'E_CONFLICT') {
    super(code === 'E_SCOPE' ? 'identity: session binding mismatch' : 'identity: conflicting native identity');
    this.name = 'IdentityError'; this.code = code;
  }
}

/** Internal IDs use canonical lowercase UUIDs, including UUIDv7 supplied by storage. */
export function entityId(input: unknown, field = 'entity_id'): string {
  if (typeof input !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input)) {
    throw new ContractError(field, 'expected a canonical UUID');
  }
  return input;
}
export const newEntityId = (): string => randomUUID();

/** External identities are opaque: never trim, case-fold, normalize or infer order. */
export function opaqueId(input: unknown, field = 'external_id'): string {
  if (typeof input !== 'string' || !input.isWellFormed() || Buffer.byteLength(input, 'utf8') < 1 || Buffer.byteLength(input, 'utf8') > 512) {
    throw new ContractError(field, 'expected 1..512 bytes of well-formed UTF-8');
  }
  return input;
}
export function digestValue(input: unknown, field = 'digest'): string {
  if (typeof input !== 'string' || !/^[0-9a-f]{64}$/.test(input)) throw new ContractError(field, 'expected a lowercase SHA-256 digest');
  return input;
}

/** Original source bytes are NOT normalized or JSON-encoded. */
export function hashSource(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) throw new ContractError('source', 'expected bytes');
  return createHash('sha256').update(bytes).digest('hex');
}
/** Includes every JSON field of the effective payload; has no provider-specific exclusions. */
export function hashPayload(payload: unknown): string {
  try { return createHash('sha256').update(canonical(payload), 'utf8').digest('hex'); }
  catch { throw new ContractError('payload', 'expected canonicalizable JSON'); }
}

export function parseScope(input: unknown): Scope {
  const fields = ['installation_id', 'adapter_id', 'workspace_id', 'host_session_id'];
  const v = closedRecord(input, fields, fields, 'scope');
  return Object.freeze({
    installation_id: entityId(v.installation_id, 'scope.installation_id'),
    adapter_id: opaqueId(v.adapter_id, 'scope.adapter_id'),
    workspace_id: entityId(v.workspace_id, 'scope.workspace_id'),
    host_session_id: opaqueId(v.host_session_id, 'scope.host_session_id'),
  });
}
export function sessionKey(input: unknown): string { return hashPayload(parseScope(input)); }

export function parseWorkContext(input: unknown): WorkContext {
  const v = closedRecord(input, ['task_id', 'phase_id'], ['task_id', 'phase_id'], 'work');
  return Object.freeze({
    task_id: v.task_id === null ? null : opaqueId(v.task_id, 'work.task_id'),
    phase_id: v.phase_id === null ? null : opaqueId(v.phase_id, 'work.phase_id'),
  });
}

/** Caller explicitly supplies the incarnation/epoch from authorized session lifecycle. */
export function createSessionBinding(scope: unknown, incarnation: unknown, hostEpoch: unknown): SessionBinding {
  const parsed = parseScope(scope);
  return Object.freeze({ schema_version: 1, session_key: sessionKey(parsed), scope: parsed,
    incarnation: entityId(incarnation, 'incarnation'), host_epoch: integer(hostEpoch, 0, Number.MAX_SAFE_INTEGER, 'host_epoch') });
}
export function parseSessionBinding(input: unknown): SessionBinding {
  const fields = ['schema_version', 'session_key', 'scope', 'incarnation', 'host_epoch'];
  const v = closedRecord(input, fields, fields, 'binding');
  integer(v.schema_version, 1, 1, 'binding.schema_version');
  const result = createSessionBinding(v.scope, v.incarnation, v.host_epoch);
  if (digestValue(v.session_key, 'binding.session_key') !== result.session_key) throw new IdentityError('E_SCOPE');
  return result;
}
export function assertSessionBinding(expected: unknown, actual: unknown): void {
  const a = parseSessionBinding(expected), b = parseSessionBinding(actual);
  if (a.session_key !== b.session_key || a.incarnation !== b.incarnation || a.host_epoch !== b.host_epoch) throw new IdentityError('E_SCOPE');
}
export function parseToolExecutionRef(input: unknown): ToolExecutionRef {
  const fields = ['host_epoch', 'host_message_id', 'tool_call_id'];
  const v = closedRecord(input, fields, fields, 'execution');
  return Object.freeze({ host_epoch: integer(v.host_epoch, 0, Number.MAX_SAFE_INTEGER, 'execution.host_epoch'),
    host_message_id: opaqueId(v.host_message_id, 'execution.host_message_id'), tool_call_id: opaqueId(v.tool_call_id, 'execution.tool_call_id') });
}
/** A stable key is not a receipt or an authorization cache. Storage must enforce uniqueness. */
export function toolExecutionKey(binding: unknown, execution: unknown): string {
  const b = parseSessionBinding(binding), e = parseToolExecutionRef(execution);
  if (e.host_epoch !== b.host_epoch) throw new IdentityError('E_SCOPE');
  return hashPayload({ session_key: b.session_key, incarnation: b.incarnation, ...e });
}
