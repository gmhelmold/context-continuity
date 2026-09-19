# WP-02/D4 — vínculo e supervisão local de tentativa

**CHANGES REQUIRED. Não integrado. S01/S02 não corrigidos.** Base `d81e2ace6f9f0edc34139074cdeec1c73cf0b951`, continuidade de #5. Contrato proposto: [SPEC-19](../../specs/v0.1/19-local-attempt-supervisor.md).

## Implementação da branch

A reserva pode vincular atomicamente owner da sessão, fence, storage_owner_id, process_instance, binding, JobContextRef e AttemptRef. O envelope fica em attempts.usage_json; não representa faturamento e não muda DDL. O WorkspaceHold recebeu process_instance. Transições de tentativa vinculada exigem o hold emitido e vivo do mesmo participante; leitura do envelope é diagnóstica e imutável. null conserva perfil legado; nenhum job antigo recebe supervisão retroativa.

LocalAttemptSupervisor conserva coordenador privado e uma conexão de sessão da mesma factory. start reserva e grava intenção antes de uma invocação do adaptador interno. cancel grava o estado antes de sinalizar AbortController; callback pendente mantém o slot e impede close. Depois de término observado, resultado de geração cancelada não revive a proposta, e a confirmação local mantém unknown remoto e custos reservados. Lease renovado da mesma geração é aceito; lease perdido impede atualização e preserva quarentena.

Sem HTTP implementado, ferramentas de projeto, retries internos, novo host, alteração de configuração pessoal ou inferência real. O callback usado nos testes é uma operação sintética cuja Promise cobre sua vida inteira. Não é prova de que um adaptador arbitrário fecha sockets antes de resolver; o transporte final terá seu gate. Não há liberação cross-owner nesta implementação.

## Revisão com regressões

Primeira suíte: 18/18 passaram. Acrescentei seis casos, incluindo duas regressões que demonstraram:

| ID | Defeito observado | Resultado dirigido |
|---|---|---|
| S01 | Resultado sem Promise foi aceito como ready por await; assinatura TypeScript não garante retorno em JavaScript. | Falhou: esperava failed, recebeu ready. |
| S02 | Dispatch recusado antes de invocar adaptador deixou job running e tentativa reserved, embora o lease ainda permitisse cancelamento. | Falhou: esperava cancelled, recebeu running. |

As correções não foram aplicadas: a chamada foi bloqueada antes de executar, inclusive uma repetição idêntica. Não foi tentada publicação das correções por outra rota. A fonte foi relida para conferir isso. Código pendente é publicado apenas em PR draft; testes falhos permanecem normais e visíveis.

S01 precisa preservar a diferença entre término observado e protocolo inválido. Uma Promise também não é prova geral de morte de processo; o chamador é adaptador interno confiável, não código de modelo. S02 não deve estornar custos; cancelamento impossível por lease/banco preserva estado conservador e erro explícito. Nenhuma dessas correções permite apagar tentativas ou repetir chamadas.

## Validação

O JSON [evidence/WP-02-D-attempt-supervisor.json](evidence/WP-02-D-attempt-supervisor.json) registra comandos, hashes e resultados reais. Os 24 casos novos pertencem à suíte de coordenação e não se somam a subprocessos. Não reaproveitar o verde do PR #34 para aprovar esta branch. Matriz completa é registrada após execução, com falhas explícitas. Compilação nativa usa headers/pins existentes.

## Cinco axiomas

**Success Criteria:** associação atômica; uma invocação; cancelamento sem liberação precoce; transições condicionadas ao participante e geração corretos.

**Quality Standards:** SQLite e locks reais; adapters sintéticos e promises controladas; Python testemunha o owner durante operação pendente; código de produção compartilhado, não cópia em mocks.

**Completeness Criteria:** identidade/fence/process_instance, reserva e rollback, cancelamento e fechamento, callbacks tardios, entrada incorreta, repetição explícita e lease perdido. Sem gate integral de rede ou cross-process.

**Definition of Done:** corrigir S01/S02, adicionar campanhas negativas correspondentes e ensaios de processo/integração relevantes, repetir matriz nos pins, conferir logs do head exato, só então integrar e atualizar #5.

**Invariants:** não expor fd, não tratar abort/TTL/retired como parada, não apagar reservas nem reexecutar automaticamente, não remover testes para obter verde, não anunciar o plugin instalado.

Rastreamento do bloqueio de integração: [issue #35](https://github.com/gmhelmold/context-continuity/issues/35), vinculada à [WP-02 / #5](https://github.com/gmhelmold/context-continuity/issues/5).

## Matriz local executada nesta rodada

macOS Intel / Node 22.17.1 / TypeScript 5.9.3. Coordenação: **121/123**, exatamente S01/S02 reprovados. Os 99 casos anteriores passaram; os 24 novos terminaram 22/24. Storage e core, componentes, testemunha e verificadores documentais têm códigos/contagens no JSON; não transformar contagem parcial ou timeout em aprovação. Typecheck de storage foi repetido depois de acrescentar os testes de tipos. Nenhum CI remoto é alegado por este registro local.

O estágio permanece **CHANGES REQUIRED**, incluindo campanhas negativas novas e testes de processo/transporte ainda não executados para o supervisor. As campanhas anteriores permanecem testes das camadas que lhes correspondem, não prova de supervisão completa.
