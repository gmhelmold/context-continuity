# WP-02/E3 — recuperação explícita de pin inline

Base `55647529d2c90141b6fdb960bc7bd7995bdcebca`; continuidade de WP-02 / issue #5. Contrato em [SPEC-21](../../specs/v0.1/21-source-pins.md). A correção de recibos foi integrada no PR #39; não reaplicar seus patches históricos. Este incremento não modifica aquela implementação.

## Entrega

`recoverSourcePin(binding,id)` acrescenta ao coordenador a recuperação de uma reserva read/export identificada. Reusa o parser, as conferências e a liberação atômica de source-pins, sem duplicar SQL de release. Confere o participante persistido, o inode original e a aquisição não bloqueante de seu lock, mantendo o descritor inspecionado até o COMMIT. Self/ocupado não libera; identidade desconhecida/inconsistente recusa. Não há TTL.

O resultado released significa apenas que a proteção daquela reserva foi removida, conservando seu tombstone. Não há exclusão de fonte, aposentadoria implícita do owner, liberação de staging, mutação de jobs/runs, estorno de custos ou nova inferência. Ausência de recibo de término continua sendo ausência de prova para jobs. A operação não varre catálogo histórico ou materializa BLOBs.

## Provas e estado

Testes e contraprovas usam SQLite, locks e processos reais com dados sintéticos. Toda execução de código, build e typecheck ocorre no GitHub Actions. Resultados, SHAs, IDs dos logs e decisão de integração são registrados no [PR #41](https://github.com/gmhelmold/context-continuity/pull/41) e na [issue #5](https://github.com/gmhelmold/context-continuity/issues/5). A existência deste documento ou de arquivos de teste não representa PASS. O registro é publicado antes do gate; o comentário de fechamento identifica o head efetivamente aprovado e a árvore integrada.

As provas cobrem proprietário vivo/próprio, fechamento com pin retido, read/export, uma reserva por chamada, released idempotente, fonte excluída/política/escopo, metadados incompletos, owner inconsistente, ausência/substituição do arquivo, rollback/pós-commit, disputa de workspace, revalidação final e controles negativos. Ensaios de processo verificam reserva sobrevivente após encerramento, lock de owner ainda vivo e ambos os lados do COMMIT da recuperação. Nenhum processo externo às fixtures é encerrado.

## Cinco axiomas

**Success Criteria:** o pin identificado de participante encerrado pode ser recuperado sem tocar fonte ou execução; participante vivo conserva sua proteção.

**Quality Standards:** SQLite/FS/processos reais, testemunha Python, barreiras observáveis, controles positivos e mutantes recusados por assertion específica; execução somente Actions.

**Completeness Criteria:** identidade persistida/física, ocupação, liberação atômica/idempotente, guards finais, falhas/crash, preservação de pins distintos, staging, conteúdo e orçamento. A revisão inclui isolamento de participante ainda ativo, ausência de leitura/reparo de conteúdo e liberação dos locks após rollback falho.

**Definition of Done:** contrato/implementação/testes alinhados; matriz completa do head final verde e logs conferidos; árvore do merge idêntica à testada; continuidade registrada sem encerrar WP-02.

**Invariants:** não usar TTL nem retired como liveness; nenhuma exclusão de fonte/arquivo; nenhum job/staging/custo alterado; sem reuso de ID, inferência paga, dados pessoais ou release.

## Limites

É recuperação por ID no perfil local inline, não um coletor geral nem varredura de corrupção de todo o banco. Não implementa staging/blobs/GC/exportador nem comprova morte de um executor. O participante deve obedecer o protocolo de lock/identidade; não é sandbox para código do mesmo usuário que altera diretamente arquivos/SQL. Revisão do autor, não auditoria independente.

## Primeira execução e correção das fixtures — histórico

Head inicial `b40c52cdcba47c8929a022dc73490c7eb02d3d69`, workflow de coordenação `35467137824`, job Node22 `105961444799`: 298 casos, 296 aprovados e duas falhas de preparação dos programas filhos (newline interpretado dentro da template). O erro foi SyntaxError antes da barreira; não foi contado como defeito do produto ou detecção por mutação. Os 24 comportamentos, seis pares de mutação e dois ensaios de COMMIT completaram; os outros dois ensaios não foram validados nessa rodada.

A correção usa String.raw nas duas templates, como nos ensaios de COMMIT já existentes. Não altera assertions, timeouts, código de produção, matriz ou critérios de recuperação. Essa preparação foi publicada em `61a8d258cf11255fcde11f260537c4ea5b6fdb21`. Os logs originais permanecem no workflow; o verde desse head não substitui a validação da revisão final.

## Revisão de integração

Retomada do PR existente, sem implementação concorrente. O commit `f89f1bb02869d79eb09a1175c8caea5b304fe18b` acrescenta `source-pin-recovery-review.test.mjs` com três cenários; o código de produção e os 298 testes anteriores permanecem intactos.

1. Recuperação de um pin cuja fonte sintética possui BLOB inconsistente de mesmo tamanho: a instrumentação do driver conta consultas a fontes/raízes durante a recuperação. Exige zero consultas, preservação literal do conteúdo e recusa do digest quando os bytes são efetivamente lidos pela API própria. Isso distingue liberação de metadados de verificação ou reparo de conteúdo.
2. Recuperação de pin antigo ao lado de export pin de outro participante vivo: conserva sua reserva e metadado byte a byte, mantém seu lock ocupado e sua leitura verificada utilizável, sem aposentar participantes implicitamente.
3. Falha de metadado seguida de falha de ROLLBACK, injetadas apenas na fixture: exige inutilização da conexão, liberação dos locks de workspace e de inspeção, reversão da exclusão parcial pelo fechamento SQLite e recuperação explícita idempotente por uma instância nova. Não representa falha de hardware nem teste de queda de energia.

São três testes adicionais, não três defeitos descobertos. O resultado precisa ser observado no Actions. As seis contraprovas anteriores continuam exigindo controle positivo e reprovação do mutante pela assertion selecionada; falhas de setup/build/timeout não são sucesso de mutação. O perfil final esperado contém 301 casos de coordenação: 264 anteriores ao E3 + 24 comportamentos iniciais + quatro ensaios de processo + seis pares controle/mutante + três desta revisão. Não somar subprocessos novamente.

Gate final: sete workflows/dez jobs do mesmo head, coordenação e typechecks associados, core198/storage155 nas versões Node22.17.1/24.0.0; componentes12, gateway13, testemunha4; OpenCode stock1.18.31 sintético16; controle correto e oito corrupções do host diferenciados. Conferir logs e árvores por objetos Git antes de encerrar a integração. Nenhum build/typecheck/teste fora do Actions nesta revisão. Não alterar comandos, pins, prazos, dependências ou permissões para obter verde.
