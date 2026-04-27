# 🔔 Webhook Setup para Assinatura Premium — RevendaSmart

## ⚠️ CRÍTICO: Sem webhook configurado, o pagamento é aprovado MAS o usuário nunca vira Premium no app!

---

## 📋 O Problema

1. ✅ Usuário clica "Assinar Premium"
2. ✅ Checkout do Mercado Pago funciona
3. ✅ Pagamento é aprovado
4. ✅ Dinheiro entra na conta
5. ❌ **MAS o app não sabe que foi pago**
6. ❌ Usuário continua como Plano Grátis

**Razão:** Mercado Pago não consegue enviar webhook para seu servidor porque:
- URL não está registrada no MP Dashboard
- ou URL está errada
- ou MP Dashboard não foi configurado

---

## 🚀 Solução: Registrar Webhook no MP Dashboard

### **Passo 1: Acessar MP Dashboard**

1. Vá para https://www.mercadopago.com.br/developers/panel
2. Faça login com a conta **da qual você tirou as credenciais** (MERCADOPAGO_ACCESS_TOKEN)
3. Selecione a **aplicação correta** (RevendaSmart Premium)

### **Passo 2: Encontrar Webhooks**

1. No menu lateral, procure por **"Webhooks"** ou **"Notificações"**
2. Procure pela seção de **PreApproval** ou **Assinaturas**

### **Passo 3: Registrar a URL**

**URL para Webhook:**
```
https://reseller-catalog-hub.replit.app/api/app-subscription/webhook
```

**Eventos a selecionar:**
- ✅ `subscription_preapproval` (ou `preapproval`)
- ✅ `payment` (se disponível)

### **Passo 4: Salvar e Testar**

1. Clique em **"Salvar"** ou **"Guardar"**
2. MP deve oferecer um botão de **"Enviar teste"** — clique para testar
3. Você verá logs em: Replit → Aba "Logs"
   ```
   [subscriptions/webhook] ✅ WEBHOOK RECEIVED
   [subscriptions/webhook] Type: subscription_preapproval, ID: ...
   ```

---

## 🔍 Como Verificar se Webhook Está Configurado Corretamente

### **No Replit (Logs):**

1. Vá para https://replit.com → seu projeto RevendaSmart
2. Aba **"Logs"** (não Console)
3. Procure por:
   ```
   [subscriptions/webhook] ✅ WEBHOOK RECEIVED
   ```

### **Quando você clicar em "Assinar Premium":**

Você verá logs sequenciais:
```
[subscriptions/create] START uid=...
[subscriptions/create] Step 1: fetching user from Firebase Auth
[subscriptions/create] Step 2: checking existing subscription
[subscriptions/create] Step 3: creating PreApproval
[subscriptions/create] ✅ SUCCESS uid=... subscriptionId=...
```

### **Após pagar no Mercado Pago:**

Você verá:
```
[subscriptions/webhook] ✅ WEBHOOK RECEIVED
[subscriptions/webhook] Type: subscription_preapproval, ID: ...
[subscriptions/webhook] Fetching from MP with token: true
[subscriptions/webhook] MP response: subscriptionId=..., uid=..., status=authorized
[subscriptions/webhook] 📝 Calling syncPlanDataFromSubscription
[syncPlanDataFromSubscription] 🎉 Activating PREMIUM
[syncPlanDataFromSubscription] ✅ SAVED to Firestore users/..../planData/main
```

---

## 🔧 Se Webhook NÃO Aparece nos Logs

### **Checklist:**

- [ ] Webhook URL está registrada exatamente como acima?
- [ ] URL começa com `https://` (não `http://`)?
- [ ] Você clicou em "Salvar" ou "Guardar"?
- [ ] Você é o proprietário da aplicação no MP?
- [ ] A aplicação está ativa (não desativada)?
- [ ] Firestore Rules foram aplicadas? (ver FIRESTORE_RULES.md)

### **Se ainda não funcionar:**

1. Clique em "Enviar teste" no MP Dashboard
2. Verifique os logs no Replit
3. Se vir erro de permissão Firestore, veja FIRESTORE_RULES.md
4. Se vir `permission-denied`, aplique as rules (é a primeira causa de erro)

---

## 🚨 Caminho Completo da Assinatura

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Frontend: Clica "Assinar Premium"                        │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. Backend: POST /api/app-subscription/create               │
│    - Autentica usuário                                      │
│    - Cria PreApproval no MP                                 │
│    - Salva como "pending" no Firestore                      │
│    - Retorna checkout URL                                   │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. Frontend: Redireciona para checkout.mercadopago.com.br   │
│    - Usuário preenche dados de pagamento                    │
│    - Clica "Pagar"                                          │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. Mercado Pago: Processa o pagamento                       │
│    - ✅ Autoriza (status = "authorized")                    │
│    - 💰 Deposita dinheiro                                   │
│    - 🔔 Envia webhook para sua URL                          │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. Backend: POST /api/app-subscription/webhook              │
│    - Recebe notificação do MP                               │
│    - Busca status atual da assinatura no MP                 │
│    - Chama syncPlanDataFromSubscription()                   │
│    - Atualiza Firestore: currentPlan="premium"              │
│      premiumActive=true, subscriptionStatus="authorized"    │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ 6. Frontend: App recarrega dados                            │
│    - usePlanData lê users/{uid}/planData/main               │
│    - Vê currentPlan="premium" e premiumActive=true          │
│    - isPremiumActive() retorna true                         │
│    - UI muda para "Plano Premium Ativo" ✅                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 📊 Status Esperado Após Pagamento

No Firestore, documento `users/{uid}/planData/main` deve ter:

```json
{
  "currentPlan": "premium",
  "premiumActive": true,
  "premiumSource": "subscription",
  "subscriptionId": "123456789",
  "subscriptionStatus": "authorized",
  "autoRenew": true,
  "lastPaymentAt": Timestamp(2026-04-01),
  "nextBillingAt": Timestamp(2026-05-01),
  "updatedAt": Timestamp(2026-04-01)
}
```

---

## ⚠️ Ordem de Configuração Correta

1. **Primeiro:** Aplicar Firestore Rules (FIRESTORE_RULES.md)
2. **Segundo:** Registrar Webhook no MP Dashboard (este arquivo)
3. **Terceiro:** Testar pagamento

Se fizer na ordem errada, alguns passos não funcionarão!

---

## 📞 Checklist Final

- [ ] URL webhook registrada: `https://reseller-catalog-hub.replit.app/api/app-subscription/webhook`
- [ ] Tipo de evento: `subscription_preapproval` ou `preapproval`
- [ ] Firestore Rules foram aplicadas (FIRESTORE_RULES.md)
- [ ] Fez um pagamento teste
- [ ] Logs mostram `[subscriptions/webhook] ✅ WEBHOOK RECEIVED`
- [ ] Logs mostram `[syncPlanDataFromSubscription] 🎉 Activating PREMIUM`
- [ ] Firestore mostra `premiumActive: true`
- [ ] Frontend carrega e mostra "Plano Premium Ativo"

---

**Status:** 🔴 Precisa ser configurado ANTES do próximo pagamento test
