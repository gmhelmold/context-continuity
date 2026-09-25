# WP-02/F3 — limite de recuperação identificada de intenção pré-arquivo

**Registro de contrato apenas; nenhuma implementação, execução, evidência runtime ou resultado de gate existe neste branch.** [SPEC-25](../../specs/v0.1/25-staging-intent-recovery.md) define futuro `recoverStaging`; [WP-02](../../specs/v0.1/WORK-PACKAGES.md#wp-02--ledger-e-persistência-transacional), R19 e [T19.storage](../../specs/v0.1/06-acceptance.md#t19--fonte-antes-da-poda) permanecem existentes e `not_run`.

F3 limita-se a cancelamento identificado, pré-arquivo, de uma reserva staging comprovadamente sem detentor. Não implementa recovery geral de owner, aposentadoria/adoção, cleanup físico, writer, staging path, blobs, jobs, View, GC, rede ou inferência. WP-02 permanece aberto.
