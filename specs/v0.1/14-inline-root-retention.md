# SPEC-14 — retenção inline e mapa durável de raízes (WP-02/B)

Adendo de SPEC-03/13. Persistência local de conteúdo fornecido explicitamente pela integração; nenhuma leitura arbitrária de arquivos, rede, ferramenta do modelo ou alteração no host.

## API e fronteira

SqliteSessionStore acrescenta readRootCatalog(binding), readRoot(binding,ref), readSource(binding,ref) e retainRoots(lease,batch). O batch contém expected_catalog_digest, sources e observations. A sessão deve existir; todas as escritas exigem o proprietário/fence/deadline atuais, revalidados dentro da mesma transação. O digest esperado é obtido antes de preparar o batch; divergência é E_CONFLICT, sem atualização parcial. Snapshot/job/publicação não são autorizados por este resultado.

Fontes são {ref,native_refs,media_type,bytes}; ref contém ID/revisão/digest do núcleo. Bytes são copiados antes da transação, sem normalização. SHA-256 deve coincidir. Primeiro registro de uma fonte tem revisão zero; novo conteúdo exige a próxima revisão. Mesma revisão é idempotente somente com os mesmos bytes e metadados; indisponibilidade nunca é convertida em captura. Fonte vazia é BLOB vazio, não NULL. Leituras revalidam digest/tamanho/disponibilidade e entregam cópia dos bytes. Nunca buscar no disco uma fonte ausente.

## Limites deste perfil

Somente fontes inline de até 256 KiB, incluindo a fronteira. Acima disso, E_CAPABILITY; não truncar nem criar blobs sem locks/staging. Até 64 fontes e 128 observações, no máximo 4 MiB de material por lote. Quota lógica de workspace de 2 GiB contabiliza conteúdo inline, catálogo de blobs e reservas existentes na transação; não é contagem do tamanho físico de WAL/índices/backups. Este perfil não cria arquivos externos, reservas nem GC; por isso todas as alterações que realiza são protegidas por BEGIN IMMEDIATE. Não substitui o lock de filesystem para as operações futuras de blobs.

## Raízes e atomicidade

RootIdentityRegistry do núcleo produz IDs/digests/revisões; não reimplementar sua fórmula em storage. Todos os sources referenciados pela raiz precisam existir, capturados e verificados no MESMO escopo antes da gravação. Raiz sem fonte permanece protegida conforme o núcleo. Falha numa fonte, observação ou inserção de raiz reverte o lote inteiro e o relógio transacional.

root_units conserva revisões anteriores. O índice corrente é MAX(revision) por identidade nativa, dentro da sessão/epoch; record_json contém a RootUnit e deve concordar com suas colunas relacionais. Alteração apenas de locator/estimativa atualiza metadados da mesma revisão sem reescrever conteúdo semântico. Leitura histórica usa RootRef explícita. Não há remoção de raízes ao omiti-las no lote; não é substituição do catálogo inteiro.

O catálogo de storage tem ordem determinística por native_identity em code units UTF-16. NÃO representa a cronologia do prompt; esta vem da captura do host. Assim o catálogo reaberto conserva digest independente de ordem de SELECT/rowid. O registro de memória mantém sua própria ordem de descoberta; a fronteira de storage normaliza a ordem do catálogo, não a das mensagens.

## Não prometer o que esta camada não faz

Guardar fonte e payload_digest não demonstra que a integração capturou todo o envelope ou que os bytes são verdadeiros. payload_ref continua locator opaco, não permissão de acesso a arquivo. Conteúdo binário pode ser retido mas sua elegibilidade de poda depende do codec. Retenção de revisões não é redação; exclusão/transição de policy e invalidação dos derivados pertencem às operações de SPEC-07. A leitura confere os tombstones/escopo atuais; nenhum callback os remove.

Não cria jobs, chapters, View nova ou inferência. O publicador futuro deve validar dependências e cobertura ATUAIS em sua própria transação. Não há homologação de um ledger distribuível, arquivo portátil, blobs ou perdas elétricas por testes de processo.

## Provas de conclusão do incremento

SQLite real: vazio/Unicode/binário exatos, fontes+raízes atômicas, revisões repetidas/editadas e reabertura em processo novo, conflitos de catálogo, proprietário expirado, isolamento, fonte ausente/indisponível/corrompida, quota compartilhada e fonte acima do cap. Injetar falha de INSERT e interromper apenas processo próprio antes/depois de COMMIT. Controle correto deve passar; mutações que eliminam verificação de fonte, CAS ou ownership devem falhar pela assertion apropriada. WP-02 agregado permanece aberto.
