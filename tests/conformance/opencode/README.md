# Sonda WP-00 — OpenCode real, provider sintético

Este diretório não é um plugin de produto. É uma sonda de integração para verificar as interfaces públicas e a fronteira HTTP no OpenCode 1.18.31 sem patches.

## Executar

Obtenha o binário oficial da release fixada e confira o SHA-256 divulgado. Passe seu caminho explicitamente; a sonda não usa nem modifica a instalação pessoal.

```sh
python3 tests/conformance/opencode/run.py \
  --binary /caminho/isolado/opencode \
  --out /diretorio/novo/para-o-ensaio
```

O diretório de saída deve ser novo. A sonda cria HOME/XDG/workspace privados, usa somente o provider sintético, inicia o servidor stock e encerra os processos que iniciou em finally. Não herda variáveis de credenciais. Preparação do host pode baixar dependências públicas; nenhuma inferência é enviada a serviços de modelo.

`run.py` retorna não zero se qualquer asserção falhar. `report.json` resume checks, plataforma e hash do binário. `wire-records.json` contém exclusivamente a conversação sintética e nomes de headers, sem seus valores de autorização. `host.log` e os demais arquivos de trabalho são locais; não publicar a árvore inteira como artifact.

## Arquivos

- `gateway-plugin.mjs`: captura pública, loopback final, codec restrito, overlay em memória e executor auxiliar sem despacho de tools. Exporta uma função no formato público de plugin.
- `later-plugin.mjs`: muda system depois da captura para testar revalidação no turno corrente.
- `run.py`: provider SSE controlado, cliente da API pública do host e oráculos independentes.

O teste de prefixo compara no recorder a entrada auxiliar sem sua última mensagem com a entrada primary que saiu de verdade. Não mede KV cache. A compactação de teste é deliberadamente acionada pela fixture, não pelo gatilho do produto.

Os defaults de retry, tamanho e timeout desta sonda não substituem SPEC-02. Para todo código de teste que simula parte do produto, o [relatório de cobertura](../../../docs/conformance/OPENCODE-WP00.md) delimita o que ainda não foi demonstrado.

O CI usa Ubuntu 24.04 e o artefato `opencode-linux-x64-baseline.tar.gz` com SHA-256 fixado. O ensaio local usa macOS Intel. Ambos devem passar separadamente; um não homologa o outro por inferência.

## Continuidade após o primeiro incremento

A suíte contém 14 checks, incluindo quatro consolidações com cobertura achatada, reinício do plano, falha seguida de retry de compactação nativa e queda do processo durante um clone. HTTP 503 também entra no limite físico de tentativas.

O runner fornece `CC_CHECKPOINT` em um diretório de teste novo. Esse arquivo é um checkpoint JSON de sonda, não um ledger do produto; não compartilhar entre workspaces nem configurar essa sonda em uma instalação pessoal. A execução mata apenas um filho OpenCode criado por ela no caso de crash. `report.json` inclui hashes dos arquivos de prova; credenciais/capture tokens e headers sensíveis não são exportados.

[Resultados e limites](../../../docs/conformance/OPENCODE-WP00-CONTINUITY.md). A integridade do núcleo e a homologação integral continuam separadas deste teste.

## Regressões REVIEW-003

A sonda usa módulos locais `probe-protocol.mjs`, `probe-captures.mjs` e `probe-transport.mjs`, sem plugin interno do host. O oráculo Python é independente do renderer e confronta o corpo observado com a entrada anterior à poda e resultados públicos de ferramentas. Traces integrais são exclusivamente sintéticos e não devem ser usados para registrar conversas pessoais.

Pré-requisito adicional dos checks: Node.js 22 ou 24; Python 3.11+ em POSIX. O host continua sendo o binário oficial fixado; os testes não o recompilam.

```sh
node --test tests/conformance/opencode/test-components.mjs
python3 scripts/check-canonical.py
python3 scripts/check-storage-contracts.py
python3 tests/conformance/opencode/run.py --binary /caminho/opencode --out /tmp/cc-run-novo
python3 tests/conformance/opencode/test-oracle-mutations.py --binary /caminho/opencode --out /tmp/cc-mutations-novo
```

Os diretórios de saída precisam ser novos. A campanha roda um controle correto e seis cópias incorretas contra o mesmo host. Sucesso é controle aprovado e cada mutação rejeitada pelo oráculo, não simplesmente qualquer erro. `--only` no runner existe para ensaios dirigidos; não equivale a aprovação da suíte integral.

### Matriz P13 somente componente

```sh
node --test --test-name-pattern='^P13 synthetic component admission guard matrix$' tests/conformance/opencode/test-components.mjs
node --test tests/conformance/opencode/test-admission-mutations.mjs
```

Estes comandos rodam somente componente local sintético: P13 selecionado, quatro mutações de guard e controle separado de estado em memória. Não rodam campanha stock-host, não contam as seis mutações stock, e não habilitam complete.

Checkpoints gerados antes de 0.1.2 não são dados de usuário nem formato migrável do produto. Ao retomar uma fixture antiga, config desconhecida invalida conservadoramente overlays. A própria sonda é só ensaio, não um pacote para instalar em trabalho real.

## Ingresso independente (REVIEW-004 D01)

O caminho da fixture é OpenCode stock → testemunha Python → gateway sob teste → recorder sintético. Os bytes são registrados antes do gateway e encaminhados intactos. O oráculo compara todos os requests primários dos cenários principal/consolidações; não utiliza emit(ingress) como referência independente. A campanha mantém os seis mutantes antigos e acrescenta sistema/metadata pré-ingresso (oito no total). Rode `python3 tests/conformance/opencode/test-witness.py` para a prova de componente. O servidor de testemunha é exclusivo do teste, sem instalação ou gateway adicional de produto.
