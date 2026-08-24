# RevendaSmart — inventário de dados e matriz preparatória do Google Play Data Safety

**Data da auditoria:** 17 de agosto de 2026  
**Escopo:** comportamento implementado no checkout local; este documento não é uma resposta submetida ao Play Console nem um parecer jurídico.

## Como usar este documento

O Google Play considera coleta a transmissão de dados do dispositivo para servidores próprios ou de terceiros, inclusive por SDKs. A classificação de “compartilhado” possui exceções e depende do papel contratual e do uso pelo destinatário. Por isso, células com nuance permanecem como `PLAY_CONSOLE_DECISION_REQUIRED`.

Referências oficiais consultadas:

- [Google Play — Data safety](https://support.google.com/googleplay/android-developer/answer/10787469)
- [Google Play — exclusão de conta](https://support.google.com/googleplay/android-developer/answer/13327111)
- [Google Play — User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311)

Estados de retenção usados neste inventário:

- `KNOWN`: comportamento/prazo demonstrado pelo código ou configuração versionada.
- `UNTIL_ACCOUNT_DELETION`: dado operacional removido pelo fluxo atual de exclusão.
- `PROVIDER_CONTROLLED`: registro mantido em sistema externo sob regras do provedor.
- `NEEDS_POLICY_DECISION`: não há prazo ou regra final demonstrável no checkout.

Estados de integração usados para IA/Marketing:

- `IMPLEMENTED`: caminho presente no runtime atual.
- `FEATURE_FLAGGED`: caminho de produto condicionado por flag.
- `SMOKE_ONLY`: adapter acessível apenas por harness local explícito.
- `NOT_IN_PRODUCTION`: nenhuma chamada no runtime de produção auditado.

## Inventário técnico de dados

| DATA | SOURCE | PURPOSE | STORAGE | SHARING / PROCESSOR | RETENTION KNOWN? | USER CONTROL? | EVIDENCE |
|---|---|---|---|---|---|---|---|
| E-mail, UID, credenciais e sessão | Cadastro/login do usuário; Firebase Auth | Criar conta, autenticar, autorizar dados por tenant | Firebase Authentication; persistência de sessão no navegador | Google/Firebase | `UNTIL_ACCOUNT_DELETION` para conta; sessão local até logout/limpeza | Login, logout, recuperação e exclusão de conta | `client/src/lib/firebase.ts`, `client/src/pages/signup.tsx`, `server/account-deletion.ts` |
| Configurações da conta/loja, nichos, onboarding, preferências, slug e contato comercial | Usuário e servidor | Personalização, catálogo, plano e operação | Firestore (`user_settings` e documentos do usuário); parte em localStorage | Google/Firebase | `UNTIL_ACCOUNT_DELETION`; cache local é limpo no dispositivo que executa a exclusão | Editável no app; catálogo pode ser desabilitado; conta pode ser excluída | `client/src/hooks/useUserSettings.ts`, `server/routes.ts`, `server/account-deletion.ts` |
| Produtos, marca, categoria, descrição, custo, preço, estoque e atributos | Lojista | Gestão de estoque, venda, catálogo e Marketing | Firestore em subcoleções do usuário; caches locais | Google/Firebase; parte escolhida fica pública no catálogo | `UNTIL_ACCOUNT_DELETION` | CRUD pelo lojista; publicação controlada por catálogo | `client/src/lib/mock-data.ts`, `server/routes.ts`, `shared/public-catalog.ts` |
| Imagens de produto, logo, catálogo e cutouts aprovados | Upload do lojista e processamento local aprovado | Catálogo, preview, composição e exportação | Firebase Cloud Storage; metadados no Firestore; cache/IndexedDB local | Google/Firebase; imagens publicadas podem ser acessadas por visitantes | `UNTIL_ACCOUNT_DELETION` no Storage do usuário; caches locais dependem do dispositivo | Upload/substituição/exclusão de produto; exclusão de conta | `server/uploads.ts`, `storage.rules`, `shared/approved-product-cutout.ts`, `client/src/lib/account-deletion-local.ts` |
| Clientes do lojista: nome, telefone/WhatsApp, datas e histórico | Inserção pelo lojista | CRM e registro de vendas/cobranças | Firestore; possível cache local | Google/Firebase; dados necessários a uma cobrança podem seguir para Mercado Pago | `UNTIL_ACCOUNT_DELETION`; registros externos são `PROVIDER_CONTROLLED` | Lojista gerencia registros; exclusão da conta remove dados operacionais | `client/src/hooks/useClientsData.ts`, `client/src/hooks/useCreateClient.ts`, `server/account-deletion.ts` |
| Pedidos, vendas, parcelas, cobranças, itens, valores, status e observações | Lojista, app e provedores de pagamento | Gestão financeira/comercial, cobrança e conciliação | Firestore (`sales`, `orders`, `installments`, `charges`) | Google/Firebase; Mercado Pago quando usado | Operacional: `UNTIL_ACCOUNT_DELETION`; provedor: `PROVIDER_CONTROLLED`; eventual retenção interna: `NEEDS_POLICY_DECISION` | Gestão no app; exclusão da conta remove subcoleções atuais | `client/src/pages/sell.tsx`, `client/src/pages/billings.tsx`, `client/src/lib/orders.ts`, `server/account-deletion.ts` |
| Dados públicos da loja, WhatsApp, slug, produtos, preços, imagens e disponibilidade | Configuração do lojista | Exibir catálogo público e permitir contato comercial | Firestore, Storage e reserva server-owned de slug | Visitantes do catálogo; Google/Firebase/Vercel/Cloud Run | Até desabilitar/excluir catálogo ou `UNTIL_ACCOUNT_DELETION` | Catálogo pode ser desabilitado; dados podem ser editados | `shared/public-catalog.ts`, `server/routes.ts`, `server/public-catalog-ownership.ts` |
| Conexão Mercado Pago: IDs da conta, nome/e-mail/documento quando retornados, tokens OAuth e status | OAuth e API Mercado Pago | Conectar conta do lojista, criar/sincronizar cobranças | Tokens criptografados e metadados no Firestore | Mercado Pago; Google/Firebase | Conexão local até desconexão/exclusão; registros do MP `PROVIDER_CONTROLLED`; prazo de auditoria `NEEDS_POLICY_DECISION` | Conectar/desconectar; conexão ativa bloqueia exclusão automática | `server/mercadopago-connections.ts`, `server/mercadopago-crypto.ts`, `shared/connections.ts` |
| Pagamento web/PWA: identificadores, status e metadados de transação | Mercado Pago e usuário | Processar assinatura/cobrança e reconciliar estado | Firestore e Mercado Pago | Mercado Pago; Google/Firebase | Local `UNTIL_ACCOUNT_DELETION` salvo decisão de retenção; externo `PROVIDER_CONTROLLED` | Cancelamento/desconexão conforme fluxo; exclusão da conta | `server/payments.ts`, `server/subscriptions.ts`, `server/account-deletion.ts` |
| Google Play Billing: purchase token em trânsito, hash do token, product/order ID, status e validade | App Android e Google Play Developer API | Verificar, restaurar e impedir reutilização de compra | Token bruto não é persistido; hash em `googlePlayPurchaseTokens`; metadados em `planData/main` | Google Play; Google/Firebase | Token bruto: apenas trânsito; hash/registro raiz: `NEEDS_POLICY_DECISION`; Google: `PROVIDER_CONTROLLED` | Cancelamento no Google Play; exclusão remove planData, mas o hash raiz permanece hoje | `client/src/lib/google-play-billing-client.ts`, `server/google-play-billing.ts`, `shared/play-billing-contract.ts` |
| Histórico e conteúdo de Marketing: imagem/referência, produto, textos, preço, formato e snapshot | Lojista e compositor local | Criar, reabrir, exportar e compartilhar anúncios | Firestore (`marketingHistory`) e localStorage | Google/Firebase; destino escolhido no compartilhamento | `UNTIL_ACCOUNT_DELETION` no backend; cache local limpo no dispositivo da exclusão | Remoção no histórico quando disponível; exclusão de conta | `client/src/hooks/useMarketingHistory.ts`, `client/src/lib/marketing-history.ts`, `client/src/lib/account-deletion-local.ts` |
| Eventos de uso, produto e operação | Firebase Analytics SDK e chamadas do app | Analytics de produto e diagnóstico de funil | Firebase Analytics | Google/Firebase | `PROVIDER_CONTROLLED`; configuração/prazo `NEEDS_POLICY_DECISION` | **Sem consentimento/opt-out interno hoje** | `client/src/lib/firebase.ts`, `client/src/lib/firebase-analytics.ts` |
| Métricas de carregamento, rede e traces customizados | Firebase Performance SDK | Diagnóstico de performance | Firebase Performance | Google/Firebase | `PROVIDER_CONTROLLED`; configuração/prazo `NEEDS_POLICY_DECISION` | **Sem consentimento/opt-out interno hoje** | `client/src/lib/firebase.ts`, `client/src/lib/firebase-performance.ts` |
| Erros/eventos no cliente: mensagem, stack/contexto sanitizado, URL e UID mascarado | Error logger do cliente | Diagnóstico local durante a sessão | Console local/safeLogger no navegador ou dispositivo; não há persistência cliente comprovada para esse caminho | Nenhum envio adicional comprovado por esse módulo | `KNOWN`: local-only neste caminho | Sem controle específico; não é um dataset operacional remoto do app | `client/src/lib/error-logging.ts`, `client/src/lib/client-diagnostics.ts` |
| Eventos da antiga telemetria interna | Módulo interno | Nenhuma no runtime atual | Não grava `analytics_events`; apenas contexto em memória | Nenhum envio por esse módulo | `KNOWN`: no-op atual | Não aplicável | `client/src/lib/internal-telemetry.ts` |
| Erros do servidor, traces e contexto sanitizado | Backend | Diagnóstico de falhas | Sentry somente quando `SENTRY_DSN` está configurado | Sentry | `PROVIDER_CONTROLLED`; configuração e prazo `NEEDS_POLICY_DECISION` | Sem controle específico no app | `server/index.ts` (`sendDefaultPii: false`, `beforeSend`) |
| Logs HTTP: request ID, método, rota normalizada, status, duração, tamanho e códigos de erro | Backend e infraestrutura | Operação, segurança e diagnóstico | Logs do processo/Cloud Run e infraestrutura | Google Cloud; eventualmente Sentry | `PROVIDER_CONTROLLED` e `NEEDS_POLICY_DECISION` | Sem controle específico; exclusão não demonstra remoção desses logs | `server/logger.ts`, `server/index.ts` |
| IP, navegador, user agent, dispositivo/app e identificadores técnicos | Requisições, SDKs e infraestrutura | Entrega, segurança, rate limit, analytics e diagnóstico | Infraestrutura, Firebase Analytics/Performance e logs | Google/Firebase/Cloud Run/Vercel; Sentry se configurado | `PROVIDER_CONTROLLED`; prazo `NEEDS_POLICY_DECISION` | Sem opt-out geral interno | `server/index.ts`, `server/logger.ts`, `client/src/lib/client-diagnostics.ts`, `client/src/lib/error-logging.ts` |
| Plano, referral, cotas e recibos de upload | App e backend | Entitlement, indicação, prevenção de abuso e contabilização | Firestore | Google/Firebase | Em geral `UNTIL_ACCOUNT_DELETION`; exceções raiz precisam de revisão | Ações do produto e exclusão de conta | `server/subscriptions.ts`, `server/upload-quota.ts`, `server/account-deletion.ts` |
| Tombstone de exclusão | Backend | Impedir repetição/replay após exclusão | Firestore `account_deletion_requests/{uid}` | Google/Firebase | `NEEDS_POLICY_DECISION` | Não há remoção automática demonstrada | `server/account-deletion.ts` |

## Estado real dos providers de IA e Marketing

| PROVIDER / CAMINHO | STATUS | RECEBE DADOS NO RUNTIME DE PRODUÇÃO? | EVIDENCE |
|---|---|---|---|
| Marketing Pro — provider determinístico local | `IMPLEMENTED` | Não envia dados a provider externo | `server/marketing-pro.ts`, `server/marketing-pro-provider.ts`, `server/routes.ts` |
| Creative V2 local | `FEATURE_FLAGGED` | Não; composição é local/determinística | `client/src/lib/marketing-pro-creative-v2.ts`, `client/src/lib/remote-config.ts` |
| **Photoroom** | **`IMPLEMENTED` — rota de produção ativa** (corrigido em REVENDASMART-LGPD-ANPD-REMEDIATION-01; a classificação anterior `SMOKE_ONLY`/`NOT_IN_PRODUCTION` estava desatualizada) | **Sim** — quando um usuário Premium aciona a remoção de fundo sobre uma imagem específica, os bytes originais da foto do produto são enviados a `sdk.photoroom.com`. Gateado por entitlement Premium/admin + quota diária (não por feature flag) — já foi exercitado com uma chamada real neste checkout. | `server/routes.ts` (registro da rota, `registerProductCutoutPhotoroomRoutes`), `server/product-cutout-photoroom.ts`, `server/photoroom-cutout-adapter.ts`, `client/src/components/PhotoroomCutoutTool.tsx` |
| Gemini / Google AI — geração de fundo (Marketing Pro) | `FEATURE_FLAGGED` — código pronto, credencial (`GEMINI_API_KEY`) presente no ambiente verificado, mas a flag que habilita a chamada (`MARKETING_PRO_REAL_BACKGROUND_ENABLED`) não está ativa nas configurações verificadas | Não hoje; envia só um prompt sintético quando habilitado (nenhuma imagem de produto) | `server/marketing-pro-provider-google.ts`, `server/marketing-pro-flags.ts` |
| Gemini / Google AI — inspeção visual de produto | `FEATURE_FLAGGED` — mesma situação: credencial presente, flag (`MARKETING_PRO_PRODUCT_UNDERSTANDING_ENABLED`) não ativa nas configurações verificadas | **Não hoje, mas está a um único flag de distância de enviar a foto real do produto** — rota já registrada incondicionalmente | `server/marketing-pro-product-visual-analyzer-google.ts`, `server/marketing-pro-product-understanding.ts` |
| OpenAI | `SMOKE_ONLY`, `NOT_IN_PRODUCTION` | Não pelo runtime; somente benchmark local explícito | `script/marketing-pro-benchmark/providers/openai.ts` |
| Black Forest Labs (BFL) | `SMOKE_ONLY`, `NOT_IN_PRODUCTION` | Não pelo runtime; somente benchmark local explícito | `script/marketing-pro-benchmark/providers/bfl.ts` |
| remove.bg | `NOT_IN_PRODUCTION` | Não; não há adapter ativo no runtime auditado | Busca de imports/referências no runtime |

Uma ativação futura de provider real exige nova revisão da política e do formulário antes do release correspondente. **A ativação do Photoroom já aconteceu e a Política de Privacidade (`client/public/privacy-policy.md`, seções 3.3 e 5) e este documento foram atualizados na `REVENDASMART-LGPD-ANPD-REMEDIATION-01` para refletir isso — antes dessa correção, a política vigente afirmava incorretamente que nenhum provedor externo recebia imagens em produção (achado P0 da auditoria original).**

## Auditoria das afirmações da política anterior

| AFIRMAÇÃO / GRUPO | CLASSIFICAÇÃO | RESULTADO |
|---|---|---|
| RevendaSmart como serviço responsável | `CONFIRMED` | Mantido; identificação jurídica completa do responsável permanece decisão administrativa/jurídica. |
| “Fornecedor: Replit” | `OUTDATED` | Removido. O checkout evidencia Vercel, Cloud Run e Firebase; não evidencia Replit como operador atual. |
| Contato `[support@revendasmart.com]` | `OUTDATED` | Substituído pelo contato real usado no app: `revendasmart.suporte@gmail.com`. |
| E-mail e UID no Firebase Auth | `CONFIRMED` | Mantido com redação técnica. |
| Senha com “hash seguro” pelo provedor | `CONFIRMED` com limite | Redação passa a delegar o tratamento ao Firebase Auth, sem afirmar algoritmo. |
| Senha com bcrypt | `OUTDATED` | Removido; não existe bcrypt de senha no código do app. |
| Localização país/estado de onboarding não persistida | `UNSUPPORTED` | Removido; o fluxo atual não demonstra a coleta descrita de modo confiável. |
| Produtos, imagens, clientes, vendas e cobranças | `CONFIRMED` | Expandido para refletir coleções e Storage atuais. |
| Catálogo mostra somente estoque maior que zero | `OUTDATED` | Substituído por descrição do que é configurado/publicado; o runtime também representa disponibilidade. |
| Mercado Pago OAuth e transações | `CONFIRMED` | Mantido; tokens server-side criptografados e retenção externa explicitada. |
| Google Play Billing ausente | `OUTDATED` por omissão | Adicionado ao inventário e à política. |
| Telemetria “opcional” e “anônima” | `OUTDATED` | Removido. Analytics e Performance inicializam por padrão e não têm opt-out interno. |
| Telemetria não contém dados específicos de produto | `UNSUPPORTED` | Removido; eventos podem conter IDs, nomes e valores comerciais. |
| Configurações armazenadas no Firebase Authentication | `OUTDATED` | Corrigido: autenticação no Auth; configurações/dados operacionais no Firestore. |
| Todos os dados usam TLS 1.3+ | `UNSUPPORTED` | Substituído por HTTPS; versão exata depende da infraestrutura/provedor. |
| Criptografia em repouso por Google Cloud | `CONFIRMED` no escopo do provedor | Redação limita a promessa ao controle oferecido por cada provedor. |
| Tokens Mercado Pago em AES-256-GCM | `CONFIRMED` | Mantido de modo público sem detalhes de chave. |
| Exclusão completa em até 30 dias | `OUTDATED` | Prazo removido; fluxo e retenções reais documentados. |
| Exclusão in-app e página externa | `CONFIRMED` | URL, confirmação, blockers e suporte documentados. |
| Todos os dados desaparecem na exclusão | `OUTDATED` | Corrigido: tombstone, hash antifraude e registros de provedores são exceções atuais. |
| Logs retidos por 90 dias e depois agregados | `UNSUPPORTED` | Removido; prazo está como `NEEDS_POLICY_DECISION`. |
| Opt-out de telemetria disponível | `OUTDATED` | Removido e gap declarado. |
| Portabilidade em formato garantido | `NEEDS_POLICY_DECISION` | Substituído por canal de solicitação, sem prometer formato não implementado. |
| Firebase/Vercel “sob contrato/DPA” | `UNSUPPORTED` pelo código | Menção contratual removida; status contratual deve ser validado fora do repositório. |
| Catálogo pode ser desabilitado | `CONFIRMED` | Mantido. |
| Clientes nunca são compartilhados | `OUTDATED` como absoluto | Corrigido: não são públicos, mas dados necessários à cobrança podem ir ao Mercado Pago. |
| Público de 18 anos ou mais | `NEEDS_POLICY_DECISION` | Mantido como posicionamento do produto; precisa validação jurídica/Play de target audience. |
| Conta de menor é automaticamente excluída | `UNSUPPORTED` | Removido; policy orienta contato e verificação. |
| Mudanças sempre notificadas por app/e-mail | `UNSUPPORTED` | Removido; não há mecanismo garantido no checkout. |
| Uso contínuo equivale a consentimento | `NEEDS_POLICY_DECISION` | Removido por ser conclusão jurídica, não comportamento técnico. |
| Conformidade conclusiva com LGPD/GDPR/COPPA | `UNSUPPORTED` como conclusão técnica | Removida; exige análise jurídica específica. |
| Código não vende dados para publicidade | `CONFIRMED` no checkout | Mantido com escopo explícito de auditoria de código, não como conclusão sobre operações externas. |

## Matriz preparatória para o formulário Data Safety

Esta tabela usa categorias compatíveis com o formulário, mas **não decide** as respostas do Play Console.

| DATA TYPE | COLLECTED? | SHARED? | PURPOSE | OPTIONAL? | ENCRYPTED IN TRANSIT? | USER CAN DELETE? | PROCESSOR | EVIDENCE |
|---|---|---|---|---|---|---|---|---|
| Personal info — Email address | Sim | `PLAY_CONSOLE_DECISION_REQUIRED` (Firebase como service provider; MP pode receber e-mail em fluxos escolhidos) | Account management, app functionality, payments | Conta: não; MP: opcional por feature | HTTPS observado; declaração global exige validação de produção | Sim para conta operacional; registros de provider têm exceções | Firebase Auth, Mercado Pago | Auth, conexão MP e deletion flow |
| Personal info — User IDs | Sim | `PLAY_CONSOLE_DECISION_REQUIRED` | Account management, security, analytics | Não para conta/SDKs atuais | HTTPS observado; validar SDKs/configuração | Em geral sim; hashes/tombstone são exceções | Firebase/Google, infraestrutura | UID em Auth/Firestore/logs mascarados |
| Personal info — Name | Sim quando informado (loja, cliente ou conta MP) | `PLAY_CONSOLE_DECISION_REQUIRED` | App functionality, account/payment features | Funcionalidade dependente | HTTPS observado | Dados operacionais: sim; provider: depende | Firebase, Mercado Pago | Settings, clients, MP `/users/me` |
| Personal info — Phone number | Sim quando lojista cadastra cliente ou WhatsApp público | Sim quando o lojista publica/usa cobrança; classificação final necessária | CRM, catálogo público, payment functionality | Sim por feature/campo | HTTPS observado | Operacional: sim; publicação controlável | Firebase, visitantes do catálogo, Mercado Pago quando aplicável | Clientes, public catalog, cobranças |
| Personal info — Other info | Sim (loja, nichos, marca, descrição, preferências) | `PLAY_CONSOLE_DECISION_REQUIRED` | App functionality, personalization | Parcial | HTTPS observado | Sim para dados operacionais | Firebase; visitantes para campos públicos | Settings/products/catalog |
| Financial info — Purchase history | Sim | `PLAY_CONSOLE_DECISION_REQUIRED` | Payments, subscription management, fraud prevention | Pagamentos são opcionais; metadados exigidos quando usados | HTTPS observado | Parcial; hash antifraude e provider records permanecem | Mercado Pago, Google Play, Firebase | Sales/charges/subscriptions/Play verification |
| Photos and videos — Photos | Sim quando o usuário envia imagens | `PLAY_CONSOLE_DECISION_REQUIRED`; catálogo torna imagens escolhidas públicas | App functionality, catalog, Marketing | Sim por feature | HTTPS observado | Sim no Storage da conta; caches dependem do dispositivo | Firebase/Google; visitantes do catálogo | Uploads, products, approved cutouts |
| App activity — App interactions | Sim por padrão | `PLAY_CONSOLE_DECISION_REQUIRED` pela exceção de service provider | Analytics, app functionality | **Não há opt-out interno** | SDK usa transporte do provedor; confirmar declaração final | Não há exclusão específica demonstrada no Analytics | Firebase Analytics | Inicialização e eventos do SDK |
| App activity — User-generated content | Sim (produtos, clientes, textos/anúncios) | `PLAY_CONSOLE_DECISION_REQUIRED` conforme feature/publicação | App functionality | Necessário para cada conteúdo criado | HTTPS observado | Sim para dados operacionais | Firebase; MP/visitantes quando o usuário aciona/publica | Produtos, CRM, Marketing, catálogo |
| App activity — Other actions | Sim (onboarding, vendas, compartilhamentos, eventos) | `PLAY_CONSOLE_DECISION_REQUIRED` | Analytics, functionality, fraud prevention | Analytics sem opt-out | SDK/HTTPS; validar produção | Operacional sim; analytics depende do provedor | Firebase Analytics/Firestore | Event map e documentos operacionais |
| App info and performance — Crash logs | Condicional | `PLAY_CONSOLE_DECISION_REQUIRED` | Diagnostics | Sentry server condicionado a DSN; React ErrorBoundary e handlers globais client registram diagnóstico local; Crashlytics nativo ausente | HTTPS/SDK; validar produção | Não demonstrado por usuário | Sentry se configurado | `server/index.ts`, `client/src/components/GlobalErrorBoundary.tsx`, `client/src/lib/client-diagnostics.ts` |
| App info and performance — Diagnostics | Sim/condicional conforme ambiente | `PLAY_CONSOLE_DECISION_REQUIRED` | Diagnostics, security | Sem opt-out interno | HTTPS/SDK; validar produção | Não demonstrado | Firebase, Cloud Run, Sentry condicional | Performance, logs, request IDs, client diagnostics |
| App info and performance — Other app performance data | Sim por padrão | `PLAY_CONSOLE_DECISION_REQUIRED` | Performance monitoring | **Não há opt-out interno** | SDK do Firebase; confirmar declaração final | Não demonstrado | Firebase Performance | Inicialização default e traces |
| Device or other IDs | Provável pelos SDKs/infraestrutura; confirmar relatório dos SDKs | `PLAY_CONSOLE_DECISION_REQUIRED` | Analytics, diagnostics, security | Sem opt-out interno | SDK/HTTPS; validar produção | Não demonstrado | Firebase/Google, infraestrutura, Sentry condicional | Analytics/Performance, user agent e logs |
| Location — Approximate location | `PLAY_CONSOLE_DECISION_REQUIRED` | `PLAY_CONSOLE_DECISION_REQUIRED` | Pode ser inferida de IP por SDK/infraestrutura; app não solicita localização Android | Não há controle dedicado | Depende do processor | Não demonstrado | Firebase/Google, Vercel/Cloud Run | Sem permissão de localização; IP existe no transporte |

## Registro de retenção e decisões pendentes

| CATEGORIA | ESTADO | AÇÃO NECESSÁRIA |
|---|---|---|
| Conta Auth, Firestore do usuário e Storage `users/{uid}/` | `UNTIL_ACCOUNT_DELETION` | Manter teste de integração de exclusão. |
| Cache local e IndexedDB no dispositivo que executa a exclusão | `KNOWN` (limpeza implementada para dados associados) | Documentar limites em outros dispositivos/sessões. |
| Tombstone `account_deletion_requests/{uid}` | `NEEDS_POLICY_DECISION` | Definir finalidade formal e prazo; implementar expiração se aprovada. |
| `googlePlayPurchaseTokens/{hash}` | `NEEDS_POLICY_DECISION` | Definir prazo/base de prevenção de fraude e tratamento após exclusão. |
| Dados e logs do Mercado Pago | `PROVIDER_CONTROLLED` | Confirmar contrato, política e processo para pedidos de titular. |
| Histórico de compra Google Play | `PROVIDER_CONTROLLED` | Confirmar documentação e responsabilidades do provider. |
| Firebase Analytics e Performance | `PROVIDER_CONTROLLED` + `NEEDS_POLICY_DECISION` | Confirmar settings de retenção no console e decisão de consentimento/opt-out. |
| Sentry | `PROVIDER_CONTROLLED` + `NEEDS_POLICY_DECISION` | Confirmar se DSN está ativo em produção e configurar prazo. |
| Logs Cloud Run/Vercel/Firebase | `PROVIDER_CONTROLLED` + `NEEDS_POLICY_DECISION` | Inventariar configurações reais de produção e prazos. |
| Evidências financeiras internas | `NEEDS_POLICY_DECISION` | Decisão jurídica/contábil antes de prometer ou implementar retenção. |

## URLs públicas, contato e estado de produção

Verificação sem login realizada em **18 de agosto de 2026**. O status HTTP foi confrontado com o conteúdo retornado e, para a rota SPA, com a página efetivamente renderizada em navegador.

| ITEM | VALOR | STATUS |
|---|---|---|
| Suporte/privacidade | `revendasmart.suporte@gmail.com` | Configurado no app e na documentação |
| Privacy URL (canônica) | `https://revendasmart.vercel.app/privacy-policy` | Alias amigável e estável para Play Console; no código local aponta para o mesmo conteúdo de `/api/legal/privacy-policy` |
| Terms URL (canônica) | `https://revendasmart.vercel.app/terms-of-service` | Alias amigável e estável para Play Console; no código local aponta para o mesmo conteúdo de `/api/legal/terms-of-service` |
| Account deletion URL (canônica) | `https://revendasmart.vercel.app/account-deletion` | Rota pública do app, sem login obrigatório para abrir; bundle local já expõe instruções e fluxo coerentes |
| URLs antigas preservadas | `/api/legal/privacy-policy`, `/api/legal/terms-of-service` | Mantidas como alias para não quebrar referências existentes |
| Identidade jurídica/endereço do responsável | Não consta no checkout | **BLOCKER / NEEDS_POLICY_DECISION** |

**PRIVACY_POLICY_CANONICAL_URL:** `https://revendasmart.vercel.app/privacy-policy`  
**TERMS_CANONICAL_URL:** `https://revendasmart.vercel.app/terms-of-service`  
**ACCOUNT_DELETION_CANONICAL_URL:** `https://revendasmart.vercel.app/account-deletion`

## Pendências antes de preencher o Play Console

1. `PLAY_CONSOLE_DECISION_REQUIRED`: confirmar a interpretação de “shared” para cada service provider e o uso público intencional do catálogo.
2. Confirmar em produção as configurações e retenções de Firebase Analytics, Performance, Cloud Logging, Vercel e Sentry.
3. Decidir se haverá consentimento/opt-out de Analytics e Performance; hoje ambos inicializam por padrão.
4. Formalizar prazos para tombstone, hash de purchase token, logs e evidências financeiras.
5. Confirmar identidade jurídica, endereço e papéis de controlador/processador; o código não prova contratos/DPA.
6. Rever documentação de cada SDK na versão efetivamente embutida no AAB e comparar com o inventário.
7. Publicar a policy e os termos alinhados; as URLs atuais ainda servem os documentos antigos.
8. Revalidar externamente as três URLs canônicas após deploy da versão alinhada.
9. Revalidar publicamente as três URLs após deploy e concluir revisão jurídica da política.

## Atualizações da REVENDASMART-LGPD-ANPD-REMEDIATION-01

- Classificação do Photoroom corrigida de `SMOKE_ONLY`/`NOT_IN_PRODUCTION` para `IMPLEMENTED` (ver seção acima) — a versão anterior deste documento e a Política de Privacidade estavam desatualizadas e afirmavam o oposto do que o código realmente faz. Este era o achado P0 da auditoria original.
- Chave Pix: o valor não vai mais na carga pública inicial do catálogo (só um booleano `pixAvailable`); o valor real agora é servido sob demanda por um endpoint dedicado, chamado apenas quando o comprador chega na etapa de pagamento por Pix. Ver `server/public-catalog.ts` e `client/src/pages/public-catalog.tsx`.
- Regra do Firestore para `sales/{saleId}` não aceita mais `create` direto do cliente — só o backend (Admin SDK, transação com recálculo de total/estoque) grava vendas.
- Documentos novos desta remediação, referenciados aqui para quem for preencher o formulário Data Safety: `docs/DATA_RETENTION_REGISTER.md`, `docs/INTERNATIONAL_DATA_TRANSFER_REGISTER.md`, `docs/DATA_SUBJECT_REQUEST_PROCEDURE.md`, `docs/PRIVACY_INCIDENT_RESPONSE.md`, `docs/DPO_SMALL_PROCESSING_AGENT_ASSESSMENT.md`, `docs/TERMS_LEGAL_REVIEW_ITEMS.md`.
- As pendências 1-9 acima **continuam pendentes** — esta remediação corrigiu o achado P0 e vários P1 técnicos, mas não substitui as decisões jurídicas/operacionais listadas.

**PLAY_DATA_SAFETY_MATRIX_STATUS:** `READY_FOR_OWNER_AND_LEGAL_DECISIONS`  
**LOCAL_PRODUCTION_BUNDLE_ROUTING_STATUS:** `READY`  
**PRODUCTION_LEGAL_URLS_STATUS:** `PENDING_EXTERNAL_VERIFICATION`  
**PLAY_CONSOLE_SUBMISSION_STATUS:** `NOT_READY`
