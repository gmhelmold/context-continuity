# Regras do repositório

## Produto e escopo

Context Continuity é standalone. Não importar internals de HuGR-Orchestra, Atlas, Maestro ou bancos privados de hosts. OpenCode upstream é a integração de referência, não uma dependência do núcleo.

Etapa atual: desenho formal. Não criar runtime, manifests de instalação ou releases fictícias para aparentar progresso. Especificação e implementação seguem a revisão do RFC.

## Fonte de verdade

O RFC ativo está em `docs/designs/continuous-self-compaction/RFC-001.md`. `docs/history/RFC-CSC-001-v0.1.md` é um snapshot histórico byte a byte: não editar ou formatar. Origem e hashes estão em `docs/MIGRATION.md`.

Distinguir decisão proposta, evidência estática, teste executado e hipótese. Não declarar suporte a um host/provider com base apenas em documentação ou na instalação do pacote. Registrar versão e rota quando houver homologação.

## Engenharia

Preferir o menor ciclo vertical verificável. Sem serviços distribuídos, banco vetorial ou gateway obrigatório antes de necessidade demonstrada. Reusar a lógica do núcleo entre adaptadores.

Não editar transcripts em uso ou arquivos internos de aplicativos para contornar ausência de APIs públicas. Não extrair credenciais nem presumir que assinaturas autorizem qualquer rota auxiliar. Isolar sessões e projetos; não versionar históricos reais, tokens, `.env` ou bases de usuários.

Validar cobertura do snapshot, preservação da cauda, integridade do protocolo e desativação segura. O clone não despacha ferramentas do projeto. MCP de consulta não equivale a controle de contexto.

## Revisão e entrega

Commits e títulos de PR seguem `type(scope): resumo`. Branches curtas com hífens, sem prefixos com barra. Alterações documentais devem manter referências relativas resolvíveis e limites de escopo claros.

Cada work package posterior terá Success Criteria, Quality Standards, Completeness Criteria, Definition of Done e Invariants, além das evidências esperadas. Não confundir testes de documento com testes de runtime. Não anunciar benchmark ou economia não medidos.

Nenhum comando de teste de aplicação está definido nesta fase; não inventar um. Ao adicionar implementação, documentar comandos reais e verificar o comportamento completo, não apenas compilação ou HTTP 200.
