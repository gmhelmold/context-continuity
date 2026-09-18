# SPEC-10 — contratos puros de manifesto, proposta e captura

Adendo de implementação WP-01/C à especificação 0.1.2. Refina SPEC-01 sem criar um scheduler, um driver ou uma nova integração de host. Formato do ledger/arquivo e gates existentes não mudam.

## 1. Validação estrutural não é verificação de fontes

`parseManifest` valida e copia o schema de SPEC-01; não resolve fontes. `verifyManifest` verifica o manifesto contra uma SessionBinding explícita e um resolver autorizado. `createManifest` atribui UUID/índices às seleções e executa a mesma verificação. O resolver é do storage/adaptador, não uma tool controlada pelo modelo.

O resolver retorna `{binding, entity, authority, bytes: Uint8Array|null}` por EntityRef. Binding, referência completa e autoridade devem coincidir. SourceRef.digest é conferido contra os bytes originais completos. Para capítulos e blocos, o storage atesta que aqueles bytes são a representação citável DAQUELA versão/identidade; seu digest de registro não é reinterpretado como hash de texto. Este contrato não autentica um resolver malicioso no mesmo processo.

Toda entrada full/excerpt é verificada, mesmo sem futura citação: disponibilidade, limite, UTF-8 válido, endpoints do recorte e excerpt_digest. full exige `[0,size)`; excerpt conserva exatamente o recorte. Fonte vazia capturada é válida, distinta de missing. BOM/CRLF e strings não são normalizados. Buffers mutáveis não ficam retidos no resultado.

reference_only usa range `[0,0)` e SHA-256 dos bytes vazios. Seu resolver ainda deve atestar binding/entity/authority, mas não precisa devolver o conteúdo. Não sustenta Claim. Locators distintos são obrigatórios dentro de um manifesto; são rótulos, nunca paths executáveis. Índices são contíguos e ordenados.

Limites estruturais iniciais: 1.024 entradas, 256 KiB de JSON do manifesto, locator em 1..512 bytes UTF-8 não vazio/branco e representação individual até 16 MiB. São limites explícitos do componente, não políticas de truncamento. O orçamento real da missão em SPEC-02 ainda é obrigatório e pode ser menor. Ultrapassar limite recusa, não omite referências.

`VerifiedManifest` vincula binding/manifest/digest e tem emissão reconhecida pelo módulo. JSON recuperado do disco deve ser revalidado: copiar checksum não recria esse estado. O handle prova verificação naquela captura, NÃO freshness futura, autorização permanente ou publicação durável. WP-02/WP-04 continuam responsáveis por tombstones, retenção, revalidação e transação.

## 2. Proposta delimitada pelo manifesto

`decodeProposal(text, finish, binding, verifiedManifest, deliveredFeedbackIds)` implementa ModelProposal/Claim. finish vem do transporte. Apenas complete permite parsing publicável estruturalmente; tool_call prevalece sobre texto aparentemente válido, e length/cancelled/error são recusados. O executor continua responsável por seu parser de protocolo e limites físicos.

Aplicar o teto de 256 KiB ao texto UTF-8 recebido ANTES do parser; chaves duplicadas decodificadas, Unicode malformado, campos extras, índices inválidos e números não finitos são recusados. Arrays são densos, sem propriedades escondidas/accessors. Limites de SPEC-01 valem por code point, sem trim dos textos aceitos.

Cada Claim exige ao menos uma citação única existente e full/excerpt. Replace exige ao menos um Claim no total; falta de conteúdo é E_NO_GAIN, não um ready preso. Nenhum resultado estruturalmente válido comprova a verdade do Claim. O ganho M e a utilidade da síntese são verificados posteriormente, não falsificados neste parser.

feedback_applied é subconjunto único de até 32 IDs efetivamente entregues pelo chamador autorizado. Não há inferência de notas nem promoção de autoridade por texto. O resultado imutável contém binding, manifest_id/digest, proposal e proposal_digest. `assertProposalContext` impede reutilização com outro manifesto/incarnation. Não representa AttemptPermit, job publicado ou consentimento para ferramentas.

## 3. Captura e selagem JSON

O primeiro componente puro usa JSON em memória. `createCapture` recebe binding e `{kind,work,native_identity_map}`; gera capture_id e copia o mapa ordenado de `{native_identity,native_refs}`. IDs duplicados/ambíguos são recusados. Sessão, incarnation e epoch são explícitos; não são deduzidos do texto do modelo.

`sealFrame` recebe o ticket, binding, RootIdentityRegistry, corpo final e layout. O layout é dado pelo codec autorizado, com route_id/model_id/variant/history_key/prefix_length/system_keys/tool_keys/groups/input_estimate. groups é a lista ordenada de `{native_identity,count}` que particiona os itens do array histórico após um prefixo protegido. A captura, o registry e cada identidade pública precisam concordar. O hash de cada slice completo deve coincidir com o payload da raiz; não há transformação corretiva nem mutação parcial do registry.

O perfil aceita um array histórico top-level e até 100.000 itens/grupos, sob limite de 16 MiB de JSON. Cada grupo cobre pelo menos um item e a soma cobre o restante EXATO do array. Perfis aninhados/estado binário opaco exigem outro codec explícito; não são convertidos para texto por este componente. As duas fixtures de contrato usam formatos distintos, não homologam provedores reais.

`config_digest` inclui route/model/variant, interpretação do layout, o prefixo histórico e TODOS os campos top-level fora do histórico. system_digest/tools_digest identificam os subconjuntos declarados. `input_digest` inclui config_digest, envelope_digest e RootRefs ordenadas. Campo desconhecido continua no envelope e no hash; não desaparece por não estar na lista de campos de um modelo.

O corpo final é copiado e congelado. Canonicalização de hash segue JCS; não é usada para alterar valores na cópia em memória, inclusive -0. Os bytes originais arquivados continuam sendo outro domínio de hash. `assertFrameUnchanged` compara o corpo atual com envelope_digest; a integração terá que executá-lo no ponto terminal real.

Tickets/frames emitidos são reconhecidos por referências fracas locais; não mantêm um registro cumulativo de sessões nem são restaurados de JSON como autoridade. Esses marcadores impedem confusão acidental de tipos/cópias, não sandbox de código hostil no processo. Passar nos contratos NÃO prova que um hook real esteja no ponto final ou que o layout de um provider esteja correto: WP-00/WP-06 continuam exigindo recorder, codec público, retenção e veto.

## 4. Fronteira deste incremento

T06.contract e T30.contract têm implementação de manifesto/proposta e Capture/SealedFrame/fingerprint com dois formatos sintéticos. T02.contract recebe associação adicional de escopo; execução/identidade completa de jobs e Snapshot ainda não é implementada aqui. T37.contract recebe fuzz de propostas, recortes e frames, mas não uma declaração de fuzz de todos os schemas futuros. Os subcasos transversais só encerram quando o restante estiver implementado e revisado.

Nenhuma View, capítulo persistido, Snapshot completo, scheduler, chamada de inferência ou adaptador instalado é criado por esses contratos. Em particular, a emissão de VerifiedManifest/SealedFrame nunca altera o predicado complete nem autoriza rede.
