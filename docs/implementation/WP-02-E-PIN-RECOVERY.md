# WP-02/E3 — recuperação explícita de pin inline

Base `55647529d2c90141b6fdb960bc7bd7995bdcebca`; continuidade de WP-02 / issue #5. Contrato em [SPEC-21](../../specs/v0.1/21-source-pins.md). A correção de recibos foi integrada no PR #39; não reaplicar seus patches históricos. Este incremento não modifica aquela implementação.

## Entrega

`recoverSourcePin(binding,id)` acrescenta ao coordenador a recuperação de uma reserva read/export identificada. Reusa o parser, as conferências e a liberação atômica de source-pins, sem duplicar SQL de release. Confere o participante persistido, o inode original e a aquisição não bloqueante de seu lock, mantendo o descritor inspecionado até o COMMIT. Self/ocupado não libera; identidade desconhecida/inconsistente recusa. Não há TTL.

O resultado released significa apenas que a proteção daquela reserva foi removida, conservando seu tombstone. Não há exclusão de fonte, aposentadoria implícita do owner, liberação de staging, mutação de jobs/runs, estorno de custos ou nova inferência. Ausência de recibo de término continua sendo ausência de prova para jobs. A operação não varre catálogo histórico ou materializa BLOBs.

## Provas e estado

Testes e contraprovas usam SQLite, locks e processos reais com dados sintéticos. Toda execução de código, build e typecheck deve ocorrer no GitHub Actions. Mac usado somente para edição e Git. Resultados/SHAs/IDs de logs e decisão são registrados no PR e na issue #5; existência de arquivo não é resultado PASS. Estado de preparação: aguardando Actions, sem validação local.

As provas cobrem proprietário vivo/próprio, fechamento com pin retido, read/export, uma reserva por chamada, released idempotente, fonte excluída/política/escopo, metadados incompletos, owner inconsistente, ausência/substituição do arquivo, rollback/pós-commit, disputa de workspace, revalidação final e controles negativos. Ensaios de processo verificam reserva sobrevivente após encerramento, lock de owner ainda vivo e ambos os lados do COMMIT da recuperação. Nenhum processo externo às fixtures é encerrado.

## Cinco axiomas

**Success Criteria:** o pin identificado de participante encerrado pode ser recuperado sem tocar fonte ou execução; participante vivo conserva sua proteção.

**Quality Standards:** SQLite/FS/processos reais, testemunha Python, barreiras observáveis, controles positivos e mutantes recusados por assertion específica; execução somente Actions.

**Completeness Criteria:** identidade persistida/física, ocupação, liberação atômica/idempotente, guards finais, falhas/crash, preservação de pins distintos, staging, conteúdo e orçamento.

**Definition of Done:** contrato/implementação/testes alinhados; matriz completa do head final verde e logs conferidos; árvore do merge idêntica à testada; continuidade registrada sem encerrar WP-02.

**Invariants:** não usar TTL nem retired como liveness; nenhuma exclusão de fonte/arquivo; nenhum job/staging/custo alterado; sem reuso de ID, inferência paga, dados pessoais ou release.

## Limites

É recuperação por ID no perfil local inline, não um coletor geral nem varredura de corrupção de todo o banco. Não implementa staging/blobs/GC/exportador nem comprova morte de um executor. O participante deve obedecer o protocolo de lock/identidade; não é sandbox para código do mesmo usuário que altera diretamente arquivos/SQL. Revisão do autor, não auditoria independente.
