# WP-02/D — fronteiras do owner, sem implementação do gerenciador

Base `c5d94ac62cf2ef3e1beb16b86b6209fa8b8beae9`; refs issue #5. Esta entrega acrescenta testes da ponte existente e um [desenho pré-implementação](../designs/storage/WORKSPACE-COORDINATOR.md). **Não implementa WorkspaceCoordinator, não registra owners automaticamente e não libera jobs em quarentena.**

## Motivo e escopo da preparação anterior

Na preparação anterior, a tentativa de gravar lock-resources.ts foi bloqueada antes de executar. Naquele momento foram confirmados ausentes lock-resources.ts e workspace-coordinator.ts. A edição não foi reaplicada por ferramenta ou rota alternativa. O desenho foi mantido fora de specs normativas, explicitamente proposto, em vez de apresentar uma API inexistente como implementada.

Prosseguiu somente a investigação independente da primitiva já integrada, sem alterar C, build, SQL, núcleo, session-store, dependências, comandos/pins ou configurações do usuário. Dados e processos são sintéticos; cada fixture remove exclusivamente seus arquivos temporários.

## Três observações reproduzidas

| Caso | Evidência exigida |
|---|---|
| Caminho substituído | Ponte segura o inode original, movido para outro nome. Novo arquivo no nome antigo é adquirível. Os dois locks podem ser detidos ao mesmo tempo. Python observa cada inode separadamente. |
| Registro persistido | Um owner sintético é gravado na tabela real storage_owners com sua chave de arquivo. Após fechar o descritor, o lock é adquirível e o registro continua active, byte a byte igual. Nenhum job é criado. |
| Processo ainda vivo | Filho adquire lock, atende RELEASE, depois responde PONG. Python consegue adquirir o lock entre RELEASED e PONG. O teste termina o próprio filho e verifica exit 0. |

Esses resultados são comportamentos esperados e documentados da primitiva, não novos bugs ou reprodução de exploração. Não exercitam um gerenciador implementado, nem confirmam integridade de paths por uma API de produto. Impedem usar as premissas erradas para encerrar o próximo incremento.

## Revisão das fixtures

A primeira execução foi 2/3: as duas primeiras passaram; a terceira falhou no carregamento do programa filho por escape de newline. Não foi falha de lock ou descoberta de produto. O programa passou a usar template literal raw. A espera também foi corrigida para reportar exit/error do filho imediatamente e ter deadline explícito no encerramento. Não se conta timeout como comprovação de comportamento.

A repetição corrigida passou 3/3. O caso do banco foi refinado para usar uma chave owners/<UUID>.lock efetivamente existente, não um locator fictício. Matriz final e hashes são registrados em [evidence/WP-02-D-owner-boundaries.json](evidence/WP-02-D-owner-boundaries.json) e no PR. Resultados antigos não são contados como nova execução; subprocessos não multiplicam a contagem.

## Critérios do corte

**Success Criteria:** as três fronteiras são observadas na ponte/SQLite reais sem alterar estado de usuário.

**Quality Standards:** testemunha independente Python/fcntl, processos próprios, controle explícito de barriers/erro/cleanup. Nenhuma API ausente é substituída por mock para alegar aprovação de produto.

**Completeness Criteria:** identidades distintas de inode, estado durável separado de lock e resposta do processo depois da liberação; regressões anteriores continuam passando.

**Definition of Done:** testes e documentos consistentes, matriz do head conferida, merge sem código parcial, rastreabilidade na #5 preservando gerenciador pendente.

**Invariants:** nenhum booleano de disponibilidade libera job; nenhum arquivo de usuário é tocado; não aumentar timeout/lease para esconder falha; não declarar gerenciador ou WP-02 concluído.

## Reprodução

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build:locks
npm run test:coordination
npm run check:core
npm run check:storage
python3 scripts/check-spec.py
```

Na preparação anterior, a suíte de coordenação tinha os 17 casos anteriores mais três observações. Os casos novos não alteram a campanha dos cinco builds incorretos da primitiva. Não equivalem à matriz do futuro gerenciador nem às suas provas de crash/concorrência.

## Registro consolidado na continuação

A execução anterior concluiu coordenação 20/20, ambos os typechecks e cinco verificadores documentais. Seus logs e hashes foram conferidos e o JSON foi sincronizado nesta continuação; o estado pending era documental, não teste em execução. Estes resultados continuam sendo da ponte e das três observações, não da implementação do coordenador. O novo corte de recursos é descrito separadamente em [WP-02-D-LOCK-RESOURCES](WP-02-D-LOCK-RESOURCES.md).
