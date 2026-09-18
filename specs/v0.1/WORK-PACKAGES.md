# Work packages — Context Continuity 0.1.2

Execução incremental: [WP-01/A](../../docs/implementation/WP-01-A.md) cobre configuração/capacidades. Os oito pacotes ainda não estão integralmente concluídos. Fonte de rastreabilidade: [traceability.json](traceability.json). Contratos em [índice](README.md).

## Ordem

WP-00 é investigação independente de interfaces. WP-01→WP-02→WP-03→WP-04→WP-05 constrói núcleo. WP-06 depende do gate positivo WP-00 e do núcleo; WP-07 depende do pacote integrado. Investigação negativa conclui diagnóstico, não libera complete. Subcasos evitam exigir scheduler/host no DoD de tipos/storage.

## WP-00 — Prova das fronteiras públicas e transporte terminal

**Dependências:** nenhuma implementação anterior; especificação revisada.

**Requisitos vinculados:** R01, R05, R06, R25, R29, R33.

**Casos de conclusão:** T01.host, T05.host, T06.host, T25.host, T29.host, T33.host.

### Trabalho atômico

1. Instalar host stock isolado e provider recorder sintético; fixar SDK/codec e hashes.
2. Executar Capture→seal→veto por plugin/rota pública e confirmar P01–P14, incluindo plugin posterior.
3. Contar requests auxiliares no endpoint e confirmar zero tool dispatch/sessões auxiliares persistidas.
4. Relatar capacidades exatas e handoff da rota; não iniciar chamadas live.

### Success Criteria

Demonstrar P01–P14 no perfil público escolhido, ou registrar exatamente a capacidade ausente sem liberar complete. Captura parcial, selo terminal e retries devem aparecer no recorder.

### Quality Standards

Testar implementação real do componente, com fixtures sintéticas/relógio controlado quando adequado. Storage usa SQLite/FS reais; host usa instalação stock; live só com budget aprovado. Não duplicar algoritmo num mock e chamar isso de prova.

### Completeness Criteria

Cobrir sessão intercalada, codec, mudança no turno atual, zero tool dispatch, attempts físicos e restauração de baseURL; um hook funcionando não encerra o gate.

### Definition of Done

Todos os casos de conclusão do pacote passam com artefatos e comandos reproduzíveis; documentação e registro coerentes. WP-00 pode concluir investigação negativa explicitamente, sem habilitar dependente em modo completo. Testes de gate/integração futuros não são antecipados nem bloqueiam circularmente o componente.

### Invariants

Host stock intacto; listener somente loopback opt-in; nenhuma credencial pessoal nos artefatos; investigação negativa nunca equivale a suporte completo.

**Evidência esperada:** comandos e commit, resultado por subcaso, fixtures e hashes; traces sanitizados quando cabíveis. Não equivale a release ou autorização automática de gasto.

## WP-01 — Contratos, identidade e configuração

**Dependências:** nenhuma implementação anterior; especificação revisada.

**Requisitos vinculados:** R02, R06, R07, R15, R30, R33.

**Casos de conclusão:** T02.contract, T06.contract, T07.contract, T15.contract, T30.contract, T33.capabilities, T37.contract.

### Trabalho atômico

1. Implementar tipos estritos, canonicalização, hash de fonte/payload/unidade e identidade persistível.
2. Implementar Manifest tipado/congelado, WorkContext e validação de proposta sem campos de notas ocultos.
3. Resolver configuração e tabela verdade de complete; captura parcial não recebe autoridade de envio.
4. Testar dois formatos sintéticos, payload repetido/modificado e vetores Unicode/hash.

### Success Criteria

Dois formatos nativos compartilham os mesmos contratos; identidades/digests/Manifest e tabela de capacidades rejeitam entradas ambíguas antes de estado publicável.

### Quality Standards

Testar implementação real do componente, com fixtures sintéticas/relógio controlado quando adequado. Storage usa SQLite/FS reais; host usa instalação stock; live só com budget aprovado. Não duplicar algoritmo num mock e chamar isso de prova.

### Completeness Criteria

Cobrir fronteiras Unicode/números, fonte versus payload, referências tipadas, WorkContext desconhecido, schema estrito e revisões persistíveis; reparo/retry é prova posterior WP-03.

### Definition of Done

Todos os casos de conclusão do pacote passam com artefatos e comandos reproduzíveis; documentação e registro coerentes. WP-00 pode concluir investigação negativa explicitamente, sem habilitar dependente em modo completo. Testes de gate/integração futuros não são antecipados nem bloqueiam circularmente o componente.

### Invariants

Origem/escopo não vêm do modelo; payload opaco não vira vazio; same source_refs não mascara role diferente; Capture não recebe autoridade de SealedFrame.

**Evidência esperada:** comandos e commit, resultado por subcaso, fixtures e hashes; traces sanitizados quando cabíveis. Não equivale a release ou autorização automática de gasto.

## WP-02 — Ledger e persistência transacional

**Dependências:** WP-01.

**Requisitos vinculados:** R03, R12, R19, R32.

**Casos de conclusão:** T03.storage, T12.storage, T19.storage, T32.archive, T38.archive.

### Trabalho atômico

1. Implementar schema, migrations, root map, jobs/attempts/operations e manifests.
2. Implementar lock de workspace, staging/reserva de quota/ref/GC e reader pins.
3. Implementar lease/fence, View CAS, backups/catalog e recovery sem replay de rede.
4. Implementar ArchiveManifest/Records, remapeamento e namespace arquivo, FKs completas e quotas.

### Success Criteria

Commit nunca expõe fonte parcial; quota e GC não disputam reuso de blob; operações humanas têm proveniência sem LLM; importação cria somente arquivo isolado.

### Quality Standards

Testar implementação real do componente, com fixtures sintéticas/relógio controlado quando adequado. Storage usa SQLite/FS reais; host usa instalação stock; live só com budget aprovado. Não duplicar algoritmo num mock e chamar isso de prova.

### Completeness Criteria

Testar SQLite/FS e restart, todos relacionamentos de FK, lock de workspace, reservas concorrentes, staged/orphan blobs, namespace e manifesto de arquivo; teste de hook fica em WP-06.

### Definition of Done

Todos os casos de conclusão do pacote passam com artefatos e comandos reproduzíveis; documentação e registro coerentes. WP-00 pode concluir investigação negativa explicitamente, sem habilitar dependente em modo completo. Testes de gate/integração futuros não são antecipados nem bloqueiam circularmente o componente.

### Invariants

Fontes precedem publicação; lock do SO não é lease expirável; fence antigo perde autoridade; export não carrega auth; tombstone impede recriação por callback.

**Evidência esperada:** comandos e commit, resultado por subcaso, fixtures e hashes; traces sanitizados quando cabíveis. Não equivale a release ou autorização automática de gasto.

## WP-03 — Scheduler e executor com admissão física

**Dependências:** WP-01, WP-02.

**Requisitos vinculados:** R04, R06, R14, R15, R16, R17, R35.

**Casos de conclusão:** T04.scheduler, T14.scheduler, T15.scheduler, T16.scheduler, T17.scheduler, T35.accounting, T37.executor, T40.executor.

### Trabalho atômico

1. Implementar trigger 50% com reservas, seleção lógica, rearmamento e coalescência.
2. Congelar EffectiveFrame/Manifest/mission e criar AttemptPermit por request físico.
3. Implementar executor HTTP sem retries/tools/continuations implícitos, máximo2 permits.
4. Implementar stop local/quarantine, remote unknown, deadline e contabilização conservadora.

### Success Criteria

Gatilho/rearmamento não fazem loop; permits limitam requests HTTP auxiliares reais, mantendo progresso do pai e contabilização de reserva incerta.

### Quality Standards

Testar implementação real do componente, com fixtures sintéticas/relógio controlado quando adequado. Storage usa SQLite/FS reais; host usa instalação stock; live só com budget aprovado. Não duplicar algoritmo num mock e chamar isso de prova.

### Completeness Criteria

Cobrir T-1/T, F real, noop, retry OU reparo, deadline, quarantine, late callback e quota; medir endpoint sintético, não só contar chamadas ao mock fork.

### Definition of Done

Todos os casos de conclusão do pacote passam com artefatos e comandos reproduzíveis; documentação e registro coerentes. WP-00 pode concluir investigação negativa explicitamente, sem habilitar dependente em modo completo. Testes de gate/integração futuros não são antecipados nem bloqueiam circularmente o componente.

### Invariants

Máximo2 requests auxiliares por job; sem retries/tools implícitos; cache continua na ocupação; terminal não publica; local stop desconhecido não libera outro run.

**Evidência esperada:** comandos e commit, resultado por subcaso, fixtures e hashes; traces sanitizados quando cabíveis. Não equivale a release ou autorização automática de gasto.

## WP-04 — Projeção achatada e publicação

**Dependências:** WP-01, WP-02, WP-03.

**Requisitos vinculados:** R08, R09, R10, R11, R12, R13, R27, R28.

**Casos de conclusão:** T08.projection, T09.projection, T10.projection, T11.dependencies, T12.publish, T13.projection, T27.projection, T28.projection, T39.projection.

### Trabalho atômico

1. Implementar renderer achatado sobre raízes originais e composição de capítulos, não replay de strings.
2. Implementar seal/fingerprint atual, CAS de View e emissions separadas.
3. Implementar closure content versus history, invalidação e supressão de raízes com tombstone.
4. Implementar plano/commit de restore com expansão explícita e Operation de correção sem job.
5. Provar 2/10/64 consolidações, restart e mutações que perderiam cauda ou payload.

### Success Criteria

Partindo sempre das raízes brutas, várias consolidações/restore/restart produzem sequência exata, sem resumo fantasma ou cauda duplicada.

### Quality Standards

Testar implementação real do componente, com fixtures sintéticas/relógio controlado quando adequado. Storage usa SQLite/FS reais; host usa instalação stock; live só com budget aprovado. Não duplicar algoritmo num mock e chamar isso de prova.

### Completeness Criteria

Cobrir 2/10/64 ciclos, overlap, source/role/config drift, CAS, content closure, history supersedes, correção humana e restore expandido; teste host fica WP-06.

### Definition of Done

Todos os casos de conclusão do pacote passam com artefatos e comandos reproduzíveis; documentação e registro coerentes. WP-00 pode concluir investigação negativa explicitamente, sem habilitar dependente em modo completo. Testes de gate/integração futuros não são antecipados nem bloqueiam circularmente o componente.

### Invariants

Coverage física não depende de S1 existir no host; View é única seleção; inválido sai do presente; falta de orçamento bloqueia em vez de reviver derivado incorreto.

**Evidência esperada:** comandos e commit, resultado por subcaso, fixtures e hashes; traces sanitizados quando cabíveis. Não equivale a release ou autorização automática de gasto.

## WP-05 — Consulta, blocos, feedback e operações

**Dependências:** WP-01, WP-02, WP-04.

**Requisitos vinculados:** R20, R21, R22, R23, R26, R31, R32.

**Casos de conclusão:** T20.tools, T21.blocks, T22.blocks, T23.blocks, T26.feedback, T31.tools, T32.redaction, T38.paging.

### Trabalho atômico

1. Implementar search/read, cursores byte-safe/HMAC e recortes com autoridade.
2. Ligar comandos de bloco à publicação imediata de View em pause ou sem job.
3. Implementar receipt idempotente com WorkContext e notas determinísticas bounded, seq de expiração.
4. Implementar correção/redaction de derivados/index/notas/backups e consulta após exclusão.
5. Verificar restore/arquivo pela UX sem executar efeitos externos.

### Success Criteria

Leitura reconstrói bytes sob orçamento; regras mudam imediatamente; notas ajustam recorte e expiram sem crescer; exclusão não reaparece por busca/derivados.

### Quality Standards

Testar implementação real do componente, com fixtures sintéticas/relógio controlado quando adequado. Storage usa SQLite/FS reais; host usa instalação stock; live só com budget aprovado. Não duplicar algoritmo num mock e chamar isso de prova.

### Completeness Criteria

Cobrir linha gigante, CRLF/UTF-8, cursor e envelope mínimo, escopos A/B/null, três reads distintos, seqN+2, pause e limpeza dos derivados/índices/backups gerenciados.

### Definition of Done

Todos os casos de conclusão do pacote passam com artefatos e comandos reproduzíveis; documentação e registro coerentes. WP-00 pode concluir investigação negativa explicitamente, sem habilitar dependente em modo completo. Testes de gate/integração futuros não são antecipados nem bloqueiam circularmente o componente.

### Invariants

Origem não ganha autoridade; regra humana não é reescrita pelo clone; cursor sempre progride; nota é determinística e não promove lookup normal a âncora permanente.

**Evidência esperada:** comandos e commit, resultado por subcaso, fixtures e hashes; traces sanitizados quando cabíveis. Não equivale a release ou autorização automática de gasto.

## WP-06 — Plugin instalável, handoff e ciclo integrado

**Dependências:** WP-00, WP-05.

**Requisitos vinculados:** R08, R10, R12, R18, R24, R28, R36.

**Casos de conclusão:** T08.host, T10.host, T12.host, T18.host, T24.host, T28.host, T36.host, T39.host, T40.host.

### Trabalho atômico

1. Empacotar plugin + perfil nativo e rota local opt-in usando somente configuração pública.
2. Correlacionar captures, requests finais, resets e segredo local sem sair upstream.
3. Executar todos P01–P14 no tarball final; instalar, pausar, reiniciar e remover com handoff/baseURL restaurada.
4. Repetir testes host integrados, inclusive quota, cancelamento e regra alterada no turno atual.

### Success Criteria

Tarball instalado no OpenCode stock executa o ciclo completo e sai com rota/checkpoint válidos, sem internals ou tarefa manual escondida.

### Quality Standards

Testar implementação real do componente, com fixtures sintéticas/relógio controlado quando adequado. Storage usa SQLite/FS reais; host usa instalação stock; live só com budget aprovado. Não duplicar algoritmo num mock e chamar isso de prova.

### Completeness Criteria

Repetir P01–P14 no pacote final, correlacionar captures/SSE/attempts, testar token local, restart, reset, pausa, upgrade e remoção; absent capability impede complete.

### Definition of Done

Todos os casos de conclusão do pacote passam com artefatos e comandos reproduzíveis; documentação e registro coerentes. WP-00 pode concluir investigação negativa explicitamente, sem habilitar dependente em modo completo. Testes de gate/integração futuros não são antecipados nem bloqueiam circularmente o componente.

### Invariants

Nenhum host fork obrigatório; mesma entrada efetiva para clone; headers locais não saem upstream; sem credenciais extraídas ou listener público; pause não desconecta o pai.

**Evidência esperada:** comandos e commit, resultado por subcaso, fixtures e hashes; traces sanitizados quando cabíveis. Não equivale a release ou autorização automática de gasto.

## WP-07 — Conformance, portabilidade e piloto

**Dependências:** WP-06.

**Requisitos vinculados:** R30, R34, R35.

**Casos de conclusão:** T30.portability, T34.pilot, T35.pilot.

### Trabalho atômico

1. Executar conformance e segundo adaptador real com versão fixada.
2. Congelar evaluation-plan com oráculos, critérios, horizon e orçamento explicitamente autorizado.
3. Executar piloto pareado somente após aprovação de budget; contabilizar falhas/intervenções/custos reais.
4. Publicar resultados positivos/negativos/inconclusivos e decisão conforme protocolo prévio.

### Success Criteria

Segundo host real reutiliza núcleo; piloto produz decisão rastreável ao plano prévio mesmo quando negativa/inconclusiva, sem atribuir ganho do conjunto ao clone sem contraste.

### Quality Standards

Testar implementação real do componente, com fixtures sintéticas/relógio controlado quando adequado. Storage usa SQLite/FS reais; host usa instalação stock; live só com budget aprovado. Não duplicar algoritmo num mock e chamar isso de prova.

### Completeness Criteria

Separar conformance, portabilidade e produto; publicar todos os pares e censuras, custos unknown, oráculos, thresholds prévios e orçamento; não estender gasto para buscar resultado favorável.

### Definition of Done

Todos os casos de conclusão do pacote passam com artefatos e comandos reproduzíveis; documentação e registro coerentes. WP-00 pode concluir investigação negativa explicitamente, sem habilitar dependente em modo completo. Testes de gate/integração futuros não são antecipados nem bloqueiam circularmente o componente.

### Invariants

Sessão é unidade independente; instalação não é suporte; token savings não é qualidade; nenhuma call live sem orçamento; regressão crítica impede release mesmo com média boa.

**Evidência esperada:** comandos e commit, resultado por subcaso, fixtures e hashes; traces sanitizados quando cabíveis. Não equivale a release ou autorização automática de gasto.

## Resoluções vinculantes da REVIEW-003

WP-00 preserva os oráculos negativos C01/C02 e regressões de lifecycle C03–C08. WP-01 implementa ToolExecutionRef e JCS (C09/C12). WP-02 implementa owners/reservas reconciliáveis e OriginCoverage opaca (C09–C11). WP-03 a WP-06 devem conservar esses critérios ao substituir a sonda pelo core. Não promover checkpoint de teste a ledger. Os cinco axiomas e os 55 subcasos continuam obrigatórios; as provas incrementais não são PASS agregado.
