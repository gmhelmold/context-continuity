# SPEC-04 — perfis OpenCode e fronteira terminal

Normativo 0.1.1. **Não implementado/não homologado.** [ADR-001](../../docs/decisions/ADR-001-terminal-boundary.md) substitui o uso do runner de sessão como clone e o hook precoce como publicação final.

## 1. Dois perfis, sem equivalência fictícia

Host fixado: OpenCode upstream v1.18.31, commit `a97622c801f4ca571530ddc51076af659a9c32cd`; SDK/plugin v1 fixados no lock do ensaio. Não usar docs v2 como contrato v1.

| Perfil | Captura/aplicação | Execução auxiliar | Estado nesta revisão |
|---|---|---|---|
| OC-V1-NATIVE | hooks públicos parciais | não selecionada para complete | complete não habilitável pelos contratos escolhidos; assisted a testar |
| OC-V1-HTTP-LOCAL | plugin + rota loopback opt-in após serialização | cliente HTTP do produto, same-envelope | alvo de G-OC-01; todos os testes runtime not_run |

Primeira rota de ensaio: HTTP JSON Chat Completions com histórico explicitamente reenviado, SSE/texto e function tools locais. Provider controlado em workspace sintético. API key live somente por conexão explicitamente autorizada, sem leitura de auth.json/OAuth do host. Responses/WebSocket, continuação remota, tools executadas pelo provider e payloads opacos sem codec estão fora deste perfil; precisam perfil distinto antes de ativar. Não afirmar suporte aos flagships citados somente porque o protocolo é compatível.

## 2. Ordem real de callbacks

1. `experimental.chat.messages.transform`: ler IDs/fontes, registrar Capture parcial por sessão; NÃO aplicar resumo, NÃO publicar e NÃO iniciar fork com metadados de turno anterior.
2. `experimental.chat.system.transform` e `chat.params`: registrar observações para diagnóstico e policy-revision; não se apresentar como request final.
3. `chat.headers`: correlacionar o turno serializado por sessão; inserir somente header local `x-cc-capture` com token aleatório ligado à Capture e ao perfil. Não incluir marcador no corpo histórico. Não usar uma variável global lastSession. Token fica na memória do processo e é retirado antes de encaminhar upstream.
4. O host termina lowering/defaults/tool filtering e envia ao baseURL local. O handler recebe o corpo final; valida token, sessão/incarnation, tamanho, modelo/rota e tipo. Sem Capture inequívoca, recusar a transformação; nenhuma chave de outra sessão autoriza forward.
5. `seal`: produzir raízes e hashes do corpo final, seguindo codec fixado. `core.finalize`: reconstruir View atual, considerar ready somente agora, validar policy/fence/cobertura/config atuais, publicar e selecionar envelope. O fork, quando disparado, parte do envelope EFETIVO selecionado, não do request bruto anterior ao overlay.
6. Após seal/publicação, encaminhar os mesmos bytes validados. Não há outro plugin do host entre esse ponto e nosso forward. Middleware do produto não modifica body depois de validado. Se mudar qualquer byte relevante antes do despacho, abandonar autorização e refazer finalização.
7. Associar streaming/resposta a emission_id; sucesso de commit não vira acknowledged. Request repetido pelo host recebe attempt de transporte distinto; reproduz overlay declarativo e não cria novo capítulo para o mesmo job.

Nenhum hook espera o HTTP handler: todos retornam depois de trabalho local. O fluxo normal do pai não aguarda o clone. Mudança de user input ou política durante a validação local força nova revisão/rejeição, nunca deadlock esperando callback posterior. Title/compaction/other são correlacionados como tipos separados; jamais despertam manutenção nem usam patch primary inadvertidamente.

## 3. Codec e identidade

O perfil fixa versão de codec independente do núcleo. O mapa une IDs públicos de mensagens/partes a segmentos do corpo Chat Completions FINAL, em ordem e por correspondência estrutural exata. Traduzir somente variantes conhecidas de text, assistant function calls e tool results; preservar integralmente outros campos. Calls/results são um grupo indivisível. Itens de system/env são protegidos e identificados por campo/ocorrência+digest.

Para texto repetido, usar a ordem e IDs públicos do sidecar, não busca por similaridade. Se lowering fundir mensagens, agrupá-las numa raiz com a lista ordenada de IDs de origem; não dividir o container serializado entre dois replacements. Toda parte do corpo precisa estar coberta por raiz conhecida ou componente protegido; se não houver correspondência única, E_CAPABILITY antes de poda. Campos novos não viram string vazia.

Mudança no payload mantendo IDs muda unit_digest; inserts/deletes não renumeram IDs persistidos. Retomada após restart usa mapa de fontes no ledger e uma nova Capture do host. Corpo e configuração são comparados exatamente até a missão no fork; transforms ocorridos ANTES do gateway são visíveis nessa comparação. Ordem de plugins é registrada, mas o produto não presume que só plugins conhecidos alterarão mensagens.

## 4. Execução auxiliar sem sessão de host

O kage bunshin é um fork lógico da entrada efetiva, não necessariamente POST /session/fork. Copiar body final do pai e append da missão como última mensagem user; manter modelo, tools, parâmetros e blocos relevantes. Endpoint stateless com credencial da mesma conexão autorizada. Não mudar toolChoice/system/response_format para forçar JSON; geração que retorna tools termina E_TOOL sem despacho. Configuração `tool_choice=required` incompatível fica inelegível para este perfil antes de gastar.

Cliente auxiliar próprio usa uma única requisição HTTP por AttemptPermit; SDK retry desligado, redirects recusados e sem ferramentas/continuações automáticas. Resultados de tools são apenas dados históricos no body. Há no máximo duas requisições auxiliares por job, admitidas pelo núcleo, inclusive reparo. Nenhuma chamada ao session runner, title generator ou session fork é permitida nessa rota.

Persistir `{job_id, run_id, attempt_no, incarnation, fence, dispatch_state, request_id|null}` antes do dispatch. Não persistir auth/body handle. Cancelar: gravar cancellation fence/terminal state; abortar conexão local; aguardar encerramento do stream/reader por até 2s; registrar `local_stopped` e `remote_state`. Sem confirmação remota, remote_state=unknown e reserva permanece conservadora. Remover handles de memória só depois de encerrar transporte local. Crash destrói cliente local, não prova estorno remoto; não repetir aquela tentativa ao reabrir. Não existem sessões auxiliares persistidas no host a limpar neste perfil.

Perda de fence/pause/delete/dispose não permite chamadas posteriores. Após abort local não confirmado, manter runtime slot em quarantine até confirmar fechamento, sem novo fork concorrente. Esse estado é distinto do job sem autoridade de publicar. Nenhuma aplicação tardia é aceita mesmo que o provider termine a geração.

## 5. Loopback sem servidor público ou segredos no ledger

Módulo local gerenciado pelo plugin, bind somente 127.0.0.1 (IPv6 loopback em perfil separado), porta explicitamente configurada/diagnosticada; não escolher endpoint externo por conteúdo de prompt. Rota upstream fixa em configuração autorizada, HTTPS, sem redirects; exceção HTTP só para fixture loopback. Não oferecer proxy genérico nem parâmetro URL nas tools.

Autorização local por segredo aleatório da instalação + capture token por chamada; arquivos do segredo fora do repo com permissão privada. Retirar esses headers antes do upstream. Credencial upstream pertence à conexão do produto, carregada por referência de ambiente fornecida pelo usuário e somente em memória. Instalação não copia tokens da assinatura/arquivos do host. Payloads e headers secretos não vão para logs/artefatos.

Limite do corpo local 32 MiB inicial, timeout de leitura 30s; headers de host/origin e token são validados antes de parse. Nunca encaminhar corpo incompleto. Configurar baseURL usa interface pública do provider e exige consentimento; registrar backup somente de configuração sem segredos e instrução de rollback. O plugin não substitui rotas existentes silenciosamente. O servidor não inicializa inferência por conta própria.

## 6. Reset, retries do pai e desativação

Hook nativo `experimental.session.compacting` cancela ready e marca reset_pending. No request kind=native_compaction, registrar contexto que o host pretende resumir. Quando compatível, a rota pode fornecer a View compactada observada como dados, sem aplicar uma nova manutenção concorrente. Resultado só cria nova host_epoch ao observar base de contexto nova por API pública. Falha nativa não é sucesso. Se reset não puder ser identificado sem ambiguidades, complete falha no gate.

Retries que o host faz para o PAI continuam pertencendo ao host e são observados por attempt/emission. O limite de duas chamadas é de geração AUXILIAR, não uma promessa de alterar retries do pai. Reusar capture token num retry só é permitido para mesmo corpo inicial/sessão; corpo diferente exige novo capture e invalida associação antiga. Política atual sempre revalidada antes de forwarding. Requests já enviados não são reescritos retroativamente.

`disable --prepare`: pausar/cancelar auxiliares; manter endpoint vivo; realizar handoff/checkpoint via API pública do host se necessário; validar input que será usado sem overlays; confirmar persistência desse checkpoint; restaurar baseURL original configurado pelo usuário; testar acesso sem passar por rota CC; só então liberar listener/recursos. Qualquer falha retorna E_CAPABILITY/E_BUDGET e mantém serviço em modo pausado, não quebra a conexão no meio. Handoff por escrita de DB privado proibido. Remoção abrupta exige restauração documentada do baseURL e compactação nativa; não alegar executar cleanup depois de desinstalado.

## 7. G-OC-01 — investigação e liberação separadas

| Passo | Prova obrigatória |
|---|---|
| P01 | Instalação stock + plugin/tarball/SDK/codec/rota fixados e host sem patch. |
| P02 | Duas sessões intercaladas: zero associação cruzada, headers locais não saem upstream. |
| P03 | Turno real com tool e continuação; Capture parcial não pode publicar. |
| P04 | Endpoint retarda clone; pai progride dentro do orçamento; um run por sessão. |
| P05 | Saída tool_call do clone: contador local/MCP zero, E_TOOL, sem sessão auxiliar no host. |
| P06 | Snapshot antigo + cauda nova + múltiplas consolidações: sequência final exata. |
| P07 | Recorder mostra prefixo/config reais idênticos pai/fork; cache não inferido do fixture. |
| P08 | Reset nativo/manual bem-sucedido e falho: nenhuma aplicação em epoch errada. |
| P09 | Reinício/cancelamento/perda de conexão: ausência de retry órfão; stopped/unknown corretos. |
| P10 | Handoff + restauração da rota + remoção: próxima sessão/chamada válida sem CC. |
| P11 | Sequência de 429/5xx/reparo: endpoint vê ≤2 requests auxiliares; pai contado separadamente. |
| P12 | Alterar system/tools/variante DESTE turno e plugin posterior: seal detecta, snapshot stale não sai. |
| P13 | Corpo/token/modelo inesperado é recusado, sem forward/autoescolha de URL ou segredo nos logs. |
| P14 | Upgrade/codec/route mismatch: complete fica inativo até homologação; sem downgrade oculto. |

PASS do produto completo exige TODOS P01–P14 + conjunção de SPEC-01. Investigação terminada com falha é somente investigation=complete. P07 unknown/different reprova complete mesmo com cache hit. Todos estão not_run nesta revisão; nenhum teste do modelo de referência os substitui.

## 8. Portabilidade e fontes

O núcleo não importa tipos/banco de OpenCode nem exige HTTP loopback. Outros hosts podem entregar SealedFrame por hook terminal público e usar o mesmo executor/projeção. Não implementar Gemini/Claude/Codex/Antigravity por analogia a estes hooks; perfis têm seus gates.

Evidência estática do perfil v1: [plugin interface](https://github.com/anomalyco/opencode/blob/a97622c801f4ca571530ddc51076af659a9c32cd/packages/plugin/src/index.ts), [request](https://github.com/anomalyco/opencode/blob/a97622c801f4ca571530ddc51076af659a9c32cd/packages/opencode/src/session/llm/request.ts), [processor](https://github.com/anomalyco/opencode/blob/a97622c801f4ca571530ddc51076af659a9c32cd/packages/opencode/src/session/processor.ts), [retry](https://github.com/anomalyco/opencode/blob/a97622c801f4ca571530ddc51076af659a9c32cd/packages/opencode/src/session/retry.ts). Configuração pública: [providers/baseURL](https://opencode.ai/docs/providers). Essas leituras sustentam a decisão, não comprovam implementação do gateway.
