# Firestore Analytics Aggregates — desenho técnico seguro

Esta sprint não implementa agregados persistidos porque isso exigiria política clara de consistência, rebuild e atualização backend-only. O objetivo aqui é deixar o desenho para a próxima fase sem criar writes frágeis no frontend.

## Princípios

- O documento de venda continua sendo a fonte da verdade financeira.
- Agregados devem ser atualizados pelo backend, nunca por código confiável apenas no cliente.
- Toda atualização precisa ser idempotente e tolerar retry/webhook/evento duplicado.
- Rebuild deve ser possível a partir das coleções fonte.
- Agregados devem ter `schemaVersion`, `updatedAt` e, quando necessário, marcador de origem/rebuild.
- Firestore Rules devem impedir escrita direta pelo usuário em campos financeiros agregados.

## Estrutura proposta

### Resumo global por usuário

`users/{uid}/analytics/summary/main`

Campos candidatos:

- `totalRevenue`
- `totalProfit`
- `totalSales`
- `averageTicket`
- `activeClients`
- `totalProducts`
- `lowStockCount`
- `outOfStockCount`
- `updatedAt`
- `schemaVersion`

### Agregados mensais

`users/{uid}/analytics/monthly/{yyyy-MM}`

Campos candidatos:

- `revenue`
- `profit`
- `salesCount`
- `itemsSold`
- `averageTicket`
- `categoryTotals`
- `brandTotals`
- `topProducts`
- `topClients`
- `updatedAt`
- `schemaVersion`

### Agregados por cliente

`users/{uid}/clientAnalytics/{clientId}`

Campos candidatos:

- `totalSpent`
- `purchaseCount`
- `averageTicket`
- `firstPurchaseAt`
- `lastPurchaseAt`
- `favoriteCategories`
- `favoriteBrands`
- `favoriteProducts`
- `updatedAt`
- `schemaVersion`

## Estratégia de atualização recomendada

1. Criar função backend/job autorizado para processar criação/alteração/cancelamento de venda.
2. Registrar `processedEventId` ou hash de mudança para idempotência.
3. Atualizar agregados com transação/batch.
4. Criar comando de rebuild por usuário para suporte/incidente.
5. Bloquear escrita client-side em `analytics/*` e `clientAnalytics/*` nas Rules.
6. Validar Dashboard/Reports em modo híbrido: usar agregado quando existir, fallback para cálculo atual quando ausente.

## Riscos que impedem implementar tudo nesta sprint

- Venda editada/excluída exige delta reversível.
- Dados antigos precisam de rebuild controlado.
- Relatórios/exportações precisam bater exatamente com tela.
- Atualização por frontend poderia causar divergência financeira ou abuso de custo.
- Rules e testes de emulator precisam acompanhar novas coleções.

## Próxima etapa segura

Implementar primeiro agregados mensais read-only com fallback, em ambiente controlado, usando backend-only e testes de idempotência antes de substituir KPIs principais.
