# Desenho de origem — gerenciador de recursos e owners de storage

**Registro histórico da proposta, agora refinada por [SPEC-18](../../../specs/v0.1/18-workspace-coordinator.md).** As seções originais abaixo conservam decisões e limites pré-implementação. O coordenador foi acrescentado no WP-02/D3; não encerra WP-02/D nem substitui o supervisor de execução. As observações de fronteira estão em [WP-02-D-OWNER-BOUNDARIES](../../implementation/WP-02-D-OWNER-BOUNDARIES.md).

Proposta para WP-02/D2. API interna autorizada, não ferramenta do modelo. Esta etapa associa locks reais a recursos e registros de storage; não atesta morte de processo, execução remota ou liberação de jobs antigos.

## Inicialização e identidade

WorkspaceCoordinator.initialize(directory,workspace) prepara os arquivos privados em um workspace cujo SQLite já foi criado explicitamente. open exige os caminhos existentes, não recria um arquivo perdido. O diretório autorizado é resolvido uma vez; diretório final symlink, modo diferente de 0700 ou proprietário diferente são recusados. owners/ é privado; workspace.lock e owners/<UUID>.lock são arquivos regulares 0600, de um único link. Não truncar, remover nem reutilizar arquivos de lock.

A identidade dev/ino do diretório, owners/ e workspace.lock é registrada em meta, dentro do banco existente, sob flock exclusivo e transação SQLite. Cada operação confere descritor e caminho contra a identidade admitida. Uma substituição entre processos não cria outro domínio de exclusão aceito pelo mesmo ledger. Falha na inicialização pode deixar arquivos sem registro; não há remoção automática ou adoção de identidade divergente.

A ponte nativa é carregada apenas quando o gerenciador é usado, do caminho fixo do pacote. O build continua explícito; falta de binário/perfil é E_CAPABILITY, sem fallback para TTL ou helper. Não muda DDL, pins ou a inicialização das APIs existentes.

## Vida do owner

open gera owner_id/process_instance únicos; cria e sincroniza o arquivo exclusivo, adquire seu flock e só então publica storage_owners(active) mais a identidade do inode na mesma transação. O descritor não é exposto nem duplicado. O recurso é utilizável apenas enquanto a instância o mantém. Processo encerrado ou close libera esse recurso; isso NÃO afirma que toda atividade daquele processo, seus filhos ou uma chamada remota pararam.

close revoga a instância antes de liberar os descritores. Tenta marcar retired sob o lock de workspace. Se não puder registrar aposentadoria, fecha os recursos e reporta erro, conservando o registro antigo para inspeção posterior; nenhuma reserva é apagada. Não pode ocorrer dentro de uma seção emprestada. Não há finalizador/TTL que apague arquivos de owner, nem reutilização de UUID.

## Exclusão e empréstimo

withWorkspaceLock(callback) adquire uma vez, sem espera/retry. Ocupado é E_CONFLICT. A ordem é workspace flock -> transação SQLite; nenhuma transação do gerenciador fica aberta esperando flock. O callback autorizado é estritamente síncrono; funções async/generator são recusadas antes de executar; retorno Promise/thenable é recusado e a capacidade expira ao sair. A API não desfaz efeitos arbitrários de código do chamador, nem é sandbox para callback hostil.

WorkspaceHold é capacidade local imutável: assertWorkspaceHold exige handle emitido, workspace esperado, owner vigente e seção ainda ativa. Cópia, JSON, outro escopo, reuso depois da saída e reentrância falham. Não é lease de sessão nem AttemptPermit. O callback não recebe SQL, paths ou descritores. Nenhuma rede ou fsync grande deve ocorrer na seção.

## Inspeção e aposentadoria

readOwner é diagnóstico de registro; active não é prova de processo vivo. retireOwner inspeciona somente um ID registrado. Self retorna held sem teste reentrante; outro owner exige arquivo existente e identidade dev/ino persistida. Tenta flock não bloqueante: busy retorna held; erro/arquivo ausente/identidade divergente recusa sem alterar registros. Disponível permite marcar retired mantendo o flock da inspeção até o commit. Registro retirado nunca volta a active.

Qualquer storage_reservation ainda vinculada impede aposentadoria automática (E_CAPABILITY); staging, read/export pins e cleanup ainda não foram implementados nesta API. Nenhum job/aux_run/session-fence é alterado. Um owner sem lock só pode ser aposentado como recurso de storage sem reservas; liberação de quarentena de execução exige a associação supervisor/job do próximo corte.

## Critérios

**Success Criteria:** exclusão real e identidades estáveis; owner publicado só com lock; inspeção não libera detentor vivo; aposentadoria não apaga reservas nem repete trabalho.

**Quality Standards:** SQLite/FS e testemunha Python reais; processos sintéticos próprios; mutações com controles positivos; erros nunca mascarados como aquisição.

**Completeness Criteria:** duas instâncias/processos, disputa, async/reentrância, guardas de path/inode, vida/close, owner ausente/retired, reservas conservadas, rollback e crash nas fronteiras de registro/aposentadoria.

**Definition of Done:** implementação, contrato e provas alinhados; typechecks e todos workflows do head final aprovados; logs conferidos, árvore integrada comparada, #5 atualizada sem encerrar WP-02.

**Invariants:** lock nunca é TTL; handle não é dado serializável; não apagar arquivo de lock; callback antigo não readquire autoridade; não inferir parada remota; sem dados pessoais, inferência ou release.

## Decisões ainda a provar na implementação

A publicação do anchor deve ser transacional, com disputa de inicializadores, crash antes/depois de commit e recusa de inode substituído entre chamadas. initialize não pode redefinir um anchor já persistido; open não pode criar o recurso faltante. Movimentar/copiar o banco para outro filesystem não preserva a identidade do workspace vivo: exige fluxo separado autorizado, não adoção silenciosa dos dev/ino novos.

O owner criado por O_EXCL deve conservar o mesmo descritor até a aposentadoria; criação, aquisição, fsync e publicação precisam de cleanup explícito em toda falha. A observação de disponibilidade fica dentro da seção e do lock do owner até o commit. Não emitir um booleano persistível como permissão futura de cleanup.

close revoga só a instância do gerenciador. Não confirma término de tarefas assíncronas, subprocessos ou chamadas do provider. A associação owner/fence/attempt e a prova de encerramento do supervisor ainda precisam de implementação e testes próprios antes de alterar quarentenas existentes. Este corte não propõe um método que libere jobs a partir de lock disponível.

## Observações executáveis da base

tests/coordination/owner-boundaries.test.mjs usa a ponte integrada e SQLite reais, sem gerenciador simulado. Demonstra três fatos: caminho substituído pode criar outro lock enquanto o original continua detido; registro active não se atualiza ao fechar fd; filho pode responder a mensagem depois de liberar o lock. São limites conhecidos da primitiva, NÃO vulnerabilidades novas, correções do gerenciador ou homologação de liveness.

## Continuação D2

A camada interna de recursos foi implementada conforme [SPEC-17](../../../specs/v0.1/17-lock-resources.md). WorkspaceCoordinator e suas operações acima continuam propostas: não foram gravadas. Guardas locais de recurso não substituem o anchor e as transações descritas neste desenho.

## Continuação D3

O desenho acima conserva o estado da proposta original. A implementação foi acrescentada em `packages/storage/src/workspace-coordinator.ts`, refinada por [SPEC-18](../../../specs/v0.1/18-workspace-coordinator.md). O coordenador persiste anchors/owners e aposenta somente participantes de storage sem reservas; não conecta locks a jobs nem certifica parada de execução.
