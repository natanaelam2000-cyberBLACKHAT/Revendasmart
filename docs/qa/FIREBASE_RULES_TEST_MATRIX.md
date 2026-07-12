# Matriz de Testes Firebase Rules e Storage — Revenda Smart

| Área | Arquivo | Evidência atual | Status | Teste pendente |
|---|---|---|---|---|
| products | `firestore.rules` | UID próprio, allowlist e tipos básicos | PASS | Emulator usuário A/B |
| clients | `firestore.rules` | UID próprio, allowlist e tipos básicos | PASS | Emulator usuário A/B |
| sales | `firestore.rules` | create próprio; update/delete false | PASS | Emulator positivo/negativo |
| charges | `firestore.rules` | read próprio; create/update/delete client bloqueado | PASS | Emulator |
| installments | `firestore.rules` | read próprio; create/delete false; update restrito | PASS | Emulator |
| mercadopago_connections | `firestore.rules` | read próprio; escrita client bloqueada | PASS | Emulator |
| user_settings | `firestore.rules` | root read/write false; backend como fonte | PASS | Teste API autenticado |
| planData | `firestore.rules` | root read/write false | PASS | Teste API autenticado |
| marketingHistory | `firestore.rules` | sem regra explícita; default deny | PARTIAL | Decidir local-only/backend/rule |
| Storage products | `storage.rules` | owner write; public read; JPEG/PNG/WebP; max 5MB | PASS | Emulator SVG/arquivo grande |
| Storage branding | `storage.rules` | owner write; public read; JPEG/PNG/WebP; max 5MB | PASS | Emulator SVG/arquivo grande |

Nenhum teste de acesso cruzado com dados reais foi executado.
