---
name: auditing-search-filter-and-debounce
description: Auditar busca/filtros/debounce em produtos, clientes, catálogo e marketing.
version: 1.0.0
source: Revenda Smart Performance Engineering Skills
sourceCommit: 7ff3b2ecc669b0bf61f1dd16f34200ac5a6226c8
adaptedFrom:
  - custom:revendasmart-performance-engineering
license: Apache-2.0
category: performance-engineering
tier: Tier A
tags:
  - revendasmart
  - performance
  - react
  - products
  - clients
  - catalog
riskLevel: medium
defaultMode: REVIEW_ONLY
allowedEnvironments:
  - local
  - emulator
  - staging
prohibitedEnvironments:
  - production
triggers:
  - auditing search filter and debounce
  - performance auditing search filter and debounce
---
# auditing-search-filter-and-debounce

## Objetivo

Auditar busca/filtros/debounce em produtos, clientes, catálogo e marketing.

## Escopo Revenda Smart

Arquivos e módulos normalmente relevantes:

- `client/src/pages`
- `client/src/components`
- `client/src/hooks`
- `client/src/pages/products.tsx`
- `client/src/hooks/usePaginatedProductsData.ts`
- `client/src/pages/clients.tsx`
- `client/src/hooks/usePaginatedClientsData.ts`
- `client/src/pages/public-catalog.tsx`
- `server/routes.ts`

## Pré-condições obrigatórias

- Confirmar o repositório correto em `/home/natanaelam2000/Revendasmart`.
- Confirmar `git status` antes de qualquer alteração.
- Não fazer commit.
- Não fazer deploy.
- Não imprimir segredos.
- Não executar testes em produção.
- Não alterar regra de negócio, Mercado Pago, Firebase, Cloud Run ou Play Store sem autorização explícita.
- Não adicionar dependência pesada sem justificar impacto.
- Não criar listener, polling, request ou write extra sem medir necessidade.

## Modos permitidos

- `REVIEW_ONLY`: leitura, diagnóstico, medições existentes e plano. Modo padrão obrigatório.
- `SAFE_FIX`: correções pequenas, locais, rastreáveis e de baixo risco.
- `LOCAL_TEST`: medições em localhost, Firebase Emulator ou build local com dados sintéticos.
- `STAGING_ACTIVE_TEST`: somente com autorização explícita, staging do Revenda Smart, dados sintéticos, limite de carga e janela controlada.

## Workflow

1. Registrar baseline antes/depois quando houver medida disponível.
2. Identificar gargalo por evidência: bundle, render, rede, memória, Firestore reads, CPU, Web Vitals ou logs.
3. Classificar impacto em UX, custo, CPU, memória, rede e bundle.
4. Preferir recomendações e pequenas correções seguras; evitar refatoração ampla.
5. Se houver teste de carga, limitar a ambiente local/emulator/staging autorizado e parar ao atingir o objetivo.
6. Documentar comandos, resultados, riscos e próximos passos.

## Métricas recomendadas

- Bundle/chunk size e gzip.
- LCP, INP, CLS e tempo até primeira interação.
- Long tasks acima de 50ms.
- Re-renderizações evitáveis.
- Firestore reads/listeners por tela.
- Latência p50/p95/p99 para API.
- Uso de memória/CPU em mobile intermediário.

## Critérios de parada

Pare imediatamente se a ação exigir produção, dados reais de terceiros, carga volumétrica, deploy, mudança financeira, credenciais reais, alteração de rules/IAM, ou se a medição puder degradar usuários reais.

## Entregáveis

- Arquivos analisados.
- Baseline medida.
- Gargalos encontrados.
- Correções aplicadas, se houver.
- Riscos restantes.
- Próxima sprint recomendada.
