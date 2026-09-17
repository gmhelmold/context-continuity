# SPEC-01 — contratos do núcleo e dos adaptadores

Normativo para [SPEC-CC-0.1](README.md). Estes são contratos novos do produto, não APIs já presentes em um host.

## 1. Regras de representação

JSON persistido usa `schema_version: 1`. Campos desconhecidos em objetos de controle/propostas são rejeitados. Dados nativos do host ficam em um campo opaco próprio, não são reinterpretados pelo núcleo. Números de sequência e revisão são inteiros não negativos, no máximo `Number.MAX_SAFE_INTEGER`; overflow é erro, nunca arredondamento. Datas são UTC ISO-8601; duração usa relógio monotônico durante o processo.

IDs internos são UUIDs criados pelo núcleo; IDs externos são strings opacas, de 1 a 512 bytes UTF-8. Não inferir timestamp, ordem ou projeto de um ID do host. Não usar título, path, texto de mensagem ou username como identidade de sessão.

`digest` é SHA-256 hexadecimal de bytes explicitamente definidos. Para metadados JSON: ordenar chaves recursivamente por ordem de code units UTF-16; preservar arrays; serializar sem espaços; rejeitar números não finitos, undefined e strings Unicode malformadas; usar UTF-8. Texto de conteúdo não é normalizado, trimado ou reformatado antes do hash. Strings `"1"` e números `1` permanecem distintos. Um digest interno não certifica verdade semântica.

## 2. Escopo e identidade

```ts
type Scope = {
  installation_id: string
  adapter_id: string
  workspace_id: string
  host_session_id: string
}

type SourceRef = {
  source_id: string
  revision: number
  digest: string
}

type SessionState = {
  session_key: string
  scope: Scope
  host_epoch: number
  view_revision: number
  policy_revision: number
  owner_fence: number
  mode: "complete" | "assisted" | "unsupported"
  paused: boolean
}
```

`session_key = sha256(canonicalJSON(Scope))`. Workspace é uma identidade persistida do produto, vinculada por configuração a um diretório/identidade canônica do host. Dois worktrees não são combinados automaticamente. Mover diretório exige reassociação explícita; não remapear pelo basename. Uma importação cria nova sessão de arquivo, sem assumir posse da sessão do host original.

Fonte é única dentro de `session_key`. Leitura, mutação, busca, exportação e exclusão sempre recebem escopo do adaptador autorizado, nunca da saída do modelo. IDs externos iguais em hosts diferentes não colidem.

## 3. Unidades de contexto

```ts
type ContextUnit = {
  unit_id: string
  source_refs: readonly SourceRef[]
  kind: "source" | "chapter" | "anchor" | "curated" | "synthetic"
  authority: "user" | "host" | "agent" | "external"
  native_refs: readonly string[]
  protocol_group: string
  completed: boolean
  protected: boolean
  estimated_tokens: number
  payload_ref: string
}
```

`native_refs` aponta para mensagens/partes na forma que o adaptador controla. Múltiplas mensagens podem formar um grupo indivisível: tool call + resultados, chamadas paralelas e blocos opacos associados. `completed` significa que o grupo está estruturalmente fechado, não que a tarefa foi aceita. Ordem é a ordem do array recebido, não a ordem lexicográfica de IDs.

Unidade sem fonte durável é inelegível para substituição. Unidade de mídia/estado opaco desconhecido é `protected`; o adaptador a preserva literalmente, inclusive metadados obrigatórios. Uma nova variante de parte não vira texto vazio.

Não inserir IDs artificialmente nas mensagens históricas para depois conseguir localizá-las: usar um manifesto no sufixo do fork. Conteúdo repetido com IDs diferentes permanece distinto.

## 4. Frame e snapshot

```ts
type Frame = {
  scope: Scope
  frame_id: string
  kind: "primary" | "native_compaction" | "maintenance" | "other"
  host_epoch: number
  units: readonly ContextUnit[]
  system_digest: string
  tools_digest: string | null
  generation_digest: string | null
  route_id: string
  model_id: string
  variant: string | null
  input_estimate: number
  estimate_kind: "provider" | "tokenizer" | "conservative"
  envelope: unknown // Handle em memória, pertencente ao adaptador.
}

type Snapshot = {
  snapshot_id: string
  session_key: string
  host_epoch: number
  view_revision: number
  policy_revision: number
  owner_fence: number
  frame_id: string
  ordered_units: readonly string[]
  covered_units: readonly string[]
  source_refs: readonly SourceRef[]
  source_digest: string
  prefix_digest: string
  frame_fingerprint: string
  feedback_ids: readonly string[]
  created_at: string
}
```

`source_digest` cobre a lista ordenada de `(unit_id, source_refs)` do intervalo. `prefix_digest` cobre unidades anteriores ao intervalo e suas revisões. `frame_fingerprint` cobre route/model/variant, system, tools e configurações relevantes que o adaptador conhece. Campos desconhecidos não podem ser preenchidos com hash de string vazia e apresentados como resolvidos.

O snapshot captura a visão já renderizada, incluindo capítulos ativos. Não reconstrói todo o ledger. As fontes e o manifesto são duráveis; o envelope nativo fica só em memória, sem bearer tokens ou objetos de execução no banco. Após crash, não reconstruir silenciosamente uma inferência incompleta a partir de um handle inválido.

## 5. Proposta produzida pelo modelo

O núcleo cria `job_id`, limites e hashes; o modelo NÃO os define. A resposta do clone é somente:

```ts
type Claim = {
  text: string
  sources: readonly number[] // Índices 1-based no manifesto do job.
}

type ModelProposal =
  | { schema_version: 1; action: "noop"; reason: string }
  | {
      schema_version: 1
      action: "replace"
      title: string
      outcome: readonly Claim[]
      decisions: readonly Claim[]
      open_items: readonly Claim[]
      constraints: readonly Claim[]
      evidence: readonly Claim[]
      warnings: readonly string[]
      feedback_applied: readonly string[]
    }
```

Limites: JSON total ≤256 KiB UTF-8; title 1..160 caracteres Unicode; reason 1..2000; cada claim 1..4000; no máximo 128 claims somados; sources não vazios, únicos e existentes; warnings ≤16 strings de até 1000; feedback_applied só pode citar os IDs entregues. Arrays vazios são válidos, mas `replace` exige pelo menos um claim e ganho após renderização. O modelo não devolve Markdown cercado por fences, comandos, IDs de outras sessões ou campos adicionais.

Um claim pode citar fonte original, capítulo ou âncora presente no manifesto. A referência mantém a natureza da origem: fonte de um resumo não é promovida a evidência direta de execução. Strings sobre status não alteram o scheduler de tarefas.

Validar formato não valida verdade. O orçamento e o texto final são calculados pelo núcleo. O capítulo adiciona a ressalva de resumo do agente e o corte observado. Pendências novas na cauda têm precedência temporal sem reescrever o registro histórico.

## 6. Overlay e capítulo

```ts
type Replacement = {
  replacement_id: string
  covered_units: readonly string[]
  expected_source_digest: string
  chapter_id: string
  summary_unit_id: string
}

type View = {
  session_key: string
  revision: number
  host_epoch: number
  replacements: readonly Replacement[]
  active_block_versions: readonly string[]
}

type Chapter = {
  chapter_id: string
  job_id: string
  session_key: string
  covered_units: readonly string[]
  source_refs: readonly SourceRef[]
  parent_chapters: readonly string[]
  proposal: ModelProposal
  status: "published" | "superseded" | "withdrawn"
  created_at: string
}
```

Uma proposta `noop` nunca produz capítulo. Ao consolidar capítulos, o overlay novo substitui os overlays cobertos; eles permanecem no histórico de revisões. `parent_chapters` é acíclico, só aponta para registros anteriores da mesma sessão. `superseded` significa substituído na visão, não fonte errada; `withdrawn` significa retirada autorizada, sem apagar automaticamente seus originais.

## 7. Contrato do adaptador

```ts
interface ContextAdapter {
  describe(): CapabilityReport
  normalize(input: unknown): Frame
  render(frame: Frame, view: View): unknown
  validate(envelope: unknown): ValidationResult
  fork(input: {
    frame: Frame
    snapshot: Snapshot
    mission: string
    signal: AbortSignal
  }): Promise<AuxiliaryResult>
}
```

`normalize`: somente dados da chamada atual; não aceita mistura de sessões. `render`: sem LLM/rede; aplica overlay exatamente uma vez e preserva o restante. `validate`: verifica pares de tools, blocos obrigatórios, orçamento, identidade e versões. `fork`: execução autorizada, assíncrona, cancelável, sem despacho de ferramentas; não altera a sessão principal. Exceções do provider viram erros tipados, não respostas sintéticas de sucesso.

O adaptador chama `core.onFrame(frame)` na fronteira real. Essa operação local seleciona a visão e retorna envelope/revisão; pode enfileirar trabalho, mas não aguarda `fork`. O adaptador chama `core.onHostReset(scope, cause)` antes de adotar nova epoch e `core.onUserInput(scope)` para invalidar jobs anteriores ao novo comando do usuário.

`AuxiliaryResult` contém `text`, uso normalizado ou `null`, `finish` (`complete`, `length`, `tool_call`, `cancelled`, `error`), `prefix_fidelity` (`verified`, `unverified`, `different`) e requestID de transporte quando disponível. `length`/`tool_call` não vira proposta publicável, mesmo com texto parcialmente parseável. Cancelamento não implica estorno do provider.

Nenhuma interface do núcleo importa `MessageV2`/`SessionV2` ou diretórios do host. O retorno do adaptador mantém a estrutura nativa; não há conversão genérica que descarte metadata desconhecida.

## 8. Capacidades e seleção de modo

CapabilityReport contém `adapter_id`, versão do adaptador, host/version/commit, route/model/variant, transport, autenticação por tipo (sem segredo), e evidências por capacidade. Cada evidência é `verified`, `declared`, `missing` ou `unknown`, com referência ao ensaio e data quando verificada.

Capacidades exigidas para `complete`: identidade inequívoca; acesso à visão ativa; substituição nas continuações; captura/retensão de fontes; reconhecimento de reset nativo; execução auxiliar isolada; validação do protocolo; handoff/desativação segura. Prefixo cacheável é capacidade adicional, não substituto de nenhuma delas.

Somente capacidades `verified` na combinação exata permitem complete. Configuração diferente invalida a homologação correspondente. `assisted` exige retenção e leitura autorizadas; injeção é oferecida apenas quando comprovada. `unsupported` não inicia manutenção nem fornece tools falsas. Instalação inicial não faz chamadas pagas para descobrir capacidades.

G-OC-01 pode usar endpoint de teste controlado para verificar protocolos sem chamar modelo real. Cache e qualidade precisam de ensaio live separado. O relatório não pode converter sucesso de fixture em cache medido.

## 9. Erros normativos

| Código | Efeito obrigatório |
|---|---|
| E_SCOPE | Recusar acesso; não revelar existência de dados de outro escopo. |
| E_CAPABILITY | Não executar operação não suportada; apresentar capacidade ausente. |
| E_SCHEMA | Rejeitar controle/proposta; reparo apenas nos limites de SPEC-02. |
| E_BUDGET | Não despachar request acima do orçamento; usar recuperação explícita. |
| E_NO_GAIN | Manter visão, registrar tentativa e rearmamento. |
| E_SOURCE | Não publicar síntese sem fonte exigida; busca informa ausência. |
| E_STALE | Rejeitar proposta por epoch, revisão, regras, origem ou fingerprint. |
| E_PROTOCOL | Não enviar envelope inválido; preservar estado anterior válido. |
| E_OWNER | Segundo proprietário vira observador e não publica nem gera. |
| E_STORAGE | Não publicar; informar falha de gravação/quota. |
| E_TIMEOUT | Cancelar geração, liberar slot sem marcar sucesso. |
| E_RATE | Respeitar orçamento de retry; pai tem prioridade. |
| E_TOOL | Recusar tools do clone sem executá-las; encerrar tentativa. |
| E_CANCELLED | Marcar cancelado; resposta tardia não ressuscita o job. |
| E_CURSOR | Cursor inválido/expirado não reinicia busca silenciosamente. |
| E_CONFLICT | Revisão esperada não coincide; não sobrescrever alteração concorrente. |

Erros têm `{code, retryable, message, job_id?}`. `message` não contém credenciais, prompt completo ou conteúdo de outra sessão. Logs não são o armazenamento de fontes. Códigos inéditos exigem revisão de schema/contrato, não catch-all que retorne sucesso.
