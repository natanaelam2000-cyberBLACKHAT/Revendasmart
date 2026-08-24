# Política de Privacidade — RevendaSmart

**Última atualização:** 20 de agosto de 2026

## 1. Escopo

O RevendaSmart é um aplicativo para organização de produtos, clientes, vendas, cobranças, catálogos públicos e materiais de divulgação de revendedores. Esta política descreve o tratamento de dados observado na versão atual do aplicativo, incluindo a versão web/PWA e o aplicativo Android.

## 2. Responsável e contato

- **Serviço:** RevendaSmart
- **Contato de suporte e privacidade:** revendasmart.suporte@gmail.com
- **Política de Privacidade:** https://revendasmart.vercel.app/privacy-policy
- **Termos de Uso:** https://revendasmart.vercel.app/terms-of-service
- **Exclusão de conta fora do aplicativo:** https://revendasmart.vercel.app/account-deletion

## 3. Dados tratados

### 3.1 Conta e autenticação

- endereço de e-mail;
- identificador de usuário gerado pelo Firebase;
- credenciais e sessões necessárias à autenticação.

A autenticação e o tratamento da senha são realizados pelo Firebase Authentication. O RevendaSmart não armazena a senha em texto simples nem define, no código do aplicativo, o algoritmo de hash usado pelo provedor.

### 3.2 Loja, preferências e catálogo

- nome, descrição, identidade visual e configurações da loja;
- nichos, preferências, plano e estado do onboarding;
- slug, configurações e informações de contato do catálogo público;
- dados de produtos, incluindo nome, marca, categoria, descrição, preços, estoque e atributos próprios do nicho.

Quando o catálogo público está habilitado, as informações configuradas para publicação, inclusive produtos, preços, disponibilidade, imagens e contato comercial, podem ser vistas por qualquer pessoa que acesse a URL pública. O catálogo pode ser desabilitado nas configurações.

### 3.3 Imagens e materiais de divulgação

- imagens de produtos, logotipo e imagens do catálogo;
- recortes aprovados de produtos e seus metadados técnicos, quando existentes;
- anúncios, textos e histórico de materiais de Marketing salvos pelo usuário.

Imagens e arquivos enviados ficam associados à conta e podem ser armazenados no Firebase Cloud Storage. O aplicativo também pode manter cópias e referências locais no navegador ou dispositivo para preview, histórico e uso offline.

**Remoção de fundo (recurso Premium, via Photoroom):** quando o usuário Premium aciona a remoção automática de fundo de uma imagem de produto, o arquivo original dessa imagem é enviado ao provedor **Photoroom** exclusivamente para a finalidade de segmentação/remoção de fundo. A imagem original enviada não é modificada nem substituída: o resultado do processamento (o recorte) é armazenado como um arquivo derivado separado, associado ao mesmo produto. O acionamento é sempre uma ação explícita do usuário Premium sobre uma imagem específica — o recurso não roda em segundo plano nem sobre imagens não selecionadas. A Photoroom é fornecedora terceira e esse tratamento pode envolver transferência internacional de dados (a confirmar/documentar formalmente — ver seção 5). Prazo de retenção da imagem pelo próprio provedor Photoroom depende dos termos e práticas dele, que ainda precisam de confirmação contratual; esta política não promete um prazo que o RevendaSmart não controla. Direitos sobre esse tratamento específico podem ser exercidos pelo canal de contato desta política (seção 11).

### 3.4 Clientes, vendas e cobranças

- nome e telefone/WhatsApp de clientes informados pelo lojista;
- datas de contato, observações e histórico comercial;
- pedidos, itens, valores, descontos, vencimentos, parcelas e status;
- links e identificadores de cobrança e pagamento.

Esses dados são usados para as funções de gestão do próprio lojista e não fazem parte do catálogo público.

### 3.5 Mercado Pago

Quando o usuário conecta o Mercado Pago ou usa um fluxo de pagamento compatível:

- dados de conexão da conta do lojista e identificadores da conta podem ser consultados no Mercado Pago;
- tokens OAuth são armazenados no servidor de forma criptografada;
- identificadores, status e metadados das transações podem ser armazenados e sincronizados;
- informações necessárias à cobrança são transmitidas ao Mercado Pago.

O RevendaSmart não armazena dados completos de cartão nem a senha da conta Mercado Pago. Registros mantidos pelo Mercado Pago seguem as práticas e obrigações do próprio provedor.

### 3.6 Google Play Billing

No Android, assinaturas podem ser processadas pelo Google Play Billing. O token de compra é enviado ao backend para validação com o Google Play. O token bruto não é persistido pelo RevendaSmart; são armazenados um hash do token e metadados server-owned de produto, pedido, status e validade da assinatura. O Google mantém os registros de compra sob suas próprias práticas.

### 3.7 Analytics, performance e diagnóstico

A versão atual inicializa Firebase Analytics e Firebase Performance por padrão. Esses serviços podem tratar:

- interações com telas e funcionalidades;
- eventos de produto e operação, que podem incluir identificadores, nomes e valores comerciais;
- métricas de carregamento, rede e desempenho;
- identificadores e metadados técnicos fornecidos pelos SDKs, pelo navegador ou pelo dispositivo.

No cliente, diagnósticos locais podem registrar mensagens sanitizadas no console do navegador/dispositivo para depuração durante o uso da sessão. No servidor, o Sentry só é ativado quando configurado e está programado para não enviar PII por padrão; logs estruturados incluem dados como request ID, rota normalizada, status e duração.

Não existe, na versão atual, uma tela de consentimento ou opção interna para desativar Firebase Analytics e Firebase Performance. A telemetria interna legada do RevendaSmart está desativada e não grava a antiga coleção `analytics_events`.

### 3.8 Metadados técnicos e armazenamento local

Servidores e provedores podem processar endereço IP, informações do navegador/dispositivo, versão do aplicativo, timestamps, rotas e identificadores técnicos para entregar o serviço, diagnosticar falhas e prevenir abuso. O aplicativo usa armazenamento local e IndexedDB para sessão, preferências, caches, histórico e imagens associadas à conta.

## 4. Finalidades

Os dados são tratados para:

- autenticar e manter a conta;
- sincronizar e exibir produtos, clientes, vendas, cobranças e catálogos;
- processar e verificar pagamentos e assinaturas;
- armazenar e compartilhar materiais solicitados pelo usuário;
- medir desempenho e uso do produto;
- diagnosticar erros, proteger o serviço e prevenir abuso ou repetição indevida de transações;
- atender solicitações de suporte e exclusão.

O código auditado não contém integração de venda de dados para publicidade de terceiros.

## 5. Provedores e compartilhamento

O tratamento necessário às funções acima pode envolver:

- **Google/Firebase:** Authentication, Firestore, Cloud Storage, Analytics, Performance e Remote Config;
- **Google Cloud Run:** execução do backend;
- **Vercel:** entrega do frontend e roteamento;
- **Mercado Pago:** conexão de conta, cobranças e pagamentos quando o usuário escolhe usar o serviço;
- **Google Play:** compra e verificação de assinaturas no Android;
- **Photoroom:** processamento de imagem para remoção de fundo, somente quando o usuário Premium aciona esse recurso sobre uma imagem específica (ver seção 3.3);
- **Sentry:** diagnóstico de erros do servidor somente quando configurado.

O runtime de produção do Marketing Pro usa hoje um gerador determinístico local — nenhuma imagem de produto ou dado do usuário é enviado a um provedor externo de geração de imagem ou texto por IA através dessa funcionalidade. Isso é independente do recurso de remoção de fundo (Photoroom), que já está ativo em produção conforme descrito na seção 3.3. Gemini/Google AI está integrado ao código do backend, mas as funcionalidades que o acionariam não estão habilitadas nas configurações verificadas nesta auditoria; uma eventual ativação futura será refletida nesta política antes de entrar em produção. OpenAI e Black Forest Labs existem apenas em harnesses locais de benchmark/smoke e não são chamados pelo runtime de produção.

## 6. Armazenamento e segurança

Dados de autenticação são tratados pelo Firebase Authentication; dados operacionais e configurações ficam principalmente no Firestore; imagens ficam no Firebase Cloud Storage; caches e preferências também podem ficar no dispositivo.

As comunicações configuradas pelo aplicativo usam HTTPS. A criptografia em repouso e os protocolos exatos oferecidos pela infraestrutura dependem de cada provedor. Tokens OAuth do Mercado Pago são criptografados pelo backend antes da persistência. Nenhuma medida elimina todos os riscos, e detalhes internos de chaves ou controles não são expostos nesta política.

Parte dos provedores listados na seção 5 processa dados fora do Brasil (infraestrutura do Google/Firebase e do backend têm operação nos Estados Unidos; o processamento de remoção de fundo de imagem é realizado por um fornecedor com operação na União Europeia). Essa transferência internacional é necessária para operar as funcionalidades descritas. Os mecanismos contratuais específicos de cada provedor ainda estão em confirmação e não são objeto de promessa nesta política.

## 7. Retenção e exclusão

### 7.1 Enquanto a conta está ativa

Dados operacionais são mantidos enquanto necessários às funções escolhidas pelo usuário. Prazos finais para logs, telemetria, tombstones e evidências financeiras ainda precisam de uma decisão formal de retenção; esta política não atribui prazos que não estejam implementados.

### 7.2 Exclusão da conta

Com login ativo, o usuário pode iniciar a exclusão em **https://revendasmart.vercel.app/account-deletion**. O fluxo exige confirmação explícita. Assinaturas que ainda gerem cobranças futuras precisam ser canceladas, e uma conexão ativa com o Mercado Pago precisa ser desconectada antes da exclusão automática. O fluxo apresenta suporte para esses bloqueios.

Após a confirmação válida, o backend remove a conta do Firebase Authentication, o catálogo público e sua reserva de slug, os dados operacionais do usuário no Firestore e os arquivos sob o prefixo da conta no Cloud Storage. O aplicativo limpa caches locais associados à conta no dispositivo usado para a exclusão.

O backend mantém um tombstone mínimo da solicitação para segurança e prevenção de reutilização de credenciais. Hashes de tokens de compra do Google Play e metadados mínimos de verificação também podem permanecer para integridade e prevenção de repetição. O prazo dessas retenções ainda depende de decisão formal de política. Dados que o Mercado Pago, Google Play ou outro provedor mantenha em seus próprios sistemas estão sujeitos às práticas e obrigações desse provedor.

Se o usuário não conseguir entrar, pode iniciar a solicitação pelo mesmo endereço público e contatar **revendasmart.suporte@gmail.com** usando o e-mail cadastrado. A identidade precisa ser verificada; informar apenas um endereço de e-mail não autoriza a exclusão.

## 8. Controles do usuário

Conforme a funcionalidade disponível, o usuário pode:

- consultar, corrigir ou excluir dados operacionais dentro do aplicativo;
- habilitar ou desabilitar o catálogo público;
- desconectar o Mercado Pago;
- cancelar a renovação de uma assinatura pelo provedor responsável;
- solicitar acesso, correção ou exclusão pelo contato de suporte.

Não há atualmente opt-out interno para Firebase Analytics ou Firebase Performance. Pedidos adicionais sobre dados devem ser enviados para **revendasmart.suporte@gmail.com**; o escopo e o formato de atendimento dependem das regras aplicáveis e de decisão operacional do responsável.

## 9. Menores de idade

O RevendaSmart é destinado a usuários com 18 anos ou mais. Se um responsável identificar uma conta criada por menor, deve contatar **revendasmart.suporte@gmail.com** para análise e verificação.

## 10. Alterações

Esta política pode ser atualizada para acompanhar mudanças no aplicativo, nos provedores ou nas decisões de retenção. A versão e a data da redação vigente serão publicadas nesta página. Nenhum mecanismo específico de aviso por e-mail ou notificação no app é prometido pela versão atual.

## 11. Contato

Perguntas, solicitações de privacidade e relatos relacionados ao tratamento de dados podem ser enviados para **revendasmart.suporte@gmail.com**.

Esta política descreve o comportamento técnico atual e não substitui análise jurídica sobre bases legais, prazos obrigatórios de retenção ou direitos aplicáveis em cada jurisdição.
