# WP-00 — continuidade, reinício e falha de reset

**Estado:** incremento de prova sobre OpenCode stock 1.18.31, não liberação do produto. Base: `020f4caddafd0cbe4a5e2964f784bc7dd5dfea4f`. Continua o [ensaio inicial](OPENCODE-WP00.md), sem alterar seus resultados históricos.

## Escopo executado

O mesmo binário oficial, sem patch, executa sessões, tools e continuações reais. O provider é HTTP/SSE sintético; não há LLM, custo de inferência, cache medido ou uso de configuração pessoal. A sonda passa de 10 para **14 verificações**, preservando os casos anteriores.

[Relatório macOS e hashes exatos](wp00-continuity-macos-evidence.json). O CI executa novamente a suíte em Ubuntu com artefato oficial fixado e publica seu próprio `report.json`; o relatório local não substitui essa execução.

### Quatro consolidações com reinício

A primeira poda representa um turno encerrado. Cada poda seguinte incorpora o resumo anterior e os turnos concluídos desde então. A cobertura é achatada para os IDs originais: o renderer nunca procura S1 no transcript bruto. Após a terceira poda, o host é encerrado e iniciado novamente; a quarta poda parte da visão restaurada.

O recorder independente compara o request auxiliar sem a missão ao request efetivo do pai em cada rodada. Também verifica a ausência do histórico retirado, uma única síntese vigente, os três resultados de ferramentas novos e a ordem/cobertura dos IDs obtidos da API pública. O histórico público mantém os originais e não recebe as mensagens de síntese da sonda.

### Falha nativa não é sucesso

Uma compactação nativa recebe HTTP 400 deliberado. A sonda mantém a mesma epoch e a mesma visão publicada, inclusive após reinício. No host fixado, uma continuação pode retomar a compactação nativa pendente. O teste permite que essa tentativa posterior tenha sucesso e só então exige avanço de epoch e retirada dos overlays anteriores.

Esse comportamento corrige o código de prova anterior, que limpava o plano assim que o reset começava. Não é uma correção do OpenCode nem um teste de todas as modalidades de falha nativa. Em particular, queda durante streaming de um reset ainda não foi demonstrada aqui.

### Queda durante execução auxiliar

O provider retém a resposta auxiliar. O teste confirma o registro da tentativa e encerra **somente o processo OpenCode criado pela própria fixture** com SIGKILL. Depois da retomada, a tentativa órfã fica identificada; não há repetição automática nem publicação tardia. O contador do endpoint continua mostrando uma chamada para aquele job. A ausência de processo local não é tratada como confirmação de cancelamento ou estorno remoto.

### Falhas transitórias e observabilidade

Além de HTTP 429 e reparo, a suíte verifica HTTP 503 com no máximo duas requisições auxiliares. Rótulos de eventos não podem mais ser sobrescritos pelo campo que identifica o tipo da chamada. O recorder usa HTTP/1.1 e contabiliza desconexões de transporte esperadas nos ensaios de cancelamento/queda, sem ocultar outras exceções.

## Limite da persistência de prova

`CC_CHECKPOINT` é um arquivo JSON privado dentro do diretório temporário da fixture. Guarda apenas plano publicado, epoch, jobs em trânsito e identificadores já disparados. Vincula-se ao workspace da instalação de teste; a troca usa rename. **Não é o ledger SQLite, não contém política de GC e não prova durabilidade contra falta de energia.** O teste demonstra reconstrução do plano após término/reinício e recusa de replay de job, não as transações completas de SPEC-03.

Não se promove o schema reduzido de proposta, a seleção comandada pelo teste ou o codec limitado para código de produção. Nenhum dado do usuário é capturado. A prova continua em `tests/conformance/opencode`, separada do futuro núcleo.

## Cobertura incremental do gate

| Passo | Nova evidência | O que não foi concluído |
|---|---|---|
| P06 | Quatro consolidações, cobertura original, cauda e prefixo em cada rodada | Mutation/revert de fonte e projeção geral do produto |
| P08 | Falha HTTP nativa preserva view; retry nativo posterior avança epoch somente no sucesso | Todos os pontos de falha de streaming/publicação nativa |
| P09 | Reinício de plano publicado e SIGKILL durante o clone, sem replay | Crash nos commits reais de SQLite e reload de todo perfil |
| P11 | 503 acrescentado a 429 e reparo, contagem física independente | Outras combinações de falhas e métricas do executor final |

A issue #3 permanece aberta. P01 (pacote/tarball), P05 (tools padrão/MCP), P10 (handoff acima do orçamento) e P12–P14 completos continuam necessários. Os 55 subcasos agregados não recebem PASS por inferência a partir desta sonda.

## Passagens de execução e correções observadas

A primeira execução desta extensão teve 12 checks aprovados e 2 falhos: uma conexão auxiliar resetada durante o cenário de reparo e uma expectativa incorreta de que a continuação após falha nativa não retomaria a compactação pendente. A fixture explicitou HTTP/1.1 e o teste passou a acompanhar a sequência observada do host, preservando a obrigação de não perder a visão anterior.

A execução final no macOS fechou com **14/14**; os hashes no relatório foram comparados novamente com os arquivos efetivamente testados. Uma repetição adicional expirou na inicialização fria do workspace antes de executar os casos; não foi contada como prova de comportamento. O prazo desse bootstrap foi separado e limitado a 180s; chamadas dos testes mantêm o limite anterior de 60s. Falhas de inicialização passam a produzir um relatório explicitamente reprovado. Erros de conexão durante uma tentativa auxiliar continuam contando no orçamento; não foi adicionado retry escondido para fazer o teste passar.

## Reprodução

Use o [comando documentado](../../tests/conformance/opencode/README.md) com binário oficial 1.18.31 e diretório de saída novo. O runner cria e encerra seus próprios processos e não reutiliza HOME/XDG pessoais. O workflow recebeu margem para os reinícios adicionais, mantendo limite finito.
