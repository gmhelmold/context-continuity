# WP-02/D — primeiro corte: primitiva nativa de lock

Base `e2c1ec33aab11cf2c7a7dc4d731a6a2c73dac2c7`; continuação da issue #5. Contrato em [SPEC-16](../../specs/v0.1/16-native-lock-primitive.md). Este incremento não conclui o WP-02/D nem a reconciliação de processos dos jobs.

## O que foi implementado

Ponte pequena em C/Node-API 8 com tryLock, unlock e classificação local de filesystem. Sem dependência npm, biblioteca externa ou helper residente. Build explícito com compilador e headers exatos de Node, fora do ciclo de instalação/runtime. Nenhum caminho, owner do banco ou registro de execução é controlado pelo código nativo.

A ponte é isolada: core e SqliteSessionStore não a importam. A aplicação ainda mantém a quarentena cross-owner conservadora do WP-02/C. Não se pode usar um retorno true como prova de morte de um processo, identificação do workspace ou autorização de liberar tentativa.

## Testes executados localmente

Mac Intel, Node 22.17.1, compilador do sistema: **17/17**, sem skip/todo. São 16 testes de comportamento e uma campanha com cinco pares controle/mutante. Subprocessos não multiplicam a contagem.

Python/fcntl em outro processo observa busy quando o Node detém o lock, e acquired depois do unlock. A prova inversa faz o Python deter o inode enquanto a ponte Node devolve false. Um teste mantém um filho Node detentor, observa a barreira e encerra somente esse filho; depois a aquisição funciona. Não usa o próprio retorno do nativo como única testemunha da exclusão.

Casos adicionais: dois opens no mesmo processo, fechamento de descritor não detentor, duas identidades independentes, arquivo antigo com detentor vivo, modos diferentes de 0600, hardlink, diretório, descritores fechados e valores malformados. O lock não altera conteúdo ou inode do arquivo. A prova do tempo de arquivo não é benchmark de horas.

Cinco mutantes são compilados em diretórios descartáveis: sucesso sem chamada de flock, busy declarado como sucesso, modo privado ignorado, unlock falso e hardlink aceito. Todos os controles passam; os mutantes falham na assertion nomeada. Erro de compilação, sinal, timeout ou teste que não rodou reprova a campanha e não conta como detecção.

Revisão do autor encontrou conversão numérica que precisava recusar NaN antes do cast C. Corrigida com teste de intervalo que também rejeita NaN; não foi executado um exploit nem alegada contraprova de crash. Campos, errno e logs não expõem conteúdo de arquivos pessoais. A revisão não é auditoria independente.

## Escopo que não executou

A escrita do gerenciador TypeScript de ciclo de vida/identidades foi bloqueada pela ferramenta antes de executar. Confirmado ausente no checkout; não foi publicado por outro caminho. Foi continuada somente a validação da ponte nativa já criada, mantendo o gerenciador pendente.

Uma chamada posterior para criar/executar um runner local composto da matriz antiga também foi bloqueada antes de executar. Não há nova execução local completa de storage/core/OpenCode a alegar nesta rodada. Os workflows do head publicado precisam validar essa regressão; resultados anteriores não são herdados. A suíte nativa acima foi efetivamente executada por seu próprio comando.

## Reprodução e gate

```sh
npm run build:locks
npm run test:coordination
```

O novo workflow compila/testa Node 22.17.1 e 24.0.0 em Ubuntu 24.04. O gate total passa a sete workflows/dez jobs, incluindo os seis workflows anteriores sem mudança em seus comandos. Resultados remotos e logs pertencem ao head final do PR; não são inferidos do verde local. Não publicar binários ou alterar configuração pessoal para rodar os testes.

[Hashes e resultados locais](evidence/WP-02-D-lock-primitive.json). Build/testes usam apenas diretórios próprios descartáveis. O código do gerenciador recusado não integra este pacote.

## Continuidade obrigatória

Falta implementar o dono explícito dos descritores, guardas de caminho/inode, lock único de workspace, associação persistida de storage_owners, ordem workspace-lock antes de SQLite e inspeção não bloqueante do owner antigo. Depois, vincular essa prova à execução e às reservas antes de permitir reconciliação de quarentena entre owners. O simples timeout do lease continua insuficiente.

Sem essa camada, não há captura de blobs, GC seguro ou liberação cross-owner nova. Esse trabalho permanece em #5; os 17 testes encerram somente o comportamento da primitiva de kernel deste corte.
