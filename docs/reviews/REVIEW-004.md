# REVIEW-004 — revisão adversarial da base integrada e das entregas locais

**Veredito: CHANGES REQUIRED.** Há progresso executável, mas a prova de integridade continua incompleta e duas transições reais da sonda ainda não têm comportamento correto. Não promover o conjunto a plugin distribuível, gate integral ou sessão confiável por longos períodos a partir dos testes atuais.

**Data:** 18/09/2026. **Base auditada:** `47f5de8230a4e8e7bc5db3087321bdb175b94412`, repositório `gmhelmold/context-continuity`. Inclui os contratos WP-01/A, B e C, a correção de snapshot `71ca263` e a sonda já corrigida pela REVIEW-003. Inventário na base: 84 arquivos rastreados. O relatório é do mesmo autor das entregas, não de um revisor independente.

**Esta entrega:** relatório, evidências e reprodução. Não aplica os patches locais, não modifica runtime/specs/testes de aceitação existentes e não fecha os achados. Os reviews e resultados históricos são preservados.

## 1. Conclusão executiva

A regressão normal passou novamente: **149/149 testes do núcleo, 12/12 componentes e 16/16 checks no OpenCode stock**. Isso confirma repetibilidade nas condições exercitadas; não prova ausência dos defeitos abaixo.

O experimento mais importante alterou uma instrução de sistema **antes de o próprio gateway gravar seu evento ingress**. O caso principal de preservação/fork continuou aprovado. O recorder independente recebeu 12 ocorrências da instrução alterada. A observação da entrada usada pelo oráculo vem do próprio componente sob teste; mudar antes desse ponto contamina tanto a execução quanto o esperado.

Outras execuções, usando os módulos reais da sonda com hooks controlados e HTTP loopback, demonstraram: cancelamento antes do despacho não impede o request antigo nem a criação de um auxiliar; correção de uma raiz já compactada deixa a visão antiga retida e as chamadas seguintes repetem E_STALE_VIEW.

A segunda representação sintética do núcleo separa functionCall e functionResponse em raízes diferentes, ambas completas e removíveis. Isso não é um bug demonstrado no Gemini; é um problema do exemplo positivo e da prova usada para preparar o segundo adaptador.

Há **cinco achados novos/acionáveis: um bloqueador de confiança nas provas, três de prioridade alta e um médio**. Separadamente, P01 registra o vínculo completo de job/Snapshot que já estava declarado como pendente. Não contamos essa pendência como defeito descoberto numa funcionalidade pronta.

## 2. Escopo e classificação das provas

Foram confrontados os módulos atuais de configuração/capacidades, identidade/raízes, canonicalização, manifesto/proposta/frame, a sonda completa e seu transporte, os oráculos/mutações, workflows, contratos normativos pertinentes, registro de requisitos e relatórios de implementação. O histórico foi tratado como proveniência, não como contrato vigente. O inventário de 84 arquivos não significa análise linha a linha de cada relatório histórico nem auditoria do binário inteiro do host.

Três entregas diferentes estavam sendo chamadas de WP-01/C: dois patches anexados à conversa, ambos baseados em `4850349`, e a implementação integrada na main. A revisão usa **a main como código canônico**, examina as alternativas separadamente e não soma suas contagens de testes.

Classes usadas:

- **Host stock:** binário oficial sem patch e provider sintético, em sessão criada pela própria fixture.
- **Componente real:** implementação importada diretamente, com entradas/hooks controlados; quando indicado, HTTP de verdade em loopback.
- **Contrato/estático:** consequência do código ou ambiguidade de responsabilidade, sem alegar que um produto futuro já executou esse caminho.
- **Não executado:** não recebe PASS por inferência de outra classe.

Nada nesta revisão testa capacidade semântica de um LLM, cache real, custo de inferência ou sessões de usuários.

## 3. Base reexecutada

| Verificação | Resultado nesta revisão | Limite |
|---|---|---|
| Tooling fixado | Node 22.17.1/macOS Intel; TypeScript 5.9.3 do lock; typecheck aprovado. | Node 24 não foi reexecutado localmente. |
| Núcleo | 149 pass, 0 fail, 0 skip/todo. | Inclui fixtures e campanhas internas, não 149 sessões. |
| Componentes da sonda | 12 pass, 0 fail. | Não é gate integral do host. |
| Documentos/DDL | 30 Markdown, 36 requisitos, 55 casos iniciais, oito pacotes; checks aprovados. | DDL/exemplos não implementam o storage. |
| Modelos/negativos offline | Dez modelos, dez mutações documentais, 12 vetores canônicos/5 rejeições e dois exemplos de storage aprovados. | Sem elevar modelos de referência a produto. |
| OpenCode 1.18.31 stock | Suíte inteira: 16 pass, 0 fail. | Provider sintético; não é piloto semântico. |
| Experimento D01 | **Um caso selecionado** passou com implementação incorreta; 12 ocorrências alteradas no endpoint. | Não foi executada a suíte inteira no mutante. |

Binário macOS x86_64 SHA-256: `9cd3d83bc230830846ef4b20088e5521364540cd681fdeeda1bab4119f9c37a8`. Foi reutilizado somente após verificar hash/versão; não foi modificado. HOME/XDG/workspace de teste são isolados, sem credenciais de provider. Os quatro workflows da base no GitHub também foram observados como success; essa observação é distinta das execuções locais acima.

Os hashes dos relatórios e fontes estão em [evidence/REVIEW-004.json](evidence/REVIEW-004.json). A [reprodução](REVIEW-004-REPRODUCTION.md) delimita o que foi feito e como repetir.

## 4. Índice dos achados

| ID | Prioridade | Natureza | Conclusão |
|---|---|---|---|
| D01 | Bloqueador de evidência | Mutação no host stock | O testemunho de entrada do oráculo ainda pertence ao componente sob teste. |
| D02 | Alta | Gateway real + HTTP + hooks controlados | Cancelamento após acquire e antes de dispatch não invalida a requisição em curso. |
| D03 | Alta | Gateway real + HTTP + hooks controlados | Fonte corrigida provoca recusa repetida, sem retirar/reconciliar a visão inválida. |
| D04 | Alta para a prova de protocolo | Fixture e sealer reais | O exemplo positivo contents marca call e result como grupos removíveis independentes. |
| D05 | Média | Sealer real + contrato | Identificação de modelo do frame pode divergir da mensagem final sem política explícita de aliases. |
| P01 | Pré-requisito já previsto | API executada; job futuro ausente | Manifesto/sessão não substituem vínculo a job/Snapshot/lote de feedback. |

Prioridades dizem respeito à evolução deste produto, não a incidentes de produção nem a uma campanha contra terceiros.

## 5. D01 — uma origem de comparação controlada pelo gateway não prova o ingresso original

**Locais na base:** `tests/conformance/opencode/gateway-plugin.mjs:92–101`; `run.py:164–185`, especialmente 183–184; `oracle.py:23–35`. A campanha anterior muta o resultado depois de `selected=...`.

O novo oráculo é independente do renderer como algoritmo. Ele também verifica outputs de ferramentas contra o histórico público. Isso corrigiu uma deficiência importante da REVIEW-003. Entretanto, o esperado completo da chamada — incluindo sistema e campos não históricos — é derivado de `emit('ingress', {body})`, executado dentro do gateway.

**Experimento executado:** numa cópia descartável, acrescentar ` REVIEW004_CHANGED_SYSTEM` ao conteúdo de cada mensagem system, imediatamente após o check do perfil e antes de ingress. Papéis, IDs e contagem continuam iguais. O corpo alterado é registrado como se fosse a entrada original, usado pelo pai e copiado pelo clone.

O caso `native-load-tool-loop-concurrent-pruning-and-prefix` passou **1/1**, com exit 0. A leitura do recorder externo confirmou **12 ocorrências alteradas**, contando reenvios e chamadas auxiliares. O controle sem mutação passou dentro da suíte completa de 16 checks.

**Interpretação:** a campanha atual demonstra detecção de alterações depois do tap, não integridade de toda a cadeia de entrada. Pai e clone podem continuar iguais porque ambos derivam da entrada já corrompida. O resultado não apaga as seis mutações anteriormente rejeitadas: ele estabelece o limite delas.

**Correção mínima:** registrar a requisição no lado de entrada por uma testemunha da fixture que não seja o código sujeito à mutação, além do recorder de saída. Alternativamente, usar um envelope de controle independente capaz de conferir todo o trecho protegido e os campos não históricos. Não substituir a solução por outra chamada a `emit` dentro do mesmo componente. Não é necessário um serviço novo de produto; trata-se de instrumentação independente do teste.

**Aceite:** controle positivo e mutação antes de ingress; a implementação errada falha por diferença exata de sistema/conteúdo, não timeout. Manter as mutações depois da projeção e ampliar a cobertura para cada request relevante, não apenas o último. Continuar confrontando identidades/outputs com a API pública. Documentar a fronteira efetivamente observada.

**Dono:** WP-00/WP-06; T06.host, T08.host, T29.host/T39.host. Bloqueia usar o verde atual como prova integral de preservação.

## 6. D02 — cancelar a sessão não revoga um handle já adquirido antes da leitura do corpo

**Locais:** `gateway-plugin.mjs:92–149,180`; `probe-captures.mjs`, acquire/clearSession/release.

O gateway adquire a captura e depois aguarda o corpo da requisição. Uma nova entrada humana cancela o job atual e marca tokens ativos como revogados. Porém, o handler já recebeu o objeto e não revalida sua geração/revogação ao sair do await.

**Experimento executado:** abrir uma requisição local válida e enviar somente o primeiro byte do corpo; observar o acquire; chamar o hook real `chat.message`; concluir o corpo antigo. A observação do acquire foi um wrapper de teste que chamou a função original e retornou o mesmo objeto, sem alterar a decisão.

Havia **zero requisições upstream no momento do cancelamento**. Depois dele, a resposta do gateway foi HTTP 200, o corpo antigo chegou ao endpoint e foi registrado um `aux-start` novo. Não estamos exigindo desfazer um request que já tinha sido enviado; o cancelamento ocorreu antes de qualquer envio.

**Impacto:** correção humana ou cancelamento não governa consistentemente a próxima geração durante esta janela. O limite de chamadas e o ledger futuro não consertam uma admissão que usa autoridade expirada.

**Correção mínima:** manter geração/revisão de admissão por sessão/captura; revalidar depois de leitura assíncrona e imediatamente antes de publicar visão, iniciar auxiliar ou despachar. Revogar uma captura deve impedir novos efeitos locais mesmo quando o objeto já foi entregue. Não basta impedir um segundo acquire. O que foi despachado antes do cancelamento segue contabilizado como operação já iniciada.

**Aceite:** barreira determinística entre acquire/leitura final, cancelamento, zero upstream e zero auxiliar para aquela captura. Controle sem cancelamento deve avançar. Repetir com nova entrada, compactação nativa e dispose, sem reutilizar uma autoridade antiga. Nenhuma ferramenta ou geração extra para recuperar o estado.

**Dono:** WP-00/WP-03/WP-06; T04.scheduler, T18.host, T39.host/T40.host. É falha de transição da sonda, não prova de um bug equivalente no núcleo ainda inexistente.

## 7. D03 — a recusa de uma visão stale não possui desfecho utilizável

**Locais:** `gateway-plugin.mjs:118–133`; `probe-protocol.mjs:55–68`.

A revisão anterior corrigiu alteração de configuração: um system novo invalida a visão. Alteração do conteúdo de uma raiz coberta é outro caso. O renderer detecta a divergência corretamente, mas o gateway conserva o replacement inválido no estado persistido.

**Experimento executado:** publicar um resumo; alterar uma mensagem coberta tanto na captura nativa quanto no corpo final; chamar o hook de nova entrada e enviar duas chamadas. Ambas retornaram HTTP 400 com `E_STALE_VIEW`. O checkpoint continuou contendo um replacement.

**Interpretação:** o código falha fechado em vez de enviar conteúdo inconsistente — aspecto positivo. O defeito é a falta de reconciliação/estado de saída: repetir uma chamada útil reencontra o mesmo plano envenenado. Não é uma afirmação de trava irrecuperável sob qualquer intervenção; reset nativo ou ação explícita podem mudar a base. Esse caso já constava como pendente no gate e agora tem reprodução concreta.

**Correção mínima:** ao detectar raiz alterada, invalidar os derivados afetados e publicar estado que permita recuperação definida. Restaurar raízes atuais somente após conferir integridade e orçamento; se não couber, transitar a hold/rebase explícito e observável. Não engolir E_STALE_VIEW e seguir com dados falsos, nem descartá-lo sem mudar o estado causador.

**Aceite:** a próxima chamada válida usa a visão reconciliada ou recebe um diagnóstico de hold com ação de saída real. Repetir após reinício, edit/revert da origem e expansão acima do orçamento. A prova deve inspecionar o request e o checkpoint, não apenas esperar ausência de resumo.

**Dono:** WP-00/WP-04/WP-06; T11.dependencies, T10.host/T12.host. Não reabre automaticamente o escopo já encerrado de C03: mudança de system e mudança de raiz são transições diferentes.

## 8. D04 — o segundo formato positivo não respeita a unidade atômica que queremos podar

**Locais:** `tests/core/context-fixtures.mjs`, frameFixture('contents'); `frame.ts`, loop de grupos; `frame.test.mjs`, casos T30.contract.

A fixture contents cria três raízes: texto do usuário, functionCall e functionResponse. As duas últimas recebem protocol_group distintos, completed=true e protected=false. O sealer aceita a partição porque ela coincide com o registry e com os slices declarados.

**Execução observada:** as raízes de chamada e resultado foram devolvidas separadamente, sem proteção, nos grupos group-1 e group-2. Essa aceitação não prova que o sealer deva conhecer todos os protocolos. Ela demonstra que o exemplo positivo fornece premissas incompatíveis com o contrato de grupos indivisíveis de SPEC-01/02.

**Impacto:** um seletor genérico futuro pode confiar nessas flags e escolher apenas uma metade. O teste vendido como segundo formato não exercita a obrigação que impede isso. Não foi executada uma poda de Gemini nem uma chamada a um provider real.

**Correção mínima:** definir no perfil o responsável pela validação de protocolo e fornecer ao núcleo grupos fechados de call/result ou grupos inteiramente protegidos. Corrigir a fixture positiva para uma unidade válida e acrescentar a partição inválida como caso negativo do codec/contrato. Não tornar o sealer genérico um parser universal de providers.

**Aceite:** duas representações preservam a mesma relação de protocolo; nenhum intervalo elegível contém só call ou só result. Incluir múltiplas calls, resultados em ordem permitida pelo perfil e grupo incompleto. A classificação de completed/protected não pode se sustentar apenas por um booleano conveniente da fixture.

**Dono:** WP-01/WP-04/WP-06; T30.contract, T09.projection. Alta prioridade para a força da prova de portabilidade, não alegação de homologação de Gemini já existente.

## 9. D05 — modelo declarado e modelo do corpo podem divergir no frame emitido

**Locais:** `frame.ts:66–103`; `frame.test.mjs`, mudança de campos não históricos.

O layout fornece model_id e o corpo pode conter outro identificador. Na execução adicional, o corpo usou `actual-new-model`, mas o frame emitido conservou `model_id='test-model'`. Não houve erro; ambos os valores participaram de hashes. Um teste existente também muda o campo model sem atualizar o layout e exige apenas que config_digest mude.

**Interpretação:** o hash não perdeu a alteração. O problema é deixar indefinida a autoridade desses identificadores para seleção de limites, perfil, variantes e accounting. Alguns providers possuem aliases legítimos; exigir igualdade textual universal também seria incorreto.

**Correção mínima:** fechar a relação entre identidade resolvida do perfil e identidade serializada do request. O codec deve derivar ou verificar o valor usando um mapeamento explícito/versionado de aliases, e validar rota/variante pertinente. Caso o campo seja só um rótulo diagnóstico, nomeá-lo como tal e proibir que governe orçamento/compatibilidade. Sem adivinhação a partir de nomes comerciais.

**Aceite:** mudança de modelo com layout antigo é recusada ou produz identidade resolvida consistente. Alias permitido tem caso positivo; alias ausente/ambíguo tem caso negativo. A escolha de limites deve usar o mesmo perfil que valida o corpo.

**Dono:** WP-01/WP-06; T06.contract, T33.host/T39.host. Nenhuma chamada com modelo incorreto ou violação de orçamento foi executada nesta revisão; a consequência é risco de integração futura.

## 10. P01 — manifesto verificado ainda não é contexto fechado de um job

Este ponto **já está declarado como restante do WP-01**. É registrado como condição para avançar, não como sexto defeito novo de um scheduler pronto.

`ValidatedProposal` guarda binding, manifest_id/digest e proposal/digest. Não guarda job_id, snapshot/frame ou identidade do lote de feedback. `decodeProposal` verifica feedback contra o array recebido naquela chamada e depois não conserva esse array. `assertProposalContext` confere binding e manifesto, apenas.

Na execução, uma proposta declarava feedback A. Reutilizando o mesmo VerifiedManifest, a asserção continuou aceitando-a; ela não recebe a expectativa de um novo job com feedback B. O exemplo não despacha jobs inexistentes. Ele demonstra que não devemos usar essa asserção como cheque de contexto completo.

Antes de implementar o executor/publicador, persistir uma associação imutável a job/Snapshot, manifesto, frame/config e lote de feedback entregue, com regra de retry no mesmo job e rejeição de outro job. Pode ser um wrapper do scheduler: não exige transformar o parser puro em controlador de execução. O limite deve ficar visível na API e nos testes. Identidade de manifesto não é prova de identidade de geração.

**Dono já existente:** WP-01/issue #4 e contrato de admissão WP-03. A pendência continua aberta; não fechar T02/T37 completos por 149 testes de outros contratos.

## 11. Reconciliação das alternativas locais

| Artefato anterior | Base | API principal | Limites declarados | Estado nesta revisão |
|---|---|---|---|---|
| `context-continuity-wp01-c.patch` | 4850349 | verifyManifestContent + ProposalValidator por job | 4.096 entradas, 1 MiB de manifesto | Alternativa histórica não integrada; não reaplicar. |
| `context-continuity-wp01c.patch` | 4850349 | prepareManifest + validateProposal com expectativa de feedback | 1.024 entradas, 256 KiB; locator por code point | Alternativa histórica não integrada; não reaplicar. |
| main 47f5de8 | 4850349 + commits integrados | verifyManifest/decodeProposal + Capture/SealedFrame | SPEC-10; inclui correção de snapshot repetido | Fonte de implementação auditada. |

Hashes SHA-256 dos patches locais: A `3ad9eff3bc60191b68b76a7252e7b8018bc3797c48da5133ed466da3c8077cc6`; B `0c3d086cfae5e28ae461f83eda6dc9ee2300c7a4d4d367f4ba5d15f29ddea0f6`.

Eles alteram caminhos sobrepostos; não são duas parcelas aplicáveis em sequência. A soma 44+76+149 não significa cobertura acumulada do produto. Seus relatórios foram explícitos sobre testes isolados, versões locais diferentes e ausência de publicação. Mesmo assim, duas entregas concorrentes exigem disposição inequívoca para não produzir uma quarta implementação por acidente. Esta tabela documenta a decisão: preservar como origem e usar a main, não os patches, como próximo ponto de trabalho.

As alternativas não foram homologadas nesta rodada nem incorporadas por parecerem possuir um teste a mais. O review delas foi comparativo/estático; os testes novos acima executaram a base integrada.

## 12. O que não virou achado

- A correção de resolução única de EntityRef e os sete testes de snapshot já estão na main. Não reportamos como novo o defeito corrigido em 71ca263.
- Falta de ledger/scheduler/driver ainda é trabalho planejado explicitamente, não dívida oculta descoberta num produto pronto.
- A expiração de nota **não** invalida semanticamente um capítulo segundo SPEC-05 §4: o contrato faz a distinção. A hipótese contrária foi descartada na leitura cruzada.
- As seis mutações pós-projeção da REVIEW-003 são úteis; D01 mostra uma fronteira de observação adicional, não que todas as provas sejam inúteis.
- A selagem genérica não é obrigada a adivinhar o protocolo de cada provider. D04 pede que a fixture e a responsabilidade do adaptador cumpram o contrato, não uma camada universal de parsing.
- Checksums/WeakSets não autenticam código hostil no processo; esse limite já estava documentado. Não contabilizamos ausência de sandbox como vulnerabilidade do design.

Uma precisão textual para a especificação futura: consolidar S1 em S2 não deve invalidar S2 apenas porque S1 saiu da View; corrigir o conteúdo de S1 pode invalidá-lo. SPEC-07 usa a expressão ampla “supersessão normal”, enquanto a sequência de consolidação exige preservar o descendente. Fechar essa distinção ao implementar as transições, aproveitando a distinção já existente para expiração, sem transformar esta observação estática em falha executada.

## 13. Ordem de correção e saída do review

1. **D01/D04:** fortalecer a origem independente do oráculo e consertar a premissa do segundo formato. Precisamos de provas capazes de refutar um código errado.
2. **D02/D03:** fechar cancelamento pré-despacho e recuperação de raiz stale, com a próxima chamada útil e seu estado persistido no oráculo.
3. **D05/P01:** definir modelo resolvido e contexto imutável de job antes da admissão/publicação. Não acumular mais sondas paralelas para adiar esses contratos.

Cada correção deve ter teste que falhe antes e passe depois pelo motivo adequado. Teste agregado não fecha automaticamente cada requisito. Não ampliar timeouts, remover checks ou marcar refs ausentes como verificadas para recuperar verde.

Critério de saída: os cinco achados têm resolução rastreável; o critério P01 permanece vinculado ao trabalho de job/Snapshot, sem afirmação prematura de conclusão. Os oráculos detectam a nova mutação; callbacks revogados não iniciam efeitos; um plano stale tem saída explícita; grupos/identidades são consistentes. Gate completo e release continuam sujeitos aos critérios originais.

## 14. Limites e higiene desta execução

A revisão foi feita num clone dedicado, fixado por SHA; os arquivos de runtime da base permaneceram intactos. Mutação foi feita numa cópia descartável e não foi publicada como implementação. Os testes encerraram apenas seus próprios processos/servidores. Não alteramos configurações pessoais nem acessamos credenciais de inferência.

O primeiro script auxiliar desta revisão tinha uma chave de fechamento faltante e falhou ao compilar; foi corrigido antes das observações. Essa falha do script não foi atribuída ao produto. Uma tentativa de imprimir workflows usou expansão inadequada do shell e foi repetida pela ferramenta de leitura; também não é resultado de teste.

Os resultados são os das execuções concluídas. A proposta de review pode ter seus próprios CIs, mas verde documental não corrige D01–D05. Nenhum fix de runtime, release, modelo live, medição de cache ou encerramento de WP foi feito nesta entrega.
