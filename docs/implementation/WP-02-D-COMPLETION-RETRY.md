# WP-02/D5 — repetição explícita de persistência de recibo

Base de integração `bc4295951118e1c4cbc36097e87013f7f136bdd3`, após os PRs #37/#38. Continuidade da [issue #5](https://github.com/gmhelmold/context-continuity/issues/5); contrato em [SPEC-20](../../specs/v0.1/20-local-completion-receipts.md). O patch candidato da conversa foi preparado em bd62cf0: os dois arquivos-base continuavam idênticos, e as entregas posteriores foram preservadas. Não há implementação alternativa a reaplicar depois desta branch.

## Problema e correção

Na base, a observação emitida após settlement ficava somente na variável local de `#perform`. Erro ao adquirir o lock ou gravar o recibo saía pelo finally, removendo o acompanhamento e perdendo o caminho de persistência daquela observação. A conclusão inicial foi de leitura estática; não se atribui uma reprodução executada ao relatório anterior da conversa.

O supervisor agora conserva no máximo uma pendência por sessão antes da primeira gravação. Ela contém somente lease/referências/handle de observação originais; não guarda resposta, callback ou Promise. Erro de gravação conserva a pendência. Sucesso na API de storage remove a pendência mesmo se, depois, faltar autoridade para publicar o resultado antigo.

`flushLocalCompletion(binding, expected): boolean` repete exclusivamente a persistência desse fato sob o mesmo participante original. Entradas e associação exata são conferidas; o serviço de storage revalida hold, identidade e observação. Erro em flush conserva a pendência; sucesso completo da seção a remove. `false` significa ausência de pendência local, não ausência de recibo no banco. Pós-commit incerto usa a idempotência já implementada.

Nenhum flush invoca adaptador, cancela job, publica resultado, confirma run, recupera automaticamente ou modifica custos. `recoverJobs` permanece separado, com lease vigente. Uma nova execução da mesma sessão não pode sobrescrever sua pendência. Sessões distintas permanecem independentes.

## Fronteira de fechamento e durabilidade

A política existente de close é mantida: execução pendente impede fechar; fechamento deliberado depois da execução abandona a observação ainda em memória, sem escrever ou liberar quarentena. O chamador deve solicitar flush antes de close quando deseja conservar o fato. Crash antes da persistência continua incerto. Não há novo journal, prova de morte de processo, transporte HTTP ou autorização de inferência. A Promise do adaptador confiável ainda deve incluir todo cleanup.

## Provas e rastreabilidade

`completion-retry.test.mjs` usa SQLite e locks reais, com fontes/adaptadores sintéticos e injeções identificadas nas fronteiras de recibo/resultado. Os onze casos iniciais cobrem falha transitória, flush que também falha, troca de proprietário, binding/geração divergentes, ausência de observação, close explícito, falha após recibo confirmado, erro pós-commit, Promise pendente, rollback e rejeição da operação. Conferem contadores, run, proposta, ausência de capítulos e invocação única.

`completion-retry-mutations.test.mjs` exige quatro pares controle/mutante: perda da observação, remoção antes da gravação, consumo num flush falho e falta de conferência da geração. Cada controle deve passar; sua cópia incorreta deve falhar no teste nomeado com ERR_ASSERTION. Timeout/import/build/setup não contam como detecção. Cada par é um caso.

Toda compilação, typecheck e execução ocorrem no GitHub Actions. O patch anterior não foi testado localmente e nenhuma validação local é apresentada como CI. O PR e a issue #5 devem registrar os resultados reais, SHA, workflows/jobs e comparação das árvores depois do merge. O registro de pré-publicação não antecipa PASS. Não alterar os comandos, prazos ou versões fixadas para acomodar este corte.

## Cinco axiomas

**Success Criteria:** uma falha de gravação não descarta a observação numa instância aberta; flush conserva apenas o fato, sem replay nem publicação da resposta.

**Quality Standards:** componentes reais, dados sintéticos, controle positivo e assertion negativa específica; todos os testes no Actions e logs do head exato.

**Completeness Criteria:** sucesso/falha antes e depois do commit, identidade original, lease substituído, ausência de observação, idempotência, fechamento e preservação de estado remoto/custos.

**Definition of Done:** código/contrato/testes alinhados, matriz completa do head final aprovada, logs lidos, árvore integrada correspondente e issue #5 atualizada sem encerrar o WP-02 inteiro.

**Invariants:** sem nova chamada, recibo fabricado, nova autorização ou liberação por TTL/retired; nenhum DDL, dependência, pin de runtime, workflow ou configuração pessoal modificado.
