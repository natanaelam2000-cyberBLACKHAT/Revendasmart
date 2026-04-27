# Plan de Eliminação de localStorage Fallback

**Data**: 30 de março de 2026  
**Objetivo**: Eliminar localStorage como fonte paralela de dados e garantir fonte única de verdade (Firebase/Firestore)

---

## A. DIAGNÓSTICO COMPLETO

### Arquivos que Usam getStored (localStorage fallback)

| Arquivo | Tipo | Uso Principal | Necessidade |
|---------|------|---|---|
| `billings.tsx` | Página | `SETTINGS` como fallback | ⚠️ ALTO |
| `marketing.tsx` | Página | `POSTS`, `SETTINGS` | ⚠️ ALTO |
| `public-catalog.tsx` | Página | `SETTINGS` como fallback | ⚠️ ALTO |
| `settings.tsx` | Página | Backup/Export CSV | 🔴 CRÍTICO |
| `client-detail.tsx` | Página | `SETTINGS` fallback | ⚠️ ALTO |
| `billing-calendar.tsx` | Página | `SETTINGS` fallback | ⚠️ ALTO |
| `reports.tsx` | Página | `SETTINGS`, `SALES` | ⚠️ ALTO |
| `social.tsx` | Página | `SETTINGS` fallback | ⚠️ ALTO |
| `layout.tsx` | Componente | Verificação de admin | 🟡 MÉDIA |
| `mock-data.ts` | Utilitário | Define helpers | N/A |

### Total de Referências localStorage: **117** (em 10 arquivos)

---

## B. PADRÕES IDENTIFICADOS

### Padrão 1: Settings Fallback

```typescript
// ❌ ANTES (localStorage fallback)
const [settings] = useState(() => getStored(STORAGE_KEYS.SETTINGS, defaultSettings));

// ✅ DEPOIS (Firestore real)
const { settings } = useUserSettings();
const displaySettings = settings || defaultSettings;
```

**Localidades**:
- billings.tsx:22
- marketing.tsx:31
- public-catalog.tsx
- client-detail.tsx
- billing-calendar.tsx
- reports.tsx
- social.tsx

**Impacto**: Settings podem estar desincronizados entre Firestore e localStorage

### Padrão 2: Data Export (Necessário Manter)

```typescript
// ⚠️ ESPECIAL: Backup/Export CSV
const exportCSV = () => {
  const data = getStored(STORAGE_KEYS.CLIENTS, []);  // ← Lê localStorage para backup
  // ...
}
```

**Localidades**:
- settings.tsx (para export de dados antigos)
- reports.tsx (para relatórios locais)

**Impacto**: Pode ser necessário manter como fallback para dados históricos

---

## C. DEPENDÊNCIAS DE CADA PÁGINA

### 🔴 CRÍTICO: settings.tsx
- Usa: `CLIENTS`, `PRODUCTS`, `SALES`, `INSTALLMENTS` para Export CSV
- Propósito: Backup de dados antigos para usuário
- **Ação**: Manter como fallback para compatibilidade com dados históricos

### 🟡 ALTA: billings.tsx
- Usa: `SETTINGS` como fallback
- Propósito: Mostrar configurações do usuário
- **Ação**: Substituir por `useUserSettings()`

### 🟡 ALTA: marketing.tsx
- Usa: `POSTS`, `SETTINGS`
- Propósito: Posts agendados + settings
- **Ação**: Substituir settings por `useUserSettings()`; posts → Firestore (não localStorage)

### 🟡 ALTA: public-catalog.tsx
- Usa: `SETTINGS` para ativar catálogo
- Propósito: Mostrar catálogo público
- **Ação**: Substituir por `useUserSettings()`

---

## D. IMPACTO: ONDE LOCALSTORAGE CONFLITA COM FIRESTORE

### 1. **Settings Desincronizado**
```javascript
// Problema:
User edita businessType no Settings (vai para Firestore)
Mas add-product.tsx estava usando defaultSettings (localStorage)
→ Categorias não atualizam até recarregar página

// Solução:
Todas as páginas usarem useUserSettings() hook
Hook subscreveLembr Firestore em tempo real
```

### 2. **Dados Históricos Perdidos**
```javascript
// Se remover getStored() de uma só vez:
Usuários que tinham dados APENAS em localStorage perdem tudo
Não há migração

// Solução:
Manter getStored() como fallback por 1-2 sprints
Documentar migração para Firestore
Noticar usuários
```

### 3. **CSV Export Quebrado**
```javascript
// Problema:
export CSV lê de localStorage
Se usuário migrou para Firestore, CSV fica vazio

// Solução:
CSV export deve ler de Firestore (onde estão os dados reais)
Fallback para localStorage apenas se Firestore vazio
```

---

## E. PLANO DE ELIMINAÇÃO (Faseado)

### FASE 1: Settings Fallback (HOJE) — 30 min
Substituir `getStored(SETTINGS)` por `useUserSettings()` em:
- [ ] billings.tsx
- [ ] marketing.tsx
- [ ] public-catalog.tsx
- [ ] client-detail.tsx
- [ ] billing-calendar.tsx
- [ ] reports.tsx
- [ ] social.tsx

**Risco**: BAIXO — hook já funciona em tempo real

### FASE 2: CSV Export (Firestore Priority) — TODO
Atualizar export CSV em settings.tsx para:
- Ler PRIMEIRO de Firestore
- Fallback para localStorage se vazio

### FASE 3: Documentação (TODO)
- Atualizar replit.md sobre mudança
- Remover referências a localStorage fallback
- Documentar que fonte única é Firestore

### FASE 4: Deprecação (Futuro)
- Adicionar aviso deprecation em getStored()
- Remover após 2 sprints de avisos
- Audit log de quem ainda usa

---

## F. ARQUIVO A MANTER FUNCIONAL

**mock-data.ts** — Continua como utilitário, mas:
- ❌ Não use getStored() em componentes novos
- ✅ Pode continuar existindo para compatibilidade com código antigo
- 🔄 Refatorar gradualmente para remover dependência

---

## G. CHECKLIST DE IMPLEMENTAÇÃO

### FASE 1 (Hoje)
- [ ] Corrigir add-product.tsx → useUserSettings() ✅ FEITO
- [ ] billings.tsx → remover getStored(SETTINGS)
- [ ] marketing.tsx → remover getStored(SETTINGS)
- [ ] public-catalog.tsx → remover getStored(SETTINGS)
- [ ] client-detail.tsx → remover getStored(SETTINGS)
- [ ] billing-calendar.tsx → remover getStored(SETTINGS)
- [ ] reports.tsx → remover getStored(SETTINGS)
- [ ] social.tsx → remover getStored(SETTINGS)
- [ ] Build validação
- [ ] Teste em navegador

### FASE 2 (Depois)
- [ ] Atualizar CSV export em settings.tsx
- [ ] Testar export com dados Firestore
- [ ] Remover referências localStorage em documentação

---

## H. BENEFÍCIOS PÓS-ELIMINAÇÃO

| Aspecto | Antes | Depois |
|---------|-------|--------|
| **Fonte de Verdade** | Dual (localStorage + Firestore) | Única (Firestore) |
| **Consistência** | Pode desincronizar | Garantida (real-time) |
| **Rastreabilidade** | Sem auditoria localStorage | Auditável no Firestore |
| **Migração** | Complexa (dados separados) | Simples (tudo em um lugar) |
| **Produção** | Risco de dados inconsistentes | Seguro |
| **Conformidade** | Difícil validar | Fácil (LGPD, privacidade) |

---

## I. RISCO REMANESCENTE

### ⚠️ Risco 1: Dados Históricos em localStorage
- **Impacto**: Users antigos podem perder dados se apenas em localStorage
- **Mitigação**: Manter getStored() como fallback por 2+ sprints; notificar usuários

### ⚠️ Risco 2: CSV Export
- **Impacto**: Export pode ficar vazio se mudar para Firestore-only
- **Mitigação**: Implementar fallback em settings.tsx

### ⚠️ Risco 3: Modo Offline
- **Impacto**: localStorage ajudava em offline; Firestore também suporta offline
- **Mitigação**: Service Worker + Firestore offline mode

---

**STATUS**: ✅ PLANO PRONTO PARA EXECUÇÃO

Próximo passo: Implementar Fase 1 (remover getStored SETTINGS de 7 páginas)

