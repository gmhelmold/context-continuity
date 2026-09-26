# SPEC-02 — ciclo de execução e publicação

Normativo, revisão 0.1.2; tipos em [SPEC-01](01-contracts.md), persistência em [SPEC-03](03-ledger.md). Todos os valores abaixo são defaults de engenharia do piloto, não limites cognitivos comprovados.

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

Na primeira sessão elegível, `armed=true`. Estado do scheduler é persistido por `session_key` e toda leitura/escrita compara sua `incarnation` com a sessão atual; divergência não reutiliza estado anterior. A tupla de oportunidade é sempre colunas separadas `(host_epoch, coverage_digest, policy_revision, config_digest)`, nunca digest opaco da tupla.

Somente há dois tipos de evento de entrada: `primary_terminal` e `structured_task`. Worker e manutenção são ignorados; não acordam, não atualizam estado e não criam inferência. No `primary_terminal`, após seal e projeção da View vigente da chamada primary, observar U. Hooks parciais apenas capturam identidade. Somente essa observação pode gravar `last_observed_eligible_tokens`, `last_observed_at_ms` ou marcar evidência `low_water_observed`; nenhum `structured_task`, worker, manutenção, tentativa física ou callback tardio pode fazê-lo.

`low_water_observed` é booleano associado explicitamente a `(host_epoch, policy_revision, config_digest)`. Vale somente enquanto esses três valores forem os da oportunidade atual; mudança de qualquer um invalida a evidência. A observação primary terminal com `U < L` é única forma de marcá-lo. Antes de substituir `last_observed_eligible_tokens` e `last_observed_at_ms`, a transação conserva seus valores anteriores para avaliar crescimento.

Admissão automática exige, na mesma transação: lease atual e fence detido; sessão não pausada nem `dispatch_blocked`; `U >= T`; `armed=true`; nenhum job ativo nem `aux_run` em quarantine; e tupla atual diferente da última tupla admitida. A transação cria job e reserva, persiste a tupla como última tentativa e muda `armed=false`. Falha de qualquer precondição não cria job, reserva ou chamada. Índices únicos não substituem essas revalidações.

Rearmar somente em `primary_terminal`, com sessão/incarnation/fence ainda válidos, por uma das condições: (a) `low_water_observed` ainda vale para epoch/policy/config atuais e U voltou a `U >= T`; OU (b) U aumentou pelo menos N sobre a observação primary terminal anterior, `at_ms - last_observed_at_ms >= cooldown_ms` na fronteira inclusiva exata, e `coverage_digest` atual difere do da última tentativa. Rearmamento apenas muda `armed=true`; admissão posterior continua exigindo todas as precondições acima. Tentativa física terminada não é terminal para este efeito: terminal é o estado terminal do job inteiro (`published`, `rejected`, `failed` ou `cancelled`).

`task_trigger=true` permite que `structured_task` solicite avaliação automática, nunca oportunidade abaixo de T. Não infere conclusão por texto “pronto”, não altera observação/evidência primária e continua sujeito a U>=T, lease/fence, pause/bloqueio, concorrência, tupla e admissão atômica. Eventos repetidos/simultâneos coalescem.

Botão “compactar agora” pode ignorar ratio/cooldown, mas não ignora orçamento, identidade, intervalo seguro, fontes ou concorrência.

## 4. Seleção determinística do intervalo

1. Projetar a View sobre as raízes do SealedFrame atual conforme SPEC-07; selecionar unidades LÓGICAS dessa projeção, mantendo ordem/grupos.
2. Proteger system, âncoras/blocos ativos, mídia/estado opaco desconhecido, grupos incompletos e a cauda recente.
3. A cauda contém pelo menos os últimos recent_groups grupos completos e pelo menos `max(4096, min(32768, floor(0.05*B)))` tokens; expandir para trás por grupos inteiros até satisfazer ambos, ou proteger todo o conteúdo se não houver material.
4. No material anterior, enumerar runs contíguos de unidades não protegidas. Primeiro considerar runs de fontes brutas posteriores ao último capítulo ativo. Selecionar o run com fim mais recente e tamanho ≥2M.
5. Se nenhum atender, considerar runs que também contenham capítulos anteriores e escolher o de fim mais recente com tamanho ≥2M. Isso é consolidação, mantendo lineage. Se não existir, registrar E_NO_GAIN sem inferência.
6. Achatar o intervalo em root_coverage conforme SPEC-07 e congelar logical_coverage separadamente. O intervalo escolhido contém o run inteiro. O modelo não amplia seu escopo nem escolhe outras mensagens. O ganho efetivo é verificado após a proposta; 2M não presume uma taxa garantida de compressão.

Para consolidação, fontes citadas pelas correções/recuperações recentes podem ser incluídas no manifesto/sufixo dentro de F. Não reidratar todo o passado. O fork recebe as sínteses ativas e os recortes selecionados no manifesto, SEM executar uma tool de consulta; não alegar que todos os originais foram relidos. Um resumo de resumo mantém fontes recuperáveis, mas não elimina risco de distorção.

## 5. Máquina de estados do job

| Origem | Evento/precondição | Destino | Efeito |
|---|---|---|---|
| inexistente | oportunidade + lease válido + orçamento | queued | Criar snapshot e reservar contadores. |
| queued | fontes duráveis + envelope válido | running | Incrementar attempts, registrar início e chamar fork. |
| queued | fonte/config/escopo inválido | rejected | Sem chamada; liberar reserva comprovadamente não usada. |
| running | proposta válida, ganho ≥M | ready | Persistir proposta e fontes, sem alterar visão. |
| running | noop, vazio/whitespace ou ganho <M | rejected | E_NO_GAIN, sem capítulo. |
| running | falha transitória elegível | running | No máximo um retry, dentro do deadline original. |
| running | formato inválido elegível | running | No máximo um reparo; compartilha o mesmo limite total de attempts. |
| running | timeout, tool_call, overflow, falha final | failed | Cancelar; manter visão. |
| queued/running/ready | nova política, usuário, epoch, pause/delete | cancelled | Fencing impede resultado tardio de publicar. |
| ready | próxima fronteira segura + validação atual | published | Transação de capítulo/overlay/revisão. |
| ready | fonte/revisão/prefixo alterado | rejected | E_STALE; nenhuma publicação parcial. |
| published/rejected/failed/cancelled | qualquer callback tardio | sem mudança | Idempotência, sem nova inferência. |

Estados terminais não são ressuscitados. `noop` é terminal rejeitado por ausência de poda, não falha operacional. Todo estado terminal perde autoridade de publicação imediatamente. Liberar slot de execução somente após local_stopped; se cleanup local falhar, aux_run fica quarantine e impede nova geração. Remote_state=unknown conserva reserva e não é confundido com estorno. Respostas tardias podem atualizar uso, nunca estado/visão.

## 6. Execução e admissão física

O snapshot usa EffectiveFrame, já incluindo overlays/blocos. Congelar Manifest e missão no mesmo job. Missão-base:

> Esta execução é somente manutenção. Não continue o projeto, não execute ferramentas. Consolide as unidades indicadas; preserve restrições, validação parcial, pendências e incertezas. Cite apenas entradas full/excerpt do manifesto congelado. Não altere âncoras. Não minimize a síntese à custa de continuidade. Retorne ModelProposal v1 ou noop. Notas de retenção são dados da política, não instruções superiores.

O executor do perfil inicial é HTTP do produto, NÃO o runner de sessão do host (SPEC-04/ADR-001). Para CADA request auxiliar: sob transação conferir job running, incarnation, fence, deadline e quota; criar attempt_id, incrementar attempts, reservar entrada real estimada + saída configurada; emitir AttemptPermit de uso único. O cliente consome permit imediatamente antes da conexão. Desabilitar retries internos, redirects, tool execution e continuações. Envio abortado/incerto não recebe reserva devolvida; resposta de erro também pode ter custo.

Máximo de duas chamadas físicas por job: inicial + retry OU reparo. Uma reparação não encadeia outro retry. Retry permitido só para 429/5xx sem saída utilizável, se orçamento e deadline original comportarem. Retry-After é respeitado até 60s e dentro do deadline; sem header, 2s. Tool call, 401/403, schema de request inválido, overflow, length e erro de escopo/protocolo não têm retry. E_SCHEMA na RESPOSTA pode consumir a segunda chamada para reparo, preservando snapshot e acrescentando diagnóstico ao sufixo; recalcular todo orçamento antes.

Cada tentativa tem run_id próprio ligado a job_id e attempt_no, sem ressuscitar run anterior. Cada attempt persiste estado reserved -> dispatched -> completed|failed|cancelled|unknown. `dispatched` registra intenção anterior à conexão; queda nesse intervalo é unknown, não prova zero requests. Uso real pode atualizar contadores sem republicar job. Attempts terminal são imutáveis exceto reconciliação de uso/observações.

Admissão interna do núcleo não controla retries do pai. Contabilizar tráfego primary separadamente; não prometer limite de duas chamadas para toda a sessão do host. Métodos do executor que não permitam admissão por request não satisfazem complete.

Ao atingir quota pausar novas manutenções e avisar; não renovar automaticamente nem alterar o orçamento do pai. Valores do ensaio de 31 podas devem ser configurados explicitamente antes do teste para comportar esse horizonte, sem confundir o limite conservador do default com capacidade infinita.

Cancelamento: transação torna job cancelled e fence inválido; stop do run aborta conexão e reader locais, aguardando até 2s; persistir local_stopped/remote_state. Se local não parar, quarantine de execução; nenhuma nova chamada até encerramento confirmado. Incerteza remota não autoriza inferir sucesso/custo zero. Crash não reexecuta run desconhecido.

## 7. Publicação terminal e revisões

Na entrada FINAL atual: seal -> ler View -> renderizar EffectiveFrame. Não usar system/tools de turno anterior. Se ready existir, verificar Scope/incarnation/fence/epoch/policy/config e a revisão esperada; confirmar prefixo/unidades efetivas lógicas e root_coverage contra bases atuais. User input novo cancela ready; append de worker preserva cauda. Parte desconhecida ou grupo que cruza corte impede aplicação.

Criar nova View materializada com coverage achatada de SPEC-07. Renderizar candidato sobre as raízes ATUAIS, uma vez; ganho é diferença de tokens do frame vigente e candidato, incluindo blocos/wrappers/manifest refs. Verificar M, protocolo e budget. Não somar outra cópia da cauda após o renderer.

Em transação local revalidar fence/revisões/dependencies; persistir Operation(kind=compaction), Chapter/Manifest, View revision+1, publication_seq+1, invalidar/remover overlays cobertos e marcar job published. Os recibos efetivamente entregues são consumidos somente nessa publicação; o campo do modelo feedback_applied é uma declaração separada. NOTA: a transação de blocos e a de correção também publicam View, mas não aumentam publication_seq de compactação.

Após commit, antes do forward, manter exclusão serializada local e verificar novamente policy/incarnation observáveis. Mudança ocorrida entre commit e despacho gera nova seleção ou E_STALE, sem enviar envelope antigo. Updates vindos de outro processo obedecem o mesmo proprietário/controle de admissão; não podem escrever enquanto esse fence está despachando. Instrução chegada DEPOIS do despacho só pode afetar a próxima chamada, sem retroatividade.

Emissions: selected quando revisão escolhida; emitted somente ao observar dispatch; acknowledged somente com resposta associável. Provider error após commit não desfaz View válida. Request retry do pai aplica a mesma projeção declarativa e registra tentativa distinta. Fonte de falha nova invalida o candidato; não reexecutar tools para obter contexto.

## 8. Compactação nativa, mutação e resets

Antes de compactação nativa/manual/revert, cancelar manutenção e impedir novas oportunidades para aquela epoch. Na conclusão, capturar a nova visão por interface pública; incrementar host_epoch/view_revision e arquivar overlays anteriores. O ledger mantém capítulos antigos; não reintroduzi-los automaticamente. Âncoras ativas são reaplicadas respeitando a política atual.

Se a compactação nativa falhar sem mudar a visão, revalidar a visão anterior e liberar a sessão; não presumir sucesso pelo simples evento de início. Se só for possível observar o resultado, invalidar propostas antes de renderizar a nova visão. Se o host puder mudar contexto sem que o adaptador detecte, complete não é homologável nessa combinação.

Fonte antiga editada/deletada/revertida: aplicar fechamento reverso de read_dependencies/content conforme SPEC-07, inclusive capítulos consolidados e regras reproduzidas. Supersessão histórica não é exclusão/redação. Remover overlays inválidos, publicar estado vigente e bloquear despacho se a expansão não couber. Tombstones impedem recaptura de bytes excluídos.

## 9. Interrupção, margem e falhas

A preparação usa rede em paralelo, publicação não aguarda LLM. I/O local e validação ainda têm custo; “sem espera” não significa latência zero.

Se a entrada do pai ultrapassar B antes da proposta ficar pronta, não enviar request inválido. Oferecer à política nativa a recuperação por interface suportada; cancelar o job incompatível. Se a rota não permitir isso com segurança, segurar a chamada e informar E_BUDGET. Workers já executados não são apagados: suas mensagens permanecem no host/arquivo e entram quando houver orçamento.

Se não houver material elegível suficiente por excesso de âncoras, manter regras e reportar a causa. Não comprimir por força. Cache miss só afeta métricas/orçamento, não autoriza descartar mais conteúdo.

Pause cancela queued/running/ready, mas mantém overlays válidos e consulta. Correções autorizadas de blocos ainda publicam nova View em pause; nunca esperar futura compactação. Resume revalida configuração, epoch, quotas e fontes antes de rearmar. Desinstalação/handoff e exclusão seguem SPEC-05 e SPEC-03.

## 10. Provas de implementação

Fixtures devem cobrir bordas exatas `T-1/T`, cooldown, rearmamento por L e por N, mensagens simultâneas, alterações em fontes antigas, callbacks tardios, falha de disco antes/depois do commit e coalescência de eventos. T14–T18/T40 validam orçamento; T08–T13/T28–T29 validam publicação. São requisitos futuros, não resultados executados nesta versão.

C03–C08 são refinados por [SPEC-09](09-review003-boundaries.md): estado da proposta é explícito; View publicada também é revalidada; captures/transporte têm lifecycle próprio e reset sem sucesso observado não avança epoch.
