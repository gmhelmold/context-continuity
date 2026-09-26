# WP-03/A — orçamento puro do gatilho

**Escopo:** incremento isolado WP-03/A sobre `560d32e9c007573eb1abaae25d96ee451a05f00b`, SPEC-02 §1–2, especificação 0.1.2. WP-03 continua aberto.

`deriveTriggerBudget` calcula e congela B/G/F/T/L/N para uma `ResolvedConfiguration`. `evaluateTrigger` valida U como record fechado de dados, calcula M por observação e retorna elegibilidade `U >= T`. Não há estado armed/rearm, job, permit, storage, host, rede, cache ou dispatch. `TriggerBudgetError` é `E_BUDGET` somente para B<=0, T<=0 ou L>=T; entrada inválida é `ContractError/E_SCHEMA`.

## Evidência incremental

`tests/core/scheduler-budget.test.mjs` fixa exemplo SPEC-02, T-1/T, caps null/finito/healthy, sentidos de arredondamento, M dependente de U, schema/protótipos/getters, aliases congelados e E_BUDGET. `tests/core/scheduler-budget-mutations.test.mjs` prova controle stock e detecção nomeada de quatro impls erradas: dedução de cache, omissão de ceil de G, ceil de T e comparador estrito de elegibilidade. Setup, timeout, skip, todo e cancelamento não contam como detecção.

## Limites

Isto não conclui WP-03, scheduler nem T04/T15/T16/T17/T37/T40. Não é homologação de modo, perfil, contagem de provider, admissão, missão real, cauda, seleção, recuperação, publicação ou compactação.
