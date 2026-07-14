# Server-Side Search — Sprint 17

## Problema atual

Produtos e catálogo ainda preservam busca local para compatibilidade. Isso funciona em lojas pequenas, mas carregar N produtos para filtrar no cliente escala mal.

## Estratégia escolhida

Busca server-side de produtos preparada, mas desligada por padrão:

```text
input do usuário
  -> normalizeProductSearchText / normalizeProductBarcode
  -> buildProductServerSearchPlan
  -> consulta Firestore limitada
  -> paginação por cursor
  -> dedupe e ordenação estável no cliente
  -> fallback local quando a flag está desligada
```

`SERVER_SIDE_PRODUCT_SEARCH_ENABLED=false` mantém o comportamento atual.

## Telas auditadas

- Produtos: usa `usePaginatedProductsData()` para primeira página e filtra localmente a página carregada.
- Catálogo interno: usa `useProductsData()` e filtra localmente a coleção já carregada.
- Venda: usa pickers paginados e filtro local na página carregada.
- Clientes: tem paginação, mas busca por telefone/nome ainda local e não foi migrada para evitar indexar PII.
- Cobranças/vendas/marketing: fora do escopo da Sprint 17.

## Limitações reais do Firestore

Firestore não oferece full-text search nativo. Esta sprint não tenta simular Algolia. Estratégias permitidas:

- código de barras: igualdade em `barcodeNormalized`;
- termo único: prefixo em `nameNormalized`;
- múltiplas palavras: `array-contains` em `searchTokens`, limitado;
- termo curto: fallback/local ou mensagem de termo curto;
- filtro de categoria: igualdade em `categoryNormalized`, somente quando a categoria normalizada não está vazia e não é `todos`.

## Consultas preparadas

Todas as consultas server-side preparadas ordenam por `nameNormalized`. Os campos originais `name` e `category` continuam sendo usados somente para exibição e compatibilidade local.

| Tipo | Filtros Firestore | Ordenação | Índice composto |
| --- | --- | --- | --- |
| Prefixo sem categoria | range `startAt/endAt` em `nameNormalized` | `nameNormalized ASC` | índice simples automático |
| Prefixo com categoria | `categoryNormalized == valor` + range em `nameNormalized` | `nameNormalized ASC` | `categoryNormalized ASC, nameNormalized ASC` |
| Token sem categoria | `searchTokens array-contains token` | `nameNormalized ASC` | `searchTokens CONTAINS, nameNormalized ASC` |
| Token com categoria | `categoryNormalized == valor` + `searchTokens array-contains token` | `nameNormalized ASC` | `categoryNormalized ASC, searchTokens CONTAINS, nameNormalized ASC` |
| Código sem categoria | `barcodeNormalized == valor` | `nameNormalized ASC` | `barcodeNormalized ASC, nameNormalized ASC` |
| Código com categoria | `categoryNormalized == valor` + `barcodeNormalized == valor` | `nameNormalized ASC` | `categoryNormalized ASC, barcodeNormalized ASC, nameNormalized ASC` |
| Listagem sem categoria | sem filtro | `nameNormalized ASC` | índice simples automático |
| Listagem com categoria | `categoryNormalized == valor` | `nameNormalized ASC` | `categoryNormalized ASC, nameNormalized ASC` |

A paginação usa cursor por `DocumentSnapshot`. O cursor é reiniciado quando termo, categoria ou plano de busca muda.

## Rollout

```text
flag desligada
  -> testes puros
  -> fixture grande
  -> Emulator
  -> backfill sintético
  -> tenant interno
  -> comparação local vs server-side
  -> beta fechado
```

Nenhuma etapa remota foi ativada nesta sprint.
