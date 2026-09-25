# WP-02/F2 — intenções de capacidade pré-arquivo

[SPEC-24](../../specs/v0.1/24-staging-intents.md) · [SPEC-18](../../specs/v0.1/18-workspace-coordinator.md) · [SPEC-21](../../specs/v0.1/21-source-pins.md) · [SPEC-23](../../specs/v0.1/23-storage-budget.md) · [issue #47](https://github.com/gmhelmold/context-continuity/issues/47) · [WP-02 / #5](https://github.com/gmhelmold/context-continuity/issues/5).

## Corte

F2 acrescenta somente `reserveStaging`, `readStaging` e `cancelStaging` ao `WorkspaceCoordinator`. Reserva lógica disputa o contador compartilhado de SPEC-23 antes de existir arquivo. O DDL v1 permanece inalterado: linha `storage_reservations.kind='staging'` mais envelope canônico `storage.staging-intent.v1:<reservation_id>`.

Não acrescenta writer, fsync, staging path, blob, GC, descoberta, recuperação, adoção de owner, jobs, sessions, View, HTTP, provider ou inferência. `managed_files` bloqueia reserva/replay/cancelamento; este corte não altera esse catálogo nem arquivos físicos.

## Invariantes

- Ordem: flock workspace, `BEGIN IMMEDIATE`, validação/replay, fence físico, count, `assertStorageCapacity`, linha/envelope, guarda final, `COMMIT`, release.
- `reserved` exige linha exata e owner active/process_instance; `cancelled` exige ausência da linha e mantém histórico imutável.
- Replay exato revalida binding, sessão/incarnation/host_epoch/tombstone, política e ausência de `managed_files`; não cobra bytes ou slot outra vez.
- Cancelamento é owner/process original, binding/envelope original, CAS atômico. Política/tombstone posterior não impede cleanup; arquivo, blob, job e owner não mudam.
- IDs compartilham domínio com source pins. Ambas admissões consultam somente chave meta estrangeira conhecida, sem materializar payload estrangeiro; histórico released/cancelled não é reutilizável.
- Envelope é TEXT UTF-8 com máximo inclusivo de 16384 bytes. Projeção escalar precede valor; NUL, BLOB, parcial, parse inválido, forma não-canônica, digest, row ou owner divergente são `E_STORAGE`.

## Provas previstas

`staging-intents.test.mjs` cobre forma pública, limites, imutabilidade, binding/policy/tombstone, replay, owner, row/envelope, limite UTF-8, quota com retenção inline, fence `managed_files`, cancelamento e atomicidade. `staging-intents-processes.test.mjs` cobre crash antes/depois de `COMMIT` e reinício sem adoção. `staging-intents-mutations.test.mjs` controla quota, owner, replay/policy, fence físico e histórico cross-kind; cada mutante deve falhar por assertion nomeada após controle passar.

Evidência Actions deste head: pendente. Nenhum build, typecheck ou teste foi executado localmente. Gates exigidos no Actions: `npm ci --ignore-scripts --no-audit --no-fund`; `npm run check:storage`; `npm run test:storage`; `npm run build:locks`; `npm run test:coordination`; `python3 scripts/check-spec.py`; `python3 scripts/check-reference-model.py`; `python3 scripts/test-spec-check.py`; `python3 scripts/check-canonical.py`; `python3 scripts/check-storage-contracts.py`; `node --test tests/conformance/opencode/test-components.mjs`; `python3 tests/conformance/opencode/test-witness.py`.

WP-02 e #47 não estão marcados PASS por este registro. Revisão do autor não é auditoria independente.
