# SPEC-25 — recuperação identificada de intenção pré-arquivo (WP-02/F3)

**Contrato futuro; nenhuma API F3 está habilitada por este documento nem há evidência runtime.** Refina [SPEC-03 §3](03-ledger.md#3-blobs-quota-e-exclusão-mútua-de-workspace), [§8](03-ledger.md#8-recibos-e-reconciliação-de-reservas-c09c11), [SPEC-18 §§1, 3 e 4](18-workspace-coordinator.md#inicialização-e-identidade-durável) e [SPEC-24 §§3--5](24-staging-intents.md#3-registro-e-identidade). F3 é exceção estreita de autoridade de recuperação à vedação de cancelamento cross-owner em [SPEC-24 §5](24-staging-intents.md#5-cancelamento-e-retomada): só vale para uma intenção *pré-arquivo* identificada após prova de §3, até o mesmo COMMIT. Não é staging físico, writer, GC, descoberta/listagem/scan nem recuperação geral de owner morto. Nenhuma limpeza física existe em F3.

## 1. API e fronteira

`WorkspaceCoordinator.recoverStaging(binding, reservation_id): StagingRecovery` aceita somente binding original completo e UUID canônico. Retorna objeto profundamente imutável `{state: 'held' | 'cancelled', intent: StagingIntent}`. `intent` preserva registro imutável original, inclusive no estado `cancelled` e no histórico; nenhum dado controlado pelo chamador substitui campos persistidos. Método é autoridade F3 excepcional, não cancelamento cross-owner genérico.

Não há listagem, descoberta, scan ou TTL. `readStaging` que devolve `null` não autoriza recuperação. ID ausente devolve `E_CONFLICT`; binding divergente devolve `E_SCOPE`. `null`, lock de workspace disponível, PID, owner retired, idade ou timeout não demonstram liveness nem autorizam cancelamento.

O método não faz I/O de arquivo físico: não cria, abre, escreve, renomeia, fsync, remove ou inspeciona staging. A única abertura de arquivo permitida é arquivo de owner original por ID, para inspeção de liveness conforme §3. Não aposenta/adota owner, não toca jobs, blobs, writer, GC, View, rede ou inferência.

## 2. Registro, identidade e recusas

Antes de qualquer transição, revalidar row e envelope canônicos, fechados e limitados de `StagingIntent`, nos limites de materialização/UTF-8 de SPEC-24 §3. Exigir correspondência exata entre reservation_id, operation_id, max_bytes, kind, binding, owner_id, process_instance, policy_revision, state e checksum. Revalidar workspace, sessão, incarnation, host_epoch e identidade owner/process persistida. Owner `active` precisa corresponder ao owner original; não reconstruir autoridade de partes do registro, JSON, PID ou lock disponível.

Recusar com `E_STORAGE` row/envelope/owner/meta inconsistente, encoding/forma/digest inválido ou registro cancelado sem histórico íntegro. Recusar com `E_CAPABILITY` ausência, substituição ou falha de inspeção de arquivo/identidade de owner. Não converter inconsistência em `held`, `cancelled`, ausência ou cobrança zero.

Recusar recuperação se houver qualquer `managed_files` para `operation_id`; se `staging_path_key` ou `blob_digest` não for null; se kind não for `staging`; ou se registro não for intenção `reserved` pré-arquivo. Não excluir, reparar, mover ou inspecionar conteúdo para tornar intenção elegível. Estes fences mantêm separação de SPEC-03 §3, passos 1--4, e SPEC-24 §5, parágrafos 45--51.

## 3. Ordem e liveness identificado

Ordem obrigatória: workspace flock -> `BEGIN IMMEDIATE` -> revalidações -> inspeção de owner -> CAS/remoção -> guardas finais -> `COMMIT` -> fechar descritor de inspeção -> liberar workspace flock. Segue ordem de [SPEC-03 §3, parágrafo 223](03-ledger.md#3-blobs-quota-e-exclusão-mútua-de-workspace) e guards de [SPEC-24 §4, parágrafos 35--37](24-staging-intents.md#4-admissão-replay-e-quota). Falha de rollback inutiliza conexão conforme [SPEC-18 §4, parágrafo 49](18-workspace-coordinator.md#diagnóstico-e-aposentadoria).

Para owner atual, retornar `held` sem alterar reserva, envelope ou cobrança. Para owner estrangeiro `active`, abrir sem criar `owners/<owner_id>.lock`, exigir identidade `{dev,ino}` persistida exata e tentar lock exclusivo sem bloquear. Lock ocupado devolve `held`, preservando tudo. Manter lock de inspeção até `COMMIT`. Ausência de lock, identidade divergente, arquivo substituído ou erro de inspeção devolve `E_CAPABILITY`, preservando reserva/cobrança.

Só owner estrangeiro `active`, identidade exata e lock de inspeção adquirido prova sem detentor para esta intenção identificada. Não é prova geral de morte, não autoriza aposentadoria e não libera outra reserva. Esta leitura restrita aplica [SPEC-03 §8, parágrafos 271--277](03-ledger.md#8-recibos-e-reconciliação-de-reservas-c09c11) sem executar reconciliação geral, e preserva limites de [SPEC-18 §4, parágrafos 41--49](18-workspace-coordinator.md#diagnóstico-e-aposentadoria).

## 4. Transição e repetição

Guardas finais, ainda sob ambos locks e antes de `COMMIT`, revalidam recovery participant active e seu arquivo/identidade `{dev,ino}`/process_instance/lock originais; revalidam owner original inspecionado active e seu arquivo/identidade/process_instance/lock de inspeção; e comparam binding, workspace, sessão/incarnation/host_epoch, reserva e envelope. CAS exato inclui reservation_id, owner_id, process_instance e identidade persistida de ambos owners, além de estado `reserved`, kind `staging`, path/digest null e checksum. Zero-row CAS é conflito/rollback, nunca autorização.

Após prova de owner estrangeiro sem lock, somente intenção `reserved` pré-arquivo ainda revalidada pode, na mesma transação, remover sua reserva e fazer CAS de envelope `reserved` para `cancelled`. Retorno é `{state: 'cancelled', intent}` com intenção original imutável. Remoção e CAS são atômicos; quota libera exatamente uma vez.

Falha antes de `COMMIT`, inclusive guarda final/CAS/rollback, preserva reserva, envelope e cobrança; rollback falho também inutiliza conexão. Erro percebido após `COMMIT` pode deixar histórico `cancelled`; repetição com mesmo binding e UUID devolve `cancelled` idempotente, sem inspecionar owner e sem nova liberação. Um registro `cancelled` íntegro não reabre, não readmite e não vira `held`.

## 5. Provas e limites

| Fronteira | Evidência requerida no Actions |
| --- | --- |
| API | Tipos/getters estritos; UUID e binding completos; retorno e intent profundamente imutáveis. |
| Identidade | Owner, inode, process_instance, workspace, binding, sessão/incarnation e host_epoch exatos; owner atual e owner estrangeiro divergente recusados. |
| Liveness | Lock ocupado devolve held; lock livre somente após identidade de arquivo original; ausência, replacement e erro preservam cobrança com E_CAPABILITY. |
| Pré-arquivo | managed_files de todos estados, path/digest não null, kind não-staging, cancelled e row/meta/owner inconsistente recusam sem efeito físico. |
| Atomicidade | Barreiras de rollback/pré-commit/pós-commit; CAS atômico; repetição pós-commit; quota conserva ou libera exatamente uma vez. |
| Processos | SQLite, flock e subprocessos reais em diretórios sintéticos; barreiras de kill antes/depois de commit; lock de inspeção persiste até commit. |
| Contraprovas | Controle nomeado e mutantes para owner lock/identidade, owner match, fence pré-arquivo e CAS atômico, cada qual reprovado pela assertion correspondente. |

Vínculo normativo: F3 pertence ao [WP-02](WORK-PACKAGES.md#wp-02--ledger-e-persistência-transacional) e cobre somente fronteira pré-arquivo da rastreabilidade existente R19 / [T19.storage](06-acceptance.md#t19--fonte-antes-da-poda). Não cria R/T, não altera seus donos/status `not_run` e não declara execução. Não contar setup/import/timeout/sinal como detecção. Executar matriz herdada completa somente no Actions. Verde documental não aprova API, recuperação física, staging nem WP-02 completo.

Revisão contratual executa todos os gates documentais de [README §Verificações desta etapa](README.md#verificações-desta-etapa): `check-spec.py`, `check-reference-model.py`, `test-spec-check.py`, `check-canonical.py`, `check-storage-contracts.py` e componentes OpenCode. Implementação futura acrescenta provas desta tabela, contraprovas com controle positivo e matriz herdada no Actions; gates documentais não contam como evidência runtime.

## 6. Cinco axiomas

**Success Criteria:** intenção identificada e comprovadamente sem detentor pode cancelar atomicamente antes de arquivo; owner atual/ocupado conserva reserva; cobrança nunca duplica nem some sem CAS.

**Quality Standards:** SQLite, locks e processos reais em diretórios sintéticos; tipos/imutabilidade, barreiras de commit e contraprovas nomeadas; matriz herdada somente Actions.

**Completeness Criteria:** binding/owner/inode/process exatos, envelope limitado/canônico, fence pré-arquivo, liveness busy/unheld/replacement, rollback/pós-commit, kill barriers e contabilidade exatamente-uma-vez demonstrados.

**Definition of Done:** implementação, tipos, testes de processo/mutação e matriz herdada no mesmo head, com evidência rastreável. Este contrato não conclui F3, staging físico, recuperação geral de owner nem WP-02.

**Invariants:** sem descoberta/scan/TTL, adoção/aposentadoria de owner, I/O físico de staging, jobs/blobs/writer/GC/View/rede/inferência, alteração de schema ou liberação de reserva sem CAS confirmado.
