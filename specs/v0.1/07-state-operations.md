# SPEC-07 — projeção, operações e portabilidade

Normativo, revisão 0.1.2. Tipos em [SPEC-01](01-contracts.md), transações em [SPEC-03](03-ledger.md). Sem runtime implementado. Fecha composição e mudanças de estado B02/B05/B06/B11.

## 1. Projeção achatada, sem replay de resumos

A base física é o array ordenado de raízes da epoch ATUAL do host. A base lógica é esse array após aplicar a View atual. Cada Replacement guarda `root_coverage` achatada, não uma receita que exige encontrar S1 no transcript bruto.

Algoritmo normativo:

1. Validar escopo/incarnation/epoch, unicidade e ordem das raízes. Resolver cada RootRef pela identidade e unit_digest; igualdade textual não substitui identidade.
2. Validar que a cobertura de cada replacement é contígua na base física, não vazia, sem raízes protegidas ou grupos cortados. Replacements ativos não se sobrepõem. Falha é E_STALE/E_PROTOCOL, nunca append de resumo no fim.
3. Ordenar replacements pelo primeiro índice físico. Percorrer raízes uma vez: no início de cobertura emitir a unidade sintética persistida e saltar exatamente as raízes cobertas; fora dela emitir raiz original intacta. A cauda é o restante dessa mesma travessia, não um segundo append.
4. Inserir os blocos da View em posição fixada pelo codec; preservar ordinal/bytes. Suppressed roots têm marcador de retirada sem conteúdo, com identidade estável, quando o protocolo permitir; senão E_SOURCE e bloquear despacho até rebase público. Não reidratar fonte redacted.
5. Validar protocolo e orçamento do envelope completo. Nenhuma transformação muta o snapshot que já foi enviado.

Preparar consolidação: selecionar unidades lógicas contíguas; expandir cada capítulo para sua root_coverage, cada raiz para si. A união ordenada deve continuar contígua na base física; nenhum capítulo pode ser cortado parcialmente. Remover todos os replacements integralmente incluídos e inserir um novo replacement dessa união. Lineage guarda capítulos anteriores; renderer NÃO precisa executar seus overlays históricos.

```text
Base: A B C D E F
V1: coverage=[B,C] -> S1
V2: selecionar [S1,D]; achatar -> coverage=[B,C,D] -> S2
Base seguinte: A B C D E F G
Render V2: A S2 E F G
```

Conteúdo repetido mantém identidades diferentes. Ordem não usa timestamps. Reset nativo cria nova epoch e nova base; arquivar overlays anteriores. O perfil inicial aceita apenas entradas brutas do host na sua fronteira terminal. Outro adaptador pode aceitar entrada já projetada SOMENTE com envelope sidecar autenticado contendo view_revision/root-map e comprovação de igualdade; não reconhecer um resumo pela frase ou por um ID controlado pelo modelo. Nesse caso, mesma revisão é no-op, revisão diferente exige materializar raízes originais ou recusar.

## 2. Dependências, estado vigente e exclusão

Todo capítulo registra `read_dependencies` de todas as fontes, capítulos e blocos apresentados ao clone, além de root_coverage e manifesto. Persistir arestas tipadas `content` e `history`. O campo supersedes gera history; nunca declara dependência de verdade no texto corrigido. Arestas content só apontam para entidades anteriores, da mesma sessão. Correção, revogação ou mutação calcula fechamento reverso de content, inclusive através de capítulos já superseded.

**Supersessão normal:** origem continua legível como histórica; descendentes content ficam invalidated, saem da View e não são usados em futuras sínteses como estado atual. Retirar overlays inválidos materializa raízes ATUAIS verificadas, não snapshots antigos. Novo bloco/correção entra na mesma View. Se a expansão exceder orçamento, persistir a invalidação e estado `dispatch_blocked`; proibir próxima inferência até compactação/rebase público ou intervenção explícita. Nunca conservar derivado inválido apenas para caber.

**Revogar uma regra:** atualizar bloco, invalidar capítulos que a receberam (mesmo sem citação) e seus descendentes. Informação histórica de que a regra existiu pode permanecer no ledger com etiqueta revoked/invalidated, mas não como âncora vigente. O wrapper da View registra somente a versão corrente ou marcador curto de revogação.

**Exclusão/redação:** retirar bytes da origem e de TODAS as cópias gerenciadas derivadas (sínteses, manifests com excertos, propostas, índices, notas e exportações temporárias). Manter só IDs, hashes quando autorizados e status redacted/tombstone. Retirar descendentes da View e invalidar cursores. Backups gerenciados são registrados num catálogo local e apagados integralmente se contiverem o escopo excluído; não prometer apagar cópias exportadas pelo usuário nem remanência física. Se um arquivo gerenciado não puder ser removido, operação fica `cleanup_pending` com erro, não declara exclusão completa.

A política de exclusão guarda tombstones da identidade pública da fonte, independentemente de digest, para impedir recaptura automática do mesmo segredo no próximo frame do host. Retomar captura exige autorização explícita. Exclusão de sessão retira conteúdo e mantém tombstone de Scope/incarnation; reativação gera incarnation nova. Callback antigo jamais remove tombstone ou inicia nova sessão.

## 3. Operações humanas são operações, não jobs fictícios

Todas recebem Scope/incarnation autorizado, `request_id` UUID idempotente e `expected_view_revision`. Registro Operation contém `operation_id`, kind, actor (`user|authorized_flow|maintenance`), `input_digest`, `job_id|null`, `status`, expected/result revision e timestamps. Mesmo request_id com input diferente retorna E_CONFLICT. Manutenção é única operação com job_id; edição humana não faz inferência implícita.

### 3.1 Blocos

Entrada: `{request_id, expected_view_revision, action:pin|activate|replace|deactivate, block_id?, expected_version?, kind?, authority?, text?, sources?, scope?}`. Autoridade é validada contra ator; campos não aplicáveis são recusados. expected_version obrigatório para alterar bloco existente.

Sob transação: conferir fence/versões, criar versão imutável, atribuir ordinal crescente na primeira ativação; replace ativo mantém ordinal; reativação após deactivate recebe ordinal novo. Calcular invalidação content, criar View revision+1 com conjunto EXATO de versões/ordinais e overlays remanescentes, incrementar policy_revision, cancelar jobs e registrar Operation. Atualização funciona em pause e sem job. Nenhum `active` externo à View decide o próximo prompt.

### 3.2 Correção manual de capítulo

Entrada: `{request_id, expected_view_revision, chapter_id, expected_chapter_digest, title, proposal, manifest}`. Proposal obedece schema Claim; autor é humano e origem explícita. Fontes citadas precisam ser legíveis/autorizadas; indices congelados no novo manifesto. Validação estrutural não transforma opinião humana em teste executado.

Se alvo participa da View, a correção conserva a MESMA root_coverage e posição, cria Chapter novo/Operation sem job, relation history:supersedes, invalida descendentes content e publica View atomicamente. Não herdar automaticamente read_dependencies do texto incorreto. Dependências novas vêm do manifesto/cobertura usados na correção. Se alvo já está superseded, corrigir somente seu arquivo, invalidar descendentes correntes e apresentar expansão/revisão; não enfiar o capítulo antigo de volta por conveniência. Orçamento insuficiente bloqueia despacho após registrar a correção.

### 3.3 Restore com expansão explícita

Entrada de preview: `{chapter_id, root_selection?:RootRef[], expected_view_revision}`. Range textual dentro de uma raiz NÃO é operação de restore; usar context_read. No MVP restore trabalha com raízes/grupos completos.

Preview calcula os replacements que contêm qualquer raiz selecionada. Para cada um, expandir seleção à cobertura INTEIRA: não há algoritmo autorizado que invente a parte restante de um resumo. Retornar `{plan_id, plan_digest, requested_roots, expanded_roots, resulting_input_estimate, extra_roots, fits}`. Plano tem validade de 15 min e vincula View/epoch/policy/fonte atual. Sem expansão, ainda exige commit explícito.

Commit: `{request_id, plan_id, plan_digest, expected_view_revision, accept_expansion:boolean}`. Se extra_roots não vazio e accept_expansion=false, E_CONFLICT sem mutação. Se fontes ausentes/redacted, E_SOURCE; se não couber, E_BUDGET sem revisão nova e oferecer leitura seletiva. Caso válido, remover replacements envolvidos, manter todos os demais e a cauda corrente, publicar View/Operation sem LLM. Restore S2 parcialmente resulta em materialização integral de B,C,D apenas após consentimento; não tenta recompor S1 de memória.

## 4. Manifesto de exportação fechado

Exportação cria diretório novo privado, nunca zip autoextraído nem sobrescrita. Snapshot consistente da sessão sob lock de armazenamento; blobs referenciados recebem retenção até terminar. Schema de arquivos:

```ts
type ArchiveManifest = {
  schema_version: 2
  archive_id: string
  origin: { adapter_id: string; session_key: string; incarnation: string }
  created_at: string
  records_path: "records.json"
  records_digest: string
  files: readonly { path: string; digest: string; size_bytes: number; media_type: string }[]
}
type ArchiveRecords = {
  schema_version: 2
  sources: readonly ArchiveSource[]
  manifests: readonly Manifest[]
  chapters: readonly ArchiveChapter[]
  blocks: readonly ArchiveBlock[]
  operations: readonly ArchiveOperation[]
  dependencies: readonly ArchiveDependency[]
}
```

ArchiveSource = SourceRef (digest null permitido apenas em registro indisponível/redacted, nunca em citação válida) + availability + media_type + size_bytes + `file_path:string|null` + native_refs; ArchiveChapter = Omit<Chapter, "root_coverage" | "logical_coverage"> + OriginCoverage abaixo; `proposal:null` permitido SÓ para redacted; ArchiveBlock = BlockRef + kind/authority/text|null/scope/created_at; ArchiveOperation = operation_id/kind/actor/input_digest/job_id|null/created_at (job_id é proveniência histórica opaca, não job importado); ArchiveDependency = from EntityRef/to EntityRef/relation content|history. Tipos e limites não relacionados são os de SPEC-01; campos adicionais são rejeitados. Arrays são ordenados por ID/revisão e digests canônicos; manifesto de Claim conserva índice, kind, recorte e autoridade.

### Cobertura de origem é proveniência, não unidade executável (C10)

```ts
type OriginCoverage = {
  origin_coverage: {
    adapter_id: string; session_key: string; incarnation: string; host_epoch: number
    roots: readonly RootRef[]
    logical_ids: readonly string[]
  }
}
```

Cada capítulo exportado carrega este objeto, com IDs/hashes originais. RootRef e logical_ids dentro de origin_coverage são **opacos de origem**: não são refs para root_units locais nem autorização para reconstruir input. O arquivo não afirma comprovar correspondência ao request do host; não infere agrupamento a partir de textos/native_refs. Leitura de capítulo expõe essa proveniência como tal. Restore em sessão ativa a partir dessas refs é E_CAPABILITY.

Validar domínio/formatos/revisões, unicidade/ordem declarada, origem igual ao manifesto, host_epoch igual ao capítulo e consistência do digest para o mesmo `(origin,epoch,unit_id,revision)` em todos os capítulos. Dependências source/chapter/block/manifest continuam resolvíveis integralmente no próprio arquivo. Um RootRef opaco nunca pode ocupar EntityRef de uma claim. Cobertura opaca vazia só quando capítulo redacted ou operação sem cobertura já definida. logical_ids ficam identificadores históricos, não resolvidos por busca textual.

Import NÃO remapeia nenhum ID/digest dentro de origin_coverage, nem consulta o banco/host antigo. Remapeia apenas entidades locais resolvíveis e preserva origin_digest do registro completo de origem. O agrupamento original está disponível como proveniência, mas bytes de wire não são reconstruídos. Archive schema 2 é incompatível com o rascunho anterior: recusar schema 1, sem migrar por adivinhação. Não há arquivo de usuário a migrar nesta fase.

Somente `records.json` e `sources/<digest-prefix>/<digest>` são paths permitidos; arquivos únicos e totalmente enumerados. Fontes inline também viram files. Sem variáveis de ambiente, headers, request envelope, credenciais, jobs executáveis, emissions, View ativa ou leases. Bytes excluídos têm file_path=null e disponibilidade explícita, não arquivo vazio fingindo captura. Limites: manifest 8 MiB, records 64 MiB, até 100000 records e quota restante do workspace; por fonte permanece limite da captura. Falha de quota remove apenas staging criado pela operação.

## 5. Importação e round-trip

Import valida integralmente schema, limites antes de alocar, digests, paths relativos exatos, ausência de links, arquivos inesperados, ranges UTF-8, índices, DAG, refs e status. Nenhum dado é executado. Registros inválidos não entram parcialmente no namespace visível.

Criar `archive_namespace` UUID novo e mapear de forma determinística `(namespace,kind,old_id)` para IDs locais via tabela persistida; preservar revisões e bytes de conteúdo. Reescrever todas as refs LOCAIS resolvíveis (sources, manifests, chapters, blocks, operations, deps), excluindo explicitamente origin_coverage em passe único validado; conservar IDs originais em mapa de proveniência, separado da autorização. Recalcular digests de records com IDs remapeados; conservar `origin_digest` verificável para manifesto/capítulo original. Indices de Claim e excerpt_digest NÃO mudam. Nenhum import assume host_session_id original, cria lease ou ativa bloco.

Importações são arquivos somente leitura. Consulta exige seleção explícita do arquivo pelo usuário; não unir implicitamente ao contexto do host. Round-trip deve manter bytes e resolução semântica de cada índice, mesmo que IDs locais mudem. Remoção do arquivo remove namespace/catálogos e respeita refcounts de blobs. Exportações concluídas externas ficam fora do domínio de apagamento automático.

## 6. Provas

T27.projection exige sequência exata sobre base bruta após 2, 10 e 64 consolidações, reinício e restore expandido. T22.blocks exige nova regra sem compactação, em pause e após crash. T11.dependencies cobre X→A→B, revogação e raiz alterada. T32.archive cobre manifesto misto, remapeamento e exclusão; T32.redaction verifica que derived/index/cursor/backup gerenciado não reintroduz bytes. São casos futuros de produto; o modelo de referência offline não é sua implementação.
