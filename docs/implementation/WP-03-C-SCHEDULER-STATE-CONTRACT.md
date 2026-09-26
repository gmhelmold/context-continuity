# WP-03/C - contrato de estado persistido do scheduler

**Escopo:** fundação C-SCHED-01 sobre `5199dcaa07bbb6dda21f2e032e81c03c4abfd922`, SPEC-02 §3 e SPEC-03 v2, especificação 0.1.2. WP-03 continua aberto.

## Decisão normativa

Estado é indexado por `session_key` e validado contra `incarnation` atual. Tupla de oportunidade é persistida em quatro colunas: `host_epoch`, `coverage_digest`, `policy_revision` e `config_digest`; digest opaco da tupla é proibido. DDL v1 fica inalterado; SPEC-03 declara migração lógica v2 sem código executável.

Somente `primary_terminal` registra U/tempo ou low-water. Low-water é booleano limitado a epoch/policy/config atuais. `structured_task` não altera essa evidência; worker e manutenção são ignorados. Tentativa física não é terminal: terminal é estado final do job inteiro.

Admissão automática exige lease/fence, sessão ativa, armed, ausência de job ativo/quarantine e tupla diferente da última tentativa. Exige `U >= T`, exceto `structured_task` com `task_trigger=true`, intervalo seguro >=2M, crescimento elegível >=N e cooldown satisfeito. Mesma transação cria job/reserva, persiste tupla e desarma estado. Rearmamento requer low-water válido e `U >= T`, ou crescimento de pelo menos N, cooldown inclusivo exato e `coverage_digest` diferente.

## Implementado

`schema-v1.sql` permanece byte a byte. `schema-v2.sql` cria `scheduler_state`; bootstrap novo e upgrade v1->v2 validam snapshot anterior e executam DDL/meta/version na mesma transação. Não há linha de scheduler para sessão v1 até primeira observação primary autorizada.

`readSchedulerState(binding)` retorna estado estritamente revalidado e congelado. `recordPrimaryObservation(lease,input)` aceita somente campos fechados, revalida sessão/incarnation/lease/fence, avança clock por `#now`, atualiza observação e grava low-water somente quando solicitado. Não muda `armed`, nem grava tentativa.

`observePrimaryAndRearm(lease,input)` é a fatia atômica de `primary_terminal`: revalida lease/fence, incarnation, tuple atual e configuração resolvida persistida; calcula L/T/N pela configuração atual; grava U/tempo; só marca low-water com `U < L`; e rearma estado desarmado por low-water válido com `U >= T`, ou por crescimento >=N, cooldown inclusivo e coverage diferente da última tentativa. Retorna `{state, reason}` congelado. Não cria nem altera job, attempt, reserva ou `structured_task`.

`admitPrimarySchedulerJob(lease,{context,expected,observation,selected_interval_tokens,attempt_budget,owner_hold})` é a admissão primary isolada. Na mesma transação revalida lease/fence/incarnation/configuração/tupla/U/estado armado/última observação, exige `selected_interval_tokens >= 2*M` para M derivado de U atual, cria job, reserva `attempt_budget`, vincula owner do attempt, persiste as quatro colunas `last_attempt_*` e desarma. Não aceita `structured_task`, não executa dispatch/rede/projeção nem prova seleção; `selected_interval_tokens` é fato validado pelo chamador.

## Limites

Não há integração de eventos, `structured_task`, tokenizer, rede, dispatch, projeção, prova runtime ou homologação. A admissão primary recebe contexto e intervalo já validados; não seleciona intervalo nem prova sua semântica. Este contrato não conclui WP-03 nem T04/T14/T15/T16/T17/T35/T37/T40.

## Evidência desta entrega

Storage/process tests cover atomic migration, strict parse/frozen read, owner/fence/current-control rejection, monotonic observations, persisted rearm state, L/T boundaries, N, cooldown inclusivo e coverage. Mutation test includes positive control plus N/coverage bypasses. Gates do not validate scheduler admission or host runtime.
