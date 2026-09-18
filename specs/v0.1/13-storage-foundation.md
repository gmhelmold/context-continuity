# SPEC-13 — fundação SQLite de sessões (WP-02/A)

Adendo à SPEC-03. Primeiro adaptador de persistência; não altera contratos do núcleo, hosts, política de compactação ou limites de inferência.

## 1. Escopo e plataforma

`packages/storage/src` usa `node:sqlite` em Node 22.17.1/24.0.0. O núcleo continua sem import de filesystem/SQLite. Perfil inicial: diretório local POSIX existente, privado (0700), proprietário atual; banco e sidecars regulares 0600 e sem links. Windows, filesystems remotos e resistência a processo hostil do mesmo usuário NÃO estão homologados. A integração deve fornecer o diretório canônico exclusivo daquele workspace; o módulo não procura instalações nem altera configuração pessoal.

O módulo SQLite é experimental nas versões fixadas. O driver fica isolado para substituição; não exigir dependência nativa adicional nem ocultar warnings. APIs síncronas ficam limitadas a transações curtas. O executor futuro não deve colocar inferência, streams ou operações extensas dentro delas.

## 2. Abertura e schema

`SqliteSessionStore.create(directory, workspace, clock?)` é inicialização exclusiva: nunca sobrescreve arquivo existente. `open` exige banco já inicializado e compatível; não cria quando ausente. Workspace contém installation_id/workspace_id canônicos. A identidade persistida precisa coincidir. Permissões, tipo, links e identidade de inode são conferidos; isso não é sandbox contra código hostil com a mesma identidade de SO.

O asset `schema-v1.sql` coincide byte a byte com o bloco DDL da SPEC-03. O bootstrap configura WAL, synchronous=FULL, foreign_keys=ON, busy_timeout=250, trusted_schema=OFF e solicita fullfsync. As propriedades fundamentais são lidas de volta. SQLite sincroniza suas páginas/WAL; a criação também sincroniza o arquivo e diretório. Isso não prova resistência a hardware que mente sobre fsync.

Cada inspeção de versão/esquema/metadados/integridade ocorre dentro de uma única transação de leitura; COMMIT no sucesso, ROLLBACK na recusa. Configuração de journal e bootstrap permanecem fora dela. Isso não substitui a validação por transação das operações posteriores.

DDL, meta de workspace, digest do schema, application_id e user_version são publicados na mesma transação. Abrir exige schema/identidade/integridade compatíveis e inspeção prévia em conexão read-only antes de negociar escrita. Versões desconhecidas, banco estrangeiro e schema adulterado não são migrados automaticamente. Só existe schema v1 nesta fase; migrações de usuário/backup exigem incremento próprio antes de qualquer mudança de versão.

Se uma inicialização exclusiva falhar, pode restar um arquivo incompleto. Ele não é interpretado como ledger válido nem apagado por tentativa posterior. A chamada retorna erro; diagnóstico/recuperação explícita da instalação deve resolver esse artefato antes de habilitar o produto. Nenhum callback tenta criá-lo ou repará-lo. A prova de atomicidade cobre estado SQLite, não uma transação distribuída entre DDL e diretórios.

## 3. Sessão e leitura

`createSession(binding, resolvedConfig)` só aceita epoch inicial zero e cria Session + View0 + configuração numa transação BEGIN IMMEDIATE. Modo inicial sempre unsupported, independentemente do requested_mode. IDs/incarnation vêm de inicialização autorizada. Uma repetição idêntica retorna a sessão existente sem zerar proprietário/revisões; configuração ou binding conflitante é recusado. Leitura verifica escopo, incarnation, epoch, configuração e existência da View indicada. Configuração resolvida deve estar completa: validar não pode repor defaults em um registro persistido danificado; a representação canônica deve coincidir com a resolução validada.

`readSession` não cria estado ausente; retorna null. Presença de tombstone para o scope_hash é recusada conservadoramente, inclusive para inicialização; a operação de reativação explícita é parte futura do lifecycle, não um bypass nesta API. Configuração/record retornados são profundamente imutáveis. SQL recebe parâmetros vinculados; erros de driver não expõem conteúdo, SQL ou paths.

## 4. Lease da sessão, não lock de arquivos

Cada conexão recebe owner_id novo. `acquireLease` usa transação SQLite, verifica binding e proprietário vigente, e incrementa owner_fence sem overflow. Prazo: 30s. Reaquisição do mesmo proprietário ainda válido não renova prazo; renewal é explícito. Dois processos não podem tomar a mesma sessão simultaneamente. Contenção que esgota busy_timeout retorna E_STORAGE com reason fixo database busy, distinto de E_OWNER para proprietário já observado. Não há retry automático nem promessa de que toda disputa termina em E_OWNER. `renewLease`/`releaseLease` exigem owner_id da conexão, fence e deadline exatos, além de validade temporal. Deadline antigo após renewal também perde validade. Release não zera o fence; takeover após expiração gera fence maior.

Clock é fornecido pela integração confiável, não pelo modelo. Default Date.now; relógio artificial somente nas fixtures. O maior timestamp de mutação confirmada é persistido; regressão do relógio falha fechado. Avanço abrupto pode expirar um lease; fencing continua impedindo o proprietário anterior. Não há heartbeat automático neste componente: o scheduler deverá renovar antes da expiração conforme SPEC-03.

Fechar a conexão é idempotente e não implica que execução remota parou. Não libera silenciosamente lease nem reenvia trabalho. O objeto de lease é dado de controle, não AttemptPermit. Fencing deverá ser exigido por cada nova operação de escrita do ledger antes de ela ser exposta; este incremento não fornece SQL ou callbacks transacionais arbitrários na API pública.

## 5. Limites e provas

As tabelas de sources/jobs/chapters/etc. já existem pelo DDL, mas seus CRUDs, root map durável, blobs/quota/GC, lock de workspace do SO, jobs/attempts, publicações CAS, migrações/backups e importação NÃO estão implementados por este incremento. Lease de sessão não substitui o lock de workspace para operações de arquivo de SPEC-03. Portanto WP-02 continua aberto.

Testes usam banco/FS reais em diretórios sintéticos, processos separados, aquisição concorrente e interrupção antes de COMMIT. Esperado: Session e View0 ambos existem ou ambos não existem; callback antigo não vence o fence. Campanha negativa deve distinguir código correto de rollback, escopo ou exclusão de proprietário incorretos. Contagens de teste não homologam hardware, Windows ou provider.

Referências de implementação: [Node 22.17.1 SQLite](https://nodejs.org/download/release/v22.17.1/docs/api/sqlite.html), [SQLite transações](https://www.sqlite.org/lang_transaction.html) e [SQLite pragmas](https://www.sqlite.org/pragma.html), consultadas em 18/09/2026. Decisões de produto acima são específicas deste perfil; documentação de biblioteca não equivale a teste do produto.
