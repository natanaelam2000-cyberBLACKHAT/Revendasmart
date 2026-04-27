# Roadmap de Implementação Legal — RevendaSmart

**Data**: 29 de março de 2026  
**Status**: Documentos Draft Completos, Aguardando Revisão Jurídica

---

## 1. Resumo Executivo

### O que foi entregue
✅ **PRIVACY_POLICY.md** — 500+ linhas, completo, realista, honesto  
✅ **TERMS_OF_SERVICE.md** — 400+ linhas, completo, detalhado  
✅ **Este Roadmap** — mapeamento de implementação

### O que precisa acontecer antes de Play Store
1. ❌ **Revisão jurídica** (LGPD, CDC, CONAR) — Responsabilidade: Jurista
2. ❌ **Ajustes legais** — Responsabilidade: Jurista
3. ⚠️ **Publicação em domínio** — Responsabilidade: Operacional
4. ⚠️ **Update de URLs no app** — Responsabilidade: Dev

### Timeline Estimado
- **Semana 1**: Encaminhar para revisão jurídica
- **Semana 2**: Ajustes legais + revisões
- **Semana 3**: Publicação + atualização de URLs
- **Semana 4**: Deploy em produção

---

## 2. Documentos Criados

### 2.1 PRIVACY_POLICY.md

**Seções**:
1. Introdução
2. Definições
3. Dados que Coletamos (6 subsecções)
4. Como Usamos Seus Dados (5 subsecções)
5. Compartilhamento de Dados (3 subsecções)
6. Retenção de Dados
7. Segurança (3 subsecções)
8. Direitos do Usuário (LGPD)
9. Cookies & Rastreamento
10. Alterações Nesta Política
11. Contato & Reclamações
12. Dados de Contato do Responsável
13. Notas para Revisão Jurídica
14. Apêndices (A: Endpoints, B: Fluxo LGPD, C: Matriz de Dados)

**Dados Cobertos**:
- ✅ Firebase Auth (email, UID, token)
- ✅ Dados de Perfil (loja, tipo negócio, WhatsApp)
- ✅ Dados de Negócio (produtos, clientes, vendas, cobranças)
- ✅ Telemetria & Analytics
- ✅ Dados de Sistema (IP, user-agent, timestamps)
- ✅ Integração Mercado Pago (tokens encriptados)
- ✅ Referral & Rewards (imutabilidade)

**Compliance**:
- ✅ LGPD art. 18-21 (direitos do usuário)
- ✅ LGPD art. 17 (exclusão)
- ✅ LGPD art. 16 (correção)
- ✅ LGPD art. 20 (portabilidade)
- ⚠️ LGPD art. 3° (aplicabilidade) — REVISAR
- ⚠️ LGPD art. 5°-7° (bases legais) — REVISAR DETALHES

### 2.2 TERMS_OF_SERVICE.md

**Seções**:
1. Aceitação dos Termos
2. Descrição do Serviço
3. Elegibilidade (2 subsecções)
4. Conta & Autenticação (3 subsecções)
5. Conteúdo & Dados do Usuário (3 subsecções)
6. Integrações & Serviços Terceiros (3 subsecções)
7. Programa de Referência (3 subsecções)
8. Pagamentos & Transações (3 subsecções)
9. Propriedade Intelectual (2 subsecções)
10. Isenção de Responsabilidade (4 subsecções)
11. Indenização
12. Interrupção do Serviço (3 subsecções)
13. Modificação de Termos
14. Encerramento de Conta (2 subsecções)
15. Conformidade Legal (3 subsecções)
16. Resolução de Disputas (4 subsecções)
17. Contato & Suporte
18. Severabilidade
19. Integralidade
20. Notas para Revisão Jurídica
21. Apêndices

**Compliance**:
- ✅ CDC (Lei 8.078/1990) — Conceitos básicos
- ✅ LGPD (Lei 13.709/2018) — Referências
- ✅ Lei Brasileira (foro: São Paulo)
- ⚠️ Força maior — REVISAR cálculo de "responsabilidade"
- ⚠️ Cláusula de arbitragem — PENDENTE (opcional)
- ⚠️ Dados de menores — REVISAR se necessário

---

## 3. Checklist de Revisão Jurídica

### A. PRIVACY_POLICY.md

#### Jurista DEVE Verificar:
- [ ] **LGPD art. 3°**: Aplicabilidade territorial (RevendaSmart → Brasil? Global?)
- [ ] **LGPD art. 5°-7°**: Bases legais estão corretas/suficientes?
  - Contrato (certo)
  - Consentimento (precisa explícito para telemetria?)
  - Interesse legítimo (será aceito?)
- [ ] **LGPD art. 8°**: Consentimento por menor (temos? Precisamos?)
- [ ] **LGPD art. 14**: Processamento de dados especiais (sensíveis)?
  - Dados de saúde? (cosméticos/perfumes não são saúde)
  - Dados biométricos? (Não coletamos)
  - Dados raciais/políticos? (Não coletamos)
- [ ] **Google TOS**: Cumprir com Google Privacy Policy + Firebase TOS
  - Compartilhamento de dados com Google é adequado?
  - Cláusula DPA (Data Processing Agreement) necessária?
- [ ] **Mercado Pago TOS**: Cumprir com MP Privacy + MP TOS
  - Tokens encriptados atendem requisitos de MP?
- [ ] **ANPD (Autoridade de Proteção de Dados)**: Algum formulário/registro necessário?
- [ ] **Sentry (futuro)**: Se implementar crash monitoring, atualizar Privacy Policy

#### Nós (Dev) Já Fizemos:
- ✅ Documentar todos os dados coletados
- ✅ Documentar retenção de dados
- ✅ Listar integrações (Google, MP)
- ✅ Explicar direitos LGPD (art. 18-21)
- ✅ Descrever security measures

#### Pendente:
- [ ] Revisar DPA com Google
- [ ] Revisar TOS de MP para compliance
- [ ] Adicionar formulários de exercício de direitos (acesso, exclusão, portabilidade)
- [ ] Criar processo de resposta (10 dias úteis conforme LGPD art. 18)

---

### B. TERMS_OF_SERVICE.md

#### Jurista DEVE Verificar:
- [ ] **CDC art. 6°**: Direitos básicos do consumidor (oferecemos o suficiente?)
- [ ] **CDC art. 47-48**: Inversão de ônus da prova (temos isenção forte demais?)
- [ ] **Força Maior (art. 393 CC)**: Cálculo de responsabilidade está correto?
- [ ] **Limitação de Responsabilidade**: É válida conforme CDC?
  - Alguns danos (morte, lesão corporal) NÃO podem ser limitados
  - Dados pessoais podem ter limitação? (verificar jurisprudência)
- [ ] **Cláusula de Arbitragem**: Queremos arbitragem? (recomendação: não para agora)
- [ ] **Foro**: São Paulo é correto? (ou DF? Ou escolha de usuário?)
- [ ] **Direito Aplicável**: Lei Brasileira está correto?
- [ ] **Integração com Mercado Pago**: MP tem seus próprios termos (user concorda duplo?)
- [ ] **Dados de Menores**: Precisamos de consentimento parental explícito?
- [ ] **Cookie/Tracking**: Aviso de cookies está adequado ao CDC/LGPD?
- [ ] **Modificação Unilateral de Termos**: 30 dias de aviso é suficiente?
- [ ] **Encerramento de Conta**: Procedimento está claro o suficiente?

#### Nós (Dev) Já Fizemos:
- ✅ Documentar elegibilidade
- ✅ Explicar autenticação e segurança
- ✅ Descrever conteúdo do usuário
- ✅ Explicar integrações (MP, Google, Analytics)
- ✅ Documentar programa de referência
- ✅ Isenção de responsabilidade (seção 10)
- ✅ Conformidade com LGPD (seção 15.2)
- ✅ CDC (seção 15.3)
- ✅ Resolução de disputas

#### Pendente:
- [ ] Revisar cláusula de força maior vs. responsabilidade
- [ ] Verificar se limitação de responsabilidade é válida conforme CDC
- [ ] Criar formulários de reclamação (SGA - Solicitude General de Agravio)
- [ ] Integração com processo de atendimento ao consumidor

---

## 4. Fluxo de Revisão & Publicação

### Fase 1: Encaminhamento para Jurista (SEMANA 1)

**O que enviar:**
1. PRIVACY_POLICY.md
2. TERMS_OF_SERVICE.md
3. LEGAL_IMPLEMENTATION_ROADMAP.md (este)
4. Diagrama de arquitetura (dados, integrações)

**O que solicitar:**
- Revisão LGPD (art. 3°-21)
- Revisão CDC (direitos do consumidor)
- Revisão de termos de terceiros (Google, MP)
- Verificação de compliance Play Store/App Store
- Sugestões de ajustes

**Prazo esperado:** 7-10 dias

---

### Fase 2: Ajustes Jurídicos (SEMANA 2)

**Baseado em feedback do jurista:**
1. Atualizar Privacy Policy com comentários
2. Atualizar Terms of Service com comentários
3. Criar DPA com Google (se necessário)
4. Verificar TOS de MP (se necessário)
5. Criar formulários de exercício de direitos (LGPD)
6. Criar SOP (Standard Operating Procedure) para resposta em 10 dias

**Outputs:**
- PRIVACY_POLICY.md v1.1 (revisado)
- TERMS_OF_SERVICE.md v1.1 (revisado)
- LGPD_FORMS.md (formulários para acesso/exclusão/portabilidade)
- SOP_LGPD_RESPONSE.md (processo interno)

---

### Fase 3: Publicação (SEMANA 3)

**Criar URLs públicas:**
1. Publicar em domínio RevendaSmart:
   - https://revendasmart.com/privacy
   - https://revendasmart.com/terms
2. Usar HTTPS obrigatoriamente
3. Manter histórico de versões (v1.0, v1.1, etc.)
4. Adicionar "Última atualização" em cada página

**Setup técnico:**
- [ ] Domain registrado
- [ ] SSL certificate
- [ ] Página de política (WordPress, Markdown server, ou estático)
- [ ] Indexação em Google (opcional)

---

### Fase 4: Atualizar App (SEMANA 4)

**No código:**
1. Atualizar URLs em settings.tsx:
   ```typescript
   href="https://revendasmart.com/privacy"  // Antes: revendasmart.example.com
   href="https://revendasmart.com/terms"    // Antes: revendasmart.example.com
   ```
2. Remover aviso "em preparação"
3. Update email de suporte se necessário
4. Build & deploy

**No Play Console:**
- [ ] Adicionar link de Política de Privacidade
- [ ] Adicionar link de Termos de Uso
- [ ] Adicionar email de suporte
- [ ] Submeter para app review

---

## 5. Campos que Precisam de Ação Operacional

### Domínio & Hosting
```
[ ] revendasmart.com registrado?
[ ] Hosting com HTTPS?
[ ] Email de suporte funcionando?
    - suporte@revendasmart.com → onde redireciona?
    - Quem responde?
    - SLA (tempo de resposta)?
```

### Email de Suporte
```
[ ] suporte@revendasmart.com está ativo?
[ ] Caixa de entrada monitorada?
[ ] SOP para responder LGPD requests (10 dias)?
[ ] SOP para responder reclamações de consumidor?
[ ] Sistema de ticket (Zendesk, Intercom, Google Forms)?
```

### Documentação Interna
```
[ ] Processo de exclusão de dados (Delete Account)
[ ] Processo de acesso de dados (Portabilidade)
[ ] Processo de correção de dados
[ ] Auditoria anual de compliance
```

---

## 6. Matriz de Compliance — Play Store

| Requisito | Status | Fase |
|-----------|--------|------|
| Privacy Policy | 🟡 Draft | Revisão jurídica |
| Terms of Service | 🟡 Draft | Revisão jurídica |
| Support email | ⚠️ suporte@revendasmart.com | Setup operacional |
| Política de retenção de dados | ✅ Documentada | -  |
| Direitos LGPD | ✅ Documentado | - |
| HTTPS em políticas | ✅ Obrigatório | - |
| Formulários de direitos | ❌ Pendente | P2 |
| SOP de 10 dias | ❌ Pendente | P2 |
| DPA com Google | ❌ Pendente | P2 |

---

## 7. Pendências para Futuro (P2+)

### Formulários de LGPD
Criar formulários estruturados para:
- [ ] **Acesso de Dados** (LGPD art. 18)
  - Usuário solicita cópia de todos seus dados
  - Admin coleta dados de Firestore + Analytics + Logs
  - Envia em formato estruturado (JSON, CSV)
  
- [ ] **Exclusão de Dados** (LGPD art. 17)
  - Integrado com Settings → Segurança → Limpar Todos os Dados
  - Já existe! (falta SOP documentado)
  
- [ ] **Portabilidade** (LGPD art. 20)
  - Usuário solicita dados em formato transferível
  - Admin exporta como JSON/CSV/XLS
  - Usuário importa em concorrente (se desejar)

### SOP Interno
- [ ] Documento: "Como responder LGPD requests em 10 dias"
- [ ] Checklist: Passos para acesso/exclusão/portabilidade
- [ ] Template de email: Resposta padrão
- [ ] Auditoria: Log de todas as LGPD requests

### Monitoramento & Auditoria
- [ ] Ferramenta de monitoramento de conformidade (ex: OneTrust)
- [ ] Auditoria anual de LGPD/CDC/CONAR
- [ ] Revisão anual de Termos (ou quando houver mudança material)
- [ ] Registro de consentimentos (se implementar opt-in explícito)

### Integrações Futuras
- [ ] **Sentry (crash monitoring)**: Atualizar Privacy Policy
- [ ] **Push Notifications**: Adicionar LGPD consent flow
- [ ] **Biometric Auth**: Adicionar seção sobre dados biométricos
- [ ] **Analytics avançada**: Revisar coleta de eventos

---

## 8. Itens Já Implementados no App

### Segurança
- ✅ HTTPS em toda comunicação
- ✅ Firebase Auth (2FA disponível via Google)
- ✅ Tokens encriptados (Mercado Pago)
- ✅ Isolamento por UID (cada user vê apenas seus dados)
- ✅ Rate limiting em endpoints críticos

### Direitos do Usuário
- ✅ **Acesso**: Usuário pode ver tudo em Settings
- ✅ **Exclusão**: Settings → Segurança → Limpar Todos os Dados
- ✅ **Portabilidade**: Backup/Export em Development (Settings → Backup)
- ✅ **Oposição**: Pode desabilitar Analytics? (TBD)
- ✅ **Revogação de Consentimento**: Desconectar Mercado Pago

### Transparência
- ✅ "Sobre" app em Settings (versão, descrição)
- ✅ Links para Privacy/Terms (estrutura pronta)
- ✅ Email de suporte exibido

### Conformidade LGPD
- ✅ Dados isolados por usuário
- ✅ Sem transferência para terceiros (apenas integrações necessárias)
- ✅ Auditoria interna de dados coletados
- ✅ Retenção documentada

### Falta Implementar
- ❌ Formulários explícitos de LGPD (acesso, exclusão, portabilidade)
- ❌ SOP documentado de resposta (10 dias)
- ❌ Consentimento explícito de Analytics (opt-in?)
- ❌ Criptografia de backup/export (TBD)

---

## 9. Próximas Ações Imediatas (TODAY)

```
[ ] 1. Encaminhar PRIVACY_POLICY.md + TERMS_OF_SERVICE.md para jurista
[ ] 2. Solicitar revisão com checklist acima
[ ] 3. Aguardar retorno em ~7 dias
[ ] 4. Implementar ajustes jurídicos
[ ] 5. Publicar URLs públicas
[ ] 6. Update código (settings.tsx)
[ ] 7. Deploy em produção
[ ] 8. Adicionar ao Play Console
```

---

## 10. Responsabilidades

### Jurista (Externo)
- ✅ Revisar LGPD (art. 3°-21)
- ✅ Revisar CDC (direitos do consumidor)
- ✅ Revisar termos de terceiros
- ✅ Sugerir ajustes
- ✅ Criar DPA (se necessário)

### Dev (Nós)
- ✅ Preparar documentos base (FEITO)
- ⚠️ Implementar ajustes jurídicos (Após revisão)
- ⚠️ Atualizar URLs no código
- ⚠️ Deploy em produção
- ⚠️ Monitorar conformidade

### Operacional (Nós)
- ⚠️ Registrar/ativar domínio
- ⚠️ Setup email de suporte
- ⚠️ Criar SOP de LGPD responses
- ⚠️ Auditoria anual

---

**FIM DO ROADMAP**

---

## Próximo Passo

**Hoje**: Encaminhar documentos para jurista com este checklist.

**Resultado esperado**: Feedback jurídico em 7-10 dias → Ajustes → Publicação em produção.

**Timeline total**: 4 semanas (da revisão jurídica ao Play Store).
