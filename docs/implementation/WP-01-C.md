# WP-01/C — manifestos, propostas e captura final

**Base:** `485034956c98c6a02e09659aea0b86ba6dcaba3f`. Continuação da issue #4, especificação 0.1.2 e adendo [SPEC-10](../../specs/v0.1/10-context-contracts.md). Não reimplementa identidades/configuração nem promove a sonda a core completo.

## Entrega

Quatro módulos pequenos em `packages/core/src`: contract-data, manifest, proposal e frame. Dados do controle são copiados, validados e congelados; erros não ecoam fontes ou conteúdo sensível. Nenhum módulo inicia rede, escreve banco, executa ferramenta ou altera a configuração do host.

O manifesto distingue validação de schema de verificação de fontes. Binding, entidade/versionamento, autoridade, disponibilidade, bytes/ranges UTF-8 e hashes são conferidos por um resolver autorizado. Todos os recortes são verificados, não só aqueles citados depois. Locators são rótulos únicos, não paths. Uma referência meramente navegável não sustenta um Claim.

VerifiedManifest é um resultado imutável emitido pelo módulo; carregar seu JSON não restaura automaticamente a verificação. Deve-se resolver/verificar novamente. Hashes e marcadores locais detectam inconsistência/confusão, não autenticam código hostil no processo nem substituem a autorização do storage.

As propostas respeitam o finisher do transporte, o teto de bytes, schema fechado, limites por code point, total de claims e citações. Feedback aplicado só pode citar IDs entregues. Noop e replace vazio não são a mesma coisa; ninguém publica uma síntese só porque o JSON passou no parser. O resultado conserva binding e manifesto exatos; ganho/freshness/publicação transacional permanecem etapas posteriores.

A captura parcial tem identidade de sessão, WorkContext e mapa público de grupos. O sealer JSON confere esse mapa contra o registry e contra slices do corpo final. Não chama observe, não repara payload nem altera o registry em caso de erro. Configuração inclui o prefixo e todos os campos não históricos, mesmo desconhecidos; input_digest inclui também o envelope e RootRefs ordenadas.

A validação de dois formatos sintéticos (`messages` e `contents`) usa a MESMA implementação do núcleo, com layouts explícitos. Não é uma integração Gemini/Claude/OpenAI homologada. Layout/timing do hook real continuam sujeitos à prova do adaptador. O core não pode verificar retrospectivamente se o chamador realmente esperou todos os hooks do host.

## Limites fechados neste incremento

SPEC-10 documenta limites de arrays/bytes, reference_only com range vazio, storage como dono da associação registro/bytes de capítulos, sealer de JSON top-level, diferença entre hash canônico e cópia de dados, e necessidade de revalidar entidades revogadas antes de uma publicação futura. Não são novos serviços ou uma mudança de protocolo de inferência.

Tickets/handles usam WeakMap/WeakSet para reconhecimento local sem um Map global cumulativo. Bytes das fontes não ficam no handle. Referências fracas não são benchmark de RAM e não substituem a política de retenção das capturas vivas do adaptador.

## Rastreabilidade

| Subcaso | Estado | Fronteira da evidência |
|---|---|---|
| T06.contract | Implementado/testado neste componente | Manifest/Claim/ModelProposal, Capture/SealedFrame, fingerprint, imutabilidade e dados verificados. Não é final-veto de host instalado. |
| T30.contract | Implementado/testado | Dois layouts sintéticos distintos usam o mesmo sealer, sem imports de host. T30.portability permanece separado. |
| T02.contract | Parcela adicional exercitada | Capture, registry, fonte, manifesto e proposta não atravessam binding/incarnation/epoch. Associação completa de jobs/Snapshot ainda não entregue. |
| T37.contract | Parcela adicional exercitada | Schemas deste incremento, centenas de entradas inválidas e mutações de implementação. Não declara fuzz de schemas futuros ainda ausentes. |
| T07.contract, T15.contract, T33.capabilities | Regressão preservada | Identidades, configuração e capacidades anteriores continuam nos testes. |

WP-01 e WP-00 seguem abertos. `traceability.json.initial_status` continua o estado inicial do plano; este registro é a evidência incremental. Não se cria um PASS de scheduler/storage/host a partir do resultado destes componentes.

## Comandos

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check:core
npm run test:core
python3 scripts/check-spec.py
python3 scripts/check-reference-model.py
python3 scripts/test-spec-check.py
python3 scripts/check-canonical.py
python3 scripts/check-storage-contracts.py
node --test tests/conformance/opencode/test-components.mjs
```

Execução local no Node 22.17.1/macOS Intel: typecheck aprovado, **142/142 testes do núcleo** e **12/12 componentes da sonda** aprovados. São 108 testes anteriores e 34 novos, incluindo uma campanha negativa como um teste. Checks documentais, modelos de referência, mutações documentais, vetores canônicos e exemplos de storage também passaram.

Os testes importam módulos reais do núcleo. Os vetores de fontes usam SHA-256 independente sobre bytes, e as expectativas de escopo/índice/limites são explícitas. A campanha de mutações cria cópias descartáveis: um controle positivo e cinco versões incorretas (recorte não verificado, navegação usada como evidência, finisher ignorado, payload não verificado e metadata fora do fingerprint). Cada mutante precisa executar todos os 33 testes selecionados e falhar no teste nomeado correto; setup/timeout não é detecção.

Os 300 casos de proposta e 256 ranges inválidos são laços dentro de testes, não centenas de sessões de produto. O ensaio de 200 revisões verifica payloads efetivos com SourceRefs repetidas. Tipos readonly e distinção de Capture/SealedFrame/VerifiedManifest também são exigidos pelo compilador.

A primeira execução encontrou três falhas: a cópia via canonicalização convertia -0 em 0. O hash deve obedecer JCS, mas isso não autoriza alterar a cópia em memória. A implementação agora valida/canonicaliza para hash e copia os dados separadamente; os testes exatos foram preservados. A revisão ainda reforçou tipagem do material de referência e limites de tamanho do manifesto.

Os quatro workflows existentes permanecem requeridos antes do merge, inclusive regressão stock-host e campanha negativa. O resultado definitivo fica associado ao head efetivo do PR; nenhum resultado de host é presumido a partir do componente. Não houve chamadas live, credenciais ou pacote publicado.

## Revisão local e próximo corte

Conferidos: objetos falsamente marcados como verificados, troca de manifesto com índices iguais, referências de outra sessão, updates após selagem, cópias mutáveis, UTF-8 dividido, fontes vazias, campos desconhecidos, contagem total de claims, feedback não entregue e limite bruto de resposta. Ganho semântico e verdade de claims não são atribuídos à validação estrutural.

O próximo corte do WP-01 é fechar associação completa de Snapshot/job e fuzz transversal dos contratos restantes. Persistência, revalidação de revogação e publicação segura continuam nos pacotes próprios; não fazem parte de um atalho escondido neste PR.
