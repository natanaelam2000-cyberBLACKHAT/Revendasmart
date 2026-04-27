# Estrutura de Monetização RevendaSmart

**Data:** 31 de março de 2026  
**Status:** Proposta de Arquitetura  
**Objetivo:** Base estrutural para planos e referral

---

## PARTE 1: MODELO DE PLANOS

### Arquitetura de Dados

#### Tabela de Tipos de Plano
```typescript
// Não armazenar em Firestore - definir em código como constante
export const PLANS = {
  FREE: 'free',
  PREMIUM: 'premium',
} as const;

export const PLAN_CONFIG = {
  free: {
    name: 'Plano Grátis',
    price: 0,
    currency: 'BRL',
    limits: {
      products: 30,
      clients: 50,
      niches: 1, // apenas 1 nicho principal
      categories: false, // sem categorias personalizadas
      sales: true, // pode registrar vendas
      charges: false, // sem cobranças/links de pagamento
      productHighlight: false, // sem destaque
      professionalCatalog: false, // catálogo básico
      noAds: false, // com anúncios (futuros)
    },
    features: [
      'Até 30 produtos',
      'Até 50 clientes',
      'Cadastro de vendas',
      'Catálogo básico',
      '1 tipo de negócio',
      'Suporte por e-mail',
      'Ajuda e tutorial',
    ],
    color: 'bg-gray-100',
  },
  premium: {
    name: 'Plano Premium',
    price: null, // pode ser definido depois
    currency: 'BRL',
    limits: {
      products: Infinity,
      clients: Infinity,
      niches: Infinity, // multi-nicho completo
      categories: true, // categorias personalizadas
      sales: true,
      charges: true, // cobranças via Mercado Pago
      productHighlight: true, // destaque de produtos
      professionalCatalog: true, // catálogo profissional
      noAds: true, // sem anúncios
    },
    features: [
      'Produtos ilimitados',
      'Clientes ilimitados',
      'Multi-nicho completo',
      'Categorias personalizadas',
      'Cobranças e links de pagamento',
      'Destaque de produtos',
      'Catálogo profissional',
      'Futuras funções de marketing e IA',
      'Sem anúncios',
    ],
    color: 'bg-amber-50',
  },
} as const;
```

#### Documento de Plano do Usuário em Firestore
```typescript
// users/{uid}/planData
{
  currentPlan: 'free' | 'premium',
  
  // Premium ativo?
  premiumActive: boolean,
  
  // Data de expiração (se premium com data de validade)
  premiumExpiresAt: Timestamp | null,
  
  // Rastreamento de quando entrou no premium
  premiumStartedAt: Timestamp | null,
  
  // Origem do premium (direct_purchase, referral, etc)
  premiumSource: 'direct_purchase' | 'referral_reward' | 'admin' | null,
  
  // Referral info (vide PARTE 2)
  referralCode: string,
  referralCount: number,
}
```

#### Exemplo Firestore
```
/users/{uid}/planData
{
  currentPlan: "free",
  premiumActive: false,
  premiumExpiresAt: null,
  premiumStartedAt: null,
  premiumSource: null,
  referralCode: "USER-abc123xyz789",
  referralCount: 1,
}
```

---

## PARTE 2: MODELO DE REFERRAL

### Arquitetura de Dados

#### Documento de Referral do Usuário
```typescript
// users/{uid}/referralData
{
  // Código único para compartilhar
  code: string, // "USER-abc123xyz789"
  
  // Link para compartilhar (gerado dinamicamente)
  // shareLink: `https://revendasmart.vercel.app?ref=abc123xyz789`
  
  // Quem me convidou?
  referredBy: string | null, // uid de quem indicou
  
  // Indicações realizadas por mim
  referrals: {
    [refUID: string]: {
      uid: string,
      email: string,
      invitedAt: Timestamp,
      validatedAt: Timestamp | null, // quando completou onboarding
      isValid: boolean, // passou em todas as validações
      status: 'pending' | 'onboarded' | 'completed',
      // 'pending': criou conta, não entrou no app ainda
      // 'onboarded': entrou e completou onboarding básico
      // 'completed': todos os critérios atendidos
    }
  },
  
  // Contagem de indicações válidas
  validReferralCount: number,
  
  // Rewards ganhos
  rewards: {
    premiumGrants: [
      {
        grantedAt: Timestamp,
        expiresAt: Timestamp,
        days: 30,
        reason: 'referral_3_invites',
      }
    ]
  }
}
```

#### Documento de Tracking de Indicação
```typescript
// referralEvents/{eventId}
{
  // Quem foi indicado
  referredUID: string,
  referredEmail: string,
  
  // Quem indicou
  referrerUID: string,
  referrerEmail: string,
  
  // Histórico de progresso
  events: [
    {
      timestamp: Timestamp,
      event: 'account_created' | 'app_opened' | 'onboarding_completed',
      status: 'success',
    }
  ],
  
  // Status final
  status: 'pending' | 'valid' | 'fraud',
  validatedAt: Timestamp | null,
  
  // Anti-fraude
  deviceId: string,
  ipAddress: string,
  accountAge: number, // em minutos (anti-churn gaming)
}
```

---

## VALIDAÇÃO DE INDICAÇÃO VÁLIDA

### Critérios
```
1. ✅ Conta criada (webhook Firebase Auth)
2. ✅ Primeiro login realizado
3. ✅ Completou onboarding (pelo menos 1 nicho + 1 produto)
4. ✅ Respeitado anti-fraude (30 dias conta ativa, não deletada)
5. ✅ Não é auto-indicação (validar por email/phone)

Quando indicação = VÁLIDA:
→ referralCount += 1
→ Se referralCount === 3: liberar 30 dias premium
```

---

## PARTE 3: FLUXO DE UPGRADE PARA PREMIUM

### Caminho 1: Referral (3 indicações válidas)
```
Usuário faz indicação
  ↓
Pessoa indicada cria conta + onboarda
  ↓
Sistema detecta conclusão de onboarding
  ↓
referralCount += 1
  ↓
referralCount === 3 ?
  ├─ SIM: premiumExpiresAt = now() + 30 dias
  ├─ SIM: Grant email para usuário
  └─ NÃO: Esperar próximas indicações
```

### Caminho 2: Direct Purchase (futuro)
```
Usuário clica "Upgrade"
  ↓
Tela de upgrade com benefícios
  ↓
Clica "Comprar" (X reais/mês)
  ↓
Integração com Mercado Pago
  ↓
Pagamento aprovado
  ↓
premiumActive = true, premiumExpiresAt = data
```

---

## PARTE 4: LÓGICA DE LIMITES POR PLANO

### Helper de Verificação
```typescript
export function canAddProduct(
  currentPlan: 'free' | 'premium',
  productCount: number
): boolean {
  const limits = PLAN_CONFIG[currentPlan].limits;
  return productCount < limits.products;
}

export function canAddClient(
  currentPlan: 'free' | 'premium',
  clientCount: number
): boolean {
  const limits = PLAN_CONFIG[currentPlan].limits;
  return clientCount < limits.clients;
}

export function canUseFeature(
  currentPlan: 'free' | 'premium',
  feature: 'charges' | 'productHighlight' | 'categories' | 'multiNiche'
): boolean {
  const limits = PLAN_CONFIG[currentPlan].limits;
  
  switch (feature) {
    case 'charges':
      return limits.charges;
    case 'productHighlight':
      return limits.productHighlight;
    case 'categories':
      return limits.categories;
    case 'multiNiche':
      return limits.niches > 1;
    default:
      return false;
  }
}

export function isPremiumActive(planData: PlanData): boolean {
  if (planData.currentPlan === 'premium') {
    if (!planData.premiumExpiresAt) return true; // Premium permanente
    return new Date() < planData.premiumExpiresAt.toDate();
  }
  return false;
}
```

---

## PARTE 5: QUAIS TELAS/AÇÕES PRECISAM VALIDAÇÃO

### Add Product
```
✅ VALIDAR ao tentar adicionar
→ if (!canAddProduct(plan, products.length)) {
    Mostrar modal: "Limite de 30 produtos atingido"
    Botão: "Upgrade para Premium"
  }
```

### Add Client
```
✅ VALIDAR ao tentar adicionar
→ if (!canAddClient(plan, clients.length)) {
    Mostrar modal: "Limite de 50 clientes atingido"
    Botão: "Upgrade para Premium"
  }
```

### Charges/Mercado Pago
```
✅ VALIDAR ao tentar gerar link de pagamento
→ if (!canUseFeature(plan, 'charges')) {
    Mostrar aviso: "Cobranças são Premium"
    Botão: "Upgrade para Premium"
  }
```

### Multi-nicho
```
✅ VALIDAR ao tentar adicionar segundo nicho
→ if (!canUseFeature(plan, 'multiNiche')) {
    Mostrar aviso: "Multi-nicho é Premium"
    Botão: "Upgrade para Premium"
  }
```

### Categorias Personalizadas
```
✅ VALIDAR ao tentar personalizar categorias
→ if (!canUseFeature(plan, 'categories')) {
    Mostrar aviso: "Categorias personalizadas são Premium"
    Botão: "Upgrade para Premium"
  }
```

### Product Highlight
```
✅ VALIDAR ao tentar destaca produto
→ if (!canUseFeature(plan, 'productHighlight')) {
    Mostrar aviso: "Destaque é Premium"
    Botão: "Upgrade para Premium"
  }
```

### Dashboard
```
✅ MOSTRAR badge "Grátis" ou "Premium"
✅ MOSTRAR upgrade call-to-action se grátis
✅ MOSTRAR data expiração premium se premium com data
```

---

## PARTE 6: IMPLEMENTAÇÃO — O QUE FAZER AGORA

### Fase 1: Base Estrutural (Esta entrega)
- [ ] Criar tipos TypeScript de plano e referral
- [ ] Adicionar constantes PLAN_CONFIG
- [ ] Criar helpers de validação
- [ ] Adicionar planData à estrutura de usuário
- [ ] Criar hook `usePlanData()` no cliente
- [ ] Criar funções no backend para atualizar plano
- [ ] Adicionar endpoints de referral

### Fase 2: Telas de Upgrade (Próxima)
- [ ] Criar tela de upgrade modal/full-screen
- [ ] Mostrar benefícios de Premium
- [ ] Integrar com Mercado Pago (botão "Comprar")
- [ ] Tela de meus referrals (mostrar código, contador, links)

### Fase 3: Validação de Limites (Próxima)
- [ ] Integrar validação em Add Product
- [ ] Integrar validação em Add Client
- [ ] Integrar validação em Mercado Pago
- [ ] Integrar validação em Multi-nicho
- [ ] Testar todos os fluxos

### Fase 4: Anti-fraude e Monitoring (Depois)
- [ ] Implementar deviceId tracking
- [ ] Implementar IP tracking
- [ ] Dashboard admin para revisar indicações
- [ ] Alerts de comportamento suspeito

---

## ARQUIVO: IMPLEMENTAÇÃO AGORA

### Arquivos a Criar/Alterar

1. **`shared/monetization.ts`** — NOVO
   - Tipos de plano
   - Configurações PLAN_CONFIG
   - Helpers de validação
   - Constantes

2. **`client/src/hooks/usePlanData.ts`** — NOVO
   - Hook para carregar planData do Firestore
   - Método para gerar referral link
   - Método para atualizar referral count

3. **`client/src/lib/plan-helpers.ts`** — NOVO
   - Helpers no cliente para validações
   - `canAddProduct()`
   - `canAddClient()`
   - `canUseFeature()`

4. **`server/routes.ts`** — ALTERAR
   - POST `/api/user/plan-data/:userId` — criar/atualizar planData
   - POST `/api/referral/track-event` — rastrear evento de indicação
   - GET `/api/referral/validate/:userId` — validar indicações pendentes
   - POST `/api/referral/grant-premium/:userId` — liberar premium por referral

5. **`server/firebase-admin-init.ts`** — Verificar
   - Garantir acesso a Firestore para operações de plano

---

## RISCOS REMANESCENTES

1. **Fraude de Referral**
   - ⚠️ Precisa: Device ID + IP tracking
   - ⚠️ Precisa: Manual review inicial
   - ⚠️ Precisa: Rate limiting em referral creation

2. **Timeout de Premium**
   - ⚠️ Precisa: Verificar `premiumExpiresAt` toda vez que usa feature
   - ⚠️ Precisa: Renovação automática ao atingir 3 referrals
   - ⚠️ Precisa: Email de aviso antes de expirar

3. **Limite de Produtos/Clientes**
   - ⚠️ Produtos já adicionados: congelar se ultrapassar limite
   - ⚠️ Não deletar, mas impedir novo cadastro
   - ⚠️ Teste com upgrade para garantir desbloqueio

4. **Multi-nicho Premium**
   - ⚠️ Precisa: Validar ao adicionar 2º nicho
   - ⚠️ Precisa: Se upgrade, desbloquear imediatamente

---

## PRÓXIMOS PASSOS PARA FINALIZAR

### Curto Prazo (Hoje)
1. Implementar base estrutural (monetization.ts, hooks, etc)
2. Criar endpoints básicos no backend
3. Testar em staging

### Médio Prazo (Closed Testing)
1. Tela de upgrade modal
2. Tela de meus referrals
3. Integrar Mercado Pago (link de upgrade, não compra real ainda)
4. Testers validam fluxo de referral
5. Testers validam fluxo de upgrade

### Longo Prazo (Play Store)
1. Implementar cobrança real via Mercado Pago
2. Implementar renovação automática de assinatura
3. Dashboard admin para revisar indicações
4. Sistema de anti-fraude robusto

---

## DECISÕES TOMADAS

| Decisão | Motivo |
|---------|--------|
| **Firestore para plano** | Firebase é fonte de verdade, mais fácil de sincronizar |
| **PLAN_CONFIG em código** | Rápido, sem latência extra, fácil de manter |
| **Referral code = USER-hash** | Simples, único, fácil de compartilhar |
| **30 dias premium por 3 referrals** | Escalável, incentiva crescimento, alinhar ao CAC |
| **Sem cobrança real agora** | Foco em base estrutural, cobrança depois |
| **Validação em onboarding** | Anti-fraude básica, conta "ativa" após onboarding |

