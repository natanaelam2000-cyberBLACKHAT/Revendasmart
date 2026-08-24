# Google Play review access — procedimento operacional

Este procedimento prepara uma conta real de revisão para acessar o Premium sem criar compras fictícias, sem gravar credenciais no repositório e sem alterar o fluxo de billing real.

## Escopo

- mecanismo técnico: `premiumSource = "play_review"`
- concessão administrativa por script
- nenhuma senha, token ou segredo armazenado no repo

## Pré-requisitos

1. criar ou escolher uma conta real que será usada exclusivamente para revisão;
2. garantir que essa conta exista no Firebase Authentication;
3. ter acesso administrativo ao ambiente que executa o script.

## Conceder acesso Premium de revisão

Com a conta já criada no Firebase Auth, executar:

`npx tsx script/grant-play-review-access.ts <email-da-conta-de-review>`

O script:

- resolve o UID pelo e-mail no Firebase Auth;
- grava `premiumSource: "play_review"` em `users/{uid}/planData/main`;
- marca `premiumActive: true`, `currentPlan: "premium"` e `premiumOverride: true`;
- não cria `subscriptionId`, `billingProvider` nem `purchaseToken` fictícios.

## Confirmar que a conta ficou Premium

Verificar no Firestore `users/{uid}/planData/main`:

- `premiumSource = "play_review"`
- `premiumActive = true`
- `currentPlan = "premium"`

Também é válido confirmar pelo comportamento do app após login com essa conta.

## Revogar depois da revisão

Revogar pelo procedimento administrativo normal de entitlement, sem criar exceções no código. A revogação não deve passar por Google Play nem Mercado Pago, porque `play_review` não representa compra real.

## O que vai para o Play Console

Fornecer manualmente no Play Console apenas:

- e-mail da conta de review;
- instruções curtas de login, se solicitadas;
- observação de que o acesso Premium foi concedido por mecanismo administrativo de revisão (`play_review`), não por compra.

## Status esperado

- `REVIEW_ACCESS_MECHANISM_READY = YES`
- `REVIEW_ACCOUNT_PROVISIONED = NO` até existir evidência real da conta provisionada no ambiente correto
