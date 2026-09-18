# REVIEW-004 — resolução parcial D01/D04/D05

**Base:** 3c5f28bdc98afba9911a0a0822690f150d75155e (review #20 integrado sobre a base auditada 47f5de8). O [review original](REVIEW-004.md), suas evidências e reproduções permanecem intactos. Rastreio: issue #21; P01 em #4.

## Escopo desta alteração

| Achado | Implementação | Evidência exigida / estado |
|---|---|---|
| D01 | Testemunha Python fora do gateway; comparação integral com recorder; mutantes pré-ingresso. | Controle principal stock aprovado localmente; campanha completa e CI são registrados no PR ao concluir. |
| D04 | Perfil com verificação explícita de grupos; duas fixtures com call/result indivisível. | Regressão falhou na base; passa com os grupos corrigidos. Partição insegura, chamadas múltiplas, resultado órfão e grupo incompleto exercitados. |
| D05 | Identidade resolvida, aliases/variante/limites versionados, exigidos por seal e validação terminal. | Regressão de modelo contraditório falhou na base e passa após correção; aliases desconhecidos/duplicados e perfil antigo recusados. |
| D02 | Sem correção de gateway aplicada neste incremento. | Regressões determinísticas preparadas; cancelamento user/native pré-despacho ainda falha na base. Permanece aberto. |
| D03 | Sem correção de gateway aplicada neste incremento. | Regressões de raiz alterada/hold preparadas; próxima chamada ainda reencontra E_STALE_VIEW. Permanece aberto. |

As chamadas de edição de gateway desta rodada foram bloqueadas antes da execução pela ferramenta conectada com status de segurança indeterminado. Não houve recusa de permissão pelo GitHub. A execução de outras alterações e as ações de repositório funcionaram. Esse registro não transforma uma tentativa em fix; os arquivos do gateway/captures continuam intactos neste incremento.

## Contratos e provas

[SPEC-11](../../specs/v0.1/11-terminal-profiles.md) é a autoridade dos refinamentos. A testemunha é instrumentação sintética, não mais um componente distribuído. O perfil não certifica o host, só exige identidade e protocolo explícitos para montar o frame do componente.

Antes da correção, os dois testes D04/D05 reprovaram por assertions. Depois passaram, juntamente com dez testes adicionais de perfil. No tooling fixado local (Node 22.17.1, TypeScript 5.9.3), typecheck e **161/161 testes do núcleo** passaram. São 149 anteriores mais 12 novos; execuções internas das campanhas não são contadas como centenas de cenários de produto.

A campanha do núcleo foi ampliada de cinco para sete mutantes, preservando o controle positivo e exigindo 45 testes selecionados em cada filho. Os dois adicionais ignoram protocolo e identidade do modelo; precisam falhar nos casos específicos. A campanha stock passa de seis para oito alterações incorretas, das quais duas ficam antes do log do próprio gateway. Seu resultado não é antecipado neste registro.

Quatro testes Python exercitam a testemunha de entrada com HTTP real e demonstram que a referência é independente da telemetria de saída. Headers secretos não aparecem no registro. A igualdade JSON do novo oráculo também distingue booleanos de números (True não equivale a 1). Source hashes da sonda incluem o módulo da testemunha pelo glob de arquivos Python existente.

## Reprodução

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check:core
npm run test:core
python3 scripts/check-spec.py
python3 scripts/check-reference-model.py
python3 scripts/test-spec-check.py
python3 scripts/check-canonical.py
python3 scripts/check-storage-contracts.py
node --test tests/conformance/opencode/test-components.mjs
python3 tests/conformance/opencode/test-witness.py
```

Suíte stock e campanha de mutações: comandos em [tests/conformance/opencode](../../tests/conformance/opencode/README.md), binário oficial 1.18.31 e diretório novo. Quatro workflows no head exato continuam necessários antes do merge. Não houve inferência real, alteração de instalação pessoal, storage de produção ou promoção de modo complete.

## Fechamento

Este incremento não fecha #21, WP-00 ou WP-01. D02/D03 terão regressões separadas em PR rascunho, explicitamente reprovadas na base, sem incluir um teste vermelho escondido num incremento declarado verde. Não reaplicar os patches locais antigos e não somar suas contagens às desta implementação.

## Correção durante o gate de integração

O primeiro CI do PR #22 terminou 15/16: o novo oráculo de cadeia não atualizava prior_marker depois da primeira consolidação. Ingressos e egressos sintéticos da reprodução local mostraram corpos corretos; recalcular a expectativa com os dois cortes explícitos aprovou os quatro requests da segunda rodada. Corrigido o estado do runner, sem remover a comparação exata ou aceitar corpos modificados. Um teste adicional exige plano explícito, aceita a transição de síntese anterior para nova e continua rejeitando alteração de regra protegida. O resultado inicial 15/16 não é tratado como aprovação.
