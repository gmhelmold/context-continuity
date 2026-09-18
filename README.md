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

## Núcleo em implementação

[WP-01/A — configuração e capacidades](docs/implementation/WP-01-A.md): módulos TypeScript puros em `packages/core/src`, validação estrita e decisão de modo sem fallback silencioso. `npm ci --ignore-scripts` prepara o tooling; `npm run check:core` e `npm run test:core` verificam a implementação. Dois subcasos do WP-01 estão cobertos; o pacote completo e a homologação do host permanecem abertos.

[WP-01/B — identidades e catálogo de raízes](docs/implementation/WP-01-B.md): Scope/encarnação/epoch, hashes de fonte e payload, revisão monotônica e mapa imutável exportável. T07.contract acrescentado ao núcleo; restante de WP-01 segue rastreado, sem afirmar que o ledger ou o plugin estão prontos.

**WP-01/C:** [manifestos, propostas e captura final](docs/implementation/WP-01-C.md) acrescenta verificação de fontes/ranges, propostas vinculadas ao manifesto e selagem do corpo JSON final com dois formatos sintéticos. Não habilita um provider real nem conclui o WP-01 inteiro.

[Consistência de snapshots do WP-01/C](docs/implementation/WP-01-C-SNAPSHOT.md): referências repetidas usam um único material por versão durante a verificação; regressões adicionais não substituem a homologação do produto.
