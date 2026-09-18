# REVIEW-002 — revisão adversarial da especificação atômica

**Data:** 2026-09-17. **Veredito:** CHANGES REQUIRED — não aprovar a especificação como base fechada para implementar o produto completo.

**Objeto auditado:** PR #2, commit `628fca8ddfcb77f71f146046638afb225b5809c1`, branch `atomic-specification`.

**Escopo:** SPEC-CC-0.1, SPEC-01 a SPEC-06, WORK-PACKAGES, REVIEW-001, README, AGENTS e o verificador documental. Leitura dirigida adicional do OpenCode upstream no commit `a97622c801f4ca571530ddc51076af659a9c32cd`. Não é auditoria integral do OpenCode, revisão independente por outra pessoa/modelo, teste do plugin ou benchmark.

**Mudança desta entrega:** apenas este relatório. Os contratos auditados não foram silenciosamente corrigidos. O commit-base acima permanece a referência para reproduzir as observações.

## 1. Conclusão executiva

A direção do produto continua coerente. A especificação, porém, ainda não fecha a composição entre contexto bruto do host, visão efetiva do modelo, capítulos consolidados, versões de regras e ciclos de execução do host. O documento é mais detalhado que o RFC, mas detalhe não equivale a determinismo: em pontos essenciais, dois implementadores ainda poderiam produzir comportamentos incompatíveis e ambos alegar conformidade.

O principal defeito não é falta de recursos. É falta de fechamento das operações existentes quando se encadeiam. O caminho de uma poda isolada está descrito; o caminho de várias podas, uma correção, uma mudança de âncora e um reinício ainda depende de decisões não especificadas.

**Foram registrados 16 achados: 3 bloqueadores, 9 de prioridade alta e 4 de prioridade média.** Esses níveis classificam o risco de aceitar a especificação, não vulnerabilidades reproduzidas num produto implementado. Todos permanecem abertos nesta revisão.

A recomendação é manter o PR sem merge como especificação aprovada. Pode continuar a investigação pública do host e a produção de fixtures. Não congelar ainda contratos de publicação, persistência e adaptador como se o caminho completo estivesse resolvido.

## 2. Método e evidência realmente obtida

Cinco passagens temáticas, feitas pelo mesmo revisor:

1. Tipos, identidades e fronteiras entre núcleo e adaptador.
2. Encadeamento de overlays, snapshots e publicação concorrente.
3. Ledger, regras, recuperação, correções e retenção.
4. Confronto do binding com a ordem de execução e retries do host fixado.
5. Aceitação, verificador documental, dependências dos pacotes e critério de produto.

Foi executado `python3 scripts/check-spec.py` sobre um clone descartável do commit auditado. Resultado observado:

```text
PASS: 14 Markdown files; local links and closed fences.
PASS: 16 findings, 36 requirements, 40 test specifications, 8 work packages with all 5 axioms.
PASS: original RFC Git blob unchanged; reference SQLite DDL and partial unique index valid.
NOT TESTED: plugin/runtime, OpenCode integration, provider cache, semantic quality, performance.
```

Isso reproduz o resultado documental anterior. Não executa nenhuma das propriedades do futuro plugin. As tentativas posteriores de ampliar as sondagens pelo terminal conectado foram bloqueadas pela ferramenta; não há resultados adicionais de execução a atribuir a elas. Os cenários B01–B16 abaixo são evidências estáticas, contraprovas lógicas ou lacunas normativas; não são apresentados como bugs reproduzidos num runtime inexistente. Não houve inferência live nem acesso a credenciais de provider.

Cada achado informa o contrato afetado, um cenário concreto, a correção mínima e o teste que deve passar depois. Uma correção escrita não fecha automaticamente a prova de implementação.

## 3. Índice dos achados

| ID | Prioridade | Problema | Área principal |
|---|---|---|---|
| B01 | Bloqueador | Frame completo é exigido numa fronteira que ainda não dispõe dele | Adaptador / publicação |
| B02 | Bloqueador | Consolidação remove overlays cuja resolução ainda é necessária sobre o histórico bruto | Projeção |
| B03 | Alta | Digests não fecham a relação entre fontes e payload efetivamente apresentado | Identidade / integridade |
| B04 | Alta | Índices de citações, fontes virtuais e proveniência não têm manifesto normativo completo | Ledger / síntese |
| B05 | Alta | Atualização de bloco não publica explicitamente a nova visão nem conserva ordem de ativação | Âncoras |
| B06 | Alta | Correção, revogação e exclusão não fecham invalidação de derivados | Continuidade / retenção |
| B07 | Bloqueador | Duas chamadas físicas por job conflitam com retries internos do host escolhido | Execução / custo |
| B08 | Alta | Cancelamento e ciclo de vida da sessão auxiliar não estão especificados ponta a ponta | Adaptador / cleanup |
| B09 | Alta | Critério de complete não é consistente com a obrigatoriedade do fork fiel | Capacidades |
| B10 | Alta | Feedback por tarefa e criação de notas não têm caminho completo no contrato | Memória adaptativa |
| B11 | Alta | Restore, correção e exportação/importação ainda são intenções, não operações fechadas | Controle / persistência |
| B12 | Alta | Publicação de blobs e GC não compartilham uma regra de exclusão mútua definida | Durabilidade |
| B13 | Média | Paginação não fixa progresso dentro de uma linha maior que o orçamento | Recuperação |
| B14 | Média | Verificador valida existência de IDs, não coerência da rastreabilidade | Qualidade documental |
| B15 | Média | DoD dos pacotes cria dependências retroativas nos testes | Plano de execução |
| B16 | Média | Piloto não tem contrato prévio de decisão e encerramento suficientemente concreto | Validação de produto |

## 4. Achados detalhados

### B01 — O contrato exige um Frame coerente antes de ele existir no hook escolhido

**Prioridade:** bloqueador de integração e de fechamento da API do adaptador. **Confiança:** alta sobre a ordem do código; viabilidade de uma composição alternativa ainda exige ensaio.

**Evidência:** SPEC-01 §§4 e 7 exige `Frame` com digests de system/tools/generation e chama `core.onFrame(frame)` na fronteira real. SPEC-02 §7 exige validar o perfil e o fingerprint atuais antes de publicar. SPEC-04 §§2–3 escolhe o hook de transformação de mensagens para observar/aplicar o contexto e deixa a correlação com os demais hooks como algo a provar. No OpenCode fixado, `prompt.ts` chama a transformação de mensagens e somente depois monta componentes de system e converte as mensagens. Em `llm/request.ts`, os hooks de system/params/headers e a resolução final de ferramentas ocorrem posteriormente. [C1, C2, C4, O1, O2]

**Contraprova:** existe proposta ready para a configuração anterior. O hook de mensagens começa; a configuração final deste turno ainda não foi observada. Publicar nesse momento exige confiar em metadados anteriores. Esperar a configuração posterior para preencher o mesmo Frame exige uma segunda fase; o contrato não define como ela pode aprovar, rejeitar ou remontar a mensagem já transformada sem violar a fronteira do host.

Não se conclui que um plugin seja impossível. Conclui-se que `normalize -> onFrame -> render` não é um binding atômico suficientemente especificado para esta ordem de hooks. A frase “provar correlação segura” é uma tarefa de investigação válida, mas não substitui o protocolo resultante.

**Correção mínima:** desenhar a ordem real de callbacks e separar captura parcial, montagem coerente, seleção da visão e validação final. Definir em qual ponto cada informação fica disponível, qual cópia é imutável e como uma divergência posterior impede o envio. Se o perfil público não oferecer a fronteira necessária, registrar exatamente a capacidade ausente e decidir outro perfil público, sem prometer que o contrato atual basta.

**Prova exigida:** P03/P04/P06/P07 com alteração de system, tools e variante no turno corrente, não apenas entre sessões. O recorder deve mostrar que nenhuma proposta da configuração anterior chega ao provider. Usar dois sessions intercalados e um plugin posterior. Relatório negativo delimita capacidade; não homologa complete.

**Afeta:** WP-00, WP-01, WP-04, WP-06; T06/T08/T29/T39.

### B02 — A segunda compactação não tem uma projeção definida sobre o histórico bruto

**Prioridade:** bloqueador do núcleo. **Confiança:** alta; lacuna de composição, não alegação de impossibilidade.

**Evidência:** SPEC-01 §6 diz que o novo overlay substitui os overlays cobertos; os anteriores permanecem no histórico de revisões. SPEC-04 §3 reaplica overlays ao array que o host apresenta e não grava a síntese no transcript. `render(frame, view)` recebe a visão corrente, mas não há algoritmo normativo de resolução recursiva ou achatamento da cobertura para os IDs originais. [C1, C4]

**Cenário mínimo:**

```text
Host persistido:         A B C D E F
View 1:                 A S1 D E F          S1 cobre B C
View 2 desejada:         A S2 E F           S2 cobre S1 D
Novo turno do host:      A B C D E F G
Resultado exigido:       A S2 E F G
```

Se View 2 mantém apenas o replacement de `[S1,D]`, `S1` não existe no array bruto do host. Um renderer que procura literalmente covered_units não encontra o intervalo. Um renderer que primeiro reconstitui View 1 e depois aplica View 2 pode funcionar, mas essa recursão, sua fonte autoritativa e a resolução de conflitos não foram especificadas. Outro renderer pode achatar para `[B,C,D]`; isso também exige uma regra explícita e verificável.

Manter `parent_chapters` prova lineage de capítulos, não define sozinho a composição de transformações. A verificação de que as covered_units atuais continuam presentes também precisa dizer se está operando sobre a base bruta ou a projeção anterior.

**Correção mínima:** escolher um único modelo. Recomendação: distinguir cobertura física original e cobertura lógica sintetizada, materializando um plano determinístico de substituição sobre a base original, ou especificar replay topológico de revisões com resolução de todas as dependências. Não manter as duas alternativas implícitas. A mesma regra precisa cobrir consolidação parcial, capítulos adjacentes, conteúdo repetido, reset, correção e restore.

**Prova exigida:** ampliar T27 para comparar payloads e ordem exata depois de duas, dez e várias consolidações, sempre partindo do histórico bruto reapresentado pelo host e repetindo após reinício. Verificar também o caso em que o host já oferece uma síntese reconhecida. Testar não apenas que o DAG é acíclico.

**Afeta:** WP-01/WP-02/WP-04; T07/T08/T13/T27.

### B03 — O digest de cobertura não vincula inequivocamente o conteúdo visto pelo modelo

**Prioridade:** alta. **Confiança:** alta sobre a lacuna contratual; não há renderer implementado para testar.

**Evidência:** SPEC-01 define `source_digest` sobre `(unit_id, source_refs)` e o fingerprint sobre rota/modelo/system/tools/configurações. `ContextUnit` também possui payload_ref, kind, authority, protocol_group e native_refs, mas a relação determinística entre esses campos, as fontes e os bytes renderizados não está fechada. [C1]

**Cenário:** duas representações da mesma fonte mantêm unit_id/source_refs, mas o adaptador apresenta texto ou metadados nativos diferentes. Isso pode ocorrer numa transformação legítima de outro plugin ou numa unidade sintética que cite as mesmas fontes. As listas cobertas podem ter o mesmo digest mesmo que o que o agente recebeu não seja igual. Um ID de fonte prova identidade da fonte; não prova que o payload de saída é sua transformação autorizada.

**Correção mínima:** definir os bytes/estrutura canônica que constituem a identidade da unidade renderizada e incluí-los na validação do snapshot, preservando payloads opacos. Separar hash de fonte, hash da unidade efetiva e fingerprint de configuração. Ou impor uma relação determinística comprovável entre payload e fontes; não deixar isso a cada adaptador. Definir também como IDs e revisões dessas unidades permanecem estáveis após reinício.

**Prova exigida:** manter source_refs constantes e alterar somente payload renderizado, papel ou metadado relevante. A proposta deve ficar stale. Conteúdo efetivamente idêntico deve continuar elegível, mesmo com metadado de transporte irrelevante mudado. Uma alteração não semântica não pode justificar remover metadata obrigatória.

**Afeta:** WP-01/WP-04; T06/T07/T29/T37/T39.

### B04 — Citações por índice não têm um manifesto durável suficientemente definido

**Prioridade:** alta. **Confiança:** alta.

**Evidência:** `Claim.sources` usa índices 1-based no manifesto. O texto permite citar fonte original, capítulo ou âncora. `SourceRef` possui apenas source_id/revision/digest; a tabela sources contém fontes, enquanto capítulos e blocos têm identidades próprias. Snapshot/Chapter preservam arrays de SourceRef, mas não há schema do manifesto que vincule um índice a uma fonte de tipo específico, ao recorte apresentado e à sua autoridade. A leitura de capítulo promete devolver esse manifesto. [C1 §§2,4–6; C3 §2; C5 §§2–3]

**Cenário:** o manifesto do job tem fonte bruta, uma âncora e um capítulo anterior. A proposta retorna `sources:[2]`. Após reinício ou exportação, uma implementação usa a segunda source_ref do intervalo; outra usa o segundo item do manifesto expandido. Ambas conseguem verificar que “2 existe”, mas podem atribuir a afirmação a origens diferentes. Fonte de resumo também pode ser confundida com evidência direta se não houver uma representação tipada obrigatória.

**Correção mínima:** persistir um ManifestEntry versionado com índice estável, kind, referência correspondente, revisão/digest, autoridade, recorte e indicador do que foi efetivamente apresentado. Definir como fontes virtuais de capítulos/blocos são resolvidas, ou convertê-las explicitamente para uma representação comum. Nenhuma reordenação de manifesto depois da geração. Claims apontam para esse manifesto congelado, não para arrays reconstruídos por convenção implícita.

**Prova exigida:** job com fontes originais, âncoras e capítulos misturados; gerar claims; reiniciar; exportar/importar; cada claim deve continuar resolvendo para a mesma fonte, versão, intervalo e autoridade. T37 verificar existência de índice não basta.

**Afeta:** WP-01/WP-02/WP-05; T07/T20/T27/T31/T32/T37.

### B05 — Mudar uma âncora não publica explicitamente a visão que usa a versão nova

**Prioridade:** alta. **Confiança:** alta.

**Evidência:** View contém versões ativas de blocos; views persiste `blocks_json` e policy_revision. A transação “Atualizar bloco” de SPEC-03 insere a nova versão, desativa a anterior, incrementa policy_revision e cancela jobs, mas não insere/seleciona uma nova View nem define que blocks_json é um cache derivado a reconstruir. SPEC-05 exige ordem de ativação estável, mas o schema não tem identidade/ordinal dessa ativação separada da data de criação de uma versão. [C1 §6; C3 §§2,4; C5 §4]

**Cenário:** View 8 aponta para regra `b@1`. O usuário substitui por `b@2` quando não há compactação acontecendo. A transação documentada termina. O próximo renderer deve seguir View 8 ou consultar blocos ativos fora dela? Se usa View 8, a regra antiga permanece; se usa os ativos, a visão persistida já não descreve sozinha a entrada selecionada. Uma ordenação por created_at da versão também pode mover o bloco ao atualizá-lo, apesar da promessa de manter ordem de ativação.

**Correção mínima:** escolher entre versões de visão inteiramente materializadas ou composição explícita com um snapshot separado de blocos. A atualização deve publicar atomicamente a combinação usada pelo próximo frame e manter um ordinal estável de ativação. Pause não deve impedir uma correção autorizada de regra de aparecer.

**Prova exigida:** trocar/remover/ativar bloco sem job, em pause, entre commit e próximo frame e após reinício. A próxima entrada deve refletir exatamente a política vigente, uma vez, sem depender de uma compactação futura. Verificar ordem e receipt de versão.

**Afeta:** WP-02/WP-04/WP-05; T21/T22/T23/T28.

### B06 — A invalidação de derivados não fecha correção, revogação e exclusão

**Prioridade:** alta. **Confiança:** alta sobre a falta da regra transitiva.

**Evidência:** SPEC-02 invalida overlays dependentes de uma fonte alterada e cancela propostas após mudança de regras. SPEC-03 descreve correção por novo capítulo e exclusão. Porém o grafo normativo só define lineage de consolidações, sem fechar como dependências de claims, âncoras e fontes se propagam a capítulos já publicados, índices, recibos e futuras consolidações. [C1 §§5–6; C2 §§7–8; C3 §§6–7]

**Cenário:** fonte X sustenta capítulo A; capítulo B incorpora A; o usuário corrige X ou retira uma regra reproduzida em A. Cancelar o job atual não atualiza B. Outro exemplo: exclusão de um arquivo do ledger não define o tratamento de texto desse arquivo reproduzido em sínteses e no índice. Não se pode confundir “preservar o passado” com continuar apresentando um derivado antigo como estado vigente.

**Correção mínima:** definir dependências transitivas e duas operações diferentes: supersessão histórica e exclusão/redação autorizada. Uma correção precisa invalidar ou marcar derivados e fornecer o estado vigente sem apagar história indevidamente. Uma exclusão deve ter contrato explícito sobre derivados, índice, propostas e backups gerenciados; não prometer remoção além do escopo controlado. Também definir o que fazer quando o derivado inválido já participa da visão e expandi-lo não cabe.

**Prova exigida:** X -> A -> B com a correção/exclusão feita depois de ambos publicados; reiniciar; buscar, ler e compactar novamente. Nenhum derivado deve voltar como verdade atual silenciosamente. Testar regra revogada citada num resumo, não somente o bloco fixado removido.

**Afeta:** WP-02/WP-04/WP-05; T11/T20/T22/T27/T32.

### B07 — O orçamento de duas chamadas físicas não controla os retries do OpenCode

**Prioridade:** bloqueador do contrato de execução/custo do binding. **Confiança:** alta, fundada em código estático do host fixado.

**Evidência:** SPEC-02 §6 limita o job a duas chamadas físicas totais. SPEC-04 §4 propõe usar sessão/fork público do host. No OpenCode fixado, `SessionProcessor.process` envolve `llm.stream` em `Effect.retry(SessionRetry.policy(...))`. `retry.ts` define `RETRY_MAX_RETRIES = 5`. Esses retries estão dentro da execução do host, não são as duas invocações externas de `ContextAdapter.fork`. [C2, C4, O3, O4]

**Cenário:** o núcleo registra uma chamada auxiliar. O provider responde com falhas transitórias e o host tenta novamente dentro da mesma operação. A Promise pode terminar com sucesso só depois de mais de duas tentativas de transporte. O contador `attempts` do job continuaria em 1 numa implementação que conta chamadas ao adaptador. Um segundo reparo externo ampliaria a divergência. Não foi executado um ensaio de rede; a política interna de retry foi verificada no código.

Dizer “no máximo duas chamadas físicas” não cria controle sobre as camadas internas do SDK/host. O deadline cancela tarde, não impede a terceira tentativa por si só.

**Correção mínima:** escolher e verificar um caminho público que permita desativar/controlar retries internos, ou oferecer ao núcleo uma admissão antes de cada tentativa física. Todas as camadas participantes, inclusive geração auxiliar do host e eventuais continuações, devem ser contabilizadas. Se isso não existir no perfil, não anunciar o limite rígido: a decisão de custo/execução precisa ser revista explicitamente antes de homologia.

**Prova exigida:** provider controlado com sequência de falhas transitórias; contador no endpoint de teste mede tentativas reais. O teste deve abranger retries internos e um reparo externo, com deadline e reserva incerta, sem usar credenciais live. Uma contagem de invocações do mock `fork` não atende ao oráculo.

**Afeta:** WP-00/WP-03/WP-06; T06/T35/T40 e novo passo no G-OC-01.

### B08 — Cancelar a Promise não define a morte do clone nem o destino da sessão auxiliar

**Prioridade:** alta. **Confiança:** alta sobre a lacuna de lifecycle; não foi executado um clone real.

**Evidência:** o contrato de fork recebe AbortSignal, o binding usa sessão/fork do host e menciona registro privado de jobs. Não estão especificadas a ligação durável job -> host auxiliary session, a operação pública que efetivamente interrompe a geração no host, a ordem de cleanup nem a política de retenção/deleção do transcript auxiliar. O documento promete que o envelope fica só em memória, mas um fork público de sessão pode criar material durável no host. [C1 §§4,7; C2 §§5–6,9; C4 §§3–4,6]

**Cenário:** o plugin é recarregado ou perde a espera da requisição auxiliar; o host que possui a execução continua vivo. Aguardar abortar uma requisição HTTP não demonstra que a sessão auxiliar parou de gerar. Ela pode persistir mesmo depois de o job local ser failed/cancelled. Repetir o processo deixa sessões auxiliares, contabilização incompleta e retenção fora do ledger. Não se afirma que todo AbortSignal tenha essa falha; a semântica depende da API usada e não foi especificada.

**Correção mínima:** contrato explícito de criação, identidade, execução, interrupção, observação e limpeza do clone no host. Definir quando a parada é confirmada e quando fica desconhecida; desconhecido mantém reserva e impede alegação de cancelamento confirmado. Persistir apenas os identificadores necessários, não credenciais. Definir também o que permanece retido no host e como respeitar exclusão autorizada.

**Prova exigida:** reload do plugin mantendo host vivo, interrupção da conexão cliente, timeout, cancelamento do pai e reinício completo. Contar requests/atividade remanescente e sessões auxiliares após cleanup. Não basta verificar `signal.aborted` num stub.

**Afeta:** WP-00/WP-02/WP-03/WP-06; T04/T05/T12/T24/T32/T40.

### B09 — O PASS de complete não usa uma única regra de fidelidade

**Prioridade:** alta. **Confiança:** alta.

**Evidência:** SPEC-01 §8 enumera as capacidades obrigatórias de complete, mas não inclui explicitamente fidelidade da entrada ativa. SPEC-04 §5 declara PASS com P01–P06/P08–P10 e trata P07 como determinação adicional de fidelidade/cache; em seguida diz que fidelidade é obrigatória para o perfil completo com kage bunshin. T06 aceita resultado de divergência/unknown como observação válida. [C1, C4, C6]

**Cenário:** um relatório satisfaz os passos que não incluem P07 e marca a fidelidade como unknown. É investigação bem-sucedida? Gate completo aprovado? Complete sem clone fiel? As três interpretações têm apoio em trechos diferentes. A regra “nenhuma compatibilidade presumida” não resolve qual booleano deve ser calculado.

**Correção mínima:** separar resultado da investigação, capacidade de edição e fidelidade do fork. Definir a conjunção exata que habilita o perfil de produto prometido. Cache hit continua independente; não exigir cache hit para correção nem confundi-lo com fidelidade. Produzir uma tabela verdade curta para verified/unknown/different por capacidade.

**Prova exigida:** CapabilityReport sintético com cada combinação-limite. `prefix_fidelity=unknown/different` deve levar a um resultado único e documentado; nenhum teste com diagnóstico bem-sucedido pode ser interpretado como autorização do perfil completo por acidente.

**Afeta:** WP-00/WP-01/WP-06; T06/T25/T29/T33.

### B10 — A adaptação poda 30 -> 31 não tem canal completo para tarefa, nota e expiração

**Prioridade:** alta. **Confiança:** alta.

**Evidência:** SPEC-05 §5 exige recibos associados à tarefa/etapa, detecta repetição dentro desse escopo e permite nota criada pelo maintainer. Scope/Frame não carregam contexto de tarefa/phase; `retrievals` não tem campo desse escopo; ModelProposal rejeita campos desconhecidos e não possui operação de nota de retenção. `blocks.scope_json` permite guardar escopo de um bloco, mas isso não especifica como o escopo da leitura chega ali ou como o maintainer produz a nota. [C1 §§2,4–5; C3 §2; C5 §§4–5]

**Cenário:** três leituras do mesmo contrato ocorrem em tarefas distintas dentro da mesma sessão. Sem o escopo persistido, podem ser consideradas repetição local ou ignoradas indistintamente. O clone precisa sugerir um recorte, mas a saída estrita não contém esse campo. Um implementador cria um canal lateral; outro extrai arbitrary claims do resumo; um terceiro não cria notas. A feature central acaba com três semânticas.

**Correção mínima:** definir um contexto opcional de trabalho fornecido pelo adaptador e persistido no recibo, com comportamento quando ausente. Escolher um único dono da nota: política determinística a partir do recorte lido, ou saída explícita e limitada do maintainer. Definir expiração em relação a publicações da sessão, inclusive o momento exato em que uma nota criada no capítulo N expira. Evitar mais um agente para fazer isso.

**Prova exigida:** três tarefas na mesma sessão, leituras de ranges parcialmente sobrepostos, perda do escopo e reinício entre recuperação e poda seguinte. Verificar texto, autoridade, prioridade e expiração das notas com a mesma especificação em dois adaptadores.

**Afeta:** WP-01/WP-02/WP-05; T23/T26/T38.

### B11 — Restore e correção não têm transações completas; export/import não têm schema fechado

**Prioridade:** alta para as operações de controle anunciadas. **Confiança:** alta.

**Evidência:** SPEC-05 dá uma entrada mínima para restore e diz que ele cria nova revisão. SPEC-03 diz que correção cria novo capítulo/revisão; porém Chapter exige job_id e `chapters.job_id` é obrigatório e único, sem tipo de operação de correção manual definido. Exportação usa manifest.json schema_version=1 com lista narrativa de conteúdo, mas não fornece schema de campos, relações e remapeamento de identidades. [C1 §6; C3 §§2,6–7; C5 §§6–7]

**Cenário:** o usuário quer restaurar somente um trecho de um capítulo consolidado ou corrigir sua síntese sem chamar modelo. Deve retirar todo o replacement, dividi-lo, gerar um novo job published sem inferência ou criar capítulo sem job? Como preservar a parte resumida remanescente e desfazer derivados posteriores? No import, que identidades precisam mudar e quais referências precisam ser reescritas para formar o namespace novo? Os documentos não escolhem.

**Correção mínima:** especificar comandos como operações de estado reais, com entradas completas, regras de cobertura, versão esperada, efeitos e erros. Ou retirar explicitamente do primeiro incremento as operações ainda sem contrato, em vez de exigir sua implementação no DoD. Separar proveniência de operação de proveniência de geração: não fabricar job de LLM para preencher uma FK. Fechar um manifest de export/import pequeno e versionado antes de prometer portabilidade de dados.

**Prova exigida:** restauração parcial de S2 que consolidou S1, correção humana sem inferência, conflito de revisão, orçamento insuficiente, crash no commit e round-trip de arquivo com referências mistas. A cauda atual deve permanecer e nenhum efeito externo é repetido.

**Afeta:** WP-01/WP-02/WP-04/WP-05/WP-06; T11/T24/T27/T32/T38.

### B12 — GC pode disputar um blob antigo com uma nova referência

**Prioridade:** alta. **Confiança:** média-alta; contraprova de desenho, não race reproduzida.

**Evidência:** SPEC-03 grava/reutiliza blobs antes de inserir referência no SQLite, compartilha blobs por hash dentro do workspace e permite GC de órfãos após 24h. O lock definido é de sessão, não cobre explicitamente publicação de blob e GC em todo o workspace. Não há protocolo de pin/reserva ou rechecagem serializada entre essas duas operações. [C3 §§1,3–4,6]

**Interleaving permitido pela descrição atual:** um blob órfão antigo existe; uma captura/importação nova verifica seu hash e decide reutilizá-lo; o GC observa que ainda não há referência durável e o remove; a captura termina inserindo a referência. A tolerância de 24h não protege um blob antigo que volta a ser utilizado. A verificação de “fora de jobs ativos” não define a coordenação com importações e capturas ainda sem referência publicada.

**Correção mínima:** uma regra pequena de exclusão mútua por workspace, ou pin/reserva transacional com revalidação de referências, abrangendo publicação e remoção de blobs. Definir o ponto em que o arquivo deixa de poder ser apagado. Usar a mesma autoridade para contabilizar reserva de bytes na quota do workspace quando capturas de sessões diferentes concorrem. Não precisa de serviço distribuído.

**Prova exigida:** pausas determinísticas nas bordas verificar-reutilizar/inserir-ref e listar-órfão/remover, com duas sessões/importação e GC concorrentes. Depois do commit, todo blob capturado publicável deve existir e ter digest correto. Testar quota com dois escritores.

**Afeta:** WP-02; T03/T12/T19/T32 e novo caso de concorrência de storage.

### B13 — Uma linha enorme torna a paginação ambígua

**Prioridade:** média. **Confiança:** alta sobre a omissão.

**Evidência:** context_read oferece ranges de linhas, máximo de 64 KiB e orçamento de tokens. O cursor tem próxima posição opaca, mas não existe definição de posição intra-linha nem de returned_range para um pedaço de linha. A saída de busca também pode precisar carregar metadados maiores que o menor orçamento. [C5 §§1–2]

**Cenário:** a fonte é um JSON minificado com uma única linha maior que o limite de resposta. Recusar sempre a linha inteira impede recuperar o conteúdo; retornar um pedaço e avançar para a linha 2 perde o restante; manter linha 1 sem offset repete a mesma página. O implementador precisa inventar uma semântica.

**Correção mínima:** definir cursor interno em offset de bytes ou code points com fronteira UTF-8 segura, além dos ranges de linhas para a interface. Garantir avanço estrito a cada página não vazia, fidelidade dos bytes e erro explícito quando nem o envelope mínimo cabe. Não normalizar o original para facilitar a paginação.

**Prova exigida:** uma linha longa, CRLF, caracteres multibyte, fonte vazia e orçamento mínimo. Concatenar todas as páginas deve recompor o conteúdo permitido sem perda/duplicação; o cursor não pode ficar preso.

**Afeta:** WP-05; T20/T38.

### B14 — O CI não comprova a coerência que o nome rastreabilidade sugere

**Prioridade:** média. **Confiança:** alta, verificação do código e reprodução do CI original.

**Evidência:** `validate_traceability` confirma a existência de R/T/WP e que cada coluna cita um ID conhecido. Não verifica que o teste atende à obrigação, que o dono inclui esse requisito em seu próprio pacote, ou que o grafo de dependências é válido. `validate_markdown` ignora fragmentos de links locais. O teste SQL só cria uma sessão e disputa o índice one_active_job, não exercita as demais transações/relacionamentos. O script é explícito sobre não ser teste de runtime, o que está correto. [V1]

**Contraprova estática:** trocar na linha R08 o teste T08 por T01 preserva um ID existente e satisfaz as verificações implementadas. Trocar o dono por outro WP existente também pode passar. Um fragmento inexistente num arquivo existente não é validado. Essas mutações não foram executadas nesta revisão; a ausência de predicado correspondente é diretamente observável no código.

**Correção mínima:** chamar a verificação atual de integridade referencial documental, não de validação semântica. Centralizar o mapa requisito -> testes -> donos -> dependências em uma estrutura validável e verificar reciprocidade/grafo. Adicionar mutações do verificador para referências trocadas e fragmentos quebrados. Não tentar substituir revisão de significado por uma regex maior.

**Prova exigida:** CI deve falhar com as mutações documentais dirigidas que decidir cobrir. A validação de transações e a qualidade de síntese continuam fora desse CI e não podem herdar seu status verde.

**Afeta:** manutenção da especificação; critérios comuns dos WPs.

### B15 — A ordem do trabalho não permite satisfazer alguns DoDs quando prometido

**Prioridade:** média. **Confiança:** alta.

**Evidência:** WP-01 exige T37 completo no DoD. T37 inclui reparo dentro de duas chamadas físicas, comportamento implementado só em WP-03, que depende de WP-01/02. WP-02 exige T12, cujo caso inclui commit e retorno do hook/projeção published, e essas partes são integradas em WP-04/06. A matriz atual não distingue subcasos unitários e integração final sob o mesmo ID. [C6, W1]

**Cenário:** ao terminar contratos do núcleo, o implementador ou marca WP-01 incompleto até uma fase que depende dele, ou reduz silenciosamente T37 a um parse local e afirma que passou. O problema é do critério de encerramento, não de ser impossível desenvolver incrementalmente.

**Correção mínima:** dividir IDs transversais em subcasos com dono e pré-requisitos, por exemplo contrato, agendador e integração. Um WP fecha sua parcela explicitamente; o teste completo só fecha na integração. Separar autorização para começar o pacote dependente de prova integrada final, mantendo rastreabilidade sem circularidade.

**Prova exigida:** uma ordenação topológica dos pacotes deve permitir satisfazer cada DoD com os componentes disponíveis naquele ponto. Verificar o grafo e a matriz de subcasos no CI documental. Nenhum pass parcial deve ser apresentado como pass completo.

**Afeta:** WP-01/WP-02/WP-03/WP-04/WP-06; T12/T37/T40.

### B16 — O experimento de produto ainda não determina quando o resultado é suficiente

**Prioridade:** média; não bloqueia spike de engenharia. **Confiança:** alta.

**Evidência:** WP-07 e T34 pedem repetições, variabilidade, ablação e proíbem inventar threshold depois, mas não definem o protocolo que deve existir antes da execução: unidade de análise, tarefa aceita, intervenção corretiva, tratamento de interrupções, horizonte de sessão, orçamento e regra de avanço. [C6, W1]

**Cenário:** um sistema reduz erros após cinco compactações, custa mais e falha mais cedo em outra categoria. Sem critérios pré-registrados, o mesmo resultado pode justificar tanto sucesso quanto adiamento indefinido. Medir tokens não resolve essa decisão de produto.

**Correção mínima:** antes do primeiro ensaio live, publicar protocolo pequeno com cenários representativos, definições de métricas, orçamento máximo, tratamento de execuções interrompidas e critérios de não regressão/avanço. Não é necessário escolher agora uma melhoria comercial arbitrária; é necessário tornar essa escolha uma entrada explícita anterior ao teste. Separar sucesso da integração, ganho do mecanismo e paridade entre hosts.

**Prova exigida:** uma execução de avaliação deve produzir uma decisão rastreável ao protocolo prévio, inclusive quando negativa ou inconclusiva. Um resultado inconclusivo deve ter motivo e próximo experimento delimitado, não ser promovido a sucesso.

**Afeta:** WP-07; T34/T35.

## 5. O que NÃO estou classificando como defeito

Não é defeito que o modelo ainda possa omitir algo num resumo: memória perfeita não é a promessa. O review cobra preservação estrutural, recuperação e avaliação, não verificação universal de verdade.

Não é defeito a perda parcial de cache ao substituir um prefixo. O defeito seria prometer outra semântica ou deixar de medir a entrada real. A documentação oficial de prompt caching confirma a dependência do prefixo; isso não autoriza declarar cada capítulo um cache independente. [E1]

Não é defeito ter gate de integração ainda não executado. B01/B07/B09 apontam o conteúdo específico que precisa fechar nesse gate e o que o contrato atual não resolve; não transformam uma ausência de teste, sozinha, num bug.

Não exijo banco vetorial, serviço remoto, novo coordenador distribuído ou agente revisor para cada poda. As correções centrais são de representação, ordem de operações e testes. O SQL de referência é sintaticamente válido no ensaio documental realizado. Não há aqui alegação de falha de cascades ou vazamento entre sessões reproduzidos.

O uso de snapshots e de capítulos recuperáveis continua sendo a direção a preservar. O objetivo do review é tornar essa direção implementável sem cada camada inventar uma parte diferente do contrato.

## 6. Ordem mínima de correção

### Grupo 1 — Fechar entrada, projeção e saída do host

Resolver B01/B02/B03/B07/B08/B09 em conjunto. Produzir dois diagramas de sequência textuais: um turno primário com todos os hooks e uma geração auxiliar com todas as tentativas físicas. Definir o plano de overlay que pode ser reaplicado depois de N compactações. Executar o primeiro spike público antes de fechar o restante do binding.

Não começar pela interface visual nem por cinco adaptadores. O primeiro resultado necessário é um ciclo real com um clone sem efeitos e um contexto adotado verificável.

### Grupo 2 — Fechar a memória versionada

Resolver B04/B05/B06/B10/B11/B12. Um manifesto resolve proveniência; uma regra de composição resolve a visão; uma política de dependências resolve correções. Reaproveitar essas mesmas estruturas em restore e exportação, em vez de criar mecanismos paralelos.

### Grupo 3 — Fazer a aceitação corresponder ao trabalho

Resolver B13/B14/B15/B16. Acrescentar casos de múltiplas compactações, linha longa e concorrência de blob; separar subcasos por camada; corrigir o grafo de DoD; explicitar o protocolo de avaliação antes do live.

**Critério para re-review:** cada Bxx precisa apontar para a mudança que o trata, a decisão normativa escolhida e a prova correspondente. “Adicionado ao backlog” não é resolução. Uma prova de host negativa pode encerrar investigação, mas não habilita o perfil completo. Corrigir documentação não equivale a passar testes ainda inexistentes.

## 7. Estado de entrega e limites

Este relatório deve acompanhar o PR #2 como comentário de mudanças requeridas, sem merge. Não foram alterados schemas, fórmulas ou WPs nesta entrega, para não confundir o diagnóstico com a correção. Os 40 testes de produto permanecem não executados.

O resultado altera a avaliação anterior: a SPEC-CC-0.1 é uma **proposta substancial de contratos**, mas ainda não é uma especificação atomicamente fechada. Aceitar essa distinção agora evita que a implementação congele justamente as ambiguidades mais caras.

## 8. Fontes fixadas

Os links abaixo apontam para os commits auditados, não para a branch mutável após a inclusão deste relatório. As afirmações sobre conteúdo do repositório se referem a esses snapshots.

- **C1:** [SPEC-01 — contratos](https://github.com/gmhelmold/context-continuity/blob/628fca8ddfcb77f71f146046638afb225b5809c1/specs/v0.1/01-contracts.md).
- **C2:** [SPEC-02 — ciclo](https://github.com/gmhelmold/context-continuity/blob/628fca8ddfcb77f71f146046638afb225b5809c1/specs/v0.1/02-lifecycle.md).
- **C3:** [SPEC-03 — ledger e DDL](https://github.com/gmhelmold/context-continuity/blob/628fca8ddfcb77f71f146046638afb225b5809c1/specs/v0.1/03-ledger.md).
- **C4:** [SPEC-04 — OpenCode](https://github.com/gmhelmold/context-continuity/blob/628fca8ddfcb77f71f146046638afb225b5809c1/specs/v0.1/04-opencode.md).
- **C5:** [SPEC-05 — tools e UX](https://github.com/gmhelmold/context-continuity/blob/628fca8ddfcb77f71f146046638afb225b5809c1/specs/v0.1/05-tools-ux.md).
- **C6:** [SPEC-06 — aceitação](https://github.com/gmhelmold/context-continuity/blob/628fca8ddfcb77f71f146046638afb225b5809c1/specs/v0.1/06-acceptance.md).
- **W1:** [Work packages](https://github.com/gmhelmold/context-continuity/blob/628fca8ddfcb77f71f146046638afb225b5809c1/specs/v0.1/WORK-PACKAGES.md).
- **V1:** [check-spec.py](https://github.com/gmhelmold/context-continuity/blob/628fca8ddfcb77f71f146046638afb225b5809c1/scripts/check-spec.py).
- **O1:** [OpenCode prompt.ts, região do hook e montagem da chamada](https://github.com/anomalyco/opencode/blob/a97622c801f4ca571530ddc51076af659a9c32cd/packages/opencode/src/session/prompt.ts#L1180-L1310).
- **O2:** [OpenCode llm/request.ts, montagem e ferramentas](https://github.com/anomalyco/opencode/blob/a97622c801f4ca571530ddc51076af659a9c32cd/packages/opencode/src/session/llm/request.ts).
- **O3:** [OpenCode processor.ts, loop de retry](https://github.com/anomalyco/opencode/blob/a97622c801f4ca571530ddc51076af659a9c32cd/packages/opencode/src/session/processor.ts#L640-L716).
- **O4:** [OpenCode retry.ts, limite e política](https://github.com/anomalyco/opencode/blob/a97622c801f4ca571530ddc51076af659a9c32cd/packages/opencode/src/session/retry.ts).
- **E1:** [OpenAI — Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching), consulta em 2026-09-17; sem comparação de preços ou benchmark nesta revisão.

A análise do código externo foi dirigida às fronteiras relevantes. Não se afirma ter executado suas APIs, auditado todo o monorepo ou confirmado capacidades de hosts que não participaram desta revisão.
