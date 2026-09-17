# SPEC-08 — protocolo de avaliação antes da execução

Normativo 0.1.1; fecha B16. Decisões abaixo são critérios do piloto, não resultados nem alegações comerciais. Nenhum ensaio live está autorizado por publicar este documento.

## 1. Três aprovações distintas

Conformance estrutural prova que o plugin não perde/duplica/corrompe dados. Perfil de integração prova instalação e ciclo no host/rota fixados. Piloto mede ganho de continuidade e custo. Um PASS em uma categoria nunca é usado como PASS em outra; portabilidade exige segundo host real.

## 2. Registro obrigatório antes da primeira chamada paga

Criar `evaluation-plan.json` com schema_version=1 e campos: plan_id, product_commit, scenario_manifest_digest, host/profile/codec/model/variant, requested_seed|null, arms, paired_runs, horizon, task_oracles, intervention_rubric, price_snapshot ou billing_mode, max_calls, max_input_tokens, max_output_tokens, max_wall_minutes, max_currency_spend|null, budget_authorized_by, budget_authorized_at, decision_thresholds, stop_rules, analysis_version. Hash canônico do arquivo é registrado no relatório e nos artefatos antes de executar. Credenciais nunca entram no plano.

Budget ausente = DRAFT_UNFUNDED e zero calls. Assinatura sem preço medível usa quotas observáveis como orçamento e não inventa US$0. Não executar até haver limites finitos de tempo/chamadas e aprovação da conexão. Mudar cenário, threshold ou tratamento estatístico depois dos resultados requer novo plan_id e um novo ensaio; resultados anteriores continuam publicados.

## 3. Unidade de análise e cenário

Unidade independente é UMA sessão completa de orquestração, não uma tool call, assert ou worker. Plano padrão de desenho: três cenários (decisão substituída, validação parcial com pendência, exceção recuperada do ledger), quatro réplicas pareadas por cenário, três braços = 36 sessões. É tamanho proposto, ainda sem aprovação de gasto; um plano menor pré-registrado é piloto exploratório, não alegação confirmatória.

Braços: A = host default com relatórios estruturados; B = mesmo fluxo + poda determinística; C = compactação/ledger/feedback. Para atribuir ganho ao clone, B e C recebem as MESMAS âncoras/blocos, contratos de workers, quotas e ferramentas. A comparação C−A mede produto completo; C−B mede mecanismo sobre contexto curado equivalente. Ordem balanceada por par e cenário. Seed ausente no provider é registrada como não controlada, não simular determinismo.

Horizonte por sessão: até 32 unidades de trabalho pré-especificadas, 12 oportunidades de manutenção de tamanho controlado OU limite finito de tempo/custo do plano, o que ocorrer primeiro. Oportunidades são eventos do workload, não compactações forçadas no baseline. Relatar também resultados nas faixas 1–4, 5–8 e 9–12. Um ensaio não representa >700k ou 31 compactações se não atingiu esse regime.

## 4. Gabarito e métricas

Tarefa aceita: artefato e comportamento satisfazem o oráculo congelado antes da execução (ex.: revisão correta, integração realmente validada, pendência mantida). Declaração do próprio agente não basta. Oráculo registra verificado/não verificado por revisores e teste determinístico, com divergência explicada. Judge LLM pode auxiliar sem ser juiz único.

Intervenção corretiva: humano precisa reenviar objetivo/restrição/decisão ou corrigir estado que já tinha sido informado e ainda valia; primeiro evento termina a métrica primária de continuidade, mas a sessão pode continuar para medir conclusão/retrabalho dentro do orçamento. Nova tarefa ou requisito novo não é erro. Dois rótulos divergentes são adjudicados cegos ao braço quando possível.

Primária: tarefas aceitas antes da primeira intervenção corretiva, por sessão, truncada no horizonte comum. Secundárias: taxa de tarefas aceitas, violações de restrição/pendência, recuperações corretivas/legítimas, custo/tempo por tarefa aceita e incidência de falha de storage/protocolo. Zero tarefas aceitas torna custo por tarefa indefinido, não zero; usar custo total e taxa de falha.

Interrupção causada pelo produto, timeout do braço ou quota que ele consumiu conta como falha/custo daquele braço. Outage externa comprovada antes de resultado útil invalida o PAR completo para comparação; permitir no máximo uma reposição por par, mostrar original e custo. Encerramento pelo teto comum sem intervenção é censura no horizonte; não contabilizar como continuidade infinita. Dados ausentes permanecem missing com causa, nunca imputados como sucesso.

## 5. Regra de decisão pré-registrada

Primeiro exigir zero falhas estruturais críticas no perfil; qualquer perda de cauda, escopo cruzado, execução de tool pelo clone ou regra revogada restaurada -> HOLD_INTEGRITY independentemente da média.

Defaults propostos de decisão, congelados ANTES do piloto: median(C−B) ≥1 tarefa de continuidade; mediana da diferença pareada de taxa de aceitação ≥−0.05; ratio de custo mediano por tarefa ≤1.25 e de tempo ≤1.25 quando medíveis. São preferências de produto configuráveis por decisão prévia, não leis científicas. Com custo indisponível, só decisão técnica parcial, sem claim econômico.

Reportar todos os pares por cenário e intervalo de incerteza por reamostragem de PARES/SESSÕES, nunca tools. Não usar p-value escolhido depois. `ADVANCE_PILOT` exige critérios acima e sinal positivo nos três cenários sem falha crítica; não autoriza anúncio de superioridade universal nem release sem conformance. `SIMPLIFY` quando C não supera B e custa/atrapalha mais no orçamento medível; manter poda simples como referência. `INCONCLUSIVE` quando faltam pares/horizonte/custo ou incerteza impede decisão: relatar causa e no máximo um próximo ensaio focado, com orçamento novo antes de executar. Nunca estender gasto automaticamente até obter vitória.

## 6. Artefatos

Plan canônico, execução por braço/par, tempo/calls/input/output/cache do pai/workers/auxiliares/recuperações, emissions/job IDs, intervenções com origem, hashes de cenário/artefato, resultados negativos, análise versionada e decisão rastreável. Prompts reais ficam fora de artefatos públicos; usar dados sintéticos de teste. Tests T34.pilot/T35.pilot verificam conformidade ao plano; testes offline só conferem formato/aritmética e não viram piloto aprovado.
