# Política de Privacidade — RevendaSmart

**Última atualização:** 31 de março de 2026

## 1. Introdução

RevendaSmart é um aplicativo móvel (PWA) desenvolvido para ajudar revendedores independentes de beleza, moda, acessórios e alimentos a gerenciar seus negócios e catálogos online.

Esta Política de Privacidade explica como coletamos, usamos, armazenamos e protegemos seus dados pessoais.

---

## 2. Controlador de Dados

**RevendaSmart**  
Fornecedor: Replit  
Contato: [support@revendasmart.com]

---

## 3. Dados que Coletamos

### 3.1 Dados de Autenticação
- **E-mail** — Necessário para criar sua conta e fazer login
- **Senha** — Armazenada com hash seguro, nunca em texto plano
- **ID único do usuário (UID)** — Gerado automaticamente pelo Firebase

### 3.2 Dados de Perfil
- **Nome da loja** — Nome do seu negócio
- **Tipo(s) de negócio** — Categoria(s) que você vende (Cosméticos, Roupas, Acessórios, Alimentos, Geral)
- **Configurações de catálogo** — Slug público do seu catálogo, nomes de loja por tipo de negócio
- **Localização** — País/estado para onboarding (não armazenado permanentemente)

### 3.3 Dados de Produtos
- **Nome, marca, categoria, preço de custo e venda**
- **Estoque, descrição, imagens** — Armazenadas em Google Cloud Storage (Firebase)
- **Campos específicos do nicho** — Tamanho, cor, material (Roupas); volume, fragrância (Cosméticos), etc.
- **Público/Gênero** — Para Roupas (Feminino, Masculino, Unissex, etc.)

### 3.4 Dados de Catálogo Público
- **Slug do catálogo** — URL pública e compartilhável (ex: `revendasmart.vercel.app/u/seu-catalogo`)
- **Produtos visíveis** — Apenas produtos com estoque > 0 aparecem no catálogo

### 3.5 Dados de Vendas
- **Clientes** — Nome, contato (WhatsApp/telefone), primeira data de contato
- **Histórico de vendas** — Produtos vendidos, datas, valores, status de pagamento
- **Cobranças** — Links de pagamento gerados via MercadoPago

### 3.6 Dados de Pagamento (MercadoPago)
Se você conectar uma conta MercadoPago:
- **Token de autenticação OAuth** — Criptografado com AES-256-GCM antes de armazenar
- **ID da transação, status de pagamento** — Sincronizados com MercadoPago
- **Não armazenamos** — dados de cartão, chaves privadas ou senhas da sua conta MP

### 3.7 Dados de Telemetria (Opcional)
- **Eventos anônimos** — Quais funcionalidades você usa (fluxo de onboarding, vendas, etc.)
- **Performance** — Tempo de carregamento, erros técnicos
- **Não coletamos** — Conteúdo específico dos seus dados, apenas padrões de uso

---

## 4. Como Usamos Seus Dados

### 4.1 Para Funcionar o App
- ✅ Autenticar você de forma segura
- ✅ Sincronizar seus produtos, clientes e vendas
- ✅ Gerar links de pagamento via MercadoPago
- ✅ Exibir seu catálogo público

### 4.2 Para Melhorar o App
- ✅ Analisar recursos mais usados (telemetria)
- ✅ Corrigir bugs e erros técnicos
- ✅ Desenvolver novas funcionalidades

### 4.3 NÃO Fazemos
- ❌ Vender seus dados para terceiros
- ❌ Usar seu e-mail para marketing não solicitado
- ❌ Acessar conteúdo dos seus produtos para fins comerciais próprios
- ❌ Compartilhar dados de clientes sem seu consentimento

---

## 5. Armazenamento de Dados

### 5.1 Onde Armazenamos
- **Autenticação & Configurações** — Firebase Authentication (Google Cloud, multi-região)
- **Produtos, clientes, vendas** — Firestore (Google Cloud, criptografia em repouso)
- **Imagens de produtos** — Google Cloud Storage
- **Tokens MercadoPago** — Firestore (criptografados com AES-256-GCM)

### 5.2 Segurança
- Todos os dados em trânsito usam **HTTPS/TLS 1.3+**
- Dados em repouso são **criptografados por padrão** pelo Google Cloud
- Senhas são **hasheadas** com bcrypt, nunca armazenadas em texto plano
- Tokens MercadoPago são **criptografados com chave privada** (AES-256-GCM)

### 5.3 Retenção de Dados
- **Enquanto você tiver a conta ativa** — Todos os seus dados são mantidos
- **Após exclusão da conta** — Seus dados são **permanentemente deletados** em até 30 dias
- **Logs de telemetria** — Retidos por 90 dias, depois agregados anonimamente

---

## 6. Seus Direitos

Você tem direito a:

### 6.1 Acesso
- Solicitar cópia de todos os seus dados pessoais

### 6.2 Retificação
- Corrigir informações incorretas sobre você

### 6.3 Exclusão
- Deletar sua conta e todos os dados associados (pressione "Sair" → "Deletar Conta" nas Configurações)

### 6.4 Portabilidade
- Solicitar seus dados em formato estruturado e legível

### 6.5 Oposição
- Optar por não receber telemetria anônima

Para exercer qualquer direito, envie e-mail para **[support@revendasmart.com]**

---

## 7. Compartilhamento de Dados

### 7.1 Terceiros que Acessam seus Dados
- **Google Cloud / Firebase** — Infraestrutura de hospedagem (sob contrato de DPA)
- **MercadoPago** — Apenas se você conectar uma conta para pagamentos (sob seus termos)
- **Vercel** — Hospedagem do frontend (sob contrato)

### 7.2 Seu Catálogo Público
- Sua **URL de catálogo é pública** (ex: `revendasmart.vercel.app/u/seu-catalogo`)
- Qualquer pessoa com a URL pode ver seus produtos e estoque
- Você pode **desativar o catálogo público** nas Configurações a qualquer momento

### 7.3 Dados de Clientes
- Seus clientes (contatos) são **privados** e armazenados apenas para você
- Não compartilhamos histórico de clientes com ninguém

---

## 8. Menores de Idade

RevendaSmart é destinado apenas a usuários com **18 anos ou mais**.

Se você é menor de 18 anos:
- Não crie uma conta
- Se criar, sua conta será deletada

Se você é responsável por um menor que criou uma conta, entre em contato: **[support@revendasmart.com]**

---

## 9. Alterações nesta Política

Podemos atualizar esta Política de Privacidade a qualquer momento. Mudanças significativas serão comunicadas via:
- Notificação no app
- E-mail (se exigido por lei)

Seu uso contínuo do app após mudanças significa consentimento.

---

## 10. Contato & Reclamações

### Perguntas sobre Privacidade
E-mail: **[support@revendasmart.com]**

### Reclamação de Privacidade
Se você acredita que seus direitos de privacidade foram violados, você pode:
1. Entrar em contato conosco (contato acima)
2. Apresentar reclamação formal à autoridade de proteção de dados da sua jurisdição

---

## 11. Conformidade Legal

Esta Política segue as exigências de:
- **LGPD** (Lei Geral de Proteção de Dados — Brasil)
- **GDPR** (General Data Protection Regulation — Europa)
- **COPPA** (Children's Online Privacy Protection Act — EUA, se aplicável)
- **Termos da Google Play** (Transparência de Dados)

---

**Data de Vigência:** 31 de março de 2026
