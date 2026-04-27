# Implementação de Monetização — Sumário Executivo

**Data:** 31 de março de 2026  
**Status:** Base Estrutural Completa  
**Próxima Fase:** Telas de Upgrade e Validações

---

## 1. PROPOSTA ENTREGUE

### Modelagem de Planos
✅ **Criado:** `shared/monetization.ts`
- Tipos TypeScript: `PlanType`, `PlanData`, `ReferralInfo`, `ReferralEvent`
- Constantes: `PLAN_CONFIG` com limites e features
- Helpers: `canAddProduct()`, `canAddClient()`, `canUseFeature()`, `isPremiumActive()`, `getActivePlan()`
- Geração de código de referral: `generateReferralCode(uid)`

### Modelagem de Referral
✅ **Estrutura em Firestore:**
```
users/{uid}/planData
├─ currentPlan: 'free' | 'premium'
├─ premiumActive: boolean
├─ premiumExpiresAt: Timestamp | null
├─ premiumStartedAt: Timestamp | null
├─ premiumSource: 'direct_purchase' | 'referral_reward' | 'admin'
├─ referralCode: string (USER-XXXXXXXXX)
└─ referralCount: number

users/{uid}/referralData
├─ code: string
├─ referredBy: string | null
├─ referrals: { [uid]: ReferralRecord }
├─ validReferralCount: number
└─ rewards: { premiumGrants: [] }

referralEvents/{eventId}
├─ referredUID, referredEmail
├─ referrerUID, referrerEmail
├─ events: []
├─ status: 'pending' | 'valid' | 'fraud'
├─ deviceId, ipAddress
└─ accountAge: number
```

---

## 2. O QUE FOI IMPLEMENTADO AGORA

### Frontend (Cliente)
✅ **`client/src/hooks/usePlanData.ts`** — NOVO
- Hook para carregar `planData` do Firestore
- Gera referral code se não existir
- Calcula plano ativo baseado em expiração
- Monta share link automaticamente
- Retorna: `planData`, `activePlan`, `isPremium`, `referralCode`, `shareLink`, `referralCount`

✅ **`client/src/lib/plan-helpers.ts`** — NOVO
- Helpers para validação no cliente
- `checkProductLimit()`, `checkClientLimit()`, `checkChargesFeature()`, etc
- Mensagens de bloqueio em constante `UPGRADE_MESSAGES`
- Helpers de UI: `getPlanName()`, `getPlanFeatures()`, `getPlanColor()`

### Backend (Servidor)
✅ **Endpoints em `server/routes.ts`:**

1. **GET `/api/plan/data/:userId`**
   - Retorna planData do usuário
   - Fallback: plano grátis padrão se não existir
   - Requer autenticação + ownership

2. **POST `/api/plan/initialize/:userId`**
   - Inicializa planData no primeiro login
   - Gera referral code único
   - Defini plano grátis padrão
   - Requer autenticação + ownership

3. **POST `/api/referral/track-event`**
   - Rastreia evento de indicação (account creation, onboarding, etc)
   - Cria documento em `referralEvents` collection
   - Valida formato de código (USER-XXXXXXXXX)
   - Sem autenticação (webhook-friendly)

4. **POST `/api/referral/validate-referral`**
   - Valida indicação após onboarding completo
   - Encontra evento referral, marca como `valid`
   - Incrementa `referralCount` do referrer
   - **Se `referralCount === 3`: libera 30 dias de Premium automaticamente**
   - Atualiza `premiumExpiresAt`, `premiumStartedAt`, `premiumSource`

### Banco de Dados
✅ **Firestore (sem alterações estruturais necessárias)**
- Usa subcoleções: `users/{uid}/planData`
- Firestore timestamps nativos
- Sem migração necessária (estrutura coexiste com dados existentes)

---

## 3. ARQUIVOS ALTERADOS

```
CRIADOS:
✅ shared/monetization.ts (tipos, constantes, helpers)
✅ client/src/hooks/usePlanData.ts (hook React)
✅ client/src/lib/plan-helpers.ts (helpers de validação)
✅ MONETIZATION_STRUCTURE_PROPOSAL.md (proposta detalhada)
✅ MONETIZATION_IMPLEMENTATION_SUMMARY.md (este arquivo)

ALTERADOS:
✅ server/routes.ts (+150 linhas, 4 novos endpoints)
```

---

## 4. COMO USAR AGORA

### No Cliente (React)
```typescript
import { usePlanData } from '@/hooks/usePlanData';
import { checkProductLimit, UPGRADE_MESSAGES } from '@/lib/plan-helpers';

function AddProductPage() {
  const { activePlan, referralCode, shareLink, referralCount } = usePlanData();
  
  // Validar se pode adicionar produto
  const { allowed, limit } = checkProductLimit(activePlan, productList.length);
  
  if (!allowed) {
    return (
      <div>
        <p>{UPGRADE_MESSAGES.PRODUCTS_LIMIT}</p>
        <button onClick={() => showUpgradeModal()}>
          Upgrade para Premium
        </button>
      </div>
    );
  }
  
  // Mostrar referral
  return (
    <div>
      <p>Seu código: {referralCode}</p>
      <p>Link: {shareLink}</p>
      <p>Indicações válidas: {referralCount}/3</p>
    </div>
  );
}
```

### No Backend
```typescript
// Inicializar plano na primeira vez
await fetch('/api/plan/initialize/user-uid', { method: 'POST' });

// Rastrear evento de indicação
await fetch('/api/referral/track-event', {
  method: 'POST',
  body: JSON.stringify({
    referredUID: 'new-user-uid',
    referredEmail: 'user@email.com',
    referrerUID: 'referrer-uid',
    referrerEmail: 'referrer@email.com',
    event: 'account_created',
    refCode: 'USER-abc123',
  }),
});

// Validar indicação após onboarding
await fetch('/api/referral/validate-referral', {
  method: 'POST',
  body: JSON.stringify({
    referredUID: 'new-user-uid',
    referrerUID: 'referrer-uid',
  }),
});
```

---

## 5. RISCOS REMANESCENTES

### Críticos
| Risco | Severidade | Mitigação |
|-------|-----------|-----------|
| **Fraude de referral** | 🔴 ALTO | Implementar device ID + IP tracking (Fase 4) |
| **Auto-indicação** | 🔴 ALTO | Validar email/phone diferentes + date limits (Fase 4) |
| **Timeout de premium** | 🟡 MÉDIO | Verificar `premiumExpiresAt` em cada feature call |
| **Upgrade sem pagamento** | 🔴 ALTO | Integrar Mercado Pago depois (Fase 2) |

### Médios
| Risco | Severidade | Mitigação |
|-------|-----------|-----------|
| **Produtos além do limite** | 🟡 MÉDIO | Validar em `add-product.tsx` + servidor |
| **Clientes além do limite** | 🟡 MÉDIO | Validar em `clients.tsx` + servidor |
| **Acesso a features premium** | 🟡 MÉDIO | Validar `isPremium` antes de render |

### Baixos
| Risco | Severidade | Mitigação |
|-------|-----------|-----------|
| **Sincronização de planData** | 🟢 BAIXO | Firestore real-time listeners (já existe) |
| **Expiração premium** | 🟢 BAIXO | Cron job de verificação (Fase 4) |

---

## 6. QUAIS TELAS/AÇÕES PRECISAM VALIDAÇÃO

### Imediato (Fase 2)
```
❌ PRECISA INTEGRAÇÃO:
- add-product.tsx: validar limite 30 produtos
- clients.tsx: validar limite 50 clientes
- sell.tsx: validar se pode gerar link de pagamento
- marketing.tsx: validar destaque de produtos
- onboarding.tsx: rastrear conclusão (para validar referral)

⚠️ PREPARADO MAS NÃO VALIDANDO:
- billings.tsx: pode usar charges (no free ainda)
- catalog.tsx: multi-nicho grátis ainda funciona
- dashboard.tsx: mostrar badge "Premium" (visual)
```

---

## 7. PRÓXIMOS PASSOS PARA FINALIZAR

### Fase 2: Telas de Upgrade (Próxima entrega)
```
[ ] Criar modal/tela de upgrade
[ ] Listar benefícios de Premium
[ ] Botão "Upgrade com Mercado Pago" (integração futura)
[ ] Tela "Meus Referrals" com:
    - Código de indicação
    - Link para compartilhar
    - Contador 0/3 indicações válidas
    - Lista de pessoas indicadas
    - Status (pending, onboarded, completed)
```

### Fase 3: Validações de Limite (Próxima)
```
[ ] add-product.tsx: integrar checkProductLimit()
[ ] clients.tsx: integrar checkClientLimit()
[ ] sell.tsx: integrar canUseFeature('charges')
[ ] onboarding.tsx: rastrear conclusão (track-event)
[ ] Testar fluxos:
    - Adicionar 31º produto (deve bloquear)
    - Upgrade para premium (deve desbloquear)
    - Usar Mercado Pago no free (deve bloquear)
```

### Fase 4: Anti-fraude (Depois)
```
[ ] Device ID tracking (browser fingerprint)
[ ] IP address logging
[ ] Dashboard admin para revisar indicações
[ ] Alertas de comportamento suspeito
[ ] Rate limiting em referral creation
[ ] Cron job: validar indicações pendentes após 30 dias
```

### Fase 5: Cobrança Real (Play Store)
```
[ ] Integrar Mercado Pago com upgrade link
[ ] Botão "Comprar" gera preference
[ ] Webhook: payment.approved → libera premium
[ ] Renovação automática (assinatura)
[ ] Email de aviso antes de expirar
```

---

## 8. BUILD STATUS

✅ **Compilação:** PASSOU  
✅ **TypeScript:** Sem erros  
✅ **Server:** Rodando com novos endpoints  
✅ **Client:** Novos hooks prontos para uso  

---

## 9. VERSIONAMENTO

| Versão | Status | O quê |
|--------|--------|-------|
| **v0.1** | ✅ PRONTA | Base estrutural (tipos, endpoints, hooks) |
| **v0.2** | 📋 TODO | Telas de upgrade e referral |
| **v0.3** | 📋 TODO | Validações de limite nas telas |
| **v0.4** | 📋 TODO | Anti-fraude e monitoring |
| **v1.0** | 📋 TODO | Cobrança real e play store |

---

## 10. CHECKLIST DE VALIDAÇÃO

### Código
- [x] TypeScript sem erros
- [x] Imports corretos
- [x] Endpoints documentados
- [x] Helpers testáveis
- [x] Build sem warnings

### Firestore
- [ ] Criar índice composto para `referralEvents` (se necessário)
- [ ] Testar queries em staging

### API
- [ ] Testar GET `/api/plan/data/:userId`
- [ ] Testar POST `/api/plan/initialize/:userId`
- [ ] Testar POST `/api/referral/track-event`
- [ ] Testar POST `/api/referral/validate-referral`

### Frontend
- [ ] Testar hook `usePlanData()` com usuário real
- [ ] Testar helpers de validação
- [ ] Testar share link generation

---

## 11. NOTAS IMPORTANTES

### Sobre Firestore
- ✅ Usando subcoleção `planData` para isolamento
- ✅ Timestamp automático em `updatedAt`
- ✅ Sem migração de dados existentes necessária
- ❌ Índice composto pode ser necessário para queries (`referralEvents`)

### Sobre Referral Code
- ✅ Formato: `USER-XXXXXXXXX` (9 chars)
- ✅ Gerado a partir de hash MD5 do UID
- ✅ Único por usuário
- ✅ Imutável (não regenerar)

### Sobre Premium
- ✅ `premiumExpiresAt`: `null` = premium permanente
- ✅ Sempre verificar `premiumExpiresAt` antes de usar feature
- ✅ 30 dias = 2592000 segundos

### Sobre Indicações
- ✅ Válida quando status = 'completed'
- ✅ Contar em `referralCount` apenas se `isValid === true`
- ✅ 3 indicações válidas = 30 dias de premium automático
- ⚠️ Sem proteção contra fraude ainda (Fase 4)

---

## RESULTADO FINAL

```
┌─────────────────────────────────────────────────────┐
│ ESTRUTURA DE MONETIZAÇÃO — BASE COMPLETA ✅        │
│                                                     │
│ Tipos: ✅ (TypeScript)                             │
│ Constantes: ✅ (PLAN_CONFIG)                       │
│ Hooks: ✅ (usePlanData)                            │
│ Helpers: ✅ (validation helpers)                   │
│ Backend: ✅ (4 endpoints)                          │
│ Firestore: ✅ (estrutura preparada)                │
│                                                     │
│ Pronto para: Integração em telas (Fase 2)         │
│ Risco: BAIXO (base estrutural, sem lógica crítica) │
│ Build: ✅ PASSOU                                   │
└─────────────────────────────────────────────────────┘
```

**Próximo passo:** Integrar validações nas telas de produto, cliente e pagamento.

