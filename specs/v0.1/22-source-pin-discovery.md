# SPEC-22 — descoberta paginada de pins ativos (WP-02/E4)

Refina [SPEC-21](21-source-pins.md) e [SPEC-18](18-workspace-coordinator.md). A recuperação E3 exige um binding e um ID já conhecidos; E4 permite descobri-los após reinício sem varrer fontes ou reconstruir IDs a partir de arquivos. Não é GC, reader de blobs, limpeza automática, busca de conteúdo ou nova autorização.

## API e perfil

`WorkspaceCoordinator.listSourcePins({limit, after?}): SourcePinPage` é diagnóstico interno de todo o workspace local da instância. `limit` é inteiro entre 1 e 64, inclusive. `after`, quando presente, deve ser UUID canônico; null, string vazia, coerção, campo extra ou accessor são recusados. Não aceita outro workspace, caminho, SQL, offset ou filtro de proprietário. Tipos públicos: `SourcePinPageRequest`, `SourcePinPage`, constante `MAX_SOURCE_PIN_PAGE_SIZE=64`.

Retorno imutável: `{pins: readonly SourcePin[], next_after: string|null}`. Inclui reservas read_pin/export_pin ativas, de qualquer participante e sessão daquele workspace, com seu binding original. Exclui staging e envelopes released sem reserva ativa. Não transforma o estado registrado `active` em prova de que o participante está vivo.

A seleção usa `storage_reservations` com `reservation_id > after`, ordem lexical crescente e LIMIT de `limit+1`. Verifica a entrada extra antes de indicar continuação; ela não é devolvida nem consumida. Havendo mais resultados, next_after é o ID do último pin DEVOLVIDO. Caso contrário, null. A primeira página omite after. UUIDs fornecem ordem estável de chave, não ordem cronológica.

## Integridade e autoridade

O parser compartilhado de source-pins valida envelope/digest, reserva correspondente e process_instance. Cada entrada selecionada, inclusive lookahead, precisa estar ativa, pertencer ao workspace da instância e referenciar um storage owner registrado active. Campo persistido inconsistente é E_STORAGE; nenhuma página parcial é devolvida e nenhuma entrada selecionada é silenciosamente omitida. A validação não resolve identidade física ou lock dos participantes listados: essa inspeção continua obrigatória em recoverSourcePin.

A descoberta não exige a política atual ou existência atual da sessão/fonte: bindings históricos e pins retidos após tombstone continuam visíveis para limpeza explícita. Isso não autoriza retornar conteúdo antigo. readPinnedSource ainda exige participante original, política e bytes verificados; recoverSourcePin ainda executa integralmente E3 para cada ID. Não adquirir locks dos owners listados ou aposentá-los durante a listagem.

Ordem: validar opções -> workspace flock -> BEGIN de leitura -> selecionar e validar registros no mesmo snapshot -> guardas finais -> COMMIT -> soltar flock -> retorno. Falha de guarda, COMMIT ou liberação impede retorno normal da página. Não iniciar transação de escrita, alterar relógios/quotas/pins, ler BLOBs ou executar inferência por efeito dessa consulta.

## Paginação e limites de prova

Cada página materializa no máximo 65 IDs e valida no máximo 65 envelopes, cada um sujeito ao limite existente de 16 KiB. Não lê histórico de envelopes released nem fontes/raízes. Isso limita o trabalho de materialização da aplicação, NÃO é promessa de I/O físico constante ou de custo constante do plano SQL; a seleção pode examinar reservas staging enquanto percorre a chave primária. Não modifica DDL ou adiciona índice sem migração.

Uma página tem um snapshot consistente; páginas diferentes NÃO compartilham snapshot. Liberações e admissões entre chamadas são permitidas. Remover o pin usado como cursor não desloca os próximos resultados. Novos IDs menores ou iguais ao cursor não aparecem naquela continuação; iniciar outra varredura para observá-los. next_after é posição de consulta, não handle de autoridade, compromisso sobre resultados futuros ou prova de inventário completo.

A listagem parte das reservas existentes: não audita envelopes órfãos cuja reserva sumiu, reservas alteradas para staging, outras tabelas ou registros além da janela selecionada. Esses casos mantêm as verificações por ID e os gates de integridade próprios. Falha de leitura não apaga ou repara metadados. Reinício não adota os pins do participante antigo nem os libera por TTL.

## Cinco axiomas

**Success Criteria:** uma nova instância descobre bindings/IDs retidos e pode solicitar E3 separadamente, sem transferir propriedade ou repetir trabalho.

**Quality Standards:** SQLite, locks e processos reais; dados sintéticos; testemunha Python; controles negativos com assertion identificada. Toda compilação, typecheck e teste ocorre no GitHub Actions.

**Completeness Criteria:** vazio, limites inclusivos, cursor estrito, lookahead, imutabilidade, sessões/epochs, política/tombstone, corrupção/escopo/owner, concorrência entre páginas, snapshot único por página, erros de COMMIT/guarda/unlock, reinício e preservação de dados/custos.

**Definition of Done:** contrato/código/testes alinhados; sete workflows e dez jobs do head final aprovados, logs conferidos; árvores testada/integrada correspondentes; registro na issue #5. Não conclui WP-02 inteiro nem homologa host completo.

**Invariants:** diagnóstico não é liveness/permite de leitura/liberação; sem BLOB, rede, coleta, exclusão, estorno, mudança de DDL ou escrita causada pela listagem; sem continuação que consuma o lookahead.

Registro de execução: [WP-02/E4](../../docs/implementation/WP-02-E-PIN-DISCOVERY.md). Resultados são associados ao commit efetivamente executado, não à existência dos arquivos de testes.
