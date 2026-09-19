# WP-02/D3 — coordenador transacional de recursos

Base `572bdc174b86abc35a5ea849e5e16f19e6a2b2d1`, continuidade da issue #5. Contrato em [SPEC-18](../../specs/v0.1/18-workspace-coordinator.md). Não reaplica LR05: #32 já estava integrado quando esta execução começou. O incremento acrescenta WorkspaceCoordinator, não apenas a ponte de locks ou seus testes.

## Escopo entregue

O banco existente conserva o anchor de identidade dos recursos e os registros dos participantes. initialize verifica a base e publica anchor sob workspace flock e transação; open exige o anchor, cria owner exclusivo, segura seu lock e só então grava registro mais identidade. Os descritores seguem privados no LockResources existente. Não muda DDL, dependências, C, build nativo ou versões fixadas.

A seção síncrona entrega WorkspaceHold local revogável. Workspace/owner e recurso são revalidados; cópia, reuso em seção futura, reentrância, async/generator e thenables não ganham autoridade. O callback não recebe SQL nem fd. O lock de workspace não é o lease de sessão nem um AttemptPermit.

readOwner é diagnóstico. retireOwner inspeciona owner active não bloqueando, exige a identidade persistida e mantém o lock de inspeção até o commit. Qualquer reserva impede aposentadoria automática. close revoga a instância, tenta aposentar e tenta encerrar todos os recursos; erro não ressuscita a instância. Nenhum caminho remove arquivos de lock, reservas ou jobs.

## Provas executadas e revisão do autor

Os primeiros 30 comportamentos passaram. A expansão para 33 comportamentos e oito ensaios de processos passou 41/41: seis fronteiras antes/depois de COMMIT em initialize/register/retire, detentor vivo em processo independente, e inicializadores concorrentes. As barreiras são observadas antes de interromper somente o próprio filho. Um processo novo reabre o SQLite e não reenvia trabalho. Python observa os locks independentemente da ponte em ambos os lados relevantes.

A revisão dirigida encontrou e corrigiu três defeitos do código novo:

| ID | Antes | Correção e prova |
|---|---|---|
| WC01 | Erro de COMMIT seguido de falha de ROLLBACK permitia nova seção na conexão inconsistente. | Conexão é marcada inutilizável e fechamento é tentado; callback posterior não executa. A transação não confirmada não aparece em outra conexão. |
| WC02 | Falha no fechamento final da conexão escapava como erro bruto. | Cleanup agregado/sanitizado tenta recursos e conexão; não expõe detalhe da exceção injetada. |
| WC03 | Uma função async com bind podia executar seu corpo antes de ser recusada pelo retorno Promise. | Exigência do protótipo Function ordinário local, além das verificações de async/generator; o corpo bound não executa. |

WC01/WC02 falharam 0/2 antes e passaram 2/2 após a correção. WC03 falhou antes; os três testes juntos passaram 3/3 no código final. Falhas de armazenamento são injetadas em bases sintéticas, não relatos de problema em dados pessoais ou hardware.

A primeira campanha de mutações não foi aceita: a assertion de um teste estava dentro do callback, e a fronteira sanitizou o erro como E_STORAGE. O teste foi ajustado para observar o resultado dentro e afirmar fora da seção; a regra do produto não foi relaxada. A campanha final exige nove controles corretos e nove implementações erradas rejeitadas pela assertion nomeada. Timeout, erro de build ou falha de carregamento não são detecção.

## Validação

As evidências locais de pré-publicação, comandos e hashes estão em [evidence/WP-02-D-coordinator.json](evidence/WP-02-D-coordinator.json). Logs dos workflows serão vinculados ao head exato do PR. Não atribuir resultados de uma versão anterior ao commit integrado. Nenhuma rodada histórica é somada às contagens atuais.

A primeira matriz local com arquivos de coordenação em paralelo terminou 97/98: um subprocesso da campanha nativa anterior excedeu seu prazo. Não foi contado como detecção. A execução original e os prazos foram preservados; a matriz local foi repetida com arquivos em série, mantendo a concorrência explícita das fixtures. Os comandos dos workflows permanecem inalterados.

## Fronteiras ainda abertas

Este serviço coordena participantes de storage, não o ciclo de execução dos jobs. process_instance é identidade da instância, não PID nem prova de processo morto. Um owner retired não certifica parada de subprocessos, liberação de fd quando houve erro, fim remoto ou autorização de limpeza. A ligação supervisor/fence/attempt e a reconciliação de reservas têm gates separados.

O preflight de initialize inspeciona o banco antes da aquisição do flock; somente a publicação dos metadados do coordenador é transacional sob exclusão. Os métodos existentes de SqliteSessionStore não são retroativamente protegidos por esta classe. Blobs/staging/GC, política de retenção, publicação de View, backup/migração e arquivo portátil não entram neste incremento. Não há inferência, publicação de pacote, adaptação de host ou alteração de configuração pessoal.

## Critérios

**Success Criteria:** identidade persistida impede adoção divergente; owner só é publicado sob lock real; seção e aposentadoria têm ciclo fechado.

**Quality Standards:** SQLite/FS e processos reais, erros injetados identificados, oráculo Python independente, controles negativos, pins intactos.

**Completeness Criteria:** initialize/open, identidades, callback, CAS/rollback, close, concorrência, reservas preservadas e interrupção de processo; limites explícitos.

**Definition of Done:** matriz local registrada com seus limites e sete workflows/dez jobs do head final aprovados, logs conferidos, árvore integrada comparada, issue #5 atualizada; não fecha WP-02 inteiro.

**Invariants:** não expor descritor, não apagar recursos, não usar TTL como exclusão, não liberar quarantine, não reexecutar inferência, não aproveitar teste verde anterior.

A repetição em série atingiu o limite global de 450 segundos do runner durante coordenação e não produziu uma contagem final. Não foi declarada aprovada nem usada como passe de gate. O CI deve executar os mesmos 98 testes completos nas duas versões; seus resultados e logs do head final são registrados no PR e na issue #5.
