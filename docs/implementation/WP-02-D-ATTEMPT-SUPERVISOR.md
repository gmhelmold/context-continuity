# WP-02/D4 — vínculo e supervisão local de tentativa

**S01/S02 corrigidos no código; integração condicionada ao gate do head final.** Base `d81e2ace6f9f0edc34139074cdeec1c73cf0b951`, continuidade de #5. Contrato: [SPEC-19](../../specs/v0.1/19-local-attempt-supervisor.md).

## Implementação da branch

A reserva pode vincular atomicamente owner da sessão, fence, storage_owner_id, process_instance, binding, JobContextRef e AttemptRef. O envelope fica em attempts.usage_json; não representa faturamento e não muda DDL. O WorkspaceHold recebeu process_instance. Transições de tentativa vinculada exigem o hold emitido e vivo do mesmo participante; leitura do envelope é diagnóstica e imutável. null conserva perfil legado; nenhum job antigo recebe supervisão retroativa.

LocalAttemptSupervisor conserva coordenador privado e uma conexão de sessão da mesma factory. start reserva e grava intenção antes de uma invocação do adaptador interno. cancel grava o estado antes de sinalizar AbortController; callback pendente mantém o slot e impede close. Depois de término observado, resultado de geração cancelada não revive a proposta, e a confirmação local mantém unknown remoto e custos reservados. Lease renovado da mesma geração é aceito; lease perdido impede atualização e preserva quarentena.

Sem HTTP implementado, ferramentas de projeto, retries internos, novo host, alteração de configuração pessoal ou inferência real. O callback usado nos testes é uma operação sintética cuja Promise cobre sua vida inteira. Não é prova de que um adaptador arbitrário fecha sockets antes de resolver; o transporte final terá seu gate. Não há liberação cross-owner nesta implementação.

## Histórico preservado — revisão e fases vermelhas anteriores

Primeira suíte: 18/18 passaram. Acrescentei seis casos, incluindo duas regressões que demonstraram:

| ID | Defeito observado | Resultado dirigido |
|---|---|---|
| S01 | Resultado sem Promise foi aceito como ready por await; assinatura TypeScript não garante retorno em JavaScript. | Falhou: esperava failed, recebeu ready. |
| S02 | Dispatch recusado antes de invocar adaptador deixou job running e tentativa reserved, embora o lease ainda permitisse cancelamento. | Falhou: esperava cancelled, recebeu running. |

As correções não foram aplicadas: a chamada foi bloqueada antes de executar, inclusive uma repetição idêntica. Não foi tentada publicação das correções por outra rota. A fonte foi relida para conferir isso. Código pendente é publicado apenas em PR draft; testes falhos permanecem normais e visíveis.

S01 precisa preservar a diferença entre término observado e protocolo inválido. Uma Promise também não é prova geral de morte de processo; o chamador é adaptador interno confiável, não código de modelo. S02 não deve estornar custos; cancelamento impossível por lease/banco preserva estado conservador e erro explícito. Nenhuma dessas correções permite apagar tentativas ou repetir chamadas.

## Validação

O JSON [evidence/WP-02-D-attempt-supervisor.json](evidence/WP-02-D-attempt-supervisor.json) registra comandos, hashes e resultados reais. Os 24 casos novos pertencem à suíte de coordenação e não se somam a subprocessos. Não reaproveitar o verde do PR #34 para aprovar esta branch. Matriz completa é registrada após execução, com falhas explícitas. Compilação nativa usa headers/pins existentes.

## Cinco axiomas

**Success Criteria:** associação atômica; uma invocação; cancelamento sem liberação precoce; transições condicionadas ao participante e geração corretos.

**Quality Standards:** SQLite e locks reais; adapters sintéticos e promises controladas; Python testemunha o owner durante operação pendente; código de produção compartilhado, não cópia em mocks.

**Completeness Criteria:** identidade/fence/process_instance, reserva e rollback, cancelamento e fechamento, callbacks tardios, entrada incorreta, repetição explícita e lease perdido. Sem gate integral de rede ou cross-process.

**Definition of Done:** corrigir S01/S02, adicionar campanhas negativas correspondentes e ensaios de processo/integração relevantes, repetir matriz nos pins, conferir logs do head exato, só então integrar e atualizar #5.

**Invariants:** não expor fd, não tratar abort/TTL/retired como parada, não apagar reservas nem reexecutar automaticamente, não remover testes para obter verde, não anunciar o plugin instalado.

Rastreamento do bloqueio de integração: [issue #35](https://github.com/gmhelmold/context-continuity/issues/35), vinculada à [WP-02 / #5](https://github.com/gmhelmold/context-continuity/issues/5).

## Matriz local executada nesta rodada

macOS Intel / Node 22.17.1 / TypeScript 5.9.3. Coordenação: **121/123**, exatamente S01/S02 reprovados. Os 99 casos anteriores passaram; os 24 novos terminaram 22/24. Storage e core, componentes, testemunha e verificadores documentais têm códigos/contagens no JSON; não transformar contagem parcial ou timeout em aprovação. Typecheck de storage foi repetido depois de acrescentar os testes de tipos. Nenhum CI remoto é alegado por este registro local.

O estágio permanece **CHANGES REQUIRED**, incluindo campanhas negativas novas e testes de processo/transporte ainda não executados para o supervisor. As campanhas anteriores permanecem testes das camadas que lhes correspondem, não prova de supervisão completa.


## Continuação de verificação de S01/S02

A continuação partiu do head `a7d3717903d4ba2ab60835a184fdc2d904401bd4` do PR #36. A edição de produção foi novamente bloqueada antes de executar, inclusive em repetição idêntica; o módulo foi conferido igual ao head. Esta rodada modifica somente testes e seus registros, sem implementação alternativa ou patch de correção aplicado por outro caminho. S01/S02 continuam **CHANGES REQUIRED**.

A regressão original de S01 verificava status/proposta, mas não a ausência de prova de parada. Três casos adicionais exigem `local_stopped=false` para retorno sem Promise e exceção síncrona, e recusam assimilação de thenable arbitrário. São três falhas adicionais do mesmo limite S01, não três novas issues. Uma Promise rejeitada, depois de seu cleanup controlado terminar, continua sendo um controle positivo distinto. O teste de lease expirado durante falha de dispatch conserva a reserva e exige recuperação explícita; não finge que todo erro é cancelável.

Dois casos de controle completam separação de sessões e observação da ordem de cancelamento. Outro examina a associação durável ANTES da admissão de dispatch. Nenhuma assertion dos 24 casos publicados anteriormente foi removida ou relaxada.

`supervisor-processes.test.mjs` acrescenta quatro ensaios com SQLite e filhos próprios: antes/depois do commit de reserva, cancelamento com operação ainda pendente e resultado confirmado. O processo pai observa a barreira antes de encerrar somente seu filho. A reabertura conserva registros, contadores e número de invocações. A recuperação é explícita, não refaz rede, mantém quarantine para execução desconhecida e não cria capítulos. Estes testes NÃO implementam nem homologam liberação de quarentena cross-owner, transporte HTTP ou queda de energia.

`supervisor-mutations.test.mjs` contém cinco pares controle/mutante em cópias descartáveis: associação ausente, digest ignorado, metadado inválido tratado como legado, sinal anterior ao cancelamento persistido e confirmação de parada prematura. Todos exigem um teste selecionado e ERR_ASSERTION; erro de preparação ou timeout não é detecção. Não são ainda contraprovas da remoção dos fixes S01/S02, pois esses fixes continuam ausentes.

**Erros das fixtures preservados:** o primeiro controle de duas sessões passou campos gerados a createJobContext; a fixture foi corrigida para passar somente SnapshotFields. Na primeira campanha, a associação omitida era recusada pelo dispatch antes de alcançar uma assertion. Um novo teste observa a associação antes do dispatch, sem relaxar a classificação das falhas da campanha. O controle correto e a cópia incorreta agora divergem na assertion prevista.

Resultados e hashes da continuação ficam no campo `acceptance_review` do JSON de evidências. Os resultados anteriores 18/18 e 121/123 são históricos, não a contagem ampliada. O gate não é aprovado por acrescentar provas: os defeitos de produção permanecem.


### Resultado consolidado da continuação

Mac Intel / Node 22.17.1 / TypeScript 5.9.3: **135/140 em coordenação**, com cinco assertions vermelhas (quatro sobre S01 e uma sobre S02); **155/155 storage**, **198/198 core**, **25/25 componentes**, **4/4 testemunha**, build, typechecks e cinco verificadores documentais aprovados. Fonte de produção não foi alterada. Os 17 casos acrescentados são oito comportamentos/regressões, quatro processos e cinco pares de controle/mutante (cada par é um teste, não dois). Sem skip/todo/cancelled. Os 24 testes publicados antes desta continuação continuam byte a byte como prefixo do arquivo ampliado.

As três regressões novas do S01 não elevam o número de issues: detalham o mesmo defeito de validação/término. A campanha nova exige cinco controles corretos e cinco cópias incorretas falhando na assertion esperada. As cópias descartáveis não alteram o checkout. Não foram executados transporte HTTP real, provider pago ou recuperação cross-process que libere quarentena. A fase 121/123 acima é histórica e esta matriz não é aprovação do incremento.

Continuidade obrigatória: corrigir S01/S02 no PR #36, demonstrar que nenhuma ausência de Promise vira stopped, testar reconciliação autorizada/recusada e acrescentar os mutantes da remoção dos fixes. Não encerrar #35/#5 nem integrar enquanto as regressões permanecerem vermelhas.

## Resolução S01/S02 — continuação a partir de da1ae6e

O código do supervisor foi corrigido na mesma branch do PR #36, sem reaplicar artefatos antigos. As cinco regressões existentes foram reexecutadas antes da mudança: 0/5. Após a mudança e correção de um erro de typecheck (código interno de StorageError fora da união), os 32 comportamentos anteriores passaram sem alteração nas assertions. As contagens históricas acima não são o estado dessa correção.

S01: o retorno é verificado como Promise nativa antes de observar seu término por then intrínseco. Retorno inválido/throw síncrono mantém local_stopped=false; nenhuma confirmação separada o transforma em stopped. O supervisor tenta persistir falha/quarentena antes de sinalizar abort. Uma Promise realmente encerrada, inclusive rejeitada, continua constituindo a observação exigida do adaptador interno confiável. Isso não certifica adaptadores arbitrários ou subprocessos destacados.

S02: antes de qualquer invocação, erro de dispatch tenta cancelamento sob owner/fence ainda válidos. Se o commit do dispatch ocorreu antes do erro, a mesma instância pode confirmar a não invocação e o encerramento local; remote unknown e custos continuam preservados. Se a reconciliação também falha ou a autoridade expira, o registro fica conservador e o erro original é reportado. Não há retry ou estorno implícito.

Quatro casos novos cobrem estado durável observado pelo listener de abort, Promise com then sobrescrito, erro pós-commit anterior à invocação e falha na própria reconciliação. Seis novos pares controle/mutante cobrem remoção das correções. Nenhum teste anterior, deadline, pin, schema ou workflow foi alterado para obter aprovação. Resultados, comandos e hashes finais ficam no campo resolution do JSON de evidências, coletados no head correspondente; o PR/issue guardam os resultados de CI e merge.

O bookkeeping local pode ser removido sem prova de parada quando o protocolo do adaptador é inválido. Nesse caso, fechar o supervisor não altera o run em quarantine: nenhuma geração nova é admitida para aquela sessão pelo ledger. Aposentadoria do owner de storage não é confirmação de cleanup ou licença para liberação cross-owner.

### Matriz final local da resolução

macOS Intel, Node 22.17.1 / TypeScript 5.9.3: coordenação **150/150** em série, storage **155/155**, núcleo **198/198**, componentes **25/25**, testemunha **4/4**, build nativo, ambos typechecks e cinco verificadores documentais aprovados. Total de coordenação: 99 casos anteriores + 36 comportamentos do supervisor + quatro processos + onze pares controle/mutante. Esta continuação acrescenta dez casos (quatro comportamentos, seis pares), não 51 testes novos. Cada par é um teste; não somar subprocessos/repetições.

O comando paralelo original terminou **149/150**, por ETIMEDOUT num subprocesso da campanha nativa preexistente. A falha foi preservada, não aceita como detecção; a repetição completa em série passou mantendo os timeouts e os comandos de CI. O CI do head publicado deve executar sua matriz normal antes do merge. O JSON de resolução é captura pré-publicação; os logs remotos do head final e a comparação de árvores são registrados no PR #36 e nas issues #35/#5, sem herdar aprovação de outro commit.
