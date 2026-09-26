# WP-02/F3 — limite de recuperação identificada de intenção pré-arquivo

Implementação F3 e evidência local isolada cobrem `recoverStaging`: API estrita/imutável, owner ativo atual/estrangeiro, identidade de inode, lock ocupado/livre, fences pré-arquivo, CAS, rollback e barreiras sintéticas antes/depois de `COMMIT`. Testes e mutantes usam SQLite, flock e subprocessos reais somente em diretórios sintéticos privados. Esta evidência local não substitui matriz herdada no Actions nem é homologação runtime. [WP-02](../../specs/v0.1/WORK-PACKAGES.md#wp-02--ledger-e-persistência-transacional), R19 e [T19.storage](../../specs/v0.1/06-acceptance.md#t19--fonte-antes-da-poda) permanecem existentes e `not_run`.

F3 limita-se a exceção de autoridade de recuperação identificada, pré-arquivo, de uma reserva staging comprovadamente sem detentor. Não implementa cancelamento cross-owner geral, recovery geral de owner, aposentadoria/adoção, cleanup físico, writer, staging path, blobs, jobs, View, GC, rede ou inferência. WP-02 permanece aberto.

Execução da matriz herdada completa e evidência Actions requerida por SPEC-25 §5 permanecem pendentes. Não declarar F3, staging físico, recuperação geral de owner ou WP-02 completos por estes testes.
