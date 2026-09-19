# SPEC-19 — propriedade e supervisão local de tentativa (WP-02/D4)

**Contrato do perfil local de supervisão.** As correções S01/S02 exigem observação de término e reconciliação conservadora; não autorizam transporte ou recuperação cross-process.

Refina SPEC-15/18. Este corte liga a tentativa ao participante de storage e acompanha uma operação local autorizada até seu término. Não implementa transporte HTTP, scheduler, AttemptPermit, publicação ou reconciliação cross-process. Não autoriza inferência por si só.

## Associação durável

A reserva supervisionada grava tentativa, run, custos e identidade do supervisor na mesma transação. `attempts.usage_json`, antes nulo, conserva envelope v1 com binding, JobContextRef, AttemptRef, owner da sessão/fence, storage_owner_id e process_instance. O digest liga todos os campos. Esse envelope é controle de execução, NÃO medição de uso/faturamento. DDL permanece v1. Tentativa antiga com null é perfil legado; metadado inválido não é reinterpretado como legado.

WorkspaceHold passa a carregar process_instance além do owner_id; ambos são emitidos pelo coordenador e conferidos por sua guarda. Reserva e transições supervisionadas exigem hold vivo, mesmo workspace/owner e revalidação antes do commit. Lease renovado pode ser usado se owner/fence não mudou. Trocar a geração, sessão, tentativa ou participante é recusa, nunca adoção silenciosa. Resultado e confirmação de parada por caminhos legados não podem alterar uma tentativa vinculada sem seu hold.

Leitura da associação é diagnóstica e imutável: não relê fontes, emite permit, prova vida ou libera slot. Checksum é consistência, não proteção contra reescrita total por um processo autorizado ao banco.

## Supervisor local

LocalAttemptSupervisor abre seu próprio WorkspaceCoordinator e usa o SqliteSessionStore da MESMA factory. O store fica disponível para operações existentes de sessão/fontes/admissão; o coordenador e os controllers permanecem privados. `start(lease,expected,budget,operation)` reserva e registra intenção sob workspace hold antes de invocar exatamente uma vez o callback autorizado. Nenhum retry automático. Erro anterior ao dispatch não invoca callback.

O callback é adaptador interno confiável: recebe AbortSignal, não fd/SQL/permit ou ferramentas do projeto. Sua Promise cobre TODA a vida da operação local, inclusive fechamento de reader/conexão. Não pode resolver antes de seus recursos pararem nem destacar subprocessos. A API não é sandbox e não demonstra cumprimento desse protocolo por adaptador desconhecido. O transporte real terá gate próprio. O retorno precisa ser uma Promise nativa reconhecida por util.types.isPromise. O supervisor observa a resolução/rejeição com Promise.prototype.then, sem ler then do retorno nem assimilar um thenable arbitrário. A observação encapsula o valor retornado antes de validar sua forma. Valor resolvido é resultado sem local_stopped; esse campo só vira true depois de observar a Promise terminar. Rejeição da Promise termina como abort com parada local observada, sem repassar mensagem privada. Retorno inválido, exceção síncrona ou falha ao instalar a observação conserva local_stopped=false.

Cada sessão tem no máximo uma operação local no supervisor, além dos índices SQL. `cancel` primeiro persiste cancelamento e então sinaliza AbortController. O sinal não equivale a parada: a tentativa fica em quarantine até o callback terminar. Resultado tardio de job cancelado não altera proposta/status. Confirmação separada libera somente o run local, sem converter remote unknown em confirmed ou estornar reservas. Resultado malformado é registrado como falha final conservadora, sem reparo nem inferência extra.

`close` recusa enquanto existe operação pendente, sem liberar o owner. Concluir a Promise remove o acompanhamento local em finally. Protocolo inválido não deixa uma Promise observável: o supervisor tenta persistir failed/E_PROTOCOL com quarantine/remote unknown, depois sinaliza abort e remove apenas o acompanhamento em memória. Se a persistência falha, ainda sinaliza abort e reporta o erro. Close pode liberar o participante de storage após esse caminho, mas não altera nem libera a quarentena durável, não comprova cleanup do adaptador e não autoriza outra geração naquela sessão. Falha ao persistir deixa o ledger conservador, reporta erro e não inventa confirmação. Lease/fence perdido impede gravação, mesmo após parada local; a reconciliação entre processos continua bloqueada. Abrir/fechar não reexecuta nada.

## Limites

Sem liberação cross-owner por TTL/retired/lock livre. Tentativas históricas sem associação não ganham supervisor retroativamente. Não altera perfil de fontes, quotas, limites, DDL ou política de publicação. Não existe timeout que force true em local_stopped; cancelamento com prazo pertence à camada executora. O núcleo mantém sua independência de host.

## Cinco axiomas

**Success Criteria:** reserva vincula owner/process_instance/geração atomicamente; execução única; cancelamento não libera trabalho local ainda pendente; resposta tardia não ressuscita job.

**Quality Standards:** SQLite/locks reais, fontes sintéticas, promises controladas e testemunha Python; testes negativos e controles; pins preservados.

**Completeness Criteria:** associação/replay incorreto, lease renovado/expirado, rollback, duas sessões, erro antes/depois do dispatch, cancelamento tardio, fechamento recusado, resultado malformado e reabertura sem replay.

**Definition of Done:** contratos/código/testes alinhados, matriz completa do head e logs conferidos, merge somente verde, #5 atualizada sem concluir WP-02.

**Invariants:** nenhum fd exposto, nenhuma chamada automática adicional, nenhuma incerteza tratada como estorno, nenhuma remoção de reserva, nenhum estado terminal ressuscitado, nenhuma API de modelo criada.

## Recuperação anterior à invocação (S02)

Se a admissão do dispatch falha, o callback ainda não foi invocado. O supervisor tenta cancelar a geração sob um novo workspace hold e o lease/fence admitidos. Uma reserva ainda reserved passa a cancelled/stopped; se o dispatch já havia confirmado antes da falha observada pelo chamador, cancelamento gera quarantine e o MESMO supervisor pode confirmar stopped pela evidência específica de que não invocou o adaptador. Isso não converte remote unknown em confirmed.

Toda tentativa, identidade e reserva de custos permanece. Se lease, lock ou banco impedem a reconciliação, o registro conservador permanece para recuperação explícita e o erro original de dispatch é devolvido; ausência de nova exceção não é relatório de cancelamento. Não renovar lease, repetir adaptador ou inferir estorno. Tentativas de geração terminal só podem seguir por nova oportunidade explícita.

## Aceite de S01/S02

Os cinco casos antes vermelhos permanecem normais, com controles de Promise encerrada/rejeitada após cleanup, ausência de Promise, throw síncrono, thenable, falha de dispatch, lease expirado e reconciliação indisponível. Testes adicionais observam o estado persistido no momento de abort, Promise com then sobrescrito, falha posterior ao commit sem invocação e falha também no cancelamento.

A campanha de onze pares controle/mutante inclui seis contraprovas das correções: assimilação de retorno inválido, parada presumida no throw síncrono, confirmação sem observação, ausência de abort e remoção das duas reconciliações de dispatch. Quatro ensaios de processos verificam reservas/resultados e ausência de replay; não são teste de transporte de produção nem liberação cross-owner. O histórico de antes/depois fica no registro de implementação, sem transformar uma fase vermelha antiga em estado atual.

Fontes primárias: [AbortController na versão fixada de Node](https://nodejs.org/download/release/v22.17.1/docs/api/globals.html#class-abortcontroller), [transações SQLite](https://www.sqlite.org/lang_transaction.html). AbortSignal notifica cancelamento; não certifica fechamento de recursos.

Rastreamento do bloqueio de integração: [issue #35](https://github.com/gmhelmold/context-continuity/issues/35), vinculada à [WP-02 / #5](https://github.com/gmhelmold/context-continuity/issues/5).

Referências de Promise: [Node util.types.isPromise 22.17.1](https://nodejs.org/download/release/v22.17.1/docs/api/util.html#utiltypesispromisevalue) e [ECMAScript Promise.prototype.then](https://tc39.es/ecma262/2025/multipage/control-abstraction-objects.html#sec-promise.prototype.then).
