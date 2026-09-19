# WP-02/E1 — registro durável de pins inline

Base `bd62cf080eded732b14128c292f5c3f4e0ad9e78`; continuidade da issue #5 após os recibos de término do PR #37. Contrato: [SPEC-21](../../specs/v0.1/21-source-pins.md). Este é um incremento de código, não reaplicação de patches anteriores.

## Corte implementado

`source-pins.ts` reutiliza binding/SourceRef/canonicalização e sourceMetadata; WorkspaceCoordinator fornece a exclusão e as transações existentes. Registra reserva + envelope, replay exato, consulta imutável, capacidade e liberação pelo participante original. O registro released impede reuso de ID; close/crash não removem reservas.

A API é exclusivamente de metadados para fontes inline. Não certifica bytes, protege magicamente chamadas legadas ou entrega dados ao usuário. Não implementa staging/GC/exportador, limpeza de pins abandonados, novos jobs ou transporte. Um reader futuro precisa usar essas reservas e revalidar fonte/política no ponto de entrega. O DDL, core, módulos de jobs/recibos, C nativo, dependências, pins e workflows permanecem inalterados.

## Provas preparadas e gate

A suíte usa SQLite, diretórios privados e locks reais, sem dados pessoais. Testes comportamentais cobrem autoridade, escopo, política/tombstone, integridade, limites, replay, liberação e rollback. Quatro testes interrompem apenas filhos das fixtures antes/depois dos commits de aquisição/liberação, verificando em outro processo o registro confirmado. Cinco pares controle/mutante detectam remoção de validação de fonte, owner, checksum, tombstone de ID e limite inclusivo.

Todas as compilações, typechecks e execuções de teste deste incremento serão feitas exclusivamente no GitHub Actions. Antes dos resultados do head, estes arquivos são provas preparadas, não PASS. Os logs e a revisão final do commit serão referenciados no PR e na issue #5. Timeout/import/build falho não conta como detecção de mutante. Não somar subprocessos nem resultados históricos.

## Axiomas e limites

Success Criteria, Quality Standards, Completeness Criteria, Definition of Done e Invariants estão definidos na SPEC-21. Aceite exige sete workflows/dez jobs verdes e logs conferidos no commit exato. A matriz anterior (coordenação184/core198/storage155) é baseline, não aprovação herdada.

Pins ativos e seus tombstones released usam o ledger existente. Não existe expiração silenciosa nem remoção de recursos de outro participante. Não há promessa de durabilidade de hardware, qualidade semântica, economia de cache ou plugin instalado. Revisão do autor, não auditoria independente.

## Revisão de integração

Três provas adicionais cobrem revogação do owner dentro da admissão (rollback dos dois registros), sessões realmente inicializadas com fontes de mesma identidade local e a diferença entre reserva de metadados e verificação de bytes: uma corrupção de mesmo comprimento não é certificada pelo pin, e `readSource` continua recusando seu hash. Não foram relaxadas assertions anteriores nem mudados timeouts.

A garantia implementada permanece declaradamente menor que um reader ou GC: estas APIs conservam reservas, mas chamadas legadas de exclusão/leitura não passam a obedecê-las automaticamente. A futura integração de leitura/exportação e GC deve consultar pins e revalidar política. Não registrar esses serviços como concluídos pela existência deste registro.
