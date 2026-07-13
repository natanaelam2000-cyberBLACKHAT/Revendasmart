# Product Search Index Backfill — plano seguro

Este documento prepara a transição do catálogo interno para busca server-side paginada sem executar migração automática em produção.

## Estado atual

- Produtos novos e produtos editados passam a receber campos derivados de busca (`nameNormalized`, `brandNormalized`, `categoryNormalized`, `barcodeNormalized`, `productTypeNormalized`, `searchTokens`, `searchSchemaVersion`).
- Produtos antigos podem não ter esses campos.
- A flag `CATALOG_SERVER_SEARCH_ENABLED` permanece `false`, então o catálogo interno continua usando a busca local completa atual.
- Nenhum backfill foi executado nesta sprint.

## Por que não ativar imediatamente

Firestore não possui busca full-text nativa. Consultas com `array-contains` encontram tokens exatos, não substrings arbitrárias nem ranking textual. Se o catálogo passasse a usar apenas `searchTokens`, produtos legados sem índice poderiam desaparecer dos resultados.

## Script futuro recomendado

Criar um script administrativo, nunca frontend, com as seguintes propriedades:

1. `--dry-run` obrigatório por padrão.
2. Autenticação via credencial administrativa autorizada, sem secrets no Git.
3. Paginação por usuário e por coleção `products`.
4. Batches pequenos e idempotentes.
5. Atualizar somente documentos sem `searchSchemaVersion` atual ou com campos divergentes.
6. Escrever os campos derivados usando o mesmo helper de normalização do app ou uma cópia server-side testada.
7. Rate limit entre batches para controlar custo.
8. Resume token ou checkpoint para continuar após falha.
9. Logs seguros sem nome completo de produto, UID completo ou payload completo.
10. Relatório de cobertura por usuário: total, indexados, pendentes, falhas.

## Validação de cobertura

Antes de ativar a busca server-side:

- Cobertura de produtos indexados deve estar próxima de 100% para as contas testadas.
- Amostras manuais devem comparar resultados da busca local legada versus busca server-side.
- Termos com acentos, marcas, categorias e código de barras devem ser validados.
- Produtos sem estoque e filtros do catálogo devem manter comportamento esperado.

## Índice Firestore futuro provável

Se o hook paginado for ativado com busca por token e ordenação por nome, provavelmente será necessário um índice composto para `products` com:

- `searchTokens` em modo `array-contains`;
- `name` ascendente.

Se o filtro por categoria for combinado à busca, outro índice pode ser necessário:

- `searchTokens` em modo `array-contains`;
- `category` ascendente;
- `name` ascendente.

Não criar dezenas de índices especulativos. Criar somente depois de confirmar a query real usada em homologação.

## Rollback

- Como os campos são derivados, rollback funcional é manter `CATALOG_SERVER_SEARCH_ENABLED=false`.
- Não apagar campos indexados em massa.
- Se uma versão de schema nova for necessária, incrementar `searchSchemaVersion` e revalidar em dry-run.

## Proibições

- Não executar em produção sem aprovação explícita.
- Não executar sem dry-run inicial.
- Não rodar como usuário comum ou pelo frontend.
- Não imprimir secrets.
- Não imprimir payloads completos.
- Não mascarar cobertura parcial como resultado completo.
