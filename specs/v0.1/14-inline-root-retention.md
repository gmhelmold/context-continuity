# SPEC-14 — retenção inline e mapa durável de raízes (WP-02/B)

Adendo de SPEC-03/13. Persistência local de conteúdo fornecido explicitamente pela integração; nenhuma leitura arbitrária de arquivos, rede, ferramenta do modelo ou alteração no host.

## API e fronteira

SqliteSessionStore acrescenta readRootCatalog(binding), readRoot(binding,ref), readSource(binding,ref) e retainRoots(lease,batch). O batch contém expected_catalog_digest, sources e observations. A sessão deve existir; todas as escritas exigem o proprietário/fence/deadline atuais, revalidados dentro da mesma transação. O digest esperado é obtido antes de preparar o batch; divergência é E_CONFLICT, sem atualização parcial. Snapshot/job/publicação não são autorizados por este resultado.

Fontes são {ref,native_refs,media_type,bytes}; ref contém ID/revisão/digest do núcleo. Bytes são copiados antes da transação, sem normalização. SHA-256 deve coincidir. Primeiro registro de uma fonte tem revisão zero; novo conteúdo exige a próxima revisão. Mesma revisão é idempotente somente com os mesmos bytes e metadados; indisponibilidade nunca é convertida em captura. Fonte vazia é BLOB vazio, não NULL. Leituras revalidam digest/tamanho/disponibilidade e entregam cópia dos bytes. Nunca buscar no disco uma fonte ausente.

## Limites deste perfil

Somente fontes inline de até 256 KiB, incluindo a fronteira. Acima disso, E_CAPABILITY; não truncar nem criar blobs sem locks/staging. Até 64 fontes e 128 observações, no máximo 4 MiB de material por lote. Quota lógica de workspace de 2 GiB contabiliza conteúdo inline, catálogo de blobs e reservas existentes na transação; não é contagem do tamanho físico de WAL/índices/backups. Este perfil não cria arquivos externos, reservas nem GC; por isso todas as alterações que realiza são protegidas por BEGIN IMMEDIATE. Não substitui o lock de filesystem para as operações futuras de blobs.

## Raízes e atomicidade

RootIdentityRegistry do núcleo produz IDs/digests/revisões; não reimplementar sua fórmula em storage. Todos os sources referenciados por uma observação submetida precisam existir, capturados e verificados por bytes/hash no MESMO escopo antes da gravação. O índice anterior confere estrutura das raízes e metadados/disponibilidade/digest declarado de todas as suas referências, mas não relê seus BLOBs não afetados. Raiz sem fonte permanece protegida conforme o núcleo. Falha numa fonte, observação ou inserção de raiz reverte o lote inteiro e o relógio transacional.

root_units conserva revisões anteriores. O índice corrente é MAX(revision) por identidade nativa, dentro da sessão/epoch; record_json contém a RootUnit e deve concordar com suas colunas relacionais. Alteração apenas de locator/estimativa atualiza metadados da mesma revisão sem reescrever conteúdo semântico. Leitura histórica usa RootRef explícita. Não há remoção de raízes ao omiti-las no lote; não é substituição do catálogo inteiro.

O catálogo de storage tem ordem determinística por native_identity em code units UTF-16. NÃO representa a cronologia do prompt; esta vem da captura do host. Assim o catálogo reaberto conserva digest independente de ordem de SELECT/rowid. O registro de memória mantém sua própria ordem de descoberta; a fronteira de storage normaliza a ordem do catálogo, não a das mensagens.

## Não prometer o que esta camada não faz

Guardar fonte e payload_digest não demonstra que a integração capturou todo o envelope ou que os bytes são verdadeiros. payload_ref continua locator opaco, não permissão de acesso a arquivo. Conteúdo binário pode ser retido mas sua elegibilidade de poda depende do codec. Retenção de revisões não é redação; exclusão/transição de policy e invalidação dos derivados pertencem às operações de SPEC-07. A leitura confere os tombstones/escopo atuais; nenhum callback os remove.

Não cria jobs, chapters, View nova ou inferência. O publicador futuro deve validar dependências e cobertura ATUAIS em sua própria transação. Não há homologação de um ledger distribuível, arquivo portátil, blobs ou perdas elétricas por testes de processo.

## Provas de conclusão do incremento

SQLite real: vazio/Unicode/binário exatos, fontes+raízes atômicas, revisões repetidas/editadas e reabertura em processo novo, conflitos de catálogo, proprietário expirado, isolamento, fonte ausente/indisponível/corrompida, quota compartilhada e fonte acima do cap. Injetar falha de INSERT e interromper apenas processo próprio antes/depois de COMMIT. Controle correto deve passar; mutações que eliminam verificação de fonte, CAS ou ownership devem falhar pela assertion apropriada. WP-02 agregado permanece aberto.

## Trabalho incremental limitado — issue #28

`retainRoots` retorna um **catálogo estrutural**, não um atestado de integridade atual de todos os bytes históricos. Mantém a forma RootCatalog do núcleo e o CAS pelo digest do índice. Verifica conteúdo de todas as fontes fornecidas e de todas as fontes referenciadas pelas observações submetidas, inclusive replay, metadata-only e conteúdo compartilhado. Uma fonte não afetada pode ter seus bytes alterados sem mudar seus metadados; isso não bloqueia uma retenção não relacionada, mas ela continua sendo recusada antes de qualquer consumo verificado.

A operação admite no máximo **4 MiB e 256 fontes distintas** de conteúdo relido por transação, além dos 4 MiB de entrada já limitados. Os limites são inclusivos. Metadados de tamanho/tipo/comprimento são validados antes de materializar o BLOB; a próxima leitura que excederia qualquer limite retorna E_BUDGET e reverte o lote inteiro, inclusive inserções anteriores e relógio. Fontes vazias contam como uma leitura. Referências iguais são verificadas uma só vez na transação; bytes distintos com hash igual ou IDs distintos não são confundidos.

A deduplicação é local à chamada/transação IMMEDIATE, nunca persiste entre operações, conexões ou reaberturas. Não há cache de confiança nem invalidação temporal presumida. Escopo, tombstones, disponibilidade, CAS e dupla conferência do lease permanecem obrigatórios.

`readSource` continua verificando os bytes de uma fonte antes de devolvê-los. `readRoot` verifica os bytes de suas fontes, e `readRootCatalog` permanece uma auditoria integral explícita de todas as fontes correntes. Nenhum desses métodos usa a deduplicação de chamadas anteriores. Consumidores de manifesto/snapshot/publicação continuam revalidando suas próprias dependências. O chamador incremental conserva o digest retornado, em vez de realizar uma auditoria integral antes de cada lote.

A otimização limita **conteúdo retornado pelo driver e reprocessado**, não bytes físicos de I/O, tempo total, trabalho de metadados ou tamanho de WAL. O índice/ordenação/CAS e a contagem de quota ainda custam proporcionalmente aos registros; não há promessa de O(1) para retornar o catálogo inteiro. Catálogo continua limitado a 100000 raízes/16 MiB, e o lote a 64 fontes/128 observações. Consultas integrais explícitas não são o caminho incremental de retenção.
