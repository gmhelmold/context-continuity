# SPEC-16 — primitiva nativa de locks (WP-02/D, primeiro corte)

Adendo de implementação de SPEC-03. Este corte fornece somente a ponte Node-API para locks consultivos do kernel em descritores já abertos. NÃO implementa o gerenciador de workspace, registro de storage_owners, reconciliação de reservas ou liberação de jobs em quarentena. Não é API de ferramenta/modelo.

## Fronteira nativa

`packages/storage/native/locks.c` usa Node-API 8 e chamadas POSIX, sem V8, libuv, biblioteca externa ou subprocesso. A ponte não abre, cria, remove ou resolve caminhos. O chamador autorizado é dono do descritor, de sua identidade e de seu fechamento.

`localProfile(fd)` consulta o filesystem do descritor. Darwin exige MNT_LOCAL; Linux aceita explicitamente ext-family, XFS, Btrfs, tmpfs e overlayfs. Tipo desconhecido retorna false; erro de inspeção é E_CAPABILITY. Isso é classificação de capacidade, não certificação de todas as combinações de filesystem, hardware e driver. O consumidor futuro precisa exigir essa classificação ANTES de habilitar sua política de locks.

`tryLock(fd)` exige descritor numérico inteiro válido, arquivo regular, proprietário atual, modo exato 0600 e um link. Ativa FD_CLOEXEC e tenta `flock(LOCK_EX | LOCK_NB)` uma vez. Sucesso é true; EWOULDBLOCK/EAGAIN é false; outros erros são E_CAPABILITY sanitizado. Não espera, não tenta repetidamente, não considera idade, PID ou TTL. Valores NaN/infinito/fracionários são recusados antes de conversão para inteiro C.

`unlock(fd)` libera o lock do descritor. Não fecha o descritor e não desvincula o arquivo. O chamador continua responsável por close e por impedir uso posterior/reutilização do número do descritor. A ponte não emite handles opacos nem permissões de despacho.

## Limites de autoridade

Flock é consultivo: processos que ignoram o protocolo ainda podem modificar arquivos. Não há proteção contra código hostil do mesmo usuário. A identidade do caminho, symlinks, substituição de inode e diretórios privados pertencem ao gerenciador que ainda falta; fstat do descritor não prova que o caminho esperado continua apontando para ele.

Dois opens independentes conflitam; repetir flock no MESMO descritor pode ter sucesso. Portanto esse sucesso não cria uma segunda aquisição nem uma permissão reutilizável. Descritores duplicados compartilham o lock. O gerenciador futuro precisa controlar duplicação, herança, tempo de vida e identidade das aquisições.

Um lock livre significa ausência de detentor naquela identidade, não prova isolada de morte de um processo. Fechamento voluntário também libera o lock. A reconciliação só poderá concluir parada ao ligar a identidade persistida ao protocolo de vida inteiro do proprietário. Não substituir isso por PID, relógio ou teste de existência do arquivo. A relação com job/fence ainda não foi implementada.

## Build explícito

`npm run build:locks` exige compilador C e headers da versão EXATA de Node selecionada. Não baixa arquivos, não roda shell e não adiciona install/postinstall ou compilação no runtime. CC e CC_NODE_INCLUDE são opções locais de build do desenvolvedor. Resultado em packages/storage/native/build/locks.node, ignorado pelo Git e nunca publicado por este incremento.

O build usa warnings como erros e publica o binário local por rename após sucesso. Falha de build não deve ser tratada como aprovação dos testes. O núcleo e SqliteSessionStore não importam essa ponte neste corte; os comandos anteriores continuam sem requisito de compilação nativa. Distribuição de prebuilds/instalador e compatibilidade de harnesses têm gates futuros.

## Critérios de conclusão deste corte

**Success Criteria:** testemunha independente observa exclusão real, disputa retorna busy e liberação/encerramento do detentor permite aquisição.

**Quality Standards:** arquivos e processos próprios de fixtures; Python/fcntl como testemunha independente do código nativo; controles corretos e mutantes precisam divergir por assertions, não falha de compilação/timeout.

**Completeness Criteria:** opens independentes, fechamento, desbloqueio, duas identidades, detentor vivo com arquivo antigo, permissões, hardlinks, entradas inválidas e interrupção do processo próprio. Não equivale a gerenciador de owners implementado.

**Definition of Done:** build e 17 testes no Mac Intel e na matriz Linux fixada; demais workflows aprovados no head final, logs conferidos e árvore integrada comparada. WP-02/D completo e #5 permanecem abertos.

**Invariants:** sem TTL como lock; nenhum processo auxiliar em produção; sem release, rede, dados pessoais ou alteração do banco; nenhum resultado de primitiva libera job ou dá autoridade de publicação.

## Fontes primárias

[Node-API da versão fixada](https://nodejs.org/download/release/v22.17.1/docs/api/n-api.html), [flock do Linux](https://man7.org/linux/man-pages/man2/flock.2.html) e [flock da Apple](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/flock.2.html). A estabilidade de Node-API não substitui os testes das plataformas alvo.
