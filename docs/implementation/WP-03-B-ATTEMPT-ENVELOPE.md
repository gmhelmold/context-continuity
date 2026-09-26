# WP-03/B - preflight puro do envelope de tentativa

**Escopo:** incremento isolado WP-03/B sobre `422afc46e47fa1b4d99e3a3a049d579a2c5e1ac8`, SPEC-02 §2, especificação 0.1.2. WP-03 continua aberto.

`evaluateAttemptEnvelope` recebe configuração já resolvida e record fechado com os quatro tamanhos contáveis. Reusa B e `TriggerBudgetError` de `deriveTriggerBudget`; recusa com `E_BUDGET` quando primary ou clone excedem B, output diverge de R, ou clone não inclui missão integral. Quando cabe, retorna e congela somente B, R, F e `max(0, missão - F)`. Não há reserva, job, permit, storage, rede, tokenizer, host, dispatch ou mudança de configuração.

## Evidência incremental

`tests/core/attempt-envelope.test.mjs` cobre limites inclusivos de B, igualdade exata de R, missão integral, excedente de F, schema fechado/data-only e imutabilidade. `tests/core/attempt-envelope-mutations.test.mjs` prova cinco controles nomeados: stock, comparador de primary, comparador de clone, igualdade de R e contenção de missão. Setup, timeout, skip, todo e cancelamento não contam como detecção.

## Critérios e limites

**Success Criteria:** preflight puro aceita somente os quatro inteiros seguros declarados e retorna envelope imutável quando ambos requests cabem.

**Quality Standards:** cálculo reutiliza B/F e `E_BUDGET` compartilhados; testes executam código real em cópias descartáveis.

**Completeness Criteria:** limites de primary/clone, R, missão/excedente, schema/protótipos/getters, freeze e contraprovas nomeadas são exercitados.

**Definition of Done:** typecheck e suíte core passam com controle stock e quatro mutantes detectados.

**Invariants:** nenhuma validação autoriza reserva, dispatch, rede, job, storage ou medição/tokenização; excedente registrado não torna clone fora de B aceitável.

Isto não conclui WP-03, admissão transacional, AttemptPermit, quota, geração, contagem de provider, modo, perfil, recuperação, publicação ou compactação.
