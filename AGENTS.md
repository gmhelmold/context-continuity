# Regras do repositório

## Produto e escopo

Context Continuity é standalone. Não importar internals de HuGR-Orchestra, Atlas, Maestro ou bancos privados de hosts. OpenCode upstream é a integração de referência, não uma dependência do núcleo.

Etapa atual: especificação atômica proposta, em revisão. Não existe runtime implementado ou pacote de produto publicado. A implementação deve seguir os work packages; não criar releases ou compatibilidades fictícias para aparentar progresso.

## Fontes de verdade

Entrada normativa para implementação: `specs/v0.1/README.md` e os contratos referenciados. O desenho de origem está em `docs/designs/continuous-self-compaction/RFC-001.md`. Contratos explícitos da especificação refinam exemplos e decisões abertas do RFC; divergências novas devem ser corrigidas antes do código afetado.

`docs/reviews/REVIEW-001.md` é revisão estática do autor, não auditoria independente. `docs/history/RFC-CSC-001-v0.1.md` é snapshot histórico byte a byte: não editar ou formatar. Origem e hashes estão em `docs/MIGRATION.md`.

Distinguir decisão normativa, evidência estática, teste executado e hipótese. Registrar host/versão/commit, rota/modelo/variante/transporte/auth type quando houver homologação. O gate G-OC-01 ainda não foi executado; sua descrição não é PASS.

## Engenharia

Preferir o menor ciclo vertical verificável. Sem serviço distribuído, banco vetorial ou gateway obrigatório sem necessidade demonstrada. Reusar a lógica do núcleo entre adaptadores. Uma integração parcial não pode ser apresentada como compactação completa.

Não editar transcripts em uso ou arquivos internos dos hosts para contornar ausência de API pública. Não extrair credenciais nem presumir que assinaturas autorizem qualquer rota auxiliar. Isolar sessões e projetos; não versionar históricos reais, tokens, `.env` ou bancos de usuários.

Validar cobertura do snapshot, preservação da cauda, integridade do protocolo e desativação segura. O clone não despacha ferramentas do projeto. MCP de consulta não equivale a controle de contexto. Cache não é garantia de fidelidade semântica nem de menor custo total.

## Revisão e entrega

Commits e títulos de PR seguem `type(scope): resumo`. Branches curtas com hífens, sem prefixos com barra. Alterações documentais mantêm referências resolvíveis e estado da entrega explícito.

Cada work package contém Success Criteria, Quality Standards, Completeness Criteria, Definition of Done e Invariants, além de dependências e evidências. Usar a matriz R01–R36/T01–T40; não marcar teste como concluído porque seu arquivo existe.

Validação documental disponível: `python3 scripts/check-spec.py`, a partir da raiz. Ela verifica documentos e DDL de referência, não a aplicação. Nenhum comando de teste de runtime está definido ainda; ao implementá-lo, documentar e executar comandos reais, demonstrando o comportamento completo além de compilação/HTTP 200.

Chamadas live de inferência e publicação de pacotes exigem orçamento/autorização e perfil definido. Não colocar credenciais de provider em CI de documentação. Não fazer downgrade de modo ou aumentar quotas silenciosamente.
