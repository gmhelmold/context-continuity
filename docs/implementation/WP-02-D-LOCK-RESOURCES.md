# WP-02/D2 — recursos privados de lock

Base `c5d94ac62cf2ef3e1beb16b86b6209fa8b8beae9`. Continuação da worktree preservada; refs #5. Contrato [SPEC-17](../../specs/v0.1/17-lock-resources.md). Este corte implementa recursos de filesystem, não o gerenciador transacional de proprietários.

## Entrega e fronteira

LockResources mantém descritores privados de diretório, owners e workspace.lock. Usa a ponte nativa integrada, carregada sob demanda, e identidades BigInt serializadas sem perda numérica. Abertura existente não inicializa caminhos; bootstrap é explícito e não trunca arquivos. Guardas de permissão/identidade acompanham aquisição e uso dos owners. Reentrância é recusada, busy não vira sucesso. Fechar o pai revoga/fecha filhos; fechar um filho não afeta os demais.

A tentativa de escrever WorkspaceCoordinator com SQLite foi bloqueada antes da execução. Confirmado ausente; não foi publicada por outro caminho. A camada de recursos acima havia sido gravada e foi corrigida/testada separadamente. Nenhum arquivo do coordenador parcialmente escrito, nenhuma alteração no banco/sessões/quotas/jobs. O desenho proposto e a implementação de recursos são distintos, sem declaração fictícia de liveness completo.

## Revisão com regressões

Primeiros 21 testes: 18 passaram e três reprovaram. Corrigidos: initialize não booleano aceito, coerção do ID de owner e recursos filhos não fechados junto ao pai. Mesmos 21 passaram depois. Outra regressão mostrou symlink final com barra terminal aceito; corrigido preservando aliases ancestrais resolvidos e recusando segmentos ambíguos. O controle de caminho canônico usava `/tmp` literal no Mac, embora realpath devolva `/private/tmp`: ajustada a expectativa para realpath, não o comportamento de produção.

A campanha inicial executou cinco mutantes, mas a sexta âncora textual perdeu uma barra na string JavaScript. Essa execução 28/29 NÃO foi aceita. Corrigida somente a string por String.raw; versão final 29/29 contém 28 comportamentos e a campanha de seis pares controle/mutante. Subprocessos não multiplicam a contagem. Fases e hashes estão no [JSON](evidence/WP-02-D-lock-resources.json).

## Provas executáveis

Python em outro processo observa a exclusão real de workspace e owners. Os testes cobrem privacidade, exclusividade por arquivo, reentrância, fechamento, IDs/dados inválidos, caminho substituído, owners/diretório substituídos, symlink com barra, hardlink, bytes preservados, BigInt e falta de binário em cópia descartável. Um filho criado pela fixture mantém locks gerenciados; após encerrá-lo, a testemunha independente e nova instância conseguem adquiri-los. Isso não infere morte de processo a partir de lock livre no produto.

Mutantes: remover guarda de identidade, reportar busy como aquisição, não fechar filhos, ignorar booleano initialize, permitir coerção de ID e não tratar symlink terminal com barra. Cada controle correto passa e o mutante correspondente deve reprovar no teste nomeado, por assertion — nunca por timeout/setup.

Os três testes owner-boundaries da preparação anterior são preservados byte a byte e seu JSON foi consolidado a partir dos logs existentes. Demonstram limites da ponte, não corrigem o coordenador ausente. Os 17 testes nativos anteriores também permanecem. A matriz local completa confirmou 49/49 de coordenação (17 + 3 + 29).

## Limites explícitos

Não há anchor no SQLite, API de proprietário ativo/retired, capability de callback, reconciliação de reservas ou liberação de job. A identidade é garantida dentro da instância; nova instância ainda exige comparação com anchor futuro. Não há proteção contra código hostil do mesmo usuário, prova de durabilidade elétrica, prebuild distribuído ou benchmark de longa sessão. O custo de manter arquivos vazios como identidades não é GC implementado. Nenhum dado de usuário, chamada live ou configuração pessoal é necessário.

## Critérios de fechamento

**Success Criteria:** identidade e vida dos recursos locais corretas no escopo definido.

**Quality Standards:** testemunha independente, testes contra implementação real, controles negativos, sem timeout aumentado ou assertions relaxadas.

**Completeness Criteria:** positivos/negativos de inicialização, caminho, permissões, fd privado, parent/child, concorrência e encerramento.

**Definition of Done:** código e SPEC-17 alinhados, validação completa e logs do head final, merge conferido, branch/checkout organizados e #5 atualizada sem fechar o WP.

**Invariants:** sem SQL/rede, sem TTL/cleanup implícito, sem bypass de quarantine e sem reaplicar alternativas históricas.

## Reprodução

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build:locks
npm run check:core
npm run check:storage
npm run test:coordination
npm run test:core
npm run test:storage
python3 scripts/check-spec.py
```

As suites completas e o CI são registrados após a execução, sem herdar verde do PR #31. Revisão do autor, não auditoria independente.

## Matriz local concluída

Nos pins Node22.17.1/TypeScript5.9.3: coordenação49/49, núcleo198/198, storage155/155, componentes25/25, testemunha4/4, ambos typechecks e cinco verificadores documentais aprovados. As suites pesadas core/storage foram executadas em série; comandos/pins do CI permanecem intactos. O CI do head final precisa de resultados próprios, registrados no PR antes do merge.
