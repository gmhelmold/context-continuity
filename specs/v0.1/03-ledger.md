# SPEC-03 — ledger, persistência e recuperação

Normativo, revisão 0.1.1. Persistência pertence ao produto; não usa tabelas privadas do host. O schema é de implementação futura, não uma migração executada nesta entrega.

## 1. Localização e isolamento

Diretório de dados fora do projeto versionado: escolher diretório de dados do usuário conforme plataforma, depois `context-continuity/<installation_id>/<workspace_id>/`. `workspace_id` é UUID do produto; caminhos fornecidos pelo modelo nunca compõem esse diretório.

Um SQLite por workspace e `sources/<sha256-prefix>/<sha256>` para blobs maiores. Diretório privado (0700 e arquivos 0600 em POSIX; ACL equivalente no Windows). Recusar diretório de outro proprietário ou symlink no caminho gerenciado que escape da raiz. Não varrer o disco à procura de arquivos com nomes semelhantes quando uma fonte faltar.

Não versionar banco, blobs, prompts reais, credenciais ou ledger de usuários no repositório público. Captura de headers de autenticação e variáveis de ambiente secretas é proibida. Fontes que contêm dados sujeitos à exclusão/redação seguem uma política explícita, não uma promessa de que regex identifica todo segredo.

Configuração inicial habilita foreign_keys, WAL e synchronous=FULL; busy_timeout=250ms. Se o driver/plataforma não fornecer as garantias exigidas, erro de instalação, não downgrade silencioso de durabilidade. Núcleo depende de operações de transação, não de `bun:sqlite`; a adaptação do driver fica fora da política de contexto.

## 2. Schema lógico v1

DDL de referência normativa. Tipos/índices podem receber nomes locais diferentes somente com migração equivalente e teste de invariantes. Arrays JSON seguem SPEC-01; checks de referências internas são feitos dentro da transação.

```sql
PRAGMA foreign_keys=ON;
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE sessions (
  session_key TEXT PRIMARY KEY,
  incarnation TEXT NOT NULL,
  scope_json TEXT NOT NULL CHECK(json_valid(scope_json)),
  host_epoch INTEGER NOT NULL DEFAULT 0 CHECK(host_epoch>=0),
  view_revision INTEGER NOT NULL DEFAULT 0 CHECK(view_revision>=0),
  policy_revision INTEGER NOT NULL DEFAULT 0 CHECK(policy_revision>=0),
  publication_seq INTEGER NOT NULL DEFAULT 0 CHECK(publication_seq>=0),
  activation_seq INTEGER NOT NULL DEFAULT 0 CHECK(activation_seq>=0),
  owner_fence INTEGER NOT NULL DEFAULT 0 CHECK(owner_fence>=0),
  owner_id TEXT, lease_until_ms INTEGER,
  mode TEXT NOT NULL CHECK(mode IN ('complete','assisted','unsupported')),
  paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0,1)),
  dispatch_blocked INTEGER NOT NULL DEFAULT 0 CHECK(dispatch_blocked IN (0,1)),
  config_json TEXT NOT NULL CHECK(json_valid(config_json)),
  counters_json TEXT NOT NULL CHECK(json_valid(counters_json)),
  created_at TEXT NOT NULL,
  UNIQUE(session_key,incarnation)
);
CREATE TABLE sources (
  session_key TEXT NOT NULL REFERENCES sessions(session_key) ON DELETE CASCADE,
  source_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>=0),
  digest TEXT CHECK(digest IS NULL OR (length(digest)=64 AND digest NOT GLOB '*[^0-9a-f]*')),
  native_refs_json TEXT NOT NULL CHECK(json_valid(native_refs_json)),
  availability TEXT NOT NULL CHECK(availability IN ('captured','excluded','missing','deleted')),
  media_type TEXT NOT NULL, size_bytes INTEGER NOT NULL CHECK(size_bytes>=0),
  inline_bytes BLOB, blob_key TEXT, policy_revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(session_key,source_id,revision),
  CHECK((availability='captured' AND digest IS NOT NULL AND
    ((inline_bytes IS NOT NULL AND blob_key IS NULL) OR (inline_bytes IS NULL AND blob_key IS NOT NULL)))
    OR (availability<>'captured' AND inline_bytes IS NULL AND blob_key IS NULL))
);
CREATE TABLE root_units (
  session_key TEXT NOT NULL REFERENCES sessions(session_key) ON DELETE CASCADE,
  host_epoch INTEGER NOT NULL, native_identity TEXT NOT NULL,
  unit_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>=0),
  unit_digest TEXT NOT NULL, payload_digest TEXT NOT NULL,
  record_json TEXT NOT NULL CHECK(json_valid(record_json)),
  PRIMARY KEY(session_key,host_epoch,unit_id,revision),
  UNIQUE(session_key,host_epoch,native_identity,revision)
);
CREATE TABLE jobs (
  job_id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL REFERENCES sessions(session_key) ON DELETE CASCADE,
  incarnation TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','running','ready','published','rejected','failed','cancelled')),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
  proposal_json TEXT CHECK(proposal_json IS NULL OR json_valid(proposal_json)),
  owner_fence INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 2),
  deadline_at TEXT NOT NULL, error_code TEXT,
  usage_json TEXT CHECK(usage_json IS NULL OR json_valid(usage_json)),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(session_key,job_id)
);
CREATE UNIQUE INDEX one_active_job ON jobs(session_key)
  WHERE status IN ('queued','running','ready');
CREATE TABLE aux_runs (
  run_id TEXT PRIMARY KEY, session_key TEXT NOT NULL, job_id TEXT NOT NULL,
  attempt_no INTEGER NOT NULL CHECK(attempt_no BETWEEN 1 AND 2),
  state TEXT NOT NULL CHECK(state IN ('reserved','running','stopped','quarantine')),
  remote_state TEXT NOT NULL CHECK(remote_state IN ('unknown','confirmed')),
  local_stopped INTEGER NOT NULL CHECK(local_stopped IN (0,1)),
  UNIQUE(session_key,job_id,attempt_no),
  FOREIGN KEY(session_key,job_id) REFERENCES jobs(session_key,job_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX one_local_run ON aux_runs(session_key) WHERE state<>'stopped';
CREATE TABLE attempts (
  attempt_id TEXT PRIMARY KEY, session_key TEXT NOT NULL, job_id TEXT NOT NULL,
  attempt_no INTEGER NOT NULL CHECK(attempt_no BETWEEN 1 AND 2),
  state TEXT NOT NULL CHECK(state IN ('reserved','dispatched','completed','failed','cancelled','unknown')),
  input_reserved INTEGER NOT NULL CHECK(input_reserved>=0),
  output_reserved INTEGER NOT NULL CHECK(output_reserved>=0),
  request_id TEXT, usage_json TEXT CHECK(usage_json IS NULL OR json_valid(usage_json)),
  UNIQUE(job_id,attempt_no),
  FOREIGN KEY(session_key,job_id,attempt_no) REFERENCES aux_runs(session_key,job_id,attempt_no),
  FOREIGN KEY(session_key,job_id) REFERENCES jobs(session_key,job_id) ON DELETE CASCADE
);
CREATE TABLE operations (
  operation_id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL REFERENCES sessions(session_key) ON DELETE CASCADE,
  request_id TEXT NOT NULL, input_digest TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('compaction','block','correction','restore','redaction','reset')),
  actor TEXT NOT NULL CHECK(actor IN ('user','authorized_flow','maintenance')),
  job_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('committed','cleanup_pending')),
  expected_revision INTEGER NOT NULL, result_revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(session_key,request_id), UNIQUE(session_key,operation_id), UNIQUE(job_id),
  CHECK((kind='compaction' AND job_id IS NOT NULL) OR (kind<>'compaction' AND job_id IS NULL)),
  FOREIGN KEY(session_key,job_id) REFERENCES jobs(session_key,job_id)
);
CREATE TABLE chapters (
  chapter_id TEXT PRIMARY KEY, session_key TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  digest TEXT,
  coverage_json TEXT NOT NULL CHECK(json_valid(coverage_json)),
  logical_json TEXT NOT NULL CHECK(json_valid(logical_json)),
  dependencies_json TEXT NOT NULL CHECK(json_valid(dependencies_json)),
  parents_json TEXT NOT NULL CHECK(json_valid(parents_json)),
  manifest_json TEXT CHECK(manifest_json IS NULL OR json_valid(manifest_json)),
  proposal_json TEXT CHECK(proposal_json IS NULL OR json_valid(proposal_json)),
  status TEXT NOT NULL CHECK(status IN ('published','superseded','invalidated','withdrawn','redacted')),
  created_at TEXT NOT NULL,
  UNIQUE(session_key,chapter_id),
  CHECK(status='redacted' OR (proposal_json IS NOT NULL AND manifest_json IS NOT NULL AND digest IS NOT NULL)),
  FOREIGN KEY(session_key,operation_id) REFERENCES operations(session_key,operation_id)
);
CREATE TABLE views (
  session_key TEXT NOT NULL REFERENCES sessions(session_key) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK(revision>=0),
  host_epoch INTEGER NOT NULL, policy_revision INTEGER NOT NULL,
  replacements_json TEXT NOT NULL CHECK(json_valid(replacements_json)),
  blocks_json TEXT NOT NULL CHECK(json_valid(blocks_json)),
  suppressed_json TEXT NOT NULL CHECK(json_valid(suppressed_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(session_key,revision)
);
CREATE TABLE blocks (
  session_key TEXT NOT NULL REFERENCES sessions(session_key) ON DELETE CASCADE,
  block_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>=1),
  kind TEXT NOT NULL CHECK(kind IN ('presence','reference','curated','retention')),
  authority TEXT NOT NULL CHECK(authority IN ('user','host','agent','external')),
  text TEXT, digest TEXT,
  scope_json TEXT NOT NULL CHECK(json_valid(scope_json)),
  sources_json TEXT NOT NULL CHECK(json_valid(sources_json)),
  expires_publication_seq INTEGER, created_at TEXT NOT NULL,
  PRIMARY KEY(session_key,block_id,version)
);
CREATE TABLE dependencies (
  session_key TEXT NOT NULL REFERENCES sessions(session_key) ON DELETE CASCADE,
  from_ref TEXT NOT NULL CHECK(json_valid(from_ref)),
  to_ref TEXT NOT NULL CHECK(json_valid(to_ref)),
  relation TEXT NOT NULL CHECK(relation IN ('content','history')),
  PRIMARY KEY(session_key,from_ref,to_ref,relation)
);
CREATE TABLE retrievals (
  retrieval_id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL REFERENCES sessions(session_key) ON DELETE CASCADE,
  chapter_id TEXT,
  source_ref_json TEXT CHECK(source_ref_json IS NULL OR json_valid(source_ref_json)),
  work_json TEXT NOT NULL CHECK(json_valid(work_json)),
  range_json TEXT NOT NULL CHECK(json_valid(range_json)),
  text_digest TEXT NOT NULL, excerpt_text TEXT,
  reason TEXT NOT NULL CHECK(reason IN ('lookup','missing_detail','omitted_rule','correction')),
  declared_by TEXT NOT NULL CHECK(declared_by IN ('agent','user','unspecified')),
  created_at TEXT NOT NULL, consumed_by_job TEXT,
  FOREIGN KEY(session_key,chapter_id) REFERENCES chapters(session_key,chapter_id),
  FOREIGN KEY(session_key,consumed_by_job) REFERENCES jobs(session_key,job_id)
);
CREATE TABLE emissions (
  emission_id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL REFERENCES sessions(session_key) ON DELETE CASCADE,
  frame_id TEXT NOT NULL, transport_attempt INTEGER NOT NULL,
  view_revision INTEGER NOT NULL, fingerprint TEXT NOT NULL,
  selected_at TEXT NOT NULL, emitted_at TEXT, acknowledged_at TEXT,
  request_id TEXT, usage_json TEXT CHECK(usage_json IS NULL OR json_valid(usage_json)),
  UNIQUE(session_key,frame_id,transport_attempt)
);
CREATE TABLE blobs (digest TEXT PRIMARY KEY, size_bytes INTEGER NOT NULL CHECK(size_bytes>=0), created_at TEXT NOT NULL);
CREATE TABLE storage_reservations (
  reservation_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('staging','read_pin','export_pin')),
  blob_digest TEXT, session_key TEXT, incarnation TEXT,
  size_bytes INTEGER NOT NULL CHECK(size_bytes>=0), created_at TEXT NOT NULL
);
CREATE TABLE tombstones (scope_hash TEXT NOT NULL, identity TEXT NOT NULL, reason TEXT NOT NULL, PRIMARY KEY(scope_hash,identity));
CREATE TABLE managed_files (path_key TEXT PRIMARY KEY, kind TEXT NOT NULL, scopes_json TEXT NOT NULL CHECK(json_valid(scopes_json)));
CREATE INDEX chapters_by_session ON chapters(session_key,created_at,chapter_id);
CREATE INDEX retrievals_by_session ON retrievals(session_key,created_at,retrieval_id);
```

O índice textual é derivado e reconstruível. No MVP pode ser SQLite FTS5 quando disponível; sua ausência usa busca literal limitada em capítulos, com `search_backend=literal` visível. Sem serviço vetorial. Fontes/visões não dependem da disponibilidade do índice. SPEC-05 fixa a semântica comum de paginação/escopo, não exige rankings idênticos entre backends.

`availability=captured` exige exatamente um dos dois conteúdos, inclusive BLOB vazio válido de tamanho zero. Blobs externos são privados e seu hash é conferido ao ler. As outras disponibilidades não fornecem conteúdo fictício; seu motivo fica no manifesto de fontes. Não confundir NULL com texto vazio capturado.

## 3. Blobs, quota e exclusão mútua de workspace

Até 256 KiB inline, acima blob. Fonte >16 MiB fica inelegível até consentimento de limite maior; não truncar. Quota inicial 2 GiB inclui bytes inline/blob/staging e reservas; deduplicação só dentro do workspace. Disco externo/driver sem lock confiável não é suporte anunciado.

**Um lock de arquivo exclusivo por workspace** serializa reserva/finalização/GC/import/exclusão. Lock é de SO, não lease com expiração durante syscall; crash o libera. Ordem fixa: lock de workspace -> transação SQLite. Nunca inverter nem adquirir lock mantendo transação anterior. Fsync de arquivo grande ocorre fora do lock; nenhuma rede ocorre dentro dele.

Captura:
1. Sob lock e BEGIN IMMEDIATE, conferir escopo/tombstone/quota, reservar tamanho máximo do staging em storage_reservations; commit, soltar lock.
2. Escrever temp privado exclusivo, calcular bytes/hash, fsync. Se exceder reserva, parar antes de crescer além dela e pedir reserva adicional sob lock; quota negada aborta só staging desta operação.
3. Reobter lock, verificar incarnation/tombstone/reserva. Conferir blob existente ou rename do staging para chave de hash; fsync diretório obrigatório quando perfil exige durabilidade. BEGIN IMMEDIATE, reler quota e inserir catalog+source refs, retirar reservation, commit; soltar lock. Janela entre verificar existência e inserir referência inteira fica protegida do GC.
4. Falha no commit deixa arquivo órfão, nunca referência a arquivo parcial. Crash após ref não permite coleta porque há referência; quota/reconciliação no startup conta órfãos conservadoramente.

GC sob o MESMO lock verifica em transação todas as refs, jobs/read_dependencies e operações de arquivo em andamento antes de desvincular arquivo sem refs há 24h. Reutilizar órfão antigo não compete com unlink. Catalog é reconstruível; ausência inesperada de arquivo usado causa E_SOURCE, nunca recuperação pelo disco externo. Duas sessões e importação disputam o mesmo orçamento, não quotas privadas de mentirinha.

Readers grandes/exportadores mantêm pin no catálogo de reservas/lock enquanto abrem o handle; GC só remove quando nenhum pin/ref existir. Redação autorizada marca indisponibilidade antes de cancelar reads e limpar arquivos; leitores revalidam policy/incarnation antes de devolver dados. Uma leitura já entregue não é apagada retroativamente.

## 4. Transações e fontes autoritativas

Inicialização cria Session+View0+config/counters atomicos. incarnation e tombstone são conferidos antes; callback nunca chama inicialização. Root_units persiste IDs/revisões de fontes públicas; Frame não cria source de outro escopo.

Owner lease: BEGIN IMMEDIATE, 30s, renovação cada 10s e fence crescente. Só proprietário escreve/gera; outro processo consulta ou envia comando pela integração autorizada, nunca disputa publicação. Fencing revalidado em cada transação. Não confundir lease de sessão com lock de arquivos do workspace.

Job admission cria snapshot/Manifest congelados e índices únicos. Attempts reservam custos antes de conexão. Preparar ready exige fontes completas. Publicação cria Operation, Chapter, dependências, View revision+1, publication_seq+1 e estado do job na mesma transação, com CAS de revision/fence/incarnation. Zero-row CAS é rollback. Manifest no Chapter é exatamente o do job; cópia pequena é intencional e seu digest é validado.

Mutation de bloco usa SPEC-07: View nova com versões/ordinais e policy+1, invalida derivados, cancela jobs mesmo em pause. Ordinal vem de sessions.activation_seq, não created_at da versão. Não há flag blocks.active autoritativa paralela.

Correção/restore/redaction são Operations sem job; nenhum job LLM falso para satisfazer FK. As alterações de View, dependencies, status e índices invalidáveis são atomicas. Referências polimórficas dos JSONs são resolvidas dentro do escopo na transação; FKs compostas reforçam a parte relacional, não substituem essa validação.

Exclusão inteira remove na ordem emissions/retrievals/dependencies/views/blocks/root_units/sources/chapters/operations/attempts/aux_runs/jobs/sessions, mantendo tombstone e manifesto de cleanup fora da sessão. Essa ordem é testada com todas as FKs preenchidas. Bases antigas/history são preservadas para supersessão, não para burlar redação.

## 5. Crash, retry e consistência

No startup, verificar versão de schema. Versão maior que suportada abre somente modo diagnóstico/leitura quando seguro; nunca reinterpreta tabelas nem faz downgrade. Migrações são ordenadas, transacionais e precedidas de backup local consistente; falha mantém schema anterior ou erro explícito, nunca mistura.

Jobs queued/running cujo proprietário expirou viram failed/E_OWNER, sem repetir inferência. Ready pode ser revalidado por novo proprietário mediante novo fence e mesma origem/policy; o default do MVP é cancelar e recalcular em nova oportunidade para simplificar. Published não é executado novamente; ler o ponteiro da View e root-map é suficiente para reconstruir projeção. Aux_run running de processo morto fica stopped local/remote unknown; manter reserva, sem reenvio. Capítulos publicados não têm função de “acordar” o agente.

Falha após commit e antes do hook retornar não duplica efeito: próxima chamada renderiza a view persistida. Falha antes do commit mantém ponteiro anterior. Emissions reconhecem que commit não equivale a entrega de rede.

## 6. Retenção e arquivos portáveis

Retenção padrão local sem descarte automático de fontes referenciadas. O contrato de supersessão, retirada de derivados e exclusão é [SPEC-07](07-state-operations.md). Digest pode ser null em fonte indisponível quando a política exigir apagar também o hash; esse tombstone não é uma SourceRef válida para sustentar Claim. Index/notes/proposals/backups gerenciados entram no domínio da redação.

Export/import usa ArchiveManifest/ArchiveRecords de SPEC-07, snapshot consistente, validação completa e namespace novo. O catálogo managed_files contém apenas paths gerados pelo produto e escopos abrangidos; backups gerenciados não escapam da exclusão por estarem fora do DB. Falha de cleanup é visível e retomável sem recriar conteúdo. Não apagar exportações externas ou arquivos não gerenciados.

## 7. Provas de storage

T03.storage: lease, unique jobs/runs e fence. T12.storage: durabilidade local, restart e fonte antes da ref. T19.storage: blob antigo competindo com GC e duas sessões na quota. T32.archive/redaction: todas as FKs e arrays resolvidos, identidade remapeada, tombstones e derivados. Essas provas usam implementação futura com driver/FS reais; teste do DDL/modelo nesta etapa não homologa plugin.
