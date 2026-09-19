# SPEC-17 — recursos privados de lock (WP-02/D2)

Refinamento de SPEC-16. Implementação interna `packages/storage/src/lock-resources.ts`; não é WorkspaceCoordinator, API de modelo, registry de owners, prova de parada ou autorização de limpeza/publicação. O SQLite e os jobs existentes não importam esta camada.

## Recursos e API interna

`LockResources.open(directory, initialize)` aceita diretório absoluto privado 0700 do usuário atual e booleano explícito. Rejeita NUL, Unicode malformado, segmentos `.`/`..` e symlink final, inclusive com barra terminal; aliases ancestrais como `/tmp` são resolvidos uma vez por realpath. Captura a identidade antes/depois dessa resolução. Não promete isolamento contra processos hostis com o mesmo usuário.

`initialize=true` prepara somente `owners/` e `workspace.lock`; criação exclusiva, sem truncamento ou unlink. Diretório e arquivos são sincronizados. Arquivos existentes precisam ser regulares, privados 0600, vazios e com um link. Falha pode deixar recursos vazios não registrados: não faz rollback de filesystem nem os adota como autoridade persistida. Cabe ao futuro coordenador verificar ausência/presença de seu anchor antes de permitir bootstrap. `initialize=false` nunca recria caminho ausente.

`identity` conserva dev/ino de diretório, owners e workspace.lock como strings decimais de stats BigInt, profundamente imutáveis. `guard` verifica descritor e caminho contra as identidades capturadas e os atributos esperados. Um novo open pode observar nova identidade após substituição: somente o futuro anchor durável pode recusar adoção entre instâncias. Esta camada não lê nem grava esse anchor.

`acquire` tenta flock uma vez; ocupado e reentrância são E_CONFLICT. Guarda os caminhos antes e depois da tentativa. `release` e `close` são idempotentes, sem remover arquivos. Close revoga os recursos antes do fechamento e tenta fechar todos mesmo após uma falha individual. Não repete close de um número de descritor que já possa ter sido reutilizado. Falha de recurso/perfil é E_CAPABILITY sanitizado. Isso inclui close direto do owner e cleanup de uma construção recusada; a falha original não escapa. Revogação e remoção do handle ocorrem mesmo na falha, sem repetir close.

`owner(uuid, create)` exige UUID em formato fechado e booleano, sem coerção de objetos. Criação usa O_EXCL; não reutiliza UUID existente. O resultado interno oferece identidade, guard/sync/tryLock/unlock/close, mas nunca o número do fd. Não representa um owner registrado nem exige implicitamente um lease de sessão.

Owners abertos pertencem ao recurso pai: fechar um filho remove-o da coleção; fechar o pai fecha também os filhos ainda abertos. Toda guarda de filho revalida os recursos pais. Não existe finalizador/TTL, duplicação ou herança deliberada dos descritores. O futuro coordenador deve manter os recursos durante toda a vida autorizada e revogar sua autoridade de registro antes do fechamento.

## Nativo e instalação

A ponte é carregada preguiçosamente do caminho fixo do pacote, somente ao abrir recursos. Falta de binário ou filesystem não aceito recusa, sem compilação, download ou fallback automático. Importar o módulo não requer binário. O build explícito existente, Node-API e pins não mudam.

## Fronteira de integridade

Nenhum método altera SQLite, storage_owners, reservas, sessões, jobs ou rede. Locks livres ainda NÃO provam morte de processo. Não libera quarantine, não reembolsa uso e não torna readReference uma evidência. Callbacks síncronos com capacidade revogável, anchors persistidos e aposentadoria transacional pertencem ao coordenador ainda pendente. Não mover a responsabilidade desses controles para o chamador sem contrato explícito.

## Provas e cinco axiomas

**Success Criteria:** uma instância não segue caminhos substituídos; exclusão é observada fora do componente; fechamento libera exatamente os recursos pertencentes à instância.

**Quality Standards:** arquivos e processos reais privados; Python/fcntl como testemunha; testes positivos e oito implementações incorretas com falha por assertion. Timeout, compilação ou ausência do teste nunca são prova.

**Completeness Criteria:** bootstrap/reopen, falta de binário, dados inválidos, identidade exata, disputa/reentrância, symlink/hardlink/modos, parent/child lifetime, substituições e encerramento de filho da fixture.

**Definition of Done:** typechecks e matriz de coordenação/core/storage/host no head final; logs conferidos, diff revisado, árvore integrada comparada e issue #5 atualizada. Não fecha WP-02/D completo.

**Invariants:** não expor fd; não apagar locks; não usar TTL como exclusão; não seguir recurso substituído na mesma instância; bootstrap não publica autoridade; dados pessoais ficam fora dos testes.

## Referências

[Node fs v22.17.1](https://nodejs.org/download/release/v22.17.1/docs/api/fs.html) define stats BigInt e operações por descritor. [flock(2)](https://man7.org/linux/man-pages/man2/flock.2.html) distingue descrições abertas, duplicação, liberação e consulta não bloqueante. Provas concretas e seus limites estão no [registro de implementação](../../docs/implementation/WP-02-D-LOCK-RESOURCES.md).
