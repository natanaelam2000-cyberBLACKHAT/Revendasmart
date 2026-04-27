# 🔐 Firestore Security Rules — RevendaSmart

⚠️ **CRÍTICO:** Sem aplicar essas rules no Firebase Console, o app NÃO consegue ler dados de plano do usuário!

**Problema:** "Missing or insufficient permissions" ao carregar `planData`

**Causa:** As Firestore rules não estão permitindo que usuários autenticados acessem seus próprios documentos de plano.

**Impacto se não fizer:**
- ❌ Frontend não consegue ler `users/{uid}/planData/main`
- ❌ Usuário continua como "Plano Grátis" mesmo após pagar
- ❌ App mostra erro "Permissão negada ao carregar dados do plano"
- ✅ **É totalmente separado do webhook** — ambos são necessários!

---

## 📋 Rules Necessárias

Vá para **Firebase Console → Firestore Database → Rules** e adicione/substitua com isso:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // =========================================================================
    // Users Collection — permite ao usuário ler/escrever apenas seus próprios dados
    // =========================================================================
    match /users/{uid} {
      // User pode ler/escrever sua própria pasta
      allow read, write: if request.auth.uid == uid;
      
      // Subcoleções dentro de /users/{uid}
      match /{document=**} {
        // User pode acessar qualquer subcoleção dentro de sua pasta
        allow read, write: if request.auth.uid == uid;
      }
    }
    
    // =========================================================================
    // System Config — público (apenas leitura) + admin (escrita)
    // =========================================================================
    match /system/{document=**} {
      // Qualquer pessoa autenticada pode ler config
      allow read: if request.auth != null;
      
      // Apenas backend (via Admin SDK) pode escrever
      // Client SDK (Firebase Auth) não consegue escrever aqui
      allow write: if false;
    }
    
    // =========================================================================
    // Deny everything else
    // =========================================================================
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

---

## 🔍 Explicação das Rules

### Permitir ao usuário ler/escrever seus próprios dados
```javascript
match /users/{uid} {
  allow read, write: if request.auth.uid == uid;
  match /{document=**} {
    allow read, write: if request.auth.uid == uid;
  }
}
```
✅ Usuário pode acessar `/users/SEU_UID/planData/main`  
✅ Usuário pode acessar qualquer subcoleção dentro de `/users/SEU_UID`  
❌ Usuário NÃO pode acessar `/users/OUTRO_UID/planData/main`

### System config — apenas leitura
```javascript
match /system/{document=**} {
  allow read: if request.auth != null;
  allow write: if false;
}
```
✅ Qualquer usuário autenticado pode ler `system/config`  
❌ Usuários NÃO podem escrever (apenas Admin SDK consegue)

---

## 🚀 COMO APLICAR — PASSO A PASSO (OBRIGATÓRIO!)

### Via Firebase Console (NECESSÁRIO)

**IMPORTANTE:** Você PRECISA fazer isso MANUALMENTE no Firebase Console. Não é automático!

1. Vá para https://console.firebase.google.com (use a mesma conta do projeto)
2. Selecione o projeto: **`revenda-smart`**
3. Menu lateral → **Firestore Database**
4. Aba **Rules** (não é "Settings", é "Rules")
5. **Apague as rules atuais** (Iniciam com `rules_version = '2';`)
6. **Copie e cole as rules completas** abaixo
7. Clique em **"Publish"** (botão azul no topo direito)
8. **Aguarde** ~2-3 segundos para regras serem ativadas
9. Recarregue o app (F5) e teste

### Via Firebase CLI
```bash
firebase deploy --only firestore:rules
```

---

## ✅ Validação

Após aplicar as rules:

1. **No navegador (DevTools):**
   - Abra `/subscribe` ou `/dashboard`
   - Procure no console por:
     ```
     [usePlanData] Error loading plan data: ...
     ```
   - **Esperado após fix:** Nenhuma mensagem de erro (ou erro específico, não de permissão)

2. **No backend (Replit logs):**
   - Procure por `[subscriptions/create]` logs
   - Deve estar funcionando sem erro de Firestore

---

## 🚨 Problemas Comuns

### "Still getting permission error"
- [ ] Publicou as rules? (Precisa clicar "Publish")
- [ ] Está autenticado com a conta correta?
- [ ] Esperou 2-3 segundos após publicar?
- [ ] Tentou atualizar a página? (F5)

### "Backend consegue escrever, frontend não consegue ler"
- Backend usa **Admin SDK** (super poder, sem rules)
- Frontend usa **Client SDK** (respeitaas rules)
- Isso é seguro e esperado

### "System/config não tem dados"
- Primeira vez que o backend tenta acessar `/api/app-subscription/create`
- Backend cria automaticamente `system/config` com `premiumPlanId`
- Aguarde ~2 segundos e recarregue

---

## 📚 Path Reference

| Path | Acesso | Usuário | Backend | Notas |
|------|--------|---------|---------|-------|
| `/users/{uid}/planData/main` | RW | ✅ | ✅ | Dados do plano do usuário |
| `/system/config` | R | ✅ | ✅ | ID do plano premium (read-only) |
| `/users/OTHER_UID/...` | - | ❌ | ✅ | Não consegue acessar dados de outro |

---

## 🔒 Segurança

- ✅ Usuários só conseguem ler/escrever seus próprios dados
- ✅ Backend (Admin SDK) consegue fazer anything (seguro no servidor)
- ✅ System config é protegido contra escrita de usuários
- ✅ Sem brechas de segurança

---

## 📞 Se Ainda Não Funcionar

1. Compartilhe o **erro exato** do console (copie todo)
2. Verificaque está em `https://console.firebase.google.com` (não Replit)
3. Projeto correto: `revenda-smart`
4. Rules foram publicadas (botão azul "Publish")

---

---

## 🔗 Relacionado: Webhook Setup

As rules PERMITEM a leitura do front-end, mas o **Webhook** é o que **ESCREVE** os dados após o pagamento.

- **FIRESTORE_RULES.md** (este arquivo): Permite front-end LER dados
- **WEBHOOK_SETUP.md**: Permite back-end ESCREVER dados após pagamento

**Ambos são necessários!** Se um falhar:
- Sem rules → app não consegue LER → erro "permission-denied"
- Sem webhook → app não consegue escrever → usuário fica como "free" mesmo após pagar

---

**Status:** 🔴 **AÇÃO NECESSÁRIA:** Aplicar rules no Firebase Console AGORA!

Depois que aplicar, vá para WEBHOOK_SETUP.md para registrar a URL do webhook no MP Dashboard.
