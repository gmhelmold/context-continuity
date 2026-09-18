# Context Continuity

**Continuous Self-Compaction & Context Management para sessões longas de agentes.**

Produto standalone: núcleo comum, ledger local e integrações nativas por harness. Não depende de HuGR-Orchestra, Atlas ou Maestro.

> **Estado: especificação 0.1.1 proposta, com correções de revisão.** Sem plugin implementado, pacote instalável, integração homologada ou benchmark. A verificação documental e os modelos de referência NÃO executam o produto.

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

[Especificação 0.1.1](specs/v0.1/README.md), [aceitação](specs/v0.1/06-acceptance.md) e [work packages](specs/v0.1/WORK-PACKAGES.md). São 36 requisitos, 40 famílias, 55 subcasos e oito pacotes. Cada pacote tem seus cinco axiomas e apenas provas compatíveis com suas dependências.

A [REVIEW-002](docs/reviews/REVIEW-002.md) preserva os 16 achados no commit auditado. A [resolução](docs/reviews/REVIEW-002-RESOLUTION.md) mapeia cada correção, sem converter decisão de desenho em suporte comprovado.

## Validação de documentos e modelos de contrato

```sh
python3 scripts/check-spec.py
python3 scripts/check-reference-model.py
python3 scripts/test-spec-check.py
```

CI verifica links inclusive fragmentos, rastreabilidade recíproca, dependências, DDL de referência e modelos abstratos; rejeita mutações documentais dirigidas. Não prova comportamento de modelo, cache ou instalação do plugin. Todos os testes de runtime permanecem not_run até execução específica.

## Histórico

[RFC standalone](docs/designs/continuous-self-compaction/RFC-001.md), [migração](docs/MIGRATION.md), [RFC original intacto](docs/history/RFC-CSC-001-v0.1.md), [regras de trabalho](AGENTS.md).

Próximo gate: revisar estes contratos e executar a prova pública WP-00; implementar núcleo por pacotes sem anunciar suporte antes da demonstração integrada. Publicação de documentos não é publicação do produto.

## Prova de integração em andamento

[WP-00: sonda executável com OpenCode stock](docs/conformance/OPENCODE-WP00.md). Dez checks locais aprovados com provider sintético e fonte/hash do binário registrados. É uma prova parcial das interfaces, não release, core implementado ou autorização de modo completo. A issue #3 permanece aberta.

**Continuidade da prova WP-00:** a [extensão de consolidações e reinício](docs/conformance/OPENCODE-WP00-CONTINUITY.md) exercita 14 checks em OpenCode stock com provider sintético. Não é release de plugin nem aprovação integral do gate.
