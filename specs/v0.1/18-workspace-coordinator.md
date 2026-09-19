# SPEC-18 — coordenador transacional de recursos (WP-02/D3)

Refina SPEC-03/16/17 e o desenho de origem. Implementação interna `WorkspaceCoordinator`: associa recursos privados ao SQLite existente. Não é ferramenta de modelo, scheduler, supervisor de execução, gerenciamento de blobs ou licença para liberar jobs em quarentena.

## Inicialização e identidade durável

`initialize(directory, workspace)` verifica o banco existente pelo adaptador canônico. Não cria SQLite. O preflight de leitura/inspeção de esquema ocorre antes do flock e não grava registros de coordenação. Depois dessa inspeção, verifica `PRAGMA encoding` e exige UTF-8 antes de abrir/criar qualquer recurso de coordenação, inclusive quando ainda não há anchor. UTF-16le/be são recusados com E_CAPABILITY, sem publicar anchor, owners ou reservas, sem criar `workspace.lock` ou `owners/` e sem migrar encoding. Isso não proíbe a negociação WAL/sidecars feita pelo adaptador SQLite anterior ao preflight. Havendo anchor, recursos são abertos sem criação; recurso ausente é erro, nunca recriação automática. Sem anchor, o bootstrap explícito usa SPEC-17. Depois adquire workspace flock uma vez, antes de BEGIN IMMEDIATE, e compara/grava `meta['coordinator.anchor.v1']` em uma transação. Dois inicializadores cooperantes usam o mesmo inode; busy é erro explícito sem espera/retry interno.

Anchor v1 fechado por igualdade canônica: `{schema_version:1, workspace, resources:{directory,owners,lock}}`. Cada identidade é `{dev,ino}` decimal exato, originada em stats BigInt. Não pode ser redefinido por initialize. Havendo owners/metadados de owners sem anchor, recusa adoção. Falha antes do commit pode deixar arquivos vazios sem registro; nenhum arquivo desconhecido é removido. Nova inicialização explícita pode completar o anchor dos mesmos recursos quando ainda não existem owners. Banco movido/copied para outro domínio de arquivos exige fluxo de transferência futuro, não adoção silenciosa.

`open(directory,workspace)` exige os recursos e anchor existentes. Adquire workspace flock antes de conectar/inspecionar SQLite. Mantém uma conexão própria sem expor SQL/descritores. Todas as operações de estado usam ordem workspace flock -> SQLite. A API de sessão antiga continua independente; este incremento não conecta seus writes ao lock do coordenador nem altera contratos dos jobs.

## Participante de storage

A construção da instância passa exclusivamente pela factory `open`. O construtor exige uma chave local privada em runtime, além de ser privado nos tipos; chamadas diretas de JavaScript são recusadas antes de acessar recursos fornecidos. Isso preserva a origem da instância, não isola código hostil do mesmo usuário.

Cada open cria owner_id e process_instance novos; process_instance identifica esta instância participante, não PID nem afirmação de unicidade por processo. Abre exclusivamente `owners/<owner_id>.lock`, sincroniza o arquivo/diretório e mantém seu flock antes de publicar `storage_owners(active)` e o metadado `coordinator.owner.v1:<id>` juntos.

Metadado fechado v1: `{schema_version:1,owner_id,process_instance,created_at,identity}`. O registro SQL conserva chave relativa canônica e timestamp UTC de diagnóstico. Toda leitura compara registro e metadado; ausência parcial, versão/identidade contraditória ou arquivo substituído não é corrigido silenciosamente. O esquema DDL não muda; arquivos de lock nunca são reutilizados/removidos. Timestamp não é prova de vida e não é usado como TTL.

A instância conserva o descritor original até close. Não expõe, duplica nem transmite seu descritor. Toda operação verifica recursos/anchor e o próprio owner active. A garantia pressupõe participantes cooperantes; não é sandbox contra código do mesmo usuário que ignora o protocolo. Aposentar recurso de storage não certifica fim de subprocessos/chamadas remotas.

## Limite de metadados de identidade

Anchor e metadado de owner têm teto inclusivo de 8192 bytes UTF-8. A leitura verifica encoding e usa uma projeção SQL condicional: somente TEXT dentro do teto pode atravessar o driver como valor; tipo/tamanho são escalares. O texto recebido precisa ter exatamente o tamanho medido no mesmo SELECT antes do parser. Prefixo truncado em NUL não representa o envelope completo. Fora do perfil UTF-8, recusa com E_CAPABILITY, sem conversão ou migração.

Após o preflight de encoding, initialize consulta somente existência para decidir bootstrap; não lê o payload nessa decisão. Guarda de anchor e leitura de owner compartilham o loader privado. A projeção única mede e retorna o valor no mesmo statement, inclusive nas guardas fora de transação. Transações, flock, igualdade canônica, comparação entre registros e revogação permanecem inalterados. Nenhum dado inválido é reparado ou adotado.

O teto cobre somente esses dois tipos de envelope em meta, não os demais campos SQL, todo o banco ou o RSS do processo. Igualdade de tamanho detecta transferência incompleta, não autentica substituições de mesmo comprimento. Erros SQL continuam sanitizados pelos chamadores. [Provas e blast radius](../../docs/implementation/WP-02-D-IDENTITY-ENVELOPES.md). [Regressões de inicialização e encoding](../../docs/implementation/WP-02-D-BOOTSTRAP-ENCODING.md).

## Seção síncrona

`withWorkspaceLock(callback)` adquire uma vez e entrega WorkspaceHold imutável ligado à instância, workspace e seção. `assertWorkspaceHold(workspace,hold)` aceita somente handle local emitido e ainda ativo, revalidando recursos e owner. Cópia/JSON, outro workspace, uso após retorno/erro e reentrância são recusados. A seção não expõe banco/path/fd e não é AttemptPermit.

A própria fronteira pública de `assertWorkspaceHold` sanitiza falhas inesperadas da guarda com `storageFailure`, mesmo quando o callback captura o erro antes do catch externo da seção. Erros de contrato já classificados são preservados; exceções cruas do driver não são expostas. A chamada que falha não devolve autoridade nem libera o lock da seção. Após falha transitória, outra chamada explícita precisa executar a validação completa; não há retry automático, adoção de identidade ou renovação do hold, que continua expirando ao sair da seção.

Callbacks precisam do protótipo Function local ordinário; async/generator, inclusive bound, são recusados antes de invocar. Funções de outro realm não são presumidas compatíveis. Promise/thenable retornado é recusado sem aguardar; accessors then não são invocados. Handle é revogado em finally antes da liberação. Callbacks são código interno autorizado, não sandbox: a API não desfaz efeitos externos nem impede trabalho arbitrário que o chamador tenha iniciado. Ela não mantém transação SQLite durante callback; serviços futuros podem iniciar sua própria transação sob o hold. close durante seção é recusado sem revogar a seção vigente.

## Diagnóstico e aposentadoria

`readOwner(id)` lê registro e metadado em snapshot SQLite sob workspace flock. active é registro, não observação de processo vivo. `retireOwner(id)` devolve absent para inexistente, held para self ou lock ocupado, retired para registro já retirado (diagnóstico idempotente, não nova prova de lock livre).

Outro owner active requer arquivo existente e identidade exata persistida. A inspeção tenta flock não bloqueante; busy conserva tudo. Falha/ausência/substituição é E_CAPABILITY e rollback. Quando adquirido, qualquer storage_reservation vinculada impede aposentadoria automática: E_CAPABILITY, sem remover pins/staging/contadores. Sem reservas, faz CAS active->retired, mantendo o lock de inspeção até COMMIT. A resposta não é capacidade para excluir conteúdo nem liberar execução.

`close()` recusa reentrância, revoga a instância antes de qualquer fechamento, tenta aposentar o próprio registro sob workspace flock e transação, depois tenta fechar todos os recursos e a conexão. Falha de disputa/reserva/commit preserva registro active para inspeção posterior, mas a instância permanece revogada. Não há retry de close ou unlink. Aposentadoria persistida não certifica sucesso de todas as operações de fechamento: falha subsequente é reportada.

Falha de ROLLBACK marca a conexão como inutilizável e tenta fechá-la; nenhum novo hold pode ser emitido por essa instância. Cleanup de conexão/recursos é sanitizado e tenta todos os fechamentos. O chamador ainda fecha o coordenador para revogar seus recursos e não recebe autorização de reuso por um erro de rollback.

## Limites explícitos

Não altera sessions, jobs, attempts, aux_runs, View, quotas ou reservas. Não libera quarantine cross-owner; depende da associação futura ao supervisor e seus critérios próprios. Não implementa GC, read/export pins, staging ou migrações/backups. Nenhum lock disponível é tratado como prova geral de morte de processo. Nenhum método faz rede, build ou inferência.

## Cinco axiomas

**Success Criteria:** anchor e owner são duráveis/consistentes, lock antecede autoridade, inspeção preserva detentor vivo e reservas, handles expiram.

**Quality Standards:** SQLite/FS/processos reais, testemunha Python independente, barreiras antes/depois de commit, controle positivo e mutantes reprovados pela assertion certa.

**Completeness Criteria:** init/reopen/concorrência, CAS, identidade entre instâncias, borrowed lifetime, erros/close, owner ocupado/ausente/retired, reservas e crash. Não confundir com supervisor de jobs.

**Definition of Done:** contrato/código/testes alinhados; matriz nos pins com logs do head final; árvore integrada igual à testada; issue #5 atualizada sem fechar WP-02.

**Invariants:** nenhum fd/SQL exposto, nenhuma exclusão/recaptura/reexecução, sem TTL como lock, erro não vira aquisição, owner retired não ressuscita, nenhuma promessa de semântica ou exatamente-uma-vez remoto.

## Fontes primárias

[SQLite transactions](https://www.sqlite.org/lang_transaction.html), [flock(2)](https://man7.org/linux/man-pages/man2/flock.2.html), [Node fs 22.17.1](https://nodejs.org/download/release/v22.17.1/docs/api/fs.html). Provas são do perfil local exercitado, não de todo driver/filesystem existente.
