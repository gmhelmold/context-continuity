# WP-01/B — identidades, hashes e catálogo de raízes

**Base:** `12d8f12b1f8b08702a683900676b6d7aa1a34714`. Implementação incremental da issue #4 sobre a especificação 0.1.2. Continua [WP-01/A](WP-01-A.md), sem reaplicar o bundle de correções nem alterar os reviews históricos.

## Entrega executável

`packages/core/src/identity.ts` implementa Scope, WorkContext, SessionBinding, SourceRef/RootRef (em roots.ts), ToolExecutionRef e hashes distintos de fonte/payload. `roots.ts` implementa RootIdentityRegistry: identidade estável, revisão monotônica, proteção de grupo incompleto/sem referência, associação inequívoca e exportação imutável. Nenhum módulo importa internals de harness, acessa DB de usuário ou executa rede.

A canonicalização foi promovida de helper para `packages/core/src/canonical.mjs`, com tipos JSDoc verificados por TypeScript. A CLI antiga é apenas uma fachada para o mesmo serializador; não há segunda implementação. Os vetores fixos de RFC 8785 continuam iguais. Arrays com accessor, propriedade invisível, símbolo ou buraco são recusados antes de ler valores. O runtime não chama toJSON/iteradores de objetos recebidos. Isso não é um sandbox para objetos Proxy ou código hostil executado no mesmo processo; entradas do controle são dados JSON.

`@types/node` 22.17.1 foi fixado como dependência de desenvolvimento. UUID e SHA-256 usam node:crypto; não foi escrito um algoritmo criptográfico próprio. A biblioteca de tipos inclui ES2024 para isWellFormed, já executado no Node 22.17.1. Não há nova dependência de runtime ou release de pacote.

## Contrato deste componente

- Scope tem installation_id/workspace_id em UUID canônico minúsculo; adapter_id/host_session_id são identificadores opacos de 1..512 bytes UTF-8. Não há trim, normalização Unicode ou ordem inferida do texto.
- SessionBinding inclui schema_version, session_key, scope, incarnation e host_epoch. Incarnation/epoch são fornecidos explicitamente pelo ciclo de vida autorizado; o componente não decide reativação, reset ou tombstone. Importação/lookup com outra binding falha E_SCOPE.
- Source hash usa bytes originais, sem canonicalização. Payload hash cobre todos os campos JSON, incluindo papel e metadata. Unit hash segue exatamente a fórmula de SPEC-01. Nenhum hash comprova autenticidade ou autorização.
- RootIdentityRegistry mantém uma entrada atual por native_identity, sem acumular snapshots completos de payload. Native_refs não podem pertencer a duas raízes diferentes na mesma binding. A lista exportada usa ordem de descoberta, não cronologia; o adaptador é responsável pela ordem pública de cada frame.
- Mudança material sob o mesmo ID conserva unit_id, incrementa revision e atualiza digest. Reversão de conteúdo também incrementa, não revive a revisão antiga. Só mudar payload_ref/estimated_tokens altera metadata, sem invalidar conteúdo idêntico; esse comportamento é intencional porque os campos não fazem parte de unit_digest.
- Um grupo incompleto ou sem SourceRefs fica protegido. SourceRefs existentes ainda precisam ser resolvidas e ter retenção confirmada pelo storage antes de publicação; este componente não presume disponibilidade só pelo hash.
- ExportState é `{schema_version:1,binding,entries,catalog_digest}`. O digest cobre binding e entradas ordenadas (incluindo aliases/locators). Import valida esse digest, cada unit_digest, cobertura própria, unicidade e escopo. Checksums detectam inconsistência, não assinatura de um arquivo adversarial.
- O catálogo contém raízes atuais, não capítulos/overlays nem histórico de revisões. O driver WP-02 deverá gravar o mapa e as revisões necessárias antes de admiti-los num snapshot. Exportar um objeto não equivale a commit durável.
- Arrays de controle/catálogo são densos e limitados a 100.000 entradas neste componente. Esse limite explícito não é janela de modelo nem política de descarte: atingir o teto recusa nova admissão, sem remover registros.
- ToolExecutionKey inclui session_key/incarnation/host_epoch/host_message_id/tool_call_id. É uma chave para o futuro receipt; não executa consulta, não registra atenção do modelo e não funciona como cache de autorização.

## Evidência e rastreabilidade

| Subcaso | Estado do incremento | Evidência / limite |
|---|---|---|
| T07.contract | Implementado e testado no componente | IDs distintos para payload igual; revisão por payload/papel/metadata/fonte; fórmula de hash; export/reload; processo Node novo; conflito/overflow sem mutação parcial. Persistência transacional é WP-02. |
| T02.contract | Parcela de identidade exercitada | Instalações/workspaces/adapters/sessões/incarnações/epochs separados; ainda não há jobs ou associação final do adaptador implementados. |
| T06.contract, T30.contract, T37.contract | Permanecem abertos | Manifest, Capture/SealedFrame, duas representações normalizadas e fuzz completo continuam no WP-01. Há testes de rejeição de identidade, não cumprimento do pacote inteiro. |
| T15.contract, T33.capabilities | Regressão preservada | Os casos de WP-01/A continuam na suíte. |

`traceability.json.initial_status` continua not_run porque descreve o início do plano. Este relatório é o estado desta entrega, não alteração retroativa dos resultados históricos. Issue #4 e WP-00 não são encerrados por este incremento.

## Execução local

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

No Node 22.17.1/macOS Intel, typecheck e 108 testes do núcleo passaram, zero fail/skip/todo. Os 26 testes acrescentados incluem uma campanha com controle positivo e quatro mutantes: omitir workspace da chave, ignorar payload, não incrementar revisão e deixar alias sem checksum. Cada mutante deve falhar no teste nomeado correto; timeout/erro de setup não conta. Cada execução filha deve realmente executar seus 25 testes. Não contar as execuções internas como 125 testes de produto independentes.

A primeira execução da campanha expôs um erro no executor de teste: NODE_TEST_CONTEXT era herdado do processo pai. O teste foi corrigido para iniciar runner independente, exigir a contagem completa e o diagnóstico esperado. O resultado inicial 107/108 não é apresentado como aprovação. A suíte final 108/108 inclui a campanha corrigida.

O teste de reinício cria processo Node novo, importa o catálogo serializado e compara IDs/revisões/mapa. Isso demonstra portabilidade do registro entre processos, não fsync, transação SQLite ou recuperação de falta de energia. O teste de 500 raízes/reloads não é medição de RSS.

A movimentação do serializador atualiza a lista de hashes da sonda para incluir o arquivo compartilhado. As suítes stock-host e de mutações do OpenCode continuam nos workflows existentes; seus resultados são os runs do commit/PR, não herdados da execução anterior. O CI do núcleo repete typecheck e testes no Node 22.17.1 e 24.0.0.

## Revisão e próximo corte

Revisão local confrontou fórmula de unidade, identidade do catálogo, colisões de referências, imutabilidade runtime/TypeScript, revisão máxima e preservação dos fontes. Um checksum foi acrescentado ao catálogo antes da entrega para vincular também o alias público, que não pertence à fórmula normativa de unit_digest.

O próximo corte é Manifest/propostas e Capture/SealedFrame, usando estes tipos em vez de recriar identidades. Não há alteração de algoritmo de compactação, modelo, inferência, configuração pessoal, banco do host ou política de merge. Sem claims de cache, qualidade semântica ou suporte multi-harness homologado.
