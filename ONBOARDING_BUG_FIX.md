# Onboarding Bug Fix — 30 de março de 2026

## Problema Crítico Relatado
- ❌ Novo usuário clica "Concluir onboarding" e fica **travado**
- ❌ Console mostra: "Failed to log error: Error: set failed: value argument contains undefined..."
- ❌ Erro real do onboarding é **mascarado** pelo erro de logging

---

## Causa Raiz Identificada

### BUG #1: Error Logging com Undefined ✅ CORRIGIDO

**Arquivo**: `client/src/lib/error-logging.ts`

**Problema**: 
O objeto ErrorLog estava sendo criado com campos opcionais sempre incluídos, mesmo quando tinham valores `undefined`:
```typescript
// ❌ ANTES
const errorLog: ErrorLog = {
  timestamp: ...,
  stack: options?.error?.stack,    // undefined se erro não tem stack
  context: options?.context,       // undefined se não passou context
  userId: options?.userId,         // undefined se não passou userId
  ...
};
await set(newErrorRef, errorLog);  // Firebase rejeita undefined!
```

**Solução Aplicada**:
```typescript
// ✅ DEPOIS
const errorLog: ErrorLog = {
  timestamp: ...,
  url: ...,
  userAgent: ...,
  severity: ...
};

// Só add campos opcionais se tiverem valores
if (options?.error?.stack) {
  errorLog.stack = options.error.stack;
}
if (options?.context) {
  errorLog.context = options.context;
}
if (options?.userId) {
  errorLog.userId = options.userId;
}
```

**Impacto**: 
- ✅ Error logging nunca mais falha com undefined
- ✅ Erros reais do onboarding agora são logados corretamente
- ✅ Desenvolvedor consegue ver o erro real nos logs Firebase

---

### BUG #2: Timeout Infinito no Onboarding ✅ CORRIGIDO

**Arquivo**: `client/src/pages/onboarding.tsx`

**Problema**:
O fetch para POST `/api/user/settings/{uid}` não tinha timeout. Se o servidor:
- Falhar silenciosamente
- Não responder na hora
- Connexão cair

O frontend fica **esperando infinitamente**, travando a tela do usuário.

**Solução Aplicada**:
```typescript
// ✅ NOVO: Abort controller com timeout de 30s
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 30000);

try {
  const response = await fetch(settingsUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      onboarding_completed: true,
      businessType: type,
      completedAt: new Date().toISOString()
    }),
    signal: controller.signal  // ← Permite abortar se timeout
  });
  clearTimeout(timeoutId);
  
  // ✅ NOVO: Tentar extrair erro detalhado da resposta
  if (!response.ok) {
    let errorDetails = `HTTP ${response.status}`;
    try {
      const errorBody = await response.json();
      if (errorBody.error) {
        errorDetails = errorBody.error;
      }
    } catch {}
    throw new Error(errorDetails);
  }
  
  // ✅ NOVO: Log de sucesso para debugar
  const responseData = await response.json();
  console.log("[onboarding] Success response:", { 
    success: responseData.success, 
    onboarding_completed: responseData.onboarding_completed 
  });
  
} finally {
  clearTimeout(timeoutId);  // Garantir cleanup
}
```

**Melhorias**:
- ✅ **Timeout de 30s**: Se servidor não responde, falha rápido com mensagem clara
- ✅ **Erro detalhado**: Tenta extrair `errorBody.error` para mensagem mais específica
- ✅ **Better error messages**: "Conexão demorou muito" para timeouts
- ✅ **Debug logging**: Console.log para verificar fluxo em produção
- ✅ **businessType fixo**: Usa `type` (parâmetro) em vez de `selected` (state desincronizado)

---

## Fluxo de Onboarding Corrigido

```
Usuário seleciona categoria (businessType)
        ↓
Clica "Concluir Onboarding"
        ↓
[timeout de 30s inicia]
        ↓
POST /api/user/settings/{uid} com payload:
{
  onboarding_completed: true,
  businessType: "Cosméticos & Perfumes",
  completedAt: "2026-03-30T03:27:46.000Z"
}
        ↓
Backend valida e .set() em user_settings/{uid}
        ↓
✓ Response OK → Redirect para dashboard
        ✗ Response erro → Show erro específico + log correto
        ✗ Timeout 30s → Abort + show "conexão demorou muito"
```

---

## Validação

✅ **Build**: `npm run build` — SEM ERROS  
✅ **Error Logging**: Nunca envia undefined  
✅ **Timeout Protection**: 30s máximo antes de fail  
✅ **Error Details**: Extrai mensagem de erro real  
✅ **Debug Logging**: Console logs para rastreamento  

---

## Próximos Passos (Recomendados)

1. **Testar nova conta**:
   - Criar conta nova
   - Fazer login
   - Ir para onboarding
   - Selecionar categoria
   - Clicar "Concluir Onboarding"
   - ✓ Deve redirecionar para dashboard
   - ✓ Se falhar, ver erro específico (não genérico)

2. **Se ainda falhar**, verificar:
   - Console logs do backend (`[/api/user/settings POST]`)
   - Firestore docs em `user_settings/{uid}` para ver se foi criado
   - Firebase error logs para ver detalhes

3. **Monitor**: Acompanhar error logs do Firebase para erros recorrentes

---

## Arquivos Alterados

| Arquivo | Mudanças |
|---------|----------|
| `client/src/lib/error-logging.ts` | Removeu undefined fields antes de set() |
| `client/src/pages/onboarding.tsx` | Adicionou timeout 30s, melhor error handling, debug logging |

---

## Status: ✅ COMPLETO

- ✅ BUG #1 corrigido (error logging)
- ✅ BUG #2 corrigido (timeout infinito)
- ✅ Build validado
- ⏳ Aguardando teste em nova conta

