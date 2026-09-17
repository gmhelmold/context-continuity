# SPEC-05 — ferramentas, âncoras e experiência

Normativo. Nomes e exemplos são interfaces propostas; nenhum comando está instalado/publicado nesta entrega.

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
    status: "published" | "superseded" | "withdrawn"
    excerpt: string
    source_refs: SourceRef[]
  }>
  search_backend: "literal" | "fts5"
  partial: boolean
  next_cursor: string | null
}
```

Excluir withdrawn por padrão. Superseded pode aparecer como histórico com status explícito; não apresentá-lo como decisão vigente. Ordenação deve ser estável para a mesma revisão/query: score do backend, depois created_at desc e chapter_id asc. Sem score no backend literal, usar recência e ID. Resultados vazios são sucesso com array vazio, não texto inventado.

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

Cursores são opacos e vinculados por HMAC a installation/workspace/session, query ou fonte/revisão, limite, próxima posição e validade de 15 minutos. Chave local privada não é exportada. Cursor inválido, alterado ou expirado gera E_CURSOR; não começa do início silenciosamente. Alteração do índice durante uma página exige novo cursor/snapshot ou erro explícito, nunca pular/duplicar resultados sem indicar.

## 3. Wrappers e proveniência

Texto do ledger é saída de tool com identificação de fonte histórica e autoridade original. Não injetar esse texto como system ou nova mensagem do usuário. Escapar a estrutura do envelope; marcações dentro do documento são dados, não instruções para o harness. Citação do capítulo não prova validade atual de fatos de código ou conclusão de tarefa.

Ao devolver trecho, informar sua revisão e que a síntese pode estar superseded. Uma decisão vigente vem do contexto atual/âncora autorizada; a tool não escolhe arbitrariamente entre versões conflitantes.

## 4. Operações de bloco

Blocos possuem `block_id`, version, kind, authority, text/digest, source_refs e scope. Scope é `session`, `task(task_id)` ou `phase(phase_id)`; IDs do fluxo autorizado, não nome livre inferido pelo clone.

- `pin`: cria presence/reference por ação explícita do usuário ou política já autorizada. Texto literal de presence fica fora da compactação; reference mantém descrição curta e SourceRef.
- `activate`: ativa versão específica de bloco curado. Não acompanha mudanças de arquivo em silêncio.
- `replace`: exige expected_version, preserva versão anterior no ledger, incrementa policy_revision.
- `unpin/deactivate`: exige autoridade equivalente à criação; gera versão/estado novo e cancela jobs antigos.
- Expiração: task/phase termina somente por evento autorizado do fluxo, ou ação do usuário. O maintainer não decreta fim da tarefa para liberar espaço.

Limites iniciais: 32 blocos ativos; 8192 tokens totais OU 5% de B, o menor dos dois, incluindo wrappers. Cada texto até 16 KiB. Exceder produz E_BUDGET e não ativa parcialmente um conjunto. Usuário pode mudar orçamento explicitamente; não existe descarte automático da âncora mais antiga.

Ordenação estável por ordem de ativação + block_id. Inserir bloco novo sem reorganizar todo o prefixo; manter conteúdo/versionamento estáveis até atualização. Um bloco já incluído na mesma versão não é duplicado a cada tool call. Desativação/revogação prevalece sobre cache: remoção legítima pode invalidar prefixo.

O núcleo propaga aos workers apenas o conjunto que o host/fluxo consegue associar à tarefa. Sem identidade de tarefa, usar escopo de sessão ou não propagar; nunca adivinhar autorização. O primeiro plugin não requer alterar a implementação de todos os workers. A versão do contrato efetivamente enviada é registrada quando observável.

## 5. Feedback: poda 30 → poda 31

Uma leitura bem-sucedida registra `retrieval_id`, capítulo/fonte/intervalo, digest do texto efetivamente devolvido, reason, declared_by e tarefa/etapa quando disponível. Busca sem leitura não é uma recuperação corretiva.

A próxima manutenção recebe até 32 recibos ainda não consumidos, com teto de 2048 tokens, mais até oito notas temporárias de retenção. Ordenar primeiro correções explícitas do usuário, depois omitted_rule/missing_detail, depois repetições, depois lookup recente. Deixar o restante no ledger; não carregá-lo indefinidamente no contexto ativo.

Repetição é definida, inicialmente, como três leituras da mesma SourceRef e de intervalos sobrepostos em ao menos uma linha entre as últimas 32 leituras, no mesmo escopo de tarefa/phase. Isso sugere retenção, não prova erro da poda. Só um recorte de até 400 caracteres por nota é candidato; no máximo 2048 tokens de notas no total.

Nota de retenção criada pelo maintainer tem authority=agent e não vira âncora do usuário. Expira ao terminar o escopo autorizado ou após duas novas publicações de capítulos, o que ocorrer primeiro. Sem escopo conhecido, usar a expiração por capítulos. Atualização por uso real cria nova nota dentro do orçamento, não crescimento infinito.

Recibos são marcados consumed_by_job somente quando a proposta é publicada; falha/noop não apaga feedback. `feedback_applied` cita apenas recibos entregues. O campo indica que o resumidor diz tê-los considerado, não prova de fidelidade. Correção de regra do usuário exige atualização autorizada, não promoção automática baseada num reason do agente.

## 6. Comandos propostos para o usuário

Interface lógica (CLI/painel do adaptador; ainda não executável):

| Ação | Entrada mínima | Efeito/saída |
|---|---|---|
| inspect | sessão autorizada | modo, perfil, U estimado, T, quotas, view/epoch, job, últimos capítulos e blocos. |
| compact | sessão | oportunidade forçada; mesmas verificações de segurança; retorna job ou motivo de recusa. |
| pause | sessão | cancela manutenção pendente; overlay e consulta continuam. |
| resume | sessão | revalida capacidades/configuração; não renova quotas automaticamente. |
| pin/activate/replace/deactivate | bloco/versão + scope | alteração atômica com autoridade registrada. |
| restore | capítulo/trecho + expected_view_revision | nova visão sob orçamento; não desfaz ações externas. |
| disable --prepare | sessão | handoff de saída por caminho público verificado; recusa quando não seguro. |
| export | sessão + destino local autorizado | manifesto/arquivo novo privado; nunca sobrescreve destino existente por default. |
| delete | escopo explícito + confirmação humana | cancelamento e exclusão lógica; impossível a tool de leitura executar. |
| doctor | perfil/instalação | capacidades e motivos; diagnóstico não inicia chamadas pagas automaticamente. |

Colisão de comandos/tools com o host aborta registro daquela superfície; não substituir tool padrão inadvertidamente. CLI/painel nunca pede ao modelo para escolher credencial, diretório raiz ou outra sessão.

## 7. Saída e desinstalação

Pause é reversível e não reidrata transcript. Disable preparado deve: parar jobs; aguardar/cancelar a geração auxiliar; verificar a visão que o host usará sem o plugin; manter âncoras/pendências no handoff autorizado; usar compactação/checkpoint pública se necessário; confirmar o novo limite; só então indicar seguro remover o plugin.

Quando o host não permite persistir handoff por API pública, retornar E_CAPABILITY e explicar que a sessão precisa passar por compactação nativa antes da remoção. Não modificar arquivos internos. Remoção abrupta não pode ser impedida e não faz o plugin continuar executando depois de desinstalado. Documentar o fallback nativo testado; não alegar que uma garantia continua ativa quando seu código não está mais carregado.

Restore cria revisão nova e mantém a cauda atual. Se o trecho não couber, oferecer leitura seletiva fora do contexto/por tool e retornar E_BUDGET; não esconder outras regras para fazê-lo caber. Nenhum restore reexecuta tools ou reverte commits.

## 8. Visibilidade mínima

Mostrar ocupação estimada separada de tokens cacheados/custo. “Resumo preparado”, “visão publicada” e “entrada observada” são estados distintos. Campos de uso indisponíveis ficam `desconhecido`, não zero. Não emitir uma mensagem conversacional em cada poda; painel/status discreto é suficiente.

Alertas necessários: pausa por quota, erro persistente, falta de fonte/disk, overflow/espera, conflito de âncora, capacidade perdida após upgrade e necessidade de handoff. Uma falha isolada de manutenção mantém a sessão útil quando há orçamento. Métrica de valor: tarefas aceitas antes de intervenção corretiva, não número de resumos produzidos.

Aceitação: T21–T27, T31–T32, T36–T38. Sem teste de obediência perfeita do modelo: testa-se presença, autoridade, escopo e comportamento de recuperação.
