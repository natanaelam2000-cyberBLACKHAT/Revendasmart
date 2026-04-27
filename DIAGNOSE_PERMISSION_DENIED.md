# 🔍 Diagnóstico: Por Que Continua "permission-denied"?

## ❌ PROBLEMA IDENTIFICADO

As **Firestore Rules NÃO foram PUBLICADAS** no Firebase Console!

### O Ciclo de Erro:

```
1. Você criou um documento em users/{uid}/planData/main no backend ✅
2. Backend salva com permissão (Admin SDK bypassa rules)
3. Frontend tenta LER o mesmo documento com Client SDK
4. Firestore vê: "Usuário tentando ler users/{uid}/planData/main"
5. Consulta as rules: "Qual é a regra para isso?"
6. ❌ ENCONTRA A REGRA PADRÃO (deny all) — NOT PUBLISHED
7. ❌ Retorna: "Missing or insufficient permissions"
```

---

## ✅ COMO CONFIRMAR QUE AS RULES NÃO FORAM PUBLICADAS

### Método 1: Verificar no Firebase Console

1. Vá para https://console.firebase.google.com
2. Projeto: `revenda-smart`
3. Firestore Database → **Rules** (não Settings)
4. **Verifique o INÍCIO das rules:**

Se começar com:
```javascript
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

**⚠️ SIGNIFICA:** Rules ainda estão no padrão (negam tudo)

Se começar com:
```javascript
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth.uid == uid;
    ...
  }
}
```

**✅ SIGNIFICA:** Rules foram publicadas corretamente

---

## 🚀 PASSOS FINAIS PARA CORRIGIR DEFINITIVAMENTE

### **PASSO 1: Abrir Firebase Console (Manualmente — Obrigatório!)**

1. Vá para https://console.firebase.google.com
2. Use a mesma conta que criou o projeto `revenda-smart`
3. Selecione **Projeto:** `revenda-smart`

### **PASSO 2: Acessar Firestore Rules**

1. Menu lateral esquerdo → **Firestore Database**
2. Aba superior → **Rules** (exatamente este, não "Settings")

### **PASSO 3: Copiar Rules Corretas**

Copie o bloco abaixo inteiro:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Users — each user owns their data
    match /users/{uid} {
      allow read, write: if request.auth.uid == uid;
      match /{document=**} {
        allow read, write: if request.auth.uid == uid;
      }
    }
    
    // System config — public read, no write
    match /system/{document=**} {
      allow read: if request.auth != null;
      allow write: if false;
    }
    
    // Deny everything else
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

### **PASSO 4: Substituir as Rules Atuais**

1. **Apague tudo** que está no editor (Ctrl+A, Delete)
2. **Cole o bloco acima**
3. **Verifique** se não há erros de sintaxe (linha 1 deve ser `rules_version = '2';`)

### **PASSO 5: PUBLICAR (Crítico!)**

1. Procure pelo botão **"Publish"** (azul, canto superior direito)
2. **Clique em "Publish"**
3. Aguarde ~2-3 segundos
4. Verá mensagem: **"Rules updated"** ou **"Published successfully"**

### **PASSO 6: Aguardar Propagação**

- Aguarde **5-10 segundos** para as regras serem propagadas
- Recarregue o app (F5)

---

## 🎯 VERIFICAÇÃO FINAL

Após publicar as rules, vá para o app:

1. Vá para https://revendasmart.vercel.app
2. Faça logout (se necessário)
3. Faça login novamente
4. Vá para Dashboard
5. Procure no **Console do Navegador** (F12 → Console):

### ❌ Se ainda aparecer:
```
[usePlanData] ❌ Error loading plan data
[usePlanData] Error Message: Missing or insufficient permissions
```

**Significa:** Rules ainda não foram publicadas. Volte ao PASSO 1.

### ✅ Se desaparecer:
```
✅ Nenhuma mensagem de erro
[usePlanData] planData carregado
```

**Significa:** Rules foram publicadas! Prossiga.

---

## 📊 O QUE ACONTECE APÓS PUBLICAR

### **Sequência Esperada:**

1. **Frontend carrega app**
   ```
   onAuthStateChanged → obtém uid do usuário
   ```

2. **Frontend tenta LER planData**
   ```
   doc(db, 'users', uid, 'planData', 'main')
   getDoc(planDocRef)
   ```

3. **Firestore verifica rules**
   ```
   "request.auth.uid (uid do user) == uid (no path)?"
   SIM ✅ → Permitir leitura
   ```

4. **Frontend recebe dados**
   ```
   planData = {
     currentPlan: "premium",
     premiumActive: true,
     subscriptionStatus: "authorized",
     ...
   }
   ```

5. **App renderiza corretamente**
   ```
   isPremium === true
   Mostra: "Plano Premium Ativo" ✅
   ```

---

## 🚨 CHECKLIST DE CORREÇÃO

- [ ] Fui para https://console.firebase.google.com?
- [ ] Selecionei projeto `revenda-smart`?
- [ ] Cliquei em Firestore Database?
- [ ] Cliquei na aba **Rules** (não Settings)?
- [ ] Vi as rules atuais (ou padrão deny all)?
- [ ] Copiei o bloco correto acima?
- [ ] Apaguei as rules antigas completamente?
- [ ] Colei o bloco novo?
- [ ] Verifiquei sintaxe (sem erros em vermelho)?
- [ ] Cliquei em **"Publish"** (botão azul)?
- [ ] Aguardei 5-10 segundos?
- [ ] Recarreguei o app (F5)?
- [ ] O erro "permission-denied" desapareceu?
- [ ] O app mostra "Plano Premium Ativo"?

---

## 📞 SE AINDA NÃO FUNCIONAR

### **Erro: "permission-denied" continua**

**Diagnóstico:**
1. Rules não foram publicadas
2. OU está usando outro projeto Firebase
3. OU está em conta errada

**Solução:**
- Verifique que está no projeto correto: `revenda-smart`
- Verifique que está na conta certa (aquela que criou o projeto)
- Tente de novo do passo 1

### **Erro: "Rule not found"**

**Diagnóstico:**
Há erro de sintaxe nas rules

**Solução:**
- Copie as rules novamente (bloco acima)
- Não modifique nada
- Publish

### **App carrega, mas mostra "Grátis"**

**Diagnóstico:**
Rules foram publicadas ✅
Mas planData não tem `premiumActive: true`

**Solução:**
- Vá para /subscribe
- Clique em "Sincronizar Assinatura Paga"
- Isso busca status real no MP e atualiza Firestore

---

## 🎯 O CAMINHO EXATO ENVOLVIDO

**Path que será acessado:**
```
/databases/revenda-smart/documents/users/{SEU_UID}/planData/main
```

**Rule que permite:**
```javascript
match /users/{uid} {
  allow read, write: if request.auth.uid == uid;
  match /{document=**} {
    allow read, write: if request.auth.uid == uid;
  }
}
```

**Tradução da rule:**
- `match /users/{uid}` → "Para documentos em /users/ALGO"
- `request.auth.uid == uid` → "Se SEU UID == ALGO"
- `match /{document=**}` → "E QUALQUER coisa dentro dessa pasta"
- `allow read, write` → "Pode ler e escrever"

**Resultado:** Você consegue acessar `/users/SEU_UID/planData/main` ✅

---

**Status:** 🔴 **AÇÃO CRÍTICA:** Publish das rules é obrigatório. Sem isso, nada funciona!
