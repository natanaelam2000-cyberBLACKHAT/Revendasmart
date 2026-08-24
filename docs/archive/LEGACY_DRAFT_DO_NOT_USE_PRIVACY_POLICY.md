> ⚠️ **RASCUNHO OBSOLETO — NÃO USAR.** Este documento não é a Política de Privacidade servida pelo aplicativo e contém afirmações desatualizadas/incorretas (ex.: fornecedor de hospedagem, canal de contato, retenção, fluxo de autenticação). A política real, servida em produção via `GET /privacy-policy` e `GET /api/legal/privacy-policy`, vive em `client/public/privacy-policy.md`. Mantido aqui apenas como histórico. Ver `REVENDASMART-LGPD-ANPD-AUDIT-01` e `REVENDASMART-LGPD-ANPD-REMEDIATION-01`.

# Política de Privacidade — RevendaSmart (RASCUNHO HISTÓRICO)

**Última atualização:** 29 de março de 2026  
**Versão:** 1.0 — Draft para revisão jurídica

---

## 1. Introdução

RevendaSmart ("aplicativo", "plataforma", "nós", "nosso") é um aplicativo web (PWA) e mobile desenvolvido para facilitar o gerenciamento de estoque, catálogo digital, vendas e relacionamento com clientes para revendedoras independentes de cosméticos e perfumes.

Esta Política de Privacidade ("Política") descreve como coletamos, usamos, processamos e protegemos seus dados pessoais e dados de negócio quando você usa o RevendaSmart.

**Leia atentamente.** Ao usar o RevendaSmart, você concorda com as práticas descritas nesta Política.

---

## 2. Definições

- **"Dados Pessoais"**: Informações que identificam ou podem identificar um indivíduo (ex: email, nome, UID do Firebase)
- **"Dados de Negócio"**: Informações sobre produtos, clientes, vendas, cobranças e configurações da sua loja
- **"Revendedor"**: Você, o usuário do aplicativo
- **"Administrador"**: Membro da equipe RevendaSmart com acesso a dados agregados ou funções administrativas
- **"Firestore"**: Banco de dados em nuvem do Google Firebase onde seus dados são armazenados
- **"Firebase Auth"**: Serviço de autenticação do Google Firebase
- **"Telemetria"**: Dados sobre como você usa o aplicativo (eventos, fluxos, erros)

---

## 3. Dados que Coletamos

### 3.1 Dados de Autenticação
- **Email**: Necessário para criar e acessar sua conta
- **UID do Firebase**: ID único gerado automaticamente
- **Token de sessão**: Para manter você autenticado

**Base legal**: Contrato (necessário para fornecer o serviço)

### 3.2 Dados de Perfil & Negócio
Quando você cria ou edita seu perfil, coletamos:
- Nome da loja
- Tipo de negócio (cosméticos, perfumes, geral, etc.)
- Telefone/WhatsApp
- Informações do catálogo público (se habilitado)

**Base legal**: Contrato + Consentimento

### 3.3 Dados de Produtos, Clientes e Vendas
Você fornece ativamente:
- **Produtos**: Nome, descrição, preço, imagens, estoque
- **Clientes**: Nome, contato, histórico de vendas
- **Vendas**: Data, itens, valor, método de pagamento
- **Cobranças**: Datas, valores, status, notas

**Armazenamento**: Firestore (Google Cloud), em sua conta pessoal (isolamento por UID)  
**Base legal**: Contrato + Consentimento

### 3.4 Telemetria & Comportamento
Coletamos automaticamente:
- **Eventos de uso**: Signups, logins, criação de produtos, vendas registradas
- **Erros & crashes**: Para identificar problemas e melhorar estabilidade
- **Fluxos de negócio**: Referral links compartilhados, rewards concedidos
- **Performance**: Tempos de carregamento, erros de API, disponibilidade

**Ferramentas**: Google Firebase Analytics, telemetria interna  
**Retenção**: 90 dias (Firebase Analytics padrão)  
**Base legal**: Interesse legítimo (melhorar serviço)

### 3.5 Dados de Sistema
- **Endereço IP**: Para detectar suspeitas de segurança
- **User-Agent**: Para compatibilidade de dispositivo
- **Timestamps**: Hora de acesso/ação
- **Localização**: Inferida de IP (não coletamos GPS)

**Base legal**: Interesse legítimo (segurança)

### 3.6 Dados de Integração
**Mercado Pago** (se você conectar sua conta):
- **Access Token**: Criptografado em AES-256-GCM
- **ID da Conexão**: Para rastreabilidade
- **Email da conta MP**: Para validação

**Armazenamento**: Firestore, separado de outros dados  
**Acesso**: Apenas quando você solicita operação de pagamento  
**Base legal**: Contrato + Consentimento explícito

### 3.7 Dados de Referral & Rewards
- **UID do referrer**: Quem convidou você
- **Data de aplicação**: Quando referral foi registrado
- **Rewards concedidos**: Histórico de recompensas
- **Indicações convertidas**: Contagem de vendas do referrer

**Imutabilidade**: Uma vez registrado, referral_source não pode ser alterado  
**Base legal**: Contrato (programa de referência)

---

## 4. Como Usamos Seus Dados

### 4.1 Fornecimento do Serviço
- Criar e manter sua conta
- Armazenar seus produtos, clientes, vendas e configurações
- Gerar catálogo público (se habilitado)
- Processar pagamentos via Mercado Pago
- Enviar lembretes de cobrança (se habilitado)

### 4.2 Melhoria & Otimização
- Analisar padrões de uso para identificar problemas
- Corrigir bugs e melhorar performance
- Teste A/B de novos recursos
- Agregar dados para estatísticas anônimas (ex: "2000 vendas registradas este mês")

### 4.3 Segurança & Compliance
- Validar autenticação e autorização
- Detectar abuso, fraude ou atividade suspeita
- Proteger direitos legais da plataforma e usuários
- Atender requisitos legais (ex: LGPD, processos judiciais)

### 4.4 Comunicação
- Notificações sobre funcionalidades (confirmação de signup, novas features)
- Suporte técnico (resposta a emails de contato)
- Avisos de segurança (roubo de credencial, acesso suspeito)

### 4.5 Programa de Referência
- Registrar e validar referrals
- Calcular e conceder rewards
- Rastrear conversões e desempenho de referrer

---

## 5. Compartilhamento de Dados

### 5.1 Com Serviços de Terceiros
Não vendemos seus dados. Compartilhamos dados **apenas conforme necessário** com:

| Serviço | Dados | Motivo | Local |
|---------|-------|--------|-------|
| **Google Firebase** | Todos (Auth, Firestore, Analytics) | Infraestrutura, autenticação | Google Cloud (EUA/BR) |
| **Mercado Pago** | Access Token, email, transações | Processamento de pagamentos | MP (Brasil) |
| **Google Analytics** | Eventos anônimos, user ID | Análise de comportamento | Google Cloud (EUA) |
| **Sentry** (futuro) | Errors, crashes (sem dados sensíveis) | Monitoramento de confiabilidade | Sentry Cloud (EUA) |

**IMPORTANTE**: Seus dados de clientes/vendas **NÃO** são compartilhados com ninguém exceto conforme necessário para as integrações acima.

### 5.2 Com Administradores RevendaSmart
Administradores podem acessar:
- Dados agregados (total de vendas, usuários ativos)
- Dados de erros/crashes (para debugging)
- Sua informação de contato (para suporte)

Administradores **NÃO** podem acessar seus produtos, clientes ou vendas sem autorização explícita.

### 5.3 Obrigações Legais
Podemos divulgar seus dados se:
- Exigido por lei (ordem judicial, investigação policial)
- Para proteger direitos legais, privacidade ou segurança
- Para enfrentar atividade ilegal ou suspeita

---

## 6. Retenção de Dados

| Tipo de Dado | Retenção | Motivo |
|--------------|----------|--------|
| **Dados de Autenticação** | Enquanto conta ativa | Necessário para acesso |
| **Dados de Negócio** (produtos, clientes, vendas) | Enquanto conta ativa + 90 dias | Para recuperação/auditoria |
| **Telemetria & Analytics** | 90 dias | Firebase padrão |
| **Logs de Erro** | 30 dias | Debugging |
| **Registros de Referral** | Permanente* | Para auditoria de rewards |
| **Tokens MP (criptografados)** | Enquanto conexão ativa | Para pagamentos contínuos |

*Referrals são imutáveis por design; mantemos registro permanente para auditoria do programa.

### 6.1 Exclusão de Dados
Você pode solicitar exclusão de sua conta indo em **Settings → Segurança → Limpar Todos os Dados** ou enviando email para **suporte@revendasmart.com**.

**O que acontece**:
- Sua conta é marcada como deletada
- Dados pessoais são removidos em 30 dias
- Dados de negócio (produtos, clientes, vendas) são excluídos
- Referral source é anonimizado (mantém UID do referrer para auditoria)

**O que NÃO é deletado**:
- Logs de transações (necessários para auditoria financeira)
- Registros que são obrigados por lei (ex: LGPD art. 16)

---

## 7. Segurança

### 7.1 Medidas de Proteção
- **Autenticação**: Firebase Auth com email/senha ou OAuth
- **Criptografia em trânsito**: HTTPS (TLS 1.2+)
- **Criptografia em repouso**: Firestore encriptado pelo Google, tokens MP encriptados AES-256-GCM
- **Access Control**: Isolamento por UID, verificação de propriedade em cada operação
- **Rate limiting**: Para endpoints críticos (ex: concessão de rewards)
- **Monitoramento**: Detecção de acessos anormais

### 7.2 Responsabilidade
- Você é responsável por manter seu email/senha seguro
- Não compartilhe seu UID ou tokens de sessão
- Notifique-nos imediatamente de suspeitas de abuso

### 7.3 Limitações
Nenhum sistema é 100% seguro. Não podemos garantir proteção contra todos os ataques. Se você teme violação de dados, entre em contato imediatamente.

---

## 8. Direitos do Usuário (LGPD)

Você tem direito a:

1. **Acesso** (LGPD art. 18): Solicitar cópia de seus dados pessoais
2. **Retificação** (LGPD art. 19): Corrigir dados imprecisos
3. **Exclusão** (LGPD art. 17): Deletar dados pessoais (com limitações legais)
4. **Portabilidade** (LGPD art. 20): Receber seus dados em formato transferível
5. **Oposição** (LGPD art. 21): Recusar processamento para certos fins
6. **Revogação de Consentimento**: Retirar consentimento a qualquer momento

**Para exercer esses direitos**, envie email para **suporte@revendasmart.com** com:
- Assunto: "[LGPD] Solicitação de [Acesso/Exclusão/Portabilidade]"
- Seu email cadastrado
- Descrição específica do que solicita

**Prazo de resposta**: 10 dias úteis (conforme LGPD art. 18)

---

## 9. Cookies & Rastreamento

### 9.1 Cookies
- **Autenticação**: Armazenamos token de sessão (necessário para acesso)
- **Preferências**: Aba aberta em Settings, idioma (se implementado)
- **Analytics**: Google Analytics usa cookies para rastrear comportamento agregado

### 9.2 Local Storage
Armazenamos no navegador (localStorage):
- Token de autenticação
- UID do usuário
- Preferências locais (aba ativa)

Você pode limpar localStorage em **Settings → Segurança → Limpar Todos os Dados**.

---

## 10. Alterações Nesta Política

Podemos atualizar esta Política a qualquer momento. As mudanças entram em vigor quando publicadas nesta página.

- **Mudanças materiais**: Notificaremos por email com 30 dias de antecedência
- **Mudanças menores** (ex: correção de texto): Entram em vigor imediatamente

Seu uso contínuo do aplicativo após notificação de mudanças constitui aceitar a Política atualizada.

---

## 11. Contato & Reclamações

### Perguntas sobre Privacidade
**Email**: suporte@revendasmart.com  
**Resposta típica**: 5-10 dias úteis

### Reclamação à Autoridade
Se não estiver satisfeito com nossa resposta, pode registrar reclamação com a **Autoridade Nacional de Proteção de Dados (ANPD)** do Brasil em www.gov.br/cidadania/pt-br/acesso-a-informacao/lgpd.

---

## 12. Dados de Contato do Responsável

**Responsável pela Proteção de Dados** (DPO):  
RevendaSmart  
Email: suporte@revendasmart.com  
Website: https://revendasmart.com

---

## 13. Notas para Revisão Jurídica

❌ **AINDA NÃO REVISADO POR JURISTA**

Pontos que ainda exigem revisão legal:
- [ ] Compliance com LGPD art. 3° (aplicabilidade territorial)
- [ ] Bases legais detalhadas para cada processamento
- [ ] Termos de Terceiros (Google, MP, Sentry) — cumprir seus TOS
- [ ] Cláusula de DPA (Data Processing Agreement) com Google
- [ ] Cláusula de transferência de dados internacionais (Google USA/MP Brasil)
- [ ] Formulários de exercício de direitos (acesso, exclusão, portabilidade)
- [ ] Integração com política de retenção de backups
- [ ] Claúsula de vencimento/renovação da política
- [ ] Adaptação para Play Store, App Store (se aplicável)

---

**FIM DA POLÍTICA DE PRIVACIDADE**

---

## Apêndice A: Mapeamento de Dados por Endpoint

| Endpoint | Dados | Base Legal | Retenção |
|----------|-------|-----------|----------|
| POST /api/user/register | Email, Firebase UID | Contrato | Enquanto conta ativa |
| GET/POST /api/user/settings/:uid | Perfil, negócio, integr. | Contrato + Consentimento | Enquanto conta ativa |
| POST /api/rewards/grant | Admin UID, target UID, motivo | Contrato | Permanente (auditoria) |
| GET /api/mercadopago/connections | MP tokens (encriptados) | Contrato + Consentimento | Enquanto conexão ativa |
| Analytics events | Evento, timestamp, user ID | Interesse legítimo | 90 dias |

---

## Apêndice B: Fluxo LGPD de Exclusão de Dados

```
1. User solicita DELETE via suporte@revendasmart.com
2. Admin confirma identidade (match email + UID)
3. Marca account como "deletion_requested" em Firestore
4. Sistema dispara jobs de limpeza:
   - Apagar Firestore collections do usuário
   - Anonimizar referral_source
   - Revogar tokens MP
   - Remover de Firebase Auth
5. Confirmação enviada ao usuário (em 10 dias)
6. Auditoria: log de deleção mantido por 1 ano
```

---

## Apêndice C: Matriz de Fluxos de Dados

```
Usuario → Firebase Auth → Firestore → Analítica Google
         ↓
      Mercado Pago (opcional)
         ↓
      Email de Suporte (contato)
         ↓
      Logs Internos (erro/auditoria)
         ↓
      Sentry (futuro - crashes)
```
