# WP-01/C — reconciliação e consistência do snapshot

**Base examinada:** `cc019fcb9e0b4d208080ba2ee601ff33dbb2e3e4`, PR #18, sobre `485034956c98c6a02e09659aea0b86ba6dcaba3f`. Complemento de [WP-01/C](WP-01-C.md) e [SPEC-10 §5](../../specs/v0.1/10-context-contracts.md#5-consistência-do-snapshot-de-citações-repetidas). Não altera a API pública do incremento concorrente nem a divisão de work packages.

## Reconciliação

Outra execução publicou cc019fc na branch compartilhada enquanto esta conversa preparava uma variante local de manifesto/proposta. O push da variante `b551889` foi recusado por non-fast-forward, sem alteração remota. Em vez de sobrescrever, foi adotada a implementação publicada, que já incluía Capture/SealedFrame e os dois formatos sintéticos. A variante local não integra este PR; diferenças úteis de estabilidade são um patch pequeno sobre a base publicada, com testes próprios. Não se somam contagens de testes de versões alternativas.

## Comportamento acrescentado

- Versão de entidade única não pode ter digests/autoridades contraditórios dentro de um manifesto, mesmo com locators distintos.
- Cada referência é resolvida uma vez por verificação. Material recebido é copiado e reutilizado em todos os recortes daquela referência. Isso impede uma verificação que combina dois conteúdos diferentes do mesmo capítulo, por uma mudança entre chamadas ao resolver.
- Representação completa é validada/hasheada uma vez; cada range continua respeitando fronteiras UTF-8 e seu excerpt_digest. O oráculo de mutação que remove a verificação do recorte continua exigido no mesmo teste, com o ponto de mutação atualizado.
- Até64MiB de materiais distintos copiados por verificação; backings concorrentes não admitidos. Não há retenção dos buffers no handle retornado.
- Material ausente null/undefined retorna E_SOURCE. Fonte textual vazia capturada continua aceita como full; não foi substituída pela política mais restritiva da variante descartada.

O resolver permanece a fronteira autorizada de storage/capture. Essa mudança não autentica código no mesmo processo, não prova que o modelo leu as fontes e não elimina a revalidação posterior de freshness/autoridade no publicador futuro.

## Prova antes/depois

Sete regressões em `tests/core/manifest-snapshot.test.mjs` foram executadas primeiro contra cc019fc, antes das correções. Resultado observado: **1 aprovada e 6 reprovadas**. As falhas eram assertions dos contratos novos/expostos: resolução repetida, duas representações de capítulo na mesma verificação, definição de versão contraditória, backing concorrente, orçamento agregado e material undefined. O controle de fonte vazia passou. Não foram falhas de setup ou timeout.

O registro de saída ficou no diretório temporário isolado desta execução. Após a correção, **149/149 testes do núcleo e typecheck passaram** no Node 22.17.1/macOS Intel, com test-concurrency=1 para não sobrepor campanhas filhas neste ambiente carregado. A primeira execução paralela terminou 148/149: o controle positivo da campanha antiga de identidades expirou em spawnSync (ETIMEDOUT); esse resultado não foi considerado aprovação nem detecção de mutante. Não foram alterados timeouts/oráculos. Os checks documentais/modelos/DDL, 12 componentes da sonda e demais verificações offline também passaram. O CI mantém seu comando padrão, sem herdar o ajuste de concorrência local, e seus logs devem ser verificados no head exato. A campanha existente de mutações continua com controle positivo e seus cinco mutantes; não recebe aprovação por herdar os resultados anteriores.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check:core
npm run test:core
node --experimental-strip-types --test tests/core/manifest-snapshot.test.mjs
python3 scripts/check-spec.py
python3 scripts/check-reference-model.py
python3 scripts/test-spec-check.py
python3 scripts/check-canonical.py
python3 scripts/check-storage-contracts.py
node --test tests/conformance/opencode/test-components.mjs
```

## Incidente de ambiente, sem alteração em dados pessoais

Uma tentativa local de regressão stock-host na variante anterior encontrou ENOSPC: o host registrou `SQLiteError: database or disk is full` e a escrita do relatório também falhou. Essa tentativa não é PASS do host. Seus processos terminaram e foram removidos somente caches/dependências/banco sintético da fixture criada nesta conversa, preservando logs e código. Não foram removidos caches pessoais nem dados de outros projetos. O checkout passou por git fsck/diff check antes de continuar. A integração final requer os quatro workflows do GitHub sobre o head efetivo.

## Escopo de conclusão

Este patch reforça a parcela de manifesto de T06.contract/T37.contract e preserva os contratos de captura/formatos do PR #18. Não fecha WP-01, WP-00, storage, scheduler, Snapshot/job completo ou modo complete. Não há inferência paga, pacote publicado, mudança de provider ou configuração pessoal. Histórico dos reviews e fontes anteriores permanece intacto.
