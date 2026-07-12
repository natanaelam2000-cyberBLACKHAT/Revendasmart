# Matriz de Testes Mercado Pago — Revenda Smart

| Fluxo | Arquivos | Evidência atual | Status | Próximo teste seguro |
|---|---|---|---|---|
| OAuth start | `mercadopago-connections.ts`, `useMPConnections.ts` | Rota autenticada e rate limited por inspeção | PARTIAL | Sandbox com conta teste |
| OAuth callback | `mercadopago-connections.ts` | Callback backend com state/nonce por inspeção | PARTIAL | Sandbox + redirect allowlist |
| Revoke conexão | `mercadopago-connections.ts` | Soft revoke por inspeção | PARTIAL | Sandbox |
| Conta default | `mercadopago-connections.ts` | Rota autenticada por inspeção | PARTIAL | Sandbox |
| Create payment link | `payments.ts` | Rota autenticada e tokenSource inspecionado | PASS | Sandbox sem cobrança real |
| Fail-closed conta conectada | `payments.ts`, `mercadopago-connections.ts` | Sem fallback central silencioso; mensagem de reconexão | PASS | Sandbox com token revogado |
| Sync/resync cobrança | `payments.ts` | Usa tokenSource original por inspeção | PARTIAL | Sandbox |
| Delete cobrança | `payments.ts` | Rota autenticada | PARTIAL | Sandbox |
| Webhook pagamento | `payments.ts` | Assinatura/secret por smoke estático | BLOCKED | Webhook sandbox real |
| Webhook assinatura | `subscriptions.ts` | HMAC/timingSafeEqual/timestamp por smoke estático | BLOCKED | Webhook sandbox real |
| Premium create/cancel/status | `subscriptions.ts`, `subscribe.tsx` | Build e smoke estático | BLOCKED | Sandbox Mercado Pago |
| Eventos duplicados/fora de ordem | `payments.ts`, `subscriptions.ts` | Guardrails por inspeção | BLOCKED | Teste local/staging autorizado |

Nenhuma cobrança real foi criada e nenhum webhook real foi disparado nesta auditoria.
