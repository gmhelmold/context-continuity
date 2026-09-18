# ADR-001 — fronteira terminal e executor próprio

Estado: decisão de especificação 0.1.1, ainda não implementada/homologada. Responde B01/B07/B08/B09.

## Evidência

No OpenCode v1.18.31 (`a97622c801f4ca571530ddc51076af659a9c32cd`), `experimental.chat.messages.transform` antecede composição de system e lowering. `session/llm/request.ts` resolve ferramentas depois de params/headers. `session/processor.ts` utiliza `SessionRetry.policy`; `session/retry.ts` fixa cinco retries. Portanto o hook precoce não é captura terminal, e uma chamada de sessão não equivale a uma chamada física.

- [Ordem do prompt](https://github.com/anomalyco/opencode/blob/a97622c801f4ca571530ddc51076af659a9c32cd/packages/opencode/src/session/prompt.ts)
- [Preparação final](https://github.com/anomalyco/opencode/blob/a97622c801f4ca571530ddc51076af659a9c32cd/packages/opencode/src/session/llm/request.ts)
- [Retry do host](https://github.com/anomalyco/opencode/blob/a97622c801f4ca571530ddc51076af659a9c32cd/packages/opencode/src/session/retry.ts)
- [Configuração pública de baseURL e provider](https://opencode.ai/docs/providers)

O suporte público a baseURL foi reconferido em 17/09/2026. Isso demonstra a configuração de rota, não homologação de nosso transporte.

## Decisão

O perfil **OC-V1-NATIVE** permanece alvo de leitura/injeção, sem prometer complete: os hooks isolados não oferecem a fronteira final exigida pelo contrato selecionado. O fork via runner de sessão NÃO é o executor do primeiro modo completo. Não contornar essas ausências com banco/transcript privado.

Selecionar para a primeira prova de modo completo **OC-V1-HTTP-LOCAL**: o mesmo plugin nativo, mais uma rota HTTP loopback explicitamente configurada por baseURL. O módulo local pertence ao pacote e processo do plugin, sem cloud, daemon obrigatório ou patch no host. Captura final e overlay ocorrem no request já serializado. Executor auxiliar copia a entrada efetiva do pai, acrescenta a missão e faz HTTP pelo cliente do produto, sem tool dispatch, retry interno ou criação de sessão do host.

Isto é uma mudança explícita da estratégia do primeiro perfil: o gateway não é obrigatório para o núcleo nem para todos os harnesses, mas o modo completo desse perfil v1 exige optar por essa rota. Instalação puramente por hooks não é anunciada como equivalente. Não prometer que uma assinatura OAuth passa a ser utilizável nessa rota; o primeiro perfil usa API key explicitamente fornecida à conexão do produto ou endpoint sintético sem credencial live.

Perfis futuros com interceptação terminal pública podem eliminar o loopback sem mudar núcleo/projeção/executor. Não migrar silenciosamente para v2, nem afirmar agora que um perfil v2 foi homologado.

## Consequências e gate

A conveniência de uso stock é preservada, mas há uma configuração de rota adicional e um servidor local a testar. O ciclo completo e o desligamento devem provar restauração da rota original. Se a conexão/modelo não suporta o protocolo escolhido, não ativar complete; não converter para um modelo menor escondido.

SPEC-04 fixa escopo, correlação, codec e provas P01–P14. Investigação negativa é resultado válido; não é release. Nenhuma chamada paga, servidor local ou mudança de configuração pessoal foi realizada para elaborar este ADR.
