# RFC-CSC-001 — Continuous Self-Compaction & Context Management

**Estado:** proposta de desenho formal, para revisão. Não é especificação executável nem autorização para iniciar implementação.

**Versão:** 0.1 — 17 de setembro de 2026.  
**Produto:** continuidade de sessões longas de orquestração no HuGR-Orchestra.  
**Conceito de experiência:** agentic subconsciousness.  
**Repositório:** `gmhelmold/HuGR-Orchestra`.  
**Base de código examinada:** `maestro/rebuild-fork-dev-clean`, commit `b0c33d2f6567a2c741240f3c44bc00ca2f01e7e7`.  
**Escopo desta entrega:** decisões de produto, arquitetura lógica, fronteiras, invariantes e provas necessárias para avançar. Nenhuma alteração de runtime.

## 1. Decisão de produto

Construir uma capacidade nativa de continuidade de sessão: compactação preventiva, incremental e assíncrona, executada por um fork do próprio orquestrador, com capítulos recuperáveis, âncoras e contexto curado.

O orquestrador continua responsável por objetivos, delegação, decisões e aceite. Workers continuam executando tarefas. A manutenção organiza a representação do contexto; não assume a coordenação do projeto.

**Promessa de produto:** o trabalho encerrado deixa de ocupar espaço desnecessário, os compromissos importantes permanecem presentes e o passado continua consultável sem o usuário reconstruir a sessão.

O valor principal é mais trabalho útil antes de uma intervenção humana corretiva de contexto. Redução de tokens e economia são medidas auxiliares; não substituem qualidade de execução.

“Subconsciente” é uma metáfora de atividade auxiliar. O fork não recebe pensamentos privados adicionais, não altera pesos e não é um segundo stakeholder.

## 2. O que este RFC decide — e o que fica para depois

Este RFC fixa responsabilidades, ciclo de vida, semântica de compactação, política de permanência e limites entre componentes. A proposta técnica anterior em Word é material de origem; seus tipos, endpoints e números ilustrativos não são automaticamente promovidos a compromissos de implementação.

A próxima etapa especificará schemas, APIs internas, transações, prompts, orçamento exato, testes, migrações e work packages. O desenho deve ser revisado antes dessa decomposição.

Termos usados neste documento:

- **Decisão proposta:** comportamento escolhido para o produto, sujeito à revisão deste RFC.
- **Evidência:** comportamento localizado nos arquivos ou fontes listados ao final.
- **Hipótese:** ganho de qualidade, custo ou compatibilidade que ainda requer execução.

## 3. Escopo mínimo de produto

O primeiro produto completo atende um orquestrador com seus workers existentes, num único runtime/provider homologado inicialmente. Inclui gatilho de 50%, um fork de manutenção por vez, compactação conservadora de intervalo delimitado, ledger pesquisável, âncoras mínimas, ativação explícita de blocos curados e feedback de recuperações.

Não inclui novo framework multiagente, memória global entre projetos, banco vetorial obrigatório, serviço remoto de cache, treinamento on-line, comitê de revisores nem verificação universal de alucinações. Não exige migração geral do Maestro ou reestruturação do Atlas.

O MVP não oferece edição livre de qualquer token. Começa substituindo um intervalo elegível por uma síntese, preservando a ordem do restante. Reorganização significa consolidação dentro dessa representação, não permutação arbitrária do histórico.

## 4. Arquitetura lógica

```text
                    USUÁRIO / FLUXO DE TRABALHO
                               |
                         ORQUESTRADOR <----> WORKERS
                               |
                montagem e consumo do contexto ativo
                               |
                    COORDENAÇÃO DA MANUTENÇÃO
                               |
             snapshot estável + missão de compactação
                               |
                         FORK AUXILIAR
                               |
                       proposta / nenhuma poda
                               |
               validação local + publicação entre chamadas
                      /                         \
         VISÃO ATIVA REVISADA             CAPÍTULO NO LEDGER
                      ^                         |
                      +--- consulta seletiva ---+
                               |
                  feedback para a manutenção seguinte
```

São responsabilidades dentro do harness, não serviços separados:

| Responsabilidade | O que faz | O que não faz |
|---|---|---|
| Coordenação | Mede ocupação, agrupa gatilhos, captura snapshot e limita jobs. | Não agenda as tarefas do projeto. |
| Execução auxiliar | Reproduz a entrada ativa e pede uma síntese conservadora. | Não executa ferramentas de projeto nem aceita entregas. |
| Montagem/publicação | Preserva âncoras, valida a proposta e escolhe a visão usada na próxima chamada. | Não reescreve uma inferência em andamento. |
| Ledger/consulta | Mantém fontes, capítulos e recibos de recuperação. | Não injeta todo o arquivo na janela. |

**Localidade:** reaproveitar persistência, sessão e execução existentes. Não criar outro banco ou outra fila como requisito antecipado. Extensões locais são admissíveis onde as estruturas atuais não expressam a semântica necessária.

## 5. Modelo de memória

### 5.1 Histórico original

Registro das mensagens, resultados e artefatos efetivamente capturados. A compactação altera a visão enviada ao modelo, não apaga esse registro.

Preservar cada fonte uma vez por versão; capítulos referenciam essas fontes. Outputs mantidos em armazenamento separado precisam continuar resolvíveis. O arquivo do ledger não pode ser construído apenas a partir de uma serialização já truncada.

A promessa de preservação abrange material capturado e autorizado a reter. Não inclui dados perdidos antes da captura, URLs expiradas sem cópia, raciocínio privado não exposto ou conteúdo excluído pelo usuário. Política de retenção e proteção de credenciais têm precedência; ausências devem ser explícitas.

### 5.2 Visão ativa

Representação finita usada pela próxima chamada: instruções aplicáveis, âncoras, blocos ativos, sínteses pertinentes e trabalho recente. O tamanho do ledger não determina seu tamanho.

A visão tem identidade própria. Acrescentar mensagens depois de um snapshot não equivale a reescrever o trecho que ele cobriu. Essa distinção permite aceitar atualizações concorrentes sem invalidar toda manutenção.

### 5.3 Capítulo

Uma consolidação identificável de um intervalo, com síntese, limites de cobertura e referências às fontes. Um capítulo pode abranger várias tarefas; uma tarefa pode atravessar vários capítulos.

Um capítulo é publicado quando a compactação é efetivamente adotada. Tentativas, falhas e propostas rejeitadas são registros de manutenção, não capítulos falsamente apresentados como memória vigente.

Capítulos anteriores não desaparecem quando suas sínteses são consolidadas. Uma consolidação posterior preserva a relação com os capítulos de origem. Não carregar eternamente todas as sínteses no prompt.

### 5.4 Âncoras e blocos curados

Âncora de presença mantém um texto curto e sua autoridade fora da sumarização com perda. Âncora de referência mantém um apontador estável, não todos os detalhes. O montador, e não a boa vontade do resumidor, garante a presença do conjunto ativo.

Bloco curado é conteúdo preparado e versionado, ativado para sessão, tarefa ou etapa. Sua origem é identificada. Uma observação de worker ou documento recuperado não ganha autoridade de instrução do usuário por ter sido inserida no contexto.

O maintainer pode recomendar retenção, mas não revoga âncoras do usuário. Expiração segue condição previamente estabelecida ou ação autorizada. Se as âncoras excederem o orçamento, expor o conflito; não removê-las silenciosamente.

## 6. Política de disparo

**Default proposto: iniciar a manutenção ao atingir 50% da janela efetiva configurada**, antecipando quando limite de entrada, teto operacional ou reservas tornarem esse ponto tarde demais.

A medição considera a entrada efetiva inteira: instruções, schemas, mensagens, conteúdo multimodal contabilizável, sínteses e blocos ativos. Tokens cacheados continuam contando como contexto. Não medir apenas mensagens novas nem o tamanho do banco.

O limite operacional do modelo é distinto do máximo anunciado pelo provider. Não incorporar “700k” como constante universal. A margem deve comportar instrução e saída do fork, resultados em trânsito e incerteza da estimativa.

Fechamento de tarefa é uma oportunidade complementar de manutenção, não a única condição. Uma tarefa longa não pode impedir o disparo por ocupação. Eventos simultâneos são agrupados; o maintainer não dispara manutenção de si próprio.

Rearmar somente com espaço recuperado ou crescimento novo suficiente. Uma proposta sem ganho não provoca uma sequência infinita de clones sobre a mesma entrada. Faixas de rearmamento e margens serão calibradas na especificação.

**50% é gatilho, não meta de compressão.** Não exigir remoção de metade dos tokens nem um resumo global de tamanho arbitrário. O objetivo é liberar espaço com fidelidade.

## 7. Fork: identidade de entrada, isolamento de efeitos

O fork recebe um snapshot da **visão ativa efetivamente montada**, não uma recópia de todo o histórico arquivado. Preserva modelo, instruções, ferramentas e opções pertinentes do request, acrescentando a missão de manutenção no final.

A técnica busca reutilizar o prefixo; cache hit continua sendo resultado do provider. IDs de sessão diferentes não dispensam verificar afinidade, chaves e estado de conversa. Mesma chave não prova mesma entrada. O precedente de cache-safe forking está documentado em [S9].

A identidade do job auxiliar é distinta da identidade de execução do pai. Ele não publica texto como se fosse uma decisão do orquestrador, não entra no inbox como uma solicitação do usuário e não recebe novas tarefas.

**Isolamento real:** schemas de ferramentas podem permanecer para compatibilidade de cache, mas o executor auxiliar não despacha chamadas de ferramenta retornadas pelo modelo. Não usar o runner comum do projeto sem essa separação. Uma rota que execute ferramentas no servidor do provider exige capacidade explícita de impedir efeitos; caso contrário, não é elegível para o fork cache-safe do MVP.

O resultado é uma proposta ou uma decisão de não compactar. JSON/schema válidos não provam qualidade semântica. IDs e limites são definidos pelo harness; o modelo não escolhe outro projeto, sessão ou intervalo.

O limite de execução é finito. Retries, reparos de formato, timeout e reserva de custo serão especificados. Cache miss não é corrupção; é uma condição econômica a registrar.

## 8. Ciclo e estado da manutenção

```text
ociosa -> preparando -> compactando -> pronta -> aplicada -> ociosa
              |              |          |
              +--------------+----------+--> descartada / falhou
```

1. **Preparar:** selecionar um intervalo já finalizado em termos de protocolo; registrar corte, visão, fontes e versões das regras relevantes.
2. **Compactar:** executar o fork sobre o snapshot. O orquestrador continua pela visão anterior enquanto existir margem.
3. **Validar:** conferir alvo, integridade das fontes, formato, orçamento, permissões e compatibilidade com a visão atual.
4. **Publicar:** gravar capítulo e alteração de visão numa operação consistente, sem chamada de LLM dentro da publicação.
5. **Continuar:** a próxima chamada usa a visão nova, incluindo intacto o que chegou depois do corte.
6. **Observar:** contabilizar uso e relacionar futuras recuperações ao capítulo.

Uma tool call ainda sem resultado, uma mensagem em streaming ou um bloco opaco indivisível do provider não pode ser cortado ao meio. A fronteira concreta depende do protocolo real, não apenas de índices num array.

Se o pai ficar ocioso quando a proposta terminar, a visão pode ser preparada para o próximo uso; não iniciar uma nova geração do projeto só para anunciar a manutenção.

## 9. Publicação concorrente: cobertura não é momento de chegada

Este é um ponto central do desenho.

```text
Snapshot do clone cobre até S.
Enquanto ele trabalha, chegam S+1 ... N.
A síntese fica pronta depois de N.
Resultado desejado:
    contexto anterior preservado + síntese do trecho até S + S+1 ... N
```

O corte coberto pela síntese é **S**, não a sequência do evento que anunciou sua conclusão. Publicar um resumo “agora” não autoriza ocultar todas as mensagens anteriores a “agora”.

O código atual de `SessionHistory` seleciona mensagens a partir da compactação mais recente [S3]. Essa seleção serve de evidência para não adaptar o fluxo síncrono simplesmente disparando a mesma operação em paralelo. Na implementação assíncrona será necessário representar a cobertura explicitamente, ou fornecer uma projeção equivalente que preserve toda a cauda não resumida.

Mudanças apenas no sufixo são preservadas. Mudança no intervalo, revert, troca de contexto-base, nova instrução corretiva ou revisão das âncoras pode tornar a proposta obsoleta. O primeiro comportamento é conservador: descartar e reagendar, sem tentar um merge semântico complexo.

Publicação repetida do mesmo job não duplica síntese ou mensagens. Crash antes da publicação mantém a visão anterior. Crash depois permite reconstruir a visão publicada. O processo de manutenção não é autoridade concorrente de execução da sessão.

## 10. Política de conteúdo

| Material | Tratamento proposto |
|---|---|
| Logs repetidos e tentativas encerradas | Arquivar detalhes e conservar resultado relevante. |
| Leitura antiga de arquivo | Preservar referência à versão observada, sem fingir atualidade. |
| Decisão substituída | Manter decisão vigente e a razão relevante da mudança. |
| Trabalho parcialmente validado | Distinguir implementação, teste local, integração e aceite. |
| Pendência ou incerteza | Preservar explicitamente enquanto for necessária. |
| Âncora ativa | Fora da reescrita pelo resumidor. |
| Material recente em uso | Manter continuidade imediata; não compactar agressivamente. |
| Detalhe recuperado após poda | Considerar retenção seletiva, sem restaurar tudo. |

A síntese é operacional: objetivo, resultado, decisões, restrições, pendências e referências. Não é uma narrativa da sessão. Pode conservar texto literal quando a precisão de uma cláusula, comando ou identificador importa.

O maintainer não reabre o projeto para investigar a verdade de cada afirmação. Pode sinalizar contradições com suas fontes. A qualidade da síntese será avaliada; preservação de fontes permite correção, não certificação automática de verdade.

## 11. Recuperação e adaptação

O orquestrador terá busca e leitura seletiva do ledger, com orçamento de saída. A busca inicial é textual e por metadados: capítulo, tarefa, arquivo e identificadores. Não há dependência de embeddings para iniciar.

Busca sem resultado não reconstrói conteúdo por palpite. Fonte indisponível retorna ausência explícita. A leitura pode retornar apenas uma faixa e um caminho de continuação. A ferramenta não entrega silenciosamente o arquivo inteiro.

Cada recuperação registra capítulo/trecho e, quando disponível, motivo declarado. A manutenção seguinte recebe recibos novos e notas de retenção ainda ativas.

**Exemplo de adaptação:** a poda 30 arquivou uma exceção do cancelamento; a integração exigiu recuperá-la; a poda 31 mantém a exceção e sua referência enquanto a integração estiver aberta. Os logs completos continuam no arquivo.

Consulta normal não é necessariamente falha da poda. Recuperação corretiva, repetição e intervenção humana são sinais distintos. Não promover tudo a âncora nem deixar a própria lista de feedback crescer sem limite. Não há atualização de pesos.

## 12. Âncoras e contexto curado na execução

Objetivos/regras persistentes e dados recuperados têm tratamentos diferentes. Preservar literalmente uma regra não significa promovê-la de autoridade nem garantir obediência do modelo; bloqueios de execução continuam nas permissões do harness.

Ativação de blocos é explícita pelo usuário ou fluxo autorizado. Apenas o subconjunto pertinente segue para cada worker. Registrar qual versão foi enviada evita que o orquestrador tenha de recontar livremente o contrato em cada delegação.

Mudanças legítimas podem custar cache e devem prevalecer. Uma âncora revogada não continua ativa apenas para preservar um prefixo. Material de tarefa concluída pode sair da visão sem desaparecer do ledger.

**Fronteira Atlas/Own:** capítulos de sessão não substituem o conhecimento governado do projeto. O protocolo Own existente exige artefatos versionados e proíbe usar recuperação genérica como substituto de Own ausente ou stale [S8]. Ler um capítulo antigo não autoriza burlar essa regra. Bloco curado derivado de Own conserva sua origem/versão e continua sujeito ao protocolo de origem.

## 13. Cache e economia

Separar dois momentos:

- **Produzir a síntese:** o fork busca reutilizar o prefixo do pai.
- **Adotar a síntese:** o contexto alterado exige processamento a partir da primeira divergência; a geração do resumo não aquece automaticamente essa nova entrada.

```text
Antes:  [A estável][B detalhado][C ainda necessário]
Depois: [A estável][B síntese ][C ainda necessário]
```

A pode continuar elegível; não prometer cache independente de C. O cache antigo pode continuar servindo ao ramo antigo. Breakpoints, chaves e metadados não eliminam a dependência do prefixo [S9–S11].

Manter ordem estável, não inserir timestamps variáveis no início, não reescrever painel global a cada turno e agrupar alterações. Priorizar cortes úteis mais tardios quando isso preservar o mesmo conteúdo necessário. Consolidação mais ampla continua disponível quando as sínteses acumuladas também precisarem diminuir.

Medir pai, workers, clone, recuperação e retries. Separar tokens de entrada total, leitura/escrita de cache e saída conforme a rota. Assinaturas sem cobrança detalhada não recebem economia fictícia em dólares.

Prewarming não é requisito do MVP. Cache self-hosted não está neste desenho. Não preservar contexto inadequado apenas para melhorar a taxa de cache hit.

## 14. Encaixe na base de código examinada

A leitura é direcionada aos pontos de integração, não uma auditoria completa do repositório ou prova do runtime usado na instalação do usuário.

| Evidência observada no commit-base | Consequência para o desenho |
|---|---|
| Há caminhos legado e v2; `AGENTS.md` explicita ownership e limites de dependência do v2 [S1, S7]. | Escolher um binding inicial e evitar dupla implementação ou migração geral como requisito. |
| O runner v2 monta um `LLM.request`, resolve tools e chama a compactação antes do stream [S2]. | Ponto candidato para capturar uma entrada coerente e publicar entre turnos. Não afirmar identidade wire-level sem medir o adapter. |
| O compactador v2 serializa outputs com truncamento, gera outra mensagem e usa `tools: []` [S4]. | Não é o fork cache-safe proposto. Não basta trocar o percentual nem usar sua serialização como arquivo integral. |
| O histórico ativo v2 filtra por sequência da última compactação [S3]. | Cobertura do snapshot e sequência de publicação precisam ser distintas na solução assíncrona. |
| `SessionContextEpoch` conserva baseline/snapshot e pode substituir o baseline após compactação [S5]. | Reutilizar a infraestrutura, mas coordenar sua revisão; não prometer preservação de cache ignorando mudanças do baseline. |
| O contrato do runner v2 preserva execução local e continuidade explícita [S6]. | O job auxiliar não deve acordar um segundo executor do projeto na mesma sessão. |
| Own possui fronteira formal de atualização e acesso [S8]. | Ledger é memória episódica da sessão, não bypass de autoridade/freshness do projeto. |

**Decisão proposta de integração:** módulo de sessão dentro do fork, usando pontos de extensão existentes onde forem suficientes. Não condicionar o produto a um plugin público portátil. Como controlamos o harness, uma extensão estreita de captura/publicação é preferível a monkey patches que não conseguem garantir a entrada efetiva.

O v2 é uma referência concreta para o desenho; ainda não está declarado como runtime-alvo homologado do orquestrador/Maestro em uso. Antes da especificação executável, seguir o entrypoint real e fechar esse binding. Se o fluxo ativo for legado, usar a fronteira correspondente sem exigir migração do restante do produto.

## 15. Invariantes do desenho

| ID | Propriedade |
|---|---|
| I1 | A manutenção não modifica a entrada de uma inferência que já começou. |
| I2 | A visão publicada inclui uma única vez todas as mensagens posteriores ao corte que não foram cobertas pela síntese. |
| I3 | Nenhuma substituição é publicada sem fontes duráveis ou ausência explicitamente autorizada pela política de retenção. |
| I4 | Âncoras ativas não são reescritas, removidas ou promovidas de autoridade pelo maintainer. |
| I5 | O fork não executa ferramentas do projeto nem gera forks recursivos. |
| I6 | Um único responsável serializa mudanças da visão; compactação nativa, manual e preventiva não competem sem coordenação. |
| I7 | A próxima entrada continua válida para o provider e dentro do orçamento admitido. |
| I8 | Falha, retry ou reinício não publica metade de uma compactação nem duplica seu efeito. |
| I9 | O ledger e o feedback não crescem automaticamente dentro da janela ativa. |
| I10 | Métricas diferenciam redução de contexto, cache e custo real; nenhum deles comprova sozinho ganho de qualidade. |

## 16. Falhas e saída segura

Timeout, limite de uso, erro de formato ou ganho insuficiente mantêm a visão corrente. Retry é limitado; o pai tem prioridade no orçamento compartilhado. Se a margem se esgotar, a espera ou recuperação é explícita, não um envio fora do limite.

Mudança de regras/base invalida a proposta. Falta de fonte ou falha de persistência impede publicar uma substituição que dependa dela. Compactação nativa/manual assume o caminho de recuperação sob a mesma coordenação e invalida jobs incompatíveis.

Interromper ou pausar a feature cancela novos jobs sem apagar capítulos. Desativar não pode reidratar de surpresa todo o histórico. Reverter uma poda afeta apenas a representação do contexto e respeita o orçamento; não desfaz ferramentas, commits ou ações externas.

Numa sessão já excessiva, recuperação segmentada pode abrir mão do cache do prefixo para trabalhar com âncoras, estado atual e um trecho por vez. Essa é uma exceção controlada, não o regime normal de manutenção preventiva.

## 17. Experiência observável

O caminho normal exige zero comandos adicionais: o usuário continua a sessão. Um painel discreto mostra ocupação estimada, estado da manutenção, último capítulo e âncoras/blocos ativos.

Ações essenciais: inspecionar uma poda, consultar sua origem, fixar uma regra, ativar um bloco, pausar manutenção e recuperar um trecho. Não exigir que o usuário administre sessões visíveis de clones.

Sucesso aparece como capítulo publicado, intervalo coberto e redução medida. Falhas persistentes, falta de espaço e espera excepcional ficam visíveis. “Sem fricção” não é promessa de latência invariável nem de capacidade infinita.

## 18. Alternativas consideradas

| Alternativa | Decisão nesta fase |
|---|---|
| Só alterar o prompt da compactação atual | Insuficiente para concorrência, cobertura de snapshot e identidade do fork. |
| Fazer a manutenção síncrona dentro do hook | Rejeitada como caminho normal: coloca geração auxiliar no caminho crítico. |
| Expor edição livre de todo o contexto | Adiada: maior superfície de erro sem necessidade para provar o ciclo. |
| Usar modelo menor desde o início | Experimento posterior; muda a hipótese do fork e o reaproveitamento de cache. |
| Reescrever um resumo global a cada tarefa | Rejeitada como política padrão; modifica cedo o prefixo e aumenta recompressão. |
| Construir uma plataforma externa de memória | Fora do escopo; reaproveitar sessão, persistência e workers. |
| Só poda determinística | Mantida como baseline e possível solução suficiente se empatar na avaliação. |

## 19. Provas necessárias e critérios para avançar

### Prova de engenharia

Demonstrar um ciclo com trabalho concorrente: capturar snapshot, produzir síntese, receber novos resultados, publicar sem perda/duplicação, manter âncora e recuperar o original. Repetir com interrupção, correção do usuário e compactação nativa/manual concorrente.

Comparar a entrada do pai e do clone na rota real, sem expor credenciais. Medir cache efetivo. Confirmar que tool calls do clone não são despachadas e que o request adotado corresponde à visão publicada.

### Prova de produto

Uma sessão longa atravessa compactações, mantém uma pendência parcialmente validada, não ressuscita uma decisão substituída, recupera uma justificativa antiga e incorpora o feedback na manutenção seguinte. A evidência é comportamento e resultado, não apenas HTTP 200 ou declaração do agente.

Comparar baseline real, poda simples e produto completo com o mesmo fluxo. Medir tarefas aceitas antes da primeira correção humana, erros de estado, retenção de compromissos, recuperação corretiva, custo e tempo totais. Incluir execuções repetidas e variabilidade.

Para atribuir ganho ao fork e não apenas às âncoras, manter essas condições equivalentes num contraste adicional ou fazer ablação. Não anunciar porcentagem de melhoria antes do piloto. Se a alternativa simples empatar, simplificar o produto.

### Fechamento do desenho

O desenho estará pronto para especificação quando responsabilidades, publicação concorrente, unidade de compactação, permanência, recuperação e integração inicial tiverem decisão explícita, e uma revisão adversarial não deixar conflito de arquitetura sem tratamento.

Ainda não se exige um benchmark para aprovar o desenho; o benchmark pertence à prova posterior de produto. Tampouco se deve escrever dezenas de issues de execução antes de resolver as decisões que mudariam seus contratos.

## 20. Decisões abertas delimitadas

| Ponto | Como fechar |
|---|---|
| Runtime inicial do orquestrador em uso | Seguir entrypoint e fluxo Maestro/runner na base real; escolher um único binding. |
| Provider/modelo/autenticação do primeiro piloto | Usar uma rota autorizada existente e verificar semântica de cache e ferramentas. Não inferir assinatura pela presença de uma chave. |
| Cobertura e persistência da visão | Confirmar como representar intervalos na projeção existente sem perder cauda e sem duplicar histórico. |
| Retenção de outputs externos | Verificar acesso e duração; copiar apenas fontes que precisem de retenção própria antes da poda. |
| Teto saudável, margens e rearmamento | Calibrar por modelo/workload, mantendo 50% como default de produto. |
| Superfície inicial de interface | Reutilizar o cliente que hospeda o fluxo inicial, sem criar outro frontend. |

Esses pontos não reabrem a ideia; delimitam o trabalho necessário para transformar o desenho em contratos precisos.

## 21. Sequência de trabalho

**Desenho formal → revisão adversarial → especificação → work packages → implementação → demonstração integrada.**

A especificação posterior deverá fornecer contratos e critérios verificáveis, não outro texto genérico de produto. Cada work package incluirá Success Criteria, Quality Standards, Completeness Criteria, Definition of Done e Invariants, além de dependências e evidências esperadas.

Este RFC não inicia mudanças de runtime, migrações ou chamadas pagas de avaliação. O primeiro incremento de implementação, quando autorizado, será um ciclo vertical pequeno e observável, não todos os recursos em paralelo.

## 22. Fontes e escopo da verificação

Código abaixo consultado no commit fixado; links de documentação externa consultados em 17/09/2026. Evidência estática não equivale a homologação em execução. A seleção foi dirigida aos limites relevantes do desenho; não é leitura exaustiva de todas as integrações, testes ou adapters.

- **[S1]** [AGENTS.md](https://github.com/gmhelmold/HuGR-Orchestra/blob/b0c33d2f6567a2c741240f3c44bc00ca2f01e7e7/AGENTS.md): convenções, ownership de sessão e dependências.
- **[S2]** [session/runner/llm.ts](https://github.com/gmhelmold/HuGR-Orchestra/blob/b0c33d2f6567a2c741240f3c44bc00ca2f01e7e7/packages/core/src/session/runner/llm.ts): leitura dirigida às linhas 1–340; montagem do request, compactação antes do stream e despacho de ferramentas.
- **[S3]** [session/history.ts](https://github.com/gmhelmold/HuGR-Orchestra/blob/b0c33d2f6567a2c741240f3c44bc00ca2f01e7e7/packages/core/src/session/history.ts): seleção por última compactação e baseline.
- **[S4]** [session/compaction.ts](https://github.com/gmhelmold/HuGR-Orchestra/blob/b0c33d2f6567a2c741240f3c44bc00ca2f01e7e7/packages/core/src/session/compaction.ts): serialização, request auxiliar e disparo atual.
- **[S5]** [session/context-epoch.ts](https://github.com/gmhelmold/HuGR-Orchestra/blob/b0c33d2f6567a2c741240f3c44bc00ca2f01e7e7/packages/core/src/session/context-epoch.ts): baseline persistido, reconciliação e substituição.
- **[S6]** [session/runner/index.ts](https://github.com/gmhelmold/HuGR-Orchestra/blob/b0c33d2f6567a2c741240f3c44bc00ca2f01e7e7/packages/core/src/session/runner/index.ts): contrato de execução local.
- **[S7]** [compactador legado](https://github.com/gmhelmold/HuGR-Orchestra/blob/b0c33d2f6567a2c741240f3c44bc00ca2f01e7e7/packages/opencode/src/session/compaction.ts): existência do caminho separado; leitura parcial, não auditoria integral.
- **[S8]** [Static Own Protocol](https://github.com/gmhelmold/HuGR-Orchestra/blob/b0c33d2f6567a2c741240f3c44bc00ca2f01e7e7/specs/hugr-maestro/own-protocol.md): especificação existente, marcada como proposta; fronteira Atlas/Own/Maestro. Não comprova por si só implementação completa.
- **[S9]** [Anthropic: prompt caching e cache-safe forking](https://claude.com/blog/lessons-from-building-claude-code-prompt-caching-is-everything): precedente de manter o prefixo na geração auxiliar.
- **[S10]** [OpenAI: Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching): compatibilidade, prefixo e observabilidade do cache; parâmetros dependem da rota/modelo.
- **[S11]** [Claude API: Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching): condições de reutilização e invalidação.

**Origem de produto:** discussão desta feature e `Continuous_Self_Compaction_Especificacao_de_Produto.docx`, versão anterior de 24 páginas, lida integralmente. O Word foi usado como material de origem, não como prova de implementação. Dados pessoais, credenciais e conteúdos de projetos não relacionados não fazem parte deste RFC.

## 23. Revisão estática desta versão

A versão incorpora uma passagem de revisão pelos seguintes casos: descarte acidental de mensagens posteriores ao snapshot; falsa equivalência entre resumo serializado e fork cache-safe; compactação nativa concorrente; execução indevida de ferramentas do clone; acúmulo ilimitado de resumos/feedback; mudança de âncora durante manutenção; e uso do ledger como bypass do Own.

Os tratamentos estão nas seções 5–16. Essa passagem é uma revisão de desenho do autor, não uma revisão independente nem testes executados. A próxima etapa é a revisão adversarial do RFC antes de fechar a especificação.
