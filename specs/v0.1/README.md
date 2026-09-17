# SPEC-CC-0.1 — especificação executável de Context Continuity

Estado: **especificação proposta para implementação, revisão documental**. Data: 2026-09-17. Não existe plugin implementado, pacote publicado, host homologado ou benchmark executado nesta entrega.

Origem: [RFC-CSC-001 v0.2](../../docs/designs/continuous-self-compaction/RFC-001.md). Revisão: [REVIEW-001](../../docs/reviews/REVIEW-001.md). Esta especificação é um refinamento normativo: em divergências de comportamento, seus contratos explícitos prevalecem sobre exemplos e decisões ainda abertas do RFC. O snapshot v0.1 histórico não é alterado.

## Documentos normativos

| Documento | Fecha |
|---|---|
| [01 — Contratos](01-contracts.md) | Identidades, unidades, snapshots, propostas, capacidades, interfaces e erros. |
| [02 — Ciclo de execução](02-lifecycle.md) | Fórmulas, defaults, seleção do intervalo, concorrência, publicação, retries e recuperação. |
| [03 — Persistência](03-ledger.md) | Armazenamento privado portátil, tabelas, transações, fontes, exportação e exclusão. |
| [04 — OpenCode](04-opencode.md) | Binding fixado, pontos públicos, gate de compatibilidade e comportamento incompatível. |
| [05 — Tools e experiência](05-tools-ux.md) | Busca/leitura, âncoras, contexto curado, comandos e feedback. |
| [06 — Aceitação](06-acceptance.md) | 36 requisitos e 40 casos de aceitação, com oráculos observáveis. |
| [Work packages](WORK-PACKAGES.md) | Oito entregas, dependências, cinco axiomas e evidências. |

## Decisões fechadas nesta revisão

**D01 — Independência.** Núcleo em TypeScript/ESM, sem imports de tipos internos de hosts. Ele recebe dados JSON do adaptador e referências opacas em memória. Não depende de Atlas/Maestro/HuGR. Bibliotecas públicas de protocolos pertencem ao adaptador, não ao núcleo.

**D02 — Persistência.** SQLite local pertencente ao produto, um banco por workspace autorizado; fontes grandes em diretório privado por hash. Não escrever em banco do host. A primeira implementação usa um driver de SQLite compatível com seu ambiente; schema/transações são os mesmos. O runtime Bun do OpenCode não é requisito do núcleo.

**D03 — Unidade de poda.** Um intervalo contíguo de unidades de protocolo concluídas por job. Não cortar tool/result ou blocos opacos indivisíveis. Consolidação de capítulos usa o mesmo mecanismo. Nada de reorganização global arbitrária no MVP.

**D04 — Execução.** Um job ativo por sessão, coordenador em processo no primeiro plugin; lease/fencing para detectar duas instâncias. Sem serviço de cloud, cron do sistema ou daemon obrigatório. Processo auxiliar só entra em outro adaptador se o ciclo de vida do host exigir.

**D05 — Fork.** Mesmo modelo/variante do pai, snapshot ativo e instrução no sufixo. Cache é best effort medido, não condição de correção. Fidelidade do request e isolamento de execução são propriedades separadas. Não reaproveitar assinaturas por caminhos não autorizados.

**D06 — Disparo.** 50% da janela configurada é default, antecipado por orçamento e teto operacional. Gatilho por tarefa é complementar e opcional. Fórmulas, rearmamento e valores de partida estão em SPEC-02; não são limites universais de qualidade do modelo.

**D07 — Publicação.** Overlay declarativo persistido no banco do produto. A cada chamada, o adaptador o aplica sobre unidades identificadas do host. Não apagar transcript, não depender de uma mutação irreversível no histórico do host e não confundir publicação com entrega ao provider.

**D08 — Proteções.** Âncoras de usuário não são sumarizadas nem revogadas pelo maintainer. Dados externos nunca se tornam instruções de sistema. Originais são preservados dentro da política autorizada; retenção não se sobrepõe a exclusão solicitada.

**D09 — API do produto.** Duas tools de leitura (`context_search`, `context_read`), mais comandos de controle para o usuário. O clone não tem ferramentas de projeto executáveis. MCP é uma futura embalagem dessas tools, não mecanismo universal de poda.

**D10 — Alvo inicial.** OpenCode v1.18.31, commit `a97622c801f4ca571530ddc51076af659a9c32cd`, primeiro ensaio de compatibilidade. A documentação pública v2 é perfil distinto. Não há troca silenciosa de versão para fazer um teste passar.

**D11 — Modos.** `complete`, `assisted`, `unsupported`. A combinação host+versão+transporte+modelo+autenticação é homologada, não só a marca do modelo. Na ausência de prova de substituição/isolamento, complete não pode ser ativado. Nenhum downgrade pago silencioso.

**D12 — Release.** Não publicar até G-OC-01 e os testes do ciclo vertical passarem. Gateway, prewarming, busca vetorial e suporte integral a cinco hosts são extensões, não dependências deste MVP.

## Natureza dos contratos

DEVE indica obrigação do produto proposto; NÃO DEVE proíbe comportamento; PODE indica opção explícita. Tipos e nomes neste diretório são APIs propostas de Context Continuity, não símbolos existentes do OpenCode. Não instalar nem anunciar comandos como disponíveis até a implementação.

Atomização significa: entrada, precondição, transição, efeito durável, erro e prova especificados. Não significa duplicar o mesmo algoritmo em cada documento. SPEC-01 é autoridade de tipos; SPEC-02, de transições; SPEC-03, de persistência; SPEC-04, do binding; SPEC-05, da interface. Conflito entre eles bloqueia a implementação afetada até correção documental.

## O que permanece como ensaio, e não como decisão escondida

`G-OC-01`: demonstrar as capacidades combinadas do plugin em OpenCode stock. A leitura estática confirmou hooks, mas não certificou fork fiel/isolado nem aplicação final. O resultado de falha está especificado: não ativar complete, registrar capacidade ausente e propor um novo perfil público separadamente. WP-00 executa essa prova antes de WP-06.

O benchmark determina utilidade e calibração; não redefine livremente a política durante uma execução. Reservas/configuração são versionadas. Provider/modelo da prova live devem ser selecionados entre rotas explicitamente autorizadas na instalação; não é necessário inventar uma credencial ou escolher um modelo que o usuário não possui. O manifesto do ensaio deve registrar a escolha exata antes da chamada. Ensaios offline não precisam de credenciais.

## Orçamento da primeira implementação

Primeiro ciclo: um workspace local, um orquestrador, workers já existentes, fontes textuais e mensagens/tool outputs cuja estrutura seja conhecida. Mídia e blocos opacos são preservados e protegidos; não convertidos para texto. Sua presença não implica suporte à compactação do conteúdo multimodal.

O núcleo pode ser implementado/testado antes da homologação do host. O plugin completo não pode ser lançado antes dela. O segundo adaptador, Gemini CLI, serve para testar independência real; versões e documentação dele devem ser fixadas no respectivo trabalho, sem fingir que foram auditadas nesta entrega.

## Critério de conclusão da especificação

Documentos coerentes; cada requisito R01–R36 tem caso de aceitação e dono de implementação; cada work package tem Success Criteria, Quality Standards, Completeness Criteria, Definition of Done e Invariants; limitações de integração estão nominadas, com prova e efeito de falha; nenhuma promessa de runtime se baseia em um teste de documento.
