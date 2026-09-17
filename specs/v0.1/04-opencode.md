# SPEC-04 — binding OpenCode e gate de homologação

Normativo para o primeiro adaptador. **Estado: especificado para prova, não homologado.** Não há evidência de execução do plugin nesta entrega.

## 1. Perfil fixado

| Campo | Valor |
|---|---|
| host | OpenCode upstream, sem patch |
| release de referência | v1.18.31 |
| commit da release | a97622c801f4ca571530ddc51076af659a9c32cd |
| API de plugins | v1, `@opencode-ai/plugin`, objeto `server` ou função conforme contrato fixado |
| execução | processo local do plugin; usar dispose para cleanup |
| transporte inicial | HTTP com histórico explicitamente reenviado, sem continuação remota opaca |
| provider da prova offline | endpoint controlado compatível com a rota configurada, dados sintéticos, sem credenciais reais |
| provider live | rota já autorizada pelo usuário; registrar provider/modelo/variante/auth exatos antes de executar |
| excluído do primeiro perfil | WebSocket, tools executadas no provider, estado remoto não materializável, mudança de modelo durante job |

Release e código foram lidos estaticamente. `latest` nunca é dependência de teste nem substitui commit. A documentação v2 não é aplicada a este perfil. Um perfil v2 futuro exige versão/artefato próprios e novo relatório de conformance.

## 2. Mapeamento público v1

| Interface observada | Uso candidato | Condição de aceite |
|---|---|---|
| `PluginInput.client` | Ler mensagens, criar execução auxiliar por API autorizada do host. | SDK público fixado; não importar SessionPrompt ou banco interno. |
| `experimental.chat.messages.transform` | Observar/aplicar a visão antes da conversão do host. | Identidade unívoca por `info.sessionID`; hook não recebe sessionID em input. Não misturar sessões. |
| `experimental.chat.system.transform` | Preservar system e inserir apenas instruções/blocos com autoridade apropriada. | Mesmo sessionID/modelo; regras de composição sem timestamps variáveis. |
| `chat.params` | Observar parâmetros e opções permitidas; controlar afinidade quando suportada. | Não assumir conjunto final de tools/defaults a partir desse hook. |
| `tool.execute.before` | Guard de execução de qualquer tool local do maintainer. | Provar que cobre todas as rotas locais habilitadas, inclusive MCP; rejeitar antes do primeiro efeito. |
| `tool.execute.after` e eventos | Capturar resultados/mutações autorizados e invalidar fontes alteradas. | Não presumir acesso ao conteúdo anterior ao truncamento; ausência é explícita. |
| `experimental.session.compacting` | Reconhecer entrada na compactação nativa, cancelar job e preparar rebase. | Não substitui `ModelProposal` nem permite publicar antes da fronteira correta. |
| `experimental.compaction.autocontinue` | Observar fluxo após compactação, sem acionar a manutenção recursivamente. | Não depender de metadata interna marcada como instável. |
| `session.compacted`, updates/deletes | Fechar epoch e revalidar overlay antes de nova chamada. | Sequência real demonstrada no teste. |
| `dispose` | Cancelar auxiliares, liberar lease e fechar recursos. | Não perder visão persistida nem remover ledger. |
| `tool` | Registrar context_search/context_read desde a ativação. | Schemas estáveis, escopo derivado do host e limites do núcleo. |

O nome de uma interface no contrato público demonstra um ponto candidato, não que todos os efeitos necessários estejam disponíveis nele. Hooks de transformação são aguardados pelo host; por isso só trabalho local ocorre no hook de envio. `fork()` é disparado em uma Promise gerenciada fora do retorno do hook, com catch/finally e cancelamento em dispose.

## 3. Construção do snapshot e da visão

Toda invocação primary normaliza o array atual. Identificar escopo por sessão das mensagens e projeto/worktree da instância, validado contra a sessão por API pública. Array vazio, sessões misturadas ou IDs inconsistentes não usa “última sessão conhecida”; retornar E_SCOPE/E_CAPABILITY e não podar.

Correlacionar system/params ao mesmo turno é obrigatório. Se hooks não expuserem um identificador de request comum, o adaptador deve provar uma correlação segura no fluxo serializado daquela sessão; não usar uma variável global que seja sobrescrita por outra sessão. O relatório deve dizer quais campos são observados antes/depois dos outros plugins.

Mantém-se apenas uma identidade lógica do snapshot no núcleo. IDs nativos recriados no fork precisam de mapa explícito para as fontes do pai; não copiar mensagens como se fossem novos registros reais da sessão principal.

A síntese é uma mensagem sintética de contexto observacional, representada pelo adaptador com papel compatível de assistant/dado, não como nova instrução do usuário ou system. Os identificadores e metadados sintéticos são estáveis entre chamadas da mesma view. Ela é inserida apenas no array de saída, nunca gravada no transcript privado.

Sobreposições são reaplicadas a cada continuação/retry. Se o host já apresentar a síntese da mesma view, reconhecer seu identificador interno e não compactá-la uma segunda vez. Se a origem mudou, revalidar ou invalidar; não aplicar por semelhança textual.

## 4. Execução auxiliar: duas propriedades diferentes

O candidato inicial usa as APIs públicas de sessão/fork do host com um registro privado de jobs. Não criar um agente novo com system diferente apenas para chamar de clone. Contexto ativo e política de tools devem ser reproduzidos para a execução auxiliar, com a missão no final.

**Isolamento:** nenhum resultado de tool-call do maintainer chega a executor local. `tool.execute.before` deve bloquear todas as calls dessa sessão antes de efeitos; testes incluem ferramentas padrão, customizadas e MCP. Tools executadas pelo provider são excluídas do perfil porque guard local não impede efeitos remotos. Se o guard não cobrir a rota, esse caminho de fork é rejeitado.

**Fidelidade:** permissões `deny all` não servem como prova de prefixo igual. O código fixado filtra tools após avaliação de permissões. Remover tools altera o request. Copiar apenas mensagens legíveis ou params também não demonstra que system/tools/options finais são idênticos.

`prefix_fidelity=verified` exige comparação no limite de transporte em um ensaio autorizado: mesma sequência/cache-relevant settings até o ponto do fork, diferenças restritas à missão final e a campos de transporte explicitamente não semânticos. Tokens ou cabeçalhos de autenticação não são registrados. A identidade de conta/namespace deve ser a mesma autorizada. Cache hit é medido separadamente numa rota live.

Se não houver caminho público para obter snapshot fiel e impedir efeitos simultaneamente, parar neste gate. Não usar API privada, extrair token OAuth, alterar ferramenta compilada, editar transcript ou anunciar paridade fictícia. Pode-se propor uma nova integração pública/v2/gateway opt-in em ADR separado. O modo assistido é uma alternativa anunciada, não um substituto silencioso do produto completo.

## 5. G-OC-01 — protocolo de prova

Executar numa instalação isolada de OpenCode stock, configuração temporária, workspace sintético e recorder/provider de teste. Nenhum arquivo de projeto real ou prompt privado entra no teste.

| Passo | Ação | Oráculo |
|---|---|---|
| P01 | Carregar pacote de teste pelo mecanismo público. | Host/version/commit e plugin hash registrados; sem alteração no binário ou dependência de fork. |
| P02 | Abrir duas sessões concorrentes. | Frames/jobs/fontes distintos; nenhum dado da segunda na primeira. |
| P03 | Produzir uma troca real de tool e uma continuação. | Hook vê cada fronteira necessária; estrutura completa é preservada. |
| P04 | Capturar snapshot e disparar auxiliar com saída retardada pelo stub. | Pai avança sem aguardar auxiliar; no máximo um job ativo. |
| P05 | Stub devolve uma tool call ao auxiliar. | Contador de efeitos da tool permanece zero; nenhuma chamada externa por MCP; tentativa falha por E_TOOL. |
| P06 | Stub devolve proposta válida; pai já recebeu cauda nova. | Request seguinte contém síntese uma vez, cauda inteira e âncora literal. |
| P07 | Comparar requests no recorder. | Campos do prefixo iguais ou divergência precisamente identificada; não inferir pelo ID da sessão. |
| P08 | Acionar compactação nativa/manual enquanto há ready. | Ready não é aplicado sobre epoch diferente; cauda e âncoras preservadas. |
| P09 | Reiniciar plugin/processo, retry e pausá-lo. | Overlay reconstruído sem duplicação; nenhuma inferência órfã repetida. |
| P10 | Preparar desativação/handoff, remover plugin e continuar. | Sessão utilizável dentro do orçamento; sem reidratação automática explosiva. |

PASS requer P01–P06/P08–P10 e protocolo válido. P07 determina a garantia adicional de fidelidade/cache; caso a entrada fiel não esteja acessível, registrar limitação e não descrever execução como fork fiel. Para o perfil completo com kage bunshin, fidelidade do conteúdo ativo é obrigatória; cache hit não é. Depois, um ensaio live pequeno autorizado mede cached/uncached tokens e fidelidade do resumo. Não misturar resultados do stub com comportamento de modelo real.

O relatório de WP-00 deve conter versão, SDK lock, transporte, modelo/variante, auth type, ordem dos plugins, evidências dos passos e capabilities. Falha tem código, passo e efeito: `assisted` ou `unsupported`, sem calls pagas automáticas. G-OC-01 não é resolvido por “compilou”.

## 6. Coordenação nativa e desligamento

A transformação opera sobre história ativa que o host apresenta, não pressupõe acesso ao transcript infinito. Reset nativo requer notificação/captura de nova base; maps de cobertura anteriores deixam de valer. Não desativar a compactação nativa globalmente só para evitar conflito.

Pausar mantém os overlays e o ledger. Remover fisicamente plugin pode deixar o host com o transcript original; por isso existe `disable --prepare`, que verifica orçamento e prepara checkpoint/handoff por API pública quando necessário. Não pode certificar desativação segura se só conseguir editar um banco privado. Usuário removendo o pacote abruptamente recebe orientação documentada de recuperação nativa; a feature não promete executar código depois de removida.

## 7. Embalagem e portabilidade

Nomes de pacote ainda são provisórios; não há registro npm publicado. O adaptador exportará a forma pública da release-alvo; a instalação de ensaio usa diretório local/tarball, não workspace-linked internals. Schema de configuração do produto fica dentro de opções do plugin, sem inventar chaves nativas do OpenCode.

O núcleo usa apenas os contratos de SPEC-01. Gemini CLI é o segundo adaptador, cujo ensaio deve fixar versão e interfaces oficiais antes de código; não implementar cinco hosts por analogia. Claude Code/Codex/Antigravity ficam como alvos sem suporte anunciado até seus relatórios. MCP de recuperação não eleva capacidades de poda.

## 8. Fontes verificadas

- [Release v1.18.31](https://github.com/anomalyco/opencode/releases/tag/v1.18.31).
- [Contrato público v1 no commit fixado](https://github.com/anomalyco/opencode/blob/a97622c801f4ca571530ddc51076af659a9c32cd/packages/plugin/src/index.ts).
- [Montagem e filtro final do request](https://github.com/anomalyco/opencode/blob/a97622c801f4ca571530ddc51076af659a9c32cd/packages/opencode/src/session/llm/request.ts).
- [Compactação nativa v1, trecho lido](https://github.com/anomalyco/opencode/blob/a97622c801f4ca571530ddc51076af659a9c32cd/packages/opencode/src/session/compaction.ts#L380-L540).
- [Instalação/hooks v1](https://opencode.ai/docs/plugins/).
- [Documentação v2, mantida separada](https://opencode.ai/v2/docs/build/plugins).

Consulta em 2026-09-17. Nenhum teste de runtime foi executado para este binding na elaboração da especificação.
