# WP-02/A — revisão e reconciliação de integração

Base revisada: `d3dd2db6e3f45bfad6de5adb186236331e6b6603`, PR #25. Continua [WP-02/A](WP-02-A.md) e issue #5; não conclui o ledger.

## Implementação canônica

O pacote local anterior `context-continuity-wp02a.zip` propunha `SqliteLedger.attach`. O PR #25 implementa `SqliteSessionStore`, criação exclusiva, sessões e leases. São alternativas sobrepostas, não patches cumulativos. A continuidade é o PR #25. Não reaplicar o ZIP nem introduzir sua segunda API ou seus metadados.

Hashes dos artefatos históricos:

- ZIP: `bacd23a5bc9b3e7d1bc9e55a9babb65e0fb75a63ec6d3887b11b7dc7e66ab222`.
- Patch: `90585de706dd085d335cd025bbe1a2b34e4adb87df9ea7440bd2ac08d5e422b9`.
- Relatório: `497cd51206bb14912a0ee2dc96f20e163d8ff570513089cd06312288a4fd4e2b`.

Os 45 testes do pacote não se somam aos testes deste PR. Cenários pertinentes de schema e commit foram adaptados à API publicada. Attach de conexão externa e callbacks SQL arbitrários não são superfícies da API de sessão.

## Correção durante a revisão

A inspeção usava `NOT LIKE 'sqlite_%'`: o underscore é um curinga nesse operador. Quatro testes de tabela, índice, view e trigger adicionais falharam por Missing expected exception. O filtro passou a `NOT GLOB 'sqlite_*'`, que preserva o prefixo literal reservado. Nenhuma alteração no DDL ou na versão do banco.

A rejeição mantém os bytes do banco. Autoíndices legítimos e estatísticas do SQLite continuam aceitos. Referência: [operadores SQLite](https://www.sqlite.org/lang_expr.html#like). A prova está na implementação real, não apenas na documentação.

## Testes acrescentados e resultados locais

`tests/storage/bootstrap-review.test.mjs` contém nove casos: quatro objetos com prefixo parecido; controle de objetos internos; arquivo read-only; interrupção no meio do bootstrap; interrupção após commit do bootstrap; interrupção após commit de Session/View0.

Antes da correção: cinco passaram e quatro assertions de schema falharam. Depois: nove passaram. Na suíte completa, **39/39 testes de storage**, sem skip/todo. Os 30 anteriores e sua campanha com controle positivo/quatro variantes incorretas foram preservados. Typecheck de storage aprovado com Node 22.17.1 e TypeScript 5.9.3.

Os processos são filhos próprios das fixtures, interrompidos em barreiras observadas e aguardados antes de limpar os diretórios. Interrupção antes do commit não publica schema/versionamento; o arquivo incompleto não é recriado silenciosamente. Após commit, a reabertura conserva o estado completo e não cria jobs ou replay. Não é prova de queda elétrica, filesystem remoto ou durabilidade do hardware.

As provas existentes de contenção, rollback de Session/View0 e fencing não foram relaxadas. O pacote alternativo não foi aplicado sobre o checkout compartilhado; revisão e testes ocorreram em worktree isolada.

## Gate de integração

Os resultados definitivos exigem todos os seis workflows/oito jobs no head final, logs conferidos e igualdade das árvores integrada/testada. Os checks históricos não substituem a nova matriz. O estado remoto é registrado no PR #25 e na issue #5.

#5 permanece aberto para root map e fontes duráveis, jobs/attempts, locks de workspace, quota/blobs/GC, publicação e arquivo portátil. Não há inferência live, configuração pessoal alterada ou pacote publicado. Revisão do autor sobre o código de outra execução, não auditoria externa.
