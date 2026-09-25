# REVENDASMART — CONTEXT PACK

Última atualização: 2026-09-25

Arquivo de leitura obrigatória para qualquer executor (Claude Code, Codex, Gemini/OpenCode) antes de iniciar trabalho real no RevendaSmart. Ver protocolo completo em [[00-CENTRAL/PROTOCOLO-IAS|PROTOCOLO-IAS.md]].

## 1. OBJETIVO ATUAL

Finalizar o plano atual → gerar nova build interna → teste humano → corrigir → teste fechado com 14 testers. A auditoria geral pré-produção fica para depois.

Foco único no momento: **Serviços / Android Novo Serviço / Somente Serviços** (RS-SERVICOS-01), como bloqueador funcional antes da próxima build interna.

## 2. ESTADO DO PROJETO

Em desenvolvimento avançado. Última frente commitada: ADS-PRO-03E2 (`f247a9c4`). Última reprioritização executiva (2026-09-25): foco único passou a ser RS-SERVICOS-01; auditorias amplas (Offline, Indicações, Catálogo, Pré-publicação) e SEC-SKILLS-01B ficaram fora da execução corrente, mas não canceladas.

## 3. FRENTE ATUAL

`RS-SERVICOS-01` — Serviços / Android Novo Serviço / Somente Serviços.

Status documental: **PLANEJADA — sem execução registrada.** Nenhuma sessão real de CODEX, Claude Code ou Gemini foi confirmada com evidência até o momento. Ver [[01-REVENDASMART/EXECUCOES/RS-SERVICOS-01/BRIEF|BRIEF.md]].

## 4. DECISÕES CONGELADAS

- O foco atual permanece no app antes da expansão web.
- A publicação na Play Store vem antes do site completo.
- Ads Pro usa arquitetura incremental.
- Os 12 SVGs entram primeiro no manifesto produtivo; os 309 JPEGs permanecem fora da produção por enquanto.
- O matcher deve permanecer determinístico.
- `CreativeProfile` é preferência estética, não entitlement.
- CODEX é responsável pela integração final no Git principal.
- Alterações dirty preexistentes devem sempre ser preservadas.
- ADS-PRO-03E1: usar o patch CODEX (6 arquivos, inclui suíte de teste da 03D); patch GEMINI descartado para esta frente.
- SEC-SKILLS-01B está PAUSADA OPERACIONALMENTE, não cancelada; SEC-SKILLS-02 não deve iniciar antes de 01B fechar.
- Foco único atual: Serviços / Android Novo Serviço / Somente Serviços.

Fonte completa: [[00-CENTRAL/DECISOES|DECISOES.md]].

## 5. CONCLUÍDO

- Pedidos Editáveis — `e4e3b6a` (`e4e3b6aff959aea5e935266303aef968e161f346`) — INTEGRADO E CONCLUÍDO, ancestral do HEAD oficial.
- ADS-PRO-03D — Creative Style Quiz UI — `8d9b3ae`.
- ADS-PRO-03E2 — production asset manifest — `f247a9c4` — 25/25 testes, 10/10 mutation tests, typecheck/eslint/smoke/build/bundle PASS.
- REVENDASMART-SEC-SKILLS-01 — inventário de 61 repositórios, 2.090 skills, matriz de 25 áreas.

## 6. EM ANDAMENTO

Nenhuma frente com evidência real de execução em andamento no momento. RS-SERVICOS-01 é a frente ativa, mas sem execução confirmada.

## 7. PLANEJADO

Ver [[00-CENTRAL/FILA-EXECUCAO|FILA-EXECUCAO.md]] para a ordem completa.

## 8. BLOQUEADOS

- ADS-PRO-03E1 — DECIDIDA, aguardando executor CODEX (disponibilidade/cota). Gate documentado em [[30-GOVERNANCA/REGISTRIES/PROTECTED-PATHS|PROTECTED-PATHS.md]].
- Nenhum outro bloqueio técnico registrado para RS-SERVICOS-01 até o momento.

## 9. ÚLTIMOS COMMITS REGISTRADOS

- `f247a9c4cd8619b365934b04a58bb9d35b47d231` — `feat(ads): add production asset manifest` (ADS-PRO-03E2).
- `8d9b3ae08f1af8e9decd46176cd1c74435e31b85` — `feat(ads): add creative style quiz UI` (ADS-PRO-03D) — HEAD oficial conhecido pelo vault.
- `e4e3b6aff959aea5e935266303aef968e161f346` — `feat(orders): add safe order editing and charge recovery` (Pedidos Editáveis).

**Todo executor deve revalidar o Git real (`git status`, `git branch --show-current`, `git rev-parse HEAD`, `git worktree list`, `git log -1`) antes de qualquer escrita — os hashes acima são os últimos conhecidos pelo vault, não uma garantia do estado atual do repositório.**

## 10. ÁREAS/ARQUIVOS PROTEGIDOS

Contratos congelados (não alterar sem ADR formal + suíte de regressão):

- `shared/ads-pro/asset-dna.ts`
- `shared/ads-pro/asset-parser.ts`
- `shared/ads-pro/asset-matcher.ts`
- `shared/ads-pro/creative-profile.ts`
- `shared/ads-pro/style-quiz.ts`
- `client/src/lib/ads-pro-profile-persistence.ts`
- `firestore.rules` (SEGURANCA_ESTRITA — mudança exige suíte do emulador Firebase 100% PASS + aprovação humana)

Registro completo com gates e owners: [[30-GOVERNANCA/REGISTRIES/PROTECTED-PATHS|PROTECTED-PATHS.md]].

## 11. PRÓXIMAS TAREFAS

Ver [[00-CENTRAL/FILA-EXECUCAO|FILA-EXECUCAO.md]].

## 12. RELATÓRIOS MAIS IMPORTANTES

- [[00-CENTRAL/PAINEL|PAINEL.md]]
- [[00-CENTRAL/STATUS-GERAL|STATUS-GERAL.md]]
- [[00-CENTRAL/EXECUCAO-REVENDASMART|EXECUCAO-REVENDASMART.md]]
- [[01-REVENDASMART/00-PROJETO/STATUS-ATUAL|01-REVENDASMART/00-PROJETO/STATUS-ATUAL.md]]
- [[01-REVENDASMART/00-PROJETO/PLANO-MESTRE|01-REVENDASMART/00-PROJETO/PLANO-MESTRE.md]]
- [[30-GOVERNANCA/REGISTRIES/FRONTS|FRONTS.md]]
- [[30-GOVERNANCA/REGISTRIES/PROTECTED-PATHS|PROTECTED-PATHS.md]]
- [[01-REVENDASMART/EXECUCOES/RS-SERVICOS-01/BRIEF|EXECUCOES/RS-SERVICOS-01/BRIEF.md]]

## 13. REGRA DOS EXECUTORES

O vault fornece contexto documental. O repositório Git é a fonte de verdade do código. Todo executor deve revalidar branch, HEAD, worktree, status e dirty antes de modificar arquivos.
