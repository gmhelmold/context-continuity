# WP-02/B — fontes inline e revisões duráveis de raízes

Base: `a332213659c56d81081f41bbd0a0ccfecd385e14`, depois da integração do PR #26. Continua a issue #5. Contrato: [SPEC-14](../../specs/v0.1/14-inline-root-retention.md). Não encerra WP-02, nem integra automaticamente o armazenamento ao harness.

## Implementação

A API canônica SqliteSessionStore recebe retainRoots(lease,batch), readRootCatalog(binding), readRoot(binding,ref) e readSource(binding,ref). Não foi reaplicado o ZIP histórico. Os helpers source-records e root-records usam a conexão/transação privada do serviço existente; nenhum SQL arbitrário, caminho de arquivo, leitura de host ou endpoint é exposto ao modelo.

O batch fixa a expectativa do catálogo antes da escrita. O proprietário/deadline são verificados dentro da transação, inclusive no final; erro reverte o lote e o relógio confirmado. Fontes são gravadas antes de referências de raiz na MESMA transação. ID/digest/revisão vêm do RootIdentityRegistry já implementado, não de outra fórmula em storage.

Fontes inline preservam bytes exatos, BLOB vazio, Unicode/CRLF/BOM e dados binários. Retenção não significa que um codec saiba compactar mídia. Ler devolve cópia, com tamanho/hash/disponibilidade verificados. Fonte ausente ou indisponível não é preenchida com texto vazio nem recapturada automaticamente.

Raízes preservam IDs entre revisões; mudanças semânticas acrescentam linhas. Metadata-only atualiza locator/estimativa, sem mudar a revisão semântica. A ordem canônica de native_identity é estável após reabertura, mas NÃO representa a ordem de mensagens. O input atual do host continua sendo autoridade de cronologia.

## Limites explícitos

Fonte máxima inline: 256 KiB; lote: 64 fontes, 128 observações, 4 MiB; catálogo corrente: 100000 raízes e 16 MiB. Não há truncamento. Quota lógica inicial de 2 GiB considera inline, catálogo de blobs e reservas entre sessões; não pretende contabilizar páginas SQLite/WAL, backups ou arquivos órfãos ainda não gerenciados. Bytes acima do perfil são recusados enquanto staging/locks/blobs não estiverem implementados.

Este incremento NÃO grava payloads externos a partir de payload_ref: o campo é locator opaco. A integração fornece os bytes originais e os payloads efetivos; o componente verifica integridade e associação, não a verdade semântica ou a completude da captura. Dados de usuário não foram usados nos testes.

Nenhuma geração, Chapter, nova View, migração, GC, archive ou alteração de policy é criada pela retenção. Estado de consumo/cancelamento e invalidação dos derivados precisam continuar integrados por SPEC-07/WPs próprios. Publicação futura deve conferir novamente os registros atuais, sem transformar um hash em autorização.

## Provas e revisão do autor

Os testes novos exercitam SQLite/FS reais, sem provider. Fonte+raiz no mesmo commit; repetição/edição/reversão; escopo/tombstones; CAS; configurações; fonte ausente/indisponível/corrompida; limite inclusivo; quota compartilhada; falha no segundo INSERT; owner expirado durante operação; processo novo e interrupções antes/depois de COMMIT. Interrupção é aplicada somente a processos criados pela fixture, não certifica queda elétrica.

A campanha negativa usa cópias descartáveis e quatro testes dirigidos por filho. Controle correto precisa passar; remoção de CAS, verificação de hash/leitura ou de proprietário precisa falhar no teste nomeado. Timeout/erro de setup não conta como detecção. Não multiplicar contagem de testes por filhos, repetições ou vetores.

A primeira execução local teve 23/25: os dois casos de interrupção expiraram antes da barreira, durante indisponibilidade temporária do computador conectado. Na repetição isolada, os mesmos dois passaram sem mudar código, prazos ou assertions. Esse resultado anterior permanece falha de execução, não prova de atomicidade. A matriz final e demais testes devem ser registrados separadamente.

## Cinco axiomas do incremento

**Success Criteria:** bytes e identidades persistem juntos; nenhum lote parcial é visível; catálogo e fonte reabertos conservam conteúdo/escopo/revisão.

**Quality Standards:** núcleo real reutilizado, SQLite/FS reais, referências explícitas, testes negativos com controle, erros sem dados privados, sem aumento de timeout para obter verde.

**Completeness Criteria:** quatro APIs, limites, conflitos, leitura histórica, fontes protegidas e reabertura cobertos; documentos e exports coerentes. Não concluir CRUD de jobs, blobs ou arquivo portátil pelo DDL existente.

**Definition of Done:** seis workflows/oito jobs aprovados no head final e logs conferidos; árvore integrada comparada. Registrar resultados e hashes. #5 continua aberto para seus demais subcasos.

**Invariants:** scoped reads não criam sessões; owner antigo não escreve; fontes indisponíveis não ressuscitam; originais não são normalizados; omissão no lote não apaga histórico; nenhuma inferência/execução de ferramenta/publicação disparada por retenção.

## Reprodução

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check:storage
npm run test:storage
npm run check:core
npm run test:core
node --test tests/conformance/opencode/test-components.mjs tests/conformance/opencode/test-review004.mjs
python3 tests/conformance/opencode/test-witness.py
python3 scripts/check-spec.py
python3 scripts/check-reference-model.py
python3 scripts/test-spec-check.py
python3 scripts/check-canonical.py
python3 scripts/check-storage-contracts.py
```

Referências de implementação: [Node 22.17.1 SQLite](https://nodejs.org/download/release/v22.17.1/docs/api/sqlite.html), [isolamento SQLite](https://www.sqlite.org/isolation.html). Documentação não substitui testes. A revisão é do autor, não auditoria externa.

## Resultado local do componente

Foram executados **32/32 testes novos**: 31 testes de comportamento e uma campanha de controle mais quatro mutantes (quatro casos dirigidos por filho). Typecheck de storage passou nos pins. A execução inicial 23/25 e a repetição de crash 2/2 permanecem registradas; não houve alteração dos prazos. [Evidências e hashes](evidence/WP-02-B.json). Suíte completa e workflows são gates separados, registrados no PR do head final.
