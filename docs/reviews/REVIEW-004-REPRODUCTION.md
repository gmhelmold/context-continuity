# REVIEW-004 — reprodução e leitura das evidências

Base de runtime: `47f5de8230a4e8e7bc5db3087321bdb175b94412`. Ler primeiro o [relatório](REVIEW-004.md) e a [evidência estruturada](evidence/REVIEW-004.json). Os comandos abaixo são ensaios de revisão com dados sintéticos, não um instalador do produto.

## 1. Preparar uma cópia dedicada

Usar o checkout do PR desta revisão, que contém o script adicional e não modifica runtime. Conferir que os diretórios executáveis ainda correspondem à base auditada:

```sh
BASE=47f5de8230a4e8e7bc5db3087321bdb175b94412
git diff --exit-code "$BASE" HEAD -- packages/core/src tests scripts specs package.json package-lock.json tsconfig.core.json
node --version
npm ci --ignore-scripts --no-audit --no-fund
npm run check:core
npm run test:core
python3 scripts/check-spec.py
python3 scripts/check-reference-model.py
python3 scripts/test-spec-check.py
python3 scripts/check-canonical.py
python3 scripts/check-storage-contracts.py
node --test tests/conformance/opencode/test-components.mjs
```

Ambiente observado: Node 22.17.1, TypeScript 5.9.3 e tipos do lock, macOS Intel. O README do projeto define a matriz do CI. Repetir em outra versão pode gerar resultado diferente e deve registrar essa diferença.

## 2. Observações D02–D05 e P01

```sh
node --experimental-strip-types docs/reviews/REVIEW-004-probes.mjs > /tmp/cc-review004-observations.json
```

O script importa o código real, cria apenas servidores loopback e diretórios temporários próprios, usa entradas geradas e encerra esses recursos. Preserva/restaura as variáveis de ambiente do processo. Não usa instalação de usuário, chaves de provider ou banco privado do host. Seu código de saída indica conclusão do experimento; **não é um gate de aceitação**. O JSON inclui resultados indesejados que motivam o review.

Expectativas observadas na base:

- `cancel_before_dispatch`: zero requests antes do cancelamento, mas HTTP 200, primary forwarded e auxiliar iniciado depois dele. A barreira substitui temporariamente acquire por um wrapper que chama a implementação original; não altera sua resposta.
- `stale_root`: um replacement publicado; duas chamadas após corrigir a origem retornam 400/E_STALE_VIEW; o replacement permanece no checkpoint.
- `function_group`: functionCall/functionResponse estão em group-1/group-2, ambos completos e não protegidos.
- `model_identity`: o envelope contém actual-new-model e model_id contém test-model; seal é aceito.
- `proposal_reuse`: o guard de contexto aceita a proposta anterior com o mesmo manifesto; não recebe job/feedback esperado. É evidência do limite da API, não execução de dois jobs reais.

Cada observação está limitada à classe declarada no relatório. O script não pode ser usado para afirmar que esses casos foram exercitados pelo OpenCode stock ou corrigidos. Depois dos fixes, o comportamento esperado deve mudar; não conservar uma asserção de comportamento defeituoso como meta de produto.

## 3. D01 — controle stock e alteração antes da testemunha de entrada

O binário deve ser obtido pelo procedimento oficial fixado em [tests/conformance/opencode/README.md](../../tests/conformance/opencode/README.md). Conferir versão e checksum. Na revisão, foi usado OpenCode 1.18.31/macOS x86_64, SHA-256 `9cd3d83bc230830846ef4b20088e5521364540cd681fdeeda1bab4119f9c37a8`.

No controle, executar a suíte original num diretório de saída novo:

```sh
python3 tests/conformance/opencode/run.py --binary /caminho/absoluto/opencode --out /tmp/cc-review004-control-novo
```

Resultado registrado: 16 pass, 0 fail. Cada processo OpenCode pertence à fixture; não usar nem encerrar processos pessoais.

Criar OUTRO checkout/cópia descartável da mesma base. No arquivo `tests/conformance/opencode/gateway-plugin.mjs`, localizar a linha exata abaixo e exigir ocorrência única:

```js
if(body.model!=="probe"||!Array.isArray(body.messages))throw error("E_PROFILE");
```

Somente na cópia descartável, acrescentar imediatamente depois:

```js
body.messages=body.messages.map(m=>m.role==="system"?{...m,content:m.content+" REVIEW004_CHANGED_SYSTEM"}:m);
```

Isso altera o corpo antes de `emit('ingress',...)`. Não modificar o recorder, o oráculo ou os resultados esperados. Essa alteração deliberadamente incorreta é um teste local, não uma correção a integrar.

Executar apenas o caso identificado, a partir da cópia:

```sh
python3 tests/conformance/opencode/run.py --binary /caminho/absoluto/opencode --out /tmp/cc-review004-mutante-novo --only native-load-tool-loop-concurrent-pruning-and-prefix
```

Na base auditada, o caso passou 1/1 com exit 0. Para conferir que a alteração chegou ao endpoint, ler `wire-records.json` desse ensaio:

```python
import json
from pathlib import Path
rows = json.loads(Path('/tmp/cc-review004-mutante-novo/wire-records.json').read_text())
occurrences = sum(
    'REVIEW004_CHANGED_SYSTEM' in str(message.get('content', ''))
    for row in rows
    for message in row['body'].get('messages', [])
    if message.get('role') == 'system'
)
print(occurrences)
```

Valor observado: 12 ocorrências, incluindo reenvios/auxiliar. É importante conferir pass do teste **e** presença da alteração no recorder. Um erro de setup não comprova detecção nem sobrevivência. A suíte inteira não foi executada com esse mutante; não extrapolar o resultado 1/1 para 16/16.

## 4. Integridade e alcance

O arquivo de evidência inclui hashes de fontes e relatórios efetivamente executados. Esses hashes identificam artefatos; não são assinatura ou prova de que qualquer máquina futura executará o mesmo resultado. O script de componente foi executado novamente depois de receber caminhos relativos para publicação, e sua saída JSON coincidiu com a execução exploratória.

O teste completo na base sem alterações é controle positivo da instalação. O teste mutado é contraprova direcionada da observação de ingresso. Os demais casos são execução de componentes reais, e P01 permanece uma integração futura. Nenhum subcaso do produto recebe PASS por registrar este review.

Preservar resultados históricos. A correção deve acrescentar um testemunho externo de ingresso, casos negativos de agrupamento/identidade e regressões de lifecycle, e então repetir os gates sobre o SHA corrigido. Esta revisão não contém essas correções.
