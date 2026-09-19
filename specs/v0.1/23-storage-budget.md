# SPEC-23 — orçamento lógico compartilhado de workspace (WP-02/F1)

Refina [SPEC-03](03-ledger.md#3-blobs-quota-e-exclusão-mútua-de-workspace), [SPEC-14](14-inline-root-retention.md) e [SPEC-18](18-workspace-coordinator.md). É contabilidade e diagnóstico do catálogo existente, não staging, GC, verificação de arquivos ou autorização de escrita.

## API e resultado

`WorkspaceCoordinator.readStorageBudget(): StorageBudget` retorna um objeto imutável, apenas com escalares:

| Campo | Significado |
| --- | --- |
| `quota_bytes` | Limite vigente fixo de 2147483648 bytes (2 GiB), sem override pela consulta. |
| `inline_bytes` | Soma dos comprimentos reais dos BLOBs inline, incluindo revisões históricas e sessões distintas. |
| `blob_bytes` | Soma dos tamanhos do catálogo blobs, uma vez por registro/digest, inclusive órfãos catalogados. |
| `reserved_bytes` | Soma de TODAS as reservas existentes, sem remover por kind, idade, sessão ou estado do owner. |
| `used_bytes` | Soma exata das três categorias; não truncada ao limite. |
| `remaining_bytes` | max(0, quota_bytes - used_bytes). |
| `over_quota` | used_bytes > quota_bytes. Igualdade é um workspace cheio, não excedente. |

Fonte indisponível sem conteúdo inline não é cobrada por seu size_bytes histórico. Bytes inline duplicados em registros distintos são cobrados em cada registro; referências múltiplas a um blob não duplicam o registro do catálogo. Reserva com tamanho zero cobra zero; não deduplicar reservas não nulas contra conteúdo já existente. A contabilização é conservadora, não uma sugestão de limpeza. Metadados de sessão/owner, índices e WAL não fazem parte desta quota de conteúdo.

## Snapshot e limite de autoridade

A API adquire o workspace lock e usa uma única transação de leitura, com guardas de identidade/owner e cleanup de SPEC-18. As três consultas agregadas retornam somente bytes/invalid; nunca retornam BLOBs, metadados textuais de fontes ou caminhos. Uma escrita WAL intercalada não mistura os valores de snapshots diferentes. Consultas posteriores veem os registros então confirmados; não existe cache de confiança.

Um resultado NÃO reserva capacidade, não renova lease e não pode ser usado como WorkspaceHold. Falha de consulta, COMMIT ou guarda impede entregar o resultado. ROLLBACK falho inutiliza a conexão pelas regras do coordenador. A consulta não altera fontes, reservas, custos de modelo, jobs ou owners e não executa rede ou reconciliação.

Os helpers SQL são internos ao pacote: exigem uma transação já aberta. `assertStorageCapacity(db, additionalBytes)` reconsulta a contabilidade na transação de escrita do chamador; não recebe um relatório anterior como permissão. Somente números inteiros não negativos e seguros são admitidos, sem coerção. O chamador mantém BEGIN IMMEDIATE até a inserção correspondente. Para operações de filesystem futuras, o workspace lock continua obrigatório ANTES dessa transação; este helper não o substitui nem demonstra por si só o modo IMMEDIATE.

## Integração com retenção

`retainSource` reutiliza o helper de capacidade antes de cada fonte nova, na transação IMMEDIATE existente de `retainRoots`. Uma fonte posterior excedente reverte também as anteriores e o relógio do lote. Duas sessões disputam a mesma quota SQLite, não contadores privados por sessão. A exportação anterior de WORKSPACE_CONTENT_QUOTA_BYTES permanece compatível, com uma única definição.

Igualdade no limite é aceita. Novo conteúdo vazio é permitido com quota exatamente cheia, mas recusado quando o workspace já está acima do limite. Replay exato de uma fonte existente mantém a regra anterior: verifica o conteúdo/metadados, não reserva novos bytes e pode ocorrer acima do limite. Não é autorização para recapturar fonte indisponível, mudar política ou revogar tombstones.

## Dados inconsistentes e limites

BLOB inline é medido em bytes; TEXT indevido não pode ser contado como caracteres. Tamanhos de blobs/reservas precisam ter tipo SQL integer e valor não negativo, sem arredondar, converter ou ignorar parcelas inválidas. Totais precisam caber em inteiros seguros de JavaScript, inclusive a soma entre categorias. Falha/overflow SQL é sanitizado como E_STORAGE; nunca vira zero ou capacidade livre. Um estado válido acima da quota continua diagnosticável com over_quota=true.

Este serviço não autentica digests, existência ou tamanho real de arquivos externos, completude das referências, identidade de owners alheios ou autorização de reservas. Arquivos finais não catalogados, resíduos físicos, backups, WAL, páginas livres e metadados exigem os serviços próprios de reconciliação/GC. O resultado NÃO é espaço livre do disco, teto global de RSS ou demonstração de que staging/blobs já funcionam. A futura admissão de staging precisa reconciliar e contabilizar seus arquivos antes de publicar referências.

SQL pode percorrer todos os registros; três linhas escalares retornadas não significam I/O ou latência constante. Não há benchmark nesta entrega.

## Provas e cinco axiomas

**Success Criteria:** diagnóstico e retenção usam a mesma quota e os mesmos bytes; relatório antigo não permite exceder o limite.

**Quality Standards:** SQLite/locks reais, fontes inline reais, linhas sintéticas de catálogo explicitamente identificadas, erros classificados, contraprovas nomeadas e execução exclusivamente Actions.

**Completeness Criteria:** vazio, categorias/sessões/revisões, todas as reservas, limite inclusivo/excesso, replay, rollback de lote, dados/totais inválidos, isolamento de snapshot, concorrência, restart e falhas de leitura/cleanup.

**Definition of Done:** implementação compartilhada, API e tipo integrados; testes e contratos versionados; matriz do head final e contraprovas aprovadas; revisão registrada; árvore integrada igual à testada; issue #5 atualizada sem concluir o WP-02 inteiro.

**Invariants:** nenhuma reserva liberada por diagnóstico, nenhum conteúdo publicado/apagado, nenhum orçamento aumentado, nenhuma capacidade fabricada a partir de dados persistidos, nenhum staging ou GC anunciado como concluído.

[Implementação, blast radius e evidências](../../docs/implementation/WP-02-F-STORAGE-BUDGET.md).
