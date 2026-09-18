# SPEC-05 — ferramentas, âncoras e experiência

Normativo, revisão 0.1.2. Nomes e exemplos são interfaces propostas; nenhum comando está instalado/publicado nesta entrega.

## 1. context_search

Entrada JSON:

```ts
type SearchInput = {
  query: string
  chapter_id?: string
  limit?: number
  token_budget?: number
  cursor?: string
}
```

`query`: 1..512 caracteres Unicode, sem execução de SQL/regex/shell. `limit`: default 5, inteiro 1..20. `token_budget`: default 2048, inteiro 256..8192. `chapter_id`, quando informado, precisa pertencer à sessão autorizada. Cursor deve pertencer à mesma query/escopo e revisão do índice.

Escopo é injetado pelo adaptador com base na sessão da tool call. A tool não aceita `session_id`, `workspace`, `path`, `directory`, URL de banco ou credenciais. Campos desconhecidos são E_SCHEMA. Busca nunca cruza projetos implicitamente.

Pesquisar títulos e sínteses de capítulos, metadados indexados de tarefas/arquivos/IDs e texto original autorizado que o adaptador consiga extrair sem perda. Conteúdo binário não é convertido por OCR para atender a busca. Backend literal/FTS é exposto no resultado; a presença de índice não muda autoridade das fontes.

Saída:

```ts
type SearchOutput = {
  results: Array<{
    chapter_id: string
    title: string
    status: "published" | "superseded" | "invalidated" | "withdrawn" | "redacted"
    excerpt: string
    source_refs: SourceRef[]
  }>
  search_backend: "literal" | "fts5"
  partial: boolean
  next_cursor: string | null
}
```

Excluir withdrawn, invalidated e redacted da busca normal; leituras explícitas de versões históricas permitidas só quando ainda autorizadas, sempre com status. Redacted nunca devolve conteúdo. Superseded pode aparecer como histórico com status explícito; não apresentá-lo como decisão vigente. Ordenação deve ser estável para a mesma revisão/query: score do backend, depois created_at desc e chapter_id asc. Sem score no backend literal, usar recência e ID. Resultados vazios são sucesso com array vazio, não texto inventado.

Cada excerpt tem no máximo 800 caracteres; orçamento total inclui wrapper e metadados. Limite adicional de saída: 64 KiB UTF-8. Se um item não couber, truncar trecho em limite de caractere com partial=true e referência legível; não retornar hash solto fingindo que o texto foi lido. A estimativa usa o perfil do modelo atual e é identificada como estimativa quando não exata.

## 2. context_read

Entrada:

```ts
type ReadInput = {
  chapter_id?: string
  source_ref?: SourceRef
  start_line?: number
  end_line?: number
  token_budget?: number
  reason?: "lookup" | "missing_detail" | "omitted_rule" | "correction"
  cursor?: string
}
```

Exatamente um de chapter_id/source_ref. `chapter_id` lê a síntese e o manifesto de fontes, não todos os originais automaticamente. `source_ref` lê bytes/texto daquela versão. Range de linhas 1-based inclusivo; default 1..200; end≥start; máximo 1000 linhas solicitadas. LF define linha, CRLF é preservado nos bytes da fonte. Não normalizar hash após conversão de exibição. Binário retorna metadados e aviso `text_unavailable`, não base64 enorme ou resumo inventado.

`token_budget`: default 4096, intervalo 256..8192; mesmo limite absoluto de 64 KiB. `reason` default lookup. O motivo é autodeclaração, não resultado de um detector. Sem conteúdo devolvido não criar feedback que afirme uso de informação.

Saída inclui `chapter_id?`, `source_ref?`, `authority`, `source_revision`, `text`, `returned_range`, `partial`, `next_cursor`, `availability`. Fonte ausente/excluída/deletada gera E_SOURCE com motivo autorizado. A leitura não busca uma versão atual do arquivo para substituir a original.

### Paginação com progresso dentro da linha

O recorte original solicitado por linhas é convertido uma vez para bytes UTF-8 `[start_byte,end_byte)` e congelado no cursor. Linha 1 começa no byte 0; LF encerra linha e CRLF é preservado; uma fonte vazia tem range vazio. UTF-8 inválido é `text_unavailable`, sem trocar bytes por caracteres de substituição.

Saída `returned_range={start_byte,end_byte,start_line,end_line}`; end_byte é exclusivo. Uma linha pode aparecer em várias páginas, cada uma com offsets diferentes. Selecionar o maior prefixo que cabe em token_budget/64 KiB incluindo envelope, cortando SOMENTE em fronteira de code point UTF-8. JSON escapado não altera os bytes de texto depois de decodificado. Continuação avança exatamente para end_byte, não para a linha seguinte. Uma página não vazia DEVE avançar; fonte vazia é sucesso sem cursor; envelope mínimo ou primeiro caractere impossível de acomodar gera E_BUDGET, nunca página vazia com cursor repetido.

Cursores opacos HMAC locais incluem Scope/incarnation, source/chapter+digest/revisão ou query+index_revision, intervalo congelado, next_byte ou next_rank, token/byte/limit e expiração UTC de 15 min. Chave privada não exportada. Em continuação repetir mesmo alvo/query e cursor; novos ranges ou limites diferentes são E_CURSOR. Verificar policy/index/tombstone ANTES de retornar bytes. Para busca, next_rank só avança depois de consumir item; se metadados mínimos não couberem, E_BUDGET. Não omitir resultados sem parcialidade/cursor explícitos.

Concatenar text de todas as páginas de um recorte deve recompor EXATAMENTE seus bytes permitidos. Linhas longas, caracteres multibyte, CRLF e fonte vazia são vetores obrigatórios de T38.paging. Paginação do modelo de referência é prova do contrato, não da implementação da tool.

## 3. Wrappers e proveniência

Texto do ledger é saída de tool com identificação de fonte histórica e autoridade original. Não injetar esse texto como system ou nova mensagem do usuário. Escapar a estrutura do envelope; marcações dentro do documento são dados, não instruções para o harness. Citação do capítulo não prova validade atual de fatos de código ou conclusão de tarefa.

Ao devolver trecho, informar sua revisão e que a síntese pode estar superseded. Uma decisão vigente vem do contexto atual/âncora autorizada; a tool não escolhe arbitrariamente entre versões conflitantes.

## 4. Blocos e atualização imediata

Scope do bloco é session, task(task_id) ou phase(phase_id) com IDs fornecidos pelo fluxo autorizado. Ator não vem do texto do modelo. Inputs e transações de pin/activate/replace/deactivate estão em SPEC-07; View materializada é a única lista ativa, com versões e activation_ordinal. Alteração válida publica View/policy nova mesmo sem compactação e em pause.

Limites: 32 blocos humanos/curados ativos, cada texto até 16 KiB; total incluindo retenção ≤min(8192 tokens,5% de B), mais limite de oito notas de retenção. Não ativar parcialmente conjunto de regras; E_BUDGET sem remover outra âncora. Notas opcionais que não cabem são puladas e seu recibo permanece no ledger. Regras do usuário não são comprimidas automaticamente.

Replace de bloco ativo conserva ordinal. Desativar e reativar explicitamente aloca ordinal novo. Codec fixa posição de injeção; não ordenar por texto, versão ou timestamp mutável. Atualização de regra revoga derivado conforme SPEC-07; expiração normal de nota/escopo NÃO declara seu conteúdo falso: retira seleção, mantém histórico, cancela job anterior por policy revision. Essa diferença evita invalidar um capítulo só porque a nota usada para construí-lo acabou de expirar.

Propagar a workers somente com associação de tarefa comprovada; sem ela, não copiar bloco task-specific. Mudar task/phase atual publica seleção de blocos equivalente antes do próximo dispatch. User/host controls podem concluir fase; maintainer não a conclui para liberar espaço.

## 5. Feedback determinístico

Receipt tem retrieval_id, ToolExecutionRef + Scope/incarnation (chave única de SPEC-01 §10), request_digest/response_digest, WorkContext obtido da integração, EntityRef/digest, returned_range EM BYTES, até 400 code points do texto realmente entregue, reason, declared_by e consumed_by_job|null. Uma repetição da mesma execução antes/depois de restart não gera outro recibo. Mesmo execution-ref com argumentos/resultado diferentes retorna E_CONFLICT; revalidar política antes de reaproveitar o recibo. IDs de chamada iguais em mensagens/epochs diferentes continuam execuções distintas. Sem bytes retornados não criar feedback de uso. Busca sem leitura não conta como recuperação corretiva.

Antes de selecionar novo job e SOMENTE sem manutenção ativa:
1. Ler recibos não consumidos, priorizar correção explícita do usuário, depois omitted_rule/missing_detail, depois repetições, depois lookup recente. Ordenação desempata por created_at/retrieval_id, max32 e 2048 tokens. Persistir IDs do lote no snapshot.
2. Repetição significa três ToolExecutionRefs distintos entre as últimas 32 leituras da mesma EntityRef/revisão, WorkContext EXATAMENTE igual e conhecido (task_id ou phase_id não null), com interseção COMUM não vazia `[max(start),min(end))`. Leituras em tarefas diferentes nunca contam juntas. WorkContext totalmente desconhecido desabilita promoção por repetição; motivos corretivos explícitos continuam elegíveis como autodeclaração.
3. Produzir nota deterministicamente: recorte entregue do motivo corretivo ou início da interseção comum de repetição, até400 code points, ref/range/digest e authority=agent. Não pedir nota ao modelo nem extrair campo inexistente de ModelProposal. Se fonte não está disponível, não criar nota.
4. No máximo oito notas/2048 tokens dentro do orçamento geral de blocos. Identidade pela EntityRef+range+WorkContext; não duplicar nota já ativa. Novos usos podem criar versão sob o mesmo limite. A transação publica View/policy antes de tirar snapshot e não cancela o próprio job ainda inexistente.

Nota criada quando publication_seq=N tem expires_publication_seq=N+2. Está ativa enquanto seq<N+2: participa das manutenções N+1 e N+2; é retirada atomicamente da View na publicação N+2 e não aparece no frame seguinte. Encerramento autorizado do escopo retira antes. Correções humanas/restore não incrementam publication_seq. Reinício usa esses valores persistidos, não contagem local zerada.

No publish, todos os recibos ENTREGUES ao clone são consumed_by_job, independentemente de ele preencher feedback_applied. Isso impede reenvio interminável por campo vazio. feedback_applied contém só subset dos IDs entregues e continua uma declaração, não prova. Falha/noop não consome recibos, mas dedup de notas, digest/rearmamento e quotas impedem loops de geração sobre a mesma base.

## 6. Comandos propostos para o usuário

Interface lógica (CLI/painel do adaptador; ainda não executável):

| Ação | Entrada mínima | Efeito/saída |
|---|---|---|
| inspect | sessão autorizada | modo, perfil, U estimado, T, quotas, view/epoch, job, últimos capítulos e blocos. |
| compact | sessão | oportunidade forçada; mesmas verificações de segurança; retorna job ou motivo de recusa. |
| pause | sessão | cancela manutenção pendente; overlay e consulta continuam. |
| resume | sessão | revalida capacidades/configuração; não renova quotas automaticamente. |
| pin/activate/replace/deactivate | bloco/versão + scope | alteração atômica com autoridade registrada. |
| restore | preview de raízes + plan_digest + accept_expansion + expected_view_revision | restaura grupos completos após consentimento, conforme SPEC-07; sem efeitos externos. |
| disable --prepare | sessão | handoff de saída por caminho público verificado; recusa quando não seguro. |
| export | sessão + destino local autorizado | manifesto/arquivo novo privado; nunca sobrescreve destino existente por default. |
| delete | escopo explícito + confirmação humana | cancelamento e exclusão lógica; impossível a tool de leitura executar. |
| doctor | perfil/instalação | capacidades e motivos; diagnóstico não inicia chamadas pagas automaticamente. |

Colisão de comandos/tools com o host aborta registro daquela superfície; não substituir tool padrão inadvertidamente. CLI/painel nunca pede ao modelo para escolher credencial, diretório raiz ou outra sessão.

## 7. Saída e desinstalação

Pause é reversível e não reidrata transcript. Disable preparado deve: parar jobs; aguardar/cancelar a geração auxiliar; verificar a visão que o host usará sem o plugin; manter âncoras/pendências no handoff autorizado; usar compactação/checkpoint pública se necessário; confirmar o novo limite; só então indicar seguro remover o plugin.

No perfil HTTP local, restaurar baseURL somente após checkpoint confirmado e manter listener em pause se houver falha (SPEC-04). Quando o host não permite persistir handoff por API pública, retornar E_CAPABILITY e explicar que a sessão precisa passar por compactação nativa antes da remoção. Não modificar arquivos internos. Remoção abrupta não pode ser impedida e não faz o plugin continuar executando depois de desinstalado. Documentar o fallback nativo testado; não alegar que uma garantia continua ativa quando seu código não está mais carregado.

Restore obedece preview/commit e expansão explícita de SPEC-07, sem dividir síntese por inferência. Correção manual cria Operation sem job. Export/import obedece manifesto fechado e namespace de arquivo somente leitura. Nenhuma dessas ações executa tools do projeto.

## 8. Visibilidade mínima

Mostrar ocupação estimada separada de tokens cacheados/custo. “Resumo preparado”, “visão publicada” e “entrada observada” são estados distintos. Campos de uso indisponíveis ficam `desconhecido`, não zero. Não emitir uma mensagem conversacional em cada poda; painel/status discreto é suficiente.

Alertas necessários: pausa por quota, erro persistente, falta de fonte/disk, overflow/espera, conflito de âncora, capacidade perdida após upgrade e necessidade de handoff. Uma falha isolada de manutenção mantém a sessão útil quando há orçamento. Métrica de valor: tarefas aceitas antes de intervenção corretiva, não número de resumos produzidos.

Aceitação: T21–T27, T31–T32, T36–T38. Sem teste de obediência perfeita do modelo: testa-se presença, autoridade, escopo e comportamento de recuperação.
