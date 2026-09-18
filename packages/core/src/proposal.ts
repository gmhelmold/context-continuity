/** Strict model-output decoding. Structural acceptance is NOT semantic truth,
 * measured compression gain, source freshness at publication, or dispatch authority. */
import { Buffer } from 'node:buffer';
import { parseJSON } from './canonical.mjs';
import { choice, closedRecord, ContractError, integer } from './validation.ts';
import { assertSessionBinding, entityId, hashPayload } from './identity.ts';
import type { SessionBinding } from './identity.ts';
import { assertVerifiedManifest } from './manifest.ts';
import type { VerifiedManifest } from './manifest.ts';
import { contentString, dataList, distinct } from './contract-data.ts';
export type Claim = Readonly<{ text: string; sources: readonly number[] }>;
export type ReplacementProposal = Readonly<{ schema_version: 1; action: 'replace'; title: string;
  outcome: readonly Claim[]; decisions: readonly Claim[]; open_items: readonly Claim[];
  constraints: readonly Claim[]; evidence: readonly Claim[]; warnings: readonly string[]; feedback_applied: readonly string[] }>;
export type ModelProposal = Readonly<{ schema_version: 1; action: 'noop'; reason: string }> | ReplacementProposal;
declare const proposalBrand: unique symbol;
export type ValidatedProposal = Readonly<{ binding: SessionBinding; manifest_id: string; manifest_digest: string; proposal: ModelProposal; proposal_digest: string; [proposalBrand]: true }>;
const validated = new WeakSet<object>();
export const MAX_PROPOSAL_BYTES = 256 * 1024;
const CATEGORIES = ['outcome', 'decisions', 'open_items', 'constraints', 'evidence'] as const;
export class ProposalError extends Error {
  readonly code: 'E_PROTOCOL' | 'E_TOOL' | 'E_NO_GAIN';
  constructor(code: 'E_PROTOCOL' | 'E_TOOL' | 'E_NO_GAIN') { super('proposal: incomplete, forbidden or empty result'); this.name = 'ProposalError'; this.code = code; }
}
/** Finisher is supplied by the transport, never inferred from a string inside JSON. */
export function decodeProposal(text: unknown, finish: unknown, binding: unknown, manifestInput: unknown, feedbackInput: unknown = []): ValidatedProposal {
  const manifest = assertVerifiedManifest(binding, manifestInput);
  const terminal = choice(finish, ['complete', 'length', 'tool_call', 'cancelled', 'error'] as const, 'finish');
  if (terminal === 'tool_call') throw new ProposalError('E_TOOL');
  if (terminal !== 'complete') throw new ProposalError('E_PROTOCOL');
  if (typeof text !== 'string' || !text.isWellFormed() || Buffer.byteLength(text, 'utf8') > MAX_PROPOSAL_BYTES) throw new ContractError('proposal', 'expected bounded UTF-8 JSON');
  const delivered = dataList(feedbackInput, 32, 'feedback').map(x => entityId(x, 'feedback.id'));
  distinct(delivered, x => x, 'feedback');
  let parsed: unknown;
  try { parsed = parseJSON(text); } catch { throw new ContractError('proposal', 'invalid strict JSON'); }
  const all = ['schema_version', 'action', 'reason', 'title', ...CATEGORIES, 'warnings', 'feedback_applied'];
  const raw = closedRecord(parsed, all, ['schema_version', 'action'], 'proposal');
  integer(raw.schema_version, 1, 1, 'proposal.schema_version');
  const action = choice(raw.action, ['noop', 'replace'] as const, 'proposal.action');
  let proposal: ModelProposal;
  if (action === 'noop') {
    const fields = ['schema_version', 'action', 'reason'];
    const v = closedRecord(parsed, fields, fields, 'proposal.noop');
    proposal = Object.freeze({ schema_version: 1, action, reason: contentString(v.reason, 2000, 'proposal.reason') });
  } else {
    const fields = all.filter(x => x !== 'reason');
    const v = closedRecord(parsed, fields, fields, 'proposal.replace');
    let count = 0;
    const claims = (field: typeof CATEGORIES[number]): readonly Claim[] => {
      const items = dataList(v[field], 128, 'proposal.claims');
      count += items.length;
      if (count > 128) throw new ContractError('proposal.claims', 'total claim limit exceeded');
      return Object.freeze(items.map(item => {
        const c = closedRecord(item, ['text', 'sources'], ['text', 'sources'], 'claim');
        const sources = dataList(c.sources, manifest.manifest.entries.length, 'claim.sources').map(x => integer(x, 1, manifest.manifest.entries.length, 'claim.source'));
        if (!sources.length) throw new ContractError('claim.sources', 'at least one presented source is required');
        distinct(sources, x => x, 'claim.sources');
        for (const index of sources) {
          if (manifest.manifest.entries[index - 1]?.presented_as === 'reference_only') throw new ContractError('claim.sources', 'reference-only source cannot support content');
        }
        return Object.freeze({ text: contentString(c.text, 4000, 'claim.text'), sources: Object.freeze(sources) });
      }));
    };
    const outcome = claims('outcome'), decisions = claims('decisions'), open_items = claims('open_items'), constraints = claims('constraints'), evidence = claims('evidence');
    if (!count) throw new ProposalError('E_NO_GAIN');
    const warnings = dataList(v.warnings, 16, 'warnings').map(x => contentString(x, 1000, 'warning'));
    const applied = dataList(v.feedback_applied, 32, 'feedback_applied').map(x => entityId(x, 'feedback_applied.id'));
    distinct(applied, x => x, 'feedback_applied');
    if (applied.some(id => !delivered.includes(id))) throw new ContractError('feedback_applied', 'undelivered feedback reference');
    proposal = Object.freeze({ schema_version: 1, action, title: contentString(v.title, 160, 'proposal.title'), outcome, decisions, open_items, constraints, evidence,
      warnings: Object.freeze(warnings), feedback_applied: Object.freeze(applied) });
  }
  const result = Object.freeze({ binding: manifest.binding, manifest_id: manifest.manifest.manifest_id, manifest_digest: manifest.digest,
    proposal, proposal_digest: hashPayload(proposal) }) as ValidatedProposal;
  validated.add(result);
  return result;
}
/** A proposal must remain bound to this exact job manifest and session incarnation. */
export function assertProposalContext(binding: unknown, manifestInput: unknown, input: unknown): ValidatedProposal {
  const manifest: VerifiedManifest = assertVerifiedManifest(binding, manifestInput);
  if (input === null || typeof input !== 'object' || !validated.has(input)) throw new ContractError('proposal', 'expected a validated proposal');
  const result = input as ValidatedProposal;
  assertSessionBinding(binding, result.binding);
  if (result.manifest_id !== manifest.manifest.manifest_id || result.manifest_digest !== manifest.digest) throw new ContractError('proposal.manifest', 'manifest mismatch');
  return result;
}
