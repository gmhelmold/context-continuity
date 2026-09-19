# SPEC-19 — propriedade e supervisão local de tentativa (WP-02/D4)

**Rascunho de implementação, CHANGES REQUIRED: S01/S02 permanecem abertos. Não integrar este corte enquanto suas regressões reprovarem.**

Refina SPEC-15/18. Este corte liga a tentativa ao participante de storage e acompanha uma operação local autorizada até seu término. Não implementa transporte HTTP, scheduler, AttemptPermit, publicação ou reconciliação cross-process. Não autoriza inferência por si só.

## Associação durável

A reserva supervisionada grava tentativa, run, custos e identidade do supervisor na mesma transação. `attempts.usage_json`, antes nulo, conserva envelope v1 com binding, JobContextRef, AttemptRef, owner da sessão/fence, storage_owner_id e process_instance. O digest liga todos os campos. Esse envelope é controle de execução, NÃO medição de uso/faturamento. DDL permanece v1. Tentativa antiga com null é perfil legado; metadado inválido não é reinterpretado como legado.

WorkspaceHold passa a carregar process_instance além do owner_id; ambos são emitidos pelo coordenador e conferidos por sua guarda. Reserva e transições supervisionadas exigem hold vivo, mesmo workspace/owner e revalidação antes do commit. Lease renovado pode ser usado se owner/fence não mudou. Trocar a geração, sessão, tentativa ou participante é recusa, nunca adoção silenciosa. Resultado e confirmação de parada por caminhos legados não podem alterar uma tentativa vinculada sem seu hold.

Leitura da associação é diagnóstica e imutável: não relê fontes, emite permit, prova vida ou libera slot. Checksum é consistência, não proteção contra reescrita total por um processo autorizado ao banco.

## Supervisor local

LocalAttemptSupervisor abre seu próprio WorkspaceCoordinator e usa o SqliteSessionStore da MESMA factory. O store fica disponível para operações existentes de sessão/fontes/admissão; o coordenador e os controllers permanecem privados. `start(lease,expected,budget,operation)` reserva e registra intenção sob workspace hold antes de invocar exatamente uma vez o callback autorizado. Nenhum retry automático. Erro anterior ao dispatch não invoca callback.

O callback é adaptador interno confiável: recebe AbortSignal, não fd/SQL/permit ou ferramentas do projeto. Sua Promise cobre TODA a vida da operação local, inclusive fechamento de reader/conexão. Não pode resolver antes de seus recursos pararem nem destacar subprocessos. A API não é sandbox e não demonstra cumprimento desse protocolo por adaptador desconhecido. O transporte real terá gate próprio. Valor resolvido é resultado sem local_stopped; esse campo é atribuído pelo supervisor somente após a Promise terminar. Rejeição termina como abort incerto, sem repassar mensagem privada.

Cada sessão tem no máximo uma operação local no supervisor, além dos índices SQL. `cancel` primeiro persiste cancelamento e então sinaliza AbortController. O sinal não equivale a parada: a tentativa fica em quarantine até o callback terminar. Resultado tardio de job cancelado não altera proposta/status. Confirmação separada libera somente o run local, sem converter remote unknown em confirmed ou estornar reservas. Resultado malformado é registrado como falha final conservadora, sem reparo nem inferência extra.

`close` recusa enquanto existe operação pendente, sem liberar o owner. Concluir a Promise remove o acompanhamento local em finally. Falha ao persistir deixa o ledger conservador, reporta erro e não inventa confirmação. Lease/fence perdido impede gravação, mesmo após parada local; a reconciliação entre processos continua bloqueada. Abrir/fechar não reexecuta nada.

## Limites

Sem liberação cross-owner por TTL/retired/lock livre. Tentativas históricas sem associação não ganham supervisor retroativamente. Não altera perfil de fontes, quotas, limites, DDL ou política de publicação. Não existe timeout que force true em local_stopped; cancelamento com prazo pertence à camada executora. O núcleo mantém sua independência de host.

## Cinco axiomas

**Success Criteria:** reserva vincula owner/process_instance/geração atomicamente; execução única; cancelamento não libera trabalho local ainda pendente; resposta tardia não ressuscita job.

**Quality Standards:** SQLite/locks reais, fontes sintéticas, promises controladas e testemunha Python; testes negativos e controles; pins preservados.

**Completeness Criteria:** associação/replay incorreto, lease renovado/expirado, rollback, duas sessões, erro antes/depois do dispatch, cancelamento tardio, fechamento recusado, resultado malformado e reabertura sem replay.

**Definition of Done:** contratos/código/testes alinhados, matriz completa do head e logs conferidos, merge somente verde, #5 atualizada sem concluir WP-02.

**Invariants:** nenhum fd exposto, nenhuma chamada automática adicional, nenhuma incerteza tratada como estorno, nenhuma remoção de reserva, nenhum estado terminal ressuscitado, nenhuma API de modelo criada.

## Divergências abertas da implementação desta branch

S01: a anotação Promise do callback não é validada em runtime; um resultado síncrono pode ser aceito como ready. Precisa de recusa explícita de protocolo e não pode virar afirmação injustificada de parada. O contrato de cleanup do adaptador confiável continua obrigatório mesmo quando o retorno é Promise.

S02: falha ao registrar dispatch antes da chamada deixa a reserva ativa. É conservador (não há envio), mas a via normal deve cancelar a reserva não utilizada quando o lease permite, mantendo contadores. Se a autoridade se perdeu ou o banco falhou, preservar estado e diagnóstico; não simular sucesso da reconciliação.

Os dois casos são testes normais, sem skip ou expected failure. A gravação corretiva foi bloqueada antes de executar e a versão defeituosa permanece identificada no PR. A revisão dos demais caminhos não equivale à conclusão desse gate.

Fontes primárias: [AbortController na versão fixada de Node](https://nodejs.org/download/release/v22.17.1/docs/api/globals.html#class-abortcontroller), [transações SQLite](https://www.sqlite.org/lang_transaction.html). AbortSignal notifica cancelamento; não certifica fechamento de recursos.

Rastreamento do bloqueio de integração: [issue #35](https://github.com/gmhelmold/context-continuity/issues/35), vinculada à [WP-02 / #5](https://github.com/gmhelmold/context-continuity/issues/5).


## Refinamento do aceite de S01/S02

O aceite exige testar status E_PROTOCOL/failed separadamente de prova local: retorno não-Promise, thenable arbitrário e throw síncrono não podem declarar `local_stopped=true`. Rejeição de uma Promise real só pode representar encerramento pelo protocolo do adaptador confiável, cuja vida inclui cleanup. Testar explicitamente ausência de execução de getter then em retornos fora do protocolo. Ver [util.types.isPromise no runtime fixado](https://nodejs.org/download/release/v22.17.1/docs/api/util.html#utiltypesispromisevalue). Essas verificações de contrato não tornam código arbitrário seguro nem comprovam encerramento remoto.

Os quatro ensaios de processo e os cinco pares controle/mutante da continuação verificam o componente real atual. Não substituir os controles negativos específicos dos fixes ausentes por essas campanhas. Após corrigir S01/S02, repetir também as regressões ampliadas e criar as contraprovas de remoção de cada correção, mantendo todos os limites e o estado de implementação explícitos.
