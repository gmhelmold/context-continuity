# SPEC-02 — ciclo de execução e publicação

Normativo; tipos em [SPEC-01](01-contracts.md), persistência em [SPEC-03](03-ledger.md). Todos os valores abaixo são defaults de engenharia do piloto, não limites cognitivos comprovados.

## 1. Configuração resolvida

| Campo | Default e domínio |
|---|---|
| enabled | false até ativação explícita; boolean |
| requested_mode | complete; complete ou assisted |
| trigger_ratio | 0.50; número >0 e <1 |
| rearm_ratio | 0.40; >0 e <trigger_ratio |
| healthy_input_ceiling | null ou inteiro positivo, tokens |
| growth_reserve_ratio | 0.10; [0, 0.50] |
| minimum_growth_reserve | 8192 tokens; inteiro ≥0 |
| mission_reserve | 4096 tokens; inteiro >0, rechecado contra missão real |
| recent_groups | 2; inteiro ≥1 |
| minimum_gain | 1024 tokens; inteiro ≥1 |
| minimum_gain_ratio | 0.02; [0, 0.50] |
| new_tokens_ratio | 0.05; (0, 0.50] |
| cooldown_ms | 30000; inteiro ≥0 |
| job_timeout_ms | 300000; inteiro entre 1000 e 1800000 |
| maximum_attempts | 2; 1 ou 2, total por job |
| max_calls_per_session | 32; inteiro ≥1, inclui retries e reparos |
| max_input_per_session | 8 × C; inteiro >0, inclui entrada cacheada |
| task_trigger | false; boolean |

Configuração efetiva é imutável durante o job. Alteração incrementa `policy_revision` e cancela jobs anteriores. Config inválida retorna E_SCHEMA antes de iniciar rede. Defaults derivados de C são gravados como valores resolvidos na ativação; não mudam por trás de um job.

Limites C (janela), I (entrada, quando separada) e R (reserva de saída efetiva, incluindo raciocínio quando aplicável) vêm de um perfil verificado/model metadata autorizado. C e R são obrigatórios para manutenção automática. Omissão não vira zero; usar modo assistido/pausado com motivo de configuração insuficiente. Não fixar 700k como limite global.

## 2. Fórmula do gatilho

Todas as unidades são tokens; arredondar reservas para cima e limites para baixo.

```text
B = floor(min(I se existir, C - R, H se configurado))
G = max(minimum_growth_reserve, ceil(growth_reserve_ratio * B))
F = mission_reserve
T = floor(min(trigger_ratio * C, B - G - F))
L = floor(min(rearm_ratio * C, 0.8 * T))
N = max(4096, ceil(new_tokens_ratio * C))
M = max(minimum_gain, ceil(minimum_gain_ratio * U_snapshot))
```

Exigir B>0, T>0, L<T. `U` é a estimativa conservadora da entrada inteira já montada: system, tools, blocos, mensagens, mídia, metadados contabilizáveis. Não subtrair tokens cacheados. Limites de provider não observáveis exigem reserva documentada no perfil; não vender a estimativa como contagem exata.

Iniciar oportunidade em `U >= T`. Antes de despachar o clone, recalcular com o tamanho real da missão e com R do clone; ambos os requests devem caber. Se F real exceder reserva e ainda couber, registrar o excedente; caso contrário rejeitar o job por E_BUDGET. Configurações diferentes de output/reasoning não são usadas escondidas para fazer o fork caber.

Exemplo sintético: C=1000000, I=900000, R=16000, H=650000 → B=650000; G=65000; F=4096; T=500000; L=400000; N=50000. Com U=500000, M=10000. Esses números testam a fórmula, não recomendam esse orçamento para todo modelo.

## 3. Disparo e rearmamento

Na primeira sessão elegível, `armed=true`. No início de cada chamada primary, observar U. Se U≥T, armed e sem job ativo, reservar o job atomicamente. Eventos de workers apenas acordam essa avaliação; não criam inferências soltas.

Após qualquer tentativa terminal, registrar `last_attempt_digest`, número de unidades elegíveis observadas e tempo. Não repetir a mesma combinação `(epoch, source_digest, policy_revision, frame_fingerprint)` automaticamente.

Rearmar quando (a) a visão ficou abaixo de L e voltou a crescer até T; OU (b) desde a última tentativa entraram pelo menos N tokens elegíveis novos, passaram cooldown_ms e existe intervalo diferente. Mudança de política permite uma nova tentativa após cooldown. O botão “compactar agora” pode ignorar ratio/cooldown, mas não ignora orçamento, identidade, intervalo seguro, fontes ou concorrência.

`task_trigger=true` habilita oportunidade abaixo de T somente quando o fluxo fornece um evento estruturado, existe intervalo seguro com tamanho ≥2M, crescimento ≥N e cooldown satisfeito. Não inferir conclusão de tarefa por texto “pronto”. Eventos repetidos/simultâneos coalescem. Eventos da manutenção são ignorados.

## 4. Seleção determinística do intervalo

1. Normalizar unidades da visão atual, mantendo ordem e grupos de protocolo.
2. Proteger system, âncoras/blocos ativos, mídia/estado opaco desconhecido, grupos incompletos e a cauda recente.
3. A cauda contém pelo menos os últimos recent_groups grupos completos e pelo menos `max(4096, min(32768, floor(0.05*B)))` tokens; expandir para trás por grupos inteiros até satisfazer ambos, ou proteger todo o conteúdo se não houver material.
4. No material anterior, enumerar runs contíguos de unidades não protegidas. Primeiro considerar runs de fontes brutas posteriores ao último capítulo ativo. Selecionar o run com fim mais recente e tamanho ≥2M.
5. Se nenhum atender, considerar runs que também contenham capítulos anteriores e escolher o de fim mais recente com tamanho ≥2M. Isso é consolidação, mantendo lineage. Se não existir, registrar E_NO_GAIN sem inferência.
6. O intervalo escolhido contém o run inteiro. O modelo não amplia seu escopo nem escolhe outras mensagens. O ganho efetivo é verificado após a proposta; 2M não presume uma taxa garantida de compressão.

Para consolidação, fontes citadas pelas correções/recuperações recentes podem ser incluídas no manifesto/sufixo dentro de F. Não reidratar todo o passado. O fork recebe as sínteses ativas e acesso explícito às referências selecionadas; não alegar que todos os originais foram relidos. Um resumo de resumo mantém fontes recuperáveis, mas não elimina risco de distorção.

## 5. Máquina de estados do job

| Origem | Evento/precondição | Destino | Efeito |
|---|---|---|---|
| inexistente | oportunidade + lease válido + orçamento | queued | Criar snapshot e reservar contadores. |
| queued | fontes duráveis + envelope válido | running | Incrementar attempts, registrar início e chamar fork. |
| queued | fonte/config/escopo inválido | rejected | Sem chamada; liberar reserva comprovadamente não usada. |
| running | proposta válida, ganho ≥M | ready | Persistir proposta e fontes, sem alterar visão. |
| running | noop ou ganho <M | rejected | E_NO_GAIN, sem capítulo. |
| running | falha transitória elegível | running | No máximo um retry, dentro do deadline original. |
| running | formato inválido elegível | running | No máximo um reparo; compartilha o mesmo limite total de attempts. |
| running | timeout, tool_call, overflow, falha final | failed | Cancelar; manter visão. |
| queued/running/ready | nova política, usuário, epoch, pause/delete | cancelled | Fencing impede resultado tardio de publicar. |
| ready | próxima fronteira segura + validação atual | published | Transação de capítulo/overlay/revisão. |
| ready | fonte/revisão/prefixo alterado | rejected | E_STALE; nenhuma publicação parcial. |
| published/rejected/failed/cancelled | qualquer callback tardio | sem mudança | Idempotência, sem nova inferência. |

Estados terminais não são ressuscitados. `noop` é terminal rejeitado por ausência de poda, não falha operacional. Toda saída libera o slot via finally e mantém contadores de custo reais/incertos.

## 6. Missão e execução do fork

Usar snapshot ativo, mesmo modelo/variante e orientação no final. Instrução-base:

> Esta é uma execução auxiliar de manutenção. Não continue o projeto e não execute ferramentas. Consolide exclusivamente as unidades indicadas no manifesto. Preserve decisões, restrições, validações parciais, pendências e incertezas. Cite os índices de fonte fornecidos. Não reescreva âncoras. Não minimize o resumo à custa da continuidade. Quando não houver redução segura e útil, retorne noop. Responda somente no contrato ModelProposal v1.

O manifesto contém delimitadores, IDs internos e excertos necessários, sem reinserir marcadores no prefixo histórico. Feedback recente é dado contextual, nunca autoridade para desobedecer regra do usuário. Não adicionar uma tool de output só para forçar JSON sem contabilizar a mudança de prefixo.

Máximo de duas chamadas físicas por job, não “duas retries além da inicial”. E_SCHEMA pode consumir a segunda para reparo de formato; 429/5xx pode consumi-la para retry, nunca ambos. Tool call, 401/403, E_SCOPE, E_PROTOCOL, overflow e conclusão por limite de saída não recebem retry automático. Retry-After é respeitado se couber no deadline; se maior que 60s ou faltar tempo, falhar e registrar indisponibilidade. Sem Retry-After, esperar 2s. Não repetir rede após crash sem nova oportunidade/ação explícita.

Os contadores max_calls_per_session e max_input_per_session incluem estimativa reservada de cada chamada física. Substituir estimativa por uso real quando conhecido; não devolver reserva de envio incerto. Ao atingir quota, pausar novas manutenções e notificar. Não alterar orçamento do pai nem renovar quota automaticamente. Reconfiguração pelo usuário pode aumentá-la.

## 7. Publicação sem perder a cauda

Entrada é o Frame atual, não o snapshot antigo. O núcleo verifica, nesta ordem:

1. Mesmo escopo, proprietário/fence, host_epoch, view_revision, policy_revision e perfil.
2. Todas as covered_units ainda existem na ordem esperada, são contíguas e têm as revisões/digests capturados.
3. Prefixo anterior ao intervalo continua igual. Nenhuma âncora mudou. Novo user input desde o snapshot invalida conservadoramente; novos resultados de workers na cauda não invalidam por si só.
4. Não há grupo de protocolo atravessando a borda; blocos protegidos estão fora da substituição.
5. Renderizar cópia candidata com a síntese no mesmo lugar. Acrescentar a cauda ATUAL exatamente uma vez. Verificar protocolo, orçamento e ganho real, contando wrapper/referências.
6. Em transação local curta: conferir revisões/fence novamente, criar Chapter, persistir View revision+1, marcar job published. Commit antes de disponibilizar a revisão.
7. Retornar a representação candidata no hook. Na chamada seguinte, reconstruir o mesmo overlay declarativamente; nunca aplicar sobre uma versão já substituída sem identificar os IDs da síntese.

Se a chamada ao provider falhar depois do commit, a visão publicada permanece válida para a próxima tentativa; não declarar que o modelo a consumiu. PublicationReceipt registra `selected`, `emitted` quando observável e `acknowledged` após resposta associável. Ausência de observação é null, não timestamp inventado.

A interface do host pode não fornecer o ponto pós-hook final. Nesse caso, o relatório de fidelidade é unverified e G-OC-01 deve limitar as garantias. Outro plugin alterando o envelope depois exige nova verificação; não reconstruir ou repetir ferramentas para obter prova.

## 8. Compactação nativa, mutação e resets

Antes de compactação nativa/manual/revert, cancelar manutenção e impedir novas oportunidades para aquela epoch. Na conclusão, capturar a nova visão por interface pública; incrementar host_epoch/view_revision e arquivar overlays anteriores. O ledger mantém capítulos antigos; não reintroduzi-los automaticamente. Âncoras ativas são reaplicadas respeitando a política atual.

Se a compactação nativa falhar sem mudar a visão, revalidar a visão anterior e liberar a sessão; não presumir sucesso pelo simples evento de início. Se só for possível observar o resultado, invalidar propostas antes de renderizar a nova visão. Se o host puder mudar contexto sem que o adaptador detecte, complete não é homologável nessa combinação.

Fonte antiga editada/deletada/revertida: invalidar qualquer overlay que dependa da versão, não reapresentar síntese antiga como estado vigente. A revisão histórica permanece no ledger conforme retenção. Recalcular a visão com as fontes atuais e orçamento; se não couber, fallback explícito do host/espera, nunca descarte silencioso.

## 9. Interrupção, margem e falhas

A preparação usa rede em paralelo, publicação não aguarda LLM. I/O local e validação ainda têm custo; “sem espera” não significa latência zero.

Se a entrada do pai ultrapassar B antes da proposta ficar pronta, não enviar request inválido. Oferecer à política nativa a recuperação por interface suportada; cancelar o job incompatível. Se a rota não permitir isso com segurança, segurar a chamada e informar E_BUDGET. Workers já executados não são apagados: suas mensagens permanecem no host/arquivo e entram quando houver orçamento.

Se não houver material elegível suficiente por excesso de âncoras, manter regras e reportar a causa. Não comprimir por força. Cache miss só afeta métricas/orçamento, não autoriza descartar mais conteúdo.

Pause cancela queued/running/ready, mas mantém overlays existentes e ferramentas de consulta. Resume revalida configuração, epoch, quotas e fontes antes de rearmar. Desinstalação/handoff e exclusão seguem SPEC-05 e SPEC-03.

## 10. Provas de implementação

Fixtures devem cobrir bordas exatas `T-1/T`, cooldown, rearmamento por L e por N, mensagens simultâneas, alterações em fontes antigas, callbacks tardios, falha de disco antes/depois do commit e coalescência de eventos. T14–T18/T40 validam orçamento; T08–T13/T28–T29 validam publicação. São requisitos futuros, não resultados executados nesta versão.
