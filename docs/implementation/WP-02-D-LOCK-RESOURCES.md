# WP-02/D2 — recursos privados de lock

**LR05 corrigido nesta continuação; o PR #32 exige a matriz final e conferência do CI antes de integrar.**

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

## Revisão final LR05 — fase vermelha preservada

Depois da matriz verde de `e56570240ca53eb9a714e4e493878cca40317b2d`, foram acrescentados dois casos de falha de close. O teste delega ao fechamento real de um descritor da fixture e depois injeta EIO sintético, restaurando a instrumentação no finally. Não é um erro de hardware/OS observado nem evidência de vazamento real.

`PrivateDescriptor.close()` revoga o handle e remove o filho da coleção, mas deixa o erro original de closeSync escapar. O teste exige E_CAPABILITY sanitizado conforme SPEC-17 e reprova. O controle de fechamento pelo pai passa: mesmo com falha num filho, os demais locks são encerrados e a testemunha Python consegue adquiri-los.

Dirigidos: **2 casos, 1 pass/1 fail**. Coordenação completa após a revisão: **51 testes, 50 pass/1 fail**, sem skip/todo/cancelled. Os 49/49 locais e os sete workflows/dez jobs verdes anteriores pertencem à suíte de e565702 e não cobrem esse caso. Não se herda aprovação de CI para este novo head.

A edição corretiva foi bloqueada antes da execução; a repetição idêntica também foi bloqueada. O arquivo de produção permaneceu byte a byte igual a e565702. Não foi aplicada por rota alternativa. A [issue #33](https://github.com/gmhelmold/context-continuity/issues/33) contém reprodução, critérios e limites. A correção precisa manter revogação antes de fechar, sanitização do erro, fechamento dos demais recursos e ausência de repetição de close sobre número possivelmente reutilizado.

Os dois testes são normais e ficam publicados na mesma branch, sem expected-failure ou relaxamento da assertion. O incremento só será considerado concluído após a correção, repetição da matriz completa e conferência do novo head. WorkspaceCoordinator e seu registro transacional permanecem separados e não implementados.

## Resolução LR05 — fechamento direto e limpeza de abertura

Retomada na base do PR `2fc80a61017a9f9bea7879d944e97f6973e145a5`. Os dois testes publicados foram repetidos sem alterações: 1/2 antes e 2/2 depois do tratamento sanitizado de close. O descritor é revogado antes da chamada, removido da coleção no finally, e não é fechado novamente após erro.

A revisão do mesmo caminho encontrou erro equivalente na limpeza de um owner cuja construção foi recusada. Nova regressão falhou antes e passou após sanitizar também esse fechamento; o controle de idempotência passou e exige uma única execução de close mesmo ao fechar owner e pai depois do erro. A instrumentação fecha somente descritores reais da fixture e injeta EIO em seguida; não é relato de falha de hardware.

Os 32 casos de recursos e a campanha de oito pares controle/mutante passaram (33/33 dirigidos). Os dois novos mutantes removem respectivamente a sanitização do close direto e da limpeza de construção. Ambos devem reprovar pela assertion nomeada, com controle correto aprovado. Os seis mutantes anteriores permanecem; nenhum teste foi removido ou relaxado.

O ajuste não muda DDL, dependências, pins, workflows, quotas, native C, jobs ou o coordenador ainda ausente. A matriz completa desta continuação será registrada no JSON de evidências e no PR. Resultados anteriores permanecem históricos, não aprovação herdada.

Matriz local desta resolução, executada em Node 22.17.1 / TypeScript 5.9.3: coordenação **53/53**, core **198/198**, storage **155/155**, componentes **25/25**, testemunha **4/4**, dois typechecks, build e cinco verificadores documentais aprovados. Core/storage executados em série no computador compartilhado; comandos e timeouts de CI inalterados. Os 53 casos são 17 nativos anteriores, três observações de fronteira, 32 comportamentos de recursos e uma campanha de oito pares controle/mutante. Nenhuma contagem de filhos foi adicionada.

A integração remota exige os sete workflows/dez jobs no novo head, com logs próprios e comparação de árvores. A resolução de código não é aprovação herdada do CI anterior. A issue #33 deve ser encerrada somente após esse gate; o WP-02/#5 continua aberto.
