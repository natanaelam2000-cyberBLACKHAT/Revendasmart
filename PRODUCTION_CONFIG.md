# 📋 Documentação de Configuração em Produção — Assinatura Premium

**Aplicação:** RevendaSmart  
**Componente:** Assinatura Recorrente (Mercado Pago PreApproval)  
**Versão:** 1.0 (Fase 3)  
**Data:** Abril 2026  

---

## 1. VARIÁVEIS DE AMBIENTE

### 1.1 Mercado Pago — CENTRAL ACCOUNT (Assinatura Premium)

#### `MERCADOPAGO_ACCESS_TOKEN`
- **O quê:** Token de acesso da conta CENTRAL do Mercado Pago (app RevendaSmart)
- **Tipo:** String (Bearer token)
- **Obrigatório:** ✅ SIM — aplicação não funciona sem
- **Onde é usado:**
  - `server/subscriptions.ts:27` — Criar PreApprovalPlans e PreApprovals
  - `server/payments.ts:51` — Fallback para pagamentos de revendedor (se OAuth falhar)
  - `server/mercadopago-connections.ts:262` — Validar conexões revendedor
- **Padrão:** Nenhum (erro se não setado)
- **Escopo:** Deve ter permissões:
  - `preapproval:create` (criar assinaturas)
  - `preapproval:read` (consultar status)
  - `preapproval:update` (cancelar)
- **Quando trocor:**
  - [ ] Ao migrar para novo ambiente (Replit → Cloud Run)
  - [ ] Se token expirar (MP renova anualmente)
  - [ ] Se conta do app trocar

**Como obter:**
```
1. Acessar: https://www.mercadopago.com.br/account/credentials
2. Aba: "Credenciais de produção"
3. Copiar: "Token de acesso"
4. Guardar com segurança (não commitar no Git!)
```

---

#### `MERCADOPAGO_WEBHOOK_SECRET`
- **O quê:** Secret para validar assinatura HMAC dos webhooks MP
- **Tipo:** String (hex ou base64)
- **Obrigatório:** ⚠️ RECOMENDADO (falta = aviso no log, mas processa webhook)
- **Onde é usado:**
  - `server/subscriptions.ts:28` — Validar assinatura webhook (futuro: implementar)
  - `server/payments.ts:52` — Mesmo webhook pode ter eventos de pagamento
- **Padrão:** Vazio (gera aviso)
- **Como obter:**
  ```
  1. Acessar: https://www.mercadopago.com.br/settings/account/webhooks
  2. Após registrar webhook → MP gera signing key/secret
  3. Guardar em local seguro
  4. Regenerar se comprometido
  ```

---

#### `MERCADOPAGO_CLIENT_ID` e `MERCADOPAGO_CLIENT_SECRET`
- **O quê:** Credenciais OAuth para revendedoras conectarem suas contas MP
- **Tipo:** String (app credentials)
- **Obrigatório:** ✅ SIM (se revendedor quer usar OAuth)
- **Onde é usado:**
  - `server/mercadopago-connections.ts:56,57` — Iniciar fluxo OAuth
  - `server/mercadopago-connections.ts` — Trocar code por access_token
- **Padrão:** Nenhum (erro se não setado)
- **Escopo:** Revendador vai autorizar sua própria conta, não a central
- **Como obter:**
  ```
  1. Acessar: https://www.mercadopago.com.br/developers/applications
  2. Criar nova aplicação (App Name: "RevendaSmart")
  3. Aba "Credenciais"
  4. Copiar: Client ID e Client Secret
  5. Guardar
  ```

---

#### `MERCADOPAGO_REDIRECT_URI`
- **O quê:** URL para onde MP redireciona após revendedor autorizar
- **Tipo:** URL (HTTPS obrigatório)
- **Obrigatório:** ✅ SIM (se OAuth)
- **Onde é usado:**
  - `server/mercadopago-connections.ts:59` — Callback OAuth
  - `GET /api/mercadopago/callback` — Processa authorization code
- **Padrão:** `https://reseller-catalog-hub.replit.app/api/mercadopago/callback`
- **Em produção (Cloud Run):** Será `https://<CLOUD_RUN_URL>/api/mercadopago/callback`
- **Quando trocor:**
  - [ ] Migrar Replit → Cloud Run (URL muda)
  - [ ] Mudar domínio da API
- **⚠️ IMPORTANTE:** Registrar EXATAMENTE como configurado em MP App Settings

---

### 1.2 Firebase — Admin SDK

#### `FIREBASE_PROJECT_ID`
- **O quê:** ID do projeto Firebase
- **Tipo:** String
- **Obrigatório:** ✅ SIM
- **Valor:** `revenda-smart`
- **Onde é usado:**
  - `server/firebase-admin-init.ts:26` — Inicializar Firebase Admin SDK
  - Toda operação que lê/escreve em Firestore
- **Padrão:** Nenhum
- **Quando trocor:** Nunca (projeto fixo)

#### `FIREBASE_CLIENT_EMAIL`
- **O quê:** Email da service account do Firebase
- **Tipo:** String
- **Obrigatório:** ✅ SIM
- **Valor:** `firebase-adminsdk-fbsvc@revenda-smart.iam.gserviceaccount.com`
- **Onde é usado:**
  - `server/firebase-admin-init.ts:27` — Auth da service account
- **Padrão:** Nenhum
- **Quando trocor:** Se recriar service account

#### `FIREBASE_PRIVATE_KEY`
- **O quê:** Private key da service account (multiline)
- **Tipo:** String com newlines (`\n` ou quebras reais)
- **Obrigatório:** ✅ SIM
- **Tamanho:** ~1700 caracteres
- **Onde é usado:**
  - `server/firebase-admin-init.ts:28` — Autenticar Admin SDK
- **⚠️ CRÍTICO:** Não commitar no Git! Usar secrets manager
- **Padrão:** Nenhum (erro se não setado)
- **Como obter:**
  ```
  1. Console Firebase: https://console.firebase.google.com
  2. Projeto: revenda-smart
  3. Engrenagem (Settings) → Service Accounts
  4. "Generate new private key"
  5. Download JSON
  6. Copiar conteúdo da chave "private_key"
  7. Guardar como env var
  ```

---

### 1.3 URLs de Produção

#### `APP_BASE_URL`
- **O quê:** URL base do backend (API)
- **Tipo:** URL (HTTPS obrigatório em prod)
- **Obrigatório:** ⚠️ RECOMENDADO (fallback: `https://reseller-catalog-hub.replit.app`)
- **Onde é usado:**
  - `server/subscriptions.ts:29` — Construir URLs internas (logs, relatórios)
  - `server/payments.ts:53` — Mesmo
- **Em Replit:** `https://reseller-catalog-hub.replit.app` (ou `http://localhost:5000`)
- **Em Cloud Run:** `https://<PROJECT_ID>.run.app`
- **Quando trocor:**
  - [ ] Migrar Replit → Cloud Run (URL muda)

#### `FRONTEND_URL`
- **O quê:** URL base do frontend (React app)
- **Tipo:** URL (HTTPS obrigatório em prod)
- **Obrigatório:** ⚠️ RECOMENDADO (fallback: `https://revendasmart.vercel.app`)
- **Onde é usado:**
  - `server/subscriptions.ts:30` — Back URL para checkout (MP redireciona aqui após pagamento)
    - `/subscribe?status=success`
    - `/subscribe?status=error`
- **Em Replit:** `https://revendasmart.vercel.app` (ou `http://localhost:3000`)
- **Em Cloud Run:** Continua `https://revendasmart.vercel.app` (frontend em Vercel, não muda)
- **Quando trocor:**
  - [ ] Se frontend mudar de host (raramente)

---

### 1.4 Premium — Customizável

#### `PREMIUM_PRICE_BRL`
- **O quê:** Preço mensal da assinatura em BRL
- **Tipo:** Float
- **Obrigatório:** ❌ NÃO (padrão: 19.90)
- **Onde é usado:**
  - `server/subscriptions.ts:33` — Valor cobrado na assinatura
  - `server/subscriptions.ts:67` — Salvo em Firestore
  - `client/src/pages/subscribe.tsx` — Exibido no botão CTA
- **Padrão:** `19.90`
- **Quando mudar:** Se quiser ajustar preço (raramente)
- **⚠️ NOTA:** Não afeta assinaturas já ativas (MP usa valor original)

---

## 2. WEBHOOK DO MERCADO PAGO

### 2.1 O que é?
Um webhook é uma requisição HTTP que o Mercado Pago envia para o backend quando um evento ocorre (pagamento aprovado, assinatura renovada, etc).

### 2.2 Tipos de Eventos

Para Assinatura Premium (PreApproval):
- **`subscription_preapproval`** — Evento principal
  - Pagamento aprovado
  - Assinatura renovada
  - Assinatura cancelada
  - Status mudou

### 2.3 Registrar Webhook em Produção

**Step 1:** Acessar MP Dashboard (conta CENTRAL)
```
https://www.mercadopago.com.br/account/settings/webhooks
```

**Step 2:** Clicar "Add Webhook" ou "Adicionar Webhook"

**Step 3:** Preencher Formulário
```
Webhook URL:
https://reseller-catalog-hub.replit.app/api/app-subscription/webhook

Events (selecionar):
☑ subscription_preapproval
  (ou apenas "preapproval" se disponível)

Test the webhook:
[Test connection] ← MP vai fazer um POST de teste
```

**Step 4:** Salvar e Guardar IDs
```
Webhook ID: <GUID gerado por MP>
Signing Key/Secret: <Gerado por MP para HMAC>
```

**Step 5:** Guardar `MERCADOPAGO_WEBHOOK_SECRET` com segurança
```bash
export MERCADOPAGO_WEBHOOK_SECRET="<SIGNING_KEY>"
```

### 2.4 Validação Local (Replit)

Após registrar, testar localmente:
```bash
# Terminal (enquanto servidor roda):
tail -f /tmp/logs/Start_application*.log | grep "subscriptions/webhook"

# Fazer um pagamento de teste (cartão sandbox)
# Aguardar 2-5 segundos
# Esperado no log:
# [subscriptions/webhook] Received type=subscription_preapproval id=...
# [subscriptions/webhook] Processing uid=... subscriptionId=... status=authorized
# [subscriptions/webhook] Done uid=... status=authorized
```

### 2.5 Payload Esperado do Webhook
```json
POST /api/app-subscription/webhook
{
  "type": "subscription_preapproval",
  "data": {
    "id": "12345678901234567890"  // PreApproval ID
  }
}
```

### 2.6 Resposta do Backend
```json
{
  "received": true
}
```
**Importante:** Backend responde 200 IMEDIATAMENTE, depois processa async. Isso evita retry do MP.

### 2.7 O que o Webhook Faz

```javascript
1. Recebe evento de MP
2. Valida ID da subscription
3. Busca dados frescos do MP (status, nextPaymentDate, etc)
4. Atualiza Firestore: users/{uid}/planData/main
   - subscriptionStatus: "authorized" | "cancelled" | etc
   - currentPlan: "premium" | "free"
   - premiumActive: true | false
   - lastPaymentAt: timestamp
   - nextBillingAt: timestamp
5. Loga sucesso
```

---

## 3. ROTAS E ENDPOINTS

### 3.1 Rotas de Assinatura

#### `POST /api/app-subscription/create`
**Criar nova assinatura**
```
Auth: ✅ Obrigatório (Bearer token)
Body: {} (vazio)
Response: {
  "subscriptionId": "12345...",
  "initPoint": "https://www.mercadopago.com/checkout/...",
  "status": "pending"
}
```
**Ação:** Cria PreApproval no MP, retorna link checkout. Usuário clica → paga → volta para `/subscribe?status=success`

---

#### `POST /api/app-subscription/cancel`
**Cancelar assinatura ativa**
```
Auth: ✅ Obrigatório
Body: {} (vazio)
Response: {
  "success": true,
  "message": "Assinatura cancelada com sucesso. Você pode usar os recursos até o fim do período pago.",
  "subscriptionId": "12345..."
}
```
**Ação:** Revoga subscription no MP + atualiza Firestore. Usuário volta para FREE imediatamente.

---

#### `GET /api/app-subscription/status`
**Consultar status da assinatura**
```
Auth: ✅ Obrigatório
Response: {
  "subscriptionId": "12345..." | null,
  "subscriptionStatus": "authorized" | "cancelled" | "pending" | null,
  "currentPlan": "premium" | "free",
  "premiumActive": true | false,
  "autoRenew": true | false,
  "nextBillingAt": "2026-05-01T...",
  "lastPaymentAt": "2026-04-01T...",
  "canceledAt": null,
  "premiumPrice": 19.90
}
```
**Ação:** Retorna status FRESCO (sincroniza com MP se necessário)

---

#### `POST /api/app-subscription/webhook`
**Receber eventos do Mercado Pago**
```
Auth: ❌ Não obrigatório (MP não tem token)
Body: { "type": "subscription_preapproval", "data": { "id": "..." } }
Response: { "received": true }
```
**Ação:** Processa pagamento, atualiza Firestore

---

### 3.2 Outras Rotas (para contexto)

#### Assinaturas Revendedor (Diferente!)
```
POST /api/payments/create-link   ← Para pagamentos CLIENTES
POST /api/payments/webhook       ← Para webhooks PAGAMENTOS
  ⚠️ NÃO toca em planData do app
  ⚠️ Usa OAuth, não token central
```

---

## 4. FIRESTORE — ESTRUTURA DE DADOS

### 4.1 Collection Path
```
users/{uid}/planData/main
```

### 4.2 Documento Após Subscription Ativa
```json
{
  "currentPlan": "premium",
  "premiumActive": true,
  "premiumExpiresAt": null,
  "premiumStartedAt": Timestamp(2026-04-01),
  "premiumSource": "subscription",
  "referralCode": "USER-ABC123DEF",
  "referralCount": 0,
  "updatedAt": Timestamp(2026-04-01T12:34:56Z),
  
  // Subscription fields
  "subscriptionId": "12345678901234567890",
  "subscriptionStatus": "authorized",
  "subscriptionPlanId": "987654321",
  "autoRenew": true,
  "lastPaymentAt": Timestamp(2026-04-01T12:30:00Z),
  "nextBillingAt": Timestamp(2026-05-01T12:30:00Z),
  "canceledAt": null,
  "paymentStatus": "approved"
}
```

### 4.3 Documento Após Cancelamento
```json
{
  "currentPlan": "free",
  "premiumActive": false,
  "premiumExpiresAt": null,
  "premiumSource": null,
  
  // Subscription fields
  "subscriptionId": "12345678901234567890",
  "subscriptionStatus": "cancelled",
  "subscriptionPlanId": "987654321",
  "autoRenew": false,
  "lastPaymentAt": Timestamp(2026-04-01T12:30:00Z),
  "nextBillingAt": null,
  "canceledAt": Timestamp(2026-04-02T08:45:00Z),
  "paymentStatus": "cancelled"
}
```

### 4.4 Firestore Security Rules

Para webhook atualizar planData:
```javascript
match /users/{uid}/planData/{document=**} {
  // Webhook precisa de permissão write
  // Opção 1: Permitir requisições autenticadas
  allow write: if request.auth != null;
  
  // Opção 2: (Mais seguro) Validar com webhook secret
  allow write: if request.headers['X-Webhook-Secret'] == resource.data.webhookSecret;
  
  // Read: sempre do usuario
  allow read: if request.auth.uid == uid;
}
```

**Verificar em Produção:**
```bash
# Firebase Console:
# Firestore → Rules
# Validar que escrita está permitida para webhook (ou autenticação)
```

---

## 5. MIGRAÇÃO REPLIT → CLOUD RUN

### 5.1 O que Muda

| Componente | Replit | Cloud Run | Ação |
|-----------|--------|-----------|------|
| **Backend URL** | `https://reseller-catalog-hub.replit.app` | `https://<PROJECT>.run.app` | Atualizar `APP_BASE_URL` |
| **Webhook URL (MP)** | `.../api/app-subscription/webhook` | `.../api/app-subscription/webhook` | Registrar nova URL em MP |
| **Firebase Creds** | Mesmo arquivo | Mesmo arquivo (via Secret Manager) | Usar Secrets Manager do GCP |
| **Env Vars** | `.env` file | Cloud Run Environment Vars | Configurar no Cloud Run |
| **Token MERCADOPAGO_** | Em `.env` | Cloud Run Secrets | Usar Secret Manager |
| **Frontend URL** | Continua Vercel | Continua Vercel | Sem mudança |

### 5.2 Env Vars no Cloud Run

```bash
gcloud run deploy revendasmart-api \
  --region us-central1 \
  --set-env-vars \
    FIREBASE_PROJECT_ID=revenda-smart,\
    FIREBASE_CLIENT_EMAIL=firebase-adminsdk-fbsvc@revenda-smart.iam.gserviceaccount.com,\
    APP_BASE_URL=https://revendasmart-api.run.app,\
    FRONTEND_URL=https://revendasmart.vercel.app,\
    PREMIUM_PRICE_BRL=19.90 \
  --set-secrets \
    FIREBASE_PRIVATE_KEY=firebase-private-key:latest,\
    MERCADOPAGO_ACCESS_TOKEN=mercadopago-access-token:latest,\
    MERCADOPAGO_WEBHOOK_SECRET=mercadopago-webhook-secret:latest,\
    MERCADOPAGO_CLIENT_ID=mercadopago-client-id:latest,\
    MERCADOPAGO_CLIENT_SECRET=mercadopago-client-secret:latest
```

### 5.3 Checklist Migração

- [ ] Criar Secret Manager keys no GCP
- [ ] Atualizar `APP_BASE_URL` em Cloud Run
- [ ] Atualizar Webhook URL em MP Dashboard
- [ ] Testar `/api/app-subscription/status` em Cloud Run
- [ ] Testar criar subscription completa
- [ ] Testar webhook é recebido (verificar Cloud Run logs)
- [ ] Testar cancelamento
- [ ] Monitor: nenhum erro nos primeiros 24h

---

## 6. MONITORAMENTO E LOGS

### 6.1 Logs do Servidor

**Para Assinatura:**
```bash
# Terminal Replit:
tail -f /tmp/logs/Start_application*.log | grep subscriptions

# Esperado:
[subscriptions] Routes registered: /api/app-subscription/{create,cancel,status,webhook}
[subscriptions] Created PreApprovalPlan: <PLAN_ID>
[subscriptions] Created subscription uid=<UID> subscriptionId=<SUB_ID>
[subscriptions] Cancelled subscription uid=<UID>
[subscriptions/webhook] Received type=subscription_preapproval
[subscriptions/webhook] Processing uid=... status=authorized
```

### 6.2 Cloud Run Logs
```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=revendasmart-api" \
  --limit 50 --format json | grep subscriptions
```

### 6.3 Metrics pra Monitorar

| Métrica | Alertar Se | Ação |
|---------|-----------|------|
| **Webhook latency** | > 10 segundos | Checar BD performance |
| **API 5xx errors** | > 0 em 1h | Checar logs, Firebase |
| **Subscription creates** | 0 em 24h | Usuários não estão tentando |
| **Webhook failures** | > 5% | Checar payload ou BD rules |
| **Firestore writes** | Muito acima do normal | Possível DDoS ou bug |

---

## 7. TROUBLESHOOTING

### 7.1 Webhook Não é Recebido

**Sintoma:** Usuário paga, mas `subscriptionStatus` fica `pending`

**Checklist:**
1. [ ] Webhook URL registrado em MP Dashboard?
   - Ir para: https://www.mercadopago.com.br/settings/account/webhooks
   - Procurar: `/api/app-subscription/webhook`
2. [ ] URL é HTTPS? (MP não envia para HTTP em produção)
3. [ ] Firewall permite requisições de MP?
   - IP ranges MP: https://www.mercadopago.com.br/developers
4. [ ] Backend está rodando? (check health: `/health`)
5. [ ] Logs mostram webhook recebido?

**Solução:**
```bash
# Teste manual (simular MP):
curl -X POST https://reseller-catalog-hub.replit.app/api/app-subscription/webhook \
  -H "Content-Type: application/json" \
  -d '{"type":"subscription_preapproval","data":{"id":"12345"}}'

# Se retornar 200 + { "received": true }, endpoint está OK
```

### 7.2 "MERCADOPAGO_ACCESS_TOKEN is not set"

**Sintoma:** Ao clicar "Assinar", erro "Erro ao criar assinatura"

**Checklist:**
1. [ ] Env var foi setado em Replit?
   - Replit → Secrets → `MERCADOPAGO_ACCESS_TOKEN`
2. [ ] Restart do servidor após setar?
3. [ ] Token é válido? (não expirou, não foi revogado)

**Solução:**
```bash
# Verificar env var:
env | grep MERCADOPAGO_ACCESS_TOKEN

# Se vazio, setar:
export MERCADOPAGO_ACCESS_TOKEN="<TOKEN>"

# Restart servidor
npm run dev
```

### 7.3 Firestore Atualizar Não Funciona

**Sintoma:** Webhook recebido no log, mas Firestore não muda

**Checklist:**
1. [ ] Firestore rules permitem webhook escrever?
   ```javascript
   allow write: if request.auth != null;
   ```
2. [ ] Path está correto? `users/{uid}/planData/main`
3. [ ] Firebase creds estão corretos?

**Solução:**
```bash
# Verificar manualmente em Firestore:
1. Ir para: https://console.firebase.google.com/firestore
2. Collection: users → [uid] → planData → main
3. Ver se documento existe
4. Clicar "Editar" → "Teste de Escrita"
5. Se falhar: ajustar Firestore Rules
```

### 7.4 Renovação Não Acontece

**Sintoma:** nextBillingAt passou, mas nenhuma nova cobrança

**Checklist:**
1. [ ] Assinatura foi aprovada primeiro? (status = "authorized")
2. [ ] nextBillingAt é data válida (não null, não no passado)?
3. [ ] Webhook de renovação foi recebido?

**Solução:**
```bash
# MP Dashboard:
1. Ir para: https://www.mercadopago.com.br/my-merchant-order
2. Procurar subscription ID
3. Ver "próximo pagamento agendado"
4. Se não mostrar, assinatura pode estar paused/cancelled
```

---

## 8. REFERÊNCIAS RÁPIDAS

### 8.1 Links Importantes
- **MP Dashboard:** https://www.mercadopago.com.br
- **MP Dev Docs:** https://www.mercadopago.com.br/developers
- **Firebase Console:** https://console.firebase.google.com
- **Cloud Run:** https://console.cloud.google.com/run
- **Replit Project:** https://replit.com/...

### 8.2 Endpoints Local (Replit)
```
POST   http://localhost:5000/api/app-subscription/create
POST   http://localhost:5000/api/app-subscription/cancel
GET    http://localhost:5000/api/app-subscription/status
POST   http://localhost:5000/api/app-subscription/webhook

Health: http://localhost:5000/health
```

### 8.3 SDK Versions
```
"mercadopago": "^2.4.0"
"firebase-admin": "^12.0.0"
"firebase": "^10.0.0"
```

---

## 9. RESUMO POR FASE

### Fase 1: Development (Replit)
```
✅ Código escrito
✅ Testes manuais
✅ Logs funcionando
⏳ Env vars ainda não setados
```

### Fase 2: Pre-Prod (Replit + Config)
```
⏳ MERCADOPAGO_ACCESS_TOKEN setado
⏳ Webhook URL registrada em MP
⏳ Teste completo (create → pay → webhook)
```

### Fase 3: Production (Cloud Run)
```
⏳ Migrar Replit → Cloud Run
⏳ Atualizar APP_BASE_URL
⏳ Re-registrar Webhook URL em MP
⏳ Monitor por 24h
```

---

**Última atualização:** Abril 2026  
**Próxima review:** Após primeira assinatura real
