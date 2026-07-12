# Matriz de Funcionalidades — Revenda Smart

Auditoria gerada em: 2026-07-12T19:54:17Z

Branch: `main`
Commit auditado: `615b984 perf: adiciona skills e budgets de performance`

## Contagem por status

- PASS: 22
- PARTIAL: 10
- FAIL: 0
- BLOCKED: 7
- NOT_TESTED: 0
- NOT_APPLICABLE: 0

## Matriz

| Funcionalidade | Rota | Arquivos principais | Dados/endpoints | Validação | Status |
|---|---|---|---|---|---|
| Login | `/login` | `client/src/pages/login.tsx` | Firebase Auth, settings | Inspeção + build | PASS |
| Cadastro | `/signup` | `client/src/pages/signup.tsx` | Firebase Auth, referral | Inspeção + build | PASS |
| Router público isolado | `/login /signup /u/:slug` | `client/src/App.tsx` | sem providers privados | Inspeção | PASS |
| Rotas privadas | `/* privadas` | `client/src/routers/PrivateRouter.tsx` | Firebase user, plan init | Inspeção | PASS |
| Onboarding guiado | `/onboarding` | `onboarding.tsx` | user_settings | Smoke + inspeção | PASS |
| Nichos/categorias | `/onboarding /add-product` | `nicho-config.ts`, `add-product.tsx` | customCategoriesByNicho | Teste automático comportamental | PASS |
| Temas | app root | `app-themes.ts`, `UserSettingsProvider.tsx` | appTheme/appThemeCustomization | Teste automático comportamental | PASS |
| Checklist onboarding | `/` | `OnboardingChecklist.tsx`, `dashboard.tsx` | settings + dados carregados | Inspeção | PASS |
| Produtos paginados | `/products` | `products.tsx`, `usePaginatedProductsData.ts` | users/{uid}/products | Smoke estático | PASS |
| Cadastro/edição produto | `/add-product /edit-product/:id` | `add-product.tsx` | products, Storage | Inspeção | PASS |
| Exclusão produto | `/products` | `products.tsx`, dialog | products | Inspeção, sem clique real | PARTIAL |
| Upload imagem/thumbnail | produto/settings | `add-product.tsx`, `storage.rules` | Storage JPEG/PNG/WebP | Inspeção | PASS |
| Scanner código barras | `/add-product` | `barcode-scanner` lazy | câmera | Exige aparelho físico | BLOCKED |
| Clientes paginados | `/clients` | `clients.tsx`, `usePaginatedClientsData.ts` | clients | Smoke estático | PASS |
| Clientes CRUD | `/clients` | `clients.tsx` | clients | Inspeção, sem banco real | PARTIAL |
| CRM cliente | `/clients/:id` | `client-detail.tsx`, `client-metrics.ts` | clients/sales/products | Inspeção | PARTIAL |
| Venda atômica | `/sell` | `sell.tsx`, `server/routes.ts` | sales/products/installments | Inspeção transação | PASS |
| Estoque insuficiente | `/sell` | `server/routes.ts` | products stock | Inspeção | PASS |
| Cobranças/parcelas | `/billings` | `useCharges.ts`, `billings.tsx` | charges/installments | Smoke estático | PASS |
| Mercado Pago OAuth | `/settings/mercadopago` | `mercadopago-connections.ts` | MP OAuth | Exige sandbox | BLOCKED |
| MP fail-closed conectado | backend | `payments.ts`, `mercadopago-connections.ts` | tokenSource | Smoke estático + inspeção | PASS |
| MP webhooks | backend | `payments.ts`, `subscriptions.ts` | webhooks | Exige webhook sandbox | BLOCKED |
| Assinatura Premium | `/subscribe` | `subscribe.tsx`, `subscriptions.ts` | planData/subscription | Exige sandbox | BLOCKED |
| Dashboard | `/` | `dashboard.tsx`, métricas libs | products/sales/clients | Build/inspeção | PARTIAL |
| Relatórios | `/reports` | `reports.tsx`, `report-metrics.ts` | products/sales/clients | Build/bundle | PARTIAL |
| Catálogo interno | `/catalog` | `catalog.tsx` | products/settings | Build/inspeção | PARTIAL |
| Catálogo público | `/u/:slug` | `public-catalog.tsx`, `routes.ts` | API paginada | Smoke fake + inspeção | PASS |
| Open Graph catálogo | `/u/:slug` | `routes.ts` | settings + 1 imagem | Inspeção | PASS |
| Marketing | `/marketing` | `marketing.tsx` | products/history opcional | Build/inspeção | PARTIAL |
| Configurações | `/settings` | `settings.tsx` | user_settings/branding | Build/inspeção | PARTIAL |
| Admin | `/admin` | `admin.tsx`, `routes.ts` | admin APIs | Inspeção | PARTIAL |
| Firestore Rules | N/A | `firestore.rules` | dados por UID | Inspeção | PASS |
| Storage Rules | N/A | `storage.rules` | imagens por UID | Inspeção | PASS |
| PWA/branding | PWA | manifest/icons/index | assets estáticos | Build/inspeção | PARTIAL |
| Skills gates | CI/local | `.codex/skills` | N/A | skills:validate | PASS |
| Bundle budgets | CI/local | `check-bundle-budgets.mjs` | dist/assets | bundle-check | PASS |
| Cloud Run/IAM/Secrets | infra | docs/scripts/gcloud | Cloud Run/Secret Manager | Exige verificação externa | BLOCKED |
| Android/Play Store | mobile | manifest/assets/futuro AAB | aparelho real | Exige aparelho físico | BLOCKED |

## Observações

- PASS indica validação pelo método informado, não necessariamente teste manual completo.
- Fluxos financeiros não foram executados contra contas reais.
- Android/PWA instalável precisa validação física.
