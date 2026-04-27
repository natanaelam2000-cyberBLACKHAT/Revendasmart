# 🔍 VERIFICAÇÃO FINAL — Debug Passo-a-Passo

## 📊 ESTADO ESPERADO DO DOCUMENTO PLANDATA

Após pagamento aprovado no Mercado Pago, o documento em `/users/{uid}/planData/main` deve ter:

```json
{
  "subscriptionId": "12345678-abcd-...",
  "subscriptionStatus": "authorized",    // ← CRÍTICO: deve ser "authorized"
  "currentPlan": "premium",               // ← CRÍTICO: deve ser "premium"
  "premiumActive": true,                  // ← CRÍTICO: deve ser true
  "premiumSource": "subscription",
  "premiumExpiresAt": null,               // Subscription não expira
  "autoRenew": true,
  "lastPaymentAt": Timestamp(...),        // Data do pagamento
  "nextBillingAt": Timestamp(...),        // Data próxima cobrança
  "paymentStatus": null,
  "canceledAt": null,
  "updatedAt": Timestamp(...)
}
```

### **CAMPOS CRÍTICOS (Se algum estiver errado, Premium NÃO aparece):**
- [ ] `subscriptionStatus === "authorized"` ← Página inteira depende disso
- [ ] `currentPlan === "premium"` ← Fallback se subscription não funciona
- [ ] `premiumActive === true` ← Confirmação visual

---

## 🖥️ O QUE VERIFICAR NO CONSOLE DO NAVEGADOR

### **Passo 1: Abrir DevTools**
1. Vá para https://revendasmart.vercel.app/subscribe
2. Pressione **F12** (ou Cmd+Option+I no Mac)
3. Vá para aba **"Console"**

### **Passo 2: Ver Erros Críticos**

Procure por estas mensagens no console:

#### ❌ **Se aparecer:**
```
[usePlanData] ❌ Error loading plan data
[usePlanData] Error Message: Missing or insufficient permissions
[usePlanData] Error Code: permission-denied
```
→ **Significado:** Firestore Rules AINDA NÃO foram aplicadas
→ **Solução:** Volte para Firebase Console e clique "Publish"

#### ❌ **Se aparecer:**
```
[usePlanData] ❌ Error loading plan data
[usePlanData] Error Message: PERMISSION_DENIED: Missing or insufficient permissions
```
→ **Significado:** Mesma coisa — rules não publicadas
→ **Solução:** Mesmo que acima

#### ✅ **Se NÃO aparecer nenhuma dessas:**
→ Rules foram publicadas ✅
→ Prossiga para Passo 3

### **Passo 3: Ver os Dados Carregados**

Procure por esta mensagem (search com Ctrl+F):
```
subscriptionStatus
```

Se encontrar linhas tipo:
```
subscriptionStatus: "authorized"
currentPlan: "premium"
premiumActive: true
```
→ **Significado:** Dados estão corretos ✅
→ Mas ainda mostra "Grátis"? Prossiga para Passo 4

Se NÃO encontrar:
```
subscriptionStatus: "pending"
currentPlan: "free"
premiumActive: false
```
→ **Significado:** Assinatura não foi sincronizada
→ **Solução:** Clique em "Sincronizar Assinatura Paga"

---

## 🔧 OS 5 BLOQUEADORES POSSÍVEIS

### **BLOQUEADOR #1: Firestore Rules Não Publicadas** 
**Sintoma:**
```
Error Code: permission-denied
```
**Verificação:**
- Vá para https://console.firebase.google.com
- Firestore Database → Rules
- Procura por: `match /users/{uid}`
- **Se vir `match /{document=**} { allow read, write: if false; }`**
  → Rules NÃO foram publicadas
  
**Solução:**
1. Apague tudo
2. Cole as rules (ver FIRESTORE_RULES.md)
3. Clique "Publish"

---

### **BLOQUEADOR #2: Assinatura Ainda em Status "pending"**
**Sintoma:**
```
subscriptionStatus: "pending"
currentPlan: "free"
premiumActive: false
```
**Verificação:**
- Abra DevTools Console
- Procure por `subscriptionStatus`
- Se disser "pending", significa...

**Solução:**
1. Vá para `/subscribe`
2. Clique em **"Sincronizar Assinatura Paga"**
3. Aguarde resposta ✅

---

### **BLOQUEADOR #3: Documento planData Não Existe**
**Sintoma:**
```
App mostra: "Criar novo plano..."
```
**Verificação:**
- Abra DevTools Console
- Procure por: `Create default plan`
- Se aparecer → documento não existe

**Solução:**
1. Clique "Assinar Premium"
2. Complete pagamento
3. Documento será criado automaticamente

---

### **BLOQUEADOR #4: Timestamp Não Sendo Convertido**
**Sintoma:**
```
subscriptionStatus: "authorized" ✅ (correto)
MAS app ainda mostra "Grátis"
```
**Verificação:**
- Abra DevTools Console
- Search por: `Timestamp`
- Se datas aparecerem como `Timestamp(...)` em vez de `Date`

**Solução:**
- Isso seria um bug no código, mas não deve acontecer
- Se aparecer, reconstrua: `npm run dev`

---

### **BLOQUEADOR #5: getActivePlan() Não Sendo Chamado**
**Sintoma:**
```
planData.subscriptionStatus === "authorized" ✅
planData.premiumActive === true ✅
MAS isPremium === false
```
**Verificação:**
- Abra DevTools Console
- Procure por: `isPremium: false`
- Procure por: `activePlan: "free"`

**Solução:**
- Isso seria um bug lógico raro
- Contate suporte com screenshot do console

---

## 📋 CHECKLIST RÁPIDO DE DEBUG

```
Seu checklist de 60 segundos:

[ ] 1. Abri DevTools (F12) e vou na aba Console
[ ] 2. Procuro por "permission-denied" → não encontro ✅
[ ] 3. Procuro por "subscriptionStatus" → encontro "authorized" ✅
[ ] 4. Procuro por "currentPlan" → encontro "premium" ✅
[ ] 5. Procuro por "premiumActive" → encontro true ✅
[ ] 6. Vou para /subscribe
[ ] 7. Clico "Sincronizar Assinatura Paga" (se status="pending")
[ ] 8. Vejo mensagem ✅ "Assinatura sincronizada!"
[ ] 9. Recarrego a página (F5)
[ ] 10. Dashboard mostra "Plano Premium Ativo" 🎉
```

---

## 🎯 O ÚLTIMO BLOQUEADOR REAL

**Se você chegou aqui e ainda mostra "Grátis", o problema é UMA dessas 3 coisas:**

### **Opção A: Firestore Rules (99% de chance)**
**Como saber:**
- Console mostra `permission-denied`

**Como corrigir:**
- Firebase Console → Rules → Publish

### **Opção B: Assinatura Não Sincronizada (1% de chance)**
**Como saber:**
- Console mostra `subscriptionStatus: "pending"`

**Como corrigir:**
- Click "Sincronizar Assinatura Paga"

### **Opção C: Documento Não Existe (0.1% de chance)**
**Como saber:**
- Console mostra erro ao carregar

**Como corrigir:**
- Clique "Assinar Premium" novamente

---

## ✅ CONFIRMAÇÃO DE QUE TUDO ESTÁ CERTO

Quando tudo estiver funcionando, você verá NO CONSOLE:

```
[usePlanData] planData carregado
✅ Sem erros
subscriptionId: "123abc..."
subscriptionStatus: "authorized"
currentPlan: "premium"
premiumActive: true
isPremium: true
activePlan: "premium"
```

E NO APP:
```
✅ Plano Premium Ativo
✅ Renovação automática
✅ Próxima cobrança: [data]
✅ Seus benefícios ativos:
   - Produtos ilimitados
   - Clientes ilimitados
   - Etc.
```

---

## 🚀 FLUXO COMPLETO ESPERADO (PARA REFERÊNCIA)

```
┌──────────────────┐
│ 1. Usuário Paga  │
│ Premium          │
└────────┬─────────┘
         ↓
┌──────────────────────────────────────┐
│ 2. Firestore Rules Aplicadas         │
│    (Você fez isso)                   │
└────────┬─────────────────────────────┘
         ↓
┌──────────────────────────────────────┐
│ 3. Backend criou documento            │
│    /users/{uid}/planData/main         │
│    subscriptionStatus: "pending"      │
└────────┬─────────────────────────────┘
         ↓
┌──────────────────────────────────────┐
│ 4. Frontend clica "Sincronizar"      │
│    POST /api/app-subscription/sync   │
└────────┬─────────────────────────────┘
         ↓
┌──────────────────────────────────────┐
│ 5. Backend consulta MP                │
│    Vê: status = "authorized"          │
│    Atualiza Firestore                │
│    subscriptionStatus: "authorized"   │
│    currentPlan: "premium"             │
│    premiumActive: true                │
└────────┬─────────────────────────────┘
         ↓
┌──────────────────────────────────────┐
│ 6. Frontend recarrega dados           │
│    usePlanData relê documento         │
│    isPremiumActive() retorna true     │
└────────┬─────────────────────────────┘
         ↓
┌──────────────────────────────────────┐
│ 7. App mostra "Premium Ativo" ✅     │
└──────────────────────────────────────┘
```

---

## 🆘 SE AINDA NÃO FUNCIONAR

Copie este bloco e me mostre:

```
1. URL do app: [colar aqui]
2. Você vê no console: permission-denied? SIM / NÃO
3. subscriptionStatus mostra: _________ (copiar valor)
4. currentPlan mostra: _________ (copiar valor)
5. premiumActive mostra: _________ (copiar valor)
6. O botão "Sincronizar" existe? SIM / NÃO
7. Ao clicar, o que acontece? [descrever]
```

Com essas informações, conseguiremos debugar definitivamente.

---

**Status:** 🟡 **Próximo Passo:** Faça o checklist acima e reporte os achados
