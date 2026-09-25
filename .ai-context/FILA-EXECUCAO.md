# Fila de Execução — RevendaSmart

Fila canônica do trabalho já planejado, na sequência definida em [[00-CENTRAL/EXECUCAO-REVENDASMART|EXECUCAO-REVENDASMART.md]] e [[00-CENTRAL/PENDENCIAS|PENDENCIAS.md]]. Nenhuma frente nova foi criada aqui — apenas consolidada a ordem já documentada.

Última atualização: 2026-09-25

| Ordem | Frente | Status | Executor | Dependência | Resultado esperado |
|---|---|---|---|---|---|
| 1 | RS-SERVICOS-01 (Serviços / Android Novo Serviço / Somente Serviços) | PLANEJADA — sem execução registrada | NENHUM (sem evidência real) | Nenhuma | Novo serviço criável e salvável sem erro; Somente Serviços sem elementos de Produtos; Agenda/Reserva pública/Trabalhos/D1/D2 preservados; testes passando |
| 2 | Recent Products | NA FILA | — | Depende de RS-SERVICOS-01 concluído | NÃO VERIFICADO |
| 3 | Sorteio — quantidade de números | NA FILA | — | Depende do item anterior | NÃO VERIFICADO |
| 4 | Catálogo | NA FILA | — | Depende do item anterior | NÃO VERIFICADO |
| 5 | Indicações | NA FILA | — | Depende do item anterior | NÃO VERIFICADO |
| 6 | Plano e Uso | NA FILA | — | Depende do item anterior | NÃO VERIFICADO |
| 7 | Offline | NA FILA | — | Depende do item anterior | NÃO VERIFICADO |
| 8 | Biblioteca 309 | NA FILA | — | Depende do item anterior | NÃO VERIFICADO |
| 9 | Category Icons | NA FILA | — | Depende do item anterior | NÃO VERIFICADO |
| 10 | Booking image/WhatsApp | NA FILA | — | Depende do item anterior | NÃO VERIFICADO |
| 11 | Observabilidade UserSettings | NA FILA | — | Depende do item anterior | NÃO VERIFICADO |
| 12 | QA da nova versão | PLANEJADA | — | Depende de todos os itens acima | Nova versão validada para build interna |
| 13 | BUILD INTERNA | PLANEJADA | — | Depende do QA | Build instalável interna gerada |
| 14 | Teste humano | PLANEJADA | Usuário | Depende da build interna | Feedback real do usuário sobre a build |
| 15 | Correções | PLANEJADA | — | Depende do teste humano | Ajustes aplicados conforme feedback |
| 16 | BUILD final para teste fechado | PLANEJADA | — | Depende das correções | Build para teste fechado gerada |
| 17 | 14 testers | PLANEJADA | — | Depende da build final | Teste fechado com 14 testers executado |

## Fora da execução corrente (não cancelado)

| Frente | Status | Motivo |
|---|---|---|
| REVENDASMART-SEC-SKILLS-01B | PAUSADA OPERACIONALMENTE | Prioridade redirecionada para RS-SERVICOS-01; retomar antes da etapa definida no plano |
| ADS-PRO-03E1 | DECIDIDA — aguardando executor CODEX | Patch já escolhido (CODEX, 6 arquivos); aguardando disponibilidade do executor |
| ADS-PRO-03E3 / ADS-PRO-03E4 | NÃO INICIADAS | Dependem de ADS-PRO-03E1 |
| RS-AUDIT-OFFLINE-01 | A_FAZER | Cadastrada, fora da execução corrente |
| RS-AUDIT-INDICACOES-01 | A_FAZER | Cadastrada, fora da execução corrente |
| RS-AUDIT-CATALOGO-01 | A_FAZER | Cadastrada, fora da execução corrente |
| RS-AUDIT-SEC-PREPUB-01 | A_FAZER | Cadastrada, fora da execução corrente |

---

Fonte: [[00-CENTRAL/EXECUCAO-REVENDASMART|EXECUCAO-REVENDASMART.md]] · [[00-CENTRAL/PENDENCIAS|PENDENCIAS.md]] · [[30-GOVERNANCA/REGISTRIES/FRONTS|FRONTS.md]]
