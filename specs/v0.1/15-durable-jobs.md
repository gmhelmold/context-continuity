# SPEC-15 — jobs e tentativas duráveis (WP-02/C)

**Contrato do incremento WP-02/C. Evidências e fases de revisão em [WP-02-C](../../docs/implementation/WP-02-C.md); integração exige matriz verde no head final.**

Adendo a SPEC-02/03/12. API interna de persistência, sem rede, scheduler, tokenizer, publicação ou AttemptPermit de transporte. Nenhum método habilita modo complete. A integração fornece fatos de transporte e estimativas conservadoras; não são declarações do modelo.

## Perfil inicial e admissão

`admitJob(lease, context, expected)` exige JobContext emitido pelo núcleo e JobContextRef fixada antes da execução. Em uma transação IMMEDIATE: validar owner/fence/epoch/policy/View, configuração, raízes atuais, fontes duráveis e manifesto; gravar registro+expectativa+configuração congelada e manifesto exato. Uma sessão tem no máximo um job ativo e não admite outro enquanto existir run local não encerrado. Repetição idêntica devolve o registro anterior, nunca reinicia job ou prazo.

O primeiro perfil admite apenas raízes brutas, fontes inline retidas e lote de feedback vazio. Blocos, capítulos e recibos ainda sem serviços duráveis são E_CAPABILITY, nunca descartados silenciosamente. Cobertura lógica equivale às raízes indicadas, sem alegar contiguidade no host. Todas as fontes da cobertura devem estar nas dependências. Autoridade das citações vem das raízes atuais que referenciam cada fonte; associação ausente ou contraditória é recusada. Dependências adicionais não citadas também são verificadas. O perfil usa o leitor bounded de SPEC-14: 4 MiB/256 fontes distintas por transação; não reabre todo o conteúdo histórico.

O prazo é created_at do snapshot + job_timeout_ms congelado; snapshot futuro/expirado é recusado. Contrato congelado não demonstra completude do EffectiveFrame, tokenização real ou ganho semântico: continuam nos pacotes de projeção/executor.

## Representação sem migração

DDL v1 permanece idêntico. `jobs.snapshot_json` contém envelope v1 `{expected,context,configuration,schema_version}`: expectativa é campo próprio gravado na admissão, não derivado do registro ao restaurar. `manifest_json` deve coincidir exatamente com context.manifest. Colunas de ID, sessão, incarnation e fence devem coincidir com o envelope. `usage_json` contém progresso v1 `{retry}`; retry é null ou `{kind,not_before_ms}`. Esse controle NÃO representa uso real ou faturamento. Medições de uso futuras exigem contrato próprio antes de ampliar esse envelope.

`proposal_json` é null ou envelope fechado v1 `{schema_version,value,digest}`. `digest=hashPayload({ref:JobContextRef,value})` vincula a proposta à geração. A leitura confere tamanho, campos, versão e checksum, depois usa o mesmo parser estrutural do núcleo (sem emitir handle) para validar claims, índices, referências apresentadas e feedback. O retorno é profundamente imutável. Checksum não autentica um invasor capaz de reescrever todo o banco e todos os controles; não substitui a origem confiável do ledger. Jobs deste perfil ainda não existiam em produção na base do incremento; não há migração implícita de proposta raw.

Leituras `readJob(binding,expected)` são diagnósticas: conferem envelope, associações, tentativas e estado, mas não emitem handle verificado nem reexecutam trabalho. Expectativa divergente ou registro inconsistente é erro. Revalidação do manifesto para resposta usa os bytes atuais, não o selo de uma chamada antiga. O diagnóstico não relê fontes nem certifica que uma proposta ainda pode ser publicada. ready/published exigem última tentativa completed, parada local confirmada e resultado remoto confirmado; estado terminal não pode conter tentativa reserved/dispatched. Estados de tentativa e run são validados nos dois sentidos, sem reparar inconsistência silenciosamente.

## Tentativas e resultados

`reserveJobAttempt(lease,expected,{input_tokens,output_tokens})` cria attempt e aux_run juntos e incrementa contadores. Limite congelado de uma ou duas tentativas e quotas de sessão são transacionais. `sessions.counters_json.job_budget` guarda chamadas/entrada/saída reservadas, sem zerar na reabertura. Este perfil conserva reservas inclusive em falhas e cancelamentos; não infere estorno. Saída deve ser a reserva configurada; entrada inteira inclui missão e cabe em C-R/I/H.

`markJobAttemptDispatched(lease,expected,attempt)` consome a transição reserved uma vez, persistindo intenção ANTES de qualquer conexão futura. Repetição dessa transição falha. AttemptRef associa job_id,attempt_id,run_id,attempt_no; não é autorização de rede e nunca pode selecionar outro job.

`recordJobAttemptResult` recebe observação de transporte por autoridade local: resposta e finisher, erro HTTP (com Retry-After em ms) ou abort. `local_stopped` é fato que o supervisor deve observar, não pode inferir de lease/timeout. Resposta válida é novamente decodificada pelo core usando contexto/manifesto revalidados. Ganho numérico usa parent_input_tokens/candidate_input_tokens fornecidos pelo projetor autorizado; ready não publica uma View nem atesta semântica. Noop/ganho insuficiente e resposta complete só de whitespace terminam rejected/E_NO_GAIN, sem reparo. Finisher não completo prevalece sobre whitespace. A verificação de fontes fica num estágio separado: inconsistência de metadados/esquema/autoridade é E_SOURCE sanitizado e não pode habilitar reparo por LLM. Falha de SQL/armazenamento não classificada reverte a transação, nunca é reinterpretada como E_SCHEMA da resposta. Apenas erro de formato da resposta decodificada pode permitir reparo; 429/5xx podem permitir somente retry, respeitando 2s sem header ou até 60s com header e sempre o prazo original. Erros de protocolo/tool/length e demais HTTP são finais. Todo resultado só é aceito para a tentativa dispatched corrente. Entrada de API malformada ou acima do limite é recusada antes da transação; essa recusa não fabrica resultado terminal. O supervisor deve encerrar/cancelar a execução pelo caminho explícito e registrar sua parada real. Os contadores continuam conservadores até reconciliação autorizada.

Somente run encerrado libera slot. `confirmJobAttemptStopped` pode registrar encerramento observado de um run da mesma geração/fence pelo supervisor local, inclusive após cancelamento, sem ressuscitar job ou converter estado remoto unknown em confirmed. Callback tardio não modifica conteúdo/status do job terminal; observação de parada é operação separada. Novo owner não pode declarar parada de um processo antigo apenas com TTL.

## Cancelamento e recuperação

`cancelJob` cancela queued/running/ready; reserved torna-se cancelled/stopped local, pois o protocolo ainda proíbe conexão. Dispatched torna-se unknown/quarantine até confirmação local. Histórico e reservas permanecem. Admitir outra geração requer ausência de run não parado, além do índice de job ativo.

`recoverJobs(lease)` é operação explícita; open não altera jobs. Jobs queued/running de fence antigo viram failed/E_OWNER; ready é cancelled por padrão. Deadline expirado também encerra a geração sem alterar o prazo. Tentativa reserved não é despachada; dispatched fica unknown/quarantine. Repetir recovery é idempotente, nunca reconstrói um permit, zera tentativas ou executa rede.

Sem serviço de liveness de SO implementado neste perfil, recovery não afirma que processo antigo morreu. A quarentena é hold explícito; liberação cross-owner depende do futuro supervisor/lock de liveness do WP-02, não de endpoint genérico booleano. Caso a morte seja observada pelo supervisor competente, SPEC-03 permite registrar stopped local com remote unknown. Não antecipar essa prova só porque um processo foi reiniciado.

## Critérios do incremento

**Success Criteria:** identidade/job/manifesto persistem juntos; reservas antes da intenção; resultados cruzados/tardios recusados; recuperação não repete trabalho.

**Quality Standards:** SQLite e processos reais, fontes sintéticas, barriers determinísticas, controles positivos e mutações com falha na assertion nomeada; matriz nos pins.

**Completeness Criteria:** admissão/replay, concorrência, prazo, owner, limites, falha parcial, duas tentativas, schema/HTTP/noop/ready, cancelamento, fonte alterada, restart e quarentena.

**Definition of Done:** testes/typechecks, regressões prévias e CI no head final conferidos, diff revisado, árvore integrada idêntica, issue #5 atualizada sem fechar WP-02.

**Invariants:** nenhum método faz rede ou publica View; não habilita modo; index não é prova de bytes; owner antigo não escreve; incerteza nunca vira custo zero ou replay; dados pessoais não entram nas fixtures/repo.
