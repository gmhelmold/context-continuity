# WP-02/A — inspeção consistente da abertura SQLite

**Base:** `777ecafb4e6feb0bd8b6343e8d2aa5ff300fff7a`. Continuação corretiva da [fundação de storage](WP-02-A.md), issue #5. Não implementa captura/persistência de raízes ou fontes nem encerra WP-02.

## Achado e correção

A inspeção de abertura executava PRAGMAs, leituras do esquema/meta e verificações de integridade sem uma transação de leitura abrangente. Consultas sucessivas podiam observar commits diferentes. A criação do schema e a inicialização Session/View0 já eram transacionais; esta lacuna estava no reconhecimento do banco depois da criação e nas duas inspeções de open.

A função inspect agora abre uma transação de leitura curta, executa a inspeção integral e termina com COMMIT. Erro termina com ROLLBACK antes do fechamento da conexão pelo chamador. A negociação de WAL e a transação de bootstrap continuam fora dessa transação; não se tenta mudar journal_mode dentro de BEGIN. Nenhum esquema, API pública, driver, dependência ou timeout foi alterado.

Isso garante coerência de cada inspeção, não exclusividade eterna contra outros processos. Uma escrita posterior pode criar nova versão; operação de negócio continua obrigada a usar sua própria transação e conferir escopo/fence. Não há promessa de bloquear processo hostil do mesmo usuário nem de certificar storage remoto/hardware.

## Provas antes/depois

Quatro regressões em tests/storage/inspection-snapshot.test.mjs foram executadas ANTES da correção. Todas falharam por assertions próprias, sem erro de setup: ausência de transação na criação; ausência nas duas inspeções de abertura; leitor vendo o contador sintético mudar de 0 para 123 durante uma inspeção; falta de rollback no caminho de recusa do workspace.

Depois da correção, as mesmas quatro passaram. O teste de concorrência usa duas conexões SQLite reais num diretório temporário: o escritor confirma uma atualização válida, o leitor continua vendo 0 até encerrar sua transação, e uma conexão nova observa 123. A instrumentação controla a barreira de leitura; não substitui SQLite por um mock. O teste de erro confere rollback e close, seguido de uma abertura válida.

A regressão não demonstrou aceitação de banco corrompido; demonstrou mistura de versões observáveis e ausência de isolamento da inspeção. Não extrapolar além dessa prova. As campanhas anteriores e os testes de schema/commit/fencing permanecem obrigatórios.

## Ajuste da barreira da fixture e execução local

A primeira execução conjunta terminou 41/43: houve timeout no controle positivo da campanha anterior, que NÃO contou como detecção, e a fixture de crash observou o arquivo de barreira ainda vazio entre sua criação e escrita. A barreira agora grava um arquivo temporário próprio e o publica por rename somente depois de concluir a escrita. A assertion continua exigindo o conteúdo exato; não há retry do produto nem aumento de timeout. O caminho de crash/bootstrap e os limites dos subprocessos permanecem iguais.

A repetição local é sequencial para não sobrepor campanhas pesadas no computador compartilhado. O CI preserva seus comandos padrão e seus pins. Resultados de repetição não apagam as falhas registradas nem se somam às contagens de casos.

## Escopo do trabalho adiado nesta execução

Duas chamadas de edição para os novos módulos de raízes/fontes foram recusadas pela ferramenta antes da execução, com status de segurança indeterminado. Nenhum desses módulos existe neste incremento. Não é ausência de autorização de GitHub; o avanço de persistência de conteúdo continua rastreado em #5. O rascunho local não utilizado foi retirado, sem publicar uma especificação que alegasse ter sido implementada.

A presente correção atua exclusivamente na inspeção da fundação existente e foi executada separadamente; não contorna a recusa nem publica o conteúdo das edições recusadas. Não reaplicar ZIPs históricos ou criar API paralela.

## Critérios e limites

**Success Criteria:** cada inspeção observa um snapshot consistente; writer concorrente confirma sem que o reader misture versões.

**Quality Standards:** SQLite/FS reais; barreira determinística; quatro assertions falham antes e passam depois; perfis e pins existentes preservados.

**Completeness Criteria:** criação, abertura em duas fases, concorrência, rollback e uso posterior sem transação residual; documentos/erro/runtime coerentes.

**Definition of Done:** typechecks, todos os testes de storage/core e os seis workflows/oito jobs no head final passam, logs conferidos, árvore integrada comparada; issue #5 permanece aberta.

**Invariants:** sem transação de escrita nova, sem criação implícita, sem migração, sem alterações em dados de usuário, sem inferência ou redução dos testes existentes.

## Reprodução

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check:storage
npm run test:storage
npm run check:core
npm run test:core
node --test tests/conformance/opencode/test-components.mjs tests/conformance/opencode/test-review004.mjs
python3 tests/conformance/opencode/test-witness.py
python3 scripts/check-spec.py
python3 scripts/check-reference-model.py
python3 scripts/test-spec-check.py
python3 scripts/check-canonical.py
python3 scripts/check-storage-contracts.py
```

As contagens finais e resultados dos comandos ficam no PR/issue do commit validado. Listar comandos não equivale a executá-los. Revisão do autor, sem auditoria independente ou homologação do plugin completo.

Evidência de antes/depois e hashes: [WP-02-A-inspection.json](evidence/WP-02-A-inspection.json). A suíte completa e o CI têm seus resultados próprios no head publicado.
