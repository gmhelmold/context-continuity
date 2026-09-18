# REVIEW-003 — resolução C01–C12

**Escopo:** correções da sonda executável e dos contratos 0.1.2, não entrega do core/plugin distribuível. Responde à [REVIEW-003](REVIEW-003.md), auditada em `8f844ed5798146c9626653627d67916df0737583`. O relatório original e suas evidências permanecem intactos.

A distinção é obrigatória: C01–C08 têm mudanças em componentes reais da sonda; C09–C11 corrigem contratos/DDL/modelos de um storage que ainda será implementado; C12 substitui o helper de canonicalização e acrescenta vetores fixos. Os 55 subcasos de produto não recebem PASS por essas provas incrementais.

## 1. Matriz de resolução

| Achado | Correção aplicada | Prova e limite |
|---|---|---|
| C01 | Oráculo independente compara todo o corpo retido, protocolo, resultados identificáveis e fontes públicas. | Controle correto mais seis mutantes de implementação no OpenCode stock; corrupção precisa reprovar por E_ORACLE, não timeout. |
| C02 | Codec inspeciona todas as partes; imagem/mídia/metadata opaca e variantes desconhecidas são recusadas antes da poda. | Execução das funções reais com texto+imagem e partes desconhecidas; não é homologação multimodal. |
| C03 | Revalidação também de replacements já publicados, não só ready. Mudança de config invalida a View reduzida da sonda e reidrata raízes verificadas. | Cenário real do host com síntese publicada antes da mudança de system; core futuro usa dependências content. |
| C04 | Vazio/whitespace vira E_NO_GAIN; estado não depende de truthiness. | Componentes e host provam desfecho terminal e novo job no mesmo tool loop, sem novo input humano. |
| C05 | Captures limitadas por sessão, total, bytes e TTL; chamadas vivas pinadas; pending é movido. | Cinco mil turnos sintéticos no componente real; contagem/bytes limitados e descarte após TTL. Não é medição de RSS. |
| C06 | Stream nativo validado; falha/cancelamento preserva epoch/View. Evento de sucesso aguarda nova base pública antes de avançar. | Host para reset HTTP e observação da base; gateway real isolado para 200+erro/truncamento/cancelamento/reload. |
| C07 | Abort de outbound, espera de drain, headers permitidos e dispose com espera limitada de handles. | HTTP/cliente real em loopback: 429/Retry-After, corpo silencioso cancelado, cliente lento e encerramento com request vivo. |
| C08 | JSON/SSE usam mesmo teto, UTF-8 fatal, shapes explícitos, erro/refusal e término estrito. | Limites exatos, byte a byte, erro SSE, múltiplas choices, ausência de DONE e duplicação de chaves. |
| C09 | ToolExecutionRef e chave única persistida, digests de argumentos/resposta, replay/conflito definidos. | DDL rejeita duplicata/conflito e conserva três calls diferentes. Restart/dedup do storage de produto segue nos WPs. |
| C10 | Archive schema 2: cobertura histórica é OriginCoverage opaca, nunca ref executável/local por adivinhação. | Modelo de round-trip conserva origem e recusa contradição; importer real continua por implementar. |
| C11 | Owner com liveness lock de SO e reconciliação por operação, sem TTL/PID como única prova. | Locks reais com processos próprios vivos/mortos para três tipos de reserva; reconciliação completa de FS/SQLite segue WP-02. |
| C12 | Canonicalização JCS com serializador JS compartilhado e ponte Python explícita. | Doze vetores fixos de bytes e cinco entradas inválidas/precisão; não são duas implementações independentes. |

## 2. O que mudou na força da evidência

O review demonstrou que 14/14 verde podia coexistir com resultados de ferramentas alterados. O novo `oracle.py` não importa o renderer: usa ingress anterior à projeção, recorder independente e o histórico público. O esperado conserva a cauda inteira, incluindo campos que não participam de simples contagens. Resultados de ferramentas têm valores distintos derivados de identidade pública da mensagem; igualdade textual não substitui identidade.

A campanha `test-oracle-mutations.py` cria cópias descartáveis. O código correto deve passar antes das seis mutações. Conteúdo alterado, remoção, duplicação, troca de ordem, metadata extra e instrução protegida alterada devem falhar com diagnóstico do oráculo. Falha de setup, timeout ou compilação não é mutação detectada com sucesso.

## 3. Fechamento do ciclo de vida

A nova sonda separa codec/parser, retenção de captures e transporte em módulos pequenos, usados diretamente pelo gateway e pelos testes de componentes. Isso evita copiar a mesma lógica para um mock e testá-lo como se fosse o adaptador.

A mudança de regras invalida também a visão publicada; vazio não fica indefinidamente pronto; retry wait é cancelável; dispose aguarda os handles locais. Reset não avança epoch apenas porque recebeu HTTP 200 ou um evento. O teste inicial das correções encontrou uma expectativa antiga de avanço no evento: foi corrigida para exigir base antiga até a chamada pública útil seguinte e só então a base nova. A primeira execução de 16 checks teve 15 pass e uma falha nessa expectativa; ela não é apresentada como aprovação.

Erros de 200/SSE, cancelamento com corpo silencioso e pressure de escrita foram exercitados em HTTP real local, com os módulos efetivos. O ensaio do host permanece restrito ao OpenCode oficial 1.18.31 e ao provider sintético. Não se extrapola isso para todos os SDKs, modelos, assinaturas, protocolos ou roteadores.

## 4. Contratos reparados antes do núcleo

C09 usa chave completa de execução, não conteúdo, para deduplicar recibos. IDs iguais em epochs/mensagens distintas não são a mesma leitura. Um replay ainda revalida autorização; o recibo não é cache de permissões. Campos e constraints do DDL acompanham o contrato.

C10 escolhe explicitamente o formato mínimo de arquivo somente leitura: RootRefs/logical IDs históricos são opacos de origem, preservados em OriginCoverage. Não há obrigação fictícia de reconstruir roots executáveis a partir do host antigo. Refs de fonte/capítulo/bloco citadas continuam resolvíveis no arquivo. Schema 1 anterior era rascunho sem importer; schema 2 o recusa explicitamente.

C11 usa liveness lock do owner, além do lock do workspace. Uma operação lenta e viva conserva seus pins; morte comprovada permite reconciliar staging/reader/export sob a mesma autoridade. Bytes só deixam a quota após remoção confirmada, e exportações concluídas não são confundidas com staging.

C12 remove `json.dumps` como serializador canônico final. Python é produtor/ponte para JS, e bytes esperados fixos são o oráculo. Números não representáveis pelo produtor não são arredondados silenciosamente. Texto original arquivado continua byte a byte, independentemente de canonicalização do control plane.

## 5. Reprodução e responsabilidade das provas

```sh
python3 scripts/check-spec.py
python3 scripts/check-reference-model.py
python3 scripts/test-spec-check.py
python3 scripts/check-canonical.py
python3 scripts/check-storage-contracts.py
node --test tests/conformance/opencode/test-components.mjs
```

Os comandos de host e mutação estão em [tests/conformance/opencode](../../tests/conformance/opencode/README.md). A [evidência da base corrigida](evidence/REVIEW-003-CORRECTED-HOST.json) contém 16 checks aprovados, versão/hash do binário oficial e hashes de cada fonte executada. Sua publicação foi precedida de comparação desses hashes com o checkout, não apenas de cópia de um relatório antigo.

Os testes de componente fecharam 12/12, os dez exemplos de referência e as dez mutações documentais passaram, os vetores canônicos fecharam 12 válidos/5 rejeições e os dois exemplos de storage passaram. O primeiro ensaio de mutações distinguiu o controle das seis implementações erradas; a campanha é repetida pela CI sobre o SHA do PR. Isso não é piloto com LLM nem certificado de todos os cenários do gate.

Os workflows executam verificações documentais, componentes reais e duas suítes separadas de host: integração normal e campanha de mutações. O merge das correções exige esses três workflows verdes no SHA efetivo. Prova local não substitui a execução Linux; o resultado definitivo do CI fica nos runs associados ao PR.

## 6. Revisão cruzada e limites restantes

Foram confrontados payloads versus oráculos, capture retention versus requests ativos, reset versus base pública, parser versus terminalidade, DDL versus identidade de recibos e arquivo versus proveniência. Os novos campos e obrigações foram ligados aos oráculos existentes em traceability.json, sem marcar testes futuros como concluídos nem criar DoDs circulares.

As correções são pequenas em responsabilidades, não uma nova plataforma: três módulos da sonda, um serializador compartilhado, oráculos negativos e refinamentos dos contratos. Não se promove esse código reduzido a implementação final do core. A licença/distribuição e a administração de branch protection continuam fora destes 12 achados e não foram alteradas silenciosamente.

Não houve inferência live, medição de cache, avaliação de qualidade semântica, acesso a credenciais de provider nem alteração da configuração pessoal. Os processos interrompidos pelos testes pertencem exclusivamente às fixtures. Algumas chamadas compostas de edição foram recusadas pela ferramenta; somente arquivos lidos de volta e execuções concluídas são contabilizados como trabalho realizado.

**Conclusão desta resolução:** C01–C08 corrigidos no escopo executável da sonda, C09–C11 fechados como contratos com provas de referência, C12 corrigido no helper e nos vetores. O WP-00 e os 55 subcasos do produto continuam com seus gates próprios; nenhuma release ou modo complete é autorizado por este relatório.

### Ajuste observado no CI Linux

A primeira execução do PR em Linux reprovou o teste de cliente lento: ele esperava mais de dois bloqueios de escrita enquanto mantinha o cliente sem ler. Um writer correto pode parar no primeiro bloqueio e não produzir o terceiro até liberar o cliente. O novo teste exige bloqueio observado, fila limitada, progresso após retomar leitura e encerramento após desconexão. Não foi removida a verificação de pressão, não houve aumento de timeout e o código de transporte permaneceu igual. As três execuções inicialmente falhas permanecem visíveis no CI.
