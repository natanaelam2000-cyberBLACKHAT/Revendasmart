# Matriz de retenção de dados

**Origem:** achado P1 "retenção indefinida sem prazo definido" da auditoria `REVENDASMART-LGPD-ANPD-AUDIT-01`. Construída pela `REVENDASMART-LGPD-ANPD-REMEDIATION-01`, Fase 3.

## Como usar esta matriz

Cada item é classificado em uma de três categorias:

- **A — prazo definido por necessidade operacional**, já implementado no código, e defensável sem parecer jurídico externo (ex.: "enquanto a conta está ativa" é uma necessidade operacional óbvia — não dá pra sincronizar produtos de uma conta que não existe mais).
- **B — prazo definido por obrigação legal.** Nenhum item nesta auditoria foi classificado aqui com confiança suficiente para implementar um TTL automático — ver nota abaixo.
- **C — prazo ainda dependente de decisão jurídica.** Não implementamos TTL/job de expiração para nada nesta categoria nesta rodada. Escolher um prazo arbitrário aqui seria pior do que documentar o gap: poderia apagar algo que uma obrigação legal (ex.: prevenção a fraude, defesa em processo) ainda exige, ou reter algo além do necessário sem base. Ver `docs/DPO_SMALL_PROCESSING_AGENT_ASSESSMENT.md`.

**Nota sobre a categoria B:** nenhum dos itens abaixo tem hoje uma obrigação legal *identificada com precisão suficiente* (ex.: um artigo de lei tributária ou financeira específico com prazo numérico) para ser implementada como TTL sem risco de errar o prazo. Onde uma obrigação legal é plausível (ex.: evidências financeiras), ela está listada em C até que essa obrigação seja confirmada com prazo exato — nesse momento ela migra de C para B.

## Matriz

| DATA | RETENTION PERIOD | WHY | DELETE TRIGGER | LEGAL NEED | ACTUAL CODE |
|---|---|---|---|---|---|
| `users/{uid}/products`, `clients`, `sales`, `orders`, `installments`, `charges`, `marketingHistory`, `pendingSales` | Enquanto a conta está ativa | (A) Necessidade operacional — são os dados que o serviço existe para armazenar | Exclusão de conta (`DELETE /api/account`) | Nenhuma obrigação legal identificada além da relação contratual em curso | `server/account-deletion.ts:138` (`recursiveDelete`) — implementado e funcional |
| `user_settings/{uid}`, `admin_users/{uid}` | Enquanto a conta está ativa | (A) Necessidade operacional | Exclusão de conta | — | `server/account-deletion.ts:111-112` — implementado |
| Uploads: fotos de produto, logo, cutouts, fundos de Marketing Pro (`users/{uid}/**` no Storage) | Enquanto a conta está ativa | (A) Necessidade operacional | Exclusão de conta | — | `server/account-deletion.ts:139` (`bucket.deleteFiles`) — implementado |
| `mercadopago_connections/{id}` | Enquanto a conexão está ativa; nome/e-mail/merchantId preservados mesmo após revogação (comentário em `server/mercadopago-connections.ts:836`) | (A) Rastreabilidade operacional da conexão | Desconexão manual não apaga o registro, só zera tokens; exclusão de conta remove tudo | (C) Se deveria haver um prazo pós-revogação para os campos preservados é uma decisão pendente | `server/mercadopago-connections.ts:826-840` |
| **`account_deletion_requests/{uid}` (tombstone)** | **Indefinido — sem TTL** | Impede reuso de um token de sessão válido após a exclusão (`userOwnsResource`, `firestore.rules:11-15`) e bloqueia recriação de conta com credenciais antigas (`server/routes.ts:346-350`) | Nenhum implementado | **(C)** — precisa de decisão jurídica sobre por quanto tempo esse registro de segurança deve ou pode ser mantido | `server/account-deletion.ts:129-149` — nenhuma mudança feita nesta rodada; documentado como blocker |
| **`referralCodes/{code}`** (índice reverso código→uid) | **Indefinido — sem TTL** | Permite resolver um código de indicação até que a conta associada seja excluída | Nenhum implementado | **(C)** — sobrevive à exclusão da conta que o gerou; decisão pendente sobre se/quando deve ser limpo | `server/routes.ts:1776-1791`; não tocado por `deleteRootReferences` — documentado como blocker |
| **`googlePlayPurchaseTokens/{hash}`** | **Indefinido — sem TTL** | Previne reuso do mesmo token de compra (antifraude) | Nenhum implementado | **(C)** — decisão pendente sobre prazo pós-cancelamento/exclusão da assinatura | `server/google-play-billing.ts:154,186` — documentado como blocker |
| Evidências financeiras internas (histórico de `sales`/`charges` já apagado pela exclusão de conta — este item cobre qualquer cópia/relatório fora do Firestore, se existir) | Não implementado nenhum prazo | Possível obrigação tributária/contábil do lojista (não do RevendaSmart, que não gera nota fiscal — ver Termos de Uso §4.3) | — | **(C)** — nenhuma obrigação legal específica do RevendaSmart foi identificada nesta auditoria; se existir, é responsabilidade do lojista, não da plataforma | Não há coleção dedicada a isso hoje |
| Logs de servidor / Cloud Run / eventuais logs no Sentry | Não implementado nenhum prazo pelo RevendaSmart — depende da retenção padrão de cada provedor (Cloud Logging, Sentry) | Diagnóstico operacional | — | **(C)** — prazo formal ainda não decidido; a política vigente já é honesta sobre isso ("Prazos finais para logs, telemetria... ainda precisam de uma decisão formal") | `server/logger.ts` — sem TTL próprio, delega ao provedor |
| Cache local (localStorage/IndexedDB, incluindo cache offline do Firestore) | Enquanto o dispositivo mantiver a sessão; limpo em logout e exclusão de conta | (A) Necessidade operacional (uso offline) | Logout (`clearFirestoreOfflineCache`), exclusão de conta | — | `client/src/lib/firebase.ts:71-86`; gap de cobertura em chaves não escopadas por uid tratado na Fase 8 |
| Analytics/Performance (Firebase) | Retenção padrão do provedor (não configurada/confirmada nesta auditoria) | — | — | **(C)** — mesma pendência já registrada em `docs/PLAY_DATA_SAFETY_MATRIX.md` | Não controlado pelo código do app |
| **`adminGrantAuditLog/{autoId}`** (OWNER-ACCESS-02 — quem concedeu/revogou Tester/Premium+, para quem, quando) | **Indefinido — sem TTL** | Responsabilização administrativa (quem concedeu o quê); coleção top-level, não sob `users/{uid}`, então `recursiveDelete` da exclusão de conta não a alcança de propósito — o ticket que a criou pediu explicitamente para seguir esta mesma política já documentada, não apagar | Nenhum implementado | **(C)** — mesmo padrão de `referralCodes`/`googlePlayPurchaseTokens`: sobrevive à exclusão da conta (actor ou alvo), decisão pendente sobre se/quando deve ser limpo | `server/admin-grants.ts` (`writeGrantAuditLog`) — nunca lido/apagado pelo fluxo de exclusão de conta |

## Decisão desta rodada

Nenhum job de TTL automático novo foi implementado. Todos os itens sem prazo definido hoje (tombstone, `referralCodes`, `googlePlayPurchaseTokens`, evidências financeiras, logs/Analytics) foram avaliados e classificados como categoria **C** — decisão jurídica pendente — porque nenhum tem uma obrigação legal com prazo numérico conhecido o suficiente para ser codificado sem risco de apagar algo antes da hora ou reter algo além do necessário. Implementar um prazo arbitrário aqui teria sido pior do que deixar o gap documentado, que é exatamente o que este documento faz.

## Próximo passo

Decisão jurídica formal sobre os itens C, especialmente o tombstone de exclusão e os dois índices que sobrevivem à exclusão de conta (`referralCodes`, `googlePlayPurchaseTokens`) — hoje são os únicos registros que retêm um vínculo com um uid **depois** que o usuário pediu para ser esquecido.
