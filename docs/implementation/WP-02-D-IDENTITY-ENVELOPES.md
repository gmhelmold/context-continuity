# WP-02/D3.1 — envelopes de identidade limitados e completos

## Escopo e base

Ref #5. Base `503eae8a8e7e927c571ae5721ba1792eaefcb3af`; continuação da revisão após o PR #43. Não reaplica o patch de source-pins. Somente `workspace-coordinator.ts` muda em produção. Não há nova API pública, dependência, DDL, workflow, quota, transporte, supervisor ou rotina de recuperação.

## Achado e correção

`checkAnchor` e `readOwner` selecionavam meta.value antes de data() verificar 8 KiB. Initialize materializava o mesmo envelope para decidir existência. Um limite aplicado depois da leitura não limita a transferência pelo driver; um prefixo textual truncado não é um registro completo.

O helper privado identityMetadata exige UTF-8 e seleciona tipo, octet_length e uma projeção CASE limitada a TEXT de até 8192 bytes. O mesmo SELECT mede e retorna o valor; não existe intervalo entre dois SELECTs de medição/valor, inclusive nas guardas fora de transação. O tamanho transferido precisa coincidir com o escalar antes de data(). Inicialização usa SELECT 1 nos dois testes de existência.

## Blast radius

Guarda de anchor: initialize, open e todas as seções/guardas/close. Metadado de owner: registro de novo participante, leitura/aposentadoria, guardas do próprio participante e leitura do participante original na recuperação de pins. APIs de pins e supervisor continuam a usar suas guardas e regras anteriores. As regras de propriedade, identidade física, seção síncrona, transações, reservas e confirmação de término não mudam. Os 360 testes anteriores permanecem intactos.

## Provas

`tests/coordination/coordinator-envelope-budget.test.mjs`: 23 comportamentos com SQLite, diretórios e locks reais. A observação inspeciona valores efetivamente retornados por DatabaseSync, não contabilização declarada pelo produto. Bytes de preservação são lidos como BLOB somente pela fixture, evitando a truncagem textual de NUL. Cobrem oito caminhos de abertura/inicialização/guarda/fechamento e leitura/aposentadoria, Unicode/BLOB para ambos os metadados, NUL curto/no teto, limites inclusivos 8191/8192, ausência versus registro parcial, revogação de hold e escrita concorrente. A fixture restaura apenas seus próprios metadados antes do cleanup.

`tests/coordination/coordinator-envelope-mutations.test.mjs`: cinco pares sobre cópias descartáveis da implementação. Cada par exige controle positivo aprovado e falha ERR_ASSERTION com marcador próprio no caso selecionado. Retirar a projeção limitada, contar caracteres, excluir a borda inclusiva, aceitar texto incompleto ou carregar payload no probe de existência deve ser detectado. Timeout/import/setup não contam como detecção. Cada par é contado uma vez: incremento de 28 casos, sem somar subprocessos.

As contraprovas não são testes de um algoritmo duplicado: executam o loader e as mesmas fixtures do componente. Nenhuma inferência ou chamada de provider real é necessária. Os resultados de execução pertencem ao head indicado no comentário de gate do PR, não a uma contagem prevista neste documento.

## Cinco axiomas

**Success Criteria:** envelope excedente ou não textual não é transferido como payload pelo loader; texto incompleto não vira identidade válida; dados válidos no teto continuam aceitos.

**Quality Standards:** componentes reais, erros sanitizados, observação fora do loader, testemunha Python para exclusão; regressões históricas não editadas nem ignoradas.

**Completeness Criteria:** ambos os metadados, os probes de existência, próprias identidades e identidades estrangeiras, falhas sem mutação e retomada após recusa. Campanha negativa cobre as cinco proteções centrais exercitadas.

**Definition of Done:** testes/typechecks/build e integrações no Actions, logs vinculados ao head aprovado, árvore integrada equivalente, PR e issue atualizados. O gate de execução é registrado no PR com SHAs e jobs; este documento não substitui os resultados executados.

**Invariants:** nenhum novo owner em erro de anchor; nenhum owner existente aposentado por erro de leitura; nenhum lock de outro participante liberado; nenhuma reserva/job/custo alterado por diagnóstico; ausência parcial não é omitida nem corrigida.

## Limites

Limite de transferência desses envelopes, não benchmark, teto global de memória ou limite de trabalho do SQLite. Outros campos de storage_owners/meta não são abrangidos por esse teto. Estado incorreto coerentemente reescrito ou conversão de mesmo comprimento não é autenticado por tamanho. Encoding não suportado é recusado; não há migração. As provas de integração são do perfil UTF-8 criado pelo storage nos runtimes fixados. O trabalho restante do WP-02 continua aberto; nenhuma prova é promovida a homologação de todos os harnesses.

Uma tentativa de edição agrupada via shell foi bloqueada antes da execução; os arquivos foram publicados por operações explícitas do conector GitHub. Nenhum produto/build/teste/typecheck foi executado no Mac ou no contêiner nesta retomada.
