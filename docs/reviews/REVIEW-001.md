# REVIEW-001 — revisão adversarial do desenho standalone

Data: 2026-09-17. Base: `557e9a1824ceb71d453029e146db4ab26b16cf9a`, RFC-CSC-001 v0.2. Revisão estática do autor, não revisão independente, teste de runtime ou benchmark.

## Resultado

O desenho pode avançar à especificação do núcleo e dos contratos de integração, com as correções abaixo. Compatibilidade de host é um gate separado: nenhum adaptador é homologado por esta revisão. O primeiro alvo de ensaio é **OpenCode upstream v1.18.31**, commit `a97622c801f4ca571530ddc51076af659a9c32cd`; não um checkout do HuGR-Orchestra.

O gate `G-OC-01` impede anunciar o modo completo antes de demonstrar captura, isolamento, aplicação e saída usando apenas interfaces públicas. Se o gate falhar, o resultado permitido é um relatório de incompatibilidade e continuidade assistida explicitamente identificada; não um patch oculto do host. Isso não bloqueia a implementação do núcleo contra um adaptador de teste.

## Achados e decisões

| ID | Gravidade | Cenário que quebra o desenho anterior | Resolução normativa | Prova futura |
|---|---|---|---|---|
| A01 | Crítica | Snapshot termina em S; resumo publicado em N apaga S+1..N. | Cobertura usa IDs/revisões do snapshot. Publicação aplica substituição declarativa, nunca corte pelo horário de conclusão. | T08, T09 |
| A02 | Crítica | Plugins escrevem banco/transcript privado para simular edição nativa. | Núcleo possui armazenamento próprio; adaptador só usa hooks/APIs públicos. Incompatibilidade não autoriza monkey patch. | T01, T30 |
| A03 | Alta | Afirmar que hooks v2 pertencem à versão estável v1. | Fixar perfil v1 por commit. Documentação v2 é evidência separada, não contrato herdado. | T01, T33 |
| A04 | Crítica | Negar todas as tools remove schemas e muda o prefixo; não negar permite efeitos do clone. | Separar autorização de execução de fidelidade do envelope. Não executar clone no runner normal até provar bloqueio antes dos efeitos, inclusive MCP. Proibir tools server-side no piloto. | T05, T06 |
| A05 | Alta | Eventos de várias sessões alimentam um snapshot misturado; hook v1 de mensagens não recebe sessionID explícito. | Resolver identidade pelos metadados das mensagens; exigir um único escopo, nunca usar variável global “última sessão”. | T02, T07 |
| A06 | Alta | Cache é dado como garantido por fork, nome do modelo ou chave igual. | Fidelidade e cache medido são campos separados. Hooks antes da resolução final não provam identidade wire-level. | T06, T35 |
| A07 | Crítica | Compactor nativo e plugin publicam representações diferentes simultaneamente. | Cada chamada declara host_epoch. Evento nativo invalida propostas, fecha a epoch anterior e requer rebase observável. Se não houver detecção confiável, modo completo indisponível. | T10, T11 |
| A08 | Alta | Retry, reload ou segundo processo publica duas vezes ou dispara forks recursivos. | Lease com fencing; job com identidade única; proposta idempotente. Job órfão não repete inferência automaticamente. | T03, T12, T13 |
| A09 | Alta | Uso cacheado é subtraído da ocupação; janela gigante dispara tarde; manutenção sem ganho repete para sempre. | Contar entrada completa, separar limites, reservar crescimento/saída; fórmula e rearmamento definidos em SPEC-02. | T14–T18 |
| A10 | Alta | Ledger guarda só output truncado ou URL que expira e promete perda zero. | Persistir bytes capturados antes da substituição; marcar disponibilidade e política. Conteúdo irrecuperável impede substituição que dependa dele. | T19, T20 |
| A11 | Alta | Regra é revogada durante o fork e o resumo antigo a restaura; blocos curados promovem dados a system. | Policy revision invalida a proposta; origem/autoridade preservadas; âncora controlada pelo usuário não é mutável pelo clone. | T21–T23 |
| A12 | Alta | Remover plugin reintroduz transcript gigantesco ou usa provider_state que ainda contém mensagens podadas. | Parada de manutenção mantém overlay; desinstalação tem handoff. Rotas stateful precisam materialização/rebase suportado, ou ficam inelegíveis. | T24, T25 |
| A13 | Média | Cada busca promove capítulo inteiro a âncora; summaries e feedback crescem indefinidamente. | Recibos limitados, promoção temporária do recorte, consolidação de capítulos com lineage. Consulta normal não é erro. | T26, T27 |
| A14 | Alta | “Publicado” significa “modelo viu”, mesmo quando outro hook muda a entrada ou a chamada falha. | Separar revisão selecionada, emissão observada e resposta reconhecida. Paridade não observável permanece desconhecida. | T28, T29 |
| A15 | Alta | Busca livre aceita session_id/path do modelo e cruza projetos; exportação inclui credenciais. | Escopo deriva do adaptador autenticado; paths nunca são autoridade; ledger privado local, exportação filtrada e exclusão respeitada. | T31, T32 |
| A16 | Média | Produto inteiro supera baseline, mas ganho é atribuído ao clone mesmo vindo só das âncoras. | Baselines comparáveis e ablação; custo inclui maintainer, reidratação, retries e retrabalho. | T34, T35 |

As resoluções são decisões de desenho. A coluna de provas aponta para testes especificados, ainda não executados. A documentação de aceitação define cada ID e seu resultado esperado.

## Evidência direta da integração

**E01 — release:** o endpoint de releases retornou v1.18.31, publicada em 2026-09-14, com target `a97622c801f4ca571530ddc51076af659a9c32cd`. [Release](https://github.com/anomalyco/opencode/releases/tag/v1.18.31).

**E02 — contrato v1:** `packages/plugin/src/index.ts` no commit acima define `experimental.chat.messages.transform`, `experimental.chat.system.transform`, `chat.params`, `tool.execute.before`, `experimental.session.compacting`, `dispose`. O hook de mensagens recebe `input: {}`; o hook de parâmetros não recebe o conjunto final de ferramentas. [Código](https://github.com/anomalyco/opencode/blob/a97622c801f4ca571530ddc51076af659a9c32cd/packages/plugin/src/index.ts).

**E03 — request real:** `packages/opencode/src/session/llm/request.ts` resolve/filtra ferramentas depois dos hooks de parâmetros/headers, ordena-as, ajusta `strict` em rotas específicas e trata system/instructions diferentemente em OAuth OpenAI. `Permission.disabled` participa do filtro. Esta leitura demonstra que copiar apenas os resultados dos hooks não prova igualdade completa de requests. [Código](https://github.com/anomalyco/opencode/blob/a97622c801f4ca571530ddc51076af659a9c32cd/packages/opencode/src/session/llm/request.ts).

**E04 — compactação nativa v1:** leitura dirigida de `compaction.ts`, linhas 380–540: conversação serializada, agent `compaction`, `tools: {}`, `system: []`, geração de mensagem sintética de continuação. Não é nosso fork fiel por definição. [Código](https://github.com/anomalyco/opencode/blob/a97622c801f4ca571530ddc51076af659a9c32cd/packages/opencode/src/session/compaction.ts#L380-L540).

**E05 — documentação v2:** descreve hooks `context`, `generate`, `compaction`, `http.request`; `options` começa vazio, sem os defaults já resolvidos, e HTTP hooks não veem tráfego WebSocket. É candidato de integração, não prova de que existe na release v1 fixada. [Documentação](https://opencode.ai/v2/docs/build/plugins).

**E06 — cache:** depende de prefixo renderizado e configurações; compactação altera elegibilidade a partir da mudança. [OpenAI](https://developers.openai.com/api/docs/guides/prompt-caching). Não foram consultados preços para esta revisão nem realizadas chamadas de inferência.

## Limitação concreta G-OC-01

Falta executar uma prova pública, na versão fixada, que una: (a) contexto que realmente sai; (b) geração auxiliar sem despacho de tools; (c) aplicação nas continuações; (d) detecção de compactação nativa; (e) desativação segura. A API de hooks isoladamente não certifica essa conjunção.

A especificação fecha a reação a esse resultado: `unsupported`/`assisted`, motivo estruturado, nenhuma poda silenciosa e nenhuma cobrança auxiliar automática antes do consentimento de modo. Não deixa ao implementador a escolha de escrever internals ou inventar credenciais.

## Passagens de revisão realizadas

1. Fronteiras do produto e contratos públicos: A02–A06.
2. Concorrência, persistência e orçamento: A01, A07–A10, A12, A14.
3. Semântica, privacidade, recuperação e avaliação: A11, A13, A15–A16.

Foram simulações de desenho e leitura estática, não três agentes independentes nem testes executados. A revisão evita exigir perfeição semântica: exige que limitações sejam representadas e que o ciclo não corrompa ou falsifique a sessão.

## Critério de fechamento

Esta revisão fecha decisões arquiteturais no nível do núcleo. A aprovação de compatibilidade fica em WP-00/G-OC-01. A revisão pode ser encerrada quando os contratos, a matriz de aceitação e o mapa de work packages estiverem publicados e consistentes. Implementação e benchmark permanecem etapas distintas.
