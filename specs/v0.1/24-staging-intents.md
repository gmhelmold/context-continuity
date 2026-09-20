# SPEC-24 — reservas de capacidade pré-arquivo (WP-02/F2)

**Contrato de implementação futura; nenhuma API F2 está habilitada por este documento.** Trabalho rastreado na [issue #47](https://github.com/gmhelmold/context-continuity/issues/47), dentro de [WP-02 / #5](https://github.com/gmhelmold/context-continuity/issues/5). Refina [SPEC-03](03-ledger.md), [SPEC-18](18-workspace-coordinator.md) e [SPEC-23](23-storage-budget.md). A proposta anterior chamada F1 na conversa é substituída por esta integração com o contador já existente; não reaplicar sua alteração de `accountedBytes`.

## 1. Objetivo e limites

Reservar capacidade de conteúdo antes de qualquer arquivo físico. A intenção disputa a mesma quota lógica de 2 GiB da retenção inline. O resultado não é espaço livre do disco, autorização de filesystem, lease de sessão, permissão de inferência ou publicação de View.

Este corte não cria conteúdo, caminhos, blobs ou registros em `managed_files`. Não implementa writer, fsync/finalização, GC, descoberta de intenções ou recuperação entre participantes. Reservas abandonadas continuam cobradas. Um futuro writer precisa de transição explícita e revisão própria; não deve interpretar este registro como autorização suficiente.

## 2. API prevista no WorkspaceCoordinator

| Método | Entrada | Resultado |
| --- | --- | --- |
| `reserveStaging(binding, request)` | Binding completo e pedido fechado descrito abaixo | Registro `StagingIntent` imutável, estado reserved |
| `readStaging(binding, id)` | Binding original completo e UUID | Registro estruturalmente verificado ou null; nenhum direito adquirido |
| `cancelStaging(binding, id)` | Binding original, UUID e participante original válido | true na transição; false na repetição de cancelamento já confirmado |

Pedido: `reservation_id`, `operation_id`, `max_bytes`, `expected_policy_revision`. IDs usam o validador do núcleo; inteiros não sofrem coerção e accessors são recusados sem invocação. `max_bytes` admite 1 a 16777216, inclusivo. Até 4096 reservas kind=staging simultâneas por workspace, incluindo linhas já existentes; nenhum argumento altera limites. Um arquivo futuro vazio pode consumir uma reserva de capacidade não vazia: reservar máximo não informa o tamanho final.

Tipos e constantes do contrato devem acompanhar a API exportada. Helpers SQL permanecem internos; não expor conexão, descritor ou construtor alternativo. O gate de tipos precisa verificar imutabilidade e ausência de overrides.

## 3. Registro e identidade

Usar o schema v1 existente. `storage_reservations` registra participante, operação, sessão/incarnation, kind=staging, tamanho máximo e timestamp. `staging_path_key` e `blob_digest` são null. Envelope em `meta['storage.staging-intent.v1:<reservation_id>']`: schema_version=1, reservation_id, operation_id, max_bytes, binding, owner_id, process_instance, policy_revision, state e created_at. Estados deste corte: reserved ou cancelled; digest por `hashPayload`, canonicalização compartilhada.

Reserva e envelope são atômicos. Reserved exige linha correspondente exata e owner persistido active com process_instance correspondente. Cancelled exige ausência da reserva; seu owner pode posteriormente estar retired. Registro sem contraparte, row divergente, encoding incompatível ou metadado malformado não pode virar ausência, zero bytes ou autorização.

Envelope TEXT/UTF-8 de até 16384 bytes, inclusivo; limitar na projeção SQL antes de transferir texto. Medida e valor devem pertencer ao mesmo snapshot. Verificar tamanho recebido, parser fechado, digest e forma canônica antes de aceitar. Aplicar limite equivalente ao scope_json consultado na admissão. Não prometer teto global de RSS, limite de todos os campos SQL ou autenticação de um banco inteiramente reescrito.

IDs de reserva compartilham domínio com [pins inline](21-source-pins.md). Ambas as admissões devem recusar histórico do outro serviço, inclusive released/cancelled, sem carregar payload só para detectar colisão. Novo kind futuro precisa estender explicitamente o contrato. `operation_id` agrupa uma operação de storage; não é job LLM nem implica unicidade de uma reserva por operação.

## 4. Admissão, replay e quota

Reutilizar as seções, transações e guardas de SPEC-18. Ordem obrigatória: workspace flock, BEGIN IMMEDIATE, validações/inserções, guarda final, COMMIT, liberação. O lock original do participante permanece detido. A integração precisa demonstrar essa ordem; a mera presença de uma transação no helper não prova flock ou modo IMMEDIATE.

Na transação: verificar colisões e replay; exigir participante original para ID já existente; revalidar binding, incarnation, host_epoch, tombstones e política esperada; recusar operação já presente em managed_files; conferir quantidade e capacidade; inserir reserva/envelope; verificar correspondência e guarda final.

Reutilizar **`assertStorageCapacity` de storage-budget.ts**, na mesma transação da inserção. Não restaurar `accountedBytes` em source-records.ts, copiar seu algoritmo ou aceitar um StorageBudget anterior como permissão. A retenção inline já usa esse contador e deve competir com staging pela mesma quota. Contagem inválida/overflow é erro, nunca espaço disponível.

Replay exato mantém timestamp e cobrança, mas exige novamente escopo/política e ausência de trabalho físico. Não reserva bytes adicionais, portanto pode diagnosticar/repetir a mesma reserva acima da quota, sem ampliar sua capacidade. Pedido com operação, tamanho ou política diferente conflita. Depois de cancelled, o ID não ressuscita. A intenção não substitui lease/fence exigido por uma publicação futura.

## 5. Cancelamento e retomada

Só o participante original ainda válido pode cancelar. Binding e envelope originais permanecem obrigatórios, mas política/tombstone posteriores não impedem liberar capacidade que nunca produziu conteúdo. Cancelamento não recria a sessão nem lê seus bytes.

Qualquer registro managed_files da operação — staging, complete ou cleanup_pending — impede cancelamento pré-arquivo. Linha com staging_path_key ou blob_digest também deixa de ser uma intenção vazia. Não excluir, reparar ou renomear arquivos para satisfazer este método. Alterações de uma operação não devem afetar reservas de operações distintas.

A remoção da reserva e o CAS do envelope para cancelled devem ser confirmados juntos. Falha antes do commit conserva a reserva e a cobrança. Erro posterior ao commit pode deixar o cancelamento confirmado: repetição explícita reconhece o histórico, sem nova liberação ou repetição automática. ID desconhecido é conflito; diagnóstico null não autoriza cancelamento fictício.

Fechamento com reserva ativa segue SPEC-18: pode recusar aposentadoria, revogar recursos locais e conservar registro/cobrança. Outra instância pode consultar o binding original, mas não recebe poder de cancelar por saber IDs, encontrar lock livre ou observar idade/owner retired. Descoberta e recuperação identificada são serviços posteriores; não habilitar o fluxo físico enquanto suas dependências estiverem ausentes.

## 6. Plano de validação obrigatório

| Fronteira | Evidência requerida no Actions |
| --- | --- |
| API e tipos | Três métodos, entradas estritas, objetos imutáveis, limites inclusivos, getters não executados |
| Identidade | Workspace/sessão/incarnation/host_epoch/política, tombstones, owner original e colisões nos dois sentidos |
| Persistência | Envelope/row/owner inconsistentes, materialização limitada observada fora do produto, NUL, ausência parcial, histórico não reutilizável |
| Quota | Duas sessões, retenção inline nos dois sentidos, replay sem nova cobrança, excesso/overflow e disputa real pela última capacidade |
| Transações | Falha de inserção, cancelamento, COMMIT e pós-COMMIT; guarda final; rollback falho e locks liberados conforme SPEC-18 |
| Fronteira física | Três estados de managed_files e path/digest não nulos preservam cobrança; nenhuma escrita/exclusão de conteúdo |
| Processos | Saída antes/depois de confirmação conserva exatamente o estado confirmado; reinício não adota nem repete trabalho |
| Contraprovas | Controles positivos e remoções pontuais de quota, owner, replay/política, fronteira física e proteção de IDs, rejeitadas pela assertion nomeada |

SQLite, locks e processos reais, restritos a fixtures sintéticas. Padding de catálogo usado para aproximar 2 GiB deve ser identificado como registro lógico, não arquivo físico. Não copiar algoritmos do produto para fabricar o oráculo. Import/setup/timeout/sinal não contam como detecção; subprocessos e repetições não inflam contagens. Preservar os testes históricos e registrar todo resultado vermelho antes de sua correção.

A matriz anterior completa e seus pins continuam obrigatórios para o PR de implementação. O verde de um PR documental comprova apenas aquele conteúdo e os caminhos existentes; **não aprova as APIs previstas aqui**. Resultados detalhados, SHAs e jobs pertencem ao gate do head que realmente implementar F2.

## 7. Cinco axiomas

**Success Criteria:** reserva disputa a quota comum, replay não duplica cobrança e cancelamento pré-arquivo é atômico e owner-only.

**Quality Standards:** reuso do contador/core, erros classificados, fixtures reais, contraprovas nomeadas e execução de build/teste/typecheck exclusivamente Actions; revisão não apresentada como auditoria independente.

**Completeness Criteria:** API/tipos, limites, escopo/política, quota/concorrência, consistência/rollback, identidade final, fronteira física, colisões e reinício demonstrados no corte pré-arquivo.

**Definition of Done:** implementação, contrato e testes integrados; revisão e matriz do mesmo head aprovadas; evidências rastreáveis e árvore integrada igual à testada; branch organizada e #5 atualizada. Publicar este contrato não satisfaz o DoD da #47.

**Invariants:** sem migração, aumento de quota, replay de inferência, publicação de View, criação/exclusão de arquivos de staging, remoção por TTL ou adoção de owner. WP-02 permanece aberto para os serviços restantes.
