# 🚀 Migração Backend → Google Cloud Run

**Data:** 2026-04-02  
**Estratégia:** Migração em paralelo (Replit permanece como fallback)  
**Objetivo:** Backend em Cloud Run sem interromper produção

---

## A. PRONTIDÃO ATUAL PARA MIGRAR

### Status do Backend

| Item | Status | Notas |
|------|--------|-------|
| **Express monolítico** | ✅ Pronto | Nenhuma refatoração necessária |
| **TypeScript compilado** | ✅ Pronto | `npm run build` gera `dist/index.cjs` |
| **PORT via env var** | ✅ Pronto | `process.env.PORT \|\| "5000"` — Cloud Run injeta 8080 |
| **Graceful shutdown (SIGTERM)** | ✅ Pronto | Handler já implementado no `server/index.ts` |
| **Health endpoint `/health`** | ✅ Pronto | Retorna JSON com uptime e memory |
| **CORS configurado** | ✅ Pronto | Aceita `https://revendasmart.vercel.app` |
| **Firebase Admin via env vars** | ✅ Pronto | Sem arquivo JSON local — usa FIREBASE_* |
| **Sem estado em memória** | ✅ Pronto | Tudo no Firestore — stateless |
| **Webhooks MP** | ✅ Pronto | `/api/payments/webhook` + `/api/app-subscription/webhook` |
| **Dockerfile criado** | ✅ Novo | Multi-stage build (builder + runner) |
| **cloudbuild.yaml criado** | ✅ Novo | CI/CD automático via Cloud Build |
| **Scripts de deploy** | ✅ Novo | `deploy-cloud-run.sh`, `setup-secrets-cloud-run.sh`, `validate-cloud-run.sh` |

### Arquitetura de Migração

```
                    FASE 1 (Paralelo)                FASE 2 (Cutover)
                    
Frontend            Frontend                          Frontend
(Vercel)            (Vercel)                          (Vercel)
    │                   │                                 │
    ▼                   ▼                                 ▼
Backend             Backend ──────────────────────► Cloud Run ✅
(Replit)  ◄──────   (Replit)  [testes paralelos]    (Production)
 ✅ ON               ✅ ON                             ✅ ON
                    
                    Replit = FALLBACK                Replit = DESLIGAR
```

---

## B. ENV VARS E SECRETS NECESSÁRIOS

### Secrets (via Cloud Secret Manager — dados sensíveis)

| Nome | Valor | Onde encontrar |
|------|-------|----------------|
| `MERCADOPAGO_ACCESS_TOKEN` | `APP-...` | MP Dashboard → Credenciais |
| `MERCADOPAGO_CLIENT_ID` | `12345...` | MP Dashboard → Aplicativos |
| `MERCADOPAGO_CLIENT_SECRET` | `abc123...` | MP Dashboard → Aplicativos |
| `MERCADOPAGO_TOKEN_ENCRYPTION_KEY` | string 32+ chars | Criar aleatório (ver abaixo) |
| `MERCADOPAGO_WEBHOOK_SECRET` | string | Criar no MP Dashboard |
| `FIREBASE_PROJECT_ID` | `revenda-smart` | Firebase Console |
| `FIREBASE_CLIENT_EMAIL` | `firebase-adminsdk-xxx@...` | Firebase → Service Accounts |
| `FIREBASE_PRIVATE_KEY` | `-----BEGIN PRIVATE KEY-----\n...` | Firebase → Service Accounts |

### Env Vars normais (não-sensíveis, configurados no deploy)

| Nome | Valor | Notas |
|------|-------|-------|
| `NODE_ENV` | `production` | Fixo |
| `PORT` | `8080` | Cloud Run injeta automaticamente |
| `FRONTEND_URL` | `https://revendasmart.vercel.app` | URL do frontend |
| `PREMIUM_PRICE_BRL` | `19.9` | Preço do premium |
| `APP_BASE_URL` | ⚠️ `https://SEU_SERVICE.a.run.app` | **Definir APÓS primeiro deploy** |
| `MERCADOPAGO_REDIRECT_URI` | ⚠️ `https://SEU_SERVICE.a.run.app/api/mercadopago/callback` | **Definir APÓS primeiro deploy + no MP Dashboard** |

> ⚠️ `APP_BASE_URL` e `MERCADOPAGO_REDIRECT_URI` dependem da URL do Cloud Run.  
> São configurados APÓS o primeiro deploy (segundo deploy ou via console).

---

## C. ARQUIVOS CRIADOS/ALTERADOS

| Arquivo | Tipo | Função |
|---------|------|--------|
| `Dockerfile` | **NOVO** | Build multi-stage para Cloud Run |
| `.dockerignore` | **NOVO** | Exclui arquivos desnecessários da imagem |
| `cloudbuild.yaml` | **NOVO** | Pipeline CI/CD via Cloud Build |
| `deploy-cloud-run.sh` | **NOVO** | Deploy manual (sem CI/CD) |
| `setup-secrets-cloud-run.sh` | **NOVO** | Cria secrets no Secret Manager |
| `validate-cloud-run.sh` | **NOVO** | Valida rotas críticas após deploy |
| `CLOUD_RUN_MIGRATION.md` | **NOVO** | Este guia |

**Nenhum arquivo existente foi alterado.** O Replit continua funcionando.

---

## D. COMANDOS DE DEPLOY

### Pré-requisitos (executar uma vez)

```bash
# 1. Instalar gcloud CLI
# https://cloud.google.com/sdk/docs/install

# 2. Autenticar
gcloud auth login
gcloud auth configure-docker

# 3. Criar projeto GCP (ou usar existente)
# No console: https://console.cloud.google.com

# 4. Configurar projeto
export GCLOUD_PROJECT_ID="seu-projeto-gcp"
gcloud config set project $GCLOUD_PROJECT_ID

# 5. Habilitar APIs necessárias
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  containerregistry.googleapis.com \
  secretmanager.googleapis.com

# 6. Criar secrets (executa uma vez, interativo)
./setup-secrets-cloud-run.sh

# 7. Conceder acesso aos secrets para o service account do Cloud Run
PROJECT_NUMBER=$(gcloud projects describe $GCLOUD_PROJECT_ID --format='value(projectNumber)')
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

for SECRET in MERCADOPAGO_ACCESS_TOKEN MERCADOPAGO_CLIENT_ID \
    MERCADOPAGO_CLIENT_SECRET MERCADOPAGO_TOKEN_ENCRYPTION_KEY \
    MERCADOPAGO_WEBHOOK_SECRET FIREBASE_PROJECT_ID \
    FIREBASE_CLIENT_EMAIL FIREBASE_PRIVATE_KEY; do
  gcloud secrets add-iam-policy-binding $SECRET \
    --project=$GCLOUD_PROJECT_ID \
    --member="serviceAccount:$SA" \
    --role="roles/secretmanager.secretAccessor"
done
echo "✅ IAM permissions granted"
```

### Deploy Manual (recomendado para primeiro deploy)

```bash
# No Replit ou qualquer máquina com Docker + gcloud
export GCLOUD_PROJECT_ID="seu-projeto-gcp"
export GCLOUD_REGION="us-central1"

./deploy-cloud-run.sh
```

**O script faz:**
1. `docker build` da imagem
2. `docker push` para Google Container Registry
3. `gcloud run deploy` com todos os secrets e env vars
4. Testa `/health` automaticamente
5. Mostra a URL do serviço

### Deploy via CI/CD (depois do primeiro deploy)

Configure um trigger no Cloud Build:
1. Vá para [Cloud Build](https://console.cloud.google.com/cloud-build/triggers)
2. Conecte seu repositório GitHub
3. Crie trigger: branch `main` → `cloudbuild.yaml`
4. Defina as substituições:
   - `_REGION` = `us-central1`
   - `_SERVICE_NAME` = `revendasmart-backend`
   - `_PROJECT_ID` = seu projeto

---

## E. CHECKLIST DE TESTES APÓS SUBIR

### Validação Automatizada

```bash
# Defina a URL do Cloud Run
export CLOUD_RUN_URL="https://revendasmart-backend-xxxx-uc.a.run.app"

# Para testes autenticados, pegue um token Firebase:
# No browser: firebase.auth().currentUser.getIdToken(true).then(t => console.log(t))
export FIREBASE_ID_TOKEN="eyJhbGciOiJSUzI1NiIs..."

# Roda todos os testes
./validate-cloud-run.sh
```

### Checklist Manual

#### ✅ Infraestrutura
- [ ] `GET /health` → `200 {"status":"ok"}`
- [ ] Logs no Cloud Logging sem erros críticos
- [ ] Memory: < 400Mi (de 512Mi alocados)
- [ ] Cold start: < 5 segundos

#### ✅ CORS
- [ ] Preflight `OPTIONS` com `Origin: https://revendasmart.vercel.app` → 200
- [ ] `Access-Control-Allow-Origin` presente no response

#### ✅ Firebase Admin (testar via rota que usa Firestore)
- [ ] `GET /api/app-subscription/status` com token → 200 (não 500)
- [ ] `GET /api/admin/global-config` com token → 200

#### ✅ Rotas de Assinatura Premium
- [ ] `POST /api/app-subscription/create` → checkout URL ou ALREADY_SUBSCRIBED
- [ ] `GET /api/app-subscription/status` → plano do usuário
- [ ] `POST /api/app-subscription/sync-now` → sincroniza do MP
- [ ] `GET /api/app-subscription/diagnose` → diagnóstico

#### ✅ Rotas de Pagamentos (Revendedoras)
- [ ] `GET /api/mercadopago/connections` com token → 200
- [ ] `POST /api/payments/create-link` com body válido → payment link
- [ ] `GET /api/payments/status?paymentId=xxx` → status do pagamento

#### ✅ Webhooks (críticos)
- [ ] `POST /api/payments/webhook` → 200/400/403 (não 404/502)
- [ ] `POST /api/app-subscription/webhook` → 200/400/403 (não 404/502)
- [ ] Signature verification funciona (teste com payload real do MP)

#### ✅ Configurações de Usuário
- [ ] `GET /api/user/settings/:userId` com token e mesmo userId → 200
- [ ] `POST /api/user/settings/:userId` com update → 200

#### ✅ URLs de Self-Reference
- [ ] Testar `POST /api/app-subscription/create`: `back_url` deve apontar para Vercel (não Replit)
- [ ] Testar OAuth MP: `MERCADOPAGO_REDIRECT_URI` deve apontar para Cloud Run

---

## F. MOMENTO SEGURO PARA DESLIGAR O REPLIT

Desligar o Replit SOMENTE após:

```
[ ] 1. Cloud Run funcionando há 24+ horas sem erros críticos
[ ] 2. Todos os checks do validate-cloud-run.sh passando
[ ] 3. FRONTEND_URL no frontend apontando para Cloud Run URL
[ ] 4. APP_BASE_URL atualizado para Cloud Run URL
[ ] 5. MERCADOPAGO_REDIRECT_URI atualizado em:
        - Secret Manager (Cloud Run)
        - Dashboard do Mercado Pago (OAuth App Settings)
[ ] 6. Webhook do MP atualizado:
        - /api/payments/webhook → https://CLOUD_RUN_URL/api/payments/webhook
        - /api/app-subscription/webhook → https://CLOUD_RUN_URL/api/app-subscription/webhook
[ ] 7. Um pagamento real de teste processado com sucesso via Cloud Run
[ ] 8. Webhook recebido e processado com sucesso pelo Cloud Run
[ ] 9. Tela /subscribe funcionando com Cloud Run como backend
[ ] 10. Monitoramento/alertas configurados no Cloud Logging
```

**Sequência de cutover:**

```bash
# Passo 1: Atualizar APP_BASE_URL no Cloud Run
gcloud run services update revendasmart-backend \
  --region=us-central1 \
  --update-env-vars=APP_BASE_URL=https://SEU_SERVICE.a.run.app

# Passo 2: Atualizar MERCADOPAGO_REDIRECT_URI no Secret Manager
echo -n "https://SEU_SERVICE.a.run.app/api/mercadopago/callback" | \
  gcloud secrets versions add MERCADOPAGO_REDIRECT_URI \
  --data-file=-

# Passo 3: Atualizar frontend para apontar para Cloud Run
# Em client/src/lib/api-config.ts: trocar URL do Replit → Cloud Run

# Passo 4: Atualizar webhook no Dashboard do Mercado Pago
# MP Dashboard → Webhooks → editar URL

# Passo 5: Só então desligar o Replit
```

---

## G. ROTAS CRÍTICAS MAPEADAS

### `/api/app-subscription/*` — Premium RevendaSmart

| Rota | Método | Auth | Função |
|------|--------|------|--------|
| `/create` | POST | ✅ | Cria checkout no MP |
| `/cancel` | POST | ✅ | Cancela assinatura |
| `/status` | GET | ✅ | Status do plano |
| `/webhook` | POST | ❌ (MP sign) | Recebe eventos MP |
| `/sync-now` | POST | ✅ | Sincroniza do MP |
| `/diagnose` | GET | ✅ | Diagnóstico |
| `/recover` | POST | ✅ | Recupera subscriptionId |

### `/api/payments/*` — Pagamentos de Clientes

| Rota | Método | Auth | Função |
|------|--------|------|--------|
| `/create-link` | POST | ✅ | Gera link de pagamento |
| `/webhook` | POST | ❌ (MP sign) | Recebe pagamentos |
| `/status` | POST | ✅ | Consulta status |
| `/resync` | POST | ✅ | Re-sincroniza |
| `/delete` | POST | ✅ | Remove link |

### `/api/mercadopago/*` — OAuth das Revendedoras

| Rota | Método | Auth | Função |
|------|--------|------|--------|
| `/start-auth` | POST | ✅ | Inicia OAuth |
| `/callback` | GET | ❌ (redirect) | Callback OAuth — `MERCADOPAGO_REDIRECT_URI` aponta aqui |
| `/revoke/:id` | POST | ✅ | Revoga conexão |
| `/connections` | GET | ✅ | Lista conexões |
| `/set-default/:id` | POST | ✅ | Define conexão padrão |

### `/api/user/*` — Dados do Usuário

| Rota | Método | Auth | Função |
|------|--------|------|--------|
| `/settings/:userId` | GET/POST | ✅ (owner) | Config do usuário |
| `/migration-status/:userId` | GET | ✅ (owner) | Status de migração |
| `/data/validate/:userId` | POST | ✅ (owner) | Valida dados |

### `/api/admin/*` — Admin

| Rota | Método | Auth | Função |
|------|--------|------|--------|
| `/global-config` | GET/POST | ✅ | Flag de premium global |

### `/api/plan/*` e `/api/referral/*`

| Rota | Método | Auth | Função |
|------|--------|------|--------|
| `/plan/data/:userId` | GET | ✅ (owner) | Dados do plano |
| `/plan/initialize/:userId` | POST | ✅ (owner) | Inicializa plano |
| `/referral/track-event` | POST | ❌ | Rastreia evento |
| `/referral/validate-referral` | POST | ❌ | Valida referral |

---

## H. DECISÕES DE CONFIGURAÇÃO DO CLOUD RUN

### Por que estas configs?

| Config | Valor | Razão |
|--------|-------|-------|
| `--memory=512Mi` | 512MB | Firebase Admin + MP SDK requerem ~200MB; 512 dá folga |
| `--cpu=1` | 1 vCPU | Suficiente para API backend; escala horizontalmente |
| `--concurrency=80` | 80 req/instância | Node.js é async; 80 concurrent requests é seguro |
| `--min-instances=0` | 0 | Custo zero quando sem tráfego (cold start ~2-3s) |
| `--max-instances=10` | 10 | Proteção contra burst inesperado |
| `--timeout=300s` | 5 minutos | Suficiente para operações de webhook e MP |
| `--allow-unauthenticated` | sim | Necessário para webhooks (MP não manda token GCP) |

### Custo Estimado

| Cenário | Custo Mensal |
|---------|--------------|
| App nova (baixo tráfego) | $0-5 (free tier generoso) |
| 100k req/mês | ~$1-3 |
| 1M req/mês | ~$10-20 |
| Compare: Replit | ~$50/mês |

---

## I. MONITORAMENTO PÓS-DEPLOY

### Ver logs em tempo real

```bash
gcloud logs tail \
  --service=revendasmart-backend \
  --region=us-central1 \
  --format="value(timestamp,textPayload)"
```

### Filtrar por erros

```bash
gcloud logs read \
  --service=revendasmart-backend \
  --region=us-central1 \
  --filter='severity>=ERROR' \
  --limit=50
```

### Alertas recomendados (Cloud Monitoring)

1. **Error rate > 5%** → Notificação
2. **Latência P95 > 10s** → Notificação
3. **Instance count = max (10)** → Atenção
4. **Memory > 80% (410Mi)** → Atenção

---

## J. TROUBLESHOOTING

### Problema: `firebase-admin: Firebase Admin is not initialized`

**Causa:** Secrets não configurados corretamente.

**Fix:**
```bash
# Verificar se secrets existem
gcloud secrets list --project=$PROJECT_ID

# Verificar se Cloud Run tem acesso
gcloud secrets get-iam-policy FIREBASE_PRIVATE_KEY --project=$PROJECT_ID
```

---

### Problema: CORS bloqueando frontend

**Causa:** `APP_BASE_URL` ainda aponta para Replit após cutover.

**Fix:** Ver `server/index.ts` linha 46-52. CORS já aceita `revendasmart.vercel.app`. Se usar domínio customizado, adicionar lá.

---

### Problema: Webhook MP retorna 403

**Causa:** `MERCADOPAGO_WEBHOOK_SECRET` diverge entre MP Dashboard e Cloud Run.

**Fix:**
```bash
# Verificar valor atual no Secret Manager
gcloud secrets versions access latest \
  --secret=MERCADOPAGO_WEBHOOK_SECRET \
  --project=$PROJECT_ID
```

---

### Problema: OAuth Redirect falha após cutover

**Causa:** `MERCADOPAGO_REDIRECT_URI` ainda aponta para Replit.

**Fix:**
1. Atualizar Secret Manager com nova URL do Cloud Run
2. Atualizar no Dashboard do Mercado Pago → Aplicativos → OAuth → Redirect URI

---

## K. RESUMO EXECUTIVO

### O que fizemos

1. ✅ Mapeamos todas as 25+ rotas do backend
2. ✅ Identificamos os 8 secrets e 6 env vars necessários
3. ✅ Criamos `Dockerfile` multi-stage otimizado
4. ✅ Criamos `cloudbuild.yaml` para CI/CD
5. ✅ Criamos script de deploy manual (`deploy-cloud-run.sh`)
6. ✅ Criamos script de setup de secrets (`setup-secrets-cloud-run.sh`)
7. ✅ Criamos script de validação (`validate-cloud-run.sh`)
8. ✅ Nenhum arquivo do Replit foi alterado (Replit continua como fallback)

### O que você precisa fazer

1. **Criar conta/projeto no GCP** (se não tiver)
2. **Instalar gcloud CLI** (se não tiver)
3. **Executar `./setup-secrets-cloud-run.sh`** (interativo, pede os valores)
4. **Executar `./deploy-cloud-run.sh`** (30-90 segundos)
5. **Executar `./validate-cloud-run.sh`** com a URL recebida
6. **Atualizar APP_BASE_URL** com a URL do Cloud Run
7. **Atualizar MERCADOPAGO_REDIRECT_URI** no Secret Manager + MP Dashboard
8. **Testar cutover** trocando URL no frontend
9. **Manter Replit ON** por 24-48h como fallback
10. **Desligar Replit** após validação completa

### Timeline Estimada

| Passo | Tempo |
|-------|-------|
| Criar conta GCP + projeto | 15 min |
| Instalar gcloud + auth | 10 min |
| Configurar secrets | 20 min |
| Primeiro deploy | 5-10 min |
| Validação de rotas | 15 min |
| Cutover de URLs | 10 min |
| Período de fallback | 24-48h |
| **Total até desligar Replit** | **~2-3 dias** |

---

**Arquivos criados:** `Dockerfile`, `.dockerignore`, `cloudbuild.yaml`, `deploy-cloud-run.sh`, `setup-secrets-cloud-run.sh`, `validate-cloud-run.sh`, `CLOUD_RUN_MIGRATION.md`
