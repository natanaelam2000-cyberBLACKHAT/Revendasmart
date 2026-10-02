# REFERRAL-HARDENING-07 LOCAL

Branch: `work/referral-hardening-07-local`.
Base/HEAD: `6e12e90594f7cbcfb805339c0b537bb4be294e62`.
Sem commit, push ou deploy. Sem alterações nos P1 stale token A→B ou durable referral recovery.

## Estado inicial preservado

13 arquivos: package.json; script/account-deletion-tests.ts;
script/referral-settings-isolation-tests.ts; script/release-v1-gating-tests.ts;
script/smoke-tests.ts; server/account-deletion.ts; server/plan-lifecycle.ts;
server/public-catalog-ownership.ts; server/routes.ts; shared/monetization.ts;
docs/REFERRAL-HARDENING-03.md; script/referral-hardening-05-tests.ts;
server/referral-program.ts.

Snapshot dos 13 arquivos e SHA-256: `.tmp/referral-07-baseline/files/` e
`.tmp/referral-07-baseline/manifest.json`.
Diff inicial rastreado: `.tmp/referral-07-baseline/REFERRAL-05_EXISTING_DIFF.patch`.
Delta de código/testes 07: `.tmp/referral-07-baseline/REFERRAL-07_NEW_CHANGES.patch`.
Os novos arquivos iniciais também estão preservados integralmente no snapshot.

Dos 13 arquivos iniciais, 10 permanecem byte a byte iguais ao snapshot.
Alterações adicionais somente em shared/monetization.ts, package.json e
script/referral-hardening-05-tests.ts. Arquivos novos no diff: server/subscriptions.ts
(já rastreado na base), script/referral-hardening-07-tests.ts e este relatório.

## Correção

`isPaidEntitlementActive` usa exclusivamente paidThrough para expiração paga v2.
`resolveGenericPaidPlan` não usa premiumExpiresAt como fallback.
Assinatura v2 authorized com paidThrough=null preserva Pro/Premium mesmo com referral vencido.
PaidThrough vencido continua revogando; premiumExpiresAt continua governando reward e legado.

`resolvePaidThroughDate` separa v2: paidThrough, depois nextBillingAt.
No contrato Mercado Pago, nextBillingAt representa o fim do período corrente já pago.
Cancelamento e sync reutilizam esse helper real. Legacy mantém a precedência histórica.
Nenhum campo histórico foi apagado; writers não foram modificados.

## Writers reais auditados

V2_RENEWAL_WRITES_PAIDTHROUGH=YES (null na renovação; data no congelamento de carência)

V2_RENEWAL_CLEARS_PREMIUMEXPIRESAT=NO

V2_RENEWAL_CHANGES_PREMIUMSOURCE=NO

REFERRAL_WRITES_PREMIUMEXPIRESAT=YES (Timestamp de 30 dias quando reward é concedido)

REFERRAL_WRITES_PREMIUMSOURCE=YES (referral_reward quando reward é concedido)

Evidências: syncGenericPaidPlanFromSubscription em server/subscriptions.ts;
transação de validação/recompensa em server/routes.ts. O writer legado de assinatura
é distinto: ele modifica premiumSource e premiumExpiresAt; não foi confundido com v2.
Quando há entitlement pago ativo, a transação de referral preserva os campos pagos.

## Validação

- 19 regressões temporais 07 passaram, com funções reais, cobrindo A–O,
  status active/approved, fronteira exata e precedência de datas.
- 46 regressões 05 passaram. A expectativa que tratava expiração legacy como
  autoridade v2 foi corrigida explicitamente.
- npm test passou, incluindo ambas as suítes.
- Typecheck passou com `npm run check -- --tsBuildInfoFile .tmp/referral-07.tsbuildinfo`.
  A execução padrão encontrou EPERM no cache compartilhado de node_modules.
- npm run lint passou: zero erros, um aviso em settings.tsx não alterado.
- npm run build passou após repetir fora do sandbox por bloqueio de leitura do esbuild.
- git diff --check passou.

O caso L testa o helper real usado por cancelamento/sync e o acesso após congelamento.
Não foi executado teste HTTP integrado com emulador nesta rodada.
Budgets, dependências e staging principal não foram alterados.
