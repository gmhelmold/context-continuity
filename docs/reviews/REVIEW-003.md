# REVIEW-003 — revisão adversarial integrada do trabalho entregue

**Veredito: CHANGES REQUIRED.** Preservar o trabalho e as provas válidas, mas não tratar a sonda atual como implementação confiável do produto nem como prova forte de preservação de todo o contexto.

**Data:** 17/09/2026, America/Sao_Paulo; parte dos registros de execução usa 18/09 em UTC. **Base auditada:** `8f844ed5798146c9626653627d67916df0737583`, `main`, após os PRs #2, #11 e #12. **Repositório:** `gmhelmold/context-continuity`.

**Entrega deste review:** relatório, sumário de evidências e instruções de reprodução. Não altera o runtime, os contratos normativos, os reviews anteriores ou os resultados históricos. Nenhum achado é fechado por publicar este documento.

## 1. Conclusão principal

O mecanismo de integração deixou de ser apenas uma hipótese: o OpenCode stock carregou o plugin, continuou trabalhando, recebeu uma representação diferente do histórico, preservou os registros do host e retomou um plano após reinício. Esses resultados continuam válidos para as fixtures executadas.

Entretanto, a confiança atribuída à suíte precisa diminuir. Numa cópia descartável, foi introduzida uma alteração deliberadamente incorreta: substituir o conteúdo dos resultados de ferramentas encaminhados ao modelo por um texto constante. **A suíte inteira continuou passando 14/14.** O recorder observou 90 ocorrências de conteúdo alterado em requests primary. São ocorrências em requests, incluindo reenvios do mesmo resultado, não 90 ferramentas diferentes.

Portanto, o resultado anterior não deve ser descrito como prova de integridade completa da cauda. Ele demonstra presença/cardinalidade e alguns marcadores, cobertura de IDs e continuidade da fixture. Não demonstra igualdade de todo o conteúdo que deveria ter permanecido intacto.

Foram registrados **12 pontos de ação: um bloqueador de confiança nas provas, oito de prioridade alta e três de prioridade média**. A gravidade refere-se à evolução deste produto e à qualidade das evidências, não a incidentes em produção ou vulnerabilidades demonstradas em terceiros. Algumas lacunas já estavam declaradas como pendentes; aqui são delimitados os caminhos concretos que precisam ser resolvidos.

**A recomendação não é apagar os PRs anteriores ou recomeçar a arquitetura.** É corrigir os oráculos, impedir perda silenciosa em formatos não suportados, fechar os estados de falha e terminar os contratos de persistência antes de reutilizar a sonda como base de produção.

## 2. Escopo e método

Inventário: 34 arquivos rastreados no commit-base. A revisão cobriu fontes executáveis da sonda, runner, plugin posterior, scripts de validação, workflows, contratos normativos 0.1.1, matriz dos 55 subcasos, dependências dos oito WPs, relatórios de conformance, ADR e resultados dos reviews anteriores. Histórico e migração foram considerados como proveniência e integridade; o RFC histórico não foi promovido de volta a contrato vigente.

Cinco passagens, realizadas pelo mesmo revisor, não cinco revisores independentes:

1. Confrontar proposta de produto, contratos atuais e o que foi efetivamente implementado.
2. Ler codec, projeção, correlação, geração auxiliar, publicação, reset e recuperação como um único fluxo.
3. Atacar os oráculos com uma implementação deliberadamente incorreta e testar fronteiras não exercitadas.
4. Reconciliar identidades, manifestos, feedback, exportação e lifecycle do armazenamento entre os documentos.
5. Conferir evidências, CI, rastreabilidade, pendências e critérios para o próximo incremento.

A revisão não é auditoria integral do binário OpenCode nem de todos os providers. Não houve modelo real, medição de cache, configuração pessoal modificada, inferência paga ou teste de um núcleo de produto já implementado.

## 3. Evidências obtidas

O [sumário estruturado](evidence/REVIEW-003.json) separa observação, inferência estática e teste não executado. As [instruções de reprodução](REVIEW-003-REPRODUCTION.md) fixam a base e delimitam as alterações de teste.

| Evidência | Resultado observado | O que não prova |
|---|---|---|
| Baseline documental | Os três scripts existentes passaram: integridade documental, dez exemplos de referência e dez mutações documentais rejeitadas. | Runtime, qualidade semântica ou conformidade de todas as transações. |
| Baseline do host | A suíte original foi reexecutada no OpenCode oficial 1.18.31/macOS x86_64: 14 pass, 0 fail. | Suporte a entradas diferentes das fixtures. |
| Estado da main no GitHub | Runs `35293248344` e `35293248339` observados com success. | Que o conteúdo dos testes seja um oráculo suficiente. |
| E-C01 | Mutação da cauda sobreviveu: 14 pass, 0 fail; 90 ocorrências alteradas verificadas no recorder. | Não é corrupção do checkout original nem de uma sessão de usuário. |
| E-C02 | Funções reais do codec/projeção aceitaram texto+imagem como raízes não protegidas; a substituição retirou a imagem. | Não foi um ensaio multimodal com LLM ou uma imagem enviada a provider live. |
| E-C03 | Em cenário adicional no host real, system novo chegou ao recorder junto da síntese publicada sob system anterior. | Não prova que qualquer mudança de system torne qualquer resumo falso. |
| E-C04 | Resposta auxiliar com summary vazio gerou ready, sem publicação/falha/cancelamento automático naquele fluxo. | Não significa que uma nova intervenção do usuário jamais consiga cancelar o job. |
| E-C12 | Serialização numérica do helper Python divergiu de JSON.stringify em três valores. | Não foi teste de um importador ou núcleo de produção. |

A comparação pai/clone continua sendo uma comparação de corpos no transporte sintético, não um cache hit medido. A mutação não invalida essa igualdade nos casos testados; demonstra que um request fiel ao pai também pode ser fiel a um pai já incorretamente transformado.

Uma sondagem adicional composta de transporte foi bloqueada pela ferramenta e **não executou**. Uma leitura suplementar em lote de localizações também foi bloqueada e não forneceu dados. Os achados de transporte abaixo permanecem explicitamente estáticos. Nenhum resultado foi atribuído a essas chamadas recusadas.

## 4. Índice

| ID | Prioridade | Natureza | Achado |
|---|---|---|---|
| C01 | Bloqueador de evidência | Mutação executada | Conteúdo da cauda pode ser corrompido com a suíte inteira verde. |
| C02 | Alta | Funções reais, fixture isolada | O codec pode classificar conteúdo multimodal não suportado como removível. |
| C03 | Alta | Host real + inspeção | Invalidação de proposta ready não cobre dependências de sínteses já publicadas. |
| C04 | Alta | Host real + inspeção | Resumo vazio produz um estado ready que não pode publicar nem termina sozinho. |
| C05 | Alta | Código estático | Captures retêm cópias cumulativas de todo o histórico sem descarte. |
| C06 | Alta | Código estático; caso já pendente | Reset que falha depois de HTTP 200 não tem saída completa do estado pending. |
| C07 | Alta | Código estático | Forward do pai não preserva lifecycle/fluxo/headers suficientes para ser transparente. |
| C08 | Média | Código estático | Parsing e limites do auxiliar são inconsistentes entre JSON e SSE. |
| C09 | Alta | Contratos | Idempotência dos recibos usa uma identidade que o schema persistido não representa. |
| C10 | Alta | Contratos | Arquivo portátil contém RootRefs, mas não fecha sua validação/remapeamento. |
| C11 | Média | Contratos | Reservas e pins de storage não têm reconciliação de órfãos especificada. |
| C12 | Média | Execução local | O helper de hash não é um oráculo canônico interoperável para números. |

## 5. Achados detalhados

### C01 — A suíte aceita corrupção da cauda

**Prioridade:** bloqueador para usar o verde como prova de integridade. **Confiança:** alta; mutação executada contra host real.

**Locais:** `tests/conformance/opencode/run.py`, funções `happy` e `repeated_consolidation`; `gateway-plugin.mjs`, montagem de `selected` no request primary.

Os testes verificam três mensagens de tool, contagem de efeitos, presença de resumo, ausência de um marcador antigo e cobertura de IDs. Isso não verifica igualdade do payload da cauda, nem distingue cada resultado por conteúdo. O provider sintético decide a continuação pelos marcadores do usuário e não depende do conteúdo retornado pela ferramenta.

**Experimento:** alterar somente a transformação final, mantendo papéis, IDs, ordem e quantidade. Cada tool result passa a ter `content="CC_REVIEW_CORRUPTED_TAIL"`. Os 14 checks continuam verdes; o recorder confirma que a mudança realmente chegou ao endpoint em 90 ocorrências.

**Impacto:** uma regressão central pode passar pelo mesmo CI usado para integrar o código. A evidência anterior não é fictícia, mas sua interpretação estava mais ampla que o oráculo. Igualdade pai/clone, sozinha, não certifica que o pai recebeu a cauda correta.

**Correção mínima:** produzir valores de ferramenta distintos e identificáveis; congelar uma sequência esperada por raízes/grupos fora da cobertura; comparar papel, payload, tool_call_id, ordem e metadados preservados. O recorder deve validar o protocolo além de responder. Incorporar mutações direcionadas que removam, dupliquem, troquem e alterem uma unidade protegida/da cauda.

**Aceite:** a mutação reproduzida deve reprovar o teste por alteração de conteúdo, não por timeout acidental; a implementação correta permanece verde. Testar também conteúdo repetido com IDs diferentes, para que nem igualdade textual nem mera contagem substituam a identidade.

**Afeta:** WP-00/WP-04/WP-06; T08.projection/T08.host/T09.projection/T27.projection; linguagem dos relatórios de conformance.

### C02 — Conteúdo fora do codec não é sempre protegido ou recusado

**Prioridade:** alta. **Confiança:** alta no codec isolado; não extrapolar para uma homologação multimodal.

**Locais:** `gateway-plugin.mjs`, `text`, `rootsFor` e `project`.

A função `text` ignora itens não textuais do conteúdo wire. A leitura das partes nativas considera texto/compaction e ferramentas, mas não exige que todas as outras partes tenham representação suportada. A proteção da raiz é marcada apenas pela parte `compaction`.

**Experimento:** fornecer mensagem nativa user com texto e arquivo image/png, correspondente a um wire user com texto e image_url, seguida de uma resposta textual. `rootsFor` aceita os dois registros e retorna `protected=false` em ambos. Um replacement válido segundo a sonda remove a imagem junto do texto.

**Impacto:** o comportamento contradiz a fronteira anunciada de recusar/proteger conteúdo desconhecido. O fato de mídia estar fora do perfil não permite ignorá-la e tratar o resto como uma mensagem textual compactável. Isso é diferente de implementar suporte multimodal: basta falhar de maneira explícita ou preservar integralmente o grupo.

**Correção mínima:** validar exaustivamente os tipos de todas as partes nativas e wire, incluindo conteúdo misto. Parte desconhecida protege o grupo ou torna o perfil inelegível antes da poda. Não fazer reconhecimento por um extrator de texto que perde a informação necessária à decisão.

**Aceite:** fixtures text+image, text+parte futura, mídia em resultado e parte opaca não podem resultar em remoção silenciosa. O request deve permanecer inteiro ou ser recusado com razão específica. Inserir esta fronteira na suíte do codec mesmo antes de homologar mídia.

**Afeta:** WP-00/WP-01/WP-04/WP-06; T09.projection/T30.contract/T33.host/T37.contract.

### C03 — Alterar a configuração depois da publicação não revalida a síntese ativa

**Prioridade:** alta na transição de sonda para produto. **Confiança:** alta sobre o comportamento observado; nenhuma alegação de falsidade semântica foi medida.

**Locais:** `gateway-plugin.mjs`, comparação `job.config!==config`, estrutura de replacement, checkpoint e `project`; SPEC-01 read_dependencies; SPEC-07 invalidação.

O teste de mudança de system cobre uma proposta que ainda está ready. Depois da publicação, o replacement guarda IDs, sourceHash e summary, mas não a configuração/dependências que influenciaram sua produção. `project` verifica as raízes cobertas; não verifica as demais informações lidas pelo clone.

**Experimento:** publicar a síntese com a configuração de fixture `CC_POLICY=0`, depois mudar o plugin posterior para `CC_POLICY=1` e continuar. O recorder recebe system novo e a síntese antiga. A invalidação aplicada à proposta pendente não foi aplicada ao derivado já ativo.

**Impacto:** a sonda não demonstra o comportamento de continuidade após mudança de regras/estado que sustentou um resumo. Não é necessário invalidar tudo por qualquer header irrelevante; é necessário diferenciar mudanças materiais, dependências históricas e configuração não semântica. O documento de produto já exige essa distinção, mas o protótipo não a prova.

**Correção mínima:** ligar replacements publicados a dependências/revisões relevantes ou fazer uma rejeição conservadora explícita no perfil de prova. Acrescentar um cenário onde uma regra efetivamente resumida é corrigida/revogada depois da publicação e depois de uma consolidação. Não promover o atual teste de ready a prova de derivados publicados.

**Aceite:** uma correção material chega à próxima entrada sem a versão antiga ser apresentada como regra vigente, inclusive após restart. Uma alteração declaradamente não semântica não deve causar reconstrução desnecessária. Registrar o que é invalidado, o que continua histórico e como proceder se a expansão não couber.

**Afeta:** WP-04/WP-05/WP-06; T11.dependencies/T22.blocks/T39.host.

### C04 — Summary vazio fica num limbo de execução

**Prioridade:** alta. **Confiança:** alta; cenário adicional no host real.

**Locais:** `gateway-plugin.mjs`, validação de `proposal.summary`, atribuição de `job.ready`, condição de publicação e admissão de job posterior.

A resposta só exige que summary seja string e não exceda 4000 caracteres. String vazia é aceita. A publicação exige `s.job?.ready` truthy, e a admissão seguinte exige job ausente ou terminal/localStopped. O timeout é removido ao finalizar a chamada HTTP.

**Experimento:** o provider sintético retorna `{"summary":""}`. Observados: um aux-ready, nenhuma publicação, nenhum aux-failed, nenhum cancelamento e uma chamada auxiliar. O código deixa o job não terminal com ready vazio. Uma nova entrada do usuário pode cancelá-lo; isso não substitui um resultado terminal automático para a execução de manutenção.

**Impacto:** numa esteira autônoma sem nova intervenção, a manutenção pode permanecer silenciosamente sem publicar ou admitir outra oportunidade. Schema reduzido de uma sonda não justifica um estado impossível de finalizar.

**Correção mínima:** validar presença de conteúdo útil; representar estado ready por discriminante, não pela truthiness da string. Noop, formato inválido e ausência de ganho precisam de estados terminais explícitos e liberação do slot. Não transformar erro de conteúdo em sucesso operacional.

**Aceite:** vazio, whitespace, campo ausente e resposta válida têm desfechos distintos e limitados. Após erro/noop, uma oportunidade futura elegível pode iniciar sem depender de um comando humano ou reinício. Manter a contagem física de tentativas.

**Afeta:** WP-00/WP-03/WP-06; T17.scheduler/T37.executor/T40.executor.

### C05 — O arquivo cresce fora da janela, mas as capturas também crescem dentro da RAM

**Prioridade:** alta para sessões longas. **Confiança:** alta por retenção diretamente visível; não foi executado teste de carga ou medido um pico de memória.

**Locais:** `gateway-plugin.mjs`, Maps `captures` e `pending`, `structuredClone(output.messages)` e `chat.headers`.

Cada transformação cria uma cópia do histórico entregue pelo host. Cada token de correlação novo mantém a Capture correspondente no Map `captures`. Não existe remoção ao terminar o request, limite, TTL ou descarte por sessão. O checkpoint e `seen` também crescem, mas a cópia cumulativa de mensagens é o problema dominante desta observação.

**Consequência lógica:** se cada turno acrescenta aproximadamente a mesma quantidade de dados e cada captura guarda o histórico acumulado, a soma dos conteúdos retidos segue 1+2+...+n. Compactar o request enviado não reduz automaticamente essas cópias, porque o transcript bruto do host permanece e o Map mantém capturas antigas vivas.

**Impacto:** o design busca sessões longas com janela controlada, mas a sonda pode aumentar memória local quadraticamente no caso de crescimento linear do histórico. É um problema de lifecycle do adaptador, não algo que um modelo maior resolva.

**Correção mínima:** definir retenção limitada de captures por request/attempt e TTL de retry, descartando payloads após o período em que forem necessários. Manter somente snapshots de jobs ativos e referências duráveis ao ledger; separar identidade de correlação de uma cópia integral de conteúdo. Cancelamento/dispose/reset também liberam referências.

**Aceite:** ensaio longo com milhares de turnos sintéticos, requests concluídos e retries permitidos deve mostrar número limitado de captures retidas e memória estabilizando de acordo com snapshots ativos, não com a soma de toda a história. Medir bytes/handles, não somente tokens enviados.

**Afeta:** WP-00/WP-03/WP-06; lifecycle e critérios de desempenho ainda não contemplados pelos 14 checks.

### C06 — Falha nativa depois de HTTP 200 não fecha o reset pending

**Prioridade:** alta antes de homologar recuperação nativa. **Confiança:** alta sobre o caminho estático; o ensaio adicional pretendido não executou.

**Locais:** `gateway-plugin.mjs`, hook `experimental.session.compacting`, condição `capture.kind==="compaction"&&!result.ok`, evento `session.compacted` e teste `s.resetPending`.

O início persiste resetPending=true. HTTP não exitoso limpa esse estado. O evento de compactação concluída também o limpa. Não existe tratamento correspondente para uma resposta HTTP 200 cujo stream termine truncado, devolva erro ou seja cancelado antes de o host confirmar a compactação.

**Cenário estático:** o início é persistido, chegam headers 200, o corpo falha e não ocorre session.compacted. resetPending permanece. Uma chamada classificada como primary encontra E_NATIVE_PENDING. O host pode tentar novamente a compactação em alguns fluxos, mas essa possibilidade não é um protocolo completo e limitado de reconciliação, especialmente após restart ou cancelamento.

O relatório de continuidade anterior já diz que queda durante streaming não foi demonstrada. Este achado não transforma aquela pendência em um teste executado: identifica exatamente onde falta uma transição.

**Correção mínima:** correlacionar cada tentativa de reset com início, término bem-sucedido, erro de stream/host, cancelamento e restart. Não avançar epoch no simples 200 nem conservar uma trava sem procedimento de recuperação. Inspecionar a nova base pública antes de liberar ou invalidar o plano.

**Aceite:** casos 200+erro, truncamento, cancelamento e queda após headers produzem estado recuperável e não reaplicam uma view sobre base incorreta. O teste deve observar o próximo request útil ou um bloqueio explícito com saída definida, não apenas a ausência de publicação.

**Afeta:** WP-00/WP-04/WP-06; P08/P09; T10.host/T12.host.

### C07 — O forward do pai ainda não tem contrato de transporte suficiente

**Prioridade:** alta para o perfil HTTP local. **Confiança:** estática; não foram executados ensaios adicionais de backpressure/cancelamento nesta revisão.

**Locais:** `gateway-plugin.mjs`, fetch de primary, cópia de headers da resposta, loop `res.write`, dispose; SPEC-04, transparência e saída.

A chamada upstream do pai não recebe AbortSignal associado ao cliente nem aparece num registro de handles canceláveis. O código verifica res.destroyed apenas depois de receber um chunk: um stream que não entrega outro chunk pode continuar aguardado. O retorno de res.write não é usado para controlar o ritmo de leitura. A resposta ao host copia somente content-type, perdendo, por exemplo, Retry-After e identificadores de request relevantes à observação.

Esses três pontos pertencem à mesma fronteira de transporte. Um teste apenas com respostas rápidas/curtas em loopback não demonstra que o intermediário respeita cancelamento, pressão de escrita e semântica de retry do host. server.requestTimeout não substitui o controle da requisição outbound ou da duração da resposta.

A documentação Node explica que write pode sinalizar buffering e que drain permite retomar após a pressão de escrita. A implementação executada no host usa o runtime daquele binário; a referência Node sustenta o contrato da API utilizada, não uma medição de consumo no Bun embutido.

**Correção mínima:** registrar/cancelar outbound requests do pai conforme o lifecycle autorizado, propagar uma allowlist de headers de resposta semanticamente necessários e usar streaming com backpressure. Desligamento deve esperar ou encerrar os handles pertencentes ao produto. O contrato deve distinguir cancelamento do pai, do auxiliar e mera queda de conexão.

**Aceite:** cliente lento, cliente desconectado antes do próximo chunk, provider que pausa a resposta, 429 com Retry-After e dispose com requests ativos. Verificar contadores de conexões e dados enviados; não usar sleeps longos como única evidência. Não introduzir retry transparente no gateway.

**Afeta:** WP-00/WP-03/WP-06; P09/P10/P11; T24.host/T28.host/T40.host.

### C08 — JSON e SSE têm regras diferentes de tamanho e validade

**Prioridade:** média na sonda; deve ser resolvido antes do executor de produto. **Confiança:** estática.

**Local:** `gateway-plugin.mjs`, função `completion`.

O caminho SSE impõe contador de bytes, mas o caminho JSON usa response.json sem o mesmo limite. O TextDecoder do SSE não é configurado para rejeitar UTF-8 inválido. Objetos de evento sem choices são ignorados, incluindo possíveis objetos de erro. A terminação precisa de um contrato explícito: finish_reason, término do stream e sentinela não podem ser inferidos como equivalentes sem definir o protocolo aceito.

Não foi executada a sondagem adicional que buscaria exercitar esses casos. A observação acima vem da diferença entre os dois ramos do código, não de uma resposta live malformada.

**Correção mínima:** um único orçamento de bytes/texto para os dois caminhos, decodificação estrita e parser com estados definidos para conteúdo, erro, término e contagem de choices. Rejeitar shape desconhecido do resultado auxiliar; não reinterpretar entrada inválida como sucesso parcial.

**Aceite:** fixtures JSON/SSE nos mesmos limites; erro SSE sem choices; UTF-8 inválido; evento fragmentado; ausência do término exigido pelo perfil. Qualquer segunda tentativa continua consumindo o mesmo limite físico do job.

**Afeta:** WP-03/WP-06; T37.executor/T40.executor e codec do perfil.

### C09 — Idempotência do recibo ainda não sobrevive por um contrato fechado de storage

**Prioridade:** alta no fechamento da especificação. **Confiança:** alta; não há storage implementado para testar.

**Locais:** SPEC-05 §5 define Receipt com tool_call_id idempotente por sessão. SPEC-03, tabela retrievals, não contém tool_call_id nem outra relação persistida equivalente; sua PK é retrieval_id. SPEC-01 descreve IDs gerados pelo núcleo, mas não fixa derivação determinística dessa PK a partir da chamada do host.

**Cenário:** a mesma chamada de leitura é entregue novamente após reload/retry. WorkContext, range e digest não distinguem replay da mesma chamada de duas leituras reais iguais. Usar um novo retrieval_id em cada entrega produz recibos duplicados; deduplicar por conteúdo confunde leituras legítimas. Uma implementação poderia derivar o UUID da identidade da call, mas essa regra ainda precisaria ser especificada e persistível.

**Impacto:** o mecanismo de repetição/retention pode contar três entregas da mesma leitura como três usos e promover indevidamente uma nota. A correção B10 acrescentou WorkContext, mas não fechou este vínculo de identidade no DDL/contrato.

**Correção mínima:** persistir a identidade pública da execução de tool com uma chave única por Scope/incarnation, ou especificar uma derivação determinística equivalente e os dados usados para validar conflito. Mesmo call ID com argumentos/alvo diferentes deve ser conflito, não reutilização silenciosa.

**Aceite:** repetir a mesma call antes/depois de restart gera um recibo; três calls distintas com conteúdo igual geram três. O algoritmo de promoção recebe exatamente esse resultado. Atualizar DDL, tipos, arquivo exportável quando aplicável e T26.feedback/T03.storage.

**Afeta:** WP-01/WP-02/WP-05. Não adicionar um segundo agente para resolver deduplicação.

### C10 — RootRefs no arquivo portátil não têm domínio completo de resolução

**Prioridade:** alta para prometer portabilidade de dados. **Confiança:** alta sobre a lacuna; não foi executado importador de produto.

**Locais:** SPEC-01 RootRef/Chapter; SPEC-07 §§4–5 ArchiveRecords, ArchiveChapter e remapeamento; SPEC-03 root_units.

ArchiveChapter herda root_coverage com unit_id/revision/unit_digest e logical_coverage. ArchiveRecords exporta sources, manifests, chapters, blocks, operations e dependencies, mas não um catálogo das raízes ou o mapa de identidade correspondente. A importação exige validar/remapear todas as referências, porém não determina se essas referências a unidades são resolvíveis no arquivo, identidades históricas opacas ou IDs que precisam ser recriados.

**Cenário:** capítulo consolidado referencia raízes B,C,D. O arquivo contém os textos de fonte e suas native_refs, mas não necessariamente o agrupamento/payload efetivo que gerou cada unit_digest. Não se pode validar o RootRef ou remapeá-lo como entidade materializável apenas adivinhando a partir da fonte. Tampouco se pode prometer restore entre hosts: o arquivo é corretamente definido como somente leitura, mas a semântica dessas referências históricas ainda precisa ser explícita.

**Correção mínima:** escolher um modelo pequeno: exportar um manifesto de raízes suficiente para validar a cobertura histórica, ou declarar RootRefs como proveniência opaca com origem preservada, validando apenas as relações internas que realmente podem ser resolvidas. Não exigir materialização de host para consultar arquivo. Definir o tratamento de logical_coverage e quais hashes são de origem versus recalculados.

**Aceite:** round-trip com duas consolidações e fontes originais/âncoras/capítulos mistos; nenhuma referência fica implicitamente resolvida por texto ou pelo banco do host antigo. Arquivo malformado é recusado; arquivo válido permanece consultável sem ativar blocos nem criar sessão de execução.

**Afeta:** WP-01/WP-02/WP-05; T32.archive/T38.archive. O modelo de referência que renomeia IDs em uma lista não prova este fechamento.

### C11 — Crash libera o lock, mas não resolve automaticamente reservas e pins persistidos

**Prioridade:** média; importante antes de implementar GC/quotas. **Confiança:** normativa, não race reproduzida.

**Locais:** SPEC-03 storage_reservations, protocolo de staging/read_pin/export_pin, GC e recuperação.

O lock de SO evita a corrida reuso/unlink apontada no review anterior. Entretanto, as reservas/pins são duráveis e contêm owner_id; não foi fechado como o startup identifica e reconcilia reservas de um processo encerrado, separando reader/exportador vivo, staging incompleto e operação já concluída. A recuperação especificada trata jobs/aux_runs, não todas as reservas de storage.

**Cenário:** um exportador morre depois de registrar pins. O SO libera o lock, mas o banco ainda registra pins. Se forem preservados indefinidamente, arquivos ficam inelegíveis para GC e quotas podem ficar reservadas. Se forem removidos só por idade, uma operação viva e lenta pode perder sua proteção.

**Correção mínima:** vincular reservas a uma identidade verificável de processo/incarnation/operação e definir reconciliação sob o lock do workspace. Diferenciar crash, progresso confirmado e operação viva sem usar TTL como única prova. Documentar quando staging/reserva é liberado e como bytes órfãos continuam sendo contabilizados.

**Aceite:** matar exportador/reader/stager em cada borda de reserva; reiniciar; provar ausência de pin órfão permanente e ausência de remoção de um arquivo ainda usado por operação viva. Não é necessário serviço distribuído.

**Afeta:** WP-02; T12.storage/T19.storage/T32.archive.

### C12 — Hash de referência não é canônico entre linguagens para números

**Prioridade:** média. **Confiança:** alta; divergência executada.

**Locais:** SPEC-01 canonicalJSON; `scripts/check-reference-model.py`, canon/digest; JSON.stringify usado na sonda JavaScript.

A ordenação UTF-16 das chaves foi tratada, mas a serialização dos números não ficou fechada por vetores compatíveis. O helper Python usa json.dumps; a sonda usa JSON.stringify. Foram observados os pares:

| Valor numérico | Python | JavaScript |
|---|---|---|
| 1.0 | `{"n":1.0}` | `{"n":1}` |
| zero negativo | `{"n":-0.0}` | `{"n":0}` |
| 0.0000001 | `{"n":1e-07}` | `{"n":1e-7}` |

Bytes diferentes geram hashes diferentes, embora as entradas sejam números JSON equivalentes para esses usos. O teste atual de hash cobre principalmente mudanças de strings/metadata e round-trip na mesma linguagem. Isso não invalida esses exemplos, mas impede tratá-los como um oráculo de canonicalização interoperável.

**Correção mínima:** especificar a representação numérica, rejeições e precisão. Uma opção é adotar uma canonicalização definida como JCS/RFC 8785 e seus vetores; outra é definir formalmente o subconjunto do produto. Fazer ambas as implementações gerar os mesmos bytes antes de comparar hashes. Não normalizar o texto original de fontes por causa disso.

**Aceite:** vetores cruzados para inteiros seguros, frações, expoentes, zero negativo, Unicode e valores recusados; arquivo exportado/importado continua com hashes consistentes no domínio declarado. O helper continua identificado como modelo de contrato, não runtime.

**Afeta:** WP-01/WP-02; T07.contract/T37.contract/T32.archive.

## 6. Reavaliação do trabalho anterior

### O que permanece demonstrado

A integração usa um binário oficial verificado e interfaces públicas. As execuções baseline reproduziram os 14 checks. A fonte antiga continuou no histórico público. O plano achatado foi reconstruído após restart nos cenários testados. O auxiliar usa cliente separado, sem despacho de tools pelo runner do host; houve recusa de tool_call e contagem física limitada nos casos 429/503/reparo. Os CIs consultados estavam verdes.

### O que precisa de linguagem mais estreita

- “Cauda preservada” deve indicar o oráculo efetivamente exercitado. Até corrigir C01, não equivale a igualdade byte/estrutura completa dos resultados.
- “Configuração nova invalida o resumo” é amplo demais: a sonda prova rejeição de ready, não invalidação transitiva de todos os resumos publicados.
- “Unknown é recusado” não está assegurado para partes mistas; C02 mostrou uma exceção.
- “Consolidações suportadas” vale para quatro rodadas do host e exemplos abstratos de 2/10/64, não para uma sessão live longa com gatilho de 50%.
- O checkpoint JSON é uma fixture. Não substituir o WP-02 por esse arquivo nem afirmar durabilidade contra falta de energia a partir de SIGKILL.

Essas qualificações não apagam as evidências históricas. O caminho correto é acrescentar o corrigendum e a nova prova, conservando commit e hashes dos ensaios anteriores.

### O que não é um novo defeito

Não existir ainda um núcleo de produto, tarball final, MCP homologado, handoff acima do orçamento, segundo harness ou benchmark live já era explicitamente declarado. São pendências, não bugs escondidos descobertos neste review. Cache miss, sumarização potencialmente imperfeita e ausência de memória infinita também não são defeitos por si sós.

A escolha do perfil HTTP local continua sendo opt-in documentado; não há evidência aqui para declarar suporte a assinaturas, todos os modelos ou todos os harnesses. O produto não foi lançado. Nenhum dos 55 subcasos deve herdar PASS dos 14 checks da sonda.

## 7. Produto, engenharia e manutenção

Há valor em ter demonstrado a fronteira de integração antes de construir o núcleo. Porém, prolongar indefinidamente a sonda também cria custo: ela já contém protocolo, projeção, geração, checkpoints e testes próprios, mas não é o código de produto. A migração para o núcleo deve reutilizar os oráculos, não duplicar silenciosamente duas implementações e deixar divergências entre elas.

Depois das correções de prova, o próximo ciclo deve ser vertical e pequeno: contratos reais do núcleo, um ledger mínimo, uma publicação e recuperação com âncora, mantendo o host sintético como teste independente. Não adicionar cinco providers para compensar o fato de o primeiro fluxo ainda não estar fechado.

Observações de prontidão, fora dos 12 achados: a árvore pública ainda não contém uma licença explícita; resolver a escolha antes de distribuir o pacote. As regras/README têm frases de fase anterior, como ausência de comando de runtime, junto de instruções posteriores das sondas; alinhar o estado editorial sem reescrever o histórico. A main consultada não estava protegida; adotar gates obrigatórios quando a administração do repositório estiver disponível é recomendável, mas não houve alteração de configuração nesta revisão.

Não classifico essas observações editoriais/de distribuição como incidentes nem como motivo para bloquear um experimento local autorizado. Também não proponho um framework de governança adicional.

## 8. Plano de correção e critérios de encerramento

**Primeiro, corrigir a evidência:** C01 e C02. A suíte deve detectar corrupção e tratar conteúdo fora do perfil de forma explícita. Preservar a mutação como regressão controlada; não editar o resultado esperado para aceitar a saída incorreta.

**Depois, fechar lifecycle da sonda/adaptador:** C03–C08. Tratar derivado publicado, proposta vazia, retenção de captures, falhas nativas de stream e transporte do pai. Publicar matriz distinguindo testes do host, testes isolados de componente e observações estáticas.

**Em paralelo, reparar os contratos necessários ao núcleo:** C09–C12, com tipos/DDL/arquivo/vetores e subcasos rastreáveis. Não marcar SQL de referência como prova de implementação de storage.

### Success Criteria

A implementação incorreta de E-C01 passa a ser detectada; entradas fora do codec não desaparecem; cada estado pendente tem término/recuperação limitado; as decisões normativas de identidade, arquivo e storage têm uma única interpretação implementável.

### Quality Standards

Mesmos inputs, binário e fontes identificados; recorder independente; conteúdo de ferramenta distinguível; sem live keys; nenhuma edição de transcript/DB do host; correções executadas com regressões que falham sem o fix.

### Completeness Criteria

C01–C12 têm resolução, PR e evidência ou decisão explícita que retire o comportamento do escopo. Evidência estática não fecha automaticamente um caso de runtime. Pendência já conhecida continua rastreada em WP-00; não duplicar PASS entre sonda e core.

### Definition of Done

Revisor confronta a base corrigida com este relatório. Os testes de mutação, codec, estados, persistência e vetores pertinentes foram executados e os logs/manifestos conferidos. Relatórios anteriores recebem referência ao corrigendum, não alterações retroativas nos dados. O gate completo continua bloqueado enquanto qualquer capacidade obrigatória faltar, mesmo com um CI verde.

### Invariants

Originais não são adulterados; cauda/partes protegidas não são perdidas; scope não muda; clones não executam tools; estados terminais não ressuscitam; biblioteca não depende de tipos privados do host; nenhum orçamento, homologação ou melhoria de qualidade é inventado.

## 9. Referências e leitura das provas

Fontes abaixo são fixadas no commit auditado; os links relativos acima apontam para a árvore em que este relatório for consultado. As conclusões normativas são do review; as fontes sustentam a implementação/contrato observado.

- [S1 — Gateway/codec/auxiliar](https://github.com/gmhelmold/context-continuity/blob/8f844ed5798146c9626653627d67916df0737583/tests/conformance/opencode/gateway-plugin.mjs)
- [S2 — Runner e oráculos](https://github.com/gmhelmold/context-continuity/blob/8f844ed5798146c9626653627d67916df0737583/tests/conformance/opencode/run.py)
- [S3 — Contratos e identidades](https://github.com/gmhelmold/context-continuity/blob/8f844ed5798146c9626653627d67916df0737583/specs/v0.1/01-contracts.md)
- [S4 — Lifecycle](https://github.com/gmhelmold/context-continuity/blob/8f844ed5798146c9626653627d67916df0737583/specs/v0.1/02-lifecycle.md)
- [S5 — DDL e storage](https://github.com/gmhelmold/context-continuity/blob/8f844ed5798146c9626653627d67916df0737583/specs/v0.1/03-ledger.md)
- [S6 — Tools e feedback](https://github.com/gmhelmold/context-continuity/blob/8f844ed5798146c9626653627d67916df0737583/specs/v0.1/05-tools-ux.md)
- [S7 — Projeção e arquivo](https://github.com/gmhelmold/context-continuity/blob/8f844ed5798146c9626653627d67916df0737583/specs/v0.1/07-state-operations.md)
- [S8 — Modelo de referência](https://github.com/gmhelmold/context-continuity/blob/8f844ed5798146c9626653627d67916df0737583/scripts/check-reference-model.py)
- [S9 — Limites da prova de continuidade](https://github.com/gmhelmold/context-continuity/blob/8f844ed5798146c9626653627d67916df0737583/docs/conformance/OPENCODE-WP00-CONTINUITY.md)
- [S10 — Registro canônico](https://github.com/gmhelmold/context-continuity/blob/8f844ed5798146c9626653627d67916df0737583/specs/v0.1/traceability.json)
- [S11 — Node HTTP](https://nodejs.org/api/http.html): contratos de write/drain, requestTimeout e conexões. Não é teste do runtime embutido do OpenCode.
- [S12 — RFC 8785/JCS](https://www.rfc-editor.org/rfc/rfc8785): exemplo de especificação completa de canonicalização; sua adoção é recomendação, não mudança aplicada neste review.

**Estado ao publicar:** 12 achados abertos; nenhum runtime corrigido por esta entrega; nenhuma release/compatibilidade habilitada. Este relatório documenta limites do trabalho existente para orientar o próximo incremento, não invalida indiscriminadamente todo o projeto.
