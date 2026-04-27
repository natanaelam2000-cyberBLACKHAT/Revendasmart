# RevendaSmart — Documentação de Projeto

## Status Atual
- **Versão:** Phase 2 + Multi-Nicho ✅ COMPLETO
- **Segurança:** Autenticação obrigatória em todas as rotas protegidas
- **Backend:** Node.js/Express + Firebase Admin SDK + Firestore
- **Multi-Nicho:** Suporte completo a múltiplos tipos de negócio (checkbox multi-seleção)
- **Ícone Oficial:** RevendaSmart v1.0 ✅ FINALIZADO (loja com crescimento, gradiente azul/roxo)

## Arquitetura
- **Frontend:** React + Wouter + Firebase Auth (client SDK)
- **Backend:** Express + Firestore + Firebase Admin SDK
- **Auth Strategy:** 
  - Client: Firebase Auth (email/password signup/login)
  - API: Bearer token (Firebase ID token) obrigatório
  - Storage: Firestore (user_settings collection)

## Status de Cada Fase

### ✅ Fase 1: Restauração & Validação
- Código base restaurado
- Servidor funcional internamente

### ✅ Fase 2: Autenticação Endurecida
- `requireAuth` middleware: retorna **401 Unauthorized** sem token
- `requireOwnership` middleware: retorna **403 Forbidden** para outro usuário
- Rotas protegidas:
  - `GET /api/user/settings/:userId` — requer token + ownership
  - `POST /api/user/settings/:userId` — requer token + ownership
- Rota pública:
  - `GET /health` — sem autenticação

### 📋 Fase 3: Recuperação de Dados Antigos
- Mapping do localStorage antigo para Firestore
- Não iniciado

### 📋 Fase 4: Migração Gradual
- Frontend tenta API primeiro, fallback localStorage
- Não iniciado

### 📋 Fase 5: Remoção Controlada de Legacy
- Remover localStorage antigo
- Não iniciado

## Testes Internos

### Testes de Autenticação Endurecida (7/7 ✅)
```
✅ GET sem token → 401 Unauthorized
✅ GET com token inválido → 401 Unauthorized
✅ GET com outro usuário (token inválido) → 401 Unauthorized
✅ POST sem token → 401 Unauthorized
✅ POST com token inválido → 401 Unauthorized
✅ POST com outro usuário (token inválido) → 401 Unauthorized
✅ GET /health (sem token) → 200 OK
```

### Testes Anteriores (test-internal.ts)
- Agora retornam 401 em vez de 200 (comportamento anterior de soft-fail)
- Isso é esperado e correto

## Multi-Nicho (Suporte a Múltiplos Tipos de Negócio)

### Fonte única de verdade
- `client/src/lib/nicho-config.ts` — Configuração de todos os 5 nichos (categorias, marcas, campos extras, filtros de catálogo)

### Modelo de dados
- `AppSettings.businessType: string` — nicho primário (backward compat com usuários antigos)
- `AppSettings.businessTypes?: string[]` — array de nichos (novo, multi-seleção)
- `AppSettings.storeNamesByNicho?: Record<string, string>` — nomes de loja específicos por nicho (futura-proof, opcional)
- `Product.productType?: string` — tipo de produto associado ao nicho
- Helper `toBusinessTypesArray(businessType, businessTypes)` — converte legado → array
- Helper `getStoreName(settings, nicho)` — retorna nome da loja para nicho (fallback para storeName padrão)

### Estratégia de Nome de Loja (Futuro-Proof)
**Hoje:**
- Campo `storeName` único mantido (simples, retrocompatível)

**Futuro (sem reestruturação):**
- Adicionar `storeNamesByNicho` com nomes específicos por nicho
- `getStoreName(settings, 'Cosméticos & Perfumes')` → busca em `storeNamesByNicho['Cosméticos & Perfumes']`
- Fallback automático: se não existir nome específico, usa `storeName` padrão
- Exemplo: `{ storeName: 'Loja Padrão', storeNamesByNicho: { 'Roupas': 'Boutique Bella', 'Cosméticos & Perfumes': 'Beleza da Adri' } }`

**Por quê?**
- Evita reestruturação futura da modelagem
- Permite evolução gradual: sem quebra de compatibilidade
- Cada nicho pode ter identidade visual/nome distinto se desejar

### UI Multi-Nicho
- **Onboarding**: Checkboxes multi-seleção; envia `businessTypes[]` + `businessType` (primary)
- **Settings**: Checkboxes multi-seleção na aba Perfil; salva ambos os campos
- **Adicionar Produto**: Seletor de nicho ativo (quando >1 nicho selecionado), brand híbrido (predefined/custom para Cosméticos, livre para outros), categorias dinâmicas por nicho, campos extras isolados por nicho

### Nichos Suportados
1. `Cosméticos & Perfumes` — Marcas predefinidas (Natura, O Boticário, etc.), campos de volume/fragrância
2. `Roupas` — Campos de tamanho/cor/material
3. `Acessórios` — Campos de cor/material
4. `Alimentos/Doces` — Campos de peso/sabor/validade
5. `Geral` — Campo de observações livres

## Arquivos Principais

### Backend
- `server/index.ts` — Setup do Express + Vite + testes
- `server/routes.ts` — Rotas protegidas + middlewares de auth
- `server/firebase-admin-init.ts` — Inicialização do Firebase Admin
- `server/storage.ts` — Interface de armazenamento (Firestore)
- `server/test-internal.ts` — Testes de API (antigos, com soft-fail)
- `server/test-hardened.ts` — Testes de autenticação endurecida ✅
- `server/test-app-flows.ts` — Testes de fluxos da aplicação

### Frontend
- `client/src/lib/firebase.ts` — Firebase Auth init + utilitários
- `client/src/hooks/useUserSettings.ts` — Hook para carregar settings com token
- `client/src/pages/settings.tsx` — Painel de configurações (async logout)
- `client/src/pages/onboarding.tsx` — Fluxo de onboarding (envia token)
- `client/src/App.tsx` — App root + onboarding guard
- `client/src/components/layout.tsx` — Layout principal + admin check

## Configuração de Ambiente
- `MERCADOPAGO_ACCESS_TOKEN` — Secret (MercadoPago, não usado em Fase 2)
- Firebase credentials via `FIREBASE_SERVICE_ACCOUNT_KEY` (lido automaticamente)

## Próximos Passos (após Fase 2)
1. **Fase 3:** Identificar dados antigos em localStorage e mapear para Firestore
2. **Fase 4:** Implementar fallback gracioso no frontend (API → localStorage)
3. **Fase 5:** Remover localStorage após confirmar Firestore tem todos os dados

## Mercado Pago — Caminho B: Per-Revendedor OAuth

### Arquitetura
- Cada revendedor pode conectar sua própria conta MP via OAuth
- Tokens armazenados criptografados (AES-256-GCM) no Firestore
- Fallback automático para conta central se nenhuma conexão ativa

### Secrets Necessários
- `MERCADOPAGO_ACCESS_TOKEN` — Token da conta central (fallback)
- `MERCADOPAGO_WEBHOOK_SECRET` — Secret de validação de webhooks
- `MERCADOPAGO_CLIENT_ID` — App ID do MP (OAuth)
- `MERCADOPAGO_CLIENT_SECRET` — App Secret do MP (OAuth)
- `MERCADOPAGO_TOKEN_ENCRYPTION_KEY` — Chave AES-256-GCM (64 hex chars)
- `MERCADOPAGO_REDIRECT_URI` — env var (https://reseller-catalog-hub.replit.app/api/mercadopago/callback)

### Endpoints Backend
- `POST /api/mercadopago/start-auth` — Inicia OAuth (auth required)
- `GET  /api/mercadopago/callback` — Callback do MP (público, redireciona p/ frontend)
- `POST /api/mercadopago/revoke/:id` — Soft-revoke de conexão (auth required)
- `GET  /api/mercadopago/connections` — Lista conexões (auth required)
- `POST /api/mercadopago/set-default/:id` — Define padrão (auth required)

### Arquivos Principais
- `shared/connections.ts` — Tipos: MPConnection, MPOAuthState, EncryptedToken
- `shared/charges.ts` — Extendido com mpConnectionId + tokenSource
- `server/mercadopago-crypto.ts` — Encrypt/Decrypt AES-256-GCM
- `server/mercadopago-connections.ts` — Todas as rotas OAuth + getValidMPAccessToken
- `server/payments.ts` — Usa getValidMPAccessToken (Caminho B integrado)
- `client/src/hooks/useMPConnections.ts` — Hook real-time + helpers de API
- `client/src/pages/settings-mercadopago.tsx` — Página de gestão de conexões
- `client/src/components/PaymentLinkModal.tsx` — Seletor de conta MP

### Firestore Paths
- `users/{uid}/mercadopago_connections/{id}` — Conexões do revendedor
- `mercadopago_oauth_states/{nonce}` — Nonces OAuth (TTL: 10min, server-side)

### Fluxo OAuth
1. Frontend chama `POST /api/mercadopago/start-auth` → retorna authUrl
2. Usuário é redirecionado para MP
3. MP redireciona para `/api/mercadopago/callback?code=...&state={nonce}`
4. Backend valida nonce, troca code por tokens, criptografa, salva no Firestore
5. Redireciona para `${FRONTEND_URL}/settings/mercadopago?status=success`

## Documentos Legais (Play Store)

### Arquivos
- `client/public/privacy-policy.md` — Política de Privacidade (LGPD, GDPR, COPPA compliant)
- `client/public/terms-of-service.md` — Termos de Serviço (direitos e responsabilidades)

### Rotas Públicas
- `GET /api/legal/privacy-policy` — Retorna Política de Privacidade em markdown
- `GET /api/legal/terms-of-service` — Retorna Termos de Serviço em markdown

### Frontend
- Nova aba "Legal" em Configurações (Settings) → acesso rápido aos documentos
- Links atualizados em aba "Sobre" para apontar às rotas públicas
- test IDs: `link-privacy-policy`, `link-terms-of-service`

### Contato de Suporte
- E-mail: `support@revendasmart.com` (substituir por e-mail real antes de publicar)

### URLs para Google Play Console
- Privacy Policy: `{backend_url}/api/legal/privacy-policy`
- Terms of Service: `{backend_url}/api/legal/terms-of-service`

## Central de Ajuda (Closed Testing / Play Store)

### Localização
- **Configurações → Aba "Ajuda"** (novo, com ícone de interrogação)

### Conteúdo (9 Seções Accordion)
1. 🚀 **Primeiros Passos** — Onboarding rápido (criar conta → compartilhar catálogo)
2. 📦 **Como Cadastrar Produto** — Step-by-step completo com dicas
3. 🏪 **Como Usar o Catálogo** — URL pública, filtros, compartilhamento
4. 📢 **Como Gerar Anúncio / Marketing** — Copywriting com emoji para redes sociais
5. 💰 **Como Registrar Venda** — Fluxo completo de venda (cliente → carrinho → pagamento)
6. 🔗 **Como Usar Cobranças / Links de Pagamento** — MercadoPago integration
7. ⚙️ **Como Configurar Tipo de Negócio** — Multi-nicho (Cosméticos, Roupas, etc)
8. ❓ **Dúvidas Frequentes** — FAQ com respostas práticas
9. 📧 **Contato de Suporte** — E-mail + expectativa de resposta (24h)

### Estrutura Técnica
- **Componente:** Accordion colapsável
- **Estado:** `openHelpIndex` (número | null) — controla qual item está expandido
- **Ação:** Click para expandir/recolher com animação
- **Visual:** ChevronDown com rotação em 180° quando aberto

### E-mail de Suporte Oficial
```
revendasmart.suporte@gmail.com
Resposta em até 24h
```

### Test IDs
- `help-item-{0-8}` — Cada seção do accordion (9 itens)
- `button-support-email` — Botão "Enviar E-mail"

### Mobile-Friendly
- ✅ Cards com espaçamento adequado
- ✅ Accordion funciona bem em tela pequena
- ✅ Scroll suave com `pb-20` (padding-bottom para espaço após CTA)
- ✅ Botões e links em tamanho clicável (44px mínimo)

### Preparado para Expansão
- Estrutura `.map()` permite adicionar mais items facilmente
- Cada item é object com `{ title, content }`
- Novos itens podem incluir links, imagens, etc. com mínimas alterações
