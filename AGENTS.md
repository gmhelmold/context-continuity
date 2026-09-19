# Regras do repositório

## Produto e escopo

Context Continuity é standalone. Não importar internals de HuGR-Orchestra, Atlas, Maestro ou bancos privados de hosts. OpenCode upstream é a integração de referência, não uma dependência do núcleo.

Etapa atual: especificação 0.1.2 e sondas executáveis isoladas. Ainda não existe core de produto completo ou pacote publicado. A implementação deve seguir os work packages; não criar releases ou compatibilidades fictícias para aparentar progresso.

## Fontes de verdade

Entrada normativa para implementação: `specs/v0.1/README.md` e os contratos referenciados. O desenho de origem está em `docs/designs/continuous-self-compaction/RFC-001.md`. Contratos explícitos da especificação refinam exemplos e decisões abertas do RFC; divergências novas devem ser corrigidas antes do código afetado.

`docs/reviews/REVIEW-001.md` é revisão estática do autor, não auditoria independente. `docs/history/RFC-CSC-001-v0.1.md` é snapshot histórico byte a byte: não editar ou formatar. Origem e hashes estão em `docs/MIGRATION.md`.

Distinguir decisão normativa, evidência estática, teste executado e hipótese. Registrar host/versão/commit, rota/modelo/variante/transporte/auth type quando houver homologação. O gate G-OC-01 tem provas incrementais; não está homologado integralmente.

## Engenharia

Preferir o menor ciclo vertical verificável. Sem serviço distribuído, banco vetorial ou gateway obrigatório sem necessidade demonstrada. Reusar a lógica do núcleo entre adaptadores. Uma integração parcial não pode ser apresentada como compactação completa.

Não editar transcripts em uso ou arquivos internos dos hosts para contornar ausência de API pública. Não extrair credenciais nem presumir que assinaturas autorizem qualquer rota auxiliar. Isolar sessões e projetos; não versionar históricos reais, tokens, `.env` ou bancos de usuários.

Validar cobertura do snapshot, preservação da cauda, integridade do protocolo e desativação segura. O clone não despacha ferramentas do projeto. MCP de consulta não equivale a controle de contexto. Cache não é garantia de fidelidade semântica nem de menor custo total.

## Revisão e entrega

Commits e títulos de PR seguem `type(scope): resumo`. Branches curtas com hífens, sem prefixos com barra. Alterações documentais mantêm referências resolvíveis e estado da entrega explícito.

Cada work package contém Success Criteria, Quality Standards, Completeness Criteria, Definition of Done e Invariants, além de dependências e evidências. Usar traceability.json, R01–R36 e os 55 subcasos de T01–T40; não marcar teste como concluído porque seu arquivo existe.

Validações offline: `python3 scripts/check-spec.py`, `python3 scripts/check-reference-model.py` e `python3 scripts/test-spec-check.py`, a partir da raiz. Verificam documentos, DDL e modelos abstratos; não a aplicação nem o host. Os comandos das sondas estão em tests/conformance/opencode/README.md; distinguem componente, host sintético e testes futuros do core.

Chamadas live de inferência e publicação de pacotes exigem orçamento/autorização e perfil definido. Não colocar credenciais de provider em CI de documentação. Não fazer downgrade de modo ou aumentar quotas silenciosamente.

## Revisão 0.1.1

REVIEW-002-RESOLUTION.md registra fechamento contratual B01–B16, não PASS de runtime. SPEC-07 é a autoridade de projeção/controle e SPEC-08 do piloto. ADR-001 distingue o perfil v1 somente-hooks do perfil HTTP local opt-in; não inserir essa rota ou reutilizar assinaturas sem configuração autorizada. Preserve os reviews históricos e o RFC v0.1.

## Sondas de integração

`tests/conformance/opencode` contém somente o ensaio isolado WP-00, não runtime distribuível. Execute pelo comando documentado com binário stock e diretório novo. Não use dados, HOME, configuração ou credenciais pessoais. Provas parciais ficam em docs/conformance; não marcar o gate ou subcasos agregados como PASS sem cobertura completa.

## Revisão 0.1.2

SPEC-09 e as alterações C09–C12 nos contratos são vinculantes. Rodar também check-canonical.py, check-storage-contracts.py e os testes Node dos componentes. O CI de mutações precisa detectar código incorreto; uma campanha sem controle positivo não é evidência. Preserve reviews e resultados históricos, acrescentando corrigendum.

## Núcleo WP-01/A

`packages/core/src` contém os contratos puros iniciais de configuração/capacidades. Rodar `npm ci --ignore-scripts`, `npm run check:core` e `npm run test:core` ao alterá-los. Registro em docs/implementation/WP-01-A.md. A entrada do predicado não é prova de homologação; não concluir WP-01 inteiro pelos dois subcasos atuais. Sem dependências de host ou cópia do algoritmo em testes.

## Núcleo WP-01/B

Identity/roots e o serializador compartilhado estão em packages/core/src; scripts/canonical-json.mjs é fachada, não outra implementação. O catálogo exportável não é storage durável: WP-02 deve persistir mapas/revisões antes de snapshot publicável. Ao alterar, executar também as mutações do núcleo e preservar os hashes de dependências compartilhadas no relatório da sonda. Estado em docs/implementation/WP-01-B.md; não concluir WP-01 pelos subcasos parciais.

## Núcleo WP-01/C

Manifest/proposal/frame seguem SPEC-10. Forma válida não equivale a fonte verificada ou autorização de dispatch. Preservar testes de associação de sessão/manifesto e a campanha com controle positivo e cinco mutantes. Fonte/captura deserializada precisa de nova verificação; não restaurar WeakSet/WeakMap como prova de homologação. Registro em docs/implementation/WP-01-C.md.

## Perfis terminais após REVIEW-004

SPEC-11 é obrigatório: sealFrame/assertFrameUnchanged recebem perfil explícito; não reconstruir aliases/limites por nome. Cada codec valida seus grupos indivisíveis. Execute também test-witness.py; a campanha stock agora exige controle mais oito mutantes, incluindo pré-ingresso. D02/D03 continuam abertos em #21; não os marcar resolvidos pela integração das correções D01/D04/D05.

## Encerramento D02/D03 da sonda

Ao alterar gateway/captures, executar também `node --test tests/conformance/opencode/test-review004.mjs`. Não remover as barreiras de cancelamento nem usar retry para mascarar falhas de reinício. REVIEW-004-RESOLUTION.md distingue a admissão em bytes da fixture do orçamento/publicação transacional do produto. O estado anterior de D02/D03 acima é histórico; o fechamento remoto está registrado em #21/#23.

## Núcleo WP-01/D

SPEC-12 define SnapshotRecord/JobContext/JobProposal. Parsers e handles não são autorização de dispatch, prova de contiguidade ou durabilidade. O executor captura JobContextRef antes da chamada e usa o lote de feedback congelado; nunca deriva a expectativa da resposta do modelo. Restore exige revalidação, não reenvio automático. Rodar testes job-context e campanha negativa junto de todo npm run test:core. Registro/limites em docs/implementation/WP-01-D.md.

## Fundação WP-02/A

Storage é separado do core e segue SPEC-13. Rodar check:storage/test:storage com os pins existentes, além dos gates anteriores. DDL executável deve coincidir com SPEC-03; alterações futuras exigem migração explícita. Usar exclusivamente diretórios sintéticos privados nos testes. Lease SQLite não substitui o lock de workspace de blobs/GC. Não encerrar WP-02 por esta fundação.

## Retenção inline WP-02/B

SPEC-14 limita retainRoots a fontes inline e observações explícitas. Rodar testes de retenção, processos e campanha negativa junto à matriz completa de storage. Reusar RootIdentityRegistry; não inferir cronologia da ordem canônica do catálogo. Nenhum resultado de retenção autoriza compactação, publicação, remoção ou bypass de tombstones/fence. Blobs e invalidação de derivados mantêm seus gates próprios.

## Limite de verificação da retenção (#28)

SPEC-14 distingue RootCatalog estrutural retornado por retainRoots de verificação dos bytes. Preservar leitura integral em readSource/readRoot/readRootCatalog, metadados atuais no índice e budget antes do BLOB. O chamador incremental reutiliza o digest retornado, não dispara auditoria integral a cada lote. Rodar retention-budget e suas mutações com toda a matriz; nenhum cache sobrevive à transação. Registro em docs/implementation/WP-02-B-VERIFICATION-BUDGET.md.

## Persistência de eventos WP-02/C

SPEC-15 e docs/implementation/WP-02-C.md distinguem persistência de eventos de permissão de transporte. Rodar jobs/job-processes/job-mutations com toda a matriz de storage. Preservar regressões J01–J05 e campanha negativa; não integrar enquanto houver teste vermelho. Parser de diagnóstico retorna apenas dados imutáveis, nunca handle verificado. Recovery não usa TTL como prova de parada e não emite rede; liveness cross-owner, blocos/chapters/recibos e publicação mantêm seus gates próprios.

## Primitiva de locks WP-02/D

SPEC-16 limita a ponte nativa a descritores autorizados. Rodar build:locks/test:coordination e os gates prévios; nunca tratar ausência de lock como prova de morte sem protocolo do owner. Não importar a primitiva em core/SQLite antes do gerenciador de identidade/lifetime; não emitir permissões de rede. Não versionar build/locks.node.

## Fronteiras do futuro gerenciador de owners

O desenho de origem em docs/designs/storage/WORKSPACE-COORDINATOR.md foi refinado por SPEC-18; as observações de fronteira não são a implementação. owner-boundaries.test.mjs demonstra limites da primitiva atual; não usar seus três casos para homologar owner/liveness. Preservar distinção entre lock, identidade persistida e execução/supervisor. Não liberar jobs por TTL ou lock disponível. Registro em docs/implementation/WP-02-D-OWNER-BOUNDARIES.md.

## Recursos privados WP-02/D2

SPEC-17 rege lock-resources.ts, ainda separado de SQLite e jobs. Rodar coordination e resource-mutations além dos gates anteriores. Parent close revoga todos os filhos; não expor fd nem usar novo open como prova de identidade durável. D2 não inclui o coordenador transacional; sua implementação D3 segue SPEC-18 e não conecta automaticamente locks aos jobs.

## Coordenador WP-02/D3

SPEC-18 rege workspace-coordinator.ts. Rodar coordination/coordinator-processes/coordinator-mutations com a matriz anterior. Anchor deve impedir nova instância de adotar inode substituído; só publicar owner com lock detido; holds expiram em finally. Rollback falho inutiliza a conexão. Não usar retirement como prova de término de job nem remover reservas por disponibilidade de lock.
