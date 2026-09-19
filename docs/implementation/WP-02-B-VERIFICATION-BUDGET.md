# WP-02/B — trabalho de verificação limitado na retenção

Base `7cfde7770963a1fa0c826cde9ca5b9f1a234968b`; correção da issue #28, vinculada à #5. Contrato: [SPEC-14](../../specs/v0.1/14-inline-root-retention.md). Não conclui o WP-02 nem acrescenta captura de host, job ou publicação.

## Decisão e fronteira

O caminho incremental separa o índice de identidades da leitura de bytes. `retainRoots` carrega a estrutura das raízes e verifica metadados das fontes correntes sem pedir seus BLOBs ao driver. O CAS usa esse índice; o retorno continua sendo RootCatalog estrutural, sem marca de conteúdo verificado. Bytes de fontes fornecidas e referenciadas nas observações submetidas são verificados por SHA-256 dentro da transação, inclusive replay e metadata-only.

Um leitor privado por transação deduplica por SourceRef completa (ID, revisão e digest). Não existe cache entre operações, processos, conexões ou reabertura. As fontes de uma mesma revisão são imutáveis e BEGIN IMMEDIATE impede escrita concorrente durante essa verificação. O leitor não é exposto pela API pública, não sobrevive ao retorno e guarda no máximo o orçamento da operação.

O orçamento é 4 MiB/256 referências distintas, inclusivo. Uma fonte vazia conta; fontes distintas com o mesmo conteúdo não viram uma só identidade. Metadados de comprimento/tipo/tamanho são conferidos antes do SELECT do BLOB. Negar a próxima leitura reverte fontes, raízes e relógio, sem retry ou aumento de lease. A validação de entrada mantém seu limite separado de 4 MiB.

`readSource` continua autenticando os bytes pelo digest. `readRoot` verifica suas dependências; `readRootCatalog` permanece auditoria integral explícita. Uma alteração de bytes não afetados que preserve metadados não é detectada pelo índice: deve ser detectada quando o conteúdo for lido/usado. Isso é testado, não escondido. Snapshot/manifesto/publicação não recebem autoridade do retorno da retenção. Disponibilidade, tombstones, escopo, CAS e ownership não foram removidos.

## Medida reproduzível

Instrumentação dos métodos get/all/iterate de statements que leem sources delega ao driver real e conta arrays de bytes efetivamente retornados. Não estima leitura a partir do tamanho configurado nem mede I/O físico. SQLite e arquivos temporários são reais; dados inteiramente sintéticos. O digest esperado vem do retorno anterior, evitando uma auditoria externa dentro do trecho medido.

| Raízes históricas | Lote vazio: antes | Lote vazio: depois | Adicionar uma fonte de 16 KiB: depois |
|---:|---:|---:|---:|
| 8 | 8 leituras / 131072 bytes | 0 / 0 | 1 / 16384 |
| 32 | 32 / 524288 | 0 / 0 | 1 / 16384 |
| 128 | 128 / 2097152 | 0 / 0 | 1 / 16384 |

O antes consta da issue #28 e foi novamente detectado pelas regressões na base: 16 casos, 2 controles aprovados e 14 assertions reprovadas, sem setup failure. Os mesmos 16 passaram após o fix. Três casos adicionais cobrem revisão de fonte, identidades distintas com bytes iguais e mudança de policy; a campanha negativa é o vigésimo teste. As duas primeiras shells de apresentação tentaram atribuir à variável reservada status do zsh e terminaram com erro após os testes; suas contagens vêm dos TAP completos, não do exit dessa shell. A execução dirigida posterior usa rc e terminou corretamente.

## Provas e revisão

Os 19 casos dirigidos verificam lote vazio e pequeno em três tamanhos, replay, metadata-only, revisões, compartilhamento, bytes alterados mantendo tamanho, outra conexão, reabertura, disponibilidade, limites exatos e ultrapassados, rollback e proprietário expirado. O caso de comprimento inconsistente exige zero BLOBs materializados antes da recusa.

A campanha executa quatro pares controle/mutante em cópias descartáveis: retorno à varredura histórica, remoção do limite de bytes, remoção do limite de contagem e omissão da integridade afetada. Cada controle deve passar e cada mutante falhar na assertion do teste selecionado, não por timeout/setup. Os subprocessos não multiplicam a contagem de casos.

A regressão histórica de hash foi fortalecida: muda os bytes mantendo o mesmo comprimento. Assim a verificação de metadados não pode encobrir uma implementação que tenha deixado de conferir SHA-256. O teste separado de tamanho continua cobrindo a recusa antes da cópia.

Revisão do autor: separação entre índice e auditoria integral, nenhuma nova API de query, nenhum esquema/dependência alterado, escopo/fence preservados, deduplicação efêmera e limites antes da leitura. Não é auditoria externa. Validação completa e resultados de CI pertencem ao head final do PR/issue; não são inferidos dos testes dirigidos.

## Cinco axiomas do incremento

**Success Criteria:** retenção vazia não relê conteúdo; lote pequeno verifica só fontes submetidas/afetadas, limitado por bytes e quantidade.

**Quality Standards:** driver real, oráculo por bytes retornados, controles positivos, quatro mutantes rejeitados e integridade de conteúdo preservada; sem afrouxar prazos ou habilitar modo complete.

**Completeness Criteria:** casos de edição/reversão, sharing, source-only, vazio, policy, outro commit/reabertura, fonte indisponível, CAS/owner e rollback; consumo explícito continua verificando bytes.

**Definition of Done:** SPEC-14 e implementação alinhadas; typechecks/storage/core/componentes/documentos e os seis workflows/oito jobs conferidos no head final; árvore integrada igual à testada; #28 encerrada com evidências e #5 aberta.

**Invariants:** índice não vira prova de bytes; nenhum dado de usuário no repo; nenhum cache persistente ganha autoridade; limites de fonte, lote e ownership não aumentam; não modifica View nem dispara inferência.

## Limites e reprodução

O custo de metadados, ordenação, CAS e quota continua proporcional aos registros. Não é O(1), benchmark de latência, medição de RAM ou prova de sessão de horas. O limite é de BLOBs retornados ao JavaScript, não de páginas internas de SQLite/WAL/disco. Auditorias integrais explícitas continuam deliberadamente custosas.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check:storage
npm run test:storage
npm run check:core
npm run test:core
node --test tests/conformance/opencode/test-components.mjs tests/conformance/opencode/test-review004.mjs
python3 tests/conformance/opencode/test-witness.py
python3 scripts/check-spec.py
```

Tooling local fixado em Node 22.17.1/TypeScript 5.9.3; suítes locais pesadas em série. Os comandos padrão de CI e os pins permanecem intactos. Evidências dirigidas e hashes: [WP-02-B-verification-budget.json](evidence/WP-02-B-verification-budget.json). A matriz completa é registrada separadamente no PR resultante.
