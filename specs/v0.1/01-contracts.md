# SPEC-01 — contratos do núcleo e dos adaptadores

Revisão 0.1.1. Normativo para [SPEC-CC-0.1](README.md). Contratos de produto proposto, não APIs implementadas dos hosts. Resolve B01–B05/B08–B10 da REVIEW-002.

## 1. Representação e identidades

Objetos de controle usam `schema_version: 1` e rejeitam campos adicionais. Inteiros de contadores/revisões estão em 0..Number.MAX_SAFE_INTEGER; overflow falha. Datas UTC ISO-8601; deadlines do processo usam relógio monotônico. IDs de entidades são UUIDs gerados pelo núcleo. IDs externos são strings opacas de 1..512 bytes UTF-8; nunca inferir ordem de timestamp, texto ou nome.

`canonicalJSON`: chaves ordenadas recursivamente por code units UTF-16; arrays preservados; JSON sem espaços; UTF-8; rejeitar undefined, números não finitos e Unicode malformado. Strings de conteúdo não são normalizadas/trimadas. `sha256` produz 64 caracteres hexadecimais minúsculos. Código de hash tem vetores de referência; JSON nativo incompatível deve ser protegido, não descartado.

```ts
type Scope = {
  installation_id: string
  adapter_id: string
  workspace_id: string
  host_session_id: string
}
type WorkContext = { task_id: string | null; phase_id: string | null }
type SourceRef = { source_id: string; revision: number; digest: string }
type RootRef = { unit_id: string; revision: number; unit_digest: string }
type BlockRef = { block_id: string; version: number; digest: string }
type ChapterRef = { chapter_id: string; digest: string }
type SessionState = {
  session_key: string
  incarnation: string
  scope: Scope
  host_epoch: number
  view_revision: number
  policy_revision: number
  owner_fence: number
  publication_seq: number
  mode: "complete" | "assisted" | "unsupported"
  paused: boolean
}
```

`session_key=sha256(canonicalJSON(Scope))`. `incarnation` muda somente numa reativação explícita após exclusão; callbacks nunca criam sessões. Workspace do produto é associado por configuração à identidade do host, não pelo basename. Worktrees permanecem separados. WorkContext vem do fluxo autorizado; ausência é null, nunca inferida do texto do modelo. Busca e publicação sempre usam Scope/incarnation vindos da integração.

## 2. Raízes, unidades e identidade do conteúdo efetivo

```ts
type Unit = {
  unit_id: string
  revision: number
  kind: "root" | "chapter" | "block" | "marker"
  authority: "user" | "host" | "agent" | "external"
  protocol_group: string
  completed: boolean
  protected: boolean
  native_refs: readonly string[]
  source_refs: readonly SourceRef[]
  root_coverage: readonly RootRef[]
  payload_ref: string
  payload_digest: string
  unit_digest: string
  estimated_tokens: number
}
```

Uma raiz corresponde à unidade de protocolo pública do host: um turno ou grupo indivisível de calls/results. `completed` significa protocolo encerrado, não aceite de tarefa. A raiz tem root_coverage de si própria; capítulo cobre raízes; bloco/marker não pode fingir cobertura de mensagem. Unidade desconhecida ou não retida fica protegida. Não dividir blocos opacos, signatures ou relações de ferramentas.

Persistir mapa `(session_key, incarnation, host_epoch, native_identity) -> unit_id` antes de usar a raiz num snapshot. `native_identity` é identidade pública de mensagens/partes, com agrupamento e ordem definidos pelo adaptador. Mesmos textos com IDs diferentes não se fundem. Sem mapeamento inequívoco o frame não é editável. Mudança de payload sob o mesmo ID incrementa revisão; reinício recupera o mapa, não sorteia novas identidades.

`payload_digest=sha256(canonicalJSON(payload_nativo_efetivo))`, preservando papel, conteúdo, calls, resultados e todo metadata no corpo. Bytes binários usam SHA-256 dos bytes; a estrutura contém digest/tamanho e o conteúdo continua disponível no envelope opaco. Nenhum campo do corpo é excluído como supostamente irrelevante. Somente headers de transporte listados no perfil ficam fora; auth não entra no hash nem na persistência.

`unit_digest=sha256(canonicalJSON({unit_id,revision,kind,authority,protocol_group,completed,protected,native_refs,source_refs,payload_digest}))`. Hash de fonte não substitui hash de unidade. Alterar papel/payload com as mesmas source_refs invalida a unidade. `input_digest` cobre unidades ORDENADAS e system/tools/options finais. `config_digest` cobre modelo/rota/variante e campos não históricos do corpo final. Uma mudança não observável nunca vira hash vazio válido.

## 3. Captura em fases

```ts
type Capture = {
  capture_id: string
  scope: Scope
  incarnation: string
  host_epoch: number
  work: WorkContext
  native_identity_map: unknown
  kind: "primary" | "native_compaction" | "maintenance" | "other"
}
type SealedFrame = {
  capture: Capture
  frame_id: string
  roots: readonly Unit[]
  system_digest: string
  tools_digest: string
  config_digest: string
  input_digest: string
  route_id: string
  model_id: string
  variant: string | null
  input_estimate: number
  envelope: unknown
}
```

Capture é parcial e NÃO autoriza publicação/geração. SealedFrame só existe depois de todos os transforms, defaults e lowering do request relevante. Seu envelope fica em memória no adaptador, sem credenciais no banco. O adaptador deve poder impedir envio se a validação terminal falhar. Não esperar hooks futuros dentro de um hook anterior: isso cria dependência circular do host.

O núcleo renderiza a View vigente sobre `roots`, formando EffectiveFrame. Snapshot é tirado DESSE resultado, não do histórico bruto. Seleção/publicação usa o Frame final atual; geração usa a cópia imutável do EffectiveFrame capturado. O contrato do perfil inicial está em [SPEC-04](04-opencode.md).

```ts
type Snapshot = {
  snapshot_id: string
  session_key: string
  incarnation: string
  host_epoch: number
  view_revision: number
  policy_revision: number
  owner_fence: number
  frame_id: string
  logical_coverage: readonly string[]
  root_coverage: readonly RootRef[]
  read_dependencies: readonly EntityRef[]
  prefix_digest: string
  coverage_digest: string
  config_digest: string
  effective_input_digest: string
  manifest_id: string
  manifest_digest: string
  feedback_ids: readonly string[]
  work: WorkContext
  created_at: string
}
```

`logical_coverage` identifica as unidades da View lidas; `root_coverage` é a expansão achatada, ordenada e sem duplicação em raízes do host. `coverage_digest` inclui RootRefs e unit_digests das unidades lógicas; `prefix_digest` inclui unidades efetivas antes do intervalo. `read_dependencies` inclui TODAS as entidades que o clone recebeu, não apenas as citações que resolveu devolver: uma regra pode influenciar texto mesmo sem ser citada.

## 4. Manifesto congelado e citações

```ts
type EntityRef =
  | { kind: "source"; ref: SourceRef }
  | { kind: "chapter"; ref: ChapterRef }
  | { kind: "block"; ref: BlockRef }
type ManifestEntry = {
  index: number
  entity: EntityRef
  authority: "user" | "host" | "agent" | "external"
  range: { start_byte: number; end_byte: number }
  excerpt_digest: string
  presented_as: "full" | "excerpt" | "reference_only"
  locator: string
}
type Manifest = { schema_version: 1; manifest_id: string; entries: readonly ManifestEntry[] }
```

Ranges UTF-8 são bytes 0-based `[start,end)` da representação citável retida. Capítulo possui bytes de sua síntese canônica; bloco possui bytes da versão literal; fonte possui bytes originais. Cada item congela índice contíguo 1..N, tipo/revisão/digest, recorte e autoridade. `locator` é descrição delimitadora apresentada no sufixo, não path autorizado. Conteúdo repetido recebe locators distintos ou fica inelegível para citação inequívoca. `reference_only` permite navegação, não sustenta Claim de conteúdo não lido.

Ordenação é congelada ANTES da geração, junto com os bytes exatos da missão. Não reconstruir manifesto de uma lista de fontes após a resposta. Persistir Manifest e seu digest no job e vinculá-lo ao capítulo. Índices não são globais; `Claim.sources=[2]` sempre significa Manifest(job)[2]. Limitar manifesto+feedback dentro da reserva da missão; se exceder, reduzir intervalo por grupos antes de capturar ou retornar E_BUDGET, nunca omitir origem de Claim em silêncio.

## 5. Proposta e notas de retenção

```ts
type Claim = { text: string; sources: readonly number[] }
type ModelProposal =
  | { schema_version: 1; action: "noop"; reason: string }
  | {
      schema_version: 1; action: "replace"; title: string
      outcome: readonly Claim[]; decisions: readonly Claim[]
      open_items: readonly Claim[]; constraints: readonly Claim[]
      evidence: readonly Claim[]; warnings: readonly string[]
      feedback_applied: readonly string[]
    }
```

JSON ≤256 KiB; title 1..160 code points, reason 1..2000, claim 1..4000; 128 claims no total; indices de sources únicos, existentes e não reference_only. Warnings ≤16 de 1000 code points. Replace exige claim e ganho real ≥M; noop não publica capítulo. Resposta truncada ou finish tool_call nunca é proposta publicável. IDs de controle, notas, datas e hashes NÃO vêm do modelo.

**Dono das notas:** política determinística do núcleo a partir de recibos, não campo oculto do maintainer. O clone apenas considera o feedback e devolve claims. Algoritmo/expiração em SPEC-05. Não há canal paralelo para introduzir notas com autoridade superior.

## 6. View materializada e capítulos

```ts
type Replacement = {
  replacement_id: string
  root_coverage: readonly RootRef[]
  chapter: ChapterRef
  summary_unit_id: string
}
type View = {
  session_key: string; incarnation: string; revision: number; host_epoch: number
  policy_revision: number
  replacements: readonly Replacement[]
  active_blocks: readonly { ref: BlockRef; activation_ordinal: number }[]
  suppressed_roots: readonly RootRef[]
}
type Chapter = {
  chapter_id: string; session_key: string; digest: string | null // null somente redacted
  operation_id: string
  logical_coverage: readonly string[]
  root_coverage: readonly RootRef[]
  parent_chapters: readonly ChapterRef[]
  read_dependencies: readonly EntityRef[]
  manifest_id: string
  proposal: Exclude<ModelProposal, { action: "noop" }> | null // null somente redacted
  status: "published" | "superseded" | "invalidated" | "withdrawn" | "redacted"
}
```

View é a única seleção autoritativa: persistir todos os blocos e replacements vigentes na mesma revisão. `blocks.active` não existe como segundo ponteiro. Capítulos são imutáveis, salvo remoção de conteúdo autorizada; status pode mudar. `operation_id` aponta para operação de geração OU humana, sem inventar job de LLM. `supersedes` é relação histórica distinta de read_dependency. Projeção, invalidação e operações estão fechadas em [SPEC-07](07-state-operations.md).

## 7. Adaptador terminal e executor

```ts
interface ContextAdapter {
  describe(): CapabilityReport
  capture(input: unknown): Capture
  seal(capture: Capture, finalRequest: unknown): SealedFrame
  render(frame: SealedFrame, view: View): RenderedFrame
  validate(frame: RenderedFrame): ValidationResult
  auxiliary: AuxiliaryExecutor
}
interface AuxiliaryExecutor {
  start(input: { run_id: string; frame: RenderedFrame; mission: string;
    permit: AttemptPermit; signal: AbortSignal }): Promise<AuxiliaryResult>
  stop(run_id: string): Promise<{ local_stopped: boolean; remote_state: "confirmed" | "unknown" }>
}
```

RenderedFrame contém envelope nativo, unidades efetivas e digests; ValidationResult é `{ok:true,input_tokens}` ou `{ok:false,error}`. AttemptPermit identifica `(job_id,attempt_no,owner_fence,incarnation,deadline)` e tem consumo único antes de cada HTTP request auxiliar. SDK retries, redirect automático, continuations e tools estão desabilitados no executor. O host não é o executor auxiliar selecionado no perfil inicial.

`core.capture` não publica. No ponto terminal `core.finalize(sealedFrame)` adquire exclusão local por sessão, revalida estado atual, renderiza cópia, valida, publica CAS e devolve despacho ou erro. Não espera LLM nem executa rede. `core.onDispatch/Response` recebe evidência observável; ausência permanece null. Mudança depois de seal proíbe envio e exige novo frame, sem reparar às escondidas.

AuxiliaryResult: text, finish (`complete|length|tool_call|cancelled|error`), usage|null, fidelity (`verified|unverified|different`), request_id|null. `verified` inclui conteúdo ativo E configuração, não cache hit. Erros são tipados. Signal cancela o executor local; não prova interrupção/estorno no provider remoto.

## 8. Capacidades: uma única regra

CapabilityReport identifica host/commit, adapter/codec version, rota/modelo/variante/transporte/auth-type, hash de configuração e ordem dos plugins. Evidência por capacidade: `verified|declared|missing|unknown`; fidelity: `verified|unverified|different`. Dados de teste sintético não homologam modelo live.

`complete = all(required == verified) AND fidelity == verified AND runtime_gate == pass`.

Required: identity, root_mapping, final_capture, final_veto, substitution, source_retention, reset_detection, isolated_auxiliary, physical_attempt_admission, cancellation_local, protocol_validation, safe_handoff. Cache observado não participa da conjunção. Qualquer unknown/declared/missing ou fidelity diferente proíbe complete. Assisted só com retenção e leitura verified e consentimento específico; sem downgrade automático.

| Capacidades required | Fidelity | Gate runtime | Cache | Modo completo |
|---|---|---|---|---|
| todas verified | verified | pass | miss/unknown/hit | permitido |
| uma unknown/missing/declared | qualquer | qualquer | qualquer | proibido |
| todas verified | unverified/different | qualquer | hit ou outro | proibido |
| todas verified | verified | not_run/fail/blocked | qualquer | proibido |

`investigation=complete` significa relatório terminado, não product_mode=complete. Um ensaio negativo encerra a investigação mas não habilita o produto. Token budget não é reduzido pelo cache.

## 9. Erros

Todos: `{code,retryable,message,job_id?}` sem prompts/segredos. E_SCOPE acesso recusado; E_CAPABILITY capacidade ausente; E_SCHEMA formato inválido; E_BUDGET limite insuficiente; E_NO_GAIN sem poda; E_SOURCE fonte ausente; E_STALE snapshot antigo; E_PROTOCOL envelope inválido; E_OWNER fence inválido; E_STORAGE I/O/quota; E_TIMEOUT deadline; E_RATE limitação; E_TOOL tool auxiliar recusada; E_CANCELLED execução cancelada; E_CURSOR cursor inválido; E_CONFLICT versão/plano divergente. Nenhum catch transforma erro em sucesso.
