# WP-01/A — configuração e capacidades do núcleo

**Escopo:** primeiro incremento do WP-01 / issue #4. Dois subcasos implementados; o pacote completo continua aberto. Base: `b855df88cdfc67e8c1c9f131cba67cfbfc56869c`, especificação 0.1.2.

## Contratos executáveis

`packages/core/src` contém TypeScript/ESM puro, sem I/O, driver SQLite, provider ou import de host. `resolveConfig` implementa os domínios/defaults de SPEC-02 e produz cópia imutável; `decideMode` implementa a conjunção de SPEC-01 e a autorização assistida separada. Os validadores rejeitam campos extras, coerção, números não finitos/inseguros e accessors sem invocá-los.

O objeto de limites local usa `context_window=C`, `output_reserve=R`, `input_limit=I|null`. C/R são obrigatórios; R=0 explícito não equivale a omissão. Ausência/invalidade produz E_SCHEMA, não busca de metadata, modo assistido implícito ou rede. O chamador futuro transforma a falha em diagnóstico/pausa. A quota derivada 8*C também deve ser um inteiro seguro; override explícito é preservado, nunca aumentado silenciosamente.

Essa resolução NÃO calcula B/G/T/L/N/M nem verifica ganho, cauda ou dispatch: pertence ao scheduler WP-03. Ela valida e congela a configuração, inclusive `rearm_ratio<trigger_ratio` e reservas básicas que deixem entrada disponível.

`CapabilityEvidence` é a entrada NORMALIZADA do predicado puro, não um certificado de perfil. `required` ausente ou um campo omitido é unknown; fidelity ausente é unverified; gate ausente é not_run. Valores desconhecidos são E_SCHEMA. Somente doze evidências verified + fidelity verified + gate pass permitem complete, com ativação explícita. Cache é telemetria e não participa da decisão. Assisted exige seleção, consentimento específico, retenção e leitura verified; nunca é fallback automático.

A origem/autenticidade das evidências, seu vínculo com host/rota/versão e o ensaio que as produz permanecem responsabilidades da integração. Estes testes NÃO habilitam o modo completo de uma instalação real.

## Rastreabilidade da entrega

| Subcaso | Estado deste incremento | Evidência |
|---|---|---|
| T15.contract | Implementado/testado | Defaults fixos, fronteiras de todos os campos, ausência de limites, overflow, imutabilidade e round-trip. |
| T33.capabilities | Implementado/testado | Doze obrigações nomeadas independentemente, omissões, estados incompletos, fidelity/gate/cache, consentimento e 2.000 combinações determinísticas. |
| T02.contract, T06.contract, T07.contract, T30.contract, T37.contract | Não concluídos | Scope/identidades, Capture/SealedFrame, Manifest/propostas, dois formatos e fuzz geral continuam no WP-01. |

`traceability.json.initial_status` permanece not_run: é o estado inicial do plano, não um painel de resultados. Este registro distingue os dois subcasos executados sem declarar os outros 53 aprovados.

## Execução e repetibilidade

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check:core
npm run test:core
```

TypeScript 5.9.3 é dependência apenas de desenvolvimento, fixada no lockfile. O workspace é private, versão 0.0.0, sem release ou publish. O teste usa os arquivos TypeScript reais via Node; não copia os algoritmos num mock. `types.test.ts` exige falhas de compilação para mutações de objetos readonly e modos inválidos.

Execução local observada: Node 22.17.1/macOS Intel, typecheck aprovado, 82 testes aprovados, zero falhas/skip/todo. O número inclui casos parametrizados de fronteira/capacidade, não 82 fluxos integrados. Os 2.000 vetores estão dentro de um teste e não são contados como testes independentes.

O workflow Core contract checks repete typecheck e execução em Node 22.17.1 e 24.0.0, com tooling fixado e sem lifecycle scripts na instalação. O resultado do CI é o run associado ao commit/PR; não é antecipado por este registro local. Os três workflows existentes continuam exigidos antes de merge.

## Revisão e limites

Conferir defaults contra SPEC-02, nomes das doze capacidades contra SPEC-01, mensagens de erro sem valores sensíveis, ausência de side effects e comportamento fail-closed. Campos definidos explicitamente como undefined são inválidos, diferentes de campos omitidos. Objetos retornados não compartilham objetos mutáveis do chamador.

Nenhuma alteração no gateway, execução de LLM, migração, credencial ou configuração pessoal. Nenhum wrapper de host instalado. Os contratos de identidade/manifesto restantes serão implementados no mesmo WP-01 antes de seu encerramento; ledger, scheduler e adaptadores mantêm seus próprios gates.
