# Work packages — Context Continuity v0.1

Estado: **pacotes especificados, não executados**. Contratos: [índice](README.md). Aceitação: [SPEC-06](06-acceptance.md). Cada pacote termina com evidências, não apenas código ou texto de agente.

## Ordem e fronteiras

```text
WP-00 ────────────────────────────────────────────┐
WP-01 → WP-02 → WP-03 → WP-04 → WP-05 ────────────┤→ WP-06 → WP-07
```

WP-00 pode ocorrer em paralelo à implementação do núcleo, mas seu PASS é obrigatório para o modo completo de WP-06. Falha no gate não autoriza patch do host nem substitui o produto por memória MCP com o mesmo nome. Pacotes independentes podem avançar contra adapter sintético; release continua bloqueada no perfil que falhou.

Todos usam branches pequenas, testes do código real e documentação de comandos executados. Não publicar pacote npm ou benchmark sem autorização/validação próprias. Não aumentar escopo para cinco integrações completas no primeiro ciclo.

## WP-00 — Provar a fronteira pública do OpenCode

**Dependências:** especificação revisada; OpenCode upstream v1.18.31 no commit fixado. **Contratos:** SPEC-04; R01/R05/R25/R29/R33. **Testes:** T01, T05, T06, T25, T29, T33 e passos P01–P10 de G-OC-01.

### Trabalho atômico

1. Criar workspace sintético e instalação stock isolada, registrar hashes/versões/SDK sem ler credenciais da instalação pessoal.
2. Carregar plugin mínimo de ensaio por interface pública; instrumentar frames e saída de transporte em provider controlado.
3. Reproduzir tool loop, duas sessões, fork com resposta retardada e tentativa de tool auxiliar sem efeito.
4. Confirmar publicação com cauda, reset nativo, ordem de plugins e handoff; executar P01–P10.
5. Publicar CapabilityReport com pass/fail/unknown por propriedade, evidências sanitizadas e lacuna exata quando houver.

### Success Criteria

Existe prova reproduzível das capacidades combinadas exigidas pelo perfil, ou diagnóstico precisamente delimitado que mantém complete indisponível. Encontrar uma incompatibilidade verificável é conclusão legítima do ensaio, mas não libera WP-06 em modo completo.

### Quality Standards

Usar somente APIs/hooks públicos do commit fixado. Distinguir stub de provider live. Não chamar permissões deny-all de isolamento cache-safe sem conferir os schemas finais. Não usar claims de documentação como testes.

### Completeness Criteria

Todos os P01–P10 possuem resultado e artefato ou blocker específico. Captura, geração, publicação, recuperação e remoção estão cobertas. Não basta demonstrar que uma tool MCP funciona.

### Definition of Done

Relatório versionado; comandos reais documentados; fixtures sintéticas reproduzíveis; host intacto; flags de capacidade conservadoras. Se necessário, abrir ADR separado para nova versão/interface pública; sem inventar workaround implícito. Relatório deve explicar claramente se o gate de release está liberado ou bloqueado.

### Invariants

I1/I2/I5/I7/I11/I12/I13 do RFC: entrada em andamento intacta; cauda preservada; zero tools do clone; request válido; capacidade verdadeira; sem internals; isolamento de escopo.

**Evidência esperada:** manifesto de versões, traces de requests sem auth, contador de efeitos zero, diffs de payloads, teste de desinstalação e CapabilityReport.

## WP-01 — Contratos, normalização e configuração do núcleo

**Dependências:** especificação; não depende do PASS do host. **Contratos:** SPEC-01 e configuração de SPEC-02; R02/R07/R30. **Testes:** T02, T07, T30, T37; validação de configuração de T15.

### Trabalho atômico

1. Criar núcleo TypeScript/ESM e schemas de Scope/Unit/Frame/Snapshot/Proposal/Capabilities/Error sem import de host.
2. Implementar criação de IDs, canonicalização/digests e validação estrita dos control planes.
3. Implementar resolução/versionamento de config e rejeição de limites desconhecidos/inválidos.
4. Criar dois adaptadores sintéticos com formatos nativos diferentes; preservar payload opaco e identidade de protocolo.
5. Demonstrar isolamento de mensagens iguais, IDs iguais entre hosts e mutação de revisão.

### Success Criteria

O núcleo interpreta os contratos sem depender de OpenCode; dados inválidos não entram em estado publicável. Os dois formatos de teste satisfazem as mesmas invariantes sem cópia de política.

### Quality Standards

Type checking estrito, ausência de any no núcleo, schemas testados em limites; normalização não perde campos nativos. APIs pequenas correspondem aos contratos, sem abstrações de hosts inexistentes.

### Completeness Criteria

Todos os tipos/erros publicados em SPEC-01 têm representação e validação. Limites de tamanho, Unicode, números e manifesto são testados. Unknown não vira valor vazio validado.

### Definition of Done

T02/T07/T30/T37 passam contra implementação; configuração inválida testada; comandos reais de teste/typecheck registrados; dependências do núcleo inspecionadas; nenhum package install/release fictício anunciado.

### Invariants

Escopo deriva da integração, nunca do modelo; hashes não normalizam conteúdo; grupos opacos preservados; núcleo não conhece tabelas privadas; IDs de execução são fornecidos pelo harness.

**Evidência esperada:** resultados de testes de contrato, fuzz de schema, vetores de hash, grafo de imports e prova dos dois formatos sintéticos.

## WP-02 — Persistência, ledger e transações

**Dependências:** WP-01. **Contratos:** SPEC-03; R03/R12/R19/R32. **Testes:** T03, T12, T19, T32 e integridade de T38.

### Trabalho atômico

1. Implementar schema/migração v1 e armazenamento privado por workspace, sem abrir DB do host.
2. Implementar fonte inline/blob, hash/fsync/rename, quota e estados de disponibilidade.
3. Implementar lease, fencing, unique active job e publicação transacional com CAS.
4. Implementar startup/crash recovery sem repetir geração incerta e backup/migração segura.
5. Implementar export/import namespace separado, exclusão cancelando jobs e GC apenas de órfãos elegíveis.

### Success Criteria

Nenhuma view referencia fonte parcial/inexistente por falha de gravação, nenhuma publicação é parcial e dois processos não assumem a mesma sessão simultaneamente.

### Quality Standards

Testar SQLite e filesystem reais, com falhas injetadas nos pontos de persistência; permissões locais verificadas. SQL parametrizado; refs de capítulos/feedback/visões sempre conferidas dentro do mesmo escopo.

### Completeness Criteria

Schema, quotas, arquivos grandes/vazios, migrações, owner expirado, exclusão, import/export e garbage collection cobertos. FK e cascades de exclusão testados com todos os relacionamentos populados.

### Definition of Done

T03/T12/T19/T32 passam incluindo reinício de processo. Ler fonte retorna bytes/hash originais. DDL validar sozinho não satisfaz DoD. Diretórios de teste limpos; histórico sintético não vai para telemetria real.

### Invariants

Fontes precedem publicação; rollback integral; callback antigo perde autoridade; credenciais ausentes; fonte capturada não é substituída pelo arquivo atual; exclusão não é revertida por job tardio.

**Evidência esperada:** traces de transações, fault injection, diretórios e permissões verificados, teste de migração/rollback, manifestos de export/import sintéticos.

## WP-03 — Agendador preventivo e executor auxiliar

**Dependências:** WP-01/WP-02. **Contratos:** SPEC-02; R04/R06/R14–R17. **Testes:** T04, T06, T14–T17, T37, T40.

### Trabalho atômico

1. Implementar B/G/F/T/L/N/M com defaults resolvidos e contagem total de contexto.
2. Implementar seleção determinística de runs seguros, cauda protegida e consolidação alternativa.
3. Implementar admissão, coalescência, rearmamento, quotas e deadline por job.
4. Implementar executor por contrato de adaptador: snapshot imutável, missão no sufixo e nenhuma tool despachada pelo núcleo.
5. Implementar parse/validação/ganho, noop, retry ou reparo dentro de duas chamadas físicas e cancelamento de callbacks tardios.

### Success Criteria

O gatilho dispara preventivamente uma vez, não bloqueia o pai dentro da margem e produz somente propostas bounded/validáveis. Nenhum cenário cria loops de compaction ou gastos infinitos.

### Quality Standards

Relógio e provider controláveis; código do scheduler real; contagens de chamadas/entrada incluem retries e cache; status desconhecido preservado. Sem esperar LLM no hook de envio.

### Completeness Criteria

Bordas T-1/T, limites desconhecidos, F real excedido, ganho insuficiente, duas formas de rearmamento, tarefas simultâneas, timeout e quota esgotada testados.

### Definition of Done

T04/T06/T14–T17/T37/T40 passam com adapter sintético. Geração live continua condicionada ao perfil autorizado, não à existência de uma key no ambiente. Missão e schema versionados com as mesmas regras da spec.

### Invariants

Um job ativo por sessão; contexto cacheado conta na janela; same digest não repete sem condição; no máximo duas tentativas totais; clone sem efeitos; job terminal não ressuscita.

**Evidência esperada:** vetores de orçamento, timeline concorrente, contadores de chamadas e relatório de todos os estados terminais.

## WP-04 — Projeção e publicação da visão

**Dependências:** WP-01/WP-02/WP-03. **Contratos:** SPEC-01/02/03; R08–R11/R13/R27/R28. **Testes:** T08–T13, T27–T28, T39 e parte de T29.

### Trabalho atômico

1. Implementar overlay por unidades/versões, sem mutar payloads do frame original.
2. Validar snapshot/prefixo/fingerprint/política/epoch/fence contra frame ATUAL.
3. Aplicar a síntese na posição do intervalo coberto e preservar toda a cauda; render idempotente em retry.
4. Integrar commit de Chapter/View/Job e registro selected/emitted/acknowledged.
5. Implementar reset nativo/revert/mutação, consolidação DAG, revalidação e rejeição de propostas stale.

### Success Criteria

F-PUBLISH é exatamente preservada com concorrência, e qualquer alteração de base/política invalida a proposta em vez de ocultar eventos. Nenhum callback publica fora de seu escopo/fence.

### Quality Standards

Golden tests e testes de propriedades contra formatos diferentes, falhas de commit, payloads opacos e chamadas paralelas. Comparar conteúdo e ordem, não apenas contagem de mensagens.

### Completeness Criteria

Cauda concorrente, system/tools/model changes, native failure/success, retry, crash e capítulos consolidados cobertos. Seleção de view não é rotulada como consumo comprovado.

### Definition of Done

T08–T13/T27–T28/T39 passam; mutações que apagam tail ou pulam CAS são detectadas pelos testes. Nenhuma transformação exige editar transcript em disco. Reversão de view não reexecuta efeitos.

### Invariants

I1–I4/I6–I9: entrada passada intacta; cauda única; fontes duráveis; âncoras preservadas; um escritor lógico; protocolo/budget válidos; commit íntegro; ledger fora da janela infinita.

**Evidência esperada:** arrays/envelopes antes/depois, trace de commit/failure, DAG de capítulos e testes de mutação dirigidos.

## WP-05 — Consulta, âncoras, blocos curados e feedback

**Dependências:** WP-01/WP-02/WP-04. **Contratos:** SPEC-05; R20–R23/R26/R31. **Testes:** T20–T23, T26, T31, T38.

### Trabalho atômico

1. Implementar context_search/context_read com escopo injetado, limites, resultados parciais e cursores.
2. Implementar versionamento/autoridade de anchors/curated blocks e orçamento de ativação.
3. Implementar recibos apenas do conteúdo efetivamente retornado e priorização de feedback bounded.
4. Implementar notas temporárias, expiração e correção sem promover memória de agente a regra do usuário.
5. Exercitar a sequência poda 30→consulta→poda 31 com omissão corretiva e lookup normal separados.

### Success Criteria

O agente recupera o trecho certo sem reidratar a sessão inteira; âncoras sobrevivem à compactação; feedback ajusta somente recortes pertinentes e não cresce sem limite.

### Quality Standards

Sem SQL/regex/shell executados pela query; fontes e autoridade exibidas; cursors assinados e verificados; exclusão/revisão concorrente tratadas. Conteúdo ausente nunca é reconstruído pela ferramenta.

### Completeness Criteria

Consulta vazia, texto repetido, fonte missing, range, quota, cursor expirado, escopo diferente, bloco excessivo/revogado e feedback sem escopo cobertos. Binários não são tratados como texto vazio.

### Definition of Done

T20–T23/T26/T31/T38 passam. Busca e leitura funcionam com ledger real; teste mostra âncora literal após dez ciclos estruturais e nota temporária expirando conforme contrato. Não anunciar ganho semântico só por essa fixture.

### Invariants

Origem não ganha autoridade; usuário controla sua regra; não atravessar workspace/session; não fixar capítulo inteiro por lookup; limites são aplicados pelo backend, não pelo modelo.

**Evidência esperada:** respostas reais das tools, versões de blocos, recibos de leitura, teste de cursor/escopo e timeline de retenção.

## WP-06 — Plugin OpenCode instalável e saída segura

**Dependências:** WP-00 PASS para o perfil completo; WP-01–WP-05. **Contratos:** SPEC-04/05; R18/R24/R36. **Testes:** T01, T05, T08–T11, T18, T24, T28–T29, T33, T36.

### Trabalho atômico

1. Empacotar adaptador nativo por entrypoint público, opções do plugin e declaração de capacidades.
2. Ligar hooks às operações do núcleo com correlação de sessão/turno comprovada no gate.
3. Integrar fluxo normal, compactação nativa, pause/resume e diagnóstico sem inferência oculta.
4. Registrar duas tools desde ativação, comandos/status mínimos e tratamento de colisões.
5. Testar tarball em instalação limpa, upgrade de perfil, disable-prepare/handoff, remoção e reinício.

### Success Criteria

Uma instalação stock executa o ciclo completo sem patch/manual cleanup; erros de manutenção não corrompem a sessão e a desativação tem resultado previsível.

### Quality Standards

Teste pelo pacote empacotado, não somente imports locais. Não anunciar compatibilidade com versões não testadas. Sem postinstall que execute modelo, sem telemetria de prompts e sem reaproveitamento não autorizado de credenciais.

### Completeness Criteria

Instalação, ativação, uso paralelo, reconstrução, compactação nativa, pausa, exportação e remoção documentados no perfil real. Orquestrador continua ao lado do maintainer dentro da margem; esperas excepcionais visíveis.

### Definition of Done

G-OC-01 permanece válido no pacote final; testes de integração acima passam; documentação contém comando de instalação real somente quando o artefato existir. Publicação de release é decisão separada, não efeito colateral deste pacote.

### Invariants

Não contornar ausência de interface; isolamento do clone; overlay reaplicado sem duplicação; integração parcial explicitada; nenhuma garantia ativa é prometida depois de remover o plugin.

**Evidência esperada:** tarball/hash, instalação limpa gravada/logada, frames e capítulos do ciclo integrado, relatório de saída e comandos reproduzíveis.

## WP-07 — Conformance, piloto e prova de portabilidade

**Dependências:** WP-06; testes de contrato podem ser preparados após WP-01. **Contratos:** SPEC-06; R30/R34/R35. **Testes:** T30, T34, T35 e regressão T01–T40 aplicável ao perfil.

### Trabalho atômico

1. Consolidar suíte de conformance por capacidade e relatório pass/fail/blocked, sem transformar not_run em pass.
2. Fixar versão/interfaces do segundo adaptador Gemini CLI em relatório próprio; implementar o mínimo para executar o mesmo ciclo de contrato, sem tipos do primeiro host no núcleo.
3. Preparar piloto com baseline real, poda simples e produto completo; incluir ablação de âncoras/curated blocks.
4. Executar somente ensaios live previamente orçados/autorizados, registrar tarefas aceitas, correções, erros, custo e latência por fase da sessão.
5. Publicar resultados positivos/negativos e decidir calibração/release com base neles.

### Success Criteria

Portabilidade é demonstrada por reutilização do núcleo, não por uma lista de logos. O piloto identifica se o mecanismo melhora continuidade e a que custo, sem garantia prévia de resultado favorável.

### Quality Standards

Modelos/rotas/versões fixados por ensaio, tarefas iniciais equivalentes, repetições e variabilidade reportadas; contar maintainer/recuperações/retries/retrabalho. Um reviewer LLM não é a única autoridade de aceite.

### Completeness Criteria

Cada capacidade anunciada tem teste executado no host correspondente. Perfil Gemini não comprovado permanece sem suporte anunciado. Comparações incluem o harness real com suas proteções nativas; não baseline artificialmente pior.

### Definition of Done

Relatório reprodutível com evidências sanitizadas e limitações; custos unknown identificados; resultados de segunda integração separados dos mocks. Se poda simples empatar ou vencer, registrar e simplificar antes de prometer superioridade. Nenhum threshold de ganho é inventado retroativamente para declarar sucesso.

### Invariants

Tamanho de contexto não é qualidade; cache hit não é verdade; instalação não é suporte; nenhuma execução paga escondida; nenhuma inferência de economia a partir de taxa de compressão apenas.

**Evidência esperada:** conformance report, perfil do segundo host, dataset sintético/manifestos, métricas por execução e análise de falhas/ablação.

## Critério comum de entrega

Cada pacote deve ligar seu PR aos requisitos/testes executados, incluir comandos reais, explicar qualquer blocked e manter os documentos coerentes. Os cinco axiomas são obrigatórios mesmo em pacote de investigação. Prova de capacidade indisponível pode concluir WP-00 como investigação, mas nunca como aprovação de release completa.

Etapa atual: estes pacotes são o plano executável da especificação. Nenhum está concluído nesta publicação documental.
