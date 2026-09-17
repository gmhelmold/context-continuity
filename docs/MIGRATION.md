# Migração para Context Continuity

Data: 17 de setembro de 2026. Tipo: migração documental, sem implementação ou migração de dados de sessões.

## Origem e destino

| Campo | Valor |
|---|---|
| Origem | `gmhelmold/HuGR-Orchestra` |
| Discussão de origem | [PR #54](https://github.com/gmhelmold/HuGR-Orchestra/pull/54) |
| Branch de origem | `context-continuity-design` |
| Commit do RFC original | `fabc44d6062e7e5e75370dfc56649b901051b6ed` |
| Caminho original | `docs/designs/continuous-self-compaction/RFC-001.md` |
| Destino canônico | [gmhelmold/context-continuity](https://github.com/gmhelmold/context-continuity) |
| Desenho ativo | [RFC-CSC-001 v0.2](designs/continuous-self-compaction/RFC-001.md) |
| Snapshot histórico | [RFC-CSC-001 v0.1](history/RFC-CSC-001-v0.1.md) |

## Integridade do snapshot

A versão 0.1 foi copiada sem alterar um byte. Ela preserva também as decisões agora substituídas; é histórica e não normativa.

- Tamanho: `32479` bytes.
- Git blob SHA-1: `701d9fa06f8bf39065085048b6be6bb20b52b112`.
- SHA-256 do conteúdo: `27dcee0470b9f95bc5e7e4190bd7d341d59527e082b1195db2366d5aaf467578`.

O commit original não foi cherry-picked com os pais do monorepo. Foram importados o documento e sua proveniência, não o código, as credenciais, os issues de outros projetos ou o histórico inteiro do HuGR-Orchestra. A conversa e os comentários do PR original continuam disponíveis no link acima; o destino não finge transferir suas identidades GitHub.

## O que mudou na revisão 0.2

O produto deixa de ser uma alteração interna do HuGR-Orchestra. O núcleo e o formato lógico do ledger passam a pertencer a este repositório. OpenCode upstream será o primeiro adaptador; outros hosts precisam declarar capacidades e demonstrar o nível de integração.

Foram removidas as premissas de acesso direto ao banco do host, importação de internals e dependência obrigatória de Atlas/Own/Maestro. As leituras de código de origem permanecem como antecedentes e casos de teste, não como homologação do upstream.

Mantidos: gatilho preventivo de 50%, fork do contexto ativo, publicação entre chamadas, cobertura explícita do snapshot, preservação da cauda, fontes recuperáveis, âncoras, blocos curados e feedback entre podas.

Não introduzidos: código de runtime, pacotes publicados, release, compatibilidade universal, gateway obrigatório, novos benchmarks ou promessa de economia.

## Local de continuidade

Novas revisões, especificações, issues e implementação desta feature pertencem a este repositório. O PR original foi encerrado sem merge após a verificação do destino, com [comentário de redirecionamento](https://github.com/gmhelmold/HuGR-Orchestra/pull/54#issuecomment-5722022052). Seu commit e sua branch foram preservados como origem histórica; nenhum código do HuGR-Orchestra foi alterado nesta migração. A revisão adversarial continua no [issue #1](https://github.com/gmhelmold/context-continuity/issues/1).

O documento Word anterior é material de origem de produto, descrito no RFC; esta operação migra o trabalho versionado do PR #54. Não converte esse Word em contrato executável nem publica artefatos de outras conversas.

## Verificações desta entrega

Conferir identidade do snapshot pelo Git blob e SHA-256, referências Markdown relativas, ausência de arquivos inesperados e leitura do commit publicado no GitHub. São verificações de integridade documental, não testes do plugin.
