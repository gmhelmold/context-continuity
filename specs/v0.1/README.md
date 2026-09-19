# SPEC-CC-0.1 — especificação de Context Continuity

**Revisão 0.1.2: correções C01–C12 da REVIEW-003.** Especificação proposta, sem plugin implementado, pacote publicado ou host homologado. Origem: [RFC standalone](../../docs/designs/continuous-self-compaction/RFC-001.md). A [resolução B01–B16](../../docs/reviews/REVIEW-002-RESOLUTION.md) registra mudanças e limites de prova.

## Documentos normativos

| Contrato | Autoridade |
|---|---|
| [SPEC-01](01-contracts.md) | Identidades, payloads efetivos, Captures/SealedFrames, Manifest, propostas e capacidades. |
| [SPEC-02](02-lifecycle.md) | Fórmulas, estados, permissões de tentativa física, cancelamento e publicação terminal. |
| [SPEC-03](03-ledger.md) | DDL, persistência, lock de workspace, quota, operações, tombstones e recuperação. |
| [SPEC-04](04-opencode.md) | Perfis OC-V1-NATIVE/OC-V1-HTTP-LOCAL e gate P01–P14. |
| [SPEC-05](05-tools-ux.md) | Busca/leitura byte-safe, blocos, WorkContext e notas determinísticas. |
| [SPEC-06](06-acceptance.md) | 36 requisitos, 40 famílias e 55 subcasos de aceitação. |
| [SPEC-07](07-state-operations.md) | Projeção achatada, invalidação transitiva, restore/correção e arquivos portáveis. |
| [SPEC-08](08-evaluation.md) | Protocolo pré-registrado, métricas, budget e decisão do piloto. |
| [SPEC-09](09-review003-boundaries.md) | Oráculos exatos, codec, retenção, reset e transporte após REVIEW-003. |
| [SPEC-10](10-context-contracts.md) | Refinamentos dos contratos puros de manifesto/proposta e captura JSON (WP-01/C). |
| [SPEC-11](11-terminal-profiles.md) | Perfil terminal explícito, grupos indivisíveis e testemunha externa (D01/D04/D05). |
| [SPEC-12](12-generation-context.md) | Identidade imutável de job/Snapshot/manifesto/feedback, registros e respostas vinculadas. |
| [SPEC-13](13-storage-foundation.md) | Fundação SQLite de sessão/proprietário: escopo, inicialização e garantias verificadas. |
| [SPEC-14](14-inline-root-retention.md) | Fontes inline e mapa de raízes: revisão, CAS de catálogo, quota lógica e reabertura. |
| [SPEC-15](15-durable-jobs.md) | Persistência de jobs/tentativas e recuperação explícita sem replay; não é executor de transporte. |
| [SPEC-16](16-native-lock-primitive.md) | Primitiva Node-API de flock; não gerencia owners nem libera quarentena de jobs. |
| [SPEC-17](17-lock-resources.md) | Recursos privados, identidades de arquivos e duração de locks; não é coordenador de owners. |
| [SPEC-18](18-workspace-coordinator.md) | Anchor durável, registro e aposentadoria de owners e seção síncrona revogável. |
| [SPEC-19](19-local-attempt-supervisor.md) | Supervisão local, vínculo de tentativa, término observado e recuperação conservadora antes de invocação. |
| [SPEC-20](20-local-completion-receipts.md) | Recibo de término observado pelo supervisor original e reconciliação pelo lease atual, sem replay ou prova de morte por TTL. |
| [SPEC-21](21-source-pins.md) | Pins de leitura/exportação inline, replay e liberação pelo owner; sem GC ou reader de blobs. |
| [Work packages](WORK-PACKAGES.md) | Oito pacotes com cinco axiomas e DoDs sem dependências retroativas. |
| [traceability.json](traceability.json) | Fonte única do mapa requisito/casos/donos/dependências. |

## Decisões que substituem ambiguidades anteriores

Núcleo TypeScript/ESM independente do host. Ledger local do produto, sem acesso a DB/transcripts privados. Overlay atual contém cobertura de RAÍZES originais; não exige encontrar um resumo antigo no transcript bruto. View materializada também contém versões e ordinais de blocos, atualizados atomicamente sem esperar uma poda.

Capture parcial não autoriza publicar nem gerar. SealedFrame final incorpora system/tools/defaults/metadata efetivos. Aplicar View no ponto terminal, manter cauda e hashes, então despachar a entrada validada. O modo complete exige todas as capacidades verificadas, fidelidade verified e gate pass; cache hit é métrica independente.

A [ADR-001](../../docs/decisions/ADR-001-terminal-boundary.md) escolhe para a prova completa no OpenCode v1.18.31 um plugin com rota HTTP loopback opt-in e executor HTTP próprio. Isto NÃO é requisito de todos os hosts/núcleo. O perfil v1 somente-hooks fica sem complete; não fingir que oferece captura final ou controle dos retries internos. API key explícita/fixture local no primeiro perfil, sem extrair tokens de assinaturas. Não houve instalação dessa rota na máquina pessoal.

Gatilho padrão 50%, reservas e quotas versionadas, um job/run local por sessão. Até duas tentativas HTTP auxiliares admitidas antes da conexão. Retry do pai pertence ao host e é contabilizado separadamente. Quarantine local e remote_state unknown não viram sucesso nem reembolso fictício.

Ledger tem Manifest congelado com refs tipadas. Correção/supersessão invalida dependências content transitivamente; exclusão também limpa derivados/cópias gerenciadas e impede recaptura. Restore parcial expande o replacement inteiro somente após consentimento; leitura arbitrária de trecho é context_read. Operações humanas não fabricam jobs LLM.

Feedback conserva WorkContext e recortes realmente entregues. Notas são criadas pelo núcleo de forma determinística, bounded e com expiração por publication_seq. As âncoras não dependem de um resumo conservá-las.

## Como ler os estados de validação

Revisão contratual, teste de documento, modelo abstrato, componente real, host integrado e piloto são classes distintas. Nenhum dos 55 subcasos de runtime passa porque scripts documentais passaram. O teste agregado Tnn só passa quando todos os seus subcasos aplicáveis têm evidência.

Prova do host: OpenCode v1.18.31 / a97622c801f4ca571530ddc51076af659a9c32cd, P01–P14. SDK/codec/artefato da instalação devem ser registrados no ensaio; documentação v2 não substitui a versão fixada. Nenhum perfil está homologado nesta revisão. O segundo adaptador continua Gemini CLI a fixar em seu trabalho, sem suporte presumido a marcas/modelos.

## Verificações desta etapa

```sh
python3 scripts/check-spec.py
python3 scripts/check-reference-model.py
python3 scripts/test-spec-check.py
python3 scripts/check-canonical.py
python3 scripts/check-storage-contracts.py
node --test tests/conformance/opencode/test-components.mjs
```

O primeiro valida links/fragmentos, reciprocidade, grafo e DDL de referência. O segundo executa dez modelos de contrato (incluindo 64 consolidações, bytes UTF-8 e tabela de capacidades). O terceiro exige rejeição de dez mutações documentais controladas. Não são runtime do produto, ensaio de provider ou benchmark.

## Critério de avanço

Contratos revisados e coerentes liberam implementação por pacote após revisão do PR. WP-00 diagnostica capacidades; só gate positivo permite modo complete do WP-06. O núcleo pode avançar com fixtures sem exigir sua própria integração futura no DoD. Release e gasto live têm gates próprios, incluindo orçamento explícito em SPEC-08.
