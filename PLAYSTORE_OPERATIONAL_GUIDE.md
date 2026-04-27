# Guia Operacional Play Store — RevendaSmart

**Versão**: 1.0  
**Data**: 29 de março de 2026  
**Status**: Pronto para implementação após Android build

---

## 📋 PARTE 1 — CHECKLIST PLAY CONSOLE

### Pré-Launch (Antes de Submeter)

```
SETUP CONTA & PROJETO
[ ] Google Play Console account ativo
[ ] Developer account em bom estado (sem violações)
[ ] Projeto criado com Bundle ID: com.revendasmart.app (exemplo)
[ ] Signing key gerada (Play Console gerencia automaticamente)
[ ] APK/AAB preparado e testado localmente

INFORMAÇÕES DA APP
[ ] Nome da app finalizado: "RevendaSmart"
[ ] Descrição curta pronta (<80 chars)
[ ] Descrição longa pronta (4000 chars max)
[ ] Categoria definida: Produtividade
[ ] Categoria secundária (opcional): Negócios
[ ] Conteúdo classificado (respondido Content Rating)
[ ] Público-alvo: 13+ (PEGI)

LEGAL & COMPLIANCE
[ ] Link de Política de Privacidade atualizado
[ ] Link de Termos de Uso atualizado
[ ] Email de contato verificado
[ ] Informações de developer completadas

ASSETS & GRAPHICS
[ ] Ícone 512x512 PNG (quadrado)
[ ] Imagens de capa (1024x500 PNG) — Feature graphic
[ ] Screenshots x6-8 (540x720 PNG) — Todas em Português
[ ] Vídeo de preview (opcional, mas recomendado)

PREÇO & DISTRIBUIÇÃO
[ ] Preço definido: GRATUITO
[ ] Países: Brasil (com opção de expandir depois)
[ ] Regiões: Todas (ou selecionar?)
[ ] Consentimento: Distribuição ativa

VERSÃO & BUILD
[ ] versionCode = 1 (inteiro)
[ ] versionName = "1.0.0" (semantic)
[ ] targetSdkVersion ≥ 33 (Android 13)
[ ] minSdkVersion ≥ 26 (Android 8)

TESTES & QA
[ ] Testado em emulator Android 13+
[ ] Testado em dispositivo real (se possível)
[ ] 0 crashes identificados
[ ] Performance aceitável (< 2s load time)
[ ] Login funciona
[ ] Produtos/clientes/vendas CRUD funciona
[ ] Mercado Pago connection funciona
[ ] Catálogo público abre

CLOSED TESTING TRACK
[ ] Closed testing track criado
[ ] 10-12 testers adicionados
[ ] Permissão para feedback coletada
[ ] Link de join compartilhado
[ ] Prazo de teste definido (14 dias)

SUBMIT & MONITOR
[ ] APK/AAB uploaded ao closed testing track
[ ] Release notes escritas
[ ] Pronto para teste interno
[ ] Email de suporte testado
[ ] Monitoramento de crashes ativo (Sentry ou Play Console)
```

---

## 📝 PARTE 2 — DRAFT DA FICHA DA LOJA (APP STORE LISTING)

### 2.1 Nome da App

```
NOME PRINCIPAL (recomendado: máx 50 chars)
RevendaSmart

NOME CURTO (máx 30 chars, opcional)
RevendaSmart

EXPLICAÇÃO
- Claro, memorável, profissional
- Inclui "Revendedor" no conceito
- Fácil de buscar e pronunciar
```

### 2.2 Short Description (Máx 80 Caracteres)

```
✅ OPÇÃO 1 (Recomendada - Foco em benefício)
Gestão completa de estoque e catálogo para revendedoras

✅ OPÇÃO 2 (Com call-to-action)
Organize estoque, venda mais com catálogo digital

✅ OPÇÃO 3 (Com segmentação)
App de estoque para revendedoras de cosméticos e perfumes

ESCOLHIDA: Opção 1 (mais clara e profissional)
```

### 2.3 Long Description (Máx 4000 Caracteres)

```
VERSÃO PORTUGUÊS — BRASIL

---

RevendaSmart é a plataforma completa para revendedoras independentes
gerenciarem estoque, catálogo digital e vendas com facilidade.

🎯 PARA QUEM
Revendedoras de cosméticos, perfumes e acessórios que querem 
organizar melhor seu negócio e vender mais.

💰 PRINCIPAIS FEATURES
• Gestão de Estoque — Controle tudo em um só lugar
  - Adicione, edite, organize seus produtos
  - Visualize quantidade em tempo real
  - Receba alertas de estoque baixo

• Catálogo Digital Público — Compartilhe com clientes
  - Gere link único de catálogo
  - Crie QR code para compartilhar
  - Clientes veem tudo no navegador (sem app)

• Registro de Vendas — Nunca perca uma venda
  - Registre vendas rapidamente
  - Rastreie clientes
  - Veja relatórios de vendas

• Gestão de Clientes — Mantenha relacionamento
  - Registre dados de clientes
  - Histórico de compras
  - Acompanhe preferências

• Cobranças & Pagamentos — Organize suas receitas
  - Registre cobranças pendentes
  - Calendário de vencimentos
  - Integração com Mercado Pago

• Programa de Referência — Ganhe recompensas
  - Indique amigas
  - Receba créditos por indicações convertidas
  - Use créditos no seu perfil

🔒 SEGURANÇA & PRIVACIDADE
- Sua conta é protegida por autenticação Firebase
- Seus dados de produtos, clientes e vendas são privados
- Nenhuma terceira tem acesso (exceto Mercado Pago, se você conectar)
- Conforme Lei Geral de Proteção de Dados (LGPD)

✨ DIFERENCIAIS
- 100% gratuito (sem plano pago oculto)
- Funciona offline (sincroniza quando conecta)
- Mobile-first design (feito para celular)
- Atualizado regularmente

📧 SUPORTE
Dúvidas? Envie email para: suporte@revendasmart.com
Responderemos em até 10 dias úteis.

🚀 COMECE AGORA
1. Faça signup com seu email
2. Complete seu perfil
3. Adicione seus primeiros produtos
4. Compartilhe seu catálogo
5. Registre suas vendas e cresça!

---
```

### 2.4 Categoria Primária

```
CATEGORIA SUGERIDA: Produtividade (Productivity)

ALTERNATIVAS:
- Negócios (Business)
- Ferramentas (Tools)

JUSTIFICATIVA:
- Foco em organização & eficiência
- Gestão de dados (produtos, clientes)
- Suporta crescimento do negócio
- Play Store categoriza similar a "Business Tools"
```

### 2.5 Palavras-Chave (Keywords)

```
KEYWORDS PRIMÁRIAS (5-7 principais)
1. estoque
2. revendedora
3. catálogo digital
4. gestão de vendas
5. cosméticos
6. controle de estoque
7. gestão de clientes

KEYWORDS SECUNDÁRIAS (opcional)
- revendedor perfumes
- app negócio
- controle loja
- gestão produto
- catálogo online
- vender online
- organizar vendas
- rastreamento estoque

NOTA: Usar keywords com volume de busca real
(não confundir com espanhol "estoque" que é português arcaico)
```

### 2.6 Conteúdo Classificado

```
RESPOSTAS SUGERIDAS (Content Rating Questionnaire)

Dados pessoais?
→ Sim, email e nome do usuário (para autenticação)

Localização exata (GPS)?
→ Não (apenas IP para segurança)

Câmera/Galeria?
→ Sim (para fotos de produtos, mas opcional)

Saúde/Fitness?
→ Não (cosméticos não contam)

Finanças?
→ Sim, integração com Mercado Pago (pagamentos)

Contatos?
→ Não, mas pode ser adicionado depois

RESULTADO ESPERADO: PEGI 3 (Todos os públicos)
```

---

## 🖼️ PARTE 3 — CHECKLIST DE SCREENSHOTS

### Estratégia de Screenshots

```
QUANTIDADE RECOMENDADA: 6-8 screenshots
DIMENSÕES: 540x720 pixels (portrait)
FORMATO: PNG
LINGUAGEM: Português

PROPÓSITO:
- Mostrar principais features
- Convencer usuário a baixar
- Foco em benefícios, não em detalhes técnicos

ORDEM SUGERIDA:
1. Hero screen (dashboard com números grandes)
2. Adicionar produto (criação de conteúdo)
3. Catálogo digital (compartilhamento)
4. Registro de vendas (ação rápida)
5. Clientes (relacionamento)
6. Mercado Pago (integração)
7. Programa de referência (ganho)
8. Configurações (personalização)
```

### Checklist por Screenshot

```
SCREENSHOT 1: Hero/Dashboard
[ ] Grande, visual, números em destaque
[ ] Mensagem: "Controle tudo em um lugar"
[ ] Mostra: Total de produtos, vendas este mês, clientes
[ ] CTA: "Comece a usar"
[ ] Sem detalhes técnicos

SCREENSHOT 2: Adicionar Produto
[ ] Fluxo simples: foto + nome + preço
[ ] Mensagem: "Adicione seus produtos em segundos"
[ ] Mostra: Form preenchido, imagem do produto
[ ] Foco: Rapidez, simplicidade
[ ] CTA: "Pronto!"

SCREENSHOT 3: Catálogo Público
[ ] QR code em destaque
[ ] Mensagem: "Compartilhe seu catálogo com clientes"
[ ] Mostra: Link gerado + QR code
[ ] Benefício: "Sem app necessário"
[ ] CTA: "Compartilhar"

SCREENSHOT 4: Registro de Vendas
[ ] Formulário simples (cliente + produtos + valor)
[ ] Mensagem: "Registre vendas em 30 segundos"
[ ] Mostra: Venda sendo criada, confirmação
[ ] Foco: Velocidade
[ ] CTA: "Vender"

SCREENSHOT 5: Gerenciamento de Clientes
[ ] Lista de clientes com histórico
[ ] Mensagem: "Conheça melhor seus clientes"
[ ] Mostra: Cliente selecionado, histórico de compras
[ ] Benefício: "Nunca perca contato"
[ ] CTA: "Ver detalhes"

SCREENSHOT 6: Mercado Pago Integration
[ ] Conectar MP visível
[ ] Mensagem: "Receba pagamentos com segurança"
[ ] Mostra: Link de pagamento gerado, QR code
[ ] Benefício: "Integração segura"
[ ] CTA: "Conectar MP"

SCREENSHOT 7: Referência (opcional)
[ ] Link de referência + share buttons
[ ] Mensagem: "Ganhe recompensas indicando amigas"
[ ] Mostra: Link gerado, botões de share
[ ] Benefício: "Crescimento mútuo"
[ ] CTA: "Compartilhar"

SCREENSHOT 8: Sobre/Informações (opcional)
[ ] Versão, links legais, suporte
[ ] Mensagem: "Seguro, privado, grátis"
[ ] Mostra: Privacy Policy link, Terms link, versão
[ ] Benefício: "Sua privacidade importa"
[ ] CTA: "Saiba mais"
```

---

## 🧪 PARTE 4 — PLANO DE CLOSED TESTING

### 4.1 Objetivo do Closed Testing

```
DURAÇÃO: 14 dias
TESTERS: 10-12 pessoas
OBJETIVO: 
- Validar funcionalidade em dispositivos reais
- Cooletar feedback sobre UX
- Identificar crashes e bugs
- Aprimorar antes do launch público

CRITÉRIO DE SUCESSO:
- 0 crashes críticos
- Feedback positivo em 80% dos testers
- Nenhuma funcionalidade quebrada
- Performance aceitável
```

### 4.2 Como Recrutar Testers

```
PERFIL IDEAL:
- Revendedoras de cosméticos/perfumes (3-5 testers)
- Amigos/familiares (3-4 testers)
- Colegas de trabalho (2-3 testers)
- Seguidores/comunidade (2+ testers)
- Diversidade de dispositivos Android (8.0+, 12+, 13+)

ONDE RECRUTAR:
1. WhatsApp pessoal (amigos próximos)
2. Comunidades de revendedoras no Facebook/Telegram
3. Email para contatos anteriores
4. LinkedIn (colhegas)
5. Instagram DM (clientes potenciais)

INCENTIVO:
- Acesso exclusivo antes do público
- Crédito de recompensa (depois, quando sistema estiver live)
- Menção na primeira release notes
- Feedback direto ao time (eles se sentem ouvidos)

MÍNIMO NECESSÁRIO:
- 10 pessoas (para cobertura de devices/scenarios)
- Pelo menos 1 testar em cada Android version (8, 10, 12, 13+)
- Mix: 70% revendedoras + 30% amigos/familiares
```

### 4.3 Timeline de 14 Dias

```
DIA 1: Convite & Setup
[ ] Email de convite enviado
[ ] Link de join ao closed testing track compartilhado
[ ] Instruções de download enviadas (APK ou Play Store link)
[ ] Formulário de feedback criado (Google Forms)

DIA 2-3: Onboarding
[ ] Testers recebem confirmação de recebimento
[ ] Lembrete de como baixar
[ ] Dúvidas respondidas em até 2 horas

DIA 4: Check-in
[ ] Email de check-in: "Como está o teste?"
[ ] Link para formulário de feedback recordatorios
[ ] Disponibilidade para suporte (WhatsApp/email)

DIA 7: Mid-point
[ ] Email de feedback: "Qual sua experiência até agora?"
[ ] Perguntas específicas:
   - Conseguiu fazer o signup?
   - Conseguiu criar produto?
   - Conseguiu registrar venda?
   - Algum crash ou erro?
[ ] Coleta de feedback

DIA 10: Aprimoramentos
[ ] Revisar feedback recebido
[ ] Corrigir bugs críticos
[ ] Deploy de update (se necessário)
[ ] Email aos testers: "Atualizamos! Podem testar novamente?"

DIA 13: Feedback Final
[ ] Email de encerramento: "Último dia de teste!"
[ ] Pedido de feedback final estruturado
[ ] Agradecimento pessoal

DIA 14: Encerramento
[ ] Colheita final de feedback
[ ] Análise de dados
[ ] Decisão: Pronto para público ou mais ajustes?
[ ] Email de agradecimento + próximas etapas
```

### 4.4 Métricas de Acompanhamento

```
RASTREAR:
- Download count (quantos testers baixaram?)
- Session count (quantos abriram?)
- Crash count (Play Console dashboard)
- Feature usage (qual feature foi usada?)
- Feedback count (quantos responderam formulário?)
- Sentiment (% positivo/negativo)
- Issues reported (bugs identificados?)

SHEET PARA ACOMPANHAR:
Tester | Email | Device | Download | Opened | Feedback | Rating | Notes
-------|-------|--------|----------|--------|----------|--------|------
1      | ...   | S23    | ✅       | ✅     | ✅      | 5/5    | "Amei!"
2      | ...   | A50    | ✅       | ⏳     | ❌      | -      | Waiting
3      | ...   | A13    | ❌       | -      | -       | -      | Link not working

TARGET:
- 100% download rate (10/10 testers)
- 100% opened rate (10/10 testers)
- 80% feedback rate (8/10 testers)
- 4+ stars average rating
- < 2 critical bugs
```

---

## 💬 PARTE 5 — MENSAGENS PRONTAS PARA RECRUTAR & ACOMPANHAR

### 5.1 Email de Convite (Copiar & Colar)

```
ASSUNTO: Experimente RevendaSmart ANTES de todos! 🚀

---

Oi [NOME]!

Estou desenvolvendo um app chamado RevendaSmart, que ajuda 
revendedoras de cosméticos e perfumes a controlar estoque, 
catálogo digital e vendas.

Você gostaria de ser um dos primeiros a testar?

O que você teria que fazer:
✅ Baixar a versão de teste (Android)
✅ Usar por ~14 dias como se fosse uma revendedora real
✅ Me dar feedback honesto (o que gostou, o que pode melhorar)
✅ Reportar qualquer erro/crash que encontrar

Benefícios para você:
- Acesso exclusivo antes de todos
- Influência direta no produto final
- Seu feedback muda o app
- Possível crédito de recompensa futuramente

Interesse? Responde esse email! 🙌

Link para testar (assim que pronto):
[LINK DO PLAY CONSOLE CLOSED TESTING]

Qualquer dúvida, é só falar.

Abraços,
[SEU NOME]
```

### 5.2 Email de Confirmação de Acesso

```
ASSUNTO: RevendaSmart — Seu acesso ao teste está pronto! 📱

---

Oi [NOME]!

Sucesso! Você foi adicionado ao teste fechado de RevendaSmart.

PARA BAIXAR:
1. Abra este link no seu Android: [LINK]
2. Clique "Juntar-se ao programa de testes"
3. Instale via Google Play
4. Abra o app e teste!

DICAS:
- Pode criar múltiplas contas para testar fluxos
- Se encontrar erro, me avisa no WhatsApp ou aqui mesmo
- Se crash, não se preocupa — é teste mesmo!
- Feedback honesto ajuda muito

FEEDBACK:
Quando tiver testado, responde:
- Qual sua primeira impressão?
- Conseguiu criar um produto?
- Conseguiu registrar uma venda?
- Algo que poderia melhorar?

Pode responder por email ou WhatsApp: [SEU NÚMERO]

Valeu demais por participar! 🙏

[SEU NOME]
```

### 5.3 Email de Check-in (Dia 4)

```
ASSUNTO: Como está seu teste com RevendaSmart? 👋

---

Oi [NOME]!

Já testou RevendaSmart? Como está a experiência?

Seu feedback é super importante pra melhorar o app.

Se tiver algum problema:
❌ App não abre?
❌ Signup não funciona?
❌ Erro ao criar produto?
❌ Crash quando registra venda?

Me avisa ASAP que corrijo!

Se tudo está funcionando:
✅ Que recurso você mais gostou?
✅ O que poderia melhorar?
✅ Recomendaria para amigas?

Pode responder aqui mesmo ou via WhatsApp: [SEU NÚMERO]

Obrigado por testar! 💪

[SEU NOME]
```

### 5.4 Email de Mid-Point (Dia 7)

```
ASSUNTO: RevendaSmart — Feedback da metade do teste 💭

---

Oi [NOME]!

Estamos na metade do teste! Como está indo?

Gostaria de saber sua opinião honesta sobre:

FUNCIONALIDADE:
- [ ] Signup/login foi fácil?
- [ ] Adicionar produto foi intuitivo?
- [ ] Compartilhar catálogo funcionou?
- [ ] Registrar vendas foi rápido?

DESIGN:
- [ ] App é bonito visualmente?
- [ ] Cores & ícones fazem sentido?
- [ ] Consegue usar com 1 mão?

PERFORMANCE:
- [ ] App é rápido?
- [ ] Trava em algum lugar?
- [ ] Crash aconteceu?

GERAL:
- [ ] Qual sua nota: ⭐⭐⭐⭐⭐?
- [ ] Recomendaria?
- [ ] Falta algo importante?

RESPONDA AQUI:
[LINK GOOGLE FORMS]

Ou apenas mande um WhatsApp rápido: [SEU NÚMERO]

Agradeço o tempo! 🙏

[SEU NOME]
```

### 5.5 Email de Lembrete (Dia 10)

```
ASSUNTO: 4 dias para encerrar — Feedback final RevendaSmart! 🏁

---

Oi [NOME]!

Faltam 4 dias para encerrar o teste!

Se ainda não testou muito, aqui estão as principais features:
1️⃣ Adicione seus produtos
2️⃣ Crie seu catálogo público
3️⃣ Registre uma venda
4️⃣ Compartilhe com clientes

Testou tudo? Ótimo! 🎉

Se encontrou algum bug, por favor me avise AGORA pra eu corrigir 
antes de lançar para o público.

Link para responder feedback:
[LINK GOOGLE FORMS]

WhatsApp (se preferir conversa rápida): [SEU NÚMERO]

Valeu demais por participar! 💪

[SEU NOME]
```

### 5.6 Email de Encerramento (Dia 14)

```
ASSUNTO: Obrigado por testar RevendaSmart! 🙌

---

Oi [NOME]!

Hoje é o último dia do teste fechado. Muito obrigado por participar! 💙

Seu feedback foi essencial para melhorar o app. Aqui está o que 
vamos fazer:

[RESUMIR FEEDBACK PRINCIPAL]:
- "Todos acharam o signup fácil"
- "3 pessoas sugeriram melhorar performance"
- "Todos querem integração com WhatsApp"

PRÓXIMOS PASSOS:
1. Vou corrigir os bugs reportados
2. Vou implementar as melhores sugestões
3. Em 2 semanas, lanço para o público!
4. Você será a PRIMEIRA a ser notificada!

SEUS DADOS:
Seu feedback foi registrado como:
- Nome: [NOME]
- Nota média: [NOTA]
- Principais comentários: [RESUMO]

RECOMPENSA:
Como obrigação, quando o programa de referência ficar live, 
você recebe créditos por ter testado e ajudado! 🎁

Quer acompanhar o desenvolvimento?
- Instagram: [@revendasmart](link)
- Email: suporte@revendasmart.com
- WhatsApp: [SEU NÚMERO] (para updates)

Novamente, MUITO obrigado por tudo! 🙏

[SEU NOME]
```

### 5.7 Formulário Google Forms (Template)

```
TÍTULO: Feedback do Teste Fechado — RevendaSmart

PERGUNTA 1 (Multiple Choice)
"Qual sua experiência geral com RevendaSmart?"
- ⭐ Péssima (1 estrela)
- ⭐⭐ Ruim (2 estrelas)
- ⭐⭐⭐ OK (3 estrelas)
- ⭐⭐⭐⭐ Boa (4 estrelas)
- ⭐⭐⭐⭐⭐ Excelente (5 estrelas)

PERGUNTA 2 (Checkboxes)
"Quais features você testou?"
- [ ] Signup/Login
- [ ] Criar produto
- [ ] Ver catálogo próprio
- [ ] Compartilhar catálogo (link/QR)
- [ ] Registrar venda
- [ ] Gerenciar clientes
- [ ] Integração Mercado Pago
- [ ] Programa de referência

PERGUNTA 3 (Short Text)
"Qual feature você mais gostou? Por quê?"
[RESPOSTA ABERTA]

PERGUNTA 4 (Short Text)
"O que não funcionou ou causou erro?"
[RESPOSTA ABERTA]

PERGUNTA 5 (Short Text)
"O que poderia melhorar?"
[RESPOSTA ABERTA]

PERGUNTA 6 (Yes/No)
"Recomendaria RevendaSmart para amigas?"
- Sim
- Não
- Talvez

PERGUNTA 7 (Short Text)
"Algo mais que gostaria de dizer?"
[RESPOSTA ABERTA]

PERGUNTA 8 (Contact)
"Seu nome completo (para agradecimento)"
[RESPOSTA ABERTA]

PERGUNTA 9 (Contact)
"Seu WhatsApp (opcional, para updates)"
[RESPOSTA ABERTA]
```

---

## 📊 PARTE 6 — RESUMO EXECUTIVO OPERACIONAL

### 6.1 O Que Está Pronto Agora

```
✅ Checklist Play Console (28 itens)
✅ Ficha da loja completa:
   - Nome: RevendaSmart
   - Short description: "Gestão completa de estoque..."
   - Long description: 1500+ caracteres
   - Categoria: Produtividade
   - Keywords: 7 principais + 8 secundárias

✅ Checklist de screenshots (8 screenshots)
   - Dimensões corretas (540x720)
   - Sequence lógica
   - Mensagens claras

✅ Plano de closed testing:
   - 14 dias
   - 10-12 testers
   - Timeline detalhada

✅ Mensagens prontas:
   - 7 emails (convite, confirmação, check-in, mid-point, lembrete, encerramento)
   - 1 template Google Forms
   - Tudo copiável e pronto para usar
```

### 6.2 O Que Falta

```
❌ Design dos screenshots (asset design — designer?)
❌ Ícone 512x512 (designer?)
❌ Feature graphic (designer?)
❌ Gravação de vídeo de preview (opcional, videógrafo?)

⏳ Android build & APK/AAB (requer Capacitor setup — dev)
⏳ Closed testing track setup (requer Play Console access — ops)
⏳ Recrutar testers (requer outreach — você)
⏳ Monitorar teste (14 dias — você + dev)
```

### 6.3 Timeline Sugerida

```
AGORA (Hoje)
- Review este guia
- Preparar lista de 12+ testers potenciais

SEMANA 1 (Quando Android build pronto)
- Upload APK ao closed testing track
- Enviar convites (5.1)
- Preparar formulário Google Forms (5.7)

SEMANA 1-2: Teste
- Check-in (5.3)
- Mid-point (5.4)
- Coletar feedback

SEMANA 2: Encerramento
- Feedback final (5.5)
- Encerramento (5.6)
- Análise de dados

SEMANA 3: Ajustes
- Corrigir bugs reportados
- Implementar melhores sugestões
- Preparar para launch público
```

### 6.4 Responsabilidades

```
YOU (Usuário):
- [ ] Review e aprove descrição da loja
- [ ] Recrute testers (lista de 12+)
- [ ] Acompanhe teste (responda emails/feedback)
- [ ] Colethe feedback e comunique ao dev

DEV (você, depois):
- [ ] Design de screenshots (ou contratar)
- [ ] Android build + APK/AAB
- [ ] Corrigir bugs reportados
- [ ] Deploy de updates durante teste

OPS (você, depois):
- [ ] Play Console setup
- [ ] Upload de assets (ícone, feature graphic, screenshots)
- [ ] Configurar closed testing track
- [ ] Monitorar crashes/performance
```

### 6.5 KPIs de Sucesso

```
ANTES DO CLOSED TESTING:
- [ ] 0 crashes no QA interno
- [ ] Login funciona
- [ ] Produtos CRUD funciona
- [ ] Vendas CRUD funciona
- [ ] Catálogo público abre
- [ ] Performance < 2s load

DURANTE O CLOSED TESTING:
- [ ] 100% download rate (10/10)
- [ ] 100% opened rate (10/10)
- [ ] 80% feedback rate (8/10)
- [ ] 4+ stars average
- [ ] < 2 critical bugs

DEPOIS DO CLOSED TESTING:
- [ ] Todos bugs críticos corrigidos
- [ ] Feedback positivo implementado
- [ ] Pronto para launch público
```

---

## 📋 PARTE 7 — ARQUIVOS & CHECKLISTS COPIÁVEIS

### Para Copiar Direto (Bloco de Notas)

#### LISTA DE TESTERS POTENCIAIS

```
Nome | Email | WhatsApp | Profissão | Status
-----|-------|----------|-----------|-------
[1]  | ...   | 11 99... | Revendedora | Pendente
[2]  | ...   | 21 99... | Amiga | Pendente
[3]  | ...   | 85 99... | Revendedora | Pendente
...
```

#### TRACKER DE TESTE (14 DIAS)

```
Data | Convites Enviados | Downloads | Feedback | Status
-----|-------------------|-----------|----------|--------
D1   | 12 / 12           | -         | -        | Convites OK
D2   | 12 / 12           | 8 / 12    | -        | Aguardando
D4   | 12 / 12           | 10 / 12   | -        | Check-in
D7   | 12 / 12           | 12 / 12   | 7 / 12   | Mid-point
D10  | 12 / 12           | 12 / 12   | 9 / 12   | Final push
D14  | 12 / 12           | 12 / 12   | 11 / 12  | Encerrado ✅
```

#### FEEDBACK CONSOLIDADO

```
POSITIVOS:
- "Signup foi fácil"
- "Criar produto é rápido"
- "Compartilhar catálogo é genial"

NEGATIVOS:
- "App trava ao registrar venda rápido"
- "Integração MP confusa"
- "Falta notificação de estoque baixo"

SUGESTÕES:
- "Integrar WhatsApp"
- "Adicionar busca de produtos"
- "Atalho para compartilhar"

RATING MÉDIO: 4.2 / 5.0 ⭐⭐⭐⭐

RECOMENDARIA: 10 / 11 sim (90%)
```

---

## 🚀 PRÓXIMOS PASSOS

```
1. ✅ Review este guia
2. ✅ Aprove descrição da loja (ou ajuste)
3. ✅ Prepare lista de 12+ testers
4. ⏳ Quando Android build pronto:
   - Upload ao closed testing track
   - Envie convites (email 5.1)
   - Configure Google Forms (5.7)
5. ⏳ Acompanhe 14 dias de teste
6. ⏳ Analise feedback
7. ⏳ Corrija bugs + suggestões
8. ⏳ Prepare para launch público
```

---

**FIM DO GUIA OPERACIONAL**

---

## 📞 PERGUNTAS COMUNS

```
P: Preciso de designer para os screenshots?
R: Recomendo. 8 screenshots boas custam 3-5 horas de design.
   Podem ser simples (mockups do app + texto claro).

P: Posso usar a descrição assim como está?
R: Sim! Está pronta. Só ajuste se quiser tom diferente.

P: 10-12 testers é o mínimo?
R: Sim. Menos que isso, você não pega cobertura de devices/bugs.

P: Google Forms é obrigatório?
R: Não, mas facilita compilação de feedback. Pode ser WhatsApp também.

P: E se um tester não responder?
R: Normal. 80% de resposta já é sucesso. Pessoalmente, acompanhe 
   os que não responderam (podem ter tido problema).

P: Quanto tempo toma closed testing?
R: 14 dias mínimo. Pode estender para 21 dias se quiser mais feedback.

P: Depois de closed testing, quanto até público?
R: 3-7 dias (time para corrigir bugs + preparar launch assets).

P: Play Console cobra para submeter?
R: Não. App store é grátis, você só paga $25 USD uma vez para ser 
   developer (não para cada app).
```

---
