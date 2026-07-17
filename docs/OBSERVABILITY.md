# Observabilidade segura das APIs

Esta base de observabilidade adiciona rastreabilidade interna sem enviar dados pessoais ou segredos para logs.

## Request ID

Toda requisição passa pelo `requestIdMiddleware`.

- Header aceito: `X-Request-Id`.
- Caracteres aceitos: letras, números, `.`, `_`, `:`, `-`.
- Tamanho aceito: 6 a 80 caracteres.
- Quando ausente ou inválido, o backend gera um ID hexadecimal curto de 16 caracteres.
- O backend sempre devolve `X-Request-Id` na resposta.

Use esse valor como código de atendimento para localizar logs de uma falha.

## Formato dos logs HTTP

As rotas `/api` geram um evento estruturado `http.request` com:

- `timestamp`;
- `level`;
- `event`;
- `requestId`;
- `method`;
- `route` normalizada;
- `status`;
- `durationMs`;
- `eventType`;
- `result`;
- `errorCode`, quando houver erro;
- `responseBytes`.

A rota é normalizada para evitar gravar identificadores longos ou valores sensíveis.

## Dados proibidos nos logs

Nunca registrar:

- `Authorization`;
- cookies;
- access tokens;
- refresh tokens;
- senhas;
- payload completo;
- e-mail completo;
- telefone completo;
- CPF/RG;
- cartão, CVV ou dados financeiros sensíveis;
- URL com query string sensível.

O logger sanitiza chaves e strings conhecidas, mas a regra operacional é não enviar esses dados ao logger.

## Códigos seguros de erro

O handler central classifica erros não tratados em códigos seguros:

- `VALIDATION_ERROR`;
- `UNAUTHENTICATED`;
- `FORBIDDEN`;
- `NOT_FOUND`;
- `CONFLICT`;
- `RATE_LIMITED`;
- `EXTERNAL_SERVICE_ERROR`;
- `INTERNAL_SERVER_ERROR`.

A resposta de erro interna inclui:

```json
{
  "message": "Mensagem segura.",
  "error": {
    "code": "SAFE_ERROR_CODE",
    "message": "Mensagem segura.",
    "requestId": "abc123"
  }
}
```

O campo `message` foi mantido por compatibilidade com clientes existentes.

## Health e readiness

### `GET /api/health`

Confirma apenas que o processo está vivo. Não valida Firebase, Mercado Pago ou variáveis de ambiente.

### `GET /api/readiness`

Executa checagens leves e sem escrita. Atualmente valida apenas se o Firebase Admin já está disponível no processo.

Regras:

- não consulta Mercado Pago;
- não grava dados;
- não expõe project ID, tokens ou variáveis de ambiente;
- usa timeout curto;
- retorna `503` com estado `degraded` quando uma dependência essencial não está pronta.

## Como localizar uma falha

1. Peça ao usuário o código de atendimento/request ID mostrado ou capturado no header `X-Request-Id`.
2. Procure nos logs por `requestId`.
3. Use `event=http.request`, `route`, `status` e `errorCode` para identificar a rota e a classe da falha.
4. Se houver `http.unhandled_error`, use apenas informações sanitizadas; não copie payloads ou tokens para tickets.

## Desenvolvimento e produção

Em produção, stack traces não são enviados ao cliente. Em desenvolvimento, os logs continuam sanitizados pelo mesmo logger central.

## Frontend e código de atendimento

O frontend ainda usa `getApiUrl()` como helper central de URL, mas várias telas chamam `fetch()` diretamente e tratam erros localmente. Por isso, esta Sprint não espalhou alterações por componentes ou páginas.

Decisão atual:

- preservar mensagens amigáveis existentes;
- disponibilizar `requestId` no header e em erros centralizados do backend;
- adotar um helper compartilhado de resposta em sprint futura antes de exibir `Código de atendimento: ABC123` de forma uniforme;
- não exibir código técnico para autenticação inválida, validação simples ou erro comum de formulário.

## Decisão de readiness

A readiness foi mantida local e barata por padrão. Ela verifica se o Firebase Admin já está disponível no processo, mas não faz leitura remota de Firestore em cada chamada.

Justificativa:

- health checks podem ser chamados com alta frequência;
- uma leitura real recorrente no Firestore geraria custo e latência sem necessidade para o gate básico;
- uma checagem profunda pode ser adicionada depois como endpoint autenticado ou execução operacional sob demanda;
- Mercado Pago não deve ser consultado por health/readiness.
