# Search Data Model — Sprint 17

## Schema

`PRODUCT_SEARCH_SCHEMA_VERSION = 1`

Campos derivados em `users/{uid}/products/{productId}`:

- `nameNormalized`
- `brandNormalized`
- `categoryNormalized`
- `barcodeNormalized`
- `productTypeNormalized`
- `searchTokens`
- `searchSchemaVersion`

## Normalização

Normalização textual:

- lowercase;
- remoção de acentos;
- remoção de pontuação;
- normalização de espaços;
- limite de tamanho;
- compatível com português do Brasil.

Exemplos:

- `Perfume Águas de Verão` -> `perfume aguas de verao`
- `JOÃO` -> `joao`
- `Kit 2-em-1` -> `kit 2 em 1`

Código de barras:

- preservado como string;
- zeros à esquerda preservados;
- não convertido para número.

## Tokens

`searchTokens` é limitado:

- máximo 16 tokens;
- máximo 48 caracteres por token;
- deduplicado;
- sem PII;
- inclui barcode apenas quando presente.

## Compatibilidade

Documentos antigos podem estar:

- `missing`;
- `partial`;
- `legacy_schema`;
- `future_schema`;
- `indexed`.

A busca local permanece como fallback até o backfill ser homologado.


## Uso nas consultas

A busca server-side preparada usa somente campos derivados normalizados:

- `nameNormalized` para ordenação determinística e busca por prefixo;
- `categoryNormalized` para filtro de categoria;
- `barcodeNormalized` para busca exata por código de barras;
- `searchTokens` para busca por token limitado.

Campos originais como `name`, `category`, `brand` e `barcode` continuam preservados para exibição e compatibilidade. Eles não devem ser usados nas consultas server-side preparadas porque misturam acentos, maiúsculas/minúsculas e variações de espaçamento.

## Índices esperados

- `searchTokens CONTAINS, nameNormalized ASC`
- `barcodeNormalized ASC, nameNormalized ASC`
- `categoryNormalized ASC, nameNormalized ASC`
- `categoryNormalized ASC, searchTokens CONTAINS, nameNormalized ASC`
- `categoryNormalized ASC, barcodeNormalized ASC, nameNormalized ASC`
