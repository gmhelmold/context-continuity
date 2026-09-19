# Context Continuity

**Continuous Self-Compaction & Context Management para sessões longas de agentes.**

Produto standalone: núcleo comum, ledger local e integrações nativas por harness. Não depende de HuGR-Orchestra, Atlas ou Maestro.

> **Estado: especificação 0.1.2, sondas e primeiros contratos do núcleo.** Sem plugin distribuível, integração integralmente homologada ou benchmark. A verificação documental e os modelos de referência NÃO executam o produto.

## Método

Compactação preventiva perto de 50% da janela configurada, com reservas. Um fork lógico do contexto efetivo prepara a síntese sem interromper o trabalho normal; adoção ocorre entre chamadas. Fontes tornam-se capítulos recuperáveis, âncoras persistem fora dos resumos e recuperações informam a manutenção seguinte.

A meta é continuidade por mais tempo, não memória perfeita ou economia automática.

## Compatibilidade planejada

| Perfil | Posição atual |
|---|---|
| OpenCode v1.18.31 somente hooks | Não oferece complete pelo contrato escolhido; assisted a verificar. |
| OpenCode v1.18.31 + HTTP local opt-in | Primeiro perfil completo de ensaio, não implementado/homologado. |
| Gemini CLI | Segundo adaptador para provar portabilidade, ainda não homologado. |
| Claude Code, Codex, Antigravity | Alvos a verificar, sem suporte anunciado. |

A rota HTTP local é específica do primeiro perfil v1, configurada por baseURL público e conexão explicitamente autorizada. Não é gateway obrigatório para o núcleo/todos os hosts e não reaproveita assinatura OAuth por extração de credenciais. Justificativa: [ADR-001](docs/decisions/ADR-001-terminal-boundary.md).

## Entrada para implementação

[Especificação 0.1.2](specs/v0.1/README.md), [aceitação](specs/v0.1/06-acceptance.md) e [work packages](specs/v0.1/WORK-PACKAGES.md). São 36 requisitos, 40 famílias, 55 subcasos e oito pacotes. Cada pacote tem seus cinco axiomas e apenas provas compatíveis com suas dependências.

A [REVIEW-002](docs/reviews/REVIEW-002.md) preserva os 16 achados no commit auditado. A [resolução](docs/reviews/REVIEW-002-RESOLUTION.md) mapeia cada correção, sem converter decisão de desenho em suporte comprovado.

## Validação de documentos e modelos de contrato

```sh
python3 scripts/check-spec.py
python3 scripts/check-reference-model.py
python3 scripts/test-spec-check.py
```

CI verifica links inclusive fragmentos, rastreabilidade recíproca, dependências, DDL de referência e modelos abstratos; rejeita mutações documentais dirigidas. Não prova comportamento de modelo, cache ou instalação do plugin. Estados iniciais do plano permanecem not_run; resultados executados são registrados por incremento, sem promover os demais casos.

## Histórico

[RFC standalone](docs/designs/continuous-self-compaction/RFC-001.md), [migração](docs/MIGRATION.md), [RFC original intacto](docs/history/RFC-CSC-001-v0.1.md), [regras de trabalho](AGENTS.md).

Próximo gate: revisar estes contratos e executar a prova pública WP-00; implementar núcleo por pacotes sem anunciar suporte antes da demonstração integrada. Publicação de documentos não é publicação do produto.

## Prova de integração em andamento

[WP-00: sonda executável com OpenCode stock](docs/conformance/OPENCODE-WP00.md). Dez checks locais aprovados com provider sintético e fonte/hash do binário registrados. É uma prova parcial das interfaces, não release, core implementado ou autorização de modo completo. A issue #3 permanece aberta.

**Continuidade da prova WP-00:** a [extensão de consolidações e reinício](docs/conformance/OPENCODE-WP00-CONTINUITY.md) exercita 14 checks em OpenCode stock com provider sintético. Não é release de plugin nem aprovação integral do gate.

## Correções da revisão integrada

[REVIEW-003 — resolução](docs/reviews/REVIEW-003-RESOLUTION.md) registra C01–C12 e seus limites de prova. O oráculo agora confronta conteúdo retido completo com ingress e recorder independentes; uma campanha com controle positivo deve rejeitar seis implementações deliberadamente incorretas. O codec textual recusa mídia/partes desconhecidas.

A sonda atual tem 16 checks de host e 12 testes de componentes, incluindo regra já publicada, resumo vazio, retenção limitada de captures, streams nativos interrompidos e transporte com cancelamento/backpressure. Essas quantidades não são os 55 subcasos do produto; core completo, ledger distribuível, inferência live e gate completo continuam pendentes. Comandos em [tests/conformance/opencode](tests/conformance/opencode/README.md).

## Núcleo: contratos implementados por incremento

[WP-01/A — configuração e capacidades](docs/implementation/WP-01-A.md): módulos TypeScript puros em `packages/core/src`, validação estrita e decisão de modo sem fallback silencioso. `npm ci --ignore-scripts` prepara o tooling; `npm run check:core` e `npm run test:core` verificam a implementação. Dois subcasos do WP-01 estão cobertos; o pacote completo e a homologação do host permanecem abertos.

[WP-01/B — identidades e catálogo de raízes](docs/implementation/WP-01-B.md): Scope/encarnação/epoch, hashes de fonte e payload, revisão monotônica e mapa imutável exportável. T07.contract acrescentado ao núcleo; restante de WP-01 segue rastreado, sem afirmar que o ledger ou o plugin estão prontos.

**WP-01/C:** [manifestos, propostas e captura final](docs/implementation/WP-01-C.md) acrescenta verificação de fontes/ranges, propostas vinculadas ao manifesto e selagem do corpo JSON final com dois formatos sintéticos. Não habilita um provider real nem conclui o WP-01 inteiro.

[Consistência de snapshots do WP-01/C](docs/implementation/WP-01-C-SNAPSHOT.md): referências repetidas usam um único material por versão durante a verificação; regressões adicionais não substituem a homologação do produto.

## REVIEW-004: correções em partes

[Resolução parcial D01/D04/D05](docs/reviews/REVIEW-004-PARTIAL-RESOLUTION.md): ingresso testemunhado fora do gateway e perfil terminal versionado de modelo/protocolo. D02/D03 e o vínculo completo de job/Snapshot continuam rastreados, sem declaração de correção ou homologação integral.

**Continuação D02/D03:** [resolução da REVIEW-004](docs/reviews/REVIEW-004-RESOLUTION.md) e 13 regressões de cancelamento/recuperação em `test-review004.mjs`. Estas provas de sonda não concluem o plugin, o ledger ou o vínculo de job/Snapshot do WP-01.

## WP-01/D — vínculo de geração

[Snapshot e JobContext](docs/implementation/WP-01-D.md) fecham a associação contratual entre geração, frame identificado, manifesto, missão e feedback. Dois jobs não podem compartilhar uma resposta só porque usam o mesmo manifesto. Registros são exportáveis; reabrir exige revalidação e não dispara inferência. O encerramento do WP-01 é de contratos/componentes; renderer, ledger transacional, scheduler e adaptadores mantêm seus gates próprios.

## Ledger em implementação

[WP-02/A — SQLite e sessões](docs/implementation/WP-02-A.md): inicialização exclusiva, Session/View0 atômicos, reabertura e leases com fencing. `npm run check:storage` / `npm run test:storage` usam SQLite e FS reais. É a fundação transacional; blobs, jobs, publicação, migrações/backups e arquivo portátil continuam no WP-02. Não habilita modo complete ou instalação do produto.


**Coerência de abertura SQLite:** [inspeção em snapshot único](docs/implementation/WP-02-A-INSPECTION.md), sem confundir transação de leitura com persistência de conteúdo já implementada.

**WP-02/B — retenção inline:** [fontes e raízes duráveis](docs/implementation/WP-02-B.md) liga os bytes originais a revisões persistidas, com proprietário validado e transação única. Não é captura automática do host, armazenamento de blobs ou publicação de capítulos.

**Retenção incremental:** [limite de verificação por operação](docs/implementation/WP-02-B-VERIFICATION-BUDGET.md) separa catálogo estrutural de auditoria integral, sem cache persistente de confiança.

**Jobs duráveis:** [WP-02/C](docs/implementation/WP-02-C.md) registra admissão, tentativas, resultados e recuperação explícita sem replay. Perfil inicial: raízes/fontes inline. Não publica View, não emite permit de rede e não libera quarentena cross-owner sem prova de liveness.

**Locks de SO — primeiro corte:** [primitiva nativa isolada](docs/implementation/WP-02-D-LOCK-PRIMITIVE.md). Build e testes explícitos; ainda não é gerenciador de workspace/liveness nem liberação de jobs.

O [desenho de origem do gerenciador de owners](docs/designs/storage/WORKSPACE-COORDINATOR.md) foi refinado pela SPEC-18. As [observações de fronteira](docs/implementation/WP-02-D-OWNER-BOUNDARIES.md) testam a ponte existente, sem homologar recuperação de jobs.

Recursos privados de lock: [WP-02/D2](docs/implementation/WP-02-D-LOCK-RESOURCES.md). A camada de filesystem é distinta do registro transacional de owners acrescentado no WP-02/D3.

O incremento WP-02/D3 acrescenta coordenação transacional de anchors e participantes de storage, conforme [SPEC-18](specs/v0.1/18-workspace-coordinator.md). A seção síncrona e o registro de owners não autorizam limpeza de reservas ou liberação de jobs em quarentena.

**WP-02/D4 — supervisão local de tentativa:** [associação, término e recuperação anterior à invocação](docs/implementation/WP-02-D-ATTEMPT-SUPERVISOR.md). As regressões de S01/S02 exigem observação de Promise e reconciliação com autoridade vigente. Não libera execuções de outros processos nem homologa transporte; o gate do head final está registrado no PR #36.

**Pins inline de leitura/exportação:** [WP-02/E1](docs/implementation/WP-02-E-SOURCE-PINS.md) implementa o registro durável, não readers, staging ou coleta de lixo. O aceite depende do CI do incremento; não há nova release.
