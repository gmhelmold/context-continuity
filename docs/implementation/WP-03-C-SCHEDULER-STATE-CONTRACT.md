# WP-03/C - contrato de estado persistido do scheduler

**Escopo:** fundação C-SCHED-01 sobre `5199dcaa07bbb6dda21f2e032e81c03c4abfd922`, SPEC-02 §3 e SPEC-03 v2, especificação 0.1.2. WP-03 continua aberto.

## Decisão normativa

Estado é indexado por `session_key` e validado contra `incarnation` atual. Tupla de oportunidade é persistida em quatro colunas: `host_epoch`, `coverage_digest`, `policy_revision` e `config_digest`; digest opaco da tupla é proibido. DDL v1 fica inalterado; SPEC-03 declara migração lógica v2 sem código executável.

Somente `primary_terminal` registra U/tempo ou low-water. Low-water é booleano limitado a epoch/policy/config atuais. `structured_task` não altera essa evidência; worker e manutenção são ignorados. Tentativa física não é terminal: terminal é estado final do job inteiro.

Admissão automática exige lease/fence, sessão ativa, armed, ausência de job ativo/quarantine e tupla diferente da última tentativa. Exige `U >= T`, exceto `structured_task` com `task_trigger=true`, intervalo seguro >=2M, crescimento elegível >=N e cooldown satisfeito. Mesma transação cria job/reserva, persiste tupla e desarma estado. Rearmamento requer low-water válido e `U >= T`, ou crescimento de pelo menos N, cooldown inclusivo exato e `coverage_digest` diferente.

## Implementado

`schema-v1.sql` permanece byte a byte. `schema-v2.sql` cria `scheduler_state`; bootstrap novo e upgrade v1->v2 validam snapshot anterior e executam DDL/meta/version na mesma transação. Não há linha de scheduler para sessão v1 até primeira observação primary autorizada.

`readSchedulerState(binding)` retorna estado estritamente revalidado e congelado. `recordPrimaryObservation(lease,input)` aceita somente campos fechados, revalida sessão/incarnation/lease/fence, avança clock por `#now`, atualiza observação e grava low-water somente quando solicitado. Não muda `armed`, nem grava tentativa.

## Limites

Não há scheduler, job admission, rearm, reserva, tokenizer, rede, dispatch, projeção, prova runtime ou homologação. Este contrato não conclui WP-03 nem T04/T14/T15/T16/T17/T35/T37/T40.

## Evidência desta entrega

Storage tests cover atomic migration, strict parse/frozen read, owner/fence/current-control rejection, monotonic observations and low-water preservation. Mutation test includes positive control and wrong implementations. Gates do not validate scheduler admission or host runtime.
