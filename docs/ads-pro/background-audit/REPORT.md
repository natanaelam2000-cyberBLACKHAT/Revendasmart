# Auditoria da biblioteca de fundos — Ads Pro

Gerado por `script/ads-pro-background-audit.ts`. O acervo bruto não é alterado.

## Resumo

| Métrica | Valor |
|---|---|
| SOURCE_BACKGROUND_COUNT | 309 |
| EXACT_DUPLICATES | 4 |
| VISUAL_DUPLICATES | 4 |
| CORRUPTED_FILES | 0 |
| LOW_RESOLUTION | 0 |
| INVALID_ASPECT_RATIO | 0 |
| VALID_BACKGROUNDS | 300 |
| REJECTED_BACKGROUNDS | 9 |
| Entradas no inventory.json | 309 |
| Inventário apontando para arquivo inexistente | 0 |
| Arquivos fora do inventário | 0 |

## Válidos por categoria

| Categoria | Quantidade |
|---|---|
| Doces | 2 |
| Alimentos | 26 |
| Eletrônicos | 29 |
| Cosméticos e perfumes | 68 |
| Roupas | 49 |
| Acessórios | 16 |
| Papelaria | 7 |
| Casa e decoração | 51 |
| Utilidades | 7 |
| Geral / outros | 45 |

Aprovados sem dica de categoria (caíram em geral/outros por falta de evidência): 45.

## Cobertura por categoria

| CATEGORY | SOURCE | VALID | REJECTED | ELIGIBLE_FOR_PUBLICATION |
|---|---:|---:|---:|---:|
| doces | 2 | 2 | 0 | 2 |
| alimentos | 29 | 26 | 3 | 26 |
| eletronicos | 29 | 29 | 0 | 29 |
| cosmeticos-perfumes | 68 | 68 | 0 | 68 |
| roupas | 52 | 49 | 3 | 49 |
| acessorios | 16 | 16 | 0 | 16 |
| papelaria | 7 | 7 | 0 | 7 |
| casa-decoracao | 51 | 51 | 0 | 51 |
| utilidades | 7 | 7 | 0 | 7 |
| geral | 48 | 45 | 3 | 45 |

## Cobertura por estilo

| STYLE | SOURCE | VALID | REJECTED | ELIGIBLE_FOR_PUBLICATION |
|---|---:|---:|---:|---:|
| luxury | 77 | 74 | 3 | 74 |
| editorial | 28 | 27 | 1 | 27 |
| minimal | 18 | 18 | 0 | 18 |
| sensory | 79 | 76 | 3 | 76 |
| modern | 107 | 105 | 2 | 105 |

## Rejeitados por motivo

| Motivo | Quantidade |
|---|---|
| manual-curation | 1 |
| visual-duplicate | 4 |
| exact-duplicate | 4 |

## Lista de rejeitados

| Arquivo | Motivo | Detalhe |
|---|---|---|
| WhatsApp Image 2026-08-27 at 23.32.19 (1).jpeg | manual-curation | Fotografia de estrada noturna com texto na borda; não é cenário de produto e conflita com a composição do anúncio. |
| WhatsApp Image 2026-09-14 at 17.49.50 (1).jpeg | visual-duplicate | Visualmente igual a WhatsApp Image 2026-09-14 at 17.49.49.jpeg. |
| WhatsApp Image 2026-09-14 at 17.49.51.jpeg | visual-duplicate | Visualmente igual a WhatsApp Image 2026-09-14 at 17.49.49.jpeg. |
| WhatsApp Image 2026-09-14 at 17.50.02.jpeg | visual-duplicate | Visualmente igual a WhatsApp Image 2026-09-14 at 17.49.46 (3).jpeg. |
| WhatsApp Image 2026-09-15 at 19.55.57 (1).jpeg | exact-duplicate | Idêntico byte a byte a WhatsApp Image 2026-09-15 at 21.57.59.jpeg. |
| WhatsApp Image 2026-09-15 at 21.57.58 (1).jpeg | exact-duplicate | Idêntico byte a byte a WhatsApp Image 2026-09-15 at 19.55.57 (2).jpeg. |
| WhatsApp Image 2026-09-15 at 21.57.58.jpeg | exact-duplicate | Idêntico byte a byte a WhatsApp Image 2026-09-15 at 19.55.56.jpeg. |
| WhatsApp Image 2026-09-15 at 21.57.59 (1).jpeg | exact-duplicate | Idêntico byte a byte a WhatsApp Image 2026-09-15 at 19.55.57.jpeg. |
| WhatsApp Image 2026-09-15 at 21.58.06 (2).jpeg | visual-duplicate | Visualmente igual a WhatsApp Image 2026-09-14 at 17.49.46 (3).jpeg. |
