# SPEC-20 — término local observado e recuperação (WP-02/D5)

Refina [SPEC-15](15-durable-jobs.md) e [SPEC-19](19-local-attempt-supervisor.md). Este corte conserva uma observação de término do adaptador local mesmo após troca do lease da sessão. Não observa morte de processos, não implementa HTTP e não libera quarentena por TTL, lock disponível ou owner retired.

## Problema e fronteira

O supervisor original pode observar a conclusão da Promise depois que outra conexão assumiu a sessão. A resposta antiga continua sem autoridade para publicar. Entretanto, descartar também a observação de término impede que a nova conexão reconcilie uma execução já encerrada. Separamos o fato de término da autorização para alterar a geração.

A Promise nativa do adaptador interno confiável deve abranger toda a operação e seu cleanup. Esse pressuposto não certifica adaptadores arbitrários, subprocessos destacados ou processamento remoto. Retorno inválido, thenable, exceção síncrona e interrupção anterior ao settlement não produzem recibo.

## Observação local

O observador interno captura o digest da AttemptOwnership antes de observar a Promise por seu método nativo. Somente seus callbacks de resolução/rejeição emitem um handle imutável registrado localmente. O handle inclui a identidade completa da tentativa por digest; cópias, JSON, booleanos e handles de outra tentativa não são aceitos. Não existe parser que restaure um handle a partir de dados persistidos.

O supervisor obtém a identidade persistida da tentativa antes de invocar o adaptador. Depois de settlement observado, tenta conservar o recibo antes de verificar o lease atual para a publicação do resultado. A falta de autoridade de publicação continua sendo E_OWNER. Uma falha de gravação não fabrica um recibo nem libera a execução.

## Recibo durável

O envelope existente de `attempts.usage_json` aceita um campo opcional `local_stop`, sem mudança de DDL. Os campos `value` e `digest` de propriedade permanecem inalterados. Ausência de `local_stop` significa ausência de observação; `null`, versão desconhecida, formato inválido ou checksum divergente são recusados.

Recibo v1: `{schema_version:1, kind:"native_promise_settled", digest}`. O digest é SHA-256 da canonicalização de `{domain:"context-continuity.local-stop.v1", ownership:<AttemptOwnership>}`. Não inclui horário/TTL nem afirma resultado remoto. O checksum detecta inconsistência, não adulteração coordenada de todo o banco por quem já pode reescrevê-lo.

A gravação exige o store original, SessionBinding/JobContextRef/AttemptRef e fence originais, o hold vivo do mesmo storage owner/process_instance e o handle de observação correspondente. O lease da sessão pode ter expirado ou sido substituído: essa exceção autoriza somente acrescentar o recibo, nunca modificar status/proposta/local_state/remote_state/custos. Tombstone, encarnação e epoch continuam sendo verificados. O hold é revalidado antes do commit. Gravação repetida idêntica é idempotente; não há substituição de recibos ou reaproveitamento em outro run.

## Recuperação explícita

`recoverJobs` continua exigindo o lease atual, com fence verificado antes/depois da transação. Primeiro reconcilia os estados interrompidos existentes. Só então uma tentativa em quarantine de job terminal pode passar a stopped quando existe recibo íntegro da identidade original e seu fence corresponde ao snapshot desse job.

Essa transição modifica apenas `aux_runs.state` e `aux_runs.local_stopped`, por compare-and-swap na mesma transação. Conserva status/proposta do job, estado da tentativa, remote_state, custos, contadores e histórico. Não cria tentativa, capítulo, chamada ou crédito de uso. Repetir recovery ou reabrir o banco não inicia rede. Um job ativo não é liberado apenas pela presença de recibo.

Sem recibo, a execução permanece protegida, inclusive depois de fechar/aposentar o owner, reiniciar o processo ou expirar o lease. Crash antes de conservar a observação continua incerto; este corte não implementa uma prova independente de morte do executor.

## Cinco axiomas

**Success Criteria:** uma observação real sobrevivente permite ao novo proprietário reconciliar o slot, sem aceitar a resposta antiga ou repetir execução.

**Quality Standards:** toda compilação e teste no GitHub Actions; SQLite/locks/processos reais com dados sintéticos; regressão antes/depois e controles negativos com assertion específica. Timeout/setup não são detecção.

**Completeness Criteria:** troca de proprietário antes/depois do settlement, resolução/rejeição, protocolo inválido, scope/fence/hold/handle incorretos, idempotência, rollback e reinício; custos e estado remoto preservados.

**Definition of Done:** contrato/implementação/testes alinhados, matriz no commit final com logs conferidos, árvore integrada correspondente e rastreabilidade na issue #5. Não encerra WP-02 inteiro.

**Invariants:** recibo não é permissão de publicação ou transporte; nenhum TTL/retired equivale a stopped; nenhum replay/estorno; nenhuma fonte pessoal, descritor ou credencial nos testes.

## Observação pendente após erro de persistência

O supervisor mantém no máximo uma observação pendente por sessão, somente dentro da instância original. O registro em memória contém o handle já emitido, o lease original e as referências da geração/tentativa; não retém a resposta, o callback ou a Promise. O término do acompanhamento da operação não descarta uma observação cuja gravação falhou. O erro original continua sendo reportado; não há backoff, timer ou repetição automática de inferência.

`flushLocalCompletion(binding, expected)` tenta exclusivamente gravar a observação pendente correspondente. Revalida os dados de entrada, o workspace e a associação exata, e reutiliza `recordObservedLocalCompletion` sob um novo hold do participante original. `true` significa que essa gravação retornou com sucesso e a pendência local foi removida. `false` significa que a instância não tinha pendência para a sessão; não é consulta sobre a existência de recibo no banco. Uma referência de geração divergente não pode consumir a pendência de outra geração.

Falha ao adquirir o lock, verificar a associação ou gravar preserva a pendência para outra chamada explícita. Erro percebido depois de um commit pode gerar uma repetição idempotente do mesmo recibo, nunca outra tentativa de modelo. Perda do lease atual não troca a identidade original conservada. A operação não grava resposta/status do job, não sinaliza abort, não altera run ou custos e não chama recovery: o proprietário vigente ainda precisa usar `recoverJobs` conforme o contrato anterior.

`start` recusa uma nova operação na mesma sessão enquanto a instância conserva uma pendência, sem afetar sessões diferentes. Retorno inválido, throw síncrono e thenable não observado não criam pendência. Se o recibo foi gravado e somente a gravação do resultado falhou, não se recria uma pendência de recibo nem se reaplica o resultado.

A política existente de fechamento permanece explícita: `close` recusa operações ainda em execução, mas não tenta persistência implicitamente. Depois da execução, fechar a instância abandona somente a observação em memória; não fabrica recibo nem libera quarentena. O chamador deve solicitar o flush antes de fechar quando pretende conservar esse fato. Crash, conexão inutilizada ou fechamento antes de uma gravação bem-sucedida continuam sujeitos à incerteza durável já documentada. Esta extensão não é um journal durável alternativo nem uma prova de morte de processo.

Registro da implementação e gate: [WP-02/D5 — repetição de persistência](../../docs/implementation/WP-02-D-COMPLETION-RETRY.md).
