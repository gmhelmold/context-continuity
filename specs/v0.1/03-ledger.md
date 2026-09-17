# SPEC-03 — ledger, persistência e recuperação

Normativo. Persistência pertence ao produto; não usa tabelas privadas do host. O schema é de implementação futura, não uma migração executada nesta entrega.

## 1. Localização e isolamento

Diretório de dados fora do projeto versionado: escolher diretório de dados do usuário conforme plataforma, depois `context-continuity/<installation_id>/<workspace_id>/`. `workspace_id` é UUID do produto; caminhos fornecidos pelo modelo nunca compõem esse diretório.

Um SQLite por workspace e `sources/<sha256-prefix>/<sha256>` para blobs maiores. Diretório privado (0700 e arquivos 0600 em POSIX; ACL equivalente no Windows). Recusar diretório de outro proprietário ou symlink no caminho gerenciado que escape da raiz. Não varrer o disco à procura de arquivos com nomes semelhantes quando uma fonte faltar.

Não versionar banco, blobs, prompts reais, credenciais ou ledger de usuários no repositório público. Captura de headers de autenticação e variáveis de ambiente secretas é proibida. Fontes que contêm dados sujeitos à exclusão/redação seguem uma política explícita, não uma promessa de que regex identifica todo segredo.

Configuração inicial habilita foreign_keys, WAL e synchronous=FULL; busy_timeout=250ms. Se o driver/plataforma não fornecer as garantias exigidas, erro de instalação, não downgrade silencioso de durabilidade. Núcleo depende de operações de transação, não de `bun:sqlite`; a adaptação do driver fica fora da política de contexto.

## 2. Schema lógico v1

DDL de referência normativa. Tipos/índices podem receber nomes locais diferentes somente com migração equivalente e teste de invariantes. Arrays JSON seguem SPEC-01; checks de referências internas são feitos dentro da transação.

```sql
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE sessions (
  session_key TEXT PRIMARY KEY,
  scope_json TEXT NOT NULL CHECK(json_valid(scope_json)),
  host_epoch INTEGER NOT NULL DEFAULT 0 CHECK(host_epoch >= 0),
  view_revision INTEGER NOT NULL DEFAULT 0 CHECK(view_revision >= 0),
  policy_revision INTEGER NOT NULL DEFAULT 0 CHECK(policy_revision >= 0),
  owner_fence INTEGER NOT NULL DEFAULT 0 CHECK(owner_fence >= 0),
  owner_id TEXT,
  lease_until_ms INTEGER,
  mode TEXT NOT NULL CHECK(mode IN ('complete','assisted','unsupported')),
  paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0,1)),
  config_json TEXT NOT NULL CHECK(json_valid(config_json)),
  counters_json TEXT NOT NULL CHECK(json_valid(counters_json)),
  created_at TEXT NOT NULL
);

CREATE TABLE sources (
  session_key TEXT NOT NULL REFERENCES sessions(session_key) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 0),
  digest TEXT NOT NULL CHECK(length(digest)=64),
  native_refs_json TEXT NOT NULL CHECK(json_valid(native_refs_json)),
  availability TEXT NOT NULL CHECK(availability IN ('captured','excluded','missing','deleted')),
  media_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
  inline_bytes BLOB,
  blob_key TEXT,
  policy_revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(session_key, source_id, revision),
  CHECK(NOT (inline_bytes IS NOT NULL AND blob_key IS NOT NULL))
);

CREATE TABLE jobs (
  job_id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL REFERENCES sessions(session_key) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('queued','running','ready','published','rejected','failed','cancelled')),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  proposal_json TEXT CHECK(proposal_json IS NULL OR json_valid(proposal_json)),
  owner_fence INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 2),
  deadline_at TEXT NOT NULL,
  error_code TEXT,
  usage_json TEXT CHECK(usage_json IS NULL OR json_valid(usage_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX one_active_job ON jobs(session_key)
  WHERE status IN ('queued','running','ready');

CREATE TABLE chapters (
  chapter_id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL REFERENCES sessions(session_key) ON DELETE CASCADE,
  job_id TEXT NOT NULL UNIQUE REFERENCES jobs(job_id),
  coverage_json TEXT NOT NULL CHECK(json_valid(coverage_json)),
  sources_json TEXT NOT NULL CHECK(json_valid(sources_json)),
  parents_json TEXT NOT NULL CHECK(json_valid(parents_json)),
  proposal_json TEXT NOT NULL CHECK(json_valid(proposal_json)),
  status TEXT NOT NULL CHECK(status IN ('published','superseded','withdrawn')),
  created_at TEXT NOT NULL
);

CREATE TABLE views (
  session_key TEXT NOT NULL REFERENCES sessions(session_key) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK(revision >= 0),
  host_epoch INTEGER NOT NULL CHECK(host_epoch >= 0),
  policy_revision INTEGER NOT NULL CHECK(policy_revision >= 0),
  replacements_json TEXT NOT NULL CHECK(json_valid(replacements_json)),
  blocks_json TEXT NOT NULL CHECK(json_valid(blocks_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(session_key, revision)
);

CREATE TABLE blocks (
  session_key TEXT NOT NULL REFERENCES sessions(session_key) ON DELETE CASCADE,
  block_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version >= 1),
  kind TEXT NOT NULL CHECK(kind IN ('presence','reference','curated','retention')),
  authority TEXT NOT NULL CHECK(authority IN ('user','host','agent','external')),
  text TEXT NOT NULL,
  digest TEXT NOT NULL CHECK(length(digest)=64),
  scope_json TEXT NOT NULL CHECK(json_valid(scope_json)),
  sources_json TEXT NOT NULL CHECK(json_valid(sources_json)),
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(session_key, block_id, version)
);

CREATE TABLE retrievals (
  retrieval_id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL REFERENCES sessions(session_key) ON DELETE CASCADE,
  chapter_id TEXT REFERENCES chapters(chapter_id),
  source_ref_json TEXT CHECK(source_ref_json IS NULL OR json_valid(source_ref_json)),
  range_json TEXT NOT NULL CHECK(json_valid(range_json)),
  reason TEXT NOT NULL CHECK(reason IN ('lookup','missing_detail','omitted_rule','correction')),
  declared_by TEXT NOT NULL CHECK(declared_by IN ('agent','user','unspecified')),
  text_digest TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consumed_by_job TEXT REFERENCES jobs(job_id)
);

CREATE TABLE emissions (
  emission_id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL REFERENCES sessions(session_key) ON DELETE CASCADE,
  frame_id TEXT NOT NULL,
  view_revision INTEGER NOT NULL,
  fingerprint TEXT,
  selected_at TEXT NOT NULL,
  emitted_at TEXT,
  acknowledged_at TEXT,
  request_id TEXT,
  usage_json TEXT CHECK(usage_json IS NULL OR json_valid(usage_json)),
  UNIQUE(session_key, frame_id, view_revision)
);
CREATE INDEX chapters_by_session ON chapters(session_key, created_at, chapter_id);
CREATE INDEX retrievals_by_session ON retrievals(session_key, created_at, retrieval_id);
```

O índice textual é derivado e reconstruível. No MVP pode ser SQLite FTS5 quando disponível; sua ausência usa busca literal limitada em capítulos, com `search_backend=literal` visível. Sem serviço vetorial. Fontes/visões não dependem da disponibilidade do índice. SPEC-05 fixa a semântica comum de paginação/escopo, não exige rankings idênticos entre backends.

`availability=captured` exige exatamente um dos dois conteúdos, inclusive BLOB vazio válido de tamanho zero. Blobs externos são privados e seu hash é conferido ao ler. As outras disponibilidades não fornecem conteúdo fictício; seu motivo fica no manifesto de fontes. Não confundir NULL com texto vazio capturado.

## 3. Fontes e blobs

Até 256 KiB, guardar bytes inline. Acima, arquivo por hash dentro da raiz privada. Limite inicial por fonte: 16 MiB; acima disso, marcar fonte protegida/não compactável até configurar retenção adequada. Não truncar silenciosamente para caber. Quota inicial por workspace: 2 GiB, configurável; ao atingi-la, parar novas capturas/manutenções, não apagar capítulos automaticamente.

Captura grava arquivo temporário privado, calcula SHA-256 dos bytes capturados, fsync do arquivo, rename atômico para chave imutável e fsync do diretório quando suportado. Só depois inserir referência no SQLite. Hash já existente pode ser reutilizado dentro do workspace após conferir tamanho/digest. Não compartilhar blobs entre usuários/workspaces por economia.

Crash pode deixar blob órfão, nunca referência publicável a arquivo parcial. GC remove somente blobs sem referência, fora de jobs ativos, após 24h de tolerância. Não apagar fontes referidas por capítulos antigos apenas porque saíram da janela. Revisão original e versão atual de um arquivo são coisas distintas.

## 4. Transações obrigatórias

**Inicialização:** criar sessão + view revision=0 + configuração/counters na mesma transação. Scope conflitante sob a mesma chave é E_SCOPE, não adoção automática.

**Adquirir proprietário:** `BEGIN IMMEDIATE`; verificar lease. Se ausente/expirado, incrementar owner_fence e atribuir UUID de instância por 30s. Renovar a cada 10s. Relógio de parede serve só para lease entre processos; cada commit revalida fence. Relógio retrocedido/renovação perdida impede nova publicação até reconciliar. Segundo processo não inicia job; pode ler. Não interrompe o proprietário só pelo PID igual.

**Criar job:** sob fence válido, inserir snapshot e reservas de chamadas/tokens. O índice one_active_job arbitra corrida; perdedor retorna job já existente, não inicia clone adicional. Reserva não inclui cabeçalhos/credenciais.

**Preparar:** conferir todas as fontes do snapshot, persistir proposta validada e status ready. Nenhuma alteração na visão. Quando dados originais não podem ser retidos pela política, proteger o intervalo ou retornar E_SOURCE; não usar uma isenção genérica para afirmar “nada foi perdido”.

**Publicar:** `BEGIN IMMEDIATE`; reler sessions/estado ready; verificar fence, epoch, view/policy revision; verificar referências dentro do escopo e plano validado; inserir chapter; inserir nova view; atualizar ponteiro em sessions com condição da revisão antiga; marcar job published; commit. Qualquer zero-row CAS ou erro faz rollback total. Não incluir LLM, rede ou escrita lenta de blobs nessa transação.

**Atualizar bloco:** exigir expected_version; inserir versão nova, desativar anterior, incrementar policy_revision; cancelar jobs anteriores. A atualização é autorizada pelo usuário/fluxo, não por texto de proposta. Não editar conteúdo de uma versão usada no passado.

**Recuperar fonte:** verificar sessão, disponibilidade, limite e digest antes de retornar bytes; gravar receipt limitado. Índice encontrado não é autoridade de acesso. Fonte removida entre busca e leitura retorna E_SOURCE.

## 5. Crash, retry e consistência

No startup, verificar versão de schema. Versão maior que suportada abre somente modo diagnóstico/leitura quando seguro; nunca reinterpreta tabelas nem faz downgrade. Migrações são ordenadas, transacionais e precedidas de backup local consistente; falha mantém schema anterior ou erro explícito, nunca mistura.

Jobs queued/running cujo proprietário expirou viram failed/E_OWNER, sem repetir inferência. Ready pode ser revalidado por novo proprietário mediante novo fence e mesma origem/policy; o default do MVP é cancelar e recalcular em nova oportunidade para simplificar. Published não é executado novamente; ler o ponteiro da view é suficiente. Capítulos publicados não têm função de “acordar” o agente.

Falha após commit e antes do hook retornar não duplica efeito: próxima chamada renderiza a view persistida. Falha antes do commit mantém ponteiro anterior. Emissions reconhecem que commit não equivale a entrega de rede.

## 6. Retenção, exclusão e exportação

Retenção padrão é local, sem exclusão automática de fontes referenciadas. Usuário pode apagar sessão/arquivo. Exclusão cancela jobs, incrementa fence, remove views/chapters/blocks/receipts/index daquele escopo em transação e agenda remoção de blobs agora sem referência. Resposta tardia é recusada por ausência/fence. Não prometer apagar arquivos já exportados nem remanência física em SSD; o contrato é exclusão lógica e limpeza dos arquivos gerenciados.

Exportação é um diretório novo com `manifest.json` schema_version=1, `sources/`, capítulos e política. O manifesto contém IDs/revisões/digests, disponibilidade, origem do adaptador e lista de arquivos; não contém auth, variáveis de ambiente, cabeçalhos ou request handles. Bytes sujeitos a redação são explicitamente marcados; hash representa os bytes exportados, com relação à fonte quando autorizada.

Importação nunca executa conteúdo. Validar schema, tamanhos, hashes, destinos relativos, ausência de symlinks/traversal, referências acíclicas e escopo. Criar namespace de arquivo novo; não sobrescrever uma sessão ativa do host. Importação de um ledger não leva KV cache, autorização nem garantia de restaurar estados opacos em outro modelo.

## 7. Correções e auditoria mínima

Correção de uma síntese gera novo capítulo/revisão com referência ao anterior e às fontes; não reescreve o texto histórico. A visão vigente aponta para a correção. Registrar decisão de publicação, rejeição, motivo, IDs e contagens; prompts reais só no armazenamento privado autorizado, nunca na telemetria padrão.

Preservar originais ajuda a reparar erros semânticos, não prova que toda frase está correta. O ledger não transforma declarações de testes em execuções verificadas. Fontes recuperadas mantêm a etiqueta de observação histórica e a revisão correspondente.

Aceitação: T12–T13, T19–T20, T31–T32 e T38; validar DDL e transações contra driver real na implementação. Parsing de SQL numa ferramenta de documentação não é teste do armazenamento do plugin.
