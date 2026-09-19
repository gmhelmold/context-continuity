# SPEC-21 — pins duráveis de fontes inline (WP-02/E1)

Refina SPEC-03/14/18. Registra reservas de leitura/exportação sob o coordenador existente; não implementa leitura assíncrona, blob externo, GC, limpeza cross-owner ou verificação nova dos bytes. O escopo deste corte é o ciclo persistido do pin, não o reader/exportador completo.

## API e identidade

`WorkspaceCoordinator.pinSource(binding, {reservation_id,operation_id,kind,source_ref})` aceita somente `read_pin` ou `export_pin`, IDs UUID canônicos e SourceRef completo. O fluxo autorizado escolhe os IDs antes da chamada para consultar/repetir uma admissão cujo resultado ficou incerto. Não aceita path, SQL ou owner arbitrário. O proprietário é sempre a instância com lock real mantido.

A aquisição segue workspace flock -> BEGIN IMMEDIATE -> validação de sessão/incarnation/epoch/tombstone e metadados da fonte -> reserva + envelope -> validação do owner -> COMMIT. Sem fonte inline capturada com identidade exata, recusa. `sourceMetadata` canônico é reutilizado; não materializa BLOB nem refaz SHA-256. Pin não significa conteúdo autenticado. Readers devem verificar bytes e revalidar política/incarnation antes de entregar dados.

`storage_reservations` mantém owner, operação, kind, sessão/incarnation, tamanho zero, sem staging_path_key ou blob_digest. Zero evita contar novamente bytes inline já contabilizados. Isso não aumenta quota de bytes nem autoriza escrita. O envelope em `meta['storage.source-pin.v1:<UUID>']` conserva SourceRef, binding completo, owner/process_instance, policy_revision, estado e timestamp UTC. Checksum liga todos os campos; leituras comparam também a linha de reserva e o participante. Checksum detecta inconsistência, não autentica um banco inteiramente reescrito por código com acesso.

Limite deste perfil: 4096 reservas read/export ativas por workspace, incluindo reservas já existentes. O limite é de entradas ativas, não tokens ou bytes. A operação que preencher a última vaga é aceita; a próxima é E_BUDGET. Replay exato de pin ativo do mesmo participante não cria vaga, timestamp ou nova linha, mas revalida sessão, fonte e política. IDs usados com outra operação/fonte/kind não são reutilizáveis.

## Leitura e liberação

`readSourcePin(binding,id)` é diagnóstico imutável, sob snapshot SQLite e lock de workspace. Outro participante do mesmo workspace pode inspecionar o registro; não pode adotá-lo. Uma reserva liberada continua visível como `released`; ausência completa devolve null. Linha e envelope incompletos/contraditórios são E_STORAGE, não ausência ou legado.

`releaseSourcePin(binding,id)` exige o binding original e o participante emissor ainda válido. Remove somente a linha de reserva e marca o envelope `released`, juntos na transação. Não apaga conteúdo, token budgets, arquivo, job ou owner. Devolve true na primeira liberação e false na repetição. Identificador desconhecido é E_CONFLICT; um identificador liberado nunca pode ser readmitido. O registro histórico impede uma liberação atrasada de afetar outra reserva com o mesmo ID.

Liberação não exige que a fonte continue capturada nem que a sessão ainda exista/tenha a política antiga: limpeza do próprio pin continua possível após exclusão ou mudança de política, usando o binding que foi fixado na admissão. Isso não autoriza retornar dados antigos. Novo pin ou replay ativo continua recusando tombstone ou política divergente.

Close ou crash do participante não apaga pins. As reservas continuam impedindo sua aposentadoria automática pelo coordenador. Outro participante não libera pins por TTL, idade, lock livre ou recibo de término de job. Reconciliação cross-owner e readers que mantêm handles de conteúdo terão contratos próprios. Os envelopes liberados permanecem como histórico/tombstones pequenos; não há coleta automática deles neste corte.

## Cinco axiomas

**Success Criteria:** pin e associação são atômicos, escopo e proprietário não são intercambiáveis, duplicação/retorno incerto não recriam reservas, liberação conserva conteúdo.

**Quality Standards:** SQLite/locks/processos reais com fontes sintéticas; testemunha Python; barreiras de commit; mutação com controle positivo e assertion específica; toda compilação e teste no Actions.

**Completeness Criteria:** read/export, replay, capacidade, IDs liberados, tombstones/policy, metadata inválida, proprietário distinto, recusa de blob, erros parciais, disputa e reabertura antes/depois de commit.

**Definition of Done:** testes e matriz completa nos pins existentes, logs do head conferidos, diff revisado, árvores testada/integrada iguais, issue #5 atualizada sem concluir WP-02 ou GC.

**Invariants:** sem exclusão de conteúdo, sem estorno de tokens, sem inferência, sem liveness por TTL, sem permissões por JSON, sem desbloqueio cross-owner, sem alteração do DDL.
