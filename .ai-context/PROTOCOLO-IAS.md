# Protocolo de Leitura das IAs — RevendaSmart

Última atualização: 2026-09-25

Este protocolo define como Claude Code, Codex e Gemini/OpenCode devem consultar e atualizar a memória compartilhada do RevendaSmart no Obsidian, sem que o Obsidian execute, despache ou simule qualquer trabalho por eles.

`OBSIDIAN = MEMÓRIA COMPARTILHADA` · `GIT = VERDADE DO CÓDIGO` · `CLAUDE / CODEX / GEMINI = EXECUTORES EXTERNOS`

## Antes de trabalhar

Todo executor externo deve ler, nesta ordem:

1. `00-LEIA-PRIMEIRO.md`
2. `00-CENTRAL/CONTEXT-PACK-REVENDASMART.md`
3. `00-CENTRAL/DECISOES.md`
4. `00-CENTRAL/FILA-EXECUCAO.md`
5. `01-REVENDASMART/EXECUCOES/<FRENTE>/BRIEF.md`
6. Resultados anteriores relacionados à frente, em `01-REVENDASMART/EXECUCOES/<FRENTE>/RESULTADOS/`.

Depois de ler o contexto documental, o executor deve revalidar o Git real (`git status`, `git branch --show-current`, `git rev-parse HEAD`, `git worktree list`, `git log -1`) antes de qualquer escrita.

## Durante

O executor trabalha no repositório real, não no Obsidian. O Obsidian não é o local de edição de código.

## Depois

O resultado real da execução volta para `01-REVENDASMART/EXECUCOES/<FRENTE>/RESULTADOS/`, seguindo o padrão descrito em [[01-REVENDASMART/EXECUCOES/README|EXECUCOES/README.md]].

Depois de o resultado ser registrado, o Obsidian pode ser atualizado:

- `00-CENTRAL/DASHBOARD.md`
- `00-CENTRAL/CONTEXT-PACK-REVENDASMART.md`
- `00-CENTRAL/FILA-EXECUCAO.md`
- `00-CENTRAL/STATUS-ATUAL.md` (ou o `STATUS-ATUAL.md` do projeto)

## Protocolo de cruzamento entre IAs

Quando uma segunda IA revisa o trabalho de outra, ela deve ler, antes de gerar seu próprio relatório:

- o `BRIEF.md` da frente;
- o Context Pack;
- o(s) relatório(s) anterior(es) em `RESULTADOS/`;
- as decisões relacionadas em `DECISOES.md`.

Exemplo de cadeia: Claude Code implementa e gera `RESULTADOS/2026-09-25-claude-code.md`. Codex lê esse relatório junto com o BRIEF, o Context Pack e as decisões relacionadas, e gera `RESULTADOS/2026-09-25-codex-review.md`. Se Gemini continuar depois, deve ler os dois resultados anteriores antes de agir.

Assim, `CLAUDE → CODEX → GEMINI` (ou qualquer outra ordem) compartilha contexto inteiramente pelo vault, sem depender de memória entre sessões.

## Regra de concorrência

Duas IAs não devem modificar simultaneamente a mesma frente ou o mesmo worktree. Frentes independentes podem rodar em paralelo, cada uma em worktree isolado quando necessário.

O Obsidian apenas documenta essa regra e o que de fato aconteceu — ele não cria worktrees, não reserva executores e não impede fisicamente a concorrência.

## Limites deste protocolo

- Nenhum agente é registrado como "em execução", "ocupado" ou "com resultado produzido" no vault sem evidência real trazida pelo usuário ou pela própria sessão de execução.
- Este vault não emite comandos de despacho (blocos com DESTINO/AUTORIZAÇÃO/PRIORIDADE, reservas de executor) para agentes externos.
- Ver também [[00-CENTRAL/REGRAS-DAS-IAS|REGRAS-DAS-IAS.md]] para as regras gerais de coordenação, segurança Git e prevenção de split-brain.
