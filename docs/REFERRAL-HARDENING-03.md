# Referral hardening 03 — decisões preservadas

## Entitlement pago

O referral é um benefício gratuito e nunca sobrescreve `currentPlan`, `premiumActive`,
`premiumExpiresAt`, `premiumStartedAt` ou `premiumSource` de uma assinatura paga ativa. Quando a
milestone coincide com uma assinatura paga válida, o backend mantém o entitlement e grava
`PRODUCT_DECISION_REQUIRED` em `planData`, sem inventar uma regra de acúmulo de dias.

## Ledger e LGPD

Cada validação grava um documento server-side em
`users/{referrerUid}/planData/main/referralRewardLedger/{eventHash}`. O ledger contém apenas o hash
do evento, a milestone, a data e o resultado; não copia UID, nome, e-mail ou outra PII do indicado.
A exclusão da conta remove eventos, arestas e listas legadas, mas não remove o ledger do referrer.
Assim a contagem de elegibilidade é monotônica e não pode ser reciclada por deleção.

## Flag backend

`referral_program_enabled` é lida pelo backend em `system/config`, a configuração server-owned já
usada pelo fluxo administrativo de assinatura. Remote Config continua sendo apenas visibilidade do
cliente. Com valor explícito `false`, atribuição, `track-event`, `validate-referral` e grants são
bloqueados; dados históricos permanecem. Ausência do campo preserva compatibilidade com documentos
legados e equivale a ON até que o operador grave `false`.

## Contratos de recompensa — decisão de produto pendente

O comportamento atualmente existente continua sendo o contrato A para não alterar produto durante
este hardening:

- **A — benefício único:** `3` indicações válidas concedem 30 dias uma única vez na vida. O ledger
  usa `referralLifetimeCount` monotônico e não concede novamente em `6`, `9`, etc.
- **B — benefício recorrente:** `3`, `6`, `9`, `12`... concedem 30 dias por milestone. A alteração
  técnica futura é trocar a condição de grant para `newCount % 3 === 0` e manter cada milestone
  concedida como entrada imutável do ledger; não se deve reutilizar `premiumExpiresAt` como contador.

Não foi feita a migração para B. Uma recompensa que colide com entitlement pago continua registrada
como `PRODUCT_DECISION_REQUIRED` até o produto decidir se o crédito será acumulado, convertido ou
não concedido.

## P2 documentado, fora do escopo

Anti-farming de 30 segundos, rate-limit em memória e colisão de código de 36 bits permanecem
documentados como limitações/itens posteriores; não foram ampliados nesta entrega.
