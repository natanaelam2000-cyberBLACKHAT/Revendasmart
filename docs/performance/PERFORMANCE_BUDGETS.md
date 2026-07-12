# Performance Budgets - Revenda Smart

Budgets iniciais baseados no build atual e pensados para impedir regressões silenciosas. O total JS atual medido é aproximadamente 2.205 kB; o budget de 2.250 kB deixa uma margem pequena para ruído de hash/build sem aceitar crescimento grande.

| Alvo | Budget |
|---|---:|
| CSS principal `index-*.css` | 175 kB |
| JS de entrada `index-*.js` | 35 kB |
| `dashboard-*.js` | 55 kB |
| `onboarding-*.js` | 25 kB |
| `add-product-*.js` | 35 kB |
| `public-catalog-*.js` | 30 kB |
| `reports-*.js` | 35 kB |
| `settings-*.js` | 50 kB |
| `vendor-scanner-*.js` | 430 kB |
| `vendor-recharts-*.js` | 350 kB |
| Total JS | 2.250 kB |
| Total JS gzip | 700 kB |

Use:

```bash
npm run build
npm run performance:bundle-check
```

Qualquer aumento deve ser justificado no PR/relatório.


## Regras obrigatórias de regressão

- O chunk de entrada deve permanecer abaixo de 50 kB minificado; o gate atual usa 35 kB por estar abaixo desse teto.
- Nenhum asset JS/CSS novo pode passar de 500 kB sem justificativa técnica documentada.
- Scanner e Recharts devem continuar separados em chunks lazy (`vendor-scanner-*` e `vendor-recharts-*`).
- Aumento acima de 10% em qualquer chunk relevante exige justificativa e comparação antes/depois.
- O impacto dessas skills no bundle/runtime do aplicativo deve permanecer zero.

## Core Web Vitals alvo

- LCP p75 abaixo de 2,5 s.
- INP p75 abaixo de 200 ms.
- CLS abaixo de 0,1.

## Interface

- Evitar long tasks repetitivas acima de 50 ms.
- Busca e filtros devem responder imediatamente em listas médias.
- Listas críticas devem ser avaliadas com 500 a 1.000 itens sintéticos antes de produção ampla.
- Ações críticas devem apresentar feedback visual rápido.

## API e Cloud Run

- Medir p50, p95 e p99 quando houver teste autorizado.
- Registrar taxa de erro, 429, 5xx, timeout e cold start.
- Testes de carga são proibidos em produção.

## Firestore

- Registrar reads por tela e reads por ação em auditorias relevantes.
- Detectar listeners duplicados, queries completas e ausência de paginação.
- Preferir dados sintéticos, Firebase Emulator ou staging autorizado para medições ativas.

## Android/PWA

- Medir startup frio/quente, memória, CPU, jank e rede lenta quando houver build Android ou PWA instalado.
- Testar ao menos um aparelho intermediário antes da Play Store.
