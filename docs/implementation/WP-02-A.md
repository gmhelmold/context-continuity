# WP-02/A — SQLite, sessões atômicas e proprietário com fencing

**Base:** `018eafb0ab4a9e4dab9b35329dae7f1068a09b6f`, após fechamento contratual do WP-01. Continua a issue #5. Contrato: [SPEC-13](../../specs/v0.1/13-storage-foundation.md). Este é um incremento do storage, não o encerramento de WP-02 nem um plugin distribuível.

## Implementação

`packages/storage/src` contém um adaptador isolado de SQLite e uma API de sessões. Usa o SQLite embutido do Node nas duas versões já fixadas; nenhuma dependência foi acrescentada. O DDL é o de SPEC-03, com um teste de igualdade byte a byte. Existir uma tabela NÃO significa que sua operação de produto esteja implementada.

Inicialização é explícita e exclusiva. Abertura não cria banco/sessão ausente, não sobrescreve banco alheio e recusa schema/identidade divergentes. O diretório deve ser fornecido pela integração como local/privado; só POSIX está no perfil inicial. Dados são exercitados somente em diretórios sintéticos dos testes. Arquivo parcial de bootstrap exige diagnóstico explícito; não há reparo por palpite ou remoção de arquivos desconhecidos.

Session, View0 e configuração são gravados juntos. Falha no segundo INSERT reverte inclusive o avanço do relógio persistido. Repetir inicialização idêntica não reseta lease/revisões; configuração conflitante falha. Modo inicial unsupported não se transforma em complete pelo requested_mode. Leituras verificam a View indicada e devolvem objetos profundamente imutáveis.

Lease é serializado com BEGIN IMMEDIATE: proprietário por conexão, prazo de 30s, renovação explícita, CAS e fence crescente. Reinício não herda owner_id nem reenvia trabalho. O timestamp máximo confirmado detecta regressão de relógio; expiração/takeover torna o owner anterior incapaz de renovar ou liberar o novo. Isto é lease de sessão; NÃO é o lock de arquivos de workspace necessário para blobs/GC.

## Revisão do autor

Conferidos: separação create/open, PRAGMAs lidos de volta, referências de escopo/incarnation/epoch, nenhuma query pública arbitrária, parâmetros vinculados, rollback, clock/fence sem wraparound, read sem criação, bootstrap com sidecar órfão e identidade pública imutável. A revisão acrescentou recusa de sidecars preexistentes antes de inicializar, evitando reaproveitar journal antigo por conveniência. Não há tentativa de detectar todo filesystem remoto ou autenticar código hostil do mesmo usuário.

Os testes exercitam o driver real, não um mapa que imita SQLite. Há trigger de falha na fixture para comprovar rollback dos dois registros; disputa entre dois processos; processo novo lendo a sessão; interrupção do processo de teste antes do commit, seguida de recuperação sem linhas parciais. Não são simulações de queda elétrica nem certificação de hardware.

Campanha negativa separada cria cópias descartáveis: controle correto e quatro variantes incorretas (incarnation ignorada, outro proprietário aceito, rollback que confirma alterações e identidade pública mutável). Precisa concluir todos os 29 testes selecionados e reprovar no teste nomeado; falha de setup/timeout não conta como detecção. Execuções-filhas não multiplicam a contagem de aceitação.

Um teste adicional falhou na revisão antes do fix: a API aceitava configuração resolvida incompleta, e a leitura poderia repor defaults em um registro danificado. Agora a representação validada precisa coincidir integralmente com o registro fornecido; ausência de campo não é um pedido para restaurar defaults. O mesmo teste exige E_SCHEMA na entrada e E_STORAGE no dado persistido inválido.

## Evidência e comandos

O primeiro controle local aprovou 23 testes. Após revisão, diagnóstico de conexão e casos adicionais, a suíte é de 30 testes: 29 de comportamento e uma campanha de mutações. Resultados definitivos, versões e hashes são registrados em `evidence/WP-02-A.json` e no PR; só PASS efetivamente observado pode ser publicado. Nenhum teste agregado de WP-02 foi promovido pelo número de testes deste incremento.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check:core
npm run test:core
npm run check:storage
npm run test:storage
node --test tests/conformance/opencode/test-components.mjs tests/conformance/opencode/test-review004.mjs
python3 tests/conformance/opencode/test-witness.py
python3 scripts/check-spec.py
python3 scripts/check-reference-model.py
python3 scripts/test-spec-check.py
python3 scripts/check-canonical.py
python3 scripts/check-storage-contracts.py
```

O novo workflow executa storage em Node 22.17.1 e 24.0.0 com TypeScript 5.9.3 e tipos fixados. Os cinco workflows anteriores permanecem obrigatórios. Antes de integrar: conferir os seis workflows/oito jobs, logs do head exato, árvore de merge e working tree. Não usar resultado histórico do host para substituir a regressão remota deste PR.

Uma execução local paralela do núcleo terminou 195/196: o controle positivo da campanha existente de identidades expirou em spawnSync. Não foi contado como sucesso/detecção. A repetição local sequencial passou 196/196, sem alterar timeouts, assertions ou o comando padrão do CI. Componentes da sonda 25/25, testemunha 4/4, typechecks e checks offline também passaram. Resultados finais ficam no PR do head testado.

O primeiro CI do head 0465478 encontrou um teste excessivamente específico: havia um único vencedor, mas o concorrente não retornou E_OWNER. O resultado original não registrava o motivo completo, portanto não foi tratado como diagnóstico conclusivo de SQLite BUSY. A implementação agora classifica exclusivamente os códigos nativos BUSY/LOCKED como E_STORAGE/database busy. O ensaio exige um vencedor exato, somente E_OWNER ou essa contenção tipada para o perdedor e uma nova conexão que confirme E_OWNER após os filhos terminarem. Qualquer outro erro continua reprovando; não houve aumento de timeout nem retry automático. Um teste com transação realmente retida comprova a classificação de BUSY e ausência de escrita parcial.

## Critérios e limites deste incremento

**Success Criteria:** estado de sessão sobrevive à reabertura, inicialização não expõe metade do par Session/View0 e somente um proprietário vence a disputa testada.

**Quality Standards:** SQLite/FS e processos reais, testes negativos independentes, SQL parametrizado, erros sem conteúdo privado, sem dependência nova ou downgrade silencioso de sincronização.

**Completeness Criteria:** API de inicialização/leitura/acquire/renew/release/close, validação de schema/escopo, recuperação antes de commit e todos os testes associados. Não inclui CRUD de entidades além da sessão, backup/migração v1→v2 ou remoção de usuário.

**Definition of Done:** código/contrato/documentação/evidência versionados; matriz aprovada no head final e logs conferidos. Issue #5 permanece aberta para root map/fontes duráveis, jobs/attempts, lock/reservas/quota/blobs/GC, publicação e arquivos portáveis.

**Invariants:** nenhuma recriação por leitura; nenhuma sobrescrita de banco existente; Session/View0 atômicos; owner antigo não substitui owner novo; fonte/histórico de usuário nunca usado em teste; nenhum PASS de provider, cache ou qualidade semântica inferido de SQLite.

T03.storage e T12.storage recebem parcelas executadas, mas continuam incompletos nos seus escopos agregados. T19.storage/T32.archive/T38.archive ainda exigem suas implementações. O próximo corte deve persistir as identidades e fontes com as mesmas fronteiras, antes de admitir jobs ou publicar capítulos.

## Revisão de integração e alternativa local

A [reconciliação de integração](WP-02-A-INTEGRATION.md) registra a disposição do ZIP local anterior e nove regressões adicionais de schema/commit. O total histórico acima é preservado; os resultados finais pertencem ao head efetivamente testado no PR #25.
