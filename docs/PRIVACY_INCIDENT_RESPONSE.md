# Runbook de resposta a incidente de privacidade/segurança

**Origem:** achado P1 "nenhum procedimento de resposta a incidente/comunicação à ANPD documentado" da auditoria `REVENDASMART-LGPD-ANPD-AUDIT-01`. Construído pela `REVENDASMART-LGPD-ANPD-REMEDIATION-01`, Fase 5.

Este é um runbook operacional mínimo, para uso humano. Não há comunicação automática a titulares ou à ANPD em nenhuma etapa — toda comunicação externa exige decisão humana explícita.

## O que conta como incidente

Qualquer evento que resulte, ou possa razoavelmente ter resultado, em acesso não autorizado, vazamento, alteração indevida ou perda de dados pessoais tratados pelo RevendaSmart — dados de contas de lojistas, dados de clientes cadastrados por lojistas, dados de pedidos do catálogo público, ou credenciais/tokens de provedores (Mercado Pago, Photoroom, Firebase).

Exemplos concretos, dado o que existe no código hoje: vazamento da chave de criptografia de tokens Mercado Pago (`MERCADOPAGO_TOKEN_ENCRYPTION_KEY`); comprometimento de uma credencial de serviço do Firebase Admin; uma regra do Firestore publicada incorretamente permitindo leitura cross-tenant; exposição acidental de um segredo (`PHOTOROOM_API_KEY`, `GEMINI_API_KEY`, credenciais MP) em log, repositório público ou build do cliente; falha do endpoint de exclusão de conta que deixa dados de um usuário acessíveis após ele ter solicitado exclusão.

## 1. Detecção

Fontes possíveis: alerta de monitoramento (quando configurado — ver `docs/OBSERVABILITY.md`, que hoje declara `PRODUCTION_ALERTING_READY: não`), relato de usuário/lojista, relato de pesquisador de segurança, achado interno durante desenvolvimento/auditoria, notificação de um provedor terceiro (Google, Mercado Pago, Photoroom).

Qualquer pessoa da equipe que suspeitar de um incidente deve reportar imediatamente por `revendasmart.suporte@gmail.com` com o assunto `[INCIDENTE]`, mesmo sem certeza — a triagem decide se é ou não um incidente real.

## 2. Contenção

Ação imediata para limitar o dano, antes de qualquer investigação aprofundada:

- Credencial comprometida → revogar/rotacionar imediatamente (Mercado Pago: usar `POST /api/mercadopago/revoke` ou revogar direto no provedor; chaves de API como `PHOTOROOM_API_KEY`/`GEMINI_API_KEY` → gerar nova chave no provedor e atualizar o Secret Manager; `MERCADOPAGO_TOKEN_ENCRYPTION_KEY` comprometida → ver nota de risco abaixo, é o caso mais grave).
- Regra do Firestore/Storage incorreta → reverter para a versão anterior imediatamente (`firebase deploy --only firestore:rules` / `storage:rules` com a versão conhecida-boa).
- Endpoint com bug de autorização → desabilitar a rota (feature flag ou remoção temporária) até corrigir.
- **Nota de risco:** se `MERCADOPAGO_TOKEN_ENCRYPTION_KEY` for comprometida, todos os tokens OAuth de conexões Mercado Pago armazenados (`users/{uid}/mercadopago_connections`) devem ser considerados em risco — rotacionar a chave sozinha não decripta o que já foi persistido com a chave antiga; o plano de contenção precisa incluir forçar reconexão de todos os lojistas com conta Mercado Pago ativa.

## 3. Preservação de evidência

Antes de limpar/corrigir qualquer coisa que apague rastro do incidente: copiar logs relevantes (`server/logger.ts` já produz `requestId` correlacionável), snapshot do estado do Firestore/Storage afetado se possível, e registrar timestamps exatos de detecção/contenção. Isso é necessário tanto para investigação quanto para uma eventual comunicação à ANPD, que pede detalhes concretos do incidente.

## 4. Avaliação de dados e titulares afetados

Responder, com o máximo de precisão que a evidência permitir: quais coleções/campos foram afetados (usar o inventário de `REVENDASMART-LGPD-ANPD-AUDIT-01` como referência — ex.: só metadados de conta, ou também `clients` com nome/telefone/notas de terceiros); quantos titulares (lojistas e/ou clientes de lojistas); se o titular afetado é usuário direto (tipo A) ou cliente de um lojista (tipo B) — ver `docs/DATA_SUBJECT_REQUEST_PROCEDURE.md`, já que isso muda quem precisa ser avisado e como.

## 5. Avaliação de risco/dano relevante

LGPD art. 48 exige comunicação quando o incidente "possa acarretar risco ou dano relevante aos titulares". Não existe uma fórmula automática para isso — é uma decisão humana considerando: sensibilidade do dado exposto (nome/telefone é diferente de senha/token financeiro), volume de titulares, se houve exploração real ou só exposição potencial, e se o dado exposto pode ser usado para fraude/golpe (ex.: uma chave Pix vazada pode ser usada para golpe de engenharia social).

## 6. Decisão de comunicação — ANPD

Se a avaliação do item 5 indicar risco ou dano relevante: comunicar à ANPD "em prazo razoável", conforme art. 48 da LGPD. Este runbook não define um número de horas/dias fixo — a lei usa "prazo razoável" e a regulamentação específica da ANPD sobre o conteúdo da comunicação deve ser consultada no momento (ver referências oficiais já usadas na auditoria original). **Isto exige decisão humana e, idealmente, orientação jurídica no momento do incidente** — não é algo que este runbook possa pré-aprovar.

## 7. Decisão de comunicação — titulares

Mesma lógica do item 6: se houver risco/dano relevante, os titulares afetados devem ser informados. Para titulares tipo A (lojistas), o canal é o e-mail de conta. Para titulares tipo B (clientes de lojistas), a comunicação direta pode não ser possível sem passar pelo lojista (controlador) — coordenar com o lojista afetado, seguindo a mesma lógica de `docs/DATA_SUBJECT_REQUEST_PROCEDURE.md`.

## 8. Registro do incidente

Todo incidente confirmado (mesmo os que não geram comunicação externa) deve ser registrado com: data de detecção, data de contenção, causa raiz, dados/titulares afetados, decisão tomada nos itens 6 e 7 (e por quê), e ações corretivas aplicadas. Até que exista uma coleção/planilha dedicada, o registro mínimo é um documento datado salvo internamente (fora do código-fonte, para não expor detalhes de incidentes publicamente).

## 9. Manutenção do registro

O registro deve ser mantido por prazo suficiente para eventual fiscalização da ANPD — este runbook não define esse prazo (é uma decisão pendente, mesma natureza dos itens da categoria C em `docs/DATA_RETENTION_REGISTER.md`).

## 10. Responsáveis internos

Enquanto não houver um Encarregado formal (ver `docs/DPO_SMALL_PROCESSING_AGENT_ASSESSMENT.md`), a responsabilidade por acionar este runbook e tomar as decisões dos itens 6 e 7 é de quem responde por `revendasmart.suporte@gmail.com` — o mesmo canal já publicado na Política de Privacidade.

## 11. Checklist pós-incidente

- [ ] Causa raiz corrigida (não só contida)
- [ ] Credenciais/chaves rotacionadas, se aplicável
- [ ] Regras de Firestore/Storage revisadas quanto a regressão
- [ ] Titulares afetados identificados e comunicação decidida (item 6/7)
- [ ] Registro do incidente arquivado (item 8)
- [ ] Lição aprendida incorporada — ex.: se o incidente veio de um gap já listado em `REVENDASMART-LGPD-ANPD-AUDIT-01`, atualizar a prioridade desse item
