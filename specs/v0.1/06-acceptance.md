# SPEC-06 — requisitos e aceitação

Normativo 0.1.1. Fonte única de IDs, donos e dependências: [traceability.json](traceability.json). O verificador exige reciprocidade com estas tabelas e os pacotes; não julga significado semântico. TODOS os testes de runtime iniciam not_run.

## 1. Matriz de rastreabilidade

| ID | Obrigação | Contrato | Dono responsável | Casos |
|---|---|---|---|---|
| R01 | Instalar via interface pública, sem alteração do host. | SPEC-04 | WP-00 | T01.host |
| R02 | Resolver escopo sem misturar sessões. | SPEC-01 | WP-01 | T02.contract |
| R03 | Admitir um proprietário/job por sessão, com fencing. | SPEC-02/03 | WP-02 | T03.storage |
| R04 | Manutenção não dispara manutenção recursiva. | SPEC-02 | WP-03 | T04.scheduler |
| R05 | Clone não executa tools locais ou remotas. | SPEC-01/04 | WP-00 | T05.host |
| R06 | Distinguir snapshot ativo, fidelidade do fork e cache. | SPEC-01/04 | WP-03 | T06.contract, T06.host |
| R07 | Identificar fontes por ID/revisão, não por texto ou ordem inferida. | SPEC-01 | WP-01 | T07.contract |
| R08 | Preservar toda a cauda posterior ao snapshot, uma vez. | SPEC-02 | WP-04 | T08.projection, T08.host |
| R09 | Substituir somente intervalo contíguo de grupos fechados. | SPEC-01/02 | WP-04 | T09.projection |
| R10 | Compactação nativa invalida proposta da epoch anterior. | SPEC-02/04 | WP-04 | T10.projection, T10.host |
| R11 | Revert/mutação de fonte não reaplica síntese stale. | SPEC-02 | WP-04 | T11.dependencies |
| R12 | Crash não publica metade da operação ou repete inferência órfã. | SPEC-03 | WP-02 | T12.storage, T12.publish, T12.host |
| R13 | Retry/publicação repetida é idempotente. | SPEC-02/03 | WP-04 | T13.projection |
| R14 | Gatilho usa entrada inteira, inclusive cacheada. | SPEC-02 | WP-03 | T14.scheduler |
| R15 | Reservar saída, missão e crescimento antes do fork. | SPEC-02 | WP-03 | T15.contract, T15.scheduler |
| R16 | Rearmamento impede loops no mesmo contexto. | SPEC-02 | WP-03 | T16.scheduler |
| R17 | Noop/ganho insuficiente mantém visão e não cria capítulo. | SPEC-01/02 | WP-03 | T17.scheduler |
| R18 | Overflow durante manutenção não provoca descarte ou request inválido. | SPEC-02/04 | WP-06 | T18.host |
| R19 | Fonte durável precede publicação que a remove da janela. | SPEC-03 | WP-02 | T19.storage |
| R20 | Fonte ausente/proibida não é reconstruída por palpite. | SPEC-03/05 | WP-05 | T20.tools |
| R21 | Âncoras ativas sobrevivem literalmente fora da sumarização. | SPEC-01/05 | WP-05 | T21.blocks |
| R22 | Revogação/versionamento de regra invalida manutenção obsoleta. | SPEC-02/05 | WP-05 | T22.blocks |
| R23 | Bloco curado respeita origem, escopo e orçamento. | SPEC-05 | WP-05 | T23.blocks |
| R24 | Pausa/desinstalação têm saída segura e explícita. | SPEC-04/05 | WP-06 | T24.host |
| R25 | Estado remoto não mantém conteúdo removido em segredo. | SPEC-01/04 | WP-00 | T25.host |
| R26 | Feedback é limitado e não transforma toda busca em âncora. | SPEC-05 | WP-05 | T26.feedback |
| R27 | Consolidação preserva lineage sem carregar capítulos indefinidamente. | SPEC-01/02 | WP-04 | T27.projection |
| R28 | Publicação não é confundida com emissão ou consumo pelo modelo. | SPEC-01/02 | WP-04 | T28.projection, T28.host |
| R29 | Outro plugin não invalida silenciosamente a garantia de entrada. | SPEC-04 | WP-00 | T29.host |
| R30 | Núcleo é independente de tipos/banco privados dos hosts. | SPEC-01/04 | WP-01 | T30.contract, T30.portability |
| R31 | Consulta não cruza projetos nem aceita paths como autorização. | SPEC-01/05 | WP-05 | T31.tools |
| R32 | Exclusão/exportação/importação preservam autorização e integridade. | SPEC-03 | WP-02 | T32.archive, T32.redaction |
| R33 | Compatibilidade é por versão/rota/capacidades verificadas. | SPEC-01/04 | WP-00 | T33.capabilities, T33.host |
| R34 | Avaliar continuidade contra baseline real, com ablação. | SPEC-CC-0.1 | WP-07 | T34.pilot |
| R35 | Medir custo/cache completos; desconhecido não vira zero. | SPEC-01/02 | WP-07 | T35.accounting, T35.pilot |
| R36 | Ativação, diagnóstico e UX não fazem inferência paga oculta. | SPEC-02/05 | WP-06 | T36.host |

## 2. Casos atômicos e resultado agregado

Cada subcaso tem dono e pré-requisitos no registro. Um WP fecha somente seus subcasos; Tnn agregado é pass somente se TODOS os subcasos aplicáveis ao perfil forem pass, com evidência. Fail prevalece; sem fail, blocked prevalece; qualquer not_run mantém agregado not_run. Um diagnóstico negativo pode concluir investigação, mas não muda fail/blocked em pass de capacidade.

WP-00 usa probe mínimo independente para provar interfaces, não uma implementação falsa do núcleo. WP-06 repete o gate no pacote integrado. As partes de storage, projeção, scheduler e host de T12/T37/T40 não são intercambiáveis.

| Caso | Dono | Pré-requisitos | Classe | Estado inicial |
|---|---|---|---|---|
| T01.host | WP-00 | nenhum | host | not_run |
| T02.contract | WP-01 | nenhum | component | not_run |
| T03.storage | WP-02 | WP-01 | component | not_run |
| T04.scheduler | WP-03 | WP-01, WP-02 | component | not_run |
| T05.host | WP-00 | nenhum | host | not_run |
| T06.contract | WP-01 | nenhum | component | not_run |
| T06.host | WP-00 | nenhum | host | not_run |
| T07.contract | WP-01 | nenhum | component | not_run |
| T08.projection | WP-04 | WP-01, WP-02, WP-03 | component | not_run |
| T08.host | WP-06 | WP-00, WP-05 | host | not_run |
| T09.projection | WP-04 | WP-01, WP-02, WP-03 | component | not_run |
| T10.projection | WP-04 | WP-01, WP-02, WP-03 | component | not_run |
| T10.host | WP-06 | WP-00, WP-05 | host | not_run |
| T11.dependencies | WP-04 | WP-01, WP-02, WP-03 | component | not_run |
| T12.storage | WP-02 | WP-01 | component | not_run |
| T12.publish | WP-04 | WP-01, WP-02, WP-03 | component | not_run |
| T12.host | WP-06 | WP-00, WP-05 | host | not_run |
| T13.projection | WP-04 | WP-01, WP-02, WP-03 | component | not_run |
| T14.scheduler | WP-03 | WP-01, WP-02 | component | not_run |
| T15.contract | WP-01 | nenhum | component | not_run |
| T15.scheduler | WP-03 | WP-01, WP-02 | component | not_run |
| T16.scheduler | WP-03 | WP-01, WP-02 | component | not_run |
| T17.scheduler | WP-03 | WP-01, WP-02 | component | not_run |
| T18.host | WP-06 | WP-00, WP-05 | host | not_run |
| T19.storage | WP-02 | WP-01 | component | not_run |
| T20.tools | WP-05 | WP-01, WP-02, WP-04 | component | not_run |
| T21.blocks | WP-05 | WP-01, WP-02, WP-04 | component | not_run |
| T22.blocks | WP-05 | WP-01, WP-02, WP-04 | component | not_run |
| T23.blocks | WP-05 | WP-01, WP-02, WP-04 | component | not_run |
| T24.host | WP-06 | WP-00, WP-05 | host | not_run |
| T25.host | WP-00 | nenhum | host | not_run |
| T26.feedback | WP-05 | WP-01, WP-02, WP-04 | component | not_run |
| T27.projection | WP-04 | WP-01, WP-02, WP-03 | component | not_run |
| T28.projection | WP-04 | WP-01, WP-02, WP-03 | component | not_run |
| T28.host | WP-06 | WP-00, WP-05 | host | not_run |
| T29.host | WP-00 | nenhum | host | not_run |
| T30.contract | WP-01 | nenhum | component | not_run |
| T30.portability | WP-07 | WP-06 | host | not_run |
| T31.tools | WP-05 | WP-01, WP-02, WP-04 | component | not_run |
| T32.archive | WP-02 | WP-01 | component | not_run |
| T32.redaction | WP-05 | WP-01, WP-02, WP-04 | component | not_run |
| T33.capabilities | WP-01 | nenhum | component | not_run |
| T33.host | WP-00 | nenhum | host | not_run |
| T34.pilot | WP-07 | WP-06 | live | not_run |
| T35.accounting | WP-03 | WP-01, WP-02 | component | not_run |
| T35.pilot | WP-07 | WP-06 | live | not_run |
| T36.host | WP-06 | WP-00, WP-05 | host | not_run |
| T37.contract | WP-01 | nenhum | component | not_run |
| T37.executor | WP-03 | WP-01, WP-02 | component | not_run |
| T38.paging | WP-05 | WP-01, WP-02, WP-04 | component | not_run |
| T38.archive | WP-02 | WP-01 | component | not_run |
| T39.projection | WP-04 | WP-01, WP-02, WP-03 | component | not_run |
| T39.host | WP-06 | WP-00, WP-05 | host | not_run |
| T40.executor | WP-03 | WP-01, WP-02 | component | not_run |
| T40.host | WP-06 | WP-00, WP-05 | host | not_run |

## 3. Famílias de aceitação

### T01 — Instalação pública

Instalar host stock e pacote local; declarar perfil Native ou HTTP-Local. Verificar hash do host, configuração de rota consentida e rollback sem internals.

Subcasos normativos: T01.host. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T01.host:** Instalar host stock e pacote local; declarar perfil Native ou HTTP-Local. Verificar hash do host, configuração de rota consentida e rollback sem internals.


### T02 — Escopo concorrente

Intercalar duas sessões/workspaces com IDs externos iguais; Scope/incarnation distintos. Dados e jobs não se misturam; entrada ambígua é recusada antes de rede.

Subcasos normativos: T02.contract. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T02.contract:** Intercalar duas sessões/workspaces com IDs externos iguais; Scope/incarnation distintos. Dados e jobs não se misturam; entrada ambígua é recusada antes de rede.


### T03 — Proprietário e job único

Disputar lease/job/aux_run entre duas instâncias. Fence antigo não publica; quarantine impede novo run; lock de workspace não é substituído por lease expirável.

Subcasos normativos: T03.storage. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T03.storage:** Disputar lease/job/aux_run entre duas instâncias. Fence antigo não publica; quarantine impede novo run; lock de workspace não é substituído por lease expirável.


### T04 — Não recursão

Primary elegível cria um job; native_compaction, other e maintenance não recursam. Eventos simultâneos coalescem sem rede extra.

Subcasos normativos: T04.scheduler. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T04.scheduler:** Primary elegível cria um job; native_compaction, other e maintenance não recursam. Eventos simultâneos coalescem sem rede extra.


### T05 — Isolamento do clone

Endpoint sintético devolve function tool call ao clone. Zero despacho local/MCP, E_TOOL e zero sessões auxiliares no host; ferramentas remotas excluem perfil.

Subcasos normativos: T05.host. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T05.host:** Endpoint sintético devolve function tool call ao clone. Zero despacho local/MCP, E_TOOL e zero sessões auxiliares no host; ferramentas remotas excluem perfil.


### T06 — Snapshot e fidelidade

Contrato verifica Captures parciais versus SealedFrame, hashes e Manifest. Ensaio host compara input efetivo final e fork. Fidelity unknown/different impede complete; cache hit não supre essa falta.

Subcasos normativos: T06.contract, T06.host. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T06.contract:** Validar Capture parcial, SealedFrame, fingerprint e Manifest por schemas/vetores; sem executar rede, host ou certificação de prefixo live.

**T06.host:** Comparar no recorder o body final efetivo do pai e do fork lógico; unknown/different impede complete. Cache não é inferido de endpoint sintético.


### T07 — Identidade e conteúdo repetido

Texto repetido mantém IDs diferentes; payload/role/metadata mudado com mesmas source_refs muda unit_digest; reinício mantém mapa de identidades e revisões.

Subcasos normativos: T07.contract. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T07.contract:** Texto repetido mantém IDs diferentes; payload/role/metadata mudado com mesmas source_refs muda unit_digest; reinício mantém mapa de identidades e revisões.


### T08 — Cauda preservada

Base U001..U012; compactar U003..U008; acrescentar U013..U016 durante job. Esperado U001,U002,SUMMARY,U009..U016, payloads intactos, sem dupla cauda.

Subcasos normativos: T08.projection, T08.host. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T08.projection:** Executar F-PUBLISH sobre implementação do renderer, partindo das raízes e preservando U009..U016 exatamente uma vez, inclusive após serialização do plano.

**T08.host:** Receber cauda concorrente no OpenCode stock; verificar no endpoint que a próxima entrada tem a mesma sequência exata do oráculo F-PUBLISH.


### T09 — Fronteiras de protocolo

Calls/results paralelos, lowering que funde mensagens, bordas e mídia opaca. Corte deve ser grupo fechado/inteiro; mapping ambíguo recusa poda, sem request inválido.

Subcasos normativos: T09.projection. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T09.projection:** Calls/results paralelos, lowering que funde mensagens, bordas e mídia opaca. Corte deve ser grupo fechado/inteiro; mapping ambíguo recusa poda, sem request inválido.


### T10 — Compactação nativa concorrente

Ready seguido de reset nativo. Proposta antiga não se aplica à epoch nova. Reset falho não apaga View; rota local reconhece tipo e handoff correto.

Subcasos normativos: T10.projection, T10.host. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T10.projection:** Fornecer eventos de reset sucesso/falha ao core; conferir epoch, invalidade de ready e preservação da View sem depender de host instalado.

**T10.host:** Provocar compactação nativa real no host, bem-sucedida e falha; correlacionar observações à nova epoch antes do próximo despacho.


### T11 — Revert e mutação

X sustenta A, B consolida A. Alterar X ou revogar âncora que ambos receberam invalida closure content, remove overlays e marca índice. History:supersedes não cria ciclo. Expansão que não cabe bloqueia despacho.

Subcasos normativos: T11.dependencies. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T11.dependencies:** X sustenta A, B consolida A. Alterar X ou revogar âncora que ambos receberam invalida closure content, remove overlays e marca índice. History:supersedes não cria ciclo. Expansão que não cabe bloqueia despacho.


### T12 — Crash nos pontos de commit

Storage: staging/fsync/ref/GC e restart. Publish: commit de Operation/Chapter/View/job completo ou nenhum. Host: queda após commit antes de forward e reload do plugin não repetem geração nem escondem atividade incerta.

Subcasos normativos: T12.storage, T12.publish, T12.host. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T12.storage:** Interromper implementação de storage nos pontos staging, blob, referência e transação SQLite; reiniciar processo e provar integridade local sem renderer ou hook de host.

**T12.publish:** Falhar antes/depois do commit de Operation/Chapter/View/job no core; reabrir storage e conferir seleção integral, sem metade de publicação nem duplicação.

**T12.host:** Reiniciar plugin/host após commit antes de forward; conferir requests reais e impedir replay de geração incerta ou sessão auxiliar órfã.


### T13 — Idempotência

Repetir callback, finalize e render: um capítulo/job e nova View única; attempts de rede distintos registrados, sem repetir texto. Terminal não ressuscita.

Subcasos normativos: T13.projection. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T13.projection:** Repetir callback, finalize e render: um capítulo/job e nova View única; attempts de rede distintos registrados, sem repetir texto. Terminal não ressuscita.


### T14 — Gatilho e cache

F-BUDGET C=1000000,I=900000,R=16000,H=650000: T=500000. T-1 não dispara, T dispara, cache read=450000 não reduz U.

Subcasos normativos: T14.scheduler. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T14.scheduler:** F-BUDGET C=1000000,I=900000,R=16000,H=650000: T=500000. T-1 não dispara, T dispara, cache read=450000 não reduz U.


### T15 — Reservas e configuração

Contrato: parâmetros, C/R obrigatórios e limites numéricos. Scheduler: calcular B/G/F/T/L/N/M, missão real maior, reseleção por protocolo e nenhum envio acima da janela.

Subcasos normativos: T15.contract, T15.scheduler. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T15.contract:** Validar tipos/domínios da configuração, presença C/R, intervalos numéricos e serialização da configuração resolvida; não exigir scheduler já implementado.

**T15.scheduler:** Calcular B/G/F/T/L/N/M, antecipação por reservas e missão real; endpoint sintético não recebe chamada acima do limite.


### T16 — Rearmamento

Rearmar por L→T ou N novo+cooldown; persistir digest/armed através de reinício. Mesma base com noop não produz loop de jobs.

Subcasos normativos: T16.scheduler. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T16.scheduler:** Rearmar por L→T ou N novo+cooldown; persistir digest/armed através de reinício. Mesma base com noop não produz loop de jobs.


### T17 — Noop e ganho insuficiente

Noop, replace vazio/maior/ganho<M não publicam. Contabilizar wrapper/referências/blocos no ganho e custo incerto sem economia inventada.

Subcasos normativos: T17.scheduler. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T17.scheduler:** Noop, replace vazio/maior/ganho<M não publicam. Contabilizar wrapper/referências/blocos no ganho e custo incerto sem economia inventada.


### T18 — Pressão durante manutenção

Fork lento enquanto pai cresce acima de B: hold/rebase explícito, nenhum descarte de resultados. Dentro da margem pai avança, sem aguardar clone.

Subcasos normativos: T18.host. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T18.host:** Fork lento enquanto pai cresce acima de B: hold/rebase explícito, nenhum descarte de resultados. Dentro da margem pai avança, sem aguardar clone.


### T19 — Fonte antes da poda

Pausas nas bordas reaproveitar-órfão/inserir-ref e listar-órfão/unlink. Mesmo lock protege ambas; duas sessões/import disputam quota reservada. Fsync/rename/commit falhos não deixam ref a parcial.

Subcasos normativos: T19.storage. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T19.storage:** Pausas nas bordas reaproveitar-órfão/inserir-ref e listar-órfão/unlink. Mesmo lock protege ambas; duas sessões/import disputam quota reservada. Fsync/rename/commit falhos não deixam ref a parcial.


### T20 — Ausência explícita

Referência missing/excluded/deleted não vira arquivo atual por path. Binário/UTF-8 inválido retorna text_unavailable; leitura explícita invalidated vem marcada, redacted não tem bytes.

Subcasos normativos: T20.tools. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T20.tools:** Referência missing/excluded/deleted não vira arquivo atual por path. Binário/UTF-8 inválido retorna text_unavailable; leitura explícita invalidated vem marcada, redacted não tem bytes.


### T21 — Âncoras literais

Dez ciclos de View mantêm bloco literal uma vez. Âncora não passa por resumo; versões e ordinais governam presença.

Subcasos normativos: T21.blocks. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T21.blocks:** Dez ciclos de View mantêm bloco literal uma vez. Âncora não passa por resumo; versões e ordinais governam presença.


### T22 — Revogação e revisão

Replace/deactivate sem job, em pause e após restart publicam View imediata. Nova versão mantém ordinal ativo; reativação aloca outro. Derivado que recebeu regra revogada fica invalidated.

Subcasos normativos: T22.blocks. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T22.blocks:** Replace/deactivate sem job, em pause e após restart publicam View imediata. Nova versão mantém ordinal ativo; reativação aloca outro. Derivado que recebeu regra revogada fica invalidated.


### T23 — Blocos e escopo

Tarefas A/B na mesma sessão recebem apenas seus blocos. Scope desconhecido não autoriza herança. Orçamento excessivo recusa conjunto sem remover outra regra.

Subcasos normativos: T23.blocks. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T23.blocks:** Tarefas A/B na mesma sessão recebem apenas seus blocos. Scope desconhecido não autoriza herança. Orçamento excessivo recusa conjunto sem remover outra regra.


### T24 — Pausa e remoção

Pause mantém overlay e listener; disable-prepared faz checkpoint e restaura baseURL antes de fechar módulo. Falha mantém pause e erro explícito; abrupt removal tem rollback documentado.

Subcasos normativos: T24.host. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T24.host:** Pause mantém overlay e listener; disable-prepared faz checkpoint e restaura baseURL antes de fechar módulo. Falha mantém pause e erro explícito; abrupt removal tem rollback documentado.


### T25 — Estado remoto

Rota stateful/Responses/WebSocket não prevista: complete inelegível, zero inferência de diagnóstico. Não fingir remoção de dados que ficaram em estado remoto.

Subcasos normativos: T25.host. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T25.host:** Rota stateful/Responses/WebSocket não prevista: complete inelegível, zero inferência de diagnóstico. Não fingir remoção de dados que ficaram em estado remoto.


### T26 — Feedback limitado

Três tarefas e leituras byte-overlap: só três chamadas distintas no mesmo WorkContext conhecido geram nota da interseção comum. Sem escopo não promover repetição. Nota criada em N expira no commit N+2; restart mantém expiração. Noop não consome recibos.

Subcasos normativos: T26.feedback. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T26.feedback:** Três tarefas e leituras byte-overlap: só três chamadas distintas no mesmo WorkContext conhecido geram nota da interseção comum. Sem escopo não promover repetição. Nota criada em N expira no commit N+2; restart mantém expiração. Noop não consome recibos.


### T27 — Consolidação e lineage

Projetar A..F, S1 cobre BC, S2 cobre S1D achatado em BCD; entrada A..FG produz AS2EFG. Repetir 2,10,64 consolidações com cauda/restart. Restore parcial expande replacement inteiro somente com consentimento; sem replay textual de resumos.

Subcasos normativos: T27.projection. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T27.projection:** Projetar A..F, S1 cobre BC, S2 cobre S1D achatado em BCD; entrada A..FG produz AS2EFG. Repetir 2,10,64 consolidações com cauda/restart. Restore parcial expande replacement inteiro somente com consentimento; sem replay textual de resumos.


### T28 — Publicado não é entregue

Selected/emit/ack independentes: commit sem envio, envio sem resposta e resposta associada têm timestamps verdadeiros ou null. Alteração de política antes de forward impede body stale.

Subcasos normativos: T28.projection, T28.host. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T28.projection:** Aplicar callbacks selected/emitted/ack ao registro do core com relógio controlado; missing permanece null e commit não equivale a entrega.

**T28.host:** Observar no transporte real do perfil commit sem forward, forward sem resposta e resposta associada, com timestamps fiéis e sem body stale.


### T29 — Ordem dos plugins

Plugin altera system/tools/model depois de Capture. SealedFrame/codec terminal vê body novo e invalida ready anterior. Ensaio nativo sem fronteira não obtém complete por prova parcial.

Subcasos normativos: T29.host. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T29.host:** Plugin altera system/tools/model depois de Capture. SealedFrame/codec terminal vê body novo e invalida ready anterior. Ensaio nativo sem fronteira não obtém complete por prova parcial.


### T30 — Independência do núcleo

Mesmo core em dois formatos nativos sintéticos sem imports host; segundo adaptador REAL em perfil próprio testa portabilidade e não herda PASS dos sintéticos.

Subcasos normativos: T30.contract, T30.portability. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T30.contract:** Executar mesmos contratos do núcleo contra dois formatos sintéticos sem imports internos de host, sem declarar Gemini homologado.

**T30.portability:** Fixar e instalar segundo adaptador real; reutilizar o núcleo e executar conformance do perfil sem reutilizar PASS de fixtures.


### T31 — Autorização de consulta

Campos path/session_id ou EntityRef de outro escopo são recusados sem revelar existência. Cursor inválido não recomeça busca; consulta é dado, não autorização.

Subcasos normativos: T31.tools. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T31.tools:** Campos path/session_id ou EntityRef de outro escopo são recusados sem revelar existência. Cursor inválido não recomeça busca; consulta é dado, não autorização.


### T32 — Exportação e exclusão

Archive: export manifest misto fonte/âncora/capítulo, import para namespace novo, preservar índices/revisões/ranges/digests de excertos e origin-map. Redaction: X→A→B, proposals/index/notes/backups gerenciados limpos, tombstone impede recaptura; cleanup falho não marca apagamento completo.

Subcasos normativos: T32.archive, T32.redaction. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T32.archive:** Round-trip no storage de fonte/bloco/capítulo/Manifest/Operation mistos: IDs remapeados, citações estáveis e import sem ativação/execução; testar FKs e validação dos arquivos.

**T32.redaction:** Após projeção/consulta implementadas, excluir X de X→A→B; limpar bytes de derivados/index/notas/backups gerenciados, invalidar cursores e impedir recaptura por tombstone.


### T33 — Versões e capacidades

Tabela verdade de capacidades: required verified AND fidelity verified AND gate pass. Unknown/different/cache hit não habilitam. Mudança de perfil revoga certificado aplicável; investigação terminada não equivale a suporte.

Subcasos normativos: T33.capabilities, T33.host. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T33.capabilities:** Executar tabela verdade pura para required/fidelity/gate; campo ausente e unknown/different nunca habilitam complete, mesmo com indicação de cache hit.

**T33.host:** Doctor e ensaio do host fixam versão/SDK/codec/rota; divergência real invalida certificado sem downgrade oculto nem calls pagas de diagnóstico.


### T34 — Avaliação de produto

Plano pré-registrado SPEC-08 precede chamadas, pares/unidade sessão/rubrica/stop-rules definidos. Resultado negativo/inconclusivo segue critérios prévios; budget ausente bloqueia execução.

Subcasos normativos: T34.pilot. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T34.pilot:** Plano pré-registrado SPEC-08 precede chamadas, pares/unidade sessão/rubrica/stop-rules definidos. Resultado negativo/inconclusivo segue critérios prévios; budget ausente bloqueia execução.


### T35 — Uso e economia

Accounting: entrada/cache/output/attempt reservado ou real sem dupla contagem e sem tratar unknown como zero. Piloto: total pai/workers/aux/recuperação/retrabalho, custo por aceita indefinido se zero, assinatura sem preços não recebe dólares fictícios.

Subcasos normativos: T35.accounting, T35.pilot. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T35.accounting:** Normalizar uso/cache/reserva por attempt do executor; ausência permanece unknown, categorias não somam duas vezes e cancelamento não implica estorno.

**T35.pilot:** Medir total de pai/workers/clone/recuperação/retrabalho e custo por tarefa aceita segundo plano prévio; zero aceitas não produz custo unitário zero.


### T36 — Ativação e diagnóstico

enabled=false + doctor/inspect: zero calls. Configuração local exige consentimento e perfil. Avisos distinguem prepared/published/emitted e não mascaram rota ou quota.

Subcasos normativos: T36.host. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T36.host:** enabled=false + doctor/inspect: zero calls. Configuração local exige consentimento e perfil. Avisos distinguem prepared/published/emitted e não mascaram rota ou quota.


### T37 — Schemas e saída do modelo

Contrato: fuzz estrito de Claim/Manifest/tipos/Unicode e índices de fontes mistas congelados. Executor: formato ruim pode consumir a segunda chamada; nunca format repair mais retry como terceira. Parciais/length/tool_call não publicáveis.

Subcasos normativos: T37.contract, T37.executor. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T37.contract:** Fuzz dos schemas do núcleo e manifesto congelado: campos extras, Unicode/números/indices/ranges inválidos são rejeitados; sem exigir retry/reparo do executor.

**T37.executor:** Resposta com formato inválido pode consumir apenas o segundo AttemptPermit; erro seguinte encerra. Contar HTTP físico no endpoint, sem terceira chamada.


### T38 — Paginação e integridade

Paging: linha UTF-8 gigante, CRLF, multibyte, fonte vazia; concatenação de páginas recompõe bytes; cursor avança estritamente ou E_BUDGET. Archive: limites/hash/referências do round-trip sem codec/credencial executável.

Subcasos normativos: T38.paging, T38.archive. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T38.paging:** Implementar tool com paginação intra-linha UTF-8, CRLF, envelope mínimo e cursor: recompor bytes sem perda/repetição ou retornar E_BUDGET.

**T38.archive:** Validar limites de bytes, hashes e relações do arquivo de export/import no storage; sem exigir paginação da tool ainda não implementada.


### T39 — Mudança de modelo e perfil

Troca no turno atual de system/tools/variante/rota altera seal/config e impede publicar snapshot antigo. Depois do dispatch, mudança só afeta próximo request. Nativo sem final-veto falha conformance.

Subcasos normativos: T39.projection, T39.host. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T39.projection:** Mudar system/tools/variant/config do SealedFrame sintético atual; core rejeita ready antigo antes de selecionar envelope.

**T39.host:** Mudar configuração e plugin posterior no turno atual do OpenCode; recorder mostra veto na fronteira terminal, sem envio do body anterior.


### T40 — Timeout e quotas

Executor: permit por request, 429→sucesso, formato→429, timeout e callback tardio; ≤2 requisições físicas auxiliares no endpoint. Host: retries do pai separados e reload sem sessão auxiliar órfã ou retomada paga automática.

Subcasos normativos: T40.executor, T40.host. Evidência inclui comando, commit, configuração/fixture e resultado por subcaso; não só nome do teste.

**T40.executor:** Executar cliente HTTP real contra endpoint sintético: 429, reparo, timeout, late response, permit único e máximo2 requests auxiliares por job.

**T40.host:** Contar requests do executor e retries do pai separadamente na integração; reload/cancelamento não repetem auxiliares órfãos nem perdem contadores.


## 4. Liberação e evidência

Falhas críticas de escopo, protocolo, fontes, ferramentas do clone, publicação, regras e exclusão bloqueiam release. G-OC-01 exige P01–P14 e a conjunção de SPEC-01. Pass de documento/modelo de referência não altera nenhum status de runtime.

Cada relatório contém product_commit, perfil/host/SDK/codec/route/model/variant/auth-type (sem segredo), caso, fixture/seed, comando real, resultado, artefatos com hashes e limitações. A mesma sessão não vira vários ensaios independentes pelo número de asserts.

Avaliação de produto obedece [SPEC-08](08-evaluation.md). Provas documentais verificam somente estrutura, contratos modelados e DDL de referência; demonstrar runtime exige implementação instalada e executada.
