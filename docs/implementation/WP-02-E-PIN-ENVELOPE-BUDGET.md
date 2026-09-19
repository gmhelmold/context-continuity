# WP-02/E4.1 — limite de envelope antes da ponte SQLite→Node

Base: `6a66222fbc70e5384516e1a6df025da438943b56`, após [E4](WP-02-E-PIN-DISCOVERY.md)/PR #42. Continuidade da issue #5. Contratos: [SPEC-21](../../specs/v0.1/21-source-pins.md) e [SPEC-22](../../specs/v0.1/22-source-pin-discovery.md). Branch: `storage-pin-envelope-budget`; PR #43.

## Defeito e correção

A base limita quantidade de registros e rejeita envelopes acima de 16 KiB, mas só depois de `SELECT value` entregar o texto ao Node. Portanto, a rejeição final não prova o limite anterior à materialização. Esse defeito de recursos não foi detectado pelo gate E4; seu resultado histórico permanece válido apenas para os cenários então executados.

O loader compartilhado agora consulta somente tipo e `octet_length(value)` antes do valor. Recusa tamanho excessivo ou representação que não seja TEXT, verifica encoding UTF-8, e somente então faz o SELECT existente. Preserva a checagem por `Buffer.byteLength`, parser, digest, reserva e identidade de participante. Todos os chamadores públicos continuam envolvendo o loader na mesma transação e no mesmo lock de workspace; não há cache de medidas entre chamadas.

A referência oficial SQLite para [octet_length](https://sqlite.org/lang_corefunc.html#octet_length) distingue bytes de caracteres e explicita a dependência do encoding do banco. `length(TEXT)` não serve: conta caracteres e para em NUL. A guarda de encoding evita tratar bytes UTF-16 como bytes UTF-8. Ledgers criados normalmente usam UTF-8; valores existentes em outra codificação são recusados nesse loader, sem migração silenciosa. A implementação não promete limite global de memória, todas as colunas corrompidas protegidas ou I/O constante do motor SQL.

A revisão acrescenta igualdade entre o tamanho recebido e o tamanho armazenado observado. Nos pins de Node, uma conversão TEXT que termina em NUL pode entregar um prefixo JSON válido e ignorar o sufixo. Mesmo abaixo de 16 KiB esse prefixo não é um envelope completo. A nova guarda recusa a diferença antes do parser, mantendo as outras validações. Não se apresenta comparação de comprimento como autenticação de conversões de mesmo tamanho.

## Blast radius delimitado

| Superfície | Comportamento preservado / mudança |
| --- | --- |
| `readSourcePin` | Ausência completa continua null; active e released têm preflight de bytes e confirmação do tamanho recebido. |
| `listSourcePins` | Mesma janela limit+1; lookahead excessivo recusa a página inteira antes de carregar seu valor. |
| `readPinnedSource` | Preflight do pin ocorre antes das verificações atuais de proprietário/política/conteúdo; nenhuma permissão nova. |
| `pinSource` | Replay não materializa envelope inválido, não recria reserva e não altera timestamp. |
| `releaseSourcePin` | Envelope inconsistente não autoriza a remoção da reserva. |
| `recoverSourcePin` | Mesmo protocolo de identidade/locks E3; preflight não fornece autoridade de limpeza. |

Um arquivo de produção alterado: `packages/storage/src/source-pins.ts`. Dois arquivos de testes novos; nenhum teste anterior modificado. DDL, core, ponte nativa, dependências, quotas, workflows e forma da API pública permanecem iguais. Acrescenta duas consultas escalares por envelope existente válido, sem alegação de melhoria de latência medida.

## Provas executáveis

`tests/coordination/source-pin-envelope-budget.test.mjs`: **21 casos preparados**. Sete entradas cobrem ID, primeira entrada da página, lookahead, leitura de bytes, replay, liberação e recuperação por outro participante. Mais três casos distinguem bytes multibyte BMP, astral e NUL; dois recusam prefixos válidos seguidos por NUL em registros curtos/no limite; um recusa BLOB; dois aceitam envelopes Unicode válidos de 16383/16384 bytes; um preserva a janela sem auditar a próxima; um observa escrita concorrente entre medida e valor; um injeta falha na leitura escalar; dois recusam UTF-16le/be; um distingue histórico released por ID de sua exclusão da descoberta.

O observador envolve os resultados reais de `StatementSync.get`, não substitui SQLite nem confia em um contador do produto. Registra se o campo `value` atravessou a ponte, seu tamanho e presença de transação. O defeito antigo retorna o mesmo E_STORAGE para excesso, mas falha na assertion `PIN_METADATA_PREMATERIALIZATION`. Limite exato usa `PIN_METADATA_INCLUSIVE_BOUND`; recusa de texto parcial usa `PIN_METADATA_TEXT_COMPLETENESS`. Fixtures preservam registros, guardas e locks dos participantes; Python observa exclusão independentemente. A conferência de preservação usa CAST AS BLOB somente no teste para não repetir a conversão TEXT com NUL. São dados e processos sintéticos, não dados pessoais.

`tests/coordination/source-pin-envelope-mutations.test.mjs`: **cinco pares controle/mutante preparados** — guarda prévia removida, contagem de caracteres no lugar de bytes, limite indevidamente exclusivo, guarda de encoding removida e confirmação do tamanho recebido removida. Cada variante executa um teste selecionado sobre cópia descartável do código real, no Actions. Exige controle passando, mutante com um teste falhando por ERR_ASSERTION e mensagem prevista; timeout/import/setup/sinal não são detecção. Cada par conta uma vez.

Contagem esperada: **360 coordenação = 334 anteriores + 21 comportamentos + 5 pares**. A existência e a contagem esperada não são PASS. Os testes de processo/reinício históricos permanecem na matriz completa.

## Revisão do autor e primeira rodada

A revisão estática exigiu corrigir a ordem do limite, não simplesmente acrescentar mais uma validação posterior. Também exigiu impedir contagem por caracteres/NUL e diferença de encoding, manter snapshot entre as duas leituras e observar valores reais atravessando o driver. Não relaxou erros, ownership, quota, prazo ou cleanup para obter verde. Não foi uma auditoria independente.

Primeiro head `0fdb0a977368a6f01d70d5af1715e629862e6c63`: run35471425949, jobs105972965430/105972965503, **356/357 nas duas versões**. Única falha: a nova fixture de preservação NUL usava SELECT TEXT e recebia `{}` sem o sufixo. Contagem SQL completa, recusa e não materialização passaram; os 334 casos históricos e os quatro pares preparados naquela rodada também passaram. Corrigida a testemunha de preservação para comparar bytes via BLOB, sem mudar a entrada, remover o teste ou relaxar a recusa. Esse resultado vermelho permanece registrado no PR, comentário5745568726.

A consequência de integridade abaixo do limite foi identificada na revisão dessa rodada: exige-se tamanho recebido igual ao escalar, com dois cenários novos e um quinto mutante. Esses casos precisam passar na matriz própria do head revisado; não foram executados no primeiro head nem certificados por ele.

A checagem interna adicional de encoding é restrição explícita deste perfil, não alegação de compatibilidade com bancos UTF-16. Texto JSON preenchido até o limite é fixture de diagnóstico: é restaurado antes do cleanup e não constitui promessa nova sobre CAS de envelopes não canônicos. O teste concorrente escreve diretamente no banco sintético de propósito para observar isolamento WAL, sem alegar que produtores normais possam ignorar o lock de workspace.

## Cinco axiomas

**Success Criteria:** envelope excessivo ou de representação incompatível não atravessa o driver como valor; dados válidos no limite exato continuam legíveis por ID e página; transferência encurtada não autoriza um registro completo.

**Quality Standards:** SQLite/FS/locks reais, fixtures pequenas e sintéticas, observação da ponte do driver, controle positivo por mutante e erro nomeado; nenhum resultado derivado apenas da telemetria do produto.

**Completeness Criteria:** seis APIs e lookahead, active/released, bytes/caracteres/NUL/encoding/tipo, limites inclusivos, texto parcial, janela, snapshot concorrente, falha escalar, preservação de dados e participantes; toda a regressão histórica.

**Definition of Done:** sete workflows/dez logs completos do head final verdes; contratos/diff revisados; head, checkout CI e merge com mesma árvore; registros no PR e na issue #5; branch integrada removida. WP-02 não é encerrado por este corte.

**Invariants:** sem truncar/reparar/migrar, sem liberar/adotar por diagnóstico, sem carregar fontes por descoberta, sem nova permissão de rede ou inferência; nenhuma medição de bytes reutilizada fora do snapshot.

## Execução e registro

Toda compilação, typecheck, suíte e mutação deve ocorrer exclusivamente no GitHub Actions nos pins Node 22.17.1 e 24.0.0. Não executar no Mac ou no contêiner. Gate completo: coordenação/build 360, core/typecheck 198, storage/typecheck 155 nas duas versões; cinco verificadores documentais, componentes 12 e testemunha 4; gateway 13; OpenCode oficial 1.18.31/provider sintético 16; controle do host e oito mutantes.

O PR registra SHAs, runs/jobs, resultados realmente observados, revisão, eventuais rodadas vermelhas e comparação de árvores. Não se cria um commit só para reescrever PASS depois do gate. Nenhuma release, inferência paga, homologação completa de host ou conclusão de staging/blobs/GC é declarada por este relatório.
