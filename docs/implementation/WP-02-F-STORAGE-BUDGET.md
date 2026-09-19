# WP-02/F1 — orçamento compartilhado de conteúdo

[Contrato SPEC-23](../../specs/v0.1/23-storage-budget.md) · [WP-02 / issue #5](https://github.com/gmhelmold/context-continuity/issues/5).

## Corte e origem

Base de implementação: `72bf30091431b7981eb01b5f48f54756f8773f12`, após PR #45. A quota de 2 GiB já existia na retenção inline. Este corte extrai sua contabilidade para um serviço comum e acrescenta diagnóstico por workspace. Não é uma implementação de staging, arquivo externo ou GC. O gate executado pertence ao head do PR vinculado à issue #5; existir este documento não significa que o gate passou.

## Blast radius

| Área | Mudança e limite |
| --- | --- |
| `storage-budget.ts` | Uma definição de quota, três agregações escalares e verificação de capacidade; sem filesystem/host/rede. |
| `source-records.ts` | Reutiliza a verificação antes da inserção nova e reexporta a constante anterior. Replay/revisões/bytes/hash não mudam. |
| `workspace-coordinator.ts` | `readStorageBudget` usa a seção e a transação de leitura existentes; não emite hold nem libera reservas. |
| `index.ts` e tipos | Exporta StorageBudget somente como tipo; checagens de imutabilidade e ausência de overrides. |
| SPEC-14/18/23 e índices | Delimitam snapshot diagnóstico, admissão IMMEDIATE e quota lógica, sem prometer espaço físico. |
| Testes | Fixtures próprias, comportamentos, processos independentes e oito pares controle/mutante; suites anteriores preservadas. |

DDL, dependências, workflows, núcleo, política de contexto, schema version, fontes protegidas e quotas de inferência não foram alterados. Nenhum estado agregado de aceitação de WP-02 é promovido automaticamente.

## Obrigações de prova

- `storage-budget.test.mjs`: soma por categorias, bytes inline literais, sessões/revisões, catálogo sem duplicar referências, reserva sem limpeza por owner, limite inclusivo/excesso, relatório stale, rollback do lote, dados inválidos, overflow, snapshot WAL, lock e falhas transacionais.
- `storage-budget-processes.test.mjs`: nova instância em processo independente relê o catálogo; dois escritores de sessões diferentes não gastam ambos o último byte livre.
- `storage-budget-mutations.test.mjs`: omissão de reservas/blobs, confiança no size_bytes inline, limite exclusivo, retirada do gate da escrita, transação ausente, soma imprecisa e omissão de parcela inválida. Cada controle precisa passar e cada mutante precisa falhar na assertion nomeada, com contagens exatas; startup/import/sinal/timeout não contam.

Os testes de catálogo/reservas injetam linhas sintéticas no schema real. Não escrevem arquivos externos de 2 GiB nem atestam blobs físicos, staging, owner liveness ou GC. Os bytes inline são realmente retidos pela API, e as provas de concorrência usam processos/SQLite reais. Controles e subprocessos internos não inflam contagens de testes.

## Revisão de desenho

Não foi adicionado contador persistido sujeito a drift nem cache de relatório. Cada admissão nova reconta na transação que fará a inserção. Reportar acima da quota é permitido, mas reservar mais não; remaining=0 não esconde used>quota. Replay não é contado duas vezes. SUM de parcelas inválidas não pode baratear o orçamento: tipo/validade são verificados separadamente e qualquer inconsistência recusa o relatório.

A leitura pública mantém as guardas do coordenador. O helper interno exige transação, mas não pretende provar que o caller obteve BEGIN IMMEDIATE ou flock: isso é responsabilidade dos caminhos integrados e das provas de concorrência. Arquivos órfãos fora do catálogo e reconciliação de staging pertencem ao próximo serviço, não são omitidos de uma suposta medição física universal.

## Cinco axiomas

**Success Criteria:** uma contabilidade compartilhada alimenta diagnóstico e admissão, com quota consistente entre sessões.

**Quality Standards:** componentes reais, dados sintéticos delimitados, oráculos de valores explícitos, controle positivo e mutantes nomeados, build/teste/typecheck somente Actions.

**Completeness Criteria:** categorias, fronteiras, snapshots, concorrência, reabertura, erro e rollback cobertos no incremento; nenhuma afirmação de implementação de arquivos externos.

**Definition of Done:** código e contrato publicados, matriz e revisão do mesmo head aprovadas, gate com jobs/contagens, equivalência de árvore integrada e higiene da branch. Resultados e eventuais correções durante o CI são preservados no PR, sem reutilizar o verde de outro commit.

**Invariants:** sem mudança de limites, liberação automática, escrita de diagnóstico, replay de inferência ou edição de dados do usuário. #5 permanece aberta para staging/blobs/GC, publicação e os demais serviços de WP-02.

Revisão do autor, não auditoria independente. Não houve execução de produto/testes/build no Mac ou contêiner; o Mac serviu apenas para preparar texto e operações administrativas GitHub. Nenhuma release ou inferência paga.
