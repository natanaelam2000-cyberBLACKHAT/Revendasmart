# FASE 3 — PREPARAÇÃO PARA MIGRAÇÃO DE DADOS LEGADOS

## Status: PREPARATION MODE (Sem execução automática)

Esta fase prepara a infraestrutura para migrar dados do localStorage/IndexedDB para Firebase Firestore/Storage.

**IMPORTANTE:** Nenhuma migração é executada automaticamente. Todos os endpoints estão em modo "preparation" — safe to call, sem alterações nos dados.

---

## O que foi implementado

### 1. Server-side Utilities

#### `server/migration-helpers.ts`
Funções de validação de integridade de dados:
- `validateProduct()` — Valida estrutura de produto
- `validateClient()` — Valida estrutura de cliente
- `validateSale()` — Valida venda + referências a products/clients
- `validateInstallment()` — Valida parcela + referência a sale
- `validatePost()` — Valida post agendado + referência a product
- `findDuplicateIds()` — Detecta IDs duplicados em todos os dados
- `findOrphanedImages()` — Detecta imagens sem produto associado
- `generateMigrationStatus()` — Gera relatório completo de validação

#### `server/firebase-storage-migration.ts`
Preparação para upload de imagens:
- `checkStorageReadiness()` — Verifica se Firebase Storage está pronto (DRY RUN)
- `prepareImageUpload()` — Valida base64 sem fazer upload (DRY RUN)
- `generateExpectedDownloadUrl()` — Gera URL esperada (estrutura)
- `validateFirebaseStorageSetup()` — Valida configuração Firebase (DRY RUN)

### 2. Client-side Utilities

#### `client/src/lib/migration-utils.ts`
Funções seguras para ler dados legados (sem modificar):
- `readProductsFromStorage()` — Lê produtos de localStorage
- `readClientsFromStorage()` — Lê clientes de localStorage
- `readSalesFromStorage()` — Lê vendas de localStorage
- `readInstallmentsFromStorage()` — Lê parcelas de localStorage
- `readPostsFromStorage()` — Lê posts de localStorage
- `readSettingsFromStorage()` — Lê settings de localStorage
- `listImagesFromIndexedDB()` — Lista IDs de imagens no IndexedDB
- `readImageFromIndexedDB()` — Lê imagem específica (base64)
- `readAllImagesFromIndexedDB()` — Lê todas as imagens
- `estimateLegacyDataSize()` — Calcula tamanho total de dados antigos
- `summarizeLegacyData()` — Gera resumo de tudo

#### `client/src/lib/migration-client.ts`
Cliente API para chamar endpoints:
- `validateLegacyData()` — Chama endpoint de validação (DRY RUN)
- `checkMigrationReadiness()` — Verifica se tudo está pronto
- `MIGRATION_ENDPOINTS` — Mapa dos endpoints disponíveis
- `getMigrationEndpointStatus()` — Status de cada endpoint

#### `client/src/hooks/useMigrationStatus.ts`
Hook React para acompanhar status:
- `useMigrationStatus()` — Obtém status da migração (safe to use)

### 3. API Endpoints (Preparation Mode)

Todos os endpoints requerem autenticação (`requireAuth`) e ownership (`requireOwnership`).

#### `GET /api/user/migration-status/:userId`
Retorna status de preparação da migração.
```
Response:
{
  "ready": boolean,
  "firebaseSetup": {
    "projectId": string,
    "bucket": string,
    "valid": boolean
  },
  "firestore": {
    "hasSettings": boolean
  },
  "message": string,
  "dryRunAvailable": boolean,
  "nextStep": string
}
```

#### `POST /api/user/data/validate/:userId` (DRY RUN)
Valida integridade de dados sem fazer mudanças.
```
Request:
{
  "data": {
    "products": Product[],
    "clients": Client[],
    "sales": Sale[],
    "installments": Installment[],
    "posts": ScheduledPost[],
    "imageIds": string[]
  }
}

Response:
{
  "success": boolean,
  "validation": {
    "phase": string,
    "counts": {...},
    "errors": string[],
    "pending": {...},
    "integrity": {...}
  },
  "message": string,
  "dryRun": true
}
```

#### Endpoints em Preparation Mode (não ativados):
- `POST /api/user/images/migrate/:userId` — (202 Accepted, não implementado)
- `POST /api/user/products/migrate/:userId` — (202 Accepted, não implementado)
- `POST /api/user/clients/migrate/:userId` — (202 Accepted, não implementado)
- `POST /api/user/sales/migrate/:userId` — (202 Accepted, não implementado)
- `POST /api/user/installments/migrate/:userId` — (202 Accepted, não implementado)
- `POST /api/user/posts/migrate/:userId` — (202 Accepted, não implementado)

---

## Como usar (Modo Preparação)

### No Console do Navegador

```javascript
// 1. Importar utilitários
import { 
  readProductsFromStorage,
  readClientsFromStorage,
  readAllImagesFromIndexedDB,
  summarizeLegacyData
} from '/src/lib/migration-utils.ts';

import { 
  validateLegacyData,
  checkMigrationReadiness
} from '/src/lib/migration-client.ts';

// 2. Obter ID do usuário
const userId = localStorage.getItem('rs:session');

// 3. Resumir dados antigos
const summary = await summarizeLegacyData(userId);
console.log('Legacy data:', summary);

// 4. Ler todos os dados
const products = await readProductsFromStorage(userId);
const clients = await readClientsFromStorage(userId);
const images = await readAllImagesFromIndexedDB();

// 5. Validar integridade (DRY RUN)
const validation = await validateLegacyData(userId, {
  products,
  clients,
  sales: await readSalesFromStorage(userId),
  installments: await readInstallmentsFromStorage(userId),
  posts: await readPostsFromStorage(userId),
  imageIds: Object.keys(images)
});

console.log('Validation result:', validation);

// 6. Verificar se está pronto
const readiness = await checkMigrationReadiness(userId);
console.log('Migration ready:', readiness);
```

### Em um Componente React

```typescript
import { useMigrationStatus } from '@/hooks/useMigrationStatus';
import { validateLegacyData } from '@/lib/migration-client';
import { summarizeLegacyData } from '@/lib/migration-utils';

export function MigrationStatus() {
  const status = useMigrationStatus();
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    const loadSummary = async () => {
      const userId = getCurrentUserId();
      const data = await summarizeLegacyData(userId);
      setSummary(data);
    };
    loadSummary();
  }, []);

  if (status.loading) return <div>Checking migration status...</div>;
  if (status.error) return <div>Error: {status.error}</div>;

  return (
    <div>
      <h3>Migration Status</h3>
      <p>Firebase Setup: {status.firebaseSetup.valid ? '✅' : '❌'}</p>
      <p>Firestore Ready: {status.firestore.hasSettings ? '✅' : '❌'}</p>
      <p>Message: {status.message}</p>
      {summary && (
        <div>
          <h4>Legacy Data Summary:</h4>
          <pre>{JSON.stringify(summary, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
```

---

## Fluxo de Validação (DRY RUN)

```
1. User abre Console (F12)
2. Importa migration-utils
3. Lê todos os dados: readProductsFromStorage(), etc
4. Chama validateLegacyData() com os dados
5. Recebe relatório de integridade
6. Verifica "validation.integrity.errors"
7. Se ok, está pronto para migração real
8. Se não ok, corrige os dados antes de migrar
```

---

## O que está seguro fazer AGORA

✅ Chamar `GET /api/user/migration-status/:userId` — apenas lê status
✅ Chamar `POST /api/user/data/validate/:userId` — apenas valida (DRY RUN)
✅ Usar `migration-utils.ts` — apenas lê localStorage/IndexedDB
✅ Usar `useMigrationStatus` hook — apenas lê status
✅ Examinar dados com DevTools Console — nenhuma mudança

## O que NÃO está pronto AINDA

❌ Não fazer upload de imagens automaticamente
❌ Não migrar produtos para Firestore automaticamente
❌ Não deletar localStorage
❌ Não limpar IndexedDB
❌ Não chamar endpoints `/migrate/` (retornam 202, não implementados)

---

## Próximas Fases (Quando você estiver pronto)

### Fase 3A — Imagens
- Implementar upload real para Firebase Storage
- POST /api/user/images/migrate será ativado
- Executará: Read IndexedDB → Upload Storage → Salvar URL em Firestore

### Fase 3B — Produtos + Clientes
- Implementar migração Firestore
- POST /api/user/products/migrate será ativado
- POST /api/user/clients/migrate será ativado

### Fase 3C — Vendas + Parcelas
- Implementar com validação de referências
- POST /api/user/sales/migrate será ativado
- POST /api/user/installments/migrate será ativado

### Fase 3D — Posts Agendados
- Implementar migração final
- POST /api/user/posts/migrate será ativado

### Fase 3E — Limpeza
- Remover localStorage (após confirmação)
- Limpar IndexedDB (após confirmação)

---

## Arquivos Criados

```
server/
  ├─ migration-helpers.ts (novo)
  ├─ firebase-storage-migration.ts (novo)
  └─ routes.ts (modificado — adicionados endpoints)

client/src/
  ├─ lib/
  │  ├─ migration-utils.ts (novo)
  │  └─ migration-client.ts (novo)
  └─ hooks/
     └─ useMigrationStatus.ts (novo)

Documentação:
  └─ FASE3_PREPARATION.md (este arquivo)
```

---

## Importante

- **localStorage e IndexedDB não foram tocados** — Tudo intacto
- **Nenhuma execução automática** — Tudo é manual/controlled
- **Modo DRY RUN** — Validações sem mudanças
- **Seguro de usar** — Endpoints apenas retornam status/validação
- **Pronto para Fase 2 validation manual** — Nada muda o app principal

---

## Checklist para Fase 3 Real (Quando iniciar)

- [ ] Fase 2 validação manual concluída (4 cenários com token real)
- [ ] `migration-utils.ts` testado e funcionando
- [ ] Dados legados validados com `validateLegacyData()`
- [ ] Nenhum erro de integridade detectado
- [ ] Backup dos dados (se necessário)
- [ ] Backup do localStorage (console: `localStorage`)
- [ ] Backup do IndexedDB (DevTools → Application → IndexedDB)
- [ ] Iniciar Fase 3A (imagens) quando aprovado
