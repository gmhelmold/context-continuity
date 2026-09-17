# Context Continuity

**Continuous Self-Compaction & Context Management para sessões longas de agentes.**

Produto standalone, com núcleo independente e integrações nativas por harness. OpenCode upstream é a integração de referência; o produto não exige HuGR-Orchestra, Atlas, Maestro ou um fork do host.

> **Estado: especificação atômica proposta, em revisão.** Há desenho, revisão adversarial estática e contratos de implementação. Não há plugin implementado, pacote instalável, integração homologada ou benchmark executado. O script de validação documental não é runtime do produto.

## A ideia

Ao atingir aproximadamente **50% da janela configurada**, com antecipação por orçamento, um fork auxiliar prepara uma compactação conservadora. A sessão principal continua; a representação nova entra entre chamadas e preserva o que chegou durante a manutenção.

O material retirado vira capítulo consultável com fontes originais. Âncoras preservam compromissos; blocos curados fornecem contexto por escopo; recuperações do ledger informam a próxima poda. O objetivo é prolongar a continuidade e reduzir intervenção corretiva, não prometer memória perfeita ou economia sem medição.

## Arquitetura

**Núcleo comum + adaptadores nativos + ledger local portável.**

O núcleo administra política, capítulos, âncoras e feedback. Cada adaptador conecta captura do contexto, execução auxiliar autorizada e publicação segura no host. MCP pode oferecer consulta, mas não substitui uma interface de edição do contexto ativo.

Modos: compactação completa, continuidade assistida ou indisponibilidade, conforme capacidades verificadas. Instalação não prova que o host permite retirar mensagens, reproduzir o fork e impedir efeitos do clone ao mesmo tempo.

| Alvo | Papel planejado | Estado |
|---|---|---|
| OpenCode upstream v1.18.31 | Primeiro perfil de prova pública, sem patch | Binding especificado; G-OC-01 não executado |
| Gemini CLI | Segundo adaptador para demonstrar portabilidade | Alvo; versão e integração ainda a verificar |
| Claude Code | Integração nativa a investigar | Sem suporte anunciado |
| Codex | Integração nativa a investigar | Sem suporte anunciado |
| Antigravity | Integração nativa a investigar | Sem suporte anunciado |

Compatibilidade de modelo e de harness são eixos diferentes. Documentação v2 do OpenCode não é confundida com o contrato v1 da release fixada. Não há comando de instalação de produto publicado nesta fase.

## Comece pela especificação

**[SPEC-CC-0.1 — índice normativo](specs/v0.1/README.md)** contém contratos, ciclo de vida, orçamento, schema local, binding OpenCode, tools, âncoras e experiência.

**[Aceitação](specs/v0.1/06-acceptance.md): 36 requisitos, 40 casos de teste especificados.** Cada requisito tem dono e oráculo. Todos os testes de runtime iniciam como `not_run`; documentação de um teste não é evidência de aprovação.

**[Work packages](specs/v0.1/WORK-PACKAGES.md): oito pacotes com dependências e cinco axiomas.** O primeiro é a prova de compatibilidade pública G-OC-01. O núcleo pode avançar contra adaptadores sintéticos; o modo completo não pode ser lançado sem homologação do perfil.

A especificação refina o [RFC-CSC-001 v0.2](docs/designs/continuous-self-compaction/RFC-001.md). Seus contratos explícitos prevalecem sobre exemplos ilustrativos e decisões que o RFC deixou abertas. A [REVIEW-001](docs/reviews/REVIEW-001.md) registra 16 achados e resoluções de desenho; não representa revisão independente ou testes de execução.

## Verificação documental

Executar a partir da raiz:

```sh
python3 scripts/check-spec.py
```

Checa links locais, fences, IDs e rastreabilidade, cinco axiomas por pacote, integridade byte a byte do RFC histórico e sintaxe/constraint de referência do SQLite. Não valida semântica de modelos, desempenho, cache real ou plugin. O workflow `Specification checks` executa somente essa verificação, sem credenciais de provider.

## Histórico e próximos gates

[Migração e proveniência](docs/MIGRATION.md), [RFC v0.1 original](docs/history/RFC-CSC-001-v0.1.md) e [regras do repositório](AGENTS.md).

**Revisão/aceitação da especificação → WP-00 e núcleo → ciclo integrado no OpenCode stock → segundo adaptador/piloto.** A origem do trabalho permanece o [PR #54 do HuGR-Orchestra](https://github.com/gmhelmold/HuGR-Orchestra/pull/54); este repositório é canônico e independente. Publicar documentação não equivale a publicar o produto.
