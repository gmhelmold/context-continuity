# REVIEW-004 — resolução D02/D03 e fechamento da rodada

**Base:** main `9e20aad21fcf855b614fe8c9af00c870bbdd6f19`, com D01/D04/D05 já integrados pelo PR #22. Este incremento continua o PR #23 e a issue #21, sem reaplicar alternativas locais. [Review original](REVIEW-004.md) e [resolução anterior](REVIEW-004-PARTIAL-RESOLUTION.md) permanecem históricos. Não conclui WP-00, WP-01, P01 de job/Snapshot, release ou suporte a providers reais.

## Correção D02 — validade de admissão não sobrevive automaticamente a uma espera

Captures.assertActive verifica o registro do token, identidade exata do objeto adquirido, contagem ativa, revogação e fechamento. Não incrementa contagens nem recria entradas. O handler revalida depois de terminar a leitura assíncrona do corpo e antes de seleção, auxiliar e encaminhamento. Esses passos intermediários são síncronos no processo; não há espera de LLM sob uma autorização não revalidada.

Nova entrada humana e início de compactação nativa revogam os tokens da sessão. Uma captura antiga continua pinada enquanto seu handler termina, mas não autoriza novos efeitos. Uma sessão não revoga a outra; admissão nova gera token novo. Callback posterior ao dispose não cria estado.

Dispose é idempotente, fecha as conexões próprias e aguarda também os handlers que ainda liam o corpo, além do executor/forwarder. A fixture só remove seu diretório após os handlers assentarem. Uma tentativa que não adquiriu captura não pode decrementar o contador de outra chamada no finally. O estado remoto de requests já enviados continua desconhecido; não há promessa de desfazer inferência remota.

## Correção D03 — invalidação persistida com continuidade explícita

Depois de validar a correspondência entre fonte pública e request, o handler confere a View atual contra as raízes. Uma cobertura stale cancela a proposta relacionada e retira os replacements na sonda. A retirada é conservadora de toda a View porque a sonda não possui o grafo de dependências seletivo do produto. Protocolos/formatos desconhecidos NÃO são aceitos por esse caminho; erros distintos de E_STALE_VIEW continuam sendo recusados sem descartar uma View válida.

O estado sem replacements é persistido e emite published-roots-invalidated. Editar/reverter/excluir a origem não ressuscita o resumo antigo depois do reinício. Alterar somente a cauda não invalida cobertura correta. Proposta ainda ready com cobertura alterada é encerrada como stale, não adotada nem reenviada indefinidamente.

Antes do despacho, a sonda verifica os bytes serializados do corpo selecionado. maximum_primary_bytes é uma configuração explícita de fixture entre 1 e 1 MiB, com default 1 MiB. Não é tokenizer, modelo real, autorização financeira ou novo limite de API. O excesso cancela manutenção, persiste hold={code,action,input_bytes,limit_bytes} e devolve E_INPUT_BUDGET, sem iniciar parent ou auxiliar. A invalidação não é revertida para conservar uma síntese obsoleta apenas porque o bruto não cabe.

O hold sobrevive ao restart e é reavaliado a cada entrada validada. A observação de uma base pública nova, pequena o suficiente, permite continuar e limpa o hold. Apenas o evento de compactação não incrementa epoch: continua necessária a base observada. O checkpoint é privado à fixture, não uma implementação SQLite/transacional. Seleção persistida e despacho continuam eventos diferentes; o orçamento completo antes de publicação CAS pertence ao núcleo futuro.

## Regressões antes e depois

Os seis testes do draft #23 foram executados sobre a main atualizada ANTES dos fixes: dois controles passaram e quatro assertions D02/D03 falharam. Não houve erro de setup, timeout ou atividade assíncrona após cleanup nessa execução.

Com os fixes: os seis passam. Foram acrescentados sete casos, totalizando **13/13**, sem skip/todo: escopo/revogação/novo token; proposta pending obsoleta; divergência de codec sem apagar View; exclusão da raiz; cauda intacta; bloqueio por orçamento sem novo auxiliar; dispose idempotente sem handles residuais.

A primeira execução após a alteração de dispose teve 4/6. Os dois erros restantes eram fetch failed ao reutilizar o pool global do cliente da fixture depois de fechar o servidor. A fixture agora usa uma conexão HTTP nova (agent:false) por chamada, como um processo de host reiniciado faria; não adiciona retry ou ignora erro. Todas as assertions originais de conteúdo/estado/status permanecem. As execuções depois disso passaram.

| Prova local | Resultado | Limite |
|---|---|---|
| Tooling fixado Node 22.17.1 / TypeScript 5.9.3 | Typecheck e 161/161 no núcleo | Não é execução do scheduler/ledger futuro. |
| Componentes anteriores | 12/12 | Transportes/codec sintéticos, sem inferência real. |
| Regressões D02/D03 | 13/13 | Gateway real e HTTP loopback; hooks controlados. |
| Testemunha independente de ingresso | 4/4 | Instrumentação dos testes, não serviço de produto. |
| Documentos, DDL/modelos e mutações documentais | Passaram | Não promovem automaticamente os 55 subcasos. |

A evidência de host/CI deve ser lida nos runs do commit final; não é herdada da base. Os workflows de núcleo nas duas versões, especificação, stock host, oito mutações e regressões deste PR permanecem gates obrigatórios de merge. A issue #21 só encerra depois de comparar a árvore integrada com a testada e conferir os logs.

## Comandos reproduzíveis

```sh
npm ci --ignore-scripts --no-audit --no-fund
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

Para a instalação stock e campanha de mutações, usar os comandos e checksums em [tests/conformance/opencode](../../tests/conformance/opencode/README.md), num diretório de fixture novo. Não usar configuração/credenciais/dados pessoais.

## Rastreabilidade e revisão do incremento

| Achado | Tratamento | Evidência |
|---|---|---|
| D01/D04/D05 | Preservados do PR #22 | Regressão core/testemunha/stock/mutações no commit final. |
| D02 | Ticket revalidado; native/user revogam; dispose aguarda leitura | Testes de barreira e isolamento; nenhuma saída upstream para o ticket revogado. |
| D03 | Estado invalidado e hold persistidos | Próxima chamada, restart, edit/revert/delete, cauda, erro de codec e nova base. |
| P01 | Continua #4 | Job/Snapshot/feedback não são implementados por esta correção de sonda. |

A revisão estática conferiu que o codec/oráculo/protocolos, a autenticação local, os oito mutantes existentes e as flags de modo completo não foram relaxados. Conferiu também isolamento entre erro de codec e stale, liberação de handles, nenhuma reexecução auxiliar no hold e preservação do histórico público. É revisão do autor, não auditoria independente. Dados e limites reais dos modelos não foram medidos.
