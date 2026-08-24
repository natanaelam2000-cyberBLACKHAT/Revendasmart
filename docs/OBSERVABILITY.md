# Observabilidade de producao

Esta camada separa diagnostico operacional de analytics de produto. Logs e eventos de erro existem para localizar falhas e apoiar suporte; eventos de produto continuam em Firebase Analytics.

## Inventario

| Area | Estado | Evidencia |
| --- | --- | --- |
| Logger server-side sanitizado | IMPLEMENTED | `server/logger.ts` |
| Request ID API | IMPLEMENTED | `requestIdMiddleware`, header `X-Request-Id` |
| Logs HTTP estruturados para `/api` | IMPLEMENTED | evento `http.request` em `server/index.ts` |
| Sentry server | PARTIAL | `@sentry/node` inicializa somente com `SENTRY_DSN` |
| React ErrorBoundary global | IMPLEMENTED | `client/src/components/GlobalErrorBoundary.tsx` |
| Captura client `window.error` e `unhandledrejection` | IMPLEMENTED | `client/src/lib/client-diagnostics.ts` |
| RTDB error logs client | REMOVED | `client/src/lib/error-logging.ts` não escreve mais em Realtime Database |
| Firebase Analytics | IMPLEMENTED | `client/src/lib/firebase-analytics.ts`; analytics de produto, nao erro tecnico |
| Firebase Performance | IMPLEMENTED | `client/src/lib/firebase-performance.ts`; automatic network/page metrics |
| Crashlytics Android nativo | MISSING | Nenhum plugin/config nativo encontrado |
| Android Vitals / Play Console | OBSERVABILITY_CONSOLE_PENDING | Depende de app publicado/configurado no Play Console |
| Alertas Cloud Monitoring/Sentry | OBSERVABILITY_CONSOLE_PENDING | Configuracao externa ainda nao aplicada |

## Request ID

Toda requisicao passa pelo `requestIdMiddleware`.

- Header aceito: `X-Request-Id`.
- Caracteres aceitos: letras, numeros, `.`, `_`, `:`, `-`.
- Tamanho aceito: 6 a 80 caracteres.
- Quando ausente ou invalido, o backend gera um ID hexadecimal curto de 16 caracteres.
- O backend sempre devolve `X-Request-Id` na resposta.

Use esse valor como codigo de atendimento para localizar logs de uma falha.

## Logs HTTP

Rotas `/api` geram `http.request` com:

- `requestId`
- `method`
- `route` normalizada
- `status`
- `durationMs`
- `eventType`
- `result`
- `errorCode`, quando houver
- `responseBytes`

A rota e identificadores sao normalizados para reduzir exposicao de dados sensiveis.

## Dominios criticos

Eventos criticos devem usar nomes estaveis e os dominios abaixo:

| Dominio | Eventos esperados |
| --- | --- |
| `AUTH` | login/signup/logout failures, token invalid/expired |
| `CATALOG` | public catalog read failures, slug conflicts, ownership failures |
| `UPLOAD` | accepted, rejected, quota exceeded, storage write failed |
| `SUBSCRIPTION_MP` | create/cancel/status/webhook success or failure |
| `PLAY_BILLING` | verify/restore/rtdn success or failure |
| `MARKETING_PRO` | entitlement denied, generation started, ready, failed |
| `ACCOUNT_DELETION` | blocked, completed, failed |
| `REFERRAL` | rejected, tracked, validated, grant failed |

O helper `logDomainEvent()` existe para novos pontos instrumentados. Logs legados ja usam nomes especificos por dominio, como `uploads.log`, `play_billing.log`, `marketing_pro.*` e `account_deletion.*`.

## Dados proibidos

Nunca registrar:

- access token
- refresh token
- purchaseToken bruto
- authorization code
- API key
- senha
- dados de cartao
- binario ou imagem
- payload completo
- Authorization header
- cookies
- e-mail, telefone, CPF ou RG completos

O logger sanitiza chaves e strings conhecidas, mas a regra operacional e nao enviar esses dados ao logger.

## Client crash reporting

Estrategia atual recomendada:

1. Agora: ErrorBoundary + handlers globais + safeLogger local, sem dependencia nova.
2. Proxima decisao: Sentry client/web se a equipe quiser stack traces e source map upload em um console unico.
3. Android nativo: Firebase Crashlytics depois que Play Console/Android release estiverem prontos.

Comparacao curta:

| Opcao | Pro | Caveat |
| --- | --- | --- |
| Sentry client/web | Bom para React/WebView e source maps | Exige DSN client, configuracao de privacidade e upload de source maps |
| Firebase Crashlytics | Bom para crashes/ANR nativos Android | Exige plugin/config nativo e Play/Firebase console |
| Combinacao minima | Melhor cobertura final | Mais manutencao e Data Safety mais cuidadoso |

Decisao desta sprint: nao instalar dependencia nova. `OBSERVABILITY_CONSOLE_PENDING` permanece verdadeiro para Sentry client/Crashlytics/alertas.

## Analytics vs diagnostico

Firebase Analytics registra eventos de produto. Nao deve receber dados comerciais sensiveis ou payloads de erro tecnico.

Diagnostico usa:

- server logs estruturados;
- `requestId`;
- `client.diagnostic`;
- logs locais sanitizados no cliente quando houver erro durante a sessão.

## Health e readiness

### `GET /api/health`

Confirma apenas que o processo esta vivo. Nao valida Firebase, Mercado Pago, Google Play, Photoroom, Gemini ou outro provider pago.

### `GET /api/readiness`

Executa checagens leves e sem escrita. Atualmente valida apenas disponibilidade local do Firebase Admin no processo, com timeout curto.

## Source maps

`vite.config.ts` usa `build.sourcemap: mode !== "production"`. Builds de producao nao publicam source maps em `dist/public`.

Se Sentry client for adotado, o upload de source maps deve ser feito para o console de crash reporting, sem expor `.map` publicamente e sem embutir segredo no bundle.

## Alertas obrigatorios

P0:

- auth outage;
- spike de API 5xx;
- falhas de verificacao de billing;
- falhas de webhook;
- falhas de account deletion;
- anomalias de upload/quota.

P1:

- falhas de Marketing provider;
- degradacao de latencia;
- falhas de catalogo publico.

Esses alertas dependem de Cloud Monitoring, Sentry ou console equivalente. Ainda nao foram configurados neste checkout.

## Android Vitals

`PLAY_CONSOLE_PENDING`:

- crash-free users;
- ANR;
- pre-launch report;
- device catalog;
- distribuicao de WebView versions.

## Estado final desta sprint

- `OBSERVABILITY_RUNTIME_READY`: runtime local basico pronto.
- `CLIENT_CRASH_REPORTING_READY`: parcialmente pronto para React/WebView; console externo pendente.
- `PRODUCTION_ALERTING_READY`: nao, depende de configuracao externa.
