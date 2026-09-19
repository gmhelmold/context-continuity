# WP-02/C — jobs e tentativas duráveis

Base `62fe09a2cbadb1f5d65e16ac39f964984e5435a7`. Vinculado ao WP-02 / issue #5. Contrato proposto em [SPEC-15](../../specs/v0.1/15-durable-jobs.md). **As fases vermelhas abaixo são históricas e foram preservadas. A continuação corrigiu J01–J05; a validação completa e o gate remoto pertencem ao head final, não aos resultados históricos.**

## Implementação preparada

API canônica SqliteSessionStore: admitJob, readJob, reserveJobAttempt, markJobAttemptDispatched, recordJobAttemptResult, cancelJob, confirmJobAttemptStopped e recoverJobs. Helpers em job-records.ts; não há serviço paralelo, cliente HTTP, alteração de View ou permissão de transporte emitida.

Admissão grava envelope de contexto/expectativa/configuração e manifesto na mesma transação, com raízes atuais e verificação das fontes no orçamento de SPEC-14. Replay retorna registro original; não muda identidade, prazo ou tentativas. Reserva grava aux_run+attempt+contadores antes da transição de intenção de despacho, que só ocorre uma vez. Resultado é decodificado pelo core com novas verificações de fontes, sem criar capítulo.

O perfil é explicitamente limitado a raízes brutas/fontes inline, sem bloco/capítulo/feedback cujo serviço durável ainda não existe. Não significa conclusão de todos os caminhos de WP-02/C ou do WP-02. Valores de tokens são fatos do projetor/transportador autorizado futuro, não medição do modelo nem tokenizer implementado aqui. A configuração não habilita modo complete.

Recovery é explícito; abrir/consultar não modifica jobs. Jobs de owner antigo ficam failed/cancelled conforme o estágio. Tentativa reserved não é reenviada; dispatched fica unknown/quarantine, com reserva conservada. Lease expirado NÃO certifica processo morto. Falta o supervisor de liveness do WP-02 para liberar quarentena cross-owner mediante prova de parada; nenhum método novo admite essa liberação só por TTL. O supervisor do mesmo fence pode registrar parada efetivamente observada, sem declarar conclusão remota.

## Fase anterior: cinco bloqueios encontrados na revisão do autor

| ID | Cenário comprovado | Falha e correção requerida |
|---|---|---|
| J01 | Manifesto declara user para fonte retida sob raiz agent. | A admissão recusa corretamente, mas perde E_SOURCE e devolve E_STORAGE genérico. Corrigir classificação mantendo recusa e sanitização. Não é bypass de autoridade. |
| J02 | Ler um job ready e examinar sua proposta. | Dados da proposta não são profundamente imutáveis. Garantir cópia congelada; a prova não demonstrou alteração do banco pela mutação do objeto retornado. |
| J03 | Resposta somente whitespace após despacho. | Vira oportunidade de reparo, em vez de rejected/E_NO_GAIN terminal. Não gastar outra chamada para esse caso. |
| J04 | Metadados da fonte retida ficam inválidos depois do despacho. | Erro de validação da fonte é confundido com schema da resposta e pode habilitar reparo. Separar estágio de armazenamento do estágio de decodificação; não tentar corrigir o banco com outra geração. |
| J05 | Alterar o título dentro de proposal_json. | Leitura diagnóstica aceita conteúdo diferente sem checksum/validação específica da proposta. Fechar representação e verificação persistidas sem promover leitura a handle verificado. Não houve envio ao provider. |

J01 é a falha da suíte inicial de 39 casos (38 pass / 1 fail). J02–J05 falharam por assertions próprias na revisão dirigida de cinco casos, cujo controle de política passou (1 pass / 4 fail). Os cinco testes permanecem normais, sem skip, todo, inversão ou expected failure.

A edição que corrigiria esses pontos foi bloqueada pela ferramenta ANTES da execução, com status de segurança indeterminado. Nenhum desses fixes havia sido aplicado naquela execução; a continuação descrita abaixo os implementou. A continuação acrescentou apenas testes de processos, controles negativos e rastreabilidade; não tentou publicar a edição recusada por uma rota alternativa. O bloqueio não foi recusa de escrita do GitHub nem falta de autorização do usuário.

## Provas executadas nesta preparação

Tooling local: Node 22.17.1 / TypeScript 5.9.3. Typecheck inicial passou. Um erro de sintaxe na primeira escrita da fixture impediu o carregamento; foi corrigido antes das contagens de comportamento abaixo, não foi contado como detecção de defeito do produto.

- Testes iniciais de comportamento: 38/39; J01 estava vermelho.
- Cinco testes da revisão: 1/5; J02–J05 estavam vermelhos.
- Interrupções de processo: 8/8, antes/depois de COMMIT de admissão, reserva, intenção de despacho e resultado. Banco e processos reais, exclusivamente criados pela fixture. O pai observa mensagem de barreira e interrompe somente seu próprio filho. Reabertura conserva exatamente o lado confirmado da transação, inclusive contadores e estados; recovery não acrescenta tentativa/chapters.
- Uma campanha com quatro pares controle/mutante passou: expectativa ignorada, despacho repetido aceito, fonte não verificada na admissão e saída configurada ignorada. Cada controle executou um teste selecionado e passou; cada mutante falhou na assertion correspondente. A campanha NÃO aprova os cinco outros testes vermelhos.

Interrupção de processo não equivale a queda elétrica. Não houve rede/inferência, benchmark semântico, integração do storage ao OpenCode ou execução do transportador. Nos oito testes, o código executado é o storage real; os dados de contexto e resposta são sintéticos. Os subprocessos de mutação não multiplicam contagens da suíte.

Matriz completa e hashes desta preparação: [WP-02-C.json](evidence/WP-02-C.json). O resultado remoto pertence ao head efetivamente testado e deve ser acrescentado ao PR, sem herdar resultados de outros commits. A matriz vermelha anterior não é um teste aprovado nem uma autorização de merge.

## Critérios de fechamento

**Success Criteria:** identidade e progresso duráveis, sem replay; todas as regressões J01–J05 corrigidas pelo motivo correto.

**Quality Standards:** SQLite/FS reais, crashes determinísticos, fontes sintéticas, controles positivos, matriz fixa e logs ligados ao commit.

**Completeness Criteria:** testes de admissão, fontes, quotas, tentativas, cancelamento, erro/ready e recovery; distinguir estado durável de efeito de rede.

**Definition of Done:** implementação/contrato revisados; nenhum teste conhecido vermelho; suíte e CI final aprovados; comparação da árvore integrada; #5 continua aberto para os demais serviços.

**Invariants:** sem habilitar modo, inferência ou publicação; ausência de resposta não é custo zero; owner antigo não escreve; não remover testes para obter aprovação; não reaplicar ZIPs históricos.

## Continuação corretiva J01–J05

O rascunho foi retomado na mesma worktree, sem ZIP alternativo. Antes de editar, os seis casos selecionados reproduziram **1 pass / 5 fail**; após o patch, **6/6**. Erros vieram dos testes esperados, sem falha de setup.

- **J01/J04:** a verificação de fontes normaliza erros contratuais e de manifesto para E_SOURCE sanitizado. Esse estágio fica separado da decodificação da resposta; erro de fonte não cria oportunidade de reparo. Falha operacional não classificada continua rollback, não oportunidade de inferência.
- **J02/J05:** proposta persistida usa envelope versionado com checksum vinculado ao JobContextRef. Na leitura, o parser estrutural compartilhado do core confere campos/citações/feedback e congela recursivamente os dados. Não há parser paralelo ou VerifiedManifest fictício. Um diagnóstico pode continuar legível após a fonte mudar, mas não autoriza consumir/publicar sua síntese.
- **J03:** resposta complete vazia/whitespace é E_NO_GAIN terminal. Finisher de tool/erro/truncamento continua prevalecendo; não modificar a resposta literal válida por trim.

Dois casos adicionais de ciclo de vida falharam antes e passaram após reforçar a leitura: ready não pode se apoiar numa tentativa failed; uma tentativa terminal não pode manter run running. Não é relato de efeito remoto ou corrupção observada num banco de usuário; são registros sintéticos inconsistentes que o diagnóstico precisa recusar.

O componente do core foi refatorado para expor `parseModelProposal` dentro do módulo: retorna somente ModelProposal imutável e sem brand. `decodeProposal` continua exigindo VerifiedManifest e finisher válido, e só então emite ValidatedProposal. A campanha negativa anterior foi atualizada apenas para a nova localização textual da mesma verificação, mantendo a assertion e os 45 testes selecionados.

### Provas ampliadas

A suite dirigida passou **62/62**: 51 comportamentos de jobs, oito interrupções de processo, uma campanha de nove pares controle/mutante e dois testes do parser de dados. Os nove pares cobrem associação, despacho único, fontes, reserva de saída, classificação, imutabilidade, checksum, whitespace e ausência de reparo para fonte inválida. Subprocessos/repetições não multiplicam a contagem.

Casos extras verificam checksum cruzado entre gerações, schema inválido mesmo com checksum recalculado, diagnóstico sem reatestar bytes, prioridade do finisher e fonte inválida com resposta malformada. A classificação do checksum é consistência, não autenticação contra adulteração total dos controles.

A antiga campanha WP-02/B passou após ajustar 2→3 ocorrências esperadas de conferência de lease: o terceiro ponto é o novo wrapper de jobs. Não houve remoção de verificação ou aumento de prazos. A suíte completa foi novamente executada sobre todos os arquivos; seu resultado consta abaixo e nas evidências, sem aritmética para inventar PASS.

### Comandos de reprodução

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check:core
npm run check:storage
npm run test:core
npm run test:storage
node --test tests/conformance/opencode/test-components.mjs tests/conformance/opencode/test-review004.mjs
python3 tests/conformance/opencode/test-witness.py
python3 scripts/check-spec.py
python3 scripts/check-reference-model.py
python3 scripts/test-spec-check.py
python3 scripts/check-canonical.py
python3 scripts/check-storage-contracts.py
```

O CI mantém seus comandos/pins. Execuções locais pesadas usam `--test-concurrency=1` para não sobrepor campanhas no computador compartilhado. Nenhuma alteração em gateway, schema, dependências, quota, lease ou configuração pessoal. Estado agregado WP-02 permanece aberto; a entrega é persistência de eventos no perfil definido, não executor integrado ou ledger final.

## Matriz local final desta continuação

Node **22.17.1**, TypeScript **5.9.3**: storage **155/155**, core **198/198**, componentes **25/25**, testemunha **4/4**; typechecks e cinco scripts documentais/de referência aprovados. Nenhum teste ignorado, cancelado ou todo nas suítes Node. O storage inclui 60 testes do incremento (51 comportamentos, oito crashes e uma campanha de nove pares); o núcleo recebeu dois testes adicionais de dados sem autoridade.

A fase vermelha anterior **142/148** permanece registrada, inclusive o problema de contagem do mutador já corrigido. A nova matriz foi de fato executada; não foi obtida somando correções aos testes anteriores. Nenhuma fonte mudou durante essa execução final; hashes constam das evidências.

O CI deve ainda conferir os seis workflows/oito jobs do commit publicado nas duas versões fixadas, mais a regressão stock e as oito mutações do host. Esses resultados remotos serão registrados no PR e na issue #5 no head exato, sem confundir regressão da sonda com integração deste storage ao harness. Revisão do autor, não auditoria independente.
