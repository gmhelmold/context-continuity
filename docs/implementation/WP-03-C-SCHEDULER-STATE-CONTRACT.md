# WP-03/C - contrato de estado persistido do scheduler

**Escopo:** incremento documental WP-03/C sobre `56481506cdf3a350e0cfe8f26c7c3e951d7c51ce`, C-SCHED-01 em SPEC-02 §3 e adendo v2 de SPEC-03, especificação 0.1.2. WP-03 continua aberto.

## Decisão normativa

Estado é indexado por `session_key` e validado contra `incarnation` atual. Tupla de oportunidade é persistida em quatro colunas: `host_epoch`, `coverage_digest`, `policy_revision` e `config_digest`; digest opaco da tupla é proibido. DDL v1 fica inalterado; SPEC-03 declara migração lógica v2 sem código executável.

Somente `primary_terminal` registra U/tempo ou low-water. Low-water é booleano limitado a epoch/policy/config atuais. `structured_task` não altera essa evidência; worker e manutenção são ignorados. Tentativa física não é terminal: terminal é estado final do job inteiro.

Admissão automática exige lease/fence, sessão ativa, `U >= T`, armed, ausência de job ativo/quarantine e tupla diferente da última tentativa. Mesma transação cria job/reserva, persiste tupla e desarma estado. Rearmamento requer low-water válido e `U >= T`, ou crescimento de pelo menos N, cooldown inclusivo exato e `coverage_digest` diferente.

## Limites

Não há scheduler, storage, migração executável, job, reserva, lease, tokenizer, rede, dispatch, prova runtime ou homologação. Este contrato não conclui WP-03 nem T04/T14/T15/T16/T17/T35/T37/T40.

## Evidência desta entrega

Cinco verificadores documentais e teste de componentes são executados após edição. Eles verificam documentos, DDL v1 e componentes existentes; não validam C-SCHED-01 em runtime.
