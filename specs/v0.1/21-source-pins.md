# SPEC-21 — pins duráveis de fontes inline (WP-02/E1–E3)

Refina SPEC-03/14/18. E1 registra reservas de leitura/exportação sob o coordenador existente; E2 acrescenta leitura síncrona verificada de uma fonte inline. E3 acrescenta recuperação explícita de um pin cujo participante original não detém mais seu lock verificado. Não implementa leitura assíncrona, blob externo ou GC. O ciclo persistido do pin e a cópia de bytes verificada não constituem o reader/exportador completo.

## API e identidade

`WorkspaceCoordinator.pinSource(binding, {reservation_id,operation_id,kind,source_ref})` aceita somente `read_pin` ou `export_pin`, IDs UUID canônicos e SourceRef completo. O fluxo autorizado escolhe os IDs antes da chamada para consultar/repetir uma admissão cujo resultado ficou incerto. Não aceita path, SQL ou owner arbitrário. O proprietário é sempre a instância com lock real mantido.

A aquisição segue workspace flock -> BEGIN IMMEDIATE -> validação de sessão/incarnation/epoch/tombstone e metadados da fonte -> reserva + envelope -> validação do owner -> COMMIT. Sem fonte inline capturada com identidade exata, recusa. `sourceMetadata` canônico é reutilizado; não materializa BLOB nem refaz SHA-256. Pin não significa conteúdo autenticado. Readers devem verificar bytes e revalidar política/incarnation antes de entregar dados.

`storage_reservations` mantém owner, operação, kind, sessão/incarnation, tamanho zero, sem staging_path_key ou blob_digest. Zero evita contar novamente bytes inline já contabilizados. Isso não aumenta quota de bytes nem autoriza escrita. O envelope em `meta['storage.source-pin.v1:<UUID>']` conserva SourceRef, binding completo, owner/process_instance, policy_revision, estado e timestamp UTC. Checksum liga todos os campos; leituras comparam também a linha de reserva e o participante. Checksum detecta inconsistência, não autentica um banco inteiramente reescrito por código com acesso.

Limite deste perfil: 4096 reservas read/export ativas por workspace, incluindo reservas já existentes. O limite é de entradas ativas, não tokens ou bytes. A operação que preencher a última vaga é aceita; a próxima é E_BUDGET. Replay exato de pin ativo do mesmo participante não cria vaga, timestamp ou nova linha, mas revalida sessão, fonte e política. IDs usados com outra operação/fonte/kind não são reutilizáveis.

## Leitura e liberação

`readSourcePin(binding,id)` é diagnóstico imutável, sob snapshot SQLite e lock de workspace. Outro participante do mesmo workspace pode inspecionar o registro; não pode adotá-lo. Uma reserva liberada continua visível como `released`; ausência completa devolve null. Linha e envelope incompletos/contraditórios são E_STORAGE, não ausência ou legado.

`releaseSourcePin(binding,id)` exige o binding original e o participante emissor ainda válido. Remove somente a linha de reserva e marca o envelope `released`, juntos na transação. Não apaga conteúdo, token budgets, arquivo, job ou owner. Devolve true na primeira liberação e false na repetição. Identificador desconhecido é E_CONFLICT; um identificador liberado nunca pode ser readmitido. O registro histórico impede uma liberação atrasada de afetar outra reserva com o mesmo ID.

Liberação não exige que a fonte continue capturada nem que a sessão ainda exista/tenha a política antiga: limpeza do próprio pin continua possível após exclusão ou mudança de política, usando o binding que foi fixado na admissão. Isso não autoriza retornar dados antigos. Novo pin ou replay ativo continua recusando tombstone ou política divergente.

Close ou crash do participante não apaga pins. As reservas continuam impedindo sua aposentadoria automática pelo coordenador. Outro participante não libera pins por TTL, idade, lock livre sem identidade verificada ou recibo de término de job. A exceção de recuperação segue integralmente o protocolo E3 abaixo; readers que mantêm handles de conteúdo terão contratos próprios. Os envelopes liberados permanecem como histórico/tombstones pequenos; não há coleta automática deles neste corte.

## Leitura verificada E2

`WorkspaceCoordinator.readPinnedSource(binding,id): RetainedSource` retorna uma cópia própria de uma fonte inline já fixada por pin ativo read/export do MESMO participante. A consulta diagnóstica acima permanece distinta e não concede esse direito. Pin ausente/liberado é E_CONFLICT; participante diferente é E_OWNER. O binding completo, tombstone e política atual da sessão são novamente conferidos antes de materializar conteúdo. Política divergente é E_CONFLICT; sessão ausente, encarnação/epoch diferente ou tombstone é E_SCOPE. O chamador não fornece um SourceRef substituto: os bytes são os da referência persistida no pin.

Ordem: workspace flock -> BEGIN de leitura -> registro/envelope/owner -> política e binding atuais -> `loadSource` canônico -> guardas finais -> COMMIT -> liberação do lock -> retorno. Registro, política e conteúdo pertencem a um único snapshot SQLite. Falha de COMMIT, guarda ou liberação impede o retorno normal do resultado. Não cria reserva nem abre transação de escrita por efeito da leitura. A exclusão cobre participantes que respeitam o protocolo do workspace; não é sandbox contra outro código autorizado a reescrever o banco diretamente.

`loadSource` conserva o limite inclusivo existente de 256 KiB e confere tamanho/representação antes do SELECT de BLOB. Recalcula SHA-256 a cada chamada. Conteúdo indisponível, representação externa ou digest divergente é recusado como E_SOURCE; não reutiliza confiança de leitura anterior. O objeto e metadados são imutáveis; o array de bytes é uma cópia própria mutável pelo consumidor, sem alias para o banco ou outra chamada.

Não encerra nem consome o pin: a liberação permanece explícita. Sucesso/falha não altera fontes, jobs, tentativas, contadores ou reservas. Após retorno, o consumidor possui apenas dados correspondentes àquele snapshot, não um permit de publicação ou garantia sobre mudanças posteriores. Redação/política posterior não pode revogar uma cópia já entregue; reenviar/publicar/exportar exige a validação de sua fronteira própria. Não há stream, callback assíncrono, arquivo exportado, leitor de blobs ou promessa de GC implementado.

## Cinco axiomas

**Success Criteria:** pin e associação são atômicos, escopo e proprietário não são intercambiáveis, duplicação/retorno incerto não recriam reservas, liberação conserva conteúdo. A leitura E2 entrega somente bytes verificados do pin ativo e da política vigente no snapshot.

**Quality Standards:** SQLite/locks/processos reais com fontes sintéticas; testemunha Python; barreiras de commit; mutação com controle positivo e assertion específica; toda compilação e teste no Actions.

**Completeness Criteria:** read/export, replay, capacidade, IDs liberados, tombstones/policy, metadata inválida, proprietário distinto, recusa de blob, erros parciais, disputa e reabertura antes/depois de commit. E2 acrescenta cópias independentes, digest de mesmo tamanho, ausência de cache, limite inclusivo, aquisição de lock anterior à transação, snapshot único, falha de COMMIT e reabertura sem adoção de pin antigo.

**Definition of Done:** testes e matriz completa nos pins existentes, logs do head conferidos, diff revisado, árvores testada/integrada iguais, issue #5 atualizada sem concluir WP-02 ou GC. O [registro E2](../../docs/implementation/WP-02-E-PINNED-READ.md) define os cenários e a origem das evidências.

**Invariants:** sem exclusão de conteúdo, sem estorno de tokens, sem inferência, sem liveness por TTL, sem permissões por JSON, sem liberação cross-owner fora do protocolo E3, sem alteração do DDL. Leitura não consome pin nem fabrica autorização para usos posteriores.

## Recuperação explícita E3

`WorkspaceCoordinator.recoverSourcePin(binding,id): SourcePinRecovery` opera sobre exatamente um pin inline read/export já identificado. Retorna `{state:"held"|"released",pin}` imutável. Pin desconhecido é E_CONFLICT; binding divergente é E_SCOPE; registro/reserva inválidos são E_STORAGE. Não enumera o histórico nem varre BLOBs. A liberação normal pelo emissor continua em `releaseSourcePin`.

Ordem: workspace flock -> BEGIN IMMEDIATE -> validar pin/reserva/owner e identidade persistida -> abrir SEM criar o arquivo original -> comparar dev/ino -> tentar flock exclusivo SEM esperar -> liberação da reserva + tombstone released -> guardas de ambos os participantes/paths -> COMMIT -> fechar somente o descritor de inspeção -> liberar workspace. Self ou lock ocupado retorna held sem alterar reserva. Falha de inspeção/identidade é recusa, nunca autorização baseada em tempo. Active pin associado a owner retired é inconsistência, não prova para limpeza.

A aquisição do lock original tem significado somente no protocolo do participante de storage: ele não reutiliza identidade e conserva o lock enquanto pode acessar seus recursos. Não prova morte geral do processo nem término de um job. Um participante fechado pode continuar existindo no processo, mas seu handle foi revogado. Não recuperar subprocessos/handles externos que não participem desse protocolo.

Somente o pin solicitado passa a released. Outros pins, reservas de staging, owners, conteúdo, arquivos, jobs, runs, recibos, políticas e custos permanecem intactos. O owner original não é aposentado automaticamente; `retireOwner` continua separado e recusa qualquer reserva restante. Não há reutilização do UUID liberado. Repetição de pin já released é diagnóstico idempotente e não exige tocar arquivo de owner que não concede mais proteção àquela reserva.

Como na liberação normal, a fonte pode ter sido excluída, a política alterada ou a sessão removida: usa-se o binding original para remover proteção obsoleta, sem ler/restaurar os dados. A evidência não é um permit de conteúdo. Um erro antes de COMMIT reverte linha/envelope; erro percebido depois pode ser resolvido pela repetição idempotente. O lock inspecionado permanece retido até concluir a transação. Falha de cleanup não reverte commit já confirmado e deve ser reportada.

**Aceite E3:** lock ocupado e próprio preservados; identidade ausente/substituída recusada; metadados/owner inconsistentes não liberam; uma reserva por chamada; repetição e fronteiras de COMMIT; nenhuma releitura de conteúdo, aposentadoria implícita, alteração de job ou estorno. Testes reais e contraprovas são executados somente no Actions. Registro: [WP-02/E3](../../docs/implementation/WP-02-E-PIN-RECOVERY.md).

## Limite do envelope compartilhado — E4.1

Todas as leituras de pin, inclusive as internas de aquisição/replay, liberação e recuperação, aplicam a [fronteira de bytes de SPEC-22](22-source-pin-discovery.md#fronteira-de-bytes-do-envelope--e41). Um envelope existente deve ser TEXT em banco UTF-8, com no máximo 16384 bytes, inclusive whitespace, antes de seu valor atravessar a ponte SQLite→Node. Tipo/tamanho e encoding são conferidos por consultas escalares no mesmo snapshot do SELECT e das validações existentes. A contagem UTF-8 após o SELECT, parser, digest, vínculo e comparação de reserva/owner continuam obrigatórios.

Excesso, tipo indevido ou encoding incompatível é E_STORAGE, não ausência, autorização para limpeza ou pedido de migração. Nunca truncar, reparar ou converter silenciosamente. Ausência completa continua null no diagnóstico; reserva sem envelope continua inconsistente. O refinamento vale para active e released, mas não transforma descoberta em varredura do histórico liberado. [Registro E4.1](../../docs/implementation/WP-02-E-PIN-ENVELOPE-BUDGET.md).
