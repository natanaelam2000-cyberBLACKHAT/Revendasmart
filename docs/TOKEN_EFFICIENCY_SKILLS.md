# Token Efficiency Skills — Revenda Smart

Análise realizada em 2026-07-17 no worktree `/home/natanaelam2000/Revendasmart-hotfix`.

## Fontes analisadas

| Fonte | Tipo | Commit analisado | Licença | Decisão |
| --- | --- | --- | --- | --- |
| https://github.com/topics/reduce-token-usage | Tópico GitHub | Não aplicável | Não aplicável | Usado como índice; não é repositório clonável. |
| https://github.com/DietrichGebert/ponytail | Skill/plugin | `16f29800fd2681bdf24f3eb4ccffe38be3baec6b` | MIT | Adaptar princípio de menor mudança; não importar hooks/plugin. |
| https://github.com/JuliusBrussee/caveman | Skill/plugin | `0d95a81d35a9f2d123a5e9430d1cfc43d55f1bb0` | MIT | Adaptar apenas concisão leve; rejeitar estilo “caveman”. |
| https://github.com/rtk-ai/rtk | CLI/proxy de terminal | `5d32d0736f686b69d1e8b9dc45c007d4eb77a0a2` | Apache-2.0 | Não instalado; princípios nativos de terminal documentados. |
| https://github.com/felixsim/bonsai-memory | Skill/memória | `a57bd217d12a9f9fb1551e7c757890c89b9e67e2` | MIT | Avaliado e não adotado agora para evitar duplicação. |
| https://github.com/o4f6bgpac3/concise | Skill/plugin | `f9468b0fb29aac6501b21a289e58809b271783ed` | MIT | Adaptar comunicação concisa com proteção de precisão. |

Os clones foram rasos, temporários, feitos sob `/tmp` e removidos após inspeção. Nenhum script externo foi executado.

## Skill, prompt, proxy CLI e memória

- Skill local: instrução versionada em `.codex/skills/<nome>/SKILL.md`, validada pelo catálogo do projeto.
- Prompt: instrução avulsa, útil pontualmente, mas sem governança de índice/validador.
- Proxy CLI: ferramenta que intercepta ou reescreve comandos de terminal. Pode economizar tokens, mas altera o ambiente operacional e exige revisão separada.
- Memória: estrutura persistente de contexto. Pode reduzir carga de contexto, mas muda organização de conhecimento e não deve ser ativada sem plano próprio.

## Princípios adotados

- Menor alteração correta antes de refatoração ampla.
- Saída técnica curta, mas ainda gramatical e precisa.
- Terminal com comandos direcionados antes de logs completos.
- Medição local honesta em vez de prometer percentuais externos.
- Segurança, correção e clareza acima de economia de tokens.

## Princípios rejeitados

- Importar hooks que mudam comportamento global do agente.
- Usar modos “ultra” de concisão em segurança, produção, banco de dados, arquitetura ou incidentes.
- Instalar RTK, alterar PATH, criar aliases globais ou substituir comandos silenciosamente.
- Reorganizar memória/documentação do projeto nesta sprint.
- Cortar validações, tratamento de erro, acessibilidade ou compatibilidade para reduzir texto/código.

## Skills criadas

| Skill | Ativação recomendada | Quando não usar |
| --- | --- | --- |
| `minimal-change-engineering` | Hotfix, correção localizada, commit seletivo, redução de diff. | Quando o usuário pediu redesign, migração ou arquitetura nova. |
| `concise-technical-output` | Status, relatório curto, handoff, validações, próximos comandos. | Quando o relatório exige todos os detalhes ou há incidente/segurança complexa. |
| `terminal-output-efficiency` | Busca, Git, validações e logs longos. | Quando a saída completa é necessária para diagnóstico. |

## RTK

RTK foi analisado como ferramenta CLI/proxy, mas não foi instalado. Qualquer adoção futura exige revisão de segurança, teste de compatibilidade no Cloud Shell, medição real e aprovação explícita.

## Bonsai Memory

Bonsai Memory foi avaliado como contexto progressivo/memória hierárquica. Não foi adotado agora porque o Revenda Smart já tem skills locais, documentação por domínio e política de leitura progressiva. Uma adoção futura exigiria plano separado para memória, atualização e rollback.

## Riscos de compressão excessiva

- Perda de contexto importante.
- Correções superficiais.
- Omissão de falhas ou riscos.
- Respostas ambíguas.
- Código compacto demais para manutenção.
- Redução indevida de validações.

## Medições locais reais

| Medição | Saída normal | Saída compacta | Diferença |
| --- | ---: | ---: | ---: |
| `git status` vs `git status --short` bytes | 749 | 222 | 527 bytes a menos |
| `git status` vs `git status --short` linhas | 19 | 7 | 12 linhas a menos |
| `git diff` vs `git diff --stat` bytes | 15721 | 251 | 15470 bytes a menos antes de abrir detalhes |

Tamanho das skills criadas:

- `.codex/skills/minimal-change-engineering/SKILL.md`: 2742 bytes
- `.codex/skills/concise-technical-output/SKILL.md`: 2644 bytes
- `.codex/skills/terminal-output-efficiency/SKILL.md`: 2861 bytes

Os percentuais declarados por projetos externos não foram tratados como garantia para o Revenda Smart, pois dependem de agente, tarefa, baseline, ferramenta e contexto.
