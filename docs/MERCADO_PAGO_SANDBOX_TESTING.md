# Mercado Pago Sandbox — validação de assinaturas

Este documento descreve o gate local de assinatura Premium do Revenda Smart. Ele existe para validar o fluxo de assinatura sem tocar produção e sem gerar cobranças reais.

## Escopo validado

- Criação de assinatura usando preço definido no backend.
- `external_reference` vinculado ao UID autenticado.
- Cancelamento idempotente da assinatura do próprio usuário.
- Consulta de status do próprio usuário.
- Sincronização manual autenticada em `/api/app-subscription/sync-now`.
- Webhook com assinatura obrigatória antes de consultar a API do Mercado Pago.
- Proteção contra token de produção em ambiente Sandbox.
- Proteção contra token Sandbox em ambiente de produção.
- Idempotência por `lastSubscriptionEventId`.
- Proteção contra evento fora de ordem por `lastSubscriptionEventAt`.

## Execução local sem credenciais

```bash
npm run test:mercado-pago:sandbox
```

Esse modo não chama a API do Mercado Pago. Ele executa validações determinísticas no código, nas rotas e nos guardrails de ambiente.

## Execução externa Sandbox autorizada

Use somente conta Sandbox e token `TEST-*`.

```bash
MERCADO_PAGO_ENV=sandbox \
MERCADOPAGO_SANDBOX_ACCESS_TOKEN=TEST-... \
MERCADOPAGO_SANDBOX_PAYER_EMAIL=comprador_teste@example.com \
RUN_MERCADO_PAGO_SANDBOX_LIVE=1 \
npm run test:mercado-pago:sandbox
```

O teste externo cria uma assinatura Sandbox pendente e tenta cancelá-la ao final. Ele não deve ser executado contra produção.

## Variáveis relevantes

- `MERCADO_PAGO_ENV=sandbox` para ambiente de homologação.
- `MERCADOPAGO_ACCESS_TOKEN` ou `MERCADOPAGO_SANDBOX_ACCESS_TOKEN` com prefixo `TEST-` no Sandbox.
- `MERCADOPAGO_WEBHOOK_SECRET` para validar webhooks.
- `MERCADOPAGO_SANDBOX_PAYER_EMAIL` apenas quando `RUN_MERCADO_PAGO_SANDBOX_LIVE=1`.

## Proibições

- Não usar token `APP_USR-*` com `MERCADO_PAGO_ENV=sandbox`.
- Não usar token `TEST-*` com ambiente de produção.
- Não executar ciclo live sem `RUN_MERCADO_PAGO_SANDBOX_LIVE=1`.
- Não usar compradores reais ou cartões reais.
- Não fazer deploy de configuração apenas para rodar teste.

## Resultado esperado sem credenciais

O relatório deve indicar:

- testes locais passaram;
- integração externa Sandbox pendente por ausência de credenciais/flag;
- produção não foi acessada.
