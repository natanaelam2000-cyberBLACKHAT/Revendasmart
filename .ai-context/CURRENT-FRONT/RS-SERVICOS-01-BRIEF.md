# RS-SERVICOS-01 — Brief de Contexto

Última atualização: 2026-09-25

Este é um brief de contexto para quem for executar esta frente. Não é um despacho, uma autorização externa, nem um registro de agente ocupado ou execução iniciada.

## ID da frente

`RS-SERVICOS-01`

## Objetivo

Fazer o RevendaSmart evoluir de forma visível e instalável no que diz respeito a Serviços. Esta frente é o bloqueador funcional prioritário antes da próxima build interna.

**Critério de conclusão (objetivo maior):** modo Somente Serviços funcionando de ponta a ponta. Cada item abaixo precisa de evidência real trazida pelo usuário — não basta alteração de código:

1. Novo serviço pode ser criado.
2. Serviço pode ser salvo sem o erro conhecido.
3. Serviço aparece corretamente depois do salvamento.
4. Experiência Somente Serviços não mostra elementos indevidos de Produtos.
5. Agenda continua funcionando.
6. Reserva pública continua funcionando.
7. Trabalhos continuam funcionando.
8. Contato/snapshot e comportamento D1/D2 continuam preservados.
9. Fluxos afetados possuem testes.
10. Typecheck/lint/testes relevantes passam.

## Escopo

Itens a verificar e continuar (estado real de cada um ainda não levantado neste vault):

- Cadastro de novo serviço.
- Erro ao salvar novo serviço.
- Android Novo Serviço.
- Modo Somente Serviços.
- Impedir elementos de Produtos de aparecerem quando a conta for Somente Serviços.
- Agenda.
- Reservas (incluindo reserva pública).
- Trabalhos.
- Clientes ligados aos serviços (preservação de contato).
- D1 e D2.
- Persistência dos dados.
- Navegação.
- Comportamento após criar/editar serviço.
- Seleção/preseleção por nicho.
- Consistência da experiência Produto x Serviço.

## Fora de escopo

- Redesenho do aplicativo do zero.
- Auditorias amplas já cadastradas separadamente: `RS-AUDIT-OFFLINE-01`, `RS-AUDIT-INDICACOES-01`, `RS-AUDIT-CATALOGO-01`, `RS-AUDIT-SEC-PREPUB-01`.
- `ADS-PRO-03E1` (frente separada, tratada em seu próprio registro).
- `REVENDASMART-SEC-SKILLS-01B` (pausada operacionalmente).
- Qualquer coisa no repositório do Grupo + Saúde.

## Contexto funcional

- **D1/D2:** correções já existentes no fluxo de serviços, segundo relato do usuário, e que devem ser **preservadas, não refeitas do zero**. O vault não tem o detalhamento técnico desses fixes — apenas a menção de que existem. Localizar o estado real no código e no histórico Git antes de modificar.
- **Bug conhecido:** erro ao salvar novo serviço. Causa raiz ainda não levantada neste vault.
- **Modo Somente Serviços:** deve impedir exibição de qualquer elemento de UI ou fluxo pertencente a Produtos quando a conta estiver configurada exclusivamente para Serviços.

## Decisões relacionadas

- Reprioritização executiva de 2026-09-25: foco único do RevendaSmart passa a ser esta frente. `SEC-SKILLS-01B` pausada operacionalmente. Auditorias amplas fora da execução corrente. Ver [[00-CENTRAL/DECISOES|DECISOES.md]].
- Alterações dirty preexistentes no repositório devem sempre ser preservadas.

## Critérios de conclusão

Ver a lista de 10 itens em "Objetivo" acima. Nenhum item é considerado concluído sem evidência real trazida pelo usuário ao vault.

## Dependências

Nenhuma dependência bloqueante registrada. Não deve reaproveitar o worktree `revendasmart-ads-pro-03-fast`, dedicado a `ADS-PRO-03E1`.

## Referência de repositório (última informação conhecida — não verificada por este vault)

- Repositório Git: `C:\Users\natan\Documents\Revendasmart\.git`
- Checkout observado: branch `release/hotfix-produto-marketing-20260715`, com dirty amplo relatado.

O estado real do repositório só pode ser confirmado por quem efetivamente abrir uma sessão de execução e rodar os comandos Git (`git status`, `git branch --show-current`, `git rev-parse HEAD`, `git worktree list`, `git log -1`) no ambiente real.

## Links para documentação relevante

- [[00-CENTRAL/CONTEXT-PACK-REVENDASMART|Context Pack RevendaSmart]]
- [[00-CENTRAL/DECISOES|Decisões]]
- [[00-CENTRAL/FILA-EXECUCAO|Fila de Execução]]
- [[30-GOVERNANCA/REGISTRIES/FRONTS|Front Registry (RS-SERVICOS-01)]]
- [[30-GOVERNANCA/REGISTRIES/PROTECTED-PATHS|Protected Paths]]
- [[10-AGENTES/CLAUDE-CODE-RS/TAREFAS|Nota de planejamento original]]

## Resultados

Resultados reais de execução ficam em [[01-REVENDASMART/EXECUCOES/RS-SERVICOS-01/RESULTADOS/|RESULTADOS/]] — pasta vazia até o momento; nenhuma execução real registrada.
