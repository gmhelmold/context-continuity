# Context Continuity

**Continuous Self-Compaction & Context Management para sessões longas de agentes.**

Produto standalone, com núcleo independente e integrações nativas por harness. OpenCode upstream é a integração de referência; o produto não exige HuGR-Orchestra, Atlas, Maestro ou um fork do host.

> **Estado: desenho formal, em revisão.** Este repositório ainda não contém implementação, pacote instalável ou integração homologada. Os recursos abaixo descrevem o produto proposto, não funcionalidades disponíveis.

## A ideia

Manter a memória de trabalho útil durante sessões longas de orquestração. Ao atingir aproximadamente **50% da janela configurada**, com antecipação por orçamento, um fork auxiliar prepara uma compactação conservadora. A sessão principal continua; o resultado entra entre chamadas e preserva o que chegou durante a manutenção.

O material retirado vira um capítulo consultável, com referências aos registros originais. Âncoras preservam compromissos importantes; blocos curados fornecem contexto por escopo; recuperações do ledger informam a próxima poda.

O objetivo é prolongar a continuidade e reduzir intervenção corretiva. Não prometer memória perfeita, eliminação de alucinações ou economia antes de medir.

## Arquitetura proposta

**Núcleo comum + adaptadores nativos + ledger local portável.**

O núcleo administra política, capítulos, âncoras e feedback. Cada adaptador liga isso à captura do contexto, à execução auxiliar autorizada e à publicação segura no host. MCP pode oferecer consulta, mas não substitui uma interface de edição do contexto ativo.

Integrações devem declarar o que realmente suportam: compactação completa, continuidade assistida ou indisponibilidade. Instalar um pacote não comprova que o host permite remover mensagens ou reproduzir um fork compatível com cache.

| Alvo | Papel planejado | Estado |
|---|---|---|
| OpenCode upstream | Primeira integração completa, via plugin público | Não implementado / não homologado |
| Gemini CLI | Segundo adaptador para provar portabilidade | Não implementado / não homologado |
| Claude Code | Integração nativa a investigar | Alvo, sem suporte anunciado |
| Codex | Integração nativa a investigar | Alvo, sem suporte anunciado |
| Antigravity | Integração nativa a investigar | Alvo, sem suporte anunciado |

Compatibilidade com modelos e com harnesses são eixos diferentes. Não há pacote universal ou comando de instalação publicado nesta fase.

## Documentação canônica

- [RFC-CSC-001 v0.2 — desenho standalone](docs/designs/continuous-self-compaction/RFC-001.md)
- [Migração e proveniência](docs/MIGRATION.md)
- [RFC v0.1 original — histórico, não normativa](docs/history/RFC-CSC-001-v0.1.md)
- [Regras de trabalho no repositório](AGENTS.md)

## Próxima etapa

**[Revisão adversarial do desenho standalone — issue #1](https://github.com/gmhelmold/context-continuity/issues/1) → especificação executável → work packages → implementação → demonstração integrada.**

O primeiro incremento precisa provar um ciclo completo no OpenCode upstream, sem patch: fork isolado, poda, mensagens concorrentes preservadas, âncora intacta e recuperação do original. Um segundo adaptador deverá demonstrar que o núcleo não ficou acoplado ao primeiro host.

A origem do trabalho é o [PR #54 do HuGR-Orchestra](https://github.com/gmhelmold/HuGR-Orchestra/pull/54). Este repositório é a nova origem canônica do produto, não um fork do monorepo. Publicar documentação em `main` não significa aprovar o desenho.
