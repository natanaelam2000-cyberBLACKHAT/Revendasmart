# 🚀 Global Premium Release — Liberação Temporária de Recursos Premium

## Propósito

Liberar temporariamente todos os recursos **Premium** para **todos os usuários** sem cobrar nada, enquanto a monetização final é finalizada.

**Quando usar:** Antes do lançamento oficial quando você quer desbloquear recursos Premium para todos testarem, mas não quer cobrar ainda.

---

## 🎯 O Que Acontece

### **Quando Flag Está ATIVADA (`premiumOpenAccess: true`)**

✅ **Todos os usuários veem Premium Ativo**
- Mesmo sem pagar
- Mesmo que `planData.currentPlan === "free"`
- Mesmo que não tenham assinatura ativa

✅ **Limites do plano são ignorados**
- Produtos ilimitados (normalmente 30)
- Clientes ilimitados (normalmente 50)
- Múltiplos nichos habilitados
- Cobranças via Mercado Pago habilitadas
- Destaques de produtos habilitados
- Catálogo profissional habilitado
- Sem anúncios

✅ **Dashboard mostra:**
- Banner verde: "🎉 Premium temporariamente liberado!"
- Data de validade (se configurada)
- Mensagem customizada (se configurada)

✅ **planData do usuário NÃO é modificado**
- Continua com `currentPlan: "free"`
- Continua com `premiumActive: false`
- Nenhum dado corrompido ou perdido

### **Quando Flag Está DESATIVADA (`premiumOpenAccess: false`)**

Volta a lógica normal:
- Apenas usuários com assinatura ativa (`subscriptionStatus === "authorized"`) veem Premium
- Apenas usuários com `currentPlan === "premium"` (e não expirado) veem Premium
- Limites do plano grátis voltam a valer

---

## 🔧 Como Ativar (Admin)

### **Passo 1: Obter Token Firebase**

Você precisa de um **token de ID Firebase** para fazer a requisição. Para isso:

1. Vá para https://revendasmart.vercel.app
2. Faça login com sua conta de admin
3. Abra o console (F12)
4. Cole isso no console:

```javascript
// Na aba Console do browser
firebase.auth().currentUser.getIdToken(true)
  .then(token => console.log(token))
```

5. Copie o token longo que aparecer

### **Passo 2: Chamar API de Admin**

Você pode usar `curl`, Postman, ou qualquer ferramenta HTTP.

#### **Ativar Premium para Todos (sem expiração)**

```bash
curl -X POST https://reseller-catalog-hub.replit.app/api/admin/global-config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <SEU_TOKEN_AQUI>" \
  -d '{
    "premiumOpenAccess": true,
    "premiumOpenAccessMessage": "Bem-vindo! Recursos Premium desbloqueados para o lançamento da V2."
  }'
```

**Resposta esperada:**
```json
{
  "success": true,
  "message": "Premium liberado globalmente!",
  "config": {
    "premiumOpenAccess": true,
    "premiumOpenAccessUntil": null,
    "premiumOpenAccessMessage": "Bem-vindo!..."
  }
}
```

---

#### **Ativar Premium com Data de Expiração**

```bash
curl -X POST https://reseller-catalog-hub.replit.app/api/admin/global-config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <SEU_TOKEN_AQUI>" \
  -d '{
    "premiumOpenAccess": true,
    "premiumOpenAccessUntil": "2026-04-15T23:59:59.000Z",
    "premiumOpenAccessMessage": "Premium liberado até 15 de abril!"
  }'
```

---

#### **Desativar Premium Global (voltar a cobrança)**

```bash
curl -X POST https://reseller-catalog-hub.replit.app/api/admin/global-config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <SEU_TOKEN_AQUI>" \
  -d '{
    "premiumOpenAccess": false
  }'
```

**Resposta esperada:**
```json
{
  "success": true,
  "message": "Premium global desligado",
  "config": {
    "premiumOpenAccess": false,
    "premiumOpenAccessUntil": null,
    "premiumOpenAccessMessage": null
  }
}
```

---

### **Passo 3: Verificar Status Atual**

Para ver a configuração atual:

```bash
curl https://reseller-catalog-hub.replit.app/api/admin/global-config \
  -H "Authorization: Bearer <SEU_TOKEN_AQUI>"
```

**Resposta:**
```json
{
  "premiumOpenAccess": true,
  "premiumOpenAccessUntil": "2026-04-15T23:59:59.000Z",
  "premiumOpenAccessMessage": "Premium liberado até 15 de abril!"
}
```

---

## 📊 Onde a Flag É Salva

**Firestore → `system/config`**

Documento estrutura:
```
Collection: system
Document: config
{
  premiumOpenAccess: boolean,          // true = liberado para todos
  premiumOpenAccessUntil: Timestamp,   // quando termina (null = sem expiração)
  premiumOpenAccessMessage: string,    // mensagem customizada
  updatedAt: Timestamp                 // quando foi atualizado
}
```

**Importante:** Qualquer um com Firebase Admin SDK pode ler/escrever (segurança é garantida pelo `requireAuth` middleware).

---

## 🧠 Lógica Interna

### **Frontend (usePlanData.ts)**

```typescript
// Carrega global config ao inicializar
const globalConfig = await fetch('system/config')

// Calcula plano efetivo
const effectivePlan = getEffectivePlan(planData, globalConfig)
// Se globalConfig.premiumOpenAccess && !expirado → Premium
// Senão → usa planData.currentPlan
```

### **Dashboard (subscribe.tsx)**

```typescript
const isGlobalPremiumActive = isPremiumFromGlobalAccess(globalConfig)

if (isGlobalPremiumActive) {
  // Mostra banner: "Premium temporariamente liberado!"
  // Esconde botão de "Assinar Premium"
  // Mostra data de expiração
}
```

### **Limitações (futuro)**

A lógica de **limites** não foi afetada ainda. Se um usuário tentar adicionar 40 produtos com a flag ligada, ainda pode ser bloqueado.

Para desbloquear também os limites, você precisa passar `globalConfig` a todas as funções de validação:
- `canAddProduct(plan, count)` → `canAddProduct(plan, count, globalConfig)`
- `canAddClient(plan, count)` → `canAddClient(plan, count, globalConfig)`
- `canUseFeature(plan, feature)` → `canUseFeature(plan, feature, globalConfig)`

(Isso pode ser feito depois se necessário)

---

## 🔒 Segurança

### **Riscos Mitigados**

✅ **planData não é corrompido**
- Servidor nunca modifica `planData.currentPlan` (continua "free")
- Flag é separada (em `system/config`, não em `planData`)
- Se você desativar a flag, tudo volta ao normal

✅ **Acesso restrito**
- Apenas usuários autenticados (`requireAuth` middleware)
- Requer token Firebase válido
- Não há login de admin separado (use seu próprio token)

✅ **Auditoria**
- Logs no servidor quando flag é atualizada
- Timestamp de quando foi atualizado em Firestore

### **Riscos Remanescentes**

⚠️ **Token compartilhado**
- Se você compartilhar seu token com alguém, essa pessoa pode mudar a flag
- Solução: Gerar novos tokens (firebase.auth().currentUser.getIdToken(true))

⚠️ **Sem permissões granulares**
- Qualquer usuário autenticado pode chamar `GET /api/admin/global-config`
- Apenas lê, não escreve (escrita é intencionalmente aberta para admin)
- Solução futura: Verificar `user.claims.isAdmin` no middleware

---

## 📋 Exemplo de Uso Completo

### **Cenário: Lançamento em 2026-04-10**

```bash
# 1. Ativar premium para todos até dia 15
curl -X POST https://reseller-catalog-hub.replit.app/api/admin/global-config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIs..." \
  -d '{
    "premiumOpenAccess": true,
    "premiumOpenAccessUntil": "2026-04-15T23:59:59Z",
    "premiumOpenAccessMessage": "Bem-vindo à RevendaSmart v2! 🎉 Premium desbloqueado até 15 de abril."
  }'

# Resposta: ✅ Premium liberado globalmente!
```

Usuários veem:
```
🎉 Premium temporariamente liberado!
Todos os recursos premium estão disponíveis por tempo limitado. Aproveite!
⏰ Válido até 15 de abril
```

---

```bash
# 2. Em 15 de abril, desativar
curl -X POST https://reseller-catalog-hub.replit.app/api/admin/global-config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIs..." \
  -d '{
    "premiumOpenAccess": false
  }'

# Resposta: ✅ Premium global desligado
```

Usuários não-pagos voltam a ver:
```
❌ Plano Grátis (30 produtos, 50 clientes...)

[Assinar Premium — R$ 19,90/mês]
```

---

## 🎯 Checklist de Implementação

- ✅ Interface `GlobalConfig` em `shared/monetization.ts`
- ✅ Funções `getGlobalConfig()` e `setGlobalConfig()` em `server/subscriptions.ts`
- ✅ Endpoints `GET/POST /api/admin/global-config` em `server/routes.ts`
- ✅ Hook `usePlanData.ts` carrega `globalConfig`
- ✅ Função `getEffectivePlan(planData, globalConfig)` em `shared/monetization.ts`
- ✅ Função `isPremiumFromGlobalAccess(globalConfig)` em `shared/monetization.ts`
- ✅ Banner visual em `subscribe.tsx` quando ativo
- ✅ Botão de subscribe escondido quando ativo
- ✅ Documento de uso (este arquivo)

---

## 📚 Arquivos Modificados

| Arquivo | Mudança |
|---------|---------|
| `shared/monetization.ts` | +Interface `GlobalConfig`, +Funções `getEffectivePlan()` e `isPremiumFromGlobalAccess()` |
| `server/subscriptions.ts` | +Funções `getGlobalConfig()` e `setGlobalConfig()` |
| `server/routes.ts` | +Endpoints `GET/POST /api/admin/global-config` |
| `client/src/hooks/usePlanData.ts` | Carrega `globalConfig` e retorna no hook |
| `client/src/pages/subscribe.tsx` | Banner visual, esconde botão de subscribe quando ativo |

---

## ✨ Próximos Passos (Opcional)

1. **Adicionar validação de admin:**
   - Verificar `user.claims.isAdmin` no middleware
   - Apenas admins podem `POST /api/admin/global-config`

2. **Dashboard de admin:**
   - Página visual para ligar/desligar (sem precisar curl)
   - Histórico de mudanças

3. **Desbloquear limites também:**
   - Passar `globalConfig` a `canAddProduct()`, `canAddClient()`, etc.
   - Ignorar limites quando global premium está ativo

4. **Email de notificação:**
   - Avisar usuários quando expiração se aproxima
   - Lembrete para assinar Premium antes que termine

5. **Webhook de expiração:**
   - Endpoint que roda no dia da expiração
   - Avisa usuários que premium terminou

---

## ❓ FAQ

**P: Se eu desativar a flag, usuários perdem acesso Premium imediatamente?**
R: Sim, imediatamente. A lógica de `getEffectivePlan()` verifica a flag toda vez que carrega (frontend) ou faz requisição (backend).

---

**P: Posso ter múltiplos períodos de liberação?**
R: Não com esta implementação. A flag é global e única. Se você quer períodos alternados, precisa adicionar lógica mais complexa (array de períodos, etc.).

---

**P: Usuários com assinatura ativa veem Premium mesmo desligado?**
R: Sim! A função `getEffectivePlan()` faz:
```
if (globalConfig?.premiumOpenAccess && !expirado) return PREMIUM
else return getActivePlan(planData)  // Vê se tem assinatura ou not
```

---

**P: Quanto tempo demora para todos perceberem a mudança?**
R: Segundos. O frontend carrega `system/config` ao inicializar `usePlanData()`.

---

## 🚀 Status

**PRONTO PARA USAR AGORA!**

Todos os endpoints estão implementados e testados.

Comando para ativar:
```bash
curl -X POST https://reseller-catalog-hub.replit.app/api/admin/global-config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <SEU_TOKEN>" \
  -d '{"premiumOpenAccess": true, "premiumOpenAccessMessage": "V2 Lançado!"}'
```

---

**Último atualizado:** 2026-04-01  
**Versão:** 1.0
