# Secret Manager no Cloud Run — RevendaSmart

Este guia documenta o uso seguro do Google Secret Manager com o serviço Cloud Run do RevendaSmart.

Importante:

- Nunca coloque valores reais de secrets no Git.
- Nunca cole tokens, chaves privadas, access tokens ou DSNs em issue, PR, commit ou relatório.
- Em produção, secrets devem aparecer no Cloud Run como `valueFrom.secretKeyRef`, não como `value` plain.
- Ambiente local pode usar `.env` privado, mas arquivos `.env*` reais permanecem ignorados.

## Serviço padrão

```bash
PROJECT_ID="revenda-smart"
REGION="us-central1"
SERVICE="revendasmart-backend"
```

## Secrets esperados

| Env Cloud Run | Secret Manager sugerido | Obrigatório |
| --- | --- | --- |
| `MERCADOPAGO_ACCESS_TOKEN` | `revendasmart-mercadopago-access-token` | Sim |
| `MERCADOPAGO_CLIENT_ID` | `revendasmart-mercadopago-client-id` | Sim |
| `MERCADOPAGO_CLIENT_SECRET` | `revendasmart-mercadopago-client-secret` | Sim |
| `MERCADOPAGO_TOKEN_ENCRYPTION_KEY` | `revendasmart-mercadopago-token-encryption-key` | Sim |
| `MERCADOPAGO_WEBHOOK_SECRET` | `revendasmart-mercadopago-webhook-secret` | Sim |
| `FIREBASE_PROJECT_ID` | `revendasmart-firebase-project-id` | Sim |
| `FIREBASE_CLIENT_EMAIL` | `revendasmart-firebase-client-email` | Sim |
| `FIREBASE_PRIVATE_KEY` | `revendasmart-firebase-private-key` | Sim |
| `SENTRY_DSN` | `revendasmart-sentry-dsn` | Opcional |

## Verificar se Cloud Run está usando Secret Manager

Use o script seguro:

```bash
scripts/security/verify-cloud-run-secrets.sh
```

Com parâmetros explícitos:

```bash
scripts/security/verify-cloud-run-secrets.sh \
  --project revenda-smart \
  --region us-central1 \
  --service revendasmart-backend
```

O script mostra apenas nomes das variáveis e status:

- `secret`: configurado via Secret Manager.
- `plain`: configurado como variável plain no Cloud Run.
- `missing`: ausente.
- `optional-missing`: opcional e ausente.

O script falha se qualquer secret obrigatório estiver `plain` ou `missing`.

## Adicionar nova versão de um secret

Use o script seguro, lendo o valor por `stdin`:

```bash
printf "%s" "$MERCADOPAGO_ACCESS_TOKEN_VALUE" | \
  scripts/security/update-secret-version.sh revendasmart-mercadopago-access-token
```

Com projeto explícito:

```bash
printf "%s" "$SECRET_VALUE" | \
  scripts/security/update-secret-version.sh revendasmart-mercadopago-webhook-secret revenda-smart
```

Regras:

- O valor não deve aparecer no comando em texto puro.
- O valor deve vir de variável local temporária, gerenciador de senha ou entrada segura.
- O script valida que o secret existe antes de adicionar nova versão.
- O script nunca imprime o valor.

## Atualizar Cloud Run para apontar envs para secrets

Exemplo seguro usando apenas nomes de secrets:

```bash
gcloud run services update revendasmart-backend \
  --project revenda-smart \
  --region us-central1 \
  --update-secrets=MERCADOPAGO_ACCESS_TOKEN=revendasmart-mercadopago-access-token:latest,MERCADOPAGO_CLIENT_ID=revendasmart-mercadopago-client-id:latest,MERCADOPAGO_CLIENT_SECRET=revendasmart-mercadopago-client-secret:latest,MERCADOPAGO_TOKEN_ENCRYPTION_KEY=revendasmart-mercadopago-token-encryption-key:latest,MERCADOPAGO_WEBHOOK_SECRET=revendasmart-mercadopago-webhook-secret:latest,FIREBASE_PROJECT_ID=revendasmart-firebase-project-id:latest,FIREBASE_CLIENT_EMAIL=revendasmart-firebase-client-email:latest,FIREBASE_PRIVATE_KEY=revendasmart-firebase-private-key:latest
```

Observações:

- Esse comando cria uma nova revisão do Cloud Run.
- Execute somente em janela controlada.
- Após atualizar, rode `verify-cloud-run-secrets.sh`.
- Não remova versões antigas antes de validar a nova revisão.

## Configurar SENTRY_DSN futuramente

Criar o secret, se ainda não existir:

```bash
gcloud secrets create revendasmart-sentry-dsn \
  --project revenda-smart \
  --replication-policy="automatic"
```

Adicionar versão sem imprimir o valor:

```bash
printf "%s" "$SENTRY_DSN_VALUE" | \
  scripts/security/update-secret-version.sh revendasmart-sentry-dsn revenda-smart
```

Atualizar Cloud Run:

```bash
gcloud run services update revendasmart-backend \
  --project revenda-smart \
  --region us-central1 \
  --update-secrets=SENTRY_DSN=revendasmart-sentry-dsn:latest
```

`SENTRY_DSN` é opcional no verificador. Se configurado como secret, aparecerá como `secret`.

## Validar `/health`

Buscar URL atual do Cloud Run:

```bash
BACKEND_URL="$(gcloud run services describe revendasmart-backend \
  --project revenda-smart \
  --region us-central1 \
  --format='value(status.url)')"
```

Testar health check:

```bash
curl -fsS -o /dev/null -w "HTTP %{http_code}\n" "$BACKEND_URL/health"
```

Esperado:

```text
HTTP 200
```

## Validar headers de segurança

```bash
curl -fsSI "$BACKEND_URL/health"
```

Verifique headers como:

- `x-content-type-options`
- `x-frame-options`
- `referrer-policy`
- `permissions-policy`

## Rollback seguro

Se a nova revisão falhar:

```bash
gcloud run revisions list \
  --project revenda-smart \
  --region us-central1 \
  --service revendasmart-backend
```

Direcione tráfego para a revisão anterior conhecida como saudável:

```bash
gcloud run services update-traffic revendasmart-backend \
  --project revenda-smart \
  --region us-central1 \
  --to-revisions REVISAO_ANTERIOR=100
```

## Rotação recomendada

- Mercado Pago: gerar novas credenciais no painel e adicionar nova versão no Secret Manager.
- Webhook secret: gerar novo segredo, atualizar Mercado Pago e Cloud Run.
- Firebase private key: criar nova chave de service account, validar, depois revogar a antiga.
- Encryption key: rotacionar com plano próprio, pois pode afetar tokens já criptografados.
- Sentry DSN: adicionar somente quando o projeto Sentry estiver definido.

## O que nunca fazer

- Não commitar `.env`, `env.yaml`, JSON de service account ou ZIP com credenciais.
- Não usar `gcloud run services describe` em relatório colando saída completa, porque pode expor valores plain se houver regressão.
- Não passar valor de secret como argumento de script.
- Não imprimir payload completo de webhook, OAuth ou pagamento em logs.
