# Decisões

Registro das decisões consolidadas que orientam projetos e agentes.

Última atualização: 2026-09-24

## RevendaSmart

- O foco atual permanece no app antes da expansão web.
- A publicação na Play Store vem antes do site completo.
- Ads Pro usa arquitetura incremental.
- Os 12 SVGs entram primeiro no manifesto produtivo.
- Os 309 JPEGs permanecem fora da produção por enquanto.
- A biblioteca externa será tratada em frente futura.
- O matcher deve permanecer determinístico.
- `CreativeProfile` é preferência estética, não entitlement.
- CODEX é responsável pela integração final no Git principal.
- Alterações dirty preexistentes devem sempre ser preservadas.
- **2026-09-25 — Reconciliação ADS-PRO-03E1:** entre os dois patches testados e válidos (PASS em testes/typecheck/eslint/smoke/build/bundle), decidido usar o **patch CODEX (6 arquivos, inclui suíte de teste da 03D)** como base de integração. O patch GEMINI (5 arquivos) fica descartado para esta frente. Decisão humana registrada para destravar `ADS-PRO-03E1-CONFLICT-01`.
- **2026-09-25 — Prioridade de agente GEMINI:** GEMINI é liberado da frente de governança do Vault (`OBSIDIAN-FAILOVER-01`) para retomar trabalho de implementação/auditoria no RevendaSmart. A frente de governança fica pausada até GEMINI (ou outro agente) retomar.
- **2026-09-25 — Reprioritização executiva do RevendaSmart:** foco único passa a ser a frente funcional **Serviços / Android Novo Serviço / Somente Serviços**, com objetivo de produzir resultado visível no app e uma nova build interna instalável. `SEC-SKILLS-01B` é registrada como **PAUSADA OPERACIONALMENTE** (não concluída, não cancelada) — GEMINI é redirecionado para Serviços. As auditorias `RS-AUDIT-OFFLINE-01`, `RS-AUDIT-INDICACOES-01`, `RS-AUDIT-CATALOGO-01` e `RS-AUDIT-SEC-PREPUB-01` permanecem cadastradas mas fora da execução corrente. `ADS-PRO-03E1` mantém a decisão de usar o patch CODEX, aguardando esse executor especificamente — GEMINI não deve ser desviado para essa frente agora.

## Grupo Saúde

- **Concorrência de Presença (T4/T5):** Gravações concorrentes de presença de participantes devem utilizar obrigatoriamente transação Firestore, preservando múltiplos registros simultâneos. É terminantemente proibido o padrão read-modify-write não transacional.
- **Central de Ações em Leitura (T5):** A Central de Ações opera por derivação dinâmica em memória (`Firestore -> hooks escopados à unidade -> derivePendingItems -> /actions`). Zero coleção persistida de pendências no Firestore. Resolução puramente automática ao eliminar a causa-raiz no dado de origem.
- **Separação de Kinds Operacionais e Agregados:** Os 8 tipos operacionais (`absent_participant`, `referral_without_return`, `next_action_overdue`, `needs_contact`, `repeated_absence`, `activity_overdue`, `no_recent_followup`, `measurement_pending`) são suportados na Central de Ações. Os 2 kinds analíticos (`low_group_attendance` e `program_below_target`) são reservados para a T6 por dependerem de agregação de indicadores.
- **Isolamento da Migração Legada:** A migração de meetings legados para o modelo de activities deve rodar em frente isolada (`GRUPO-SAÚDE-MIG-01`), com preservação estrita do histórico e sem deploy ou execução em produção.
