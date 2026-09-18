# REVIEW-002 — resolução dos achados

**Estado:** 16 achados endereçados nos contratos da revisão 0.1.1; nenhuma homologação de runtime implícita.

**Revisão respondida:** [REVIEW-002](REVIEW-002.md), objeto auditado `628fca8ddfcb77f71f146046638afb225b5809c1`. Base destas correções: `d27b4ba73440ecd660438abbd9162034e5407e69`. Data: 17/09/2026.

O relatório original permanece intacto: seu CHANGES REQUIRED descreve a versão auditada. Este documento registra decisões novas e prova offline, sem reescrever o review nem declarar que o plugin foi implementado. Todos os subcasos de runtime seguem not_run.

## 1. Matriz de resolução

| Achado | Mudança efetiva | Contrato | Prova de implementação exigida |
|---|---|---|---|
| B01 | Capture parcial não publica; SealedFrame terminal decide a View e pode vetar envio. Perfil v1 só-hooks separado do perfil HTTP local opt-in. | SPEC-01/04; ADR-001 | T06.host, T29.host, T39.host; P03/P07/P12 |
| B02 | Cobertura lógica e física separadas; todo replacement aponta para raízes originais achatadas. Renderer não procura S1 no transcript bruto. | SPEC-01/07 | T08.projection, T27.projection |
| B03 | Hash da fonte separado de payload_digest, unit_digest e config_digest; papel e metadata efetivos integram identidade. | SPEC-01 | T07.contract, T39.projection |
| B04 | ManifestEntry tipado/congelado, índice contíguo, recorte/digest/autoridade e presented_as; persistência e importação preservam resolução. | SPEC-01/03/07 | T37.contract, T32.archive |
| B05 | Atualização de bloco publica View/policy na mesma transação, com ordinal persistido; funciona sem job e em pause. | SPEC-03/05/07 | T22.blocks, T23.blocks |
| B06 | Dependências content transitivas distintas de history; correção invalida derivados, redação também limpa cópias gerenciadas e bloqueia recaptura. | SPEC-03/07 | T11.dependencies, T32.redaction |
| B07 | Executor HTTP do produto, sem retry/redirect/tools automáticos; AttemptPermit antes de cada request, total2 por job; retries do pai separados. | SPEC-01/02/04; ADR-001 | T40.executor, T40.host; P11 |
| B08 | Run por tentativa, vínculo durável job/attempt, stop local, remote_state unknown, quarantine e ausência de sessão auxiliar persistida no host. | SPEC-01/02/03/04 | T12.host, T24.host, T40.host |
| B09 | Uma conjunção de capacidades + fidelity verified + gate pass; investigação concluída e cache hit não habilitam complete. | SPEC-01/04 | T33.capabilities, T33.host |
| B10 | WorkContext no frame/recibo; notas determinísticas do núcleo, interseção comum, dedup de chamada e expiração N+2. | SPEC-01/03/05 | T26.feedback |
| B11 | Operations humanas sem jobs falsos; restore preview/commit com expansão explícita; ArchiveManifest/Records e remapeamento de namespace. | SPEC-03/07 | T27.projection, T32.archive, T38.archive |
| B12 | Lock de SO por workspace une finalização/reuso/GC; reserva de quota e pins de reader/export coordenados com refs. | SPEC-03 | T19.storage, T12.storage |
| B13 | Cursor por bytes UTF-8 com progresso intra-linha e recorte congelado; erro se envelope não couber, sem páginas vazias infinitas. | SPEC-05 | T38.paging |
| B14 | Registro canônico recíproco R→casos→WPs, fragmentos de links e DAG verificados; dez mutações controladas obrigatoriamente rejeitadas. | traceability.json; check-spec.py | test-spec-check.py (documento, não semântica) |
| B15 | Quarenta famílias divididas em 55 subcasos; cada DoD depende só de componentes disponíveis; agregado exige todas as partes. | SPEC-06; WORK-PACKAGES | Validação documental do grafo + provas por subcaso |
| B16 | Protocolo pré-registrado define sessão como unidade, oráculos, rubrica, pares, censura, budget, stop-rules e regra de decisão. | SPEC-08 | T34.pilot, T35.pilot |

## 2. Mudança de arquitetura que deve ficar visível

Não foi mantida a promessa contraditória de que hooks precoces do OpenCode v1 enxergam o request final ou controlam retries internos do runner. A [ADR-001](../decisions/ADR-001-terminal-boundary.md) seleciona uma rota HTTP local explícita para o PRIMEIRO perfil completo, com executor próprio que copia a entrada efetiva. O mesmo plugin coleta identidade via API pública e controla a fronteira serializada por baseURL.

Esse perfil exige configuração opt-in e conexão de API autorizada; não herda assinatura OAuth. Não é gateway universal obrigatório nem migração para um fork do host. O perfil somente-hooks permanece distinto e sem complete. Instalação, codec, isolamento, recursos locais e rollback são obrigações do gate P01–P14, ainda não executado. Se esse gate falhar, o modo completo não é lançado; a correção documental não antecipa seu resultado.

## 3. Provas offline executadas nesta correção

Em checkout descartável dos arquivos corrigidos:

```sh
python3 scripts/check-spec.py
python3 scripts/check-reference-model.py
python3 scripts/test-spec-check.py
```

O verificador valida links/fragmentos, schema referencial, reciprocidade e dependências dos 55 subcasos/8 WPs; preserva o blob histórico; executa DDL de referência e constraints/FKs com exclusão na ordem declarada. Não executa transações do futuro plugin.

O modelo de referência executa dez exemplos: consolidação achatada em 2/10/64 ciclos e serialização/reinício do plano; cobertura sobreposta/stale rejeitada; digest alterado por payload/role/metadata; manifesto misto em remapeamento; paginação UTF-8/CRLF longa; página vazia/orçamento mínimo; tabela de capacidades; closure content versus history; expansão de restore; escopo/expiração de notas.

Dez mutações do verificador são rejeitadas: trocar teste existente de requisito, trocar dono existente, fragmento inválido, ciclo de WPs, DoD retroativo, falso PASS inicial, ausência de axioma, alteração do RFC histórico, remoção do índice unique e reciprocidade quebrada. Esses testes detectam inconsistência documental selecionada; não substituem revisão de significado.

**Limite explícito:** modelo abstrato não é implementação do core. Não houve instalação de OpenCode, listener real, teste de gateway/codec, geração live, chamada de provider, medição de cache, piloto ou publicação de pacote. O DDL não prova a exclusão mútua do filesystem; T19.storage exige a implementação real. Os 55 subcasos de runtime permanecem not_run.

Uma chamada composta de edição foi bloqueada pela ferramenta e não executou. O estado foi lido novamente; as alterações finais e os testes são os que constam nos arquivos/commits efetivamente verificados, não o conteúdo presumido daquela chamada.

## 4. Revisão cruzada final

Foram confrontados tipos versus estados/transações; contratos versus tabela de capacidades; geração versus permits; consultas versus bytes/receipts; e aceitação versus dependências. Foram corrigidos nomes antigos de fingerprint/coverage e representação de registros redacted. Os reviews anteriores e o RFC 0.1 não foram modificados.

Conclusão de ESPECIFICAÇÃO: B01–B16 possuem decisão explícita, comportamento de erro e prova rastreável. Isso permite nova revisão dos contratos e implementação por pacotes. Conclusão de PRODUTO: não entregue/não homologado. Aprovação do PR não pode ser confundida com prova P01–P14 ou superioridade semântica.

## 5. Entradas canônicas

- [Índice normativo](../../specs/v0.1/README.md)
- [Operações e projeção](../../specs/v0.1/07-state-operations.md)
- [Binding e gate](../../specs/v0.1/04-opencode.md)
- [Rastreabilidade canônica](../../specs/v0.1/traceability.json)
- [Casos de aceitação](../../specs/v0.1/06-acceptance.md)
- [Work packages](../../specs/v0.1/WORK-PACKAGES.md)
- [Protocolo do piloto](../../specs/v0.1/08-evaluation.md)
