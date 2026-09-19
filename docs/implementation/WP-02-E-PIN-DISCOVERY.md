# WP-02/E4 — descoberta limitada de pins ativos

Base `2986469315b2cbc8e2bf71d9730ec20b80ae372f`, após a integração de E3 no PR #41. Continuidade da issue #5. Contrato: [SPEC-22](../../specs/v0.1/22-source-pin-discovery.md). A branch deste incremento é `storage-pin-discovery`; patches históricos de recibos não são reaplicados.

## Entrega

`WorkspaceCoordinator.listSourcePins({limit,after?})` descobre as identidades originais necessárias à recuperação explícita. Opera sob flock e um único snapshot SQLite de leitura. A página contém até 64 pins ativos read/export, com uma entrada adicional verificada para decidir continuação. Não materializa BLOBs ou consulta fontes/raízes; não altera reservas, clocks, custos ou jobs. Compartilha o parser/verificador existente de source-pins, sem outra implementação de envelopes ou liberação SQL.

O cursor é estritamente maior que o último ID devolvido; remover esse ID entre chamadas não salta os próximos pins. Não há snapshot persistente entre páginas. Admissões anteriores ao cursor exigem nova varredura. O limite é de registros materializados/verificados, não uma alegação de custo constante de disco/SQL. Envelopes órfãos sem reserva não fazem parte dessa consulta; ela não certifica integridade global do banco.

Uma nova instância pode listar pins de participantes anteriores, mas a lista não lhes transfere a propriedade. Leitura verificada e recuperação continuam nas respectivas APIs com todas as verificações originais. Mesmo após tombstone ou mudança de epoch, o binding retido permite identificar uma pendência sem devolver conteúdo antigo.

## Provas executáveis

- `source-pin-discovery.test.mjs`: paginação/limites, lookahead, imutabilidade, opções sem coerção/getters, snapshots SQLite reais, corrupção, ausência de escrita/BLOB, política/escopo, falhas de COMMIT/guarda/liberação e uso de E3 a partir do resultado descoberto.
- `source-pin-discovery-processes.test.mjs`: participante filho ainda vivo e depois interrompido; consulta em processo novo sem adoção/limpeza automática. Só filhos e bancos sintéticos da própria fixture são usados. Python observa locks independentemente.
- `source-pin-discovery-mutations.test.mjs`: seis pares controle/mutante, para limite da consulta, cursor estrito, checksum, workspace, estado registrado do owner e transação somente leitura. Um par conta como um teste. Falha de compilação/importação/setup ou timeout não conta como detecção.

Os testes anteriores permanecem. A mudança de nomes internos no loader não deve relaxar nenhuma verificação por ID. Typecheck cobre os tipos públicos imutáveis; a matriz histórica inteira precisa passar, não apenas os novos casos.

## Execução e encerramento

Toda compilação, typecheck e teste ocorre exclusivamente no GitHub Actions, nos workflows e versões já fixados. Não executar produto/suítes no Mac ou contêiner. Commits e alterações foram publicados diretamente pelo conector GitHub. DDL, bridge C, core, dependências, quotas e workflows não são modificados por este corte.

A existência destes testes não é PASS. O PR registra cada head executado, IDs dos runs/jobs, resultados, eventuais falhas e correções, revisão e decisão final. Para integrar, conferir os sete workflows/dez jobs do MESMO head e comparar objetos de árvore testada/merge. Não herdar aprovação da base ou apresentar uma releitura de status como novo teste. Este relatório descreve o aceite; os registros de execução ficam associados ao SHA no PR e na issue #5.

## Cinco axiomas

**Success Criteria:** descobrir pins retidos sem conhecer seus IDs previamente, conservando isolamento e separação entre diagnóstico, leitura e recuperação.

**Quality Standards:** componentes reais, fixtures sintéticas, testemunha independente de lock, mutantes com falha nomeada e todas as execuções no Actions.

**Completeness Criteria:** limites/cursor/lookahead, dados íntegros e inconsistentes, participantes e sessões distintos, política/epoch, snapshot e reinício, nenhuma mutação ou BLOB, guardas/erros antes do retorno.

**Definition of Done:** contrato e implementação alinhados, matriz completa verde com logs conferidos, árvore integrada idêntica à testada e fechamento rastreado. WP-02 inteiro permanece aberto.

**Invariants:** nenhuma liberação ou inferência por consulta; metadado não vira prova de bytes/liveness; lookahead não é consumido; cursor não é autoridade; não fabricar inventário global consistente entre páginas.

A revisão é do autor, não auditoria independente. Não há release, gasto de inferência, uso de dados pessoais ou homologação do plugin completo neste incremento.
