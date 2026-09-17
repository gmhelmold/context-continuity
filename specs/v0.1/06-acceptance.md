# SPEC-06 — requisitos e aceitação

Normativo para [SPEC-CC-0.1](README.md). **Todos os testes de runtime abaixo estão especificados, não executados.** Validação de Markdown, schemas exemplificativos ou DDL não equivale a passar estes testes.

## 1. Matriz de rastreabilidade

Cada requisito possui dono principal, contrato e oráculo. Um work package não está concluído porque o arquivo do teste existe; precisa apresentar sua execução e evidência.

| ID | Obrigação atômica | Contrato | Dono | Teste |
|---|---|---|---|---|
| R01 | Instalar via interface pública, sem alteração do host. | SPEC-04 | WP-00 | T01 |
| R02 | Resolver escopo sem misturar sessões. | SPEC-01 | WP-01 | T02 |
| R03 | Admitir um proprietário/job por sessão, com fencing. | SPEC-02/03 | WP-02 | T03 |
| R04 | Manutenção não dispara manutenção recursiva. | SPEC-02 | WP-03 | T04 |
| R05 | Clone não executa tools locais ou remotas. | SPEC-01/04 | WP-00 | T05 |
| R06 | Distinguir snapshot ativo, fidelidade do fork e cache. | SPEC-01/04 | WP-03 | T06 |
| R07 | Identificar fontes por ID/revisão, não por texto ou ordem inferida. | SPEC-01 | WP-01 | T07 |
| R08 | Preservar toda a cauda posterior ao snapshot, uma vez. | SPEC-02 | WP-04 | T08 |
| R09 | Substituir somente intervalo contíguo de grupos fechados. | SPEC-01/02 | WP-04 | T09 |
| R10 | Compactação nativa invalida proposta da epoch anterior. | SPEC-02/04 | WP-04 | T10 |
| R11 | Revert/mutação de fonte não reaplica síntese stale. | SPEC-02 | WP-04 | T11 |
| R12 | Crash não publica metade da operação ou repete inferência órfã. | SPEC-03 | WP-02 | T12 |
| R13 | Retry/publicação repetida é idempotente. | SPEC-02/03 | WP-04 | T13 |
| R14 | Gatilho usa entrada inteira, inclusive cacheada. | SPEC-02 | WP-03 | T14 |
| R15 | Reservar saída, missão e crescimento antes do fork. | SPEC-02 | WP-03 | T15 |
| R16 | Rearmamento impede loops no mesmo contexto. | SPEC-02 | WP-03 | T16 |
| R17 | Noop/ganho insuficiente mantém visão e não cria capítulo. | SPEC-01/02 | WP-03 | T17 |
| R18 | Overflow durante manutenção não provoca descarte ou request inválido. | SPEC-02/04 | WP-06 | T18 |
| R19 | Fonte durável precede publicação que a remove da janela. | SPEC-03 | WP-02 | T19 |
| R20 | Fonte ausente/proibida não é reconstruída por palpite. | SPEC-03/05 | WP-05 | T20 |
| R21 | Âncoras ativas sobrevivem literalmente fora da sumarização. | SPEC-01/05 | WP-05 | T21 |
| R22 | Revogação/versionamento de regra invalida manutenção obsoleta. | SPEC-02/05 | WP-05 | T22 |
| R23 | Bloco curado respeita origem, escopo e orçamento. | SPEC-05 | WP-05 | T23 |
| R24 | Pausa/desinstalação têm saída segura e explícita. | SPEC-04/05 | WP-06 | T24 |
| R25 | Estado remoto não mantém conteúdo removido em segredo. | SPEC-01/04 | WP-00 | T25 |
| R26 | Feedback é limitado e não transforma toda busca em âncora. | SPEC-05 | WP-05 | T26 |
| R27 | Consolidação preserva lineage sem carregar capítulos indefinidamente. | SPEC-01/02 | WP-04 | T27 |
| R28 | Publicação não é confundida com emissão ou consumo pelo modelo. | SPEC-01/02 | WP-04 | T28 |
| R29 | Outro plugin não invalida silenciosamente a garantia de entrada. | SPEC-04 | WP-00 | T29 |
| R30 | Núcleo é independente de tipos/banco privados dos hosts. | SPEC-01/04 | WP-01 | T30 |
| R31 | Consulta não cruza projetos nem aceita paths como autorização. | SPEC-01/05 | WP-05 | T31 |
| R32 | Exclusão/exportação/importação preservam autorização e integridade. | SPEC-03 | WP-02 | T32 |
| R33 | Compatibilidade é por versão/rota/capacidades verificadas. | SPEC-01/04 | WP-00 | T33 |
| R34 | Avaliar continuidade contra baseline real, com ablação. | SPEC-CC-0.1 | WP-07 | T34 |
| R35 | Medir custo/cache completos; desconhecido não vira zero. | SPEC-01/02 | WP-07 | T35 |
| R36 | Ativação, diagnóstico e UX não fazem inferência paga oculta. | SPEC-02/05 | WP-06 | T36 |

T37–T40 aprofundam contratos transversais; não criam requisitos sem dono.

## 2. Fixtures de referência

Usar somente dados sintéticos. Tokens das fixtures de fórmula são números fornecidos pelo adaptador de teste, não contagens reais de frases curtas. Relatórios live devem usar contagens do provider/estimador identificado.

**F-PUBLISH:** unidades em ordem U001..U012; U001/U002 protegidas; intervalo elegível U003..U008; cauda U009..U012. Enquanto o clone trabalha, chegam U013..U016. Resultado esperado: `[U001,U002,SUMMARY,U009,U010,U011,U012,U013,U014,U015,U016]`. SUMMARY cobre somente U003..U008 e cita as fontes originais. Os nomes Uxxx são rótulos legíveis de fixture, mapeados a IDs válidos no teste de runtime.

**F-CONTINUITY:** regra literal `manter compatibilidade com protocolo v1`; decisão A substituída por B com motivo; implementação local validada na revisão X; integração na revisão Y ainda pendente. Próxima etapa exige uma exceção de cancelamento arquivada. Testar tanto recuperação normal quanto omissão corretiva. O oráculo humano/determinístico conhece essas distinções antes da execução; a resposta do próprio agente não define o gabarito.

**F-BUDGET:** C=1000000, I=900000, R=16000, H=650000, demais defaults de SPEC-02. B=650000, G=65000, T=500000, L=400000, N=50000; em U=500000, ganho mínimo M=10000. U=499999 não cruza T; U=500000 cruza. Cache read=450000 não diminui U.

## 3. Casos de aceitação

### T01 — Instalação pública

Dado OpenCode stock na versão fixada e workspace descartável, instalar o tarball/local plugin pelo mecanismo documentado. Esperado: carregamento e remoção sem editar binário, lockfile do host, transcript ou banco interno. Evidência: hashes do host antes/depois, configuração sanitizada e trace de carregamento. Falha em uma interface não autoriza trocar por fork sem atualizar o perfil.

### T02 — Escopo concorrente

Abrir duas sessões com IDs externos iguais em dois adaptadores/workspaces e intercalar eventos. Esperado: session_keys distintos, fontes e jobs isolados; frame com mensagens de duas sessões gera E_SCOPE e zero chamadas auxiliares. Evidência: estados e envelopes sanitizados, sem dados cruzados.

### T03 — Proprietário e job único

Duas instâncias tentam criar job simultaneamente; depois expira o lease e um novo owner assume. Esperado: índice admite um job; somente proprietário atual publica; callback com fence antigo é rejeitado. Evidência: transações/contagens no SQLite real. Mutação que remove o fence deve fazer o teste falhar.

### T04 — Não recursão

Gerar eventos de primary, maintenance e native_compaction. Esperado: somente primary elegível dispara manutenção; eventos auxiliares não criam novos jobs. Dez eventos de fechamento simultâneos produzem no máximo uma oportunidade elegível. Evidência: contagem de chamadas e estados.

### T05 — Isolamento do clone

Provider de teste devolve chamadas de tool padrão, customizada e MCP ao clone. Ferramentas de teste incrementariam um contador local inofensivo se executadas. Esperado: contador zero, E_TOOL, nenhuma publicação; tool remota executada no provider torna o perfil inelegível antes da chamada. Evidência: trace de guard/dispatch. Não testar efeitos destrutivos reais.

### T06 — Snapshot e fidelidade

Pai já usa capítulos ativos. Capturar fork e comparar requests no recorder. Esperado: não reintroduzir transcript arquivado; conteúdo e configurações relevantes idênticos até a missão, ou relatório explícito de divergência/unknown. Permissões que removem schemas devem ser detectadas como mudança, não cache-safe. Cache hit continua sem comprovação no stub.

### T07 — Identidade e conteúdo repetido

Duas mensagens têm texto idêntico, IDs diferentes; uma terceira mantém ID mas muda revisão. Esperado: fontes não se fundem por texto; revisão nova invalida cobertura antiga; ordem do array prevalece sobre timestamp/ID. Evidência: digests, cobertura e E_STALE no caso alterado.

### T08 — Cauda preservada

Executar F-PUBLISH com chegada de U013..U016 antes da proposta. Esperado: sequência exata definida na fixture, cada unidade não coberta uma única vez; histórico original intacto. Evidência: igualdade de arrays e payloads nativos antes/depois. Remover cópia da cauda deve fazer o teste falhar.

### T09 — Fronteiras de protocolo

Introduzir tool call com resultado na borda, calls paralelas, mensagem ainda em streaming e parte opaca desconhecida. Esperado: proteção/expansão por grupo ou rejeição; nunca request com par incompleto. Intervalo não contíguo sugerido pelo modelo não é aceito. Evidência: validator e payloads, não apenas HTTP 200.

### T10 — Compactação nativa concorrente

Deixar proposta ready, iniciar/concluir compactação nativa e tentar publicar a antiga. Esperado: epoch muda, proposta cancela/E_STALE, nova base é respeitada e âncoras permanecem. Repetir com compactação nativa falhando: não marcar sucesso ou apagar a visão anterior. Evidência: eventos reais do host e overlay.

### T11 — Revert e mutação

Editar uma fonte coberta, reverter a sessão ou apagar uma mensagem pela interface pública antes da publicação. Esperado: proposta não aplicada; overlay dependente é invalidado/recalculado sem ressuscitar informação revogada. Se nova visão não couber, E_BUDGET/fallback explícito. Evidência: versões e request efetivo.

### T12 — Crash nos pontos de commit

Interromper processo depois de gravar blob, depois de ready, antes do commit e depois do commit antes de devolver o hook. Esperado: blob órfão tolerado; nenhuma view parcial; queued/running órfãos não repetem inferência; published reaparece uma vez. Evidência: reinício real de processo com SQLite/arquivos, não só objetos mockados.

### T13 — Idempotência

Repetir resultado do mesmo job, callback tardio e render do mesmo frame/view. Esperado: um capítulo/job, uma revisão publicada, uma ocorrência de SUMMARY; emissions não duplicadas sob a mesma chave. Callback de cancelado permanece terminal. Evidência: constraints e contagens.

### T14 — Gatilho e cache

Usar F-BUDGET e variar U em T-1, T e T+1, com 90% da entrada atendida por cache. Esperado: disparo em T, não em T-1; U inclui cache, instruções e tools. Evidência: valores intermediários da fórmula e job admitido.

### T15 — Reservas e configuração

Exercitar I<C-R, H menor, missão maior que F, C/R desconhecido, T<=0 e limites inválidos. Esperado: T antecipado ou E_SCHEMA/E_BUDGET; nenhuma chamada acima do limite; nenhuma constante fictícia substitui capacidade desconhecida. Evidência: zero chamadas nos casos recusados.

### T16 — Rearmamento

Após uma poda, simular U abaixo de L e nova subida a T; depois simular contexto ainda acima de T sem novos tokens; finalmente N novos tokens após cooldown. Esperado: rearmar somente nos dois caminhos especificados, não em cada toolcall. Relógio de teste controla bordas de cooldown sem sleeps longos.

### T17 — Noop e ganho insuficiente

Responder noop, replace vazio, resumo maior ou redução abaixo de M. Esperado: nenhuma troca de view/capítulo; E_NO_GAIN apropriado; mesmo digest não dispara novamente sem condição de rearmamento. Ganho conta wrapper, fontes e anchors, não apenas tamanho do texto do modelo.

### T18 — Pressão durante manutenção

Fork lento; workers fazem a entrada ultrapassar B. Esperado: nenhuma requisição acima de B; recuperação nativa suportada ou espera visível; todos os resultados continuam registrados. O pai não fica aguardando o clone enquanto U permanece dentro do orçamento.

### T19 — Fonte antes da poda

Injetar falha no fsync/rename, disco cheio e hash divergente antes de preparar/publicar. Esperado: sem capítulo publicado que dependa da fonte; view antiga mantida. No caminho válido, consultar original retorna bytes e digest exatos, inclusive fonte de zero bytes. Evidência: arquivos privados e transaction rollback.

### T20 — Ausência explícita

Buscar referência existente e apagar/excluir a fonte antes da leitura; testar também URL sem bytes capturados. Esperado: E_SOURCE/availability apropriada, sem ler versão atual do path nem inventar resumo. Item com fonte não retida é protegido contra substituição dependente.

### T21 — Âncoras literais

F-CONTINUITY atravessa dez publicações com resumos diferentes. Esperado: texto/versão das âncoras ativas presente literalmente e uma vez em cada entrada relevante; síntese não é autoridade de permanência. Não exigir obediência infalível do modelo como teste estrutural.

### T22 — Revogação e revisão

Atualizar/remover âncora enquanto clone roda; tentar replace com expected_version antigo. Esperado: E_CONFLICT na mutação obsoleta; job antigo cancelado; entrada seguinte não restaura regra revogada. Nenhuma decisão de cache mantém regra inválida.

### T23 — Blocos e escopo

Ativar bloco somente para tarefa A e depois encerrar A pelo fluxo autorizado. Esperado: versão correta aparece em A, não em B, e expira sem inferência do clone. Exceder limite de blocos/tokens recusa toda a ativação, sem remover outra âncora. Texto externo não ganha papel system/user.

### T24 — Pausa e remoção

Pausar com job running e view já compactada; remover após prepare-handoff. Esperado: job cancela; overlay continua em pause; desinstalação preparada deixa host dentro do orçamento com compromissos preservados. Sem API de handoff, E_CAPABILITY e instrução explícita; não editar transcript privado.

### T25 — Estado remoto

Configurar uma rota que use continuidade remota sem seleção materializável. Esperado: complete inelegível, nenhuma afirmação de que editar array local retirou dados remotos. Uma rota futura com rebase público deve mostrar o conteúdo remoto efetivo em seu teste específico.

### T26 — Feedback limitado

Gerar lookup isolado, três leituras sobrepostas e correção explícita. Esperado: lookup não fixa capítulo; repetição gera candidato de recorte, com authority=agent, escopo e expiração; no máximo 32 recibos/2048 tokens e oito notas conforme limites. Noop não consome recibos; publicação registra feedback_applied como declaração.

### T27 — Consolidação e lineage

Acumular capítulos até não haver run bruto elegível; consolidar dois anteriores. Esperado: DAG de parent_chapters sem ciclo, originais consultáveis, versões antigas não injetadas todas na janela. Referência para outro escopo ou futuro é rejeitada. Fonte de resumo continua identificada como tal.

### T28 — Publicado não é entregue

Commit da view seguido de falha de transporte antes da emissão; depois emissão sem resposta; depois resposta. Esperado: selected, emitted e acknowledged refletem apenas observações reais; campos não conhecidos permanecem null. A falha não desfaz capítulo válido nem afirma que o modelo o usou.

### T29 — Ordem dos plugins

Adicionar outro plugin que altera mensagens depois do nosso hook. Esperado: comparação/diagnóstico detecta mudança ou declara não observável; não manter evidência de fidelidade válida. Perfil homologado registra a ordem/configuração; mudança exige revalidação.

### T30 — Independência do núcleo

Executar o mesmo conjunto de contratos contra dois adaptadores de teste com formatos nativos diferentes. Esperado: nenhuma importação de tipos/banco do host pelo núcleo; mesmas invariantes de cobertura/persistência; partes desconhecidas preservadas. Teste sintético não é homologação de Gemini CLI.

### T31 — Autorização de consulta

Passar campos session_id/path desconhecidos, IDs de outra sessão e capítulo de outro workspace. Esperado: E_SCHEMA/E_SCOPE sem revelar conteúdo/existência; consultas válidas só retornam escopo derivado da tool call. Nenhum SQL/shell é construído a partir de query como código.

### T32 — Exportação e exclusão

Exportar sessão com fonte capturada e fonte excluída; importar manifesto adulterado e com caminho escapando; excluir sessão enquanto clone finaliza. Esperado: exportação privada sem auth; importação inválida rejeitada sem escrever fora da raiz; namespace novo; callback não recria sessão excluída; blobs sem referência são limpos conforme política.

### T33 — Versões e capacidades

Doctor recebe versão/rota diferentes da homologada, docs v2 num host v1 ou transporte WebSocket fora do perfil. Esperado: capacidade unknown/missing e complete não ativado; nada de identificar suporte pelo nome comercial do modelo. Nenhuma chamada paga de diagnóstico automático.

### T34 — Avaliação de produto

Executar baseline real, poda determinística e produto com mesmas tarefas/ambiente; repetir por seed/ordem e reportar variabilidade. Incluir contraste com âncoras equivalentes para atribuir ganho do fork. Esperado: resultados de tarefas aceitas/erros/intervenções rastreáveis, negativos incluídos; sem percentual inferido só da redução de tokens.

### T35 — Uso e economia

Fixtures com leitura/escrita de cache, entrada sem cache, saída, retries e custo desconhecido de assinatura. Esperado: categorias sem contagem dupla; total inclui pai/workers/maintainer/consultas; unknown não vira US$0. Cache do fork é medido separadamente do custo de adotar o resumo. Ensaio offline não recebe rótulo cache hit real.

### T36 — Ativação e diagnóstico

Instalar com enabled=false; rodar inspect/doctor; ativar em modo incompatível; ativar modo autorizado. Esperado: zero inferências antes do consentimento; incompatibilidade explícita; sem mudança de quotas automática; status distingue prepared/published/observed e não polui cada turno com aviso de sucesso.

### T37 — Schemas e saída do modelo

Requisitos R06/R07/R17. Fuzz de campos extras, UTF-8 inválido, NaN, números fora do limite, sources fora do manifesto, claims vazios, resposta truncada e fences de Markdown. Esperado: E_SCHEMA ou erro de finish; no máximo um reparo dentro das duas chamadas totais, nenhuma proposta inválida publicada. IDs/control plane vêm do job, não do JSON do modelo.

### T38 — Paginação e integridade

Requisitos R20/R31/R32. Ler ranges e páginas no limite exato de tokens/bytes, fonte vazia, cursor adulterado/expirado, alteração de índice durante paginação. Esperado: partial/cursor coerentes, E_CURSOR sem reinício silencioso, hash dos originais preservado; sem reidratação ilimitada ou dados de outro escopo.

### T39 — Mudança de modelo e perfil

Requisitos R06/R22/R25/R33. Trocar modelo, variante, system, toolset ou transporte depois do snapshot. Esperado: fingerprint/policy/epoch incompatível invalida ready; nova oportunidade usa reservas/capacidades revalidadas. Não transportar blocos opacos incompatíveis nem promover cache anterior por mesma chave.

### T40 — Timeout e quotas

Requisitos R03/R15/R16/R18. Sequências 429→sucesso, E_SCHEMA→429, timeout→resposta tardia, quota esgotada e envio de custo incerto. Esperado: máximo duas chamadas físicas por job, deadline original mantido, Retry-After respeitado quando admissível, callback tardio ignorado, reserva incerta não devolvida como economia. Pai não tem sua quota alterada pelo maintainer.

## 4. Classes de prova e gates

**Documento:** links, IDs, referências e DDL são válidos. Não prova runtime.

**Unidade/contrato:** implementação real do núcleo, relógio controlável e adapter/provider sintéticos. Não duplicar algoritmo no teste; verificar entradas/saídas e efeitos. Fixtures não são geração de modelo real.

**Integração local:** SQLite/arquivos/processos reais e OpenCode stock, com provider de teste. Prova o ciclo e isolamento sem custo de inferência. G-OC-01 em SPEC-04 deve passar antes de release completa.

**Live autorizado:** rota e modelo exatos, cache observado, fontes sintéticas, limites de gasto definidos pelo usuário. O modelo precisa continuar corretamente depois de múltiplas compactações; comportamento e custo são medidos, não presumidos.

**Produto:** piloto longo com baseline/ablação e intervenção corretiva registrada. LLM-as-judge pode auxiliar, mas não define sozinho aceite da tarefa ou verdade de uma evidência.

Falhas críticas R02/R03/R05/R08/R09/R12/R19/R21/R22/R31/R32 bloqueiam release. Compatibilidade ausente bloqueia o modo correspondente, não é ignorada por haver bons benchmarks. Ganho semântico não é pré-requisito para testar engenharia, mas é necessário para anunciar superioridade do produto.

## 5. Formato mínimo de evidência

Cada relatório contém commit do produto; host/version/commit; perfil/modelo/variante/auth type/transport sem segredos; IDs dos testes executados; fixture/seed; comando real; resultado; paths/digests dos artefatos; limitações. A mesma execução não é contada como cinco ensaios independentes por ter cinco asserts.

Status permitido: `not_run`, `pass`, `fail`, `blocked`. `blocked` exige razão e requisito faltante. Nenhum teste desta lista deve ser marcado pass apenas porque foi especificado. Estado inicial desta entrega: todos `not_run`.
