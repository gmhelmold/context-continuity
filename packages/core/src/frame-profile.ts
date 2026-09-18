/** Explicit terminal JSON profile. A profile is configuration, not host certification. */
import { closedRecord, ContractError, integer } from './validation.ts';
import { hashPayload, opaqueId } from './identity.ts';
import { dataList, distinct } from './contract-data.ts';
import type { JsonValue } from './contract-data.ts';
import { parseModelLimits } from './config.ts';
import type { ModelLimits } from './config.ts';
import type { RootUnit } from './roots.ts';
export type ProtocolGroup = Readonly<{ unit: RootUnit; items: readonly JsonValue[] }>;
export type ProtocolCheck = (groups: readonly ProtocolGroup[]) => boolean;
export type JSONFrameProfileSpec = Readonly<{
  schema_version: 1; profile_id: string; revision: number; route_id: string;
  model_id: string; model_key: string; model_aliases: readonly string[];
  variant: string | null; variant_key: string | null; history_key: string; limits: ModelLimits;
}>;
declare const profileBrand: unique symbol;
export type JSONFrameProfile = Readonly<{ spec: JSONFrameProfileSpec; digest: string; [profileBrand]: true }>;
const checks = new WeakMap<object, ProtocolCheck>();
/** The codec supplies a protocol checker for this explicit version; there is no generic text fallback. */
export function createJSONFrameProfile(input: unknown, check: ProtocolCheck): JSONFrameProfile {
  const fields=['schema_version','profile_id','revision','route_id','model_id','model_key','model_aliases','variant','variant_key','history_key','limits'];
  const v=closedRecord(input,fields,fields,'profile');
  integer(v.schema_version,1,1,'profile.schema_version');
  if(typeof check!=='function')throw new ContractError('profile.protocol','expected an explicit protocol checker');
  const aliases=dataList(v.model_aliases,128,'profile.aliases').map(x=>opaqueId(x,'profile.alias'));
  if(!aliases.length)throw new ContractError('profile.aliases','at least one exact wire identity is required');
  distinct(aliases,x=>x,'profile.aliases');
  const spec: JSONFrameProfileSpec=Object.freeze({schema_version:1,profile_id:opaqueId(v.profile_id),revision:integer(v.revision,1,Number.MAX_SAFE_INTEGER,'profile.revision'),
    route_id:opaqueId(v.route_id),model_id:opaqueId(v.model_id),model_key:opaqueId(v.model_key),model_aliases:Object.freeze(aliases),
    variant:v.variant===null?null:opaqueId(v.variant),variant_key:v.variant_key===null?null:opaqueId(v.variant_key),history_key:opaqueId(v.history_key),limits:parseModelLimits(v.limits)});
  if((spec.variant===null)!==(spec.variant_key===null))throw new ContractError('profile.variant','variant and wire key must be specified together');
  distinct([spec.history_key,spec.model_key,...(spec.variant_key===null?[]:[spec.variant_key])],x=>x,'profile.keys');
  const result=Object.freeze({spec,digest:hashPayload(spec)}) as JSONFrameProfile;
  checks.set(result,check);return result;
}
export function assertJSONFrameProfile(input: unknown): JSONFrameProfile {
  if(input===null||typeof input!=='object'||!checks.has(input))throw new ContractError('profile','expected a configured terminal profile');
  return input as JSONFrameProfile;
}
/** Check exact aliases and declared layout before allocating a sealed frame. */
export function profileMatches(profile: JSONFrameProfile, body: Readonly<Record<string,JsonValue>>,
  layout: Readonly<{route_id:string;model_id:string;variant:string|null;history_key:string}>): boolean {
  const p=assertJSONFrameProfile(profile).spec;
  if(layout.route_id!==p.route_id||layout.model_id!==p.model_id||layout.variant!==p.variant||layout.history_key!==p.history_key)return false;
  if(!Object.hasOwn(body,p.model_key)||typeof body[p.model_key]!=='string'||!p.model_aliases.includes(body[p.model_key] as string))return false;
  return p.variant_key===null||(Object.hasOwn(body,p.variant_key)&&body[p.variant_key]===p.variant);
}
export function profileAcceptsGroups(profile: JSONFrameProfile, groups: readonly ProtocolGroup[]): boolean {
  const selected=assertJSONFrameProfile(profile),check=checks.get(selected)!;
  try {return check(groups)===true;} catch {return false;}
}
