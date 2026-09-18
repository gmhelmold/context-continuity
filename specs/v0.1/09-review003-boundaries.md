# SPEC-09 — integridade e lifecycle após REVIEW-003

Normativo 0.1.2. Refina SPEC-01/02/04; a implementação da sonda não é o runtime distribuível. C09–C12 também alteram diretamente SPEC-01/03/05/07.

## 1. Oráculo independente e formatos recusados

C01: cada unidade preservada deve comparar papel, payload integral, call/result IDs, ordem e metadata. Contar mensagens ou copiar fielmente um pai já corrompido não prova integridade. O teste captura ingress imutável antes da projeção e compara egress num recorder separado; o esperado é calculado fora do renderer e confrontado com resultados distintos da API pública do host. Mutantes de conteúdo, remoção, duplicação, troca, metadata e instrução protegida precisam falhar por divergência explícita, não por timeout.

Esses traces completos são exclusivos de fixtures sintéticas. Não habilitar logs de prompts reais no produto para reproduzir o oráculo. A sonda e a implementação futura devem usar os mesmos critérios, não necessariamente o mesmo armazenamento de teste.

C02: inspecionar todas as partes nativas e wire. Grupo com mídia/parte opaca não suportada é integralmente protegido ou recusado ANTES de transformar. Extrair texto ignorando o restante não autoriza poda. No primeiro codec de ensaio, esses grupos são recusados; isso não declara suporte multimodal. Duplicação de IDs, protocolo incompleto e papel/metadata não reconhecido também não viram texto vazio.

## 2. Derivados e estado da proposta

C03: config/read_dependencies são revalidados tanto para ready como para a View já publicada. Mudança material cancela ready e invalida derivados; na sonda, qualquer mudança do config_digest invalida conservadoramente seus replacements. O core segue o fechamento content de SPEC-07. Se reidratar raízes verificadas não couber, bloquear explicitamente, nunca conservar silenciosamente regra antiga para manter cache.

C04: estado é explícito, não truthiness da síntese. Vazio/whitespace termina E_NO_GAIN; JSON inválido de proposta pode consumir somente o segundo AttemptPermit; truncamento/tool/refusal não é resumo. Síntese válida mantém seus bytes, sem trim. Terminal libera execução após local_stopped e permite oportunidade posterior elegível, sem exigir novo input humano.

## 3. Retenção de capturas

C05: defaults do primeiro perfil são quatro tokens inativos por sessão, 64 entradas totais incluindo pending, 32 MiB de payloads serializados retidos e TTL de retry de 30s. Pending é único por sessão e movido ao registro; não criar cópias cumulativas em outro Map. Requests ativos ficam pinados até fechar transporte. Se só há entradas vivas e faltar orçamento, recusar admissão; não evictar chamada em andamento.

Novo input/dispose retira associações obsoletas. Cada job conserva somente seu snapshot ativo; depois mantém metadados/referências. Bytes contabilizados são payloads serializados, não RSS/heap medido. O teste de milhares de turnos precisa medir bytes e handles retidos; não inferir isso de tokens enviados ao modelo. O ledger em disco e os traces sintéticos de teste têm política separada da RAM das captures.

## 4. Compactação nativa

C06: início, transporte, evento e observação da base são estados separados. HTTP 200 não confirma sucesso. Erro/truncamento/cancelamento termina a tentativa, conserva View/epoch e permite reconciliação. Evento de sucesso só avança epoch quando a base pública nova for identificada; a mesma base não avança duas vezes.

Após restart sem transporte vivo, conferir roots/base pública e reconciliar pending como sucesso observado ou ausência de nova base. Ambiguidade retorna E_CAPABILITY com saída nativa explícita; nunca uma trava invisível sem recuperação nem aplicação sobre base desconhecida. Testar a próxima chamada útil, não apenas a ausência de publicação. Corrigir uma expectativa de timing exige reforçar o oráculo da base observada, não tratar evento como prova suficiente.

## 5. Transporte primary

C07: todo outbound recebe AbortController e registro de handle. Desconexão do cliente, deadline e dispose encerram fetch/reader próprios, inclusive se o provider não entregar outro chunk. Pressão de escrita suspende leitura até drain ou abort; não acumular a resposta inteira. Não acrescentar retry transparente ao gateway.

Allowlist de resposta conserva content-type, Retry-After, request-id/x-request-id e rate-limit headers homologados. Não repassar auth, cookies, correlação, hop-by-hop ou length/encoding incompatíveis com a decodificação. Headers nominados por Connection também são retirados. Dispose aguarda encerramento dos handles locais por prazo finito e retorna erro de cleanup se não confirmar; incerteza de processamento remoto continua explícita.

## 6. Parser do auxiliar

C08: JSON e SSE usam o mesmo limite de 256 KiB no corpo decodificado e UTF-8 fatal. Erro upstream, refusal, múltiplas choices, shape desconhecido ou conteúdo após término são recusados. No perfil SSE fixado, finish_reason e `[DONE]` são obrigatórios; ausência ou truncamento não vira sucesso parcial. Eventos de usage sem choices só são aceitos no formato explícito conhecido. JSON com chaves duplicadas decodificadas é recusado antes de perder essa informação no parser.

Esse parser não executa ferramentas. Uma indicação de tool_call prevalece sobre texto que aparenta ser uma síntese válida. Limites e erros não podem consumir uma terceira requisição auxiliar fora do job.

## 7. Provas e limites

Componentes reais da sonda: `node --test tests/conformance/opencode/test-components.mjs`. Integração stock: runner documentado em tests/conformance/opencode. Mutações reais: `test-oracle-mutations.py`, com cópias descartáveis e provider sintético. O produto completo continua bloqueado pelo gate P01–P14; esses checks não aprovam automaticamente os 55 subcasos do core.

C09/C10/C11 são correções dos contratos de um storage ainda não implementado: há DDL e exemplos executáveis, não importer/GC de produção. C12 fixa bytes canônicos por vetores; a ponte Python usa o serializador JS compartilhado, sem fingir duas implementações independentes. A matriz de resolução distingue precisamente essas evidências.
