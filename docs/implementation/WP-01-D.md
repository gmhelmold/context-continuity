# WP-01/D — identidade da geração e snapshot persistível

**Base:** `92c537247b4f5e4e492b826fa04f9c443b177852`. Continua a issue #4 e o pré-requisito P01 da [REVIEW-004](../reviews/REVIEW-004.md). Contrato em [SPEC-12](../../specs/v0.1/12-generation-context.md). Este incremento não altera a sonda, o host ou a política de publicação.

## Entrega

Dois módulos do núcleo: snapshot.ts e job-context.ts. SnapshotRecord conserva, de forma estrita e imutável, os campos de SPEC-01. JobContext liga job_id, snapshot_id/digest, sessão/encarnação/epoch, frame/config/input, manifesto, missão literal, feedback, WorkContext e fence. IDs novos são gerados pelo núcleo, não recebidos da resposta do modelo.

A referência de controle é capturada pelo chamador antes da geração. O callback deve manter essa referência ao lado da tentativa física. decodeJobProposal e assertJobProposal exigem a associação exata; o parser anterior continua puramente estrutural, sem ser transformado num scheduler. Não é possível ampliar o lote de feedback passando outros IDs durante o decode.

Exportação contém somente dados do contrato. Recarregar JSON não restaura handles; restore exige binding, expectativa externa e manifesto verificado. Alterar um registro e recalcular seus hashes não o faz coincidir com a referência originalmente admitida. Um teste inicia outro processo Node, revalida fontes sintéticas e recupera a mesma identidade sem inferência.

## Fronteiras deliberadas

Os campos de snapshot vêm da projeção autorizada: esta camada valida forma, consistência e associação, NÃO deriva cobertura a partir do host nem prova que read_dependencies inclua tudo que foi apresentado. A construção do EffectiveFrame e sua comparação terminal pertencem a WP-03/WP-04/WP-06. As fixtures partem de SealedFrames reais do componente nos dois formatos; isso não homologa um renderer projetado ainda não implementado.

O registro pode ser persistido por WP-02, mas não faz I/O/fsync, não adquire lease, não admite uma tentativa, não mede custo/ganho e não publica. Validar novamente uma resposta do mesmo job é operação pura; não autoriza outro request. Após cancelamento, o executor/publicador deve recusar callbacks pela política de estado/fence, independentemente da validade estrutural preservada neste contrato. Texto cru de uma resposta não autentica sua origem: a associação ao transporte é obrigação do executor.

A missão conserva bytes relevantes, inclusive CRLF/BOM/Unicode, e pode conter dados sujeitos à redação. Não contém headers ou envelope do host por construção deste schema; o chamador não deve inserir segredos na missão. SHA-256 não é assinatura ou autorização de leitura. A política de retention/freshness futura não é substituída por WeakMap.

## Provas locais executadas

Node 22.17.1 e TypeScript 5.9.3, tooling fixado por npm ci --ignore-scripts. **196/196 testes de núcleo**, typecheck, **25/25 componentes da sonda** (12 existentes mais 13 da REVIEW-004), **4/4 testemunha** e todos os checks documentais/modelos/DDL/canonicalização aprovados. São 161 testes anteriores e 35 novos; execuções-filhas e laços de fuzz não multiplicam essa contagem.

Os 35 novos incluem 34 testes de snapshot/geração e uma campanha com controle positivo e seis implementações incorretas: ignorar job_id, ignorar context_digest, restaurar sem expectativa externa, ignorar binding, aceitar proposta de outro job e ampliar feedback entregue. Cada filho precisa executar os 34 casos e falhar na assertion nomeada correspondente; timeout/setup não contam como detecção. A campanha inclui seu próprio controle positivo.

Antes da implementação, a reprodução P01 confirmou que o guard antigo só vincula manifesto/sessão, sem job_id. Isso é a fronteira conhecida do parser, não novo defeito alegado no scheduler. Agora dois jobs com o mesmo manifesto e feedback distinto são recusados na associação cruzada. Campos de controle adulterados, checksums recalculados, fontes indisponíveis, handles copiados e origem de feedback têm casos próprios.

## Critérios de encerramento do WP-01 (componente)

| Subcaso | Evidência implementada | Não confundir com |
|---|---|---|
| T02.contract | Scope/identidades A–C e JobContext/D, respostas e restauração cruzadas recusadas. | Isolamento de processos/attempts em execução. |
| T06.contract | Manifest/Capture/SealedFrame A–C; SnapshotRecord/job/mission/feedback D. | Correspondência de uma projeção futura ou provider live. |
| T07.contract | Registro de raízes/revisões B, inclusive processo novo. | Durabilidade transacional SQLite. |
| T15.contract | Configuração estrita A e limites do perfil. | Scheduler e gatilho de 50% executando. |
| T30.contract | Dois formatos sintéticos C e perfil de grupos após D04/D05. | Dois adaptadores de host homologados. |
| T33.capabilities | Tabela verdade A, perfil/limites explícitos após D05. | Certificação de capacidades declaradas. |
| T37.contract | Fuzz e mutações de configuração/identidade/manifest/proposal/frame/snapshot/job. | Reparo/retry físico do executor. |

A issue #4 pode fechar no escopo de contratos somente após os cinco workflows no head real passarem e os logs serem conferidos. WP-00, WP-02–WP-07 e seus subcasos não são antecipados. traceability.json.initial_status permanece a baseline histórica; o resultado incremental está neste documento e no encerramento do PR/issue.

## Reprodução e revisão

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check:core
npm run test:core
node --test tests/conformance/opencode/test-components.mjs tests/conformance/opencode/test-review004.mjs
python3 tests/conformance/opencode/test-witness.py
python3 scripts/check-spec.py
python3 scripts/check-reference-model.py
python3 scripts/test-spec-check.py
python3 scripts/check-canonical.py
python3 scripts/check-storage-contracts.py
```

A revisão do autor conferiu referências externas versus checksums locais, ordem do feedback, read_dependencies não citadas, estado conhecido versus execução, byte limits, scopes, ausência de I/O e preservação dos módulos anteriores. Não é revisão independente. Os cinco workflows (core em duas versões, specification, stock host, oito mutantes do host, regressões gateway) continuam obrigatórios antes do merge. Nenhuma inferência paga, pacote publicado ou instalação pessoal alterada.

Resultados estruturados e hashes de fontes: [WP-01-D.json](evidence/WP-01-D.json). São registros da execução local; os logs de CI do PR devem ser verificados separadamente.
