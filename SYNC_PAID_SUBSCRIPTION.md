# 🔄 Recuperar Assinatura Já Paga — RevendaSmart

## 🎯 Situação

Você já pagou a assinatura no Mercado Pago, mas:
- ❌ O app continua mostrando "Plano Grátis"
- ❌ O webhook ainda não foi configurado
- ❌ Firestore não foi sincronizado com o status real

**Solução:** Usar a rota de sincronização manual para recuperar a assinatura já paga **SEM pagar novamente**.

---

## ✅ Pré-requisitos

Antes de tentar sincronizar, verifique:

- [ ] Você já iniciou uma assinatura (clicou em "Assinar Premium")?
- [ ] Você completou o pagamento no Mercado Pago?
- [ ] Firestore Rules foram aplicadas? (Ver `FIRESTORE_RULES.md`)

Se algum estiver marcado como não, faça primeiro.

---

## 🚀 Como Sincronizar (2 Opções)

### **Opção 1: Via Frontend (Mais Fácil)**

1. Vá para https://revendasmart.vercel.app/subscribe
2. Você verá um botão (após implementação):
   ```
   "Sincronizar Assinatura Paga"
   ```
3. Clique
4. O app consultará o Mercado Pago e atualizará seu plano automaticamente

**Resultado esperado:**
```
✅ Assinatura sincronizada! Status: authorized
Plano: Premium
```

### **Opção 2: Via API (Se você souber fazer requisições)**

**Request:**
```bash
curl -X POST https://reseller-catalog-hub.replit.app/api/app-subscription/sync-now \
  -H "Authorization: Bearer SEU_TOKEN_FIREBASE" \
  -H "Content-Type: application/json"
```

**Response (sucesso):**
```json
{
  "success": true,
  "message": "Assinatura sincronizada! Status: authorized",
  "currentPlan": "premium",
  "premiumActive": true,
  "subscriptionStatus": "authorized",
  "syncedAt": "2026-04-01T16:30:00.000Z"
}
```

**Response (erro):**
```json
{
  "error": "NO_SUBSCRIPTION_ID",
  "message": "Nenhuma assinatura encontrada no seu plano. Inicie uma assinatura primeiro."
}
```

---

## 🔍 O Que Acontece Quando Você Sincroniza

### **Passo 1: Valida seu login**
```
✅ Verifica que você está autenticado
```

### **Passo 2: Busca o subscriptionId local**
```
✅ Lê users/{uid}/planData/main
✅ Encontra o subscriptionId (salvo quando você clicou em "Assinar")
```

### **Passo 3: Consulta Mercado Pago**
```
✅ Conecta ao MP com token central (MERCADOPAGO_ACCESS_TOKEN)
✅ Busca o status REAL da sua assinatura: "authorized", "pending", "cancelled", etc.
```

### **Passo 4: Sincroniza para Firestore**
```
✅ Se status = "authorized" → ativa premium automaticamente
✅ Atualiza: currentPlan = "premium"
✅ Atualiza: premiumActive = true
✅ Atualiza: subscriptionStatus = "authorized"
```

### **Passo 5: Retorna dados atualizados**
```
✅ Frontend carrega dados frescos
✅ App mostra "Plano Premium Ativo"
```

---

## 📊 Estados Possíveis Após Sincronização

| Status MP | O Que Significa | Resultado App |
|-----------|-----------------|---------------|
| `authorized` | ✅ Assinatura ativa e pagando | Premium ativado ✅ |
| `pending` | ⏳ Aguardando primeiro pagamento | Continua Grátis |
| `cancelled` | ❌ Assinatura cancelada | Muda para Grátis |
| `paused` | ⏸️ Pausada pelo usuário | Continua Grátis |
| `expired` | ⏱️ Expirou sem renovação | Continua Grátis |

---

## ⚠️ Cenários Comuns

### **Cenário 1: Pagamento foi aprovado**
```
Mercado Pago: ✅ Aprovado
App antes: ❌ Grátis
Após sincronizar: ✅ Premium
```

**Ação:** Clique em "Sincronizar Assinatura Paga"

### **Cenário 2: Pagamento está pendente**
```
Mercado Pago: ⏳ Aguardando confirmação
App antes: ❌ Grátis
Após sincronizar: ❌ Continua Grátis (aguardando pagamento)
```

**Ação:** Aguarde a confirmação do Mercado Pago

### **Cenário 3: Firestore Rules não foram aplicadas**
```
Erro ao sincronizar: "permission-denied"
```

**Ação:** Vá para `FIRESTORE_RULES.md` e aplique as rules no Firebase Console

---

## 🔐 É Seguro?

### ✅ SIM. Aqui por quê:

1. **Autenticado:** Você precisa estar logado
2. **Seguro:** Consulta o status real no Mercado Pago (não confia em dados locais)
3. **Sem duplicação:** Usa o mesmo `subscriptionId` já criado
4. **Admin SDK:** Backend usa credenciais administrativas, não suas
5. **Sem novo pagamento:** Só lê o status, não cria nova assinatura

---

## 📋 Checklist de Sincronização

- [ ] Estou logado no app?
- [ ] Firestore Rules foram aplicadas? (FIRESTORE_RULES.md)
- [ ] Vejo botão "Sincronizar Assinatura Paga" na tela?
- [ ] Cliquei em "Sincronizar Assinatura Paga"?
- [ ] Apareceu mensagem "✅ Assinatura sincronizada"?
- [ ] App mostra "Plano Premium Ativo"?

---

## 🚨 Se Ainda Não Funcionar

### **Erro: "No subscription found" ou "NO_SUBSCRIPTION_ID"**
- Você iniciou uma assinatura? (Clicou em "Assinar Premium"?)
- Se não: Clique em "Assinar Premium" e complete o pagamento

### **Erro: "permission-denied"**
- Firestore Rules não foram aplicadas
- Vá para `FIRESTORE_RULES.md` e aplique no Firebase Console

### **Erro: "Erro ao sincronizar com Mercado Pago"**
- Token do MP pode estar expirado
- Contacte suporte: fale qual é o erro exato

### **Sincronizou mas continua mostrando "Grátis"**
- Recarregue o app (F5)
- Faça logout e login novamente
- Se persistir: verifique se Firestore Rules estão ativas

---

## 📞 Fluxo Completo de Recuperação

```
┌─────────────────────────────────────┐
│ 1. Você pagou (sem webhook config)  │
│    - Mercado Pago recebeu           │
│    - Mas app não soube              │
└─────────────────────────────────────┘
         ↓
┌─────────────────────────────────────┐
│ 2. Você aplica Firestore Rules      │
│    (FIRESTORE_RULES.md)             │
└─────────────────────────────────────┘
         ↓
┌─────────────────────────────────────┐
│ 3. Você clica em                    │
│    "Sincronizar Assinatura Paga"    │
└─────────────────────────────────────┘
         ↓
┌─────────────────────────────────────┐
│ 4. Backend busca status no MP       │
│    - Encontra: "authorized"         │
│    - Atualiza Firestore             │
└─────────────────────────────────────┘
         ↓
┌─────────────────────────────────────┐
│ 5. App carrega dados                │
│    - Vê: currentPlan = "premium"    │
│    - Mostra: ✅ Premium Ativo       │
└─────────────────────────────────────┘
```

---

## 🎯 Próximos Passos

1. **Hoje:** Aplicar Firestore Rules (FIRESTORE_RULES.md)
2. **Hoje:** Clicar em "Sincronizar Assinatura Paga"
3. **Depois:** Configurar Webhook (WEBHOOK_SETUP.md) para próximas compras

---

**Status:** 🟢 Pronto para usar agora mesmo, sem pagar novamente!
