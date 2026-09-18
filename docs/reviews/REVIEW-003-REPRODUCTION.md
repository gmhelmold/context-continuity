# REVIEW-003 — reprodução e interpretação das evidências

Complementa [REVIEW-003](REVIEW-003.md) e seu [sumário estruturado](evidence/REVIEW-003.json). Todos os exemplos usam conteúdo sintético e cópias descartáveis. Não são instruções de instalação do produto, não acessam uma sessão pessoal e não usam provider live.

A base é `8f844ed5798146c9626653627d67916df0737583`. O teste de integração requer o binário oficial OpenCode 1.18.31, obtido e verificado pelo procedimento já documentado em [tests/conformance/opencode](../../tests/conformance/opencode/README.md). Na execução deste review foi usado o artefato macOS x86_64 com binary SHA-256 `9cd3d83bc230830846ef4b20088e5521364540cd681fdeeda1bab4119f9c37a8`.

## 1. Baseline e mutação C01

A operação abaixo reproduz a mutação executada. `HOST` deve apontar para o binário stock isolado; não usar uma instalação pessoal em execução. Os scripts de fixture criam HOME/XDG/workspace próprios e seu provider loopback. Não executar sobre uma árvore de trabalho com alterações pessoais.

```sh
export PYTHONDONTWRITEBYTECODE=1
export HOST=/caminho/absoluto/para/binario-oficial-isolado/opencode
export REVIEW_ROOT="$(mktemp -d)"
git clone https://github.com/gmhelmold/context-continuity.git "$REVIEW_ROOT/repo"
git -C "$REVIEW_ROOT/repo" checkout --detach 8f844ed5798146c9626653627d67916df0737583
python3 "$REVIEW_ROOT/repo/scripts/check-spec.py"
python3 "$REVIEW_ROOT/repo/scripts/check-reference-model.py"
python3 "$REVIEW_ROOT/repo/scripts/test-spec-check.py"
python3 "$REVIEW_ROOT/repo/tests/conformance/opencode/run.py" \
  --binary "$HOST" --out "$REVIEW_ROOT/baseline"
```

Criar uma cópia SOMENTE das fixtures e alterar uma linha de sua transformação de saída:

```sh
python3 - <<'PY'
import os
import shutil
from pathlib import Path
root = Path(os.environ['REVIEW_ROOT'])
shutil.copytree(root / 'repo/tests', root / 'mutant/tests')
path = root / 'mutant/tests/conformance/opencode/gateway-plugin.mjs'
original = path.read_text()
old = 'selected={...body,messages:apply(roots,s.view)};'
new = ('selected={...body,messages:apply(roots,s.view).map(m=>'
       'm.role==="tool"?{...m,content:"CC_REVIEW_CORRUPTED_TAIL"}:m)};')
assert original.count(old) == 1, 'Base diferente; não aplicar por aproximação'
path.write_text(original.replace(old, new))
PY
python3 "$REVIEW_ROOT/mutant/tests/conformance/opencode/run.py" \
  --binary "$HOST" --out "$REVIEW_ROOT/mutant-run"
```

Inspecionar o resultado e confirmar que a alteração chegou ao recorder, em vez de apenas assumir que o código mutado foi carregado:

```sh
python3 - <<'PY'
import json
import os
from pathlib import Path
root = Path(os.environ['REVIEW_ROOT']) / 'mutant-run'
report = json.loads((root / 'report.json').read_text())
wire = json.loads((root / 'wire-records.json').read_text())
changed = sum(
    message.get('role') == 'tool'
    and message.get('content') == 'CC_REVIEW_CORRUPTED_TAIL'
    for request in wire if not request.get('auxiliary')
    for message in request['body'].get('messages', [])
)
passed = sum(check['result'] == 'pass' for check in report['checks'])
failed = sum(check['result'] == 'fail' for check in report['checks'])
print({'passed': passed, 'failed': failed, 'corrupted_occurrences': changed})
PY
```

**Observado neste review:** baseline 14/14; mutante 14/14; 90 ocorrências alteradas. A quantidade conta ocorrências em requests, não execuções distintas de ferramentas. Verde no mutante é uma falha do oráculo, não sucesso do produto. O encerramento de C01 exige que uma implementação corrigida REJEITE a mutação pelo motivo esperado.

## 2. Codec C02

Foi copiado o módulo `gateway-plugin.mjs` do commit auditado para um arquivo temporário, acrescentando apenas uma exportação de `rootsFor`, `project` e `hash`. Não foi modificado o corpo dessas funções. O teste não inicializou o plugin nem uma conexão de provider.

Fixture de entrada nativa: um user com parte text e parte file de MIME image/png; depois um assistant textual. Fixture wire correspondente: conteúdo user em array text + image_url, seguido do assistant. O conteúdo da imagem era apenas um marcador sintético; não foi decodificado.

Executar `rootsFor`, construir um replacement com os IDs/digests retornados e chamar `project` produziu:

```json
{
  "source_accepted": true,
  "protected_flags": [false, false],
  "image_present_before": true,
  "image_present_after_replacement": false
}
```

O oráculo é estrutural: uma parte não suportada não pode desaparecer silenciosamente. Não exige que o modelo interprete uma imagem ou que o host seja homologado para ela.

## 3. Derivado publicado C03

Foi reutilizada a classe Probe do runner e o gateway ORIGINAL, num diretório novo. Sequência:

1. Criar uma sessão e uma execução happy com policy=0 no plugin posterior.
2. Esperar a publicação da primeira síntese pelo evento view-applied.
3. Mudar somente o controle de fixture para policy=1 e continuar a mesma sessão.
4. Examinar os requests primary adicionais no recorder.

**Observado:** `CC_POLICY=1` estava presente e a síntese da execução anterior também. Isso testa a fase posterior à publicação, diferente do cenário existente que muda system enquanto a proposta ainda está pronta para ser aplicada. O resultado demonstra ausência de revalidação no protótipo; não determina sozinho que o texto da síntese esteja semanticamente errado.

## 4. Summary vazio C04

Em outra sessão stock isolada, foi modificada somente a saída do provider de teste para um cenário adicional: devolver `{"summary":""}` com finish stop. Gateway e algoritmo de publicação permaneceram inalterados.

Após a sequência normal de ferramentas, o trace registrou um aux-ready, zero view-applied, zero aux-failed e zero aux-cancelled, com uma requisição auxiliar. A leitura do código explica o estado: string vazia passa pela validação, é falsy na condição de publicação e não torna job terminal. Nova entrada humana pode cancelar; o problema é a falta de término autônomo desse job.

## 5. Canonicalização C12

Foram comparados os bytes produzidos pelo helper `canon` + `json.dumps(..., ensure_ascii=False, separators=(',',':'))` e por `JSON.stringify(JSON.parse(...))`, usando Node instalado para o segundo cálculo. Não houve rede nem acesso ao host.

Valores: 1.0, -0.0 e 1e-7. Os três pares divergiram, como registrado no sumário JSON. O teste avalia compatibilidade de representação, não verdade semântica de hashes. Depois do fix, acrescentar vetores cujo resultado canônico esperado seja independente da linguagem que executa o teste.

## 6. Limites e retenção

Uma sondagem composta adicional de transporte e uma leitura suplementar em lote foram recusadas pela ferramenta; não foram contadas como execução. C06–C08 usam inspeção estática e precisam de seus testes específicos.

Os relatórios de fixture e traces completos ficaram em diretórios descartáveis da revisão. O repositório recebe um sumário curado dos resultados, não tokens locais de correlação, cabeçalhos de autenticação, configuração pessoal ou históricos reais. Os comandos acima regeneram suas próprias evidências. Não considerar este documento um certificado de conformance de todos os 55 subcasos.
