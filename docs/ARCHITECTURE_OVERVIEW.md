# Revenda Smart — Visão Arquitetural e Governança Técnica

Última revisão: 2026-07-08

Este documento registra o mapa arquitetural atual do Revenda Smart e as decisões técnicas que devem guiar as próximas sprints. Ele não substitui testes, auditorias de segurança ou validação manual; serve como referência para manutenção, onboarding e evolução segura do produto.

## Princípios de arquitetura

1. Preservar compatibilidade com dados existentes.
2. Evitar regras de negócio duplicadas entre telas.
3. Manter fluxos críticos com validação transacional ou backend quando houver risco de inconsistência.
4. Tratar catálogo público, pagamentos, assinatura e vendas como áreas sensíveis de produção.
5. Separar carregamento de dados, cálculo e renderização sempre que a complexidade crescer.
6. Não expor dados sensíveis em logs, URLs, mensagens de usuário ou payloads públicos.
7. Preferir mudanças incrementais, rastreáveis e fáceis de reverter.

## Mapa dos módulos principais

```text
client/src
├── pages/              Telas e fluxos de produto. Ainda concentram UI + orchestration em alguns pontos.
├── components/         Componentes reutilizáveis, UI primitives e cards.
├── hooks/              Acesso a dados Firebase/Firestore, listeners e paginação.
├── lib/                Funções puras, métricas, helpers Firebase, telemetria e configuração.
├── providers/          Cache/estado global de plano e configurações.
└── routers/            Separação entre rotas públicas e privadas.

server
├── index.ts            Bootstrap Express, CORS, headers, Sentry, request logging.
├── routes.ts           Rotas gerais e APIs principais. Arquivo ainda grande.
├── payments.ts         Cobranças, links, webhooks e sincronização Mercado Pago.
├── subscriptions.ts    Assinatura Premium e webhook de assinatura.
├── logger.ts           Logger seguro backend, requestId e sanitização.
└── mercadopago-*       OAuth, conexões e criptografia de tokens.

shared
├── monetization.ts     Contratos de plano, limites e monetização.
├── charges.ts          Contratos compartilhados de cobranças.
└── schema.ts           Base compartilhada de schema/tipos.
```

## Limites arquiteturais desejados

| Área | Responsabilidade desejada | Evitar |
| --- | --- | --- |
| `pages/` | Orquestrar tela, estado visual e chamadas de hooks | Regras de negócio longas, queries diretas repetidas, cálculos pesados inline |
| `hooks/` | Encapsular leitura/escrita de dados e cleanup de listeners | Misturar UI, toasts, cálculos de dashboard/relatórios |
| `lib/` | Funções puras, métricas, normalização, helpers | Side effects escondidos em funções chamadas por render |
| `providers/` | Cache global leve e compartilhado | Virar store global para tudo ou duplicar Firestore listeners |
| `server/` | Regras sensíveis, pagamentos, webhooks, transações | Confiar em dados do cliente para origem, preço, premium ou ownership |
| `docs/` | Decisões, runbooks e governança | Secrets, comandos com valores reais ou informações operacionais sensíveis |

## Acoplamentos perigosos observados

| Prioridade | Acoplamento | Impacto | Momento ideal |
| --- | --- | --- | --- |
| Alto | Telas grandes como `settings.tsx`, `add-product.tsx`, `dashboard.tsx` e `billings.tsx` misturam UI, regras, API/Firebase e feedback | Aumenta risco de regressão e dificulta onboarding | Antes da Play Store |
| Alto | `server/routes.ts` ainda concentra muitas responsabilidades | Dificulta revisão de segurança e mudanças isoladas | Antes da publicação ampla |
| Alto | Fluxos críticos dependem de múltiplos módulos Firebase/API no frontend | Pode duplicar chamadas e dificultar observabilidade | Antes da Play Store |
| Médio | Hooks de dados ainda têm variações parecidas para produtos/clientes/vendas | Custo de manutenção e risco de comportamento divergente | Próximas sprints de performance |
| Médio | Métricas e relatórios já foram extraídos, mas páginas ainda precisam vigiar recálculos e dependências | Performance pode degradar com bases maiores | Monitorar e otimizar por tela |
| Baixo | Scripts administrativos coexistem em `server/` | Podem aparecer em auditorias de logs/secrets sem contexto | Documentar e isolar futuramente |

## Decisões técnicas aprovadas

1. Rotas públicas e privadas devem continuar separadas para reduzir bundle inicial e risco de carregar providers privados no catálogo público.
2. `useDashboardData` deve permanecer legado/compatibilidade e novas telas devem preferir hooks específicos.
3. Cálculos pesados de dashboard, CRM e relatórios devem ficar em `client/src/lib/*-metrics.ts` ou libs equivalentes.
4. Catálogo público deve continuar paginado e sem full scan de slug.
5. Vendas, estoque e parcelas devem permanecer atômicos no backend.
6. Mercado Pago deve operar fail-closed quando segredo/assinatura de webhook estiver ausente.
7. Secrets de produção devem ficar no Secret Manager; valores reais nunca devem entrar no Git.
8. Logs novos devem usar sanitização e masking por padrão.
9. Produtos antigos sem `thumbnailUrl` devem continuar compatíveis com `imageUrl`.

## Decisões que precisam de revisão futura

| Tema | Decisão pendente | Risco se adiar demais |
| --- | --- | --- |
| Service account Cloud Run | Trocar Compute default por conta dedicada com IAM mínimo | Excesso de privilégio em produção |
| Busca server-side | Produtos, clientes e catálogo ainda têm busca local em algumas áreas | UX e custo degradam com bases grandes |
| Virtualização | Listas grandes ainda podem renderizar muitos cards | Lentidão em celulares intermediários |
| Observabilidade frontend | `safeLogger` existe, mas não cobre todo frontend | Logs inconsistentes e baixa rastreabilidade |
| Admin/scripts | Scripts operacionais precisam isolamento/runbook | Risco de uso indevido ou vazamento em logs |
| Exportações | PDF/Excel/CSV ainda precisam governança de privacidade | Exportar dados demais ou sem aviso claro |

## Backlog técnico arquitetural

| Prioridade | Item | Impacto | Custo estimado | Momento |
| --- | --- | --- | --- | --- |
| Alto | Dividir `server/routes.ts` por domínio: user settings, referral, public catalog, admin/legal | Segurança e manutenção | Médio | Antes da Play Store |
| Alto | Criar service account dedicada para Cloud Run e revisar IAM mínimo | Segurança | Médio | Antes da Play Store |
| Alto | Expandir `safeLogger` para fluxos de assinatura, produtos, Firebase e Mercado Pago no frontend | Observabilidade e proteção de dados | Baixo/Médio | Fazer agora em sprints pequenas |
| Alto | Criar runbook de Mercado Pago sandbox e webhook | QA e suporte | Baixo | Antes da Play Store |
| Médio | Extrair orchestration de `add-product.tsx` para hook/lib sem mudar UI | Manutenção | Médio | Antes da publicação ampla |
| Médio | Extrair blocos de `settings.tsx` por seção mantendo rotas/tabs | Manutenção e UX | Médio/Alto | Antes da publicação ampla |
| Médio | Virtualizar listas grandes em produtos/clientes/cobranças onde paginação não bastar | Performance mobile | Médio | Próximas sprints |
| Médio | Busca server-side progressiva para clientes/produtos/catálogo | Escala e UX | Médio/Alto | Antes de base grande |
| Baixo | Padronizar scripts administrativos em pasta própria com README | Governança | Baixo | Depois da primeira versão |
| Baixo | Criar ADRs para decisões críticas futuras | Onboarding e histórico técnico | Baixo | Monitorar |

## Plano arquitetural para os próximos 30 dias

### Semana 1 — Segurança e observabilidade incremental

- Migrar logs sensíveis restantes para `safeLogger` no frontend.
- Revisar scripts administrativos e separar runbooks de operações sensíveis.
- Documentar execução segura de sandbox Mercado Pago.

### Semana 2 — Escala de dados

- Implementar virtualização onde paginação já não resolve.
- Planejar busca server-side por domínio, começando por clientes/produtos.
- Medir leituras Firestore nas telas principais com dados simulados.

### Semana 3 — Modularização segura

- Dividir `server/routes.ts` em módulos por domínio sem alterar contratos.
- Extrair partes de `settings.tsx` em componentes/seções estáveis.
- Isolar orchestration de cadastro de produto em hook/lib mantendo UI.

### Semana 4 — Homologação produtiva

- Rodar QA Android real.
- Rodar Mercado Pago sandbox completo.
- Validar Secret Manager, IAM mínimo e rollback Cloud Run.
- Revisar mensagens finais de erro/feedback antes da Play Store.

## Critérios de pronto para produção ampla

- `npm run check`, `npm run build`, `npm run lint`, `npm run test` e `git diff --check` passando.
- Nenhum secret rastreado no Git.
- Webhooks fail-closed e idempotentes.
- Vendas críticas atômicas.
- Catálogo público sem full scan e com rate limit.
- Logs sem token, email completo, telefone completo, payload sensível ou private key.
- Fluxos Mercado Pago testados em sandbox.
- Runbook de rollback documentado.
- QA mobile real executado em Android pequeno/intermediário.
