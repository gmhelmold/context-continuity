# WP-00 — prova executável inicial no OpenCode stock

**Estado: investigação em andamento; modo completo NÃO liberado.** A especificação 0.1.1 foi integrada pelo PR #2. Este incremento implementa uma sonda de integração isolada, não o core nem o plugin distribuível.

## Resultado observado

Dez verificações executáveis passaram contra o binário oficial OpenCode **1.18.31**, commit de release `a97622c801f4ca571530ddc51076af659a9c32cd`, em macOS x86_64. [Evidência estruturada e hashes](wp00-macos-evidence.json). O relatório do CI da mesma suíte é independente deste resultado local.

A fonte do provider é um servidor HTTP em loopback que retorna respostas sintéticas e SSE fragmentado. Não existe modelo real, raciocínio avaliado, cache medido ou chave de provider. O próprio OpenCode executa o fluxo de sessão, carrega o plugin e despacha a ferramenta de teste. Não são mocks do runner do host.

| Verificação | Evidência exigida e observada |
|---|---|
| Instalação/ciclo real | Plugin pelo entrypoint público; três chamadas de ferramenta de contador e quatro requests primary no cenário principal. |
| Compactação concorrente | Pai executa ferramenta antes de o resumo auxiliar ficar pronto; entrada posterior substitui o turno antigo e mantém os três resultados novos. |
| Histórico preservado | GET público do histórico ainda contém a fonte removida da entrada; nenhuma síntese foi escrita no transcript privado. |
| Fork fiel no transporte | Recorder independente compara o corpo do clone sem a missão final ao request original efetivamente recebido; igualdade de mensagens e opções. Isso não comprova cache hit. |
| Saída de ferramenta do clone | E_TOOL e nenhum incremento extra no contador; não é criada uma sessão auxiliar no host. |
| Limite físico de tentativas | Endpoint vê duas chamadas nos cenários 429 e reparo de JSON; chamada ao runner não é usada para o clone. |
| Configuração posterior | Outro plugin muda system no turno corrente; proposta antiga é rejeitada e não aparece no request. |
| Duas sessões | Intercalação real sem mistura dos marcadores; headers privados de correlação não chegam upstream. |
| Reset/cancelamento | Compactação nativa pela API pública permite continuar; novo input cancela auxiliar e impede publicação tardia, mantendo processamento remoto como desconhecido. |
| Remoção | Processo reiniciado com plugin removido e baseURL restaurada; sessão nova e sessão existente continuam pela rota direta. Histórico pequeno já cabe, sem checkpoint especial. |

Há dez checks no runner; alguns agrupam mais de uma asserção desta tabela. Não contar cada asserção como ensaio independente. [Código e comando](../../tests/conformance/opencode/README.md).

## Falha encontrada e correção da sonda

O primeiro ensaio da rota HTTP teve oito checks aprovados e um reprovado: após compactação nativa, o codec esperava assistant e recebeu um user sintético. No commit fixado, a parte pública `compaction` é serializada como uma pergunta de continuidade. A sonda passou a reconhecer exatamente esse caso conhecido e a manter seu grupo protegido. Unknown continua sendo erro: não foi adicionada correspondência por similaridade nem cópia de banco privado.

O ensaio seguinte incluiu cancelamento; os dez checks passaram. A revisão final reforçou o oráculo de fidelidade: comparação independente no recorder, não somente hashes calculados pelo plugin. Também verificou a quantidade exata de sessões criadas e o hash do binário antes/depois.

Fonte estática delimitada para o marcador: [conversão no commit fixado](https://github.com/anomalyco/opencode/blob/a97622c801f4ca571530ddc51076af659a9c32cd/packages/opencode/src/session/message-v2.ts). O adaptador não importa esse módulo.

## Cobertura honesta do gate P01–P14

`demonstrado` abaixo vale somente para a fixture/rota explicitada, não para os 55 subcasos do produto.

| Passo | Estado neste incremento | Complemento necessário para aprovação integral |
|---|---|---|
| P01 | parcial | Arquivo de plugin público funciona; testar tarball final, manifesto e instalação do pacote. |
| P02 | demonstrado na fixture | Repetir no adaptador de produto com persistência. |
| P03 | demonstrado na fixture | Preservar estes oráculos na implementação. |
| P04 | demonstrado na fixture | Scheduler preventivo e quotas reais pertencem ao core, não a esta sonda. |
| P05 | parcial | Testar ferramenta padrão e MCP anunciados, além da ferramenta customizada já exercitada. |
| P06 | parcial | Encadear consolidações, fonte alterada e reinício do plano persistido; esta sonda substitui um turno delimitado. |
| P07 | demonstrado na fixture | Cache e qualidade dependem de ensaio live autorizado separado. |
| P08 | parcial | Foi executado reset nativo com sucesso; falta falha nativa e corridas adicionais com ready. |
| P09 | parcial | Cancelamento real passou; falta crash/reload durante publicação e recuperação persistida. |
| P10 | parcial | Remoção/rota direta passaram com histórico pequeno; falta handoff com contexto que não cabe sem overlay. |
| P11 | parcial | 429 e reparo passaram; ampliar para 5xx, retries do pai e encerramento incerto. |
| P12 | parcial | Mudança de system por plugin posterior passou; faltam tools, variante e codec completo. |
| P13 | parcial | Requisição local sem associação foi recusada; ampliar limites, modelo, corpo e autorização. |
| P14 | não executado | Upgrade, perfil e decisão de capacidade no pacote real. |

A issue #3 permanece aberta. Nenhum dos 55 subcasos agregados de runtime foi promovido para PASS por este subconjunto. O registro canônico continua intacto; este relatório é a evidência incremental. Aprovar o código da sonda não habilita `complete`.

## Fronteiras do código de prova

A sonda possui seleção de intervalo comandada pela fixture, overlay em memória e schema reduzido de resumo. Não implementa gatilho 50%, SQLite/ledger, âncoras versionadas, ManifestEntry, rearmamento, cobertura achatada geral, importação, GC ou recuperação de crash. Não publicar esse código como plugin de produto.

O listener recusa destinos fora do loopback: não serve como gateway para uso pessoal/live. Local authorization existe apenas para o ensaio. Um conjunto fechado de representações conhecidas de mensagens é suportado; conteúdo desconhecido é recusado. Essa limitação é deliberada e não mascara compatibilidade de outros modelos.

## Próximo incremento

Completar a cobertura restante do WP-00, começando por consolidações/reinício e falha de reset, com os mesmos oráculos de request final. O core pode avançar no WP-01; liberação de modo completo continua condicionada a todos os passos e à conjunção de capacidades.

## Continuação da prova

[Consolidações, reinício e falha de reset](OPENCODE-WP00-CONTINUITY.md) amplia a suíte para 14 verificações e substitui a limitação de overlay exclusivamente em memória por um checkpoint de fixture. O relatório acima permanece como evidência do incremento inicial, não como descrição da cobertura mais recente.

## Corrigendum da REVIEW-003

Os resultados históricos acima e seus JSONs foram preservados. A revisão demonstrou que contagens e marcadores não bastavam para afirmar igualdade integral da cauda. Consulte a [resolução C01–C12](../reviews/REVIEW-003-RESOLUTION.md) para os oráculos fortalecidos e suas provas negativas. O novo resultado não reescreve retrospectivamente o significado de 10/10 ou 14/14 anteriores, nem promove as fixtures a produto completo.
