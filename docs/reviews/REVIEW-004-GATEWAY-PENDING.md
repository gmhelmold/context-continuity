# REVIEW-004 — D02/D03 ainda abertos

Esta branch contém regressões executáveis, NÃO as correções do gateway. Referência: [REVIEW-004](REVIEW-004.md) e issue #21. Não fazer merge enquanto a execução estiver vermelha.

Os controles usam o gateway real em loopback e hooks controlados. D02 interrompe a requisição numa barreira observável depois de adquirir a captura, antes de terminar seu corpo; compara cancelamento user/native/dispose com controle sem cancelamento. D03 exige reconciliação após alteração de raiz, reinício/revert e um hold explícito quando a expansão exceder orçamento de fixture. O hold em bytes não é um estimador de tokens nem homologação de provider.

Na base 3c5f28b, duas verificações passam e quatro falham por assertions dos contratos: user/native ainda enviam o request antigo; raiz alterada repete E_STALE_VIEW; expansão não transita ao hold exigido. O fixture aguarda a liberação da captura antes de remover seu próprio diretório, evitando atividade residual do teste. Nenhum código de execução foi corrigido nesta branch.

O workflow dedicado executa diretamente o comando abaixo, sem continue-on-error, skip ou supressão de retorno. Seu vermelho é intencionalmente visível até a implementação resolver as falhas.

```sh
node --test tests/conformance/opencode/test-review004.mjs
```

As tentativas de aplicação das correções não foram executadas pela ferramenta conectada nesta rodada (status de segurança indeterminado). Isso não é ausência de autorização do repositório. O código/testes das correções D01/D04/D05 está separado no PR #22; não declarar os cinco achados resolvidos nem fechar #21.

Para concluir: corrigir gateway/captures, mostrar antes/depois destas regressões, testar integração stock/reset/restart, revisar os limites do novo hold e conferir CI no head resultante. Não converter as expectativas para aceitar o comportamento defeituoso. P01 continua sob #4.
