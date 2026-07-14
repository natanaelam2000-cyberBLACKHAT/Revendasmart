# Search Backfill — Sprint 17

## Script

```bash
npx tsx scripts/search/backfill-search-fields.ts \
  --fixture \
  --uid synthetic-user \
  --project demo-revendasmart \
  --environment emulator \
  --dry-run
```

## Proteções

Bloqueia:

- `production`;
- `prod`;
- `revenda-smart`;
- `revendasmart-prod`;
- `revendasmart-backend-prod`;
- `FIREBASE_CONFIG` apontando para projeto real;
- `GCLOUD_PROJECT`/`GOOGLE_CLOUD_PROJECT` real;
- `--apply` sem `FIRESTORE_EMULATOR_HOST`.

## Escopo desta sprint

O script processa fixture sintética/local. Não conecta no Firebase real e não executa backfill em produção.

## Métricas reportadas

- analisados;
- já atualizados;
- precisam atualizar;
- parciais;
- ausentes;
- schema futuro;
- schema legado;
- erros;
- próximo cursor;
- IDs técnicos truncados.

## Rollback

Campos derivados podem permanecer nos documentos. Para voltar ao comportamento anterior, desligar `SERVER_SIDE_PRODUCT_SEARCH_ENABLED`.


## Validação antes de ativar a flag

Antes de ligar `SERVER_SIDE_PRODUCT_SEARCH_ENABLED`, validar que o backfill gerou corretamente:

- `nameNormalized` em todos os produtos elegíveis;
- `categoryNormalized` coerente com `category` exibida;
- `barcodeNormalized` preservando zeros à esquerda;
- `searchTokens` limitado e sem PII;
- `searchSchemaVersion` igual ao schema atual.

Também validar no Emulator/staging as combinações:

- prefixo sem categoria;
- prefixo com categoria;
- token sem categoria;
- token com categoria;
- código de barras sem categoria;
- código de barras com categoria;
- listagem padrão sem categoria;
- listagem padrão com categoria.

Não fazer deploy dos índices nem executar backfill real nesta etapa.
