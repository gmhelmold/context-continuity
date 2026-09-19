# WP-02/D3.2 — encoding antes do bootstrap do coordenador

[Contrato SPEC-18](../../specs/v0.1/18-workspace-coordinator.md) · [PR #45 e gate por commit](https://github.com/gmhelmold/context-continuity/pull/45) · [WP-02 / #5](https://github.com/gmhelmold/context-continuity/issues/5).

## Defeito e reprodução

Base: `ca90f971c262f56b99809dfaefd76a1a27929cd8`, após PR #44. Os leitores de identidade já recusavam encoding diferente de UTF-8, mas `initialize` sem anchor não usava esse leitor. Podia confirmar bootstrap num banco UTF-16 que `open` recusaria depois.

O commit de regressão `2cbc26b10f1fed6b534b01e40705016b9528b261` não altera produção. No Actions, run `35474419667`, jobs `105981081361` (Node 24.0.0) e `105981081432` (Node 22.17.1), ambos produziram **395/397**: somente UTF-16le/be falharam com `Missing expected exception: IDENTITY_BOOTSTRAP_ENCODING`, `ERR_ASSERTION`. O controle UTF-8 e os 394 casos históricos passaram; nenhum skip/cancelamento/todo. Os dois logs completos foram conferidos. [Registro da reprodução](https://github.com/gmhelmold/context-continuity/pull/45#issuecomment-5745933295).

As fixtures criam bancos novos com o encoding escolhido antes do schema. Usam o mesmo DDL, application_id, versão e metadados da fundação; sua aceitação pelo `connectSQLite` real é comprovada antes da chamada ao coordenador. Falha de preparação não conta como reprodução. Nenhum banco pessoal é acessado.

## Correção e blast radius

A única mudança de produção é uma guarda, com comentário, imediatamente após `connectSQLite` em `WorkspaceCoordinator.initialize`: consultar `PRAGMA encoding` e exigir UTF-8 antes de `LockResources.open`. A recusa usa o E_CAPABILITY existente. O catch externo conserva a sanitização das exceções do driver e o finally fecha a conexão.

Não muda API, DDL, versão, dependências, workflow, parser, limites de envelope, flock, transações, fences ou quotas. `open`, as guardas de identidade e as operações de pins mantêm suas verificações próprias. Não converte encoding, não repara dados e não cria autoridade de recuperação.

A garantia de ausência de escrita é delimitada: não publica anchor, owner ou reserva, nem cria arquivos/diretórios **do coordenador** no caminho recusado. A negociação WAL e os sidecars eventualmente produzidos pela abertura do SQLite não estão abrangidos. Não se promete arquivo SQLite byte a byte inalterado ou ausência de I/O.

## Provas reproduzíveis — somente Actions

| Arquivo | Obrigação |
| --- | --- |
| `tests/coordination/coordinator-bootstrap-encoding.test.mjs` | UTF-16le/be recusados antes de recursos/anchor, metadados e reservas preservados, encoding não migrado; UTF-8 inicializa, abre, empresta lock e fecha |
| `tests/coordination/coordinator-bootstrap-encoding-mutations.test.mjs` | Mesmo controle passa 3/3; retirar somente a guarda faz os dois casos UTF-16 falharem pela assertion nomeada, conservando UTF-8 aprovado |

O par controle/mutante conta como um caso, não como cada processo executado. O filho usa TAP explícito, verifica contagem, status e ambas as assertions; timeout, sinal, importação ou outra falha não valem como detecção. Copia a ponte já compilada pela matriz, sem compilar dentro da contraprova. Limpa somente suas fixtures.

Os três casos publicados antes da correção permanecem inalterados. Expectativa do corte: **398 = 394 históricos + 3 comportamentos + 1 par**. Esse número é inventário, não declaração antecipada de sucesso. Os resultados executados do head final, os dez job IDs e a equivalência de árvores de head/checkout/merge são registrados no gate do PR acima antes de integrar. Verde de outro commit não satisfaz o gate.

## Revisão e cinco axiomas

**Success Criteria:** a inicialização não confirma suporte incompatível com a abertura; o caminho UTF-8 continua funcional.

**Quality Standards:** SQLite, schema, inspetor e locks reais; erros públicos exatos; controle antes do mutante; regressões nomeadas, sem supressão de falhas; builds, testes e typechecks exclusivamente no Actions.

**Completeness Criteria:** as duas ordens UTF-16, ausência inicial de anchor/recursos, preservação das tabelas observadas, ciclo UTF-8 e contraprova da guarda.

**Definition of Done:** código, contrato e testes publicados; revisão do diff e matriz do mesmo head aprovadas; comparação da árvore integrada; issue #5 atualizada; branch integrada removida. A aprovação é vinculada às evidências do PR, não inferida desta documentação.

**Invariants:** sem migração, adoção de identidade, execução de jobs, mudança de custos, liberação de reservas ou declaração de morte de processo. Falha não vira sucesso. WP-02 continua aberto para os serviços restantes.

A revisão deste corte é revisão do autor, não auditoria independente. O escopo exercitado é Linux nos pins Node 22.17.1/24.0.0, não todo driver/filesystem, queda de energia ou homologação completa do plugin. Nenhum build, teste ou typecheck no Mac/contêiner, nenhuma inferência paga e nenhuma release.

## Fonte primária

[SQLite PRAGMA encoding](https://www.sqlite.org/pragma.html#pragma_encoding): o encoding de um banco criado não pode ser alterado por esse pragma. Por isso a fixture o define antes do schema, em vez de tentar converter um banco já inicializado.
