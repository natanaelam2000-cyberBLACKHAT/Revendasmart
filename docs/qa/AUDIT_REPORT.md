# Auditoria Geral de Homologação — Revenda Smart

Gerada em: 2026-07-12T19:55:29Z

Branch: `main`
Commit auditado: `615b984 perf: adiciona skills e budgets de performance`

## 1. Resumo executivo

A auditoria encontrou o produto em bom estado técnico para continuar o ciclo de homologação. Não foram encontrados P0/P1 corrigíveis automaticamente no código auditado. Foi encontrado e corrigido um P2 relevante: o smoke test padrão fazia chamada live para produção do catálogo público. Agora esse teste live só roda se `RUN_LIVE_PUBLIC_CATALOG_SMOKE=1` estiver definido.

Decisão objetiva: **B. APROVADO COM CORREÇÕES para commit e próxima fase interna; D. NECESSITA TESTE EXTERNO antes de beta/deploy amplo/Play Store.**

## 2. Worktree inicial

- Branch: `main`
- Commit inicial auditado: `615b984 perf: adiciona skills e budgets de performance`
- `git diff --check`: OK no início
- Worktree inicial: limpo
- Alterações pendentes de onboarding/tema: nenhuma detectada

## 3. Funcionalidades inventariadas

Ver `docs/qa/FUNCTIONALITY_MATRIX.md`.

Resumo:

- PASS: 22
- PARTIAL: 10
- FAIL: 0
- BLOCKED: 7
- NOT_TESTED: 0

## 4. Funcionalidades antigas validadas

- Login/cadastro por inspeção e build.
- Rotas privadas protegidas por `PrivateRouter` e Firebase Auth.
- Produtos/clientes com paginação por smoke estático.
- Vendas finalizadas por transação backend.
- Cobranças e parcelas com hooks paginados por smoke estático.
- Catálogo público paginado e rate-limited por smoke estático e fake request.
- Firestore/Storage Rules por inspeção.

## 5. Funcionalidades recentes validadas

- Onboarding V2 por inspeção e smoke.
- Nichos por teste comportamental real dos helpers.
- Temas por teste comportamental real dos helpers.
- Performance skills e bundle budgets por validação automática.
- Mercado Pago fail-closed por smoke estático e inspeção.

## 6. Bugs encontrados

| Prioridade | Bug | Evidência | Status |
|---|---|---|---|
| P2 | `npm run test` fazia fetch live para produção `/api/public/catalog/adriana-perfumes` | `script/smoke-tests.ts` | Corrigido |
| P2 | Muitos `console.warn/error` diretos ainda existem no frontend e scripts auxiliares | grep estático | Não corrigido nesta auditoria |
| P2 | Admin ainda possui fallback legado por e-mail | `server/routes.ts` | Não corrigido por risco operacional |
| P2 | `marketingHistory` permanece sem regra client explícita; default deny | `firestore.rules` | Documentado |

## 7. Bugs corrigidos

- `script/smoke-tests.ts`: chamada live de produção ficou opt-in com `RUN_LIVE_PUBLIC_CATALOG_SMOKE=1`.
- `script/smoke-tests.ts`: adicionados testes comportamentais de nichos/categorias e fallback de tema.

## 8. Riscos financeiros

- Nenhum P0 novo encontrado por inspeção.
- Fail-closed da conta Mercado Pago conectada permanece presente por código.
- Cobrança real, webhook real, assinatura e refund não foram executados nesta auditoria.
- Exige sandbox antes de qualquer deploy financeiro controlado.

## 9. Riscos de segurança

- Admin fallback por e-mail deve ser removido quando custom claims estiverem 100% migradas.
- Frontend ainda possui logs diretos; recomenda-se migração gradual para safe logger.
- Testes multitenant reais dependem de Firebase Emulator.

## 10. Riscos de perda de dados

- Venda usa transação backend para criar venda, validar cliente/produtos e baixar estoque.
- Não foi executado teste concorrente real de duas vendas simultâneas.
- Exclusão de produto/cliente não foi exercitada contra banco real.

## 11. Riscos de performance

- Bundle budgets passam.
- Scanner e Recharts continuam em chunks separados/lazy.
- Dashboard/relatórios/CRM foram validados por build e inspeção, não por profiling real.

## 12. Riscos de UX/mobile

- Teste visual real em Android/PWA não foi executado nesta auditoria.
- Modais, teclado, bottom nav e gesto Android precisam de checklist manual.

## 13. Skills utilizadas

As skills foram usadas como checklist de revisão em modo REVIEW_ONLY/SAFE_FIX. Nenhuma skill ofensiva foi executada ativamente.

Segurança: `revendasmart-release-security-gate`, `revendasmart-security-review`, `testing-multitenant-data-isolation`, `auditing-firebase-security-rules`, `securing-mercado-pago-subscriptions-and-webhooks`, `revendasmart-payment-integrity`, `revendasmart-production-readiness`.

Performance: `revendasmart-performance-budget-gate`, `auditing-react-render-performance`, `optimizing-vite-bundle-and-code-splitting`, `auditing-firestore-query-performance`, `auditing-firebase-read-cost-and-listeners`, `revendasmart-public-catalog-performance`, `revendasmart-firestore-listener-audit`, `revendasmart-slow-network-review`.

## 14. Testes externos necessários

- Android/PWA físico.
- Mercado Pago sandbox completo.
- Firebase Emulator para Rules e isolamento A/B.
- Staging com webhook público controlado.
- Cloud Run/Secret Manager/IAM somente leitura antes de deploy.

## 15. Resultado das validações

| Comando | Resultado | Observações |
|---|---|---|
| `npm run skills:validate` | PASS | 111 skills validadas |
| `npm run check` | PASS | TypeScript sem erro |
| `npm run build` | PASS | Frontend e server gerados |
| `npm run performance:bundle-check` | PASS | Total JS 2205,13 kB; gzip 656,35 kB |
| `npm run lint` | PASS | Escopo de lint configurado passou |
| `npm run test` | PASS | Smoke tests passaram sem chamada live de produção por padrão |
| `npm audit --omit=dev` | PARTIAL | 8 vulnerabilidades moderadas transitivas via `firebase-admin`/Google libs; fix sugerido é breaking |
| `git diff --check` | PASS | Sem whitespace errors |
| `git status` | PASS | Apenas alterações desta auditoria: `script/smoke-tests.ts` e `docs/qa/` |

### Baseline de bundle registrada

- CSS principal: 159,92 kB no bundle-check; 163,76 kB no output bruto do Vite.
- Entry `index`: 25,21 kB.
- Dashboard: 44,21 kB.
- Settings: 41,98 kB.
- Reports: 24,76 kB.
- Recharts: 326,05 kB.
- Scanner: 405,9 kB.
- Total JS: 2205,13 kB.
- Total JS gzip: 656,35 kB.

## 16. Readiness score

| Área | Score | Motivo |
|---|---:|---|
| Código/build | 90/100 | Build/check/lint/test esperados; correção pequena em smoke |
| Segurança app | 82/100 | Bons controles, mas admin fallback/logs frontend pendentes |
| Firebase/Storage | 84/100 | Rules fortes por inspeção; falta emulator A/B |
| Mercado Pago | 78/100 | Código endurecido; falta sandbox real |
| Performance | 86/100 | Budgets passam; falta profiling real mobile |
| UX/PWA/mobile | 72/100 | Código sólido; falta aparelho real |
| Operação/infra | 76/100 | Hardening avançou; falta revisão live antes de deploy |

## 17. Próximo passo mais importante

Rodar homologação externa controlada: Firebase Emulator + Sandbox Mercado Pago + Android/PWA físico.

## 18. Decisão

- Pronto para commit: sim, após validações finais.
- Pronto para deploy controlado: não ainda; precisa sandbox + QA Android/PWA.
- Pronto para beta: não ainda.
- Pronto para produção ampla: não.
- Pronto para Play Store: não.
