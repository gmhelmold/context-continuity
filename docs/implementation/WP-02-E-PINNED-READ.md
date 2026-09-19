# WP-02/E2 — leitura verificada de fonte fixada

Base `3bfff5af3613e2165a9baa637d2a1207bd2fb5e0`, continuidade de [WP-02 / #5](https://github.com/gmhelmold/context-continuity/issues/5). Contrato em [SPEC-21](../../specs/v0.1/21-source-pins.md). A correção de recibos anterior já está integrada pelo PR #39 e não é reaplicada aqui.

## Entrega e fronteira

`WorkspaceCoordinator.readPinnedSource(binding,id)` exige o participante emissor vivo, pin ativo e binding/política atuais, sob lock de workspace e snapshot SQLite de leitura. Reusa `loadSource` para tamanho/representação/SHA-256 e cópia própria dos bytes. Não implementa outro algoritmo de verificação, não recebe um SourceRef substituto e não restaura autoridade de um objeto JSON.

Pin é metadado: `readSourcePin` continua diagnóstico e pode ser usado por outro participante. Leitura E2 é distinta, restrita ao emissor original. Leituras sucessivas verificam novamente os bytes. O limite de conteúdo é o mesmo limite inline inclusivo de 256 KiB; não se varre o histórico. Nenhuma leitura consome/libera pin ou altera fontes, sessões, tentativas, contadores ou jobs.

O retorno só acontece após as guardas, COMMIT e encerramento normal da seção. O consumidor recebe uma cópia do snapshot: não recebe garantia sobre mudanças posteriores, autorização de publicação ou exportação completa. Não há stream/reader assíncrono, blob externo, GC ou reconciliação de owners mortos. Nenhum DDL, dependência, versão fixada, ponte C ou workflow é alterado.

## Casos de aceitação

`pinned-source-read.test.mjs` contém 20 casos: read/export, bytes exatos e cópias independentes, pin ausente/liberado, outro participante, política, tombstone, encarnação/epoch, outro binding, corrupção de mesmo tamanho após leitura anterior, três estados de indisponibilidade, checksum de pin, limite inline, lock/snapshot testemunhados, disputa anterior ao BEGIN, falha de COMMIT e reabertura sem adoção.

Os dados, bancos e arquivos pertencem às fixtures. Python em processo separado observa os locks no ponto do SELECT de BLOB; o driver SQLite real continua responsável por ler os dados. A instrumentação registra consultas e falhas sintéticas e é restaurada em finally. Não há credenciais, inferência ou fontes pessoais.

`pinned-source-read-mutations.test.mjs` define cinco pares controle/mutante: estado ativo, proprietário original, política vigente, tombstone e hash dos bytes. Cada controle deve passar; cada cópia incorreta deve reprovar no teste selecionado por ERR_ASSERTION. Timeout, falha de importação/build ou preparação não contam como detecção. Os cinco pares são cinco casos, não dez.

## Validação e rastreabilidade

Toda compilação, typecheck e execução ocorre no GitHub Actions. Os dois arquivos novos são incluídos pelo glob de coordenação existente. O gate exige a matriz completa, incluindo testes anteriores de core/storage/coordenação, sonda stock OpenCode com provider sintético e campanhas negativas anteriores. Os resultados só se aplicam ao SHA executado; criação de arquivos e análise estática não são PASS de runtime.

A revisão e a decisão de integração devem citar o head, IDs dos workflows/jobs, resultados e logs no PR correspondente e na issue #5. Conferir a árvore integrada contra a executada. Uma rodada reprovada permanece registrada; não remover testes nem alterar timeouts/comandos para obter verde. Este documento descreve escopo e critérios; o registro de gate no PR identifica a execução que os satisfaz.

## Cinco axiomas

**Success Criteria:** leitura retorna somente bytes verificados da referência fixada, sob identidade e política atuais; metadados e reservas permanecem intactos.

**Quality Standards:** implementação canônica, SQLite e locks reais, testemunha independente, fixtures sintéticas e cinco controles negativos com falha específica; execução somente no Actions.

**Completeness Criteria:** todos os 20 cenários, cinco pares de mutação e matriz anterior, incluindo recusa antes de ler BLOB quando a autorização é inválida e ausência de retorno no erro de commit.

**Definition of Done:** contrato, código e testes alinhados; matriz do head final aprovada, logs conferidos e árvore comparada; atualização da issue #5 sem encerrar WP-02 inteiro.

**Invariants:** nenhuma nova chamada, alteração de quota, liberação automática, credencial ou dado pessoal; pin não vira permit e cópia entregue não é revogável por alteração posterior.
