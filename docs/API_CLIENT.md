# Cliente central de API

O frontend agora possui um cliente HTTP leve em `client/src/lib/api-client.ts`.

## Uso básico

```ts
const data = await apiRequest<MyResponse>("/api/example", {
  method: "GET",
});
```

Para JSON de escrita:

```ts
await apiRequest("/api/example", {
  method: "POST",
  auth: true,
  body: { enabled: true },
});
```

O cliente usa `getApiUrl()` para construir URLs e não substitui chamadas diretas ao Firestore.

## Autenticação

Use `auth: true` somente em endpoints que exigem Firebase ID token. O token é obtido de `getFirebaseAuth().currentUser.getIdToken()` ou de `getAuthToken`, quando a chamada injeta um token explicitamente.

O header `Authorization` não é enviado quando `auth` não é solicitado.

## Timeout e cancelamento

O timeout padrão é 15 segundos. Pode ser ajustado por chamada:

```ts
await apiRequest("/api/status", { timeoutMs: 8000 });
```

Para cancelar manualmente:

```ts
const controller = new AbortController();
apiRequest("/api/status", { signal: controller.signal });
controller.abort();
```

## Erros

Falhas geram `ApiError` com campos seguros:

- `status`;
- `code`;
- `message`;
- `requestId`;
- `retryable`;
- `safeCause` somente em desenvolvimento.

Nunca exiba stack trace, HTML de erro, payload, token Firebase ou detalhes internos do Mercado Pago.

## RequestId e código de atendimento

O `requestId` é extraído nesta ordem:

1. `error.requestId` no JSON;
2. `requestId` no JSON;
3. header `X-Request-Id`.

Use `formatApiSupportCode(error)` ou `buildApiErrorDisplayMessage(error)` para exibir `Código de atendimento: ABC123` apenas em falhas internas, indisponibilidade, timeout, erro de rede ou resposta inesperada.

Não mostre código de atendimento em validação comum, credenciais inválidas, limite conhecido do plano ou erro de formulário local.

## Retry

O cliente não executa retry automático. Escritas como criação, cancelamento, sync e mutações financeiras não devem ser repetidas implicitamente.

Retries futuros precisam ser explícitos, limitados e restritos a operações idempotentes/seguras.

## Migração futura

Migre rotas aos poucos:

1. chamadas com autenticação e contrato JSON claro;
2. fluxos críticos com erro exibido ao usuário;
3. endpoints que já retornam envelope seguro com `requestId`;
4. nunca migrar chamadas Firestore diretas para este cliente.

Evite refatorações amplas. Cada migração deve preservar loading, mensagens e comportamento atual.
