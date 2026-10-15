# Performance Budgets - Revenda Smart

Budgets canônicos vigentes (política PERF-BUDGET-ARCH-01 / BUNDLE-POLICY-02) baseados na arquitetura de carregamento sob demanda do Vite, impedindo regressões silenciosas tanto no boot inicial quanto nas rotas lazy individuais.

## Budgets Canônicos Vigentes

### 1. Safety Ceilings Globais (Release Gate)
| Métrica | Budget Canônico |
|---|---:|
| Total JS emitido (todos os chunks, inclusive lazy) | 2.600 kB |
| Total JS gzip | 800 kB |
| CSS principal `index-*.css` | 180 kB |
| Asset individual máximo | 500 kB |

### 2. Initial Boot (Árvore Estática de `index.html`)
- **Budget:** 492.000 bytes (~480,4 kB)
- **Baseline de referência:** 484.827 bytes

### 3. Rotas Lazy com Budget Explícito
| Rota | Budget Explícito |
|---|---:|
| `marketing` | 236 kB |
| `settings` | 60 kB |
| `add-product` | 36 kB |
| `public-catalog` | 35 kB |
| `reports` | 29 kB |
| `onboarding` | 29 kB |
| `service-work-detail` | 29 kB |
| `service-agenda` | 20 kB |
| `catalog` | 16 kB |
| `service-availability-settings` | 15 kB |
| `dashboard` | 15 kB |
| *Demais rotas (teto default)* | 40 kB |

### 4. Chunks Compartilhados Críticos
| Chunk | Budget Explícito |
|---|---:|
| `PrivateRouter` | 44 kB |
| `CatalogShowcase` | 29 kB |
| `service-agenda-helpers` | 28 kB |

---

### [Histórico - Budgets Antigos Pré-Arquitetura Lazy]
> **Nota histórica:** A tabela abaixo representa os valores do desenho inicial (anterior à migração para o checker estruturado por rota e ao BUNDLE-POLICY-02). Mantida apenas como registro histórico.

| Alvo (Histórico) | Budget Histórico |
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

## BUNDLE-GOVERNANCE-HARDENING-06

As suítes de resiliência e de budgets fazem parte cumulativamente de `npm test`.
O script dedicado é `npm run test:dashboard-runtime-resilience`.

Qualidade das provas:

- `RUNTIME_REAL` (5 cenários, cada um com asserções próprias — sem contador agregado):
  `TRIAL_BANNER_RUNTIME` (rejeição do lazy contida pelo LocalErrorBoundary, sem retry e sem
  GlobalErrorBoundary), `TENANT_REMOUNT_RUNTIME` (TodayPriorities real: estado preservado no mesmo
  UID, desmontagem DOM em A → B → anonymous), `SETTINGS_ERROR_RUNTIME` (cópia UTF-8 exata, retry
  chama o refresh real do provider), `DATA_ERROR_RUNTIME` (layout/classes/cópia originais do erro
  de dados) e `SAVE_GOAL_HELPER_RUNTIME` (`runSaveMonthlyGoal` com carregador que rejeita uma vez e
  depois importa o `saveMonthlyGoal` real; POST, feedback, loading, fechamento e refresh).
  Serviços externos, hooks de dados e apresentação do OpportunityCard são doubles de fronteira.
  Mutações verificadas: remover o boundary, fixar a key de TodayPriorities, remover
  `setSaving(false)` ou gravar a cópia em Latin-1 fazem a suíte falhar.
- `RUNTIME_REAL`: checker de produção executado contra fixtures sintéticas e manifest real;
  inclui src sem name, colisões de helpers, vendor, exclusividade route/vendor/shared,
  sobreposição deliberada de boot/vendor, limites dashboard/marketing e a fronteira exata
  15360 bytes PASS / 15361 bytes FAIL.
- `SOURCE_ONLY`: guarda de encoding (dashboard.tsx, fixture e runner decodificam como UTF-8
  estrito, sem U+FFFD nem mojibake Latin-1; o bundle da fixture também é verificado), fallback de
  prioridades com `p-4`, ausência de loader intermediário de serviços, ausência de Firebase eager e
  propagação/dependência de UID no provider. Não substituem provas comportamentais.
- `SIMULATED`: nenhuma prova de comportamento reimplementada nas duas suítes auditadas.

O fallback de src utiliza diretamente seu basename sem remover suposto hash. Sem src, o
fallback estrutural aceita o hash Vite de oito caracteres; `dashboard-helper` e
`marketing-helper` não são truncados. Os gates comparam bytes antes do arredondamento.

BUNDLE-GOVERNANCE-P1-CORRECTION-08: o `ServicesOverviewLoader` (criado nesta frente, não
existente no HEAD) foi removido — era só um wrapper lazy que deslocava ~570 bytes da rota ao custo
de um round-trip sequencial. A contagem de serviços passou a viver em `ServicesOverviewSection`
e usa o mesmo `import()` da seção: o chunk `dashboard-services-count` deixou de existir e a seção
chega pré-carregada quando renderiza (um split e um round-trip a menos). A redução restante veio de
código real: classes de foco/texto repetidas viraram constantes, leituras repetidas de `home.*`
foram desestruturadas, cópias "do negócio/da loja" e plurais deixaram de ser duplicados e guards
`typeof window` redundantes (o try/catch já cobre) e um re-export morto foram removidos. Os erros
de configuração e de dados compartilham a estrutura, mas cada um mantém layout, classes, cópia e
ação originais; o fallback de prioridades voltou a ter `p-4`. Splits ainda mantidos: `TrialBanner`
(lazy, com round-trip e aparecimento atrasado — P2 registrado) e `save-monthly-goal` (carregado
só ao salvar). Nenhum split novo foi criado.

Medição em bytes, build final desta correção (kB = 1024 bytes):

| Métrica | Bytes | Margem canônica |
|---|---:|---:|
| Dashboard | 15232 | 128 |
| TOTAL JS | 2653498 | 8902 |
| Gzip de JS | 815384 | 3816 |
| Marketing | 240950 | 714 |
| PrivateRouter | 38538 | 6518 |
| Public catalog | 35337 | 503 |
| Initial boot | 485876 | 6124 |

`TOTAL_JS_TARGET_2594_MET=YES` (alvo 2656256 bytes).
`DASHBOARD_TARGET_14_50_MET=NO` (alvo interno 14848 bytes; faltam 384 bytes).
Não aumentar budgets, adicionar camadas de chunks ou round-trips para atingir apenas a métrica
da rota.

A mudança de UID no provider preserva a dependência no useMemo e repassa o UID da fonte de
Auth. O Dashboard continua sem import eager de Firebase. A fonte de settings mantém reset
para defaults, cancelamento dos resultados antigos e estados loading/error; não foi alterada
nesta frente. O teste exercita a composição real do provider com respostas sintéticas da fonte,
sem substituir o provider ou a reconciliação React.
