# SPEC-11 — perfis terminais e testemunha externa

Adendo à revisão 0.1.2; resolve D01/D04/D05 da REVIEW-004. Não declara D02/D03 resolvidos, nem encerra o gate do host. Refina [SPEC-10](10-context-contracts.md) e [SPEC-09](09-review003-boundaries.md).

## 1. Testemunha de teste independente

A fixture de integração coloca `ingress_witness.py` entre o OpenCode stock e o gateway sob teste. É um servidor HTTP do processo Python de teste, separado do processo do plugin. Registra o corpo e o SHA-256 dos bytes recebidos ANTES de encaminhar os mesmos bytes. Não deriva sua entrada de logs do gateway. Somente fixture loopback, JSON com Content-Length e até 1 MiB; não é serviço de produto ou suporte genérico de transporte.

O recorder de saída permanece independente. O oráculo compara cada request primary dos cenários principal/consolidações a uma entrada externa correspondente, na ordem da sessão. Só permite a identidade ou as substituições explícitas da fixture. Confere o corpo inteiro, inclusive campos não históricos, papéis, ordem e metadata. As exigências de poda efetiva e da síntese final são asserções separadas; permitir uma entrada sem poda durante a geração não permite terminar sem a poda exigida.

A comparação cobre os quatro requests do cenário principal e os quatro de cada rodada de consolidação; não certifica todos os perfis ou todas as requisições arbitrárias. O histórico público continua sendo a evidência independente para outputs de ferramentas. A mesma igualdade pai/clone não prova integridade anterior ao ponto observado.

A campanha negativa conserva os seis mutantes pós-projeção e inclui alteração de sistema e metadata ANTES do log de ingresso do gateway. Esses dois devem falhar especificamente por E_ORACLE_WITNESS_PAYLOAD; controle correto, setup integral e resultado do caso selecionado são obrigatórios. Logs completos são exclusivamente sintéticos, sem headers de autorização/correlação persistidos.

## 2. Perfil JSON explícito

`createJSONFrameProfile(spec, protocolCheck)` cria configuração imutável; não é CapabilityReport nem certificado. A configuração inclui schema_version=1, profile_id, revision, route_id, model_id resolvido, model_key, model_aliases, variant/variant_key, history_key e limits. IDs externos são opacos; aliases são uma lista não vazia, única e exata de até 128 valores.

`sealFrame(binding,capture,registry,body,layout,profile)` exige esse perfil explicitamente. A identidade declarada em layout deve coincidir com o perfil. O valor do campo model_key deve existir como string e pertencer aos aliases EXATOS daquele modelo resolvido. Alias desconhecido, duplicado ou transformação implícita de maiúsculas é recusado. Não se infere uma rota a partir do nome de um modelo.

variant e variant_key são ambos null ou ambos explícitos; a variante do request deve coincidir. history_key/model_key/variant_key são distintos. Perfis cuja identidade está numa URL ou campo aninhado necessitam de outro binding explícito; este componente não os homologa por extrapolação.

O perfil contém os mesmos limites de modelo validados pelo resolvedor de configuração. O frame expõe esses limites imutáveis; o scheduler futuro deve usá-los, não uma segunda identificação inferida do corpo. profile_digest integra config_digest e, portanto, input_digest. Mudança de revisão, aliases ou limites invalida o contexto do perfil. `assertFrameUnchanged(binding,frame,body,profile)` compara tanto perfil quanto corpo.

O perfil é fornecido pelo adaptador autorizado; esta API não comprova por si só que a rota HTTP física corresponde ao route_id. Essa prova permanece no recorder/gate WP-00/WP-06. Mudança de codec requer revisão do perfil e nova evidência. WeakMap não é sandbox nem autenticação contra código hostil no processo.

## 3. Unidade de protocolo indivisível

O sealer entrega grupos inteiros, com RootUnit e itens JSON congelados, ao protocolCheck do codec. Ausência de checker, retorno diferente de true ou exceção impede selagem. O núcleo não tenta reconstruir relações por busca textual nem incorpora um parser universal de providers.

As duas fixtures agora representam chamada e resultado juntos na mesma raiz. O checker de fixture verifica IDs únicos, correspondência das respostas, grupos sem resultados órfãos e ausência de chamadas pendentes em grupos removíveis. Grupo incompleto só é aceito integralmente protegido e completed=false. A ordem de resultados permitida pela fixture é explícita e validada por identidade, não por quantidade.

Isso fornece exemplos válidos para dois layouts sintéticos. Não equivale a adaptar ou homologar Gemini/Claude/OpenAI. A integração de produção deve fornecer seu próprio codec versionado e provar que a classificação de grupos corresponde ao protocolo público real.

## 4. Limites de conclusão

D01 trata a instrumentação da sonda; D04/D05 tratam contratos e fixtures. Nenhum cria Snapshot/job, persistência, agendamento, inferência paga ou release. P01 (vínculo completo job/Snapshot/manifest/frame/feedback) permanece em WP-01/#4. D02/D03 continuam em #21 até suas correções e provas próprias.
