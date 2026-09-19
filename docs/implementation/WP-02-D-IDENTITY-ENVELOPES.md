# WP-02/D3.1 — envelopes de identidade limitados e completos

## Escopo e base

Ref #5, PR #44. Base `503eae8a8e7e927c571ae5721ba1792eaefcb3af`; continuação da revisão após o PR #43. Não reaplica o patch de source-pins. Somente `workspace-coordinator.ts` muda em produção. Não há nova API pública, dependência, DDL, workflow, quota, transporte, supervisor ou rotina de recuperação.

## Achados e correções

`checkAnchor` e `readOwner` selecionavam meta.value antes de data() verificar 8 KiB. Initialize materializava o mesmo envelope para decidir existência. Um limite aplicado depois da leitura não limita a transferência pelo driver; um prefixo textual truncado não é um registro completo.

O helper privado identityMetadata exige UTF-8 e seleciona tipo, octet_length e uma projeção CASE limitada a TEXT de até 8192 bytes. O mesmo SELECT mede e retorna o valor; não existe intervalo entre dois SELECTs de medição/valor, inclusive nas guardas fora de transação. O tamanho transferido precisa coincidir com o escalar antes de data(). Inicialização usa SELECT 1 nos dois testes de existência.

Revisão adicional identificou que `assertWorkspaceHold` chamava a guarda sem sanitização própria: um callback podia capturar a exceção crua antes do catch externo de `withWorkspaceLock`. O limite de metadados não resolvia essa fronteira. A função pública agora chama o sanitizador existente `storageFailure` antes de devolver a falha ao chamador, preservando StorageError já classificado. Não retorna autoridade em falha, não libera o lock da seção nem altera registros. Outra validação completa pode ter sucesso após falha transitória; sair da seção continua revogando o hold.

## Blast radius

Guarda de anchor: initialize, open e todas as seções/guardas/close. Metadado de owner: registro de novo participante, leitura/aposentadoria, guardas do próprio participante e leitura do participante original na recuperação de pins. O ponto adicional é a fronteira pública de assertWorkspaceHold e seus consumidores. APIs de pins e supervisor conservam suas regras anteriores. Propriedade, identidade física, seção síncrona, transações, reservas e confirmação de término não mudam. Os 360 testes anteriores permanecem intactos.

## Provas

`tests/coordination/coordinator-envelope-budget.test.mjs`: 23 comportamentos com SQLite, diretórios e locks reais. A observação inspeciona valores efetivamente retornados por DatabaseSync, não contabilização declarada pelo produto. Bytes de preservação são lidos como BLOB somente pela fixture, evitando a truncagem textual de NUL. Cobrem oito caminhos de abertura/inicialização/guarda/fechamento e leitura/aposentadoria, Unicode/BLOB para ambos os metadados, NUL curto/no teto, limites inclusivos 8191/8192, ausência versus registro parcial, revogação de hold e escrita concorrente. A fixture restaura apenas seus próprios metadados antes do cleanup.

`tests/coordination/coordinator-envelope-mutations.test.mjs`: cinco pares sobre cópias descartáveis da implementação. Cada par exige controle positivo aprovado e falha ERR_ASSERTION com marcador próprio no caso selecionado. Retirar a projeção limitada, contar caracteres, excluir a borda inclusiva, aceitar texto incompleto ou carregar payload no probe de existência deve ser detectado. Timeout/import/setup não contam como detecção; cada par é contado uma vez.

`tests/coordination/coordinator-identity-review.test.mjs`: três regressões acrescentadas por outra execução no mesmo PR, preservadas sem alterações. SQLite produz uma falha real em consulta sintética; o callback captura a exceção antes do catch externo. Encoding, anchor e owner devem devolver StorageError sanitizado, sem causa privada ou nome da tabela no stack. Testes verificam locks dos participantes, ausência de mutações, validação posterior e expiração do hold.

`tests/coordination/coordinator-identity-review-mutations.test.mjs`: três pares adicionais removem somente o sanitizador da fronteira pública; cada um precisa reprovar pela assertion IDENTITY_GUARD_SANITIZED em sua regressão selecionada. Total deste incremento: 34 casos = 23 comportamentos + cinco pares de envelope + três regressões de hold + três pares de hold. Coordenação prevista 394 = 360 históricos + 34; contagem prevista não é resultado executado.

As contraprovas executam o componente real em cópias descartáveis, não um algoritmo duplicado. Nenhuma inferência de provider real é necessária. Os resultados finais pertencem ao head indicado no comentário de gate do PR.

## Histórico de execução preservado

Head `891e49a3ffdf2ef9d35edb2560465d36c34a1b28`: os sete workflows/dez logs passaram, com coordenação 388/388 nos dois runtimes. Gate histórico no comentário5745745629; não serve para aprovar heads posteriores. Antes do merge, a conferência detectou o commit adicional `6bd0fba9a773f5822464d45fd01f6ac3b56321e7`, com as três regressões de hold. PR permaneceu em rascunho.

Run35473312310: ambos os jobs de coordenação reprovaram. O log completo do job105978116412, Node24.0.0, foi lido: 388 aprovados e três falhos em 391, cada falha IDENTITY_GUARD_SANITIZED por ERR_SQLITE_ERROR em vez de E_STORAGE. Não era timeout/import/setup. Correção publicada em `b78edb04ab120d99697944104dd9aa9771e5658b`; contraprovas em `1c4d1c5afa118f46006334d0f33b943effcee0a1`. Novo gate completo necessário depois da atualização documental; nenhum resultado anterior é promovido automaticamente.

## Cinco axiomas

**Success Criteria:** envelope excedente ou não textual não é transferido como payload pelo loader; texto incompleto não vira identidade válida; dados válidos no teto continuam aceitos; falha da guarda pública não expõe detalhes privados do driver.

**Quality Standards:** componentes reais, erros sanitizados na fronteira observável, observação fora do loader, testemunha Python para exclusão; regressões históricas e recebidas não editadas nem ignoradas.

**Completeness Criteria:** ambos os metadados, probes de existência, próprias identidades e identidades estrangeiras, falhas sem mutação, revalidação e revogação. Campanhas negativas cobrem as cinco proteções do envelope e a fronteira pública nas três consultas.

**Definition of Done:** testes/typechecks/build e integrações no Actions, logs vinculados ao head aprovado, árvore integrada equivalente, PR e issue atualizados. O gate de execução é registrado no PR com SHAs e jobs; este documento não substitui os resultados executados.

**Invariants:** nenhum novo owner em erro de anchor; nenhum owner existente aposentado por erro de leitura; nenhum lock de outro participante liberado; nenhuma reserva/job/custo alterado por diagnóstico; ausência parcial não é omitida nem corrigida; falha não concede autoridade.

## Limites

Limite de transferência desses envelopes, não benchmark, teto global de memória ou limite de trabalho do SQLite. Outros campos de storage_owners/meta não são abrangidos por esse teto. Estado incorreto coerentemente reescrito ou conversão de mesmo comprimento não é autenticado por tamanho. Encoding não suportado é recusado; não há migração. As provas de integração são do perfil UTF-8 criado pelo storage nos runtimes fixados. O trabalho restante do WP-02 continua aberto; nenhuma prova é promovida a homologação de todos os harnesses.

Uma tentativa de edição agrupada via shell foi bloqueada antes da execução; os arquivos foram publicados por operações explícitas do conector GitHub. Nenhum produto/build/teste/typecheck foi executado no Mac ou no contêiner nesta retomada.
