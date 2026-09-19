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
- `source-pin-discovery-review.test.mjs`: janela selecionada versus corrupção posterior, integridade do owner no lookahead e falha de rollback da leitura, preservando os participantes vivos e seus pins.

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

## Primeira execução preservada

Head `52e2c43658d4b03445e2f657e8fff3c2fbbb8340`, run de coordenação `35469415820`, jobs `105967533536` (Node22) e `105967533592` (Node24): **330/331 em ambas as versões**. A única falha foi a expectativa de código no teste de guarda final. O diretório sintético teve suas permissões alteradas; `sqlite-database.ts:directoryInfo` recusou corretamente com E_STORAGE, antes da guarda de LockResources. O teste esperava incorretamente E_CAPABILITY.

A correção mantém a alteração de permissões e todas as verificações de recusa/liberação/reuso; passa a exigir o código E_STORAGE e a mensagem sanitizada específica da guarda que efetivamente detecta esse caso. Não altera código de produção, timeouts ou testes anteriores. Não é um defeito do produto corrigido nem flexibilização para aceitar sucesso indevido. Os logs completos da rodada vermelha foram preservados, com hashes, em `/private/tmp/cc-pin-discovery-ci-kbsb8tjd/` e no Actions. O novo head requer novamente toda a matriz antes do merge.

## Revisão de integração

Retomada do head `edfe5f511cc9cc49eed7f259ce7ddded5416d369` no próprio PR #42. O commit `0f8ba02bf716260cbdb15c4ca713c1689e3cf064` acrescenta três casos reais, sem modificar os 331 anteriores ou código de produção:

1. Corrupção fora de `limit+1` não é consultada nem certificada; quando entra no lookahead da continuação, a chamada recusa a página inteira, preserva os registros e permite repetir a consulta anterior. Nenhum cursor é consumido implicitamente.
2. Um owner inconsistente apenas no lookahead também impede o retorno da página; o lock daquele participante continua ocupado. Após restaurar exclusivamente o dado sintético alterado pela fixture, seu leitor continua utilizável e E3 continua recusando recuperar seu pin vivo.
3. Falha de leitura de metadado seguida de rollback falho inutiliza somente a conexão de descoberta. Não retorna página, libera o lock de workspace, preserva registros e mantém os dois locks de participantes até fechamento explícito. Outra instância consegue listar, mas não recuperar o pin ainda vivo. Python observa os locks independentemente.

São provas de fronteira, não três defeitos anunciados. As injeções estão limitadas aos bancos/descritores sintéticos das fixtures; não são provas de queda de energia ou falha física do disco. A revisão não altera contratos para aceitar estado incorreto, relaxa assertions anteriores ou aumenta prazos.

Contagem esperada do gate: 334 casos de coordenação = 301 anteriores ao E4 + 22 comportamentos iniciais + 2 processos + 6 pares controle/mutante + 3 desta revisão. Cada par conta uma vez. A expectativa não é resultado executado: ler os logs do head final antes de publicar PASS.

Gate completo: coordenação/build 334, core/typecheck 198 e storage/typecheck 155 nas duas versões Node 22.17.1/24.0.0; cinco verificadores documentais, componentes 12 e testemunha 4; gateway 13; OpenCode oficial 1.18.31 com provider sintético 16; controle do host e oito mutantes rejeitados pela assertion prevista. Resultados e objetos Git do merge ficam registrados no PR #42 e na issue #5, sem novo commit exclusivamente para reescrever PASS depois do gate.
