# SPEC-12 — associação imutável de geração

Adendo WP-01/D à revisão 0.1.2. Fecha a identidade contratual P01 da REVIEW-004, sem implementar scheduler, renderer, storage ou permissão de tentativa física.

## 1. Registro de snapshot

SnapshotRecord é o Snapshot de SPEC-01 com schema_version=1. O parser estrutural conserva cobertura lógica ordenada, raízes, dependências, revisões/fence, frame/config/input, manifesto, feedback, WorkContext e created_at. Datas UTC são YYYY-MM-DDTHH:mm:ss.sssZ válidas no calendário. Coberturas não vazias e únicas; dependências contraditórias à mesma versão são recusadas. Limites: 100000 itens por coleção de cobertura/dependências, 32 feedback IDs e 16 MiB canônicos por registro completo. Excesso recusa, nunca trunca.

O parser NÃO calcula prefix_digest/coverage_digest nem comprova contiguidade no host: a projeção de SPEC-07 fornece esses valores. WP-03/WP-04 continuam responsáveis pela correspondência Snapshot/EffectiveFrame, completude de dependências não citadas, ganho, orçamento, frescor e publicação. Não substituir a visão efetiva pelo histórico bruto para satisfazer esta API.

## 2. Criação e referência de controle

createJobContext(binding, snapshotFields, verifiedManifest, mission) gera job_id e snapshot_id. Binding e manifesto fornecem os respectivos IDs; snapshotFields não pode escolhê-los. A entrada contém view_revision, policy_revision, owner_fence, frame_id, logical_coverage, root_coverage, read_dependencies, prefix_digest, coverage_digest, config_digest, effective_input_digest, feedback_ids, work e created_at. Todas as EntityRefs do manifesto devem aparecer nas dependências, inclusive reference_only; dependências adicionais não citadas são preservadas.

A missão literal não é normalizada/trimada (até 256 KiB UTF-8). mission_digest usa SHA-256 dos bytes; snapshot_digest/context_digest usam o serializador compartilhado. context_digest cobre o registro inteiro, exceto ele próprio. O registro não contém envelope de host, headers ou funções. O armazenamento da missão pode conter dados do usuário e deve ser privado e sujeito à redação do ledger.

JobContextRef={job_id,snapshot_id,snapshot_digest,context_digest}. O chamador autorizado fixa a referência ANTES da geração e associa-a ao callback/attempt. Não extraí-la da resposta do modelo. Hash é consistência, não autenticação. Jobs diferentes usando o mesmo manifesto têm referências diferentes; mudanças de missão, feedback, tarefa, frame, política ou fence exigem outro contexto.

## 3. Resposta

assertJobContext exige binding, handle emitido e referência esperada exata. decodeJobProposal valida a associação antes de chamar decodeProposal com manifesto e feedback congelados; não aceita outro lote do callback. assertJobProposal também recusa resultados de outro job mesmo com o mesmo manifesto. Proposta validada pelo parser anterior não é JobProposal.

Validar respostas não cria tentativas/publicações nem autoriza retries. O executor futuro impõe AttemptPermit, deadline, cancelamento e local_stopped. Um contrato estruturalmente válido não é permissão de publicação após cancelamento.

## 4. Exportação e retomada

exportJobContext entrega registro profundamente imutável. parseJobContextRecord confere schema/checksums e retorna apenas dados. JSON não restaura handle. restoreJobContext exige binding autorizado, referência esperada obtida de storage confiável e VerifiedManifest revalidado nesta execução. Reconfere associações e emite handle local, sem iniciar inferência ou repetir geração órfã. Reinício segue SPEC-03. Frescor final continua sob transação do publicador.

## 5. Prova

Dois jobs com mesmo manifesto e feedback diferente não aceitam respostas cruzadas. Alterar job/snapshot/frame/config/mission/fence/work/feedback é detectado contra a referência congelada. Recalcular checksum de arquivo adulterado não satisfaz uma referência externa antiga. Novo processo Node revalida e recupera somente identidade. Controle positivo e mutantes exigem falha pelo motivo certo. T02.contract/T06.contract/T37.contract recebem esta prova; execução/projeção e durabilidade têm gates próprios.
