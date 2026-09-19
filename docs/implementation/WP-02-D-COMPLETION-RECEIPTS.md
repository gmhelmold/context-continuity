# WP-02/D5 — recibos de término e recuperação explícita

Base `c5371cd11943b1fc426411971006f9bcc361f049`, [PR #37](https://github.com/gmhelmold/context-continuity/pull/37), continuidade de [WP-02 / #5](https://github.com/gmhelmold/context-continuity/issues/5). Contrato: [SPEC-20](../../specs/v0.1/20-local-completion-receipts.md). S01/S02 pertencem ao PR #36 já integrado; não reaplicar seus patches ou pacotes locais.

## Entrega

O supervisor original pode perder o lease da sessão enquanto sua operação ainda está em execução. Sua resposta continua sem autoridade para publicar, mas a observação de término não precisa ser descartada. Este incremento separa a persistência desse fato da autoridade vigente para alterar o estado do job.

`local-completion.ts` observa a Promise nativa do adaptador interno por seu método nativo. O digest da propriedade da tentativa é capturado antes da espera. Somente os callbacks de settlement emitem `LocalStopObservation`, imutável e registrado em memória. Dados copiados/deserializados, booleanos e observações de outra identidade não substituem o handle. Thenables arbitrários e retorno síncrono não produzem evidência de término. A Promise do adaptador confiável deve abranger toda a execução e seu cleanup.

O supervisor captura os campos da propriedade vinculada atomicamente à reserva. Depois de observar a conclusão, tenta persistir o recibo antes de verificar o lease atual para gravar o resultado. O armazenamento confere novamente os campos contra a propriedade persistida. Perder o lease não permite publicar uma proposta antiga nem atualizar custos ou estado remoto.

`recordObservedLocalCompletion` exige o store original, a geração original, a tentativa correspondente, seu handle observado e um `WorkspaceHold` vivo do participante original. A exceção ao lease expirado autoriza exclusivamente acrescentar o recibo em `attempts.usage_json`. Tombstones, encarnação/epoch, associação e recursos continuam verificados. O recibo tem versão, domínio e digest próprios; presença nula, estrutura ou digest inválidos causam recusa. Gravação idêntica repetida é idempotente. O DDL e os campos existentes de propriedade não mudam.

`recoverJobs` permanece explícito e exige o lease atual. Depois da reconciliação normal, somente um job terminal com run em quarentena e recibo íntegro correspondente pode ter `aux_runs.state/local_stopped` atualizados por CAS. Essa transição conserva proposta/status do job, estado da tentativa, `remote_state`, reservas e contadores. Recibo de uma tentativa não libera outra. Ausência de recibo continua sendo ausência de prova, inclusive após aposentadoria do participante ou saída do processo.

## Revisão e provas

A implementação inicial e suas regressões estão no histórico do PR. Os arquivos `completion-observation.test.mjs`, `completion-receipts.test.mjs` e `ownership-digest.test.mjs` cobrem observação, associação, integridade, troca de proprietário, resolução/rejeição, rollback e conservação de incerteza. Os testes anteriores do supervisor e suas onze contraprovas permanecem na matriz.

A revisão de integração acrescenta dois arquivos sem duplicar a implementação:

- `completion-review-processes.test.mjs`: quatro fronteiras, antes/depois do COMMIT da persistência de recibo e da recuperação. SQLite, arquivos e processos são reais; a fixture interrompe somente o filho que criou, após receber a barreira exata. Python verifica o lock do participante independentemente. Outra conexão reabre o banco antes de executar recuperação explícita. São verificados recibo, run, tentativas, contadores, invocação única, ausência de capítulos e idempotência. Interrupção de processo não equivale a queda de energia ou prova de processamento remoto.
- `completion-review-mutations.test.mjs`: sete pares controle/mutante que removem origem local da observação, exigência de observação, integridade/existência do recibo, exigência do store original, fence original e retenção anterior à verificação de proprietário. Cada controle deve passar; o mutante deve falhar no teste selecionado com `ERR_ASSERTION`. Timeout, falha de import/build ou erro de preparação não contam como detecção. Cada par é um caso, não dois.

Toda compilação e execução desta revisão ocorre no GitHub Actions. Não executar a matriz no Mac ou contêiner para substituir esse gate. Os comandos e versões fixados dos workflows permanecem inalterados. Os resultados de cada rodada, SHA, IDs dos jobs e decisão de integração são registrados no PR #37 e na issue #5; não herdar o verde de outro head nem contar uma execução interrompida como aprovada.

## Critérios de conclusão

**Success Criteria:** o proprietário atual recupera uma tentativa comprovadamente encerrada sem aceitar a resposta antiga, repetir execução ou inferir crédito de custo.

**Quality Standards:** implementação real, dados sintéticos, observação independente, antes/depois quando houver correção, controles negativos com motivo específico e validação exclusivamente no Actions.

**Completeness Criteria:** settlement/recusa, scope/fence/store/hold/handle, persistência idempotente, rollback, quatro fronteiras de interrupção, recuperação sem replay e conservação de reserva/estado remoto.

**Definition of Done:** contrato/código/testes alinhados; sete workflows e dez jobs no head final aprovados com logs conferidos; árvore integrada correspondente; registro de encerramento na issue #5 sem encerrar WP-02 inteiro.

**Invariants:** recibo não é permissão de transporte/publicação; TTL, lock livre e participante aposentado não são recibo; nenhuma exclusão ou estorno; nenhum job terminal ressuscitado; nenhum dado pessoal ou credencial em fixture/artefato.

## Fronteiras não implementadas por este corte

Não há prova independente de morte do executor após crash sem recibo. Não há transporte HTTP de produção, AttemptPermit, tratamento de subprocessos destacados, scheduler ou publicação de View. Blobs, pins, staging, coleta de lixo, arquivos portáveis e os demais serviços do WP-02 mantêm seus próprios critérios. O checksum confere consistência, não protege contra quem pode reescrever todo o banco e seus controles. A revisão é do autor, não auditoria independente.
