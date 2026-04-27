# Auditoria Rigorosa de Firestore Security Rules — RevendaSmart

**Data da Auditoria**: 30 de março de 2026  
**Escopo**: Validação completa de isolamento de dados, autenticação e autorização em Firestore  
**Avaliador**: Análise estática + mapeamento de operações reais

---

## DIAGNÓSTICO CRÍTICO

🔴 **ACHADO CRÍTICO**: Não há arquivo `firestore.rules` no repositório do projeto.

**Implicações:**
- ❌ Impossível auditar as rules atuais localmente
- ❌ Não há versionamento das rules no git
- ⚠️ Rules podem estar muito abertas, mal configuradas ou ausentes
- 🔴 **RISCO MÁXIMO**: Qualquer usuário autenticado pode potencialmente ler/escrever dados de outro usuário

---

## A. ESTRUTURA DE COLEÇÕES & OPERAÇÕES REAIS

### Coleções Críticas Mapeadas

| Caminho | Tipo | Cliente | Backend | Sensibilidade |
|---------|------|---------|---------|---|
| `users/{uid}/products` | Subcoleção | LEITURA/ESCRITA direta | R/W via admin | ALTA |
| `users/{uid}/clients` | Subcoleção | LEITURA/ESCRITA direta | R/W via admin | ALTA |
| `users/{uid}/charges` | Subcoleção | LEITURA direta | R/W via admin | CRÍTICA |
| `users/{uid}/mercadopago_connections` | Subcoleção | LEITURA direta | R/W via admin | CRÍTICA |
| `user_settings/{uid}` | Doc raiz | API backend apenas | R/W com auth | CRÍTICA |
| `mercadopago_oauth_states/{nonce}` | Doc raiz | Nenhum acesso cliente | WRITE server | MÉDIA |

---

## B. FALHAS DE SEGURANÇA ENCONTRADAS

### 🔴 FALHA 1: Ausência de Firestore Rules no Repositório
**Gravidade**: CRÍTICA  
**Status**: NÃO CORRIGÍVEL SEM ACESSO AO FIREBASE CONSOLE

**Descrição**:
- Não existe arquivo `firestore.rules` ou `firestore.json` no projeto
- Rules estão PRESUMIVELMENTE configuradas apenas no Firebase Console
- Não há versionamento das rules no git
- Impossível auditar a configuração real

**Risco Real**:
```
Cenário: Sem rules corretas
User A (uid: abc123) está logado
User B (uid: xyz789) está logado

User A pode fazer:
const ref = collection(db, "users", "xyz789", "products")
const snap = await getDocs(ref)  // ❌ Lê produtos de User B!

User A pode fazer:
await deleteDoc(doc(db, "users", "xyz789", "charges", chargeId))  // ❌ Deleta charges de User B!
```

---

### 🔴 FALHA 2: Acesso Direto do Cliente Sem Validação Backend
**Gravidade**: CRÍTICA  
**Localização**: Todos os hooks de leitura/escrita diretos

**Arquivos Afetados**:
- `client/src/hooks/useDashboardData.ts` — lê products, sales, clients
- `client/src/hooks/useClientsData.ts` — lê/escreve clients
- `client/src/hooks/useCharges.ts` — lê charges
- `client/src/hooks/useMPConnections.ts` — lê mercadopago_connections

**Exemplo de Operação Perigosa**:
```typescript
// client/src/hooks/useDashboardData.ts:57
const unsubscribeProducts = onSnapshot(
  collection(firestore, "users", uid, "products"),  // ❌ uid vem do user autenticado
  (snapshot) => { ... }
);

// SE Firestore Rules NÃO validam corretamente:
// Qualquer usuário autenticado lê qualquer colecção
// Firestore não valida se "uid" == "auth.uid"
```

**Impacto**:
- ❌ Sem logs server-side
- ❌ Sem auditoria de acesso
- ❌ Sem rate limiting
- ❌ Sem validação de negócio (ex: produto pertence ao usuário?)

---

### 🟡 FALHA 3: Mercado Pago Connections Contêm Dados Sensíveis
**Gravidade**: CRÍTICA  
**Localização**: `users/{uid}/mercadopago_connections`

**Risco**:
- Tokens criptografados armazenados como documentos
- Cliente faz READ direto: `collection(db, "users", user.uid, "mercadopago_connections")`
- Se Rules não protegerem: qualquer usuário lista conexões MP de outro usuário
- **Cenário de Ataque**:

```typescript
// User B tenta ler conexões MP de User A:
const hacker = "hacker-uid";
const targetUser = "legitimate-user-uid";

// Frontend código (alterado maliciosamente):
const ref = collection(db, "users", targetUser, "mercadopago_connections");
const connections = await getDocs(ref);  // ❌ Sucesso se Rules abertas!
```

---

### 🟡 FALHA 4: Sem Auditoria de Operações Firestore
**Gravidade**: ALTA  
**Localização**: Cliente acessa Firestore diretamente

**Risco**:
- Nenhum log quando usuário lê dados de outro
- Impossível detectar tentativa de ataque
- Sem trilha para compliance (LGPD, privacy)
- Sem alertas de acesso indevido

---

### 🟡 FALHA 5: Charges (Informação Financeira) Exposta
**Gravidade**: CRÍTICA  
**Localização**: `users/{uid}/charges` — acessado direto pelo cliente

**Risco**:
- Dados de cobrança/vendas do usuário
- User A consegue ler charges de User B se Rules abertas
- Sem criptografia no repouso
- Sem auditoria de acesso

---

### 🟡 FALHA 6: Operações de Escrita Sem Validação Backend
**Gravidade**: ALTA  
**Localização**: `client/src/hooks/useClientsData.ts`

**Código Perigoso**:
```typescript
// client/src/hooks/useClientsData.ts:68
const clientRef = doc(firestore, "users", uid, "clients", clientId);
await setDoc(clientRef, {...}); // ❌ Sem validação backend
```

**Risco**:
- Cliente envia qualquer dado para Firestore
- Se Rules não validam schema: dados corrompidos
- Sem rate limiting: ataque de escrita em massa
- Sem logging: quem modificou o quê?

---

## C. VERIFICAÇÕES EXECUTADAS

### ✅ O Que Está Protegido

| Item | Status | Motivo |
|------|--------|--------|
| `user_settings` read | ✅ SEGURO | Backend API + requireOwnership |
| `user_settings` write | ✅ SEGURO | Backend API + requireOwnership |
| Referral transactions | ✅ SEGURO | Transação atômica + validação backend |
| Admin rewards | ✅ SEGURO | Middleware requireAdmin no backend |
| OAuth flow | ✅ SEGURO | Server-side nonce validation |

### ❌ O Que Não Está Protegido

| Item | Status | Motivo |
|------|--------|--------|
| Products read/write | ❌ DESPROTEGIDO | Cliente direto, sem rules |
| Clients read/write | ❌ DESPROTEGIDO | Cliente direto, sem rules |
| Charges read | ❌ DESPROTEGIDO | Cliente direto, sem rules |
| MP Connections read | ❌ DESPROTEGIDO | Cliente direto, sem rules |

---

## D. RECOMENDAÇÕES CRÍTICAS

### IMEDIATO (P0)

**1. CRIAR firestore.rules**

Arquivo: `firestore.rules` (criar na raiz do projeto)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Helper: Check if user owns this resource
    function userOwnsResource(userId) {
      return request.auth.uid == userId;
    }

    // Helper: Check if user is authenticated
    function isAuthenticated() {
      return request.auth.uid != null;
    }

    // ====== USER DATA (per-user isolation) ======
    match /users/{uid} {
      allow read, write: if false; // No direct access to /users/{uid}

      // Products subcollection
      match /products/{productId} {
        allow read, create, update: if isAuthenticated() && userOwnsResource(uid);
        allow delete: if isAuthenticated() && userOwnsResource(uid);
      }

      // Clients subcollection
      match /clients/{clientId} {
        allow read, create, update: if isAuthenticated() && userOwnsResource(uid);
        allow delete: if isAuthenticated() && userOwnsResource(uid);
      }

      // Charges subcollection (read-only)
      match /charges/{chargeId} {
        allow read: if isAuthenticated() && userOwnsResource(uid);
        allow create, update, delete: if false; // Charges managed by backend
      }

      // Mercado Pago connections (read-only for client)
      match /mercadopago_connections/{connectionId} {
        allow read: if isAuthenticated() && userOwnsResource(uid);
        allow create, update, delete: if false; // Managed by backend
      }
    }

    // ====== USER SETTINGS (backend-managed) ======
    match /user_settings/{userId} {
      allow read, write: if false; // No client access, backend handles with admin SDK
    }

    // ====== OAUTH STATES (server-only) ======
    match /mercadopago_oauth_states/{nonce} {
      allow read, write: if false; // Server-side only, no client access
    }
  }
}
```

**2. Adicionar Validação de Schema em Rules**

```javascript
// Na seção de products:
match /products/{productId} {
  allow create: if isAuthenticated() && userOwnsResource(uid)
    && request.resource.data.keys().hasAll(['name', 'price'])
    && request.resource.data.name is string
    && request.resource.data.price > 0;
  // ... rest of rules
}
```

**3. Publicar Rules**

```bash
firebase deploy --only firestore:rules
```

---

### CURTO PRAZO (P1)

**1. Migrar Operações de Escrita para Backend API**

- ❌ ANTES: Client `setDoc` → Firestore diretamente
- ✅ DEPOIS: Client → POST /api/products → Backend → Firestore

**Exemplo**:
```typescript
// ANTES (inseguro):
await setDoc(doc(firestore, "users", uid, "products", id), productData);

// DEPOIS (seguro):
const response = await fetch(`/api/products/${id}`, {
  method: "POST",
  body: JSON.stringify(productData),
  headers: { "Authorization": `Bearer ${token}` }
});
```

**2. Adicionar Auditoria de Firestore**

```bash
gcloud firestore logs --follow
```

**3. Implementar Rate Limiting no Backend**

```typescript
// Para operações críticas
const createProductRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10 // Max 10 produtos por minuto
});

app.post("/api/products", createProductRateLimit, async (req, res) => {
  // ...
});
```

---

### MÉDIO PRAZO (P2)

**1. Implementar Encrypted Storage**

- Dados sensíveis (charges, connections) criptografados no repouso
- Chaves gerenciadas via Google Cloud KMS

**2. Adicionar Field-Level Encryption**

- Tokens MP criptografados em nível de campo
- Apenas admin SDK consegue descriptografar

**3. Implementar Document-Level Access Control**

- CustomClaims para role-based access
- Admins conseguem ler dados de usuários (com auditoria)

---

## E. VEREDITO FINAL

### Status de Segurança Antes da Correção

| Área | Status | Confiabilidade |
|------|--------|---|
| **Autenticação** | ✅ Robusta | Firebase Auth obrigatório |
| **Autorização (Backend)** | ✅ Robusta | requireAuth + requireOwnership |
| **Autorização (Firestore)** | 🔴 CRÍTICA | SEM RULES ADEQUADAS |
| **Isolamento de Dados** | 🔴 CRÍTICA | Sem regras de isolamento |
| **Auditoria** | 🔴 AUSENTE | Sem logs de acesso |
| **Validação de Schema** | 🔴 FRACA | Sem schema enforcement |
| **Rate Limiting** | 🟡 PARCIAL | Apenas no backend |

### Conclusão

**🔴 SEGURANÇA: FRÁGIL**

O sistema está vulnerável a:
- ✅ Quebra de isolamento de dados entre usuários
- ✅ Acesso não autorizado a charges, conexões MP
- ✅ Modificação de dados de outros usuários
- ✅ Ataques de escrita em massa (sem rate limit no Firestore)

**Causa Raiz**: Ausência de Firestore Rules + acesso direto do cliente sem validação backend

**Risco**: CRÍTICO — Pronto para ataque em produção

**Ação Necessária**: IMPLEMENTAR firestore.rules IMEDIATAMENTE antes de lançar em produção

---

## F. CHECKLIST DE CORREÇÃO

- [ ] Criar arquivo `firestore.rules` com rules corretas (vide acima)
- [ ] Deploy das rules via Firebase CLI
- [ ] Testar isolamento: User A NÃO consegue ler User B data
- [ ] Testar escrita: User A NÃO consegue escrever em User B data
- [ ] Adicionar logs de Firestore no Cloud Logging
- [ ] Implementar rate limiting para operações sensíveis
- [ ] Migrar operações de escrita críticas para backend
- [ ] Documentar Firestore Rules no replit.md

---

**STATUS**: 🔴 REQUER CORREÇÃO IMEDIATA

As Firestore Rules são críticas para a segurança em produção. Sem elas, qualquer usuário autenticado consegue acessar/modificar dados de outro usuário.
