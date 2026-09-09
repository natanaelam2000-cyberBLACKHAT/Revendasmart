# Runbook de Rotação de Credenciais — RevendaSmart

Preparado para a contenção do incidente RC-P0-SECURITY-01/02A (credenciais reais expostas no
histórico do Git, commit `4c0d0377fa77955ce3d2fc6be048b791d9be5235` e ancestrais, redigidas a
partir de `a672ef1` mas ainda recuperáveis do histórico completo — ver o relatório dessa auditoria
para os detalhes de exposição).

**Este documento contém apenas nomes de variáveis, nomes de recursos do Secret Manager, comandos
com placeholders e procedimentos. Nenhum valor real de segredo aparece aqui, em nenhuma etapa.**

Convenções já usadas neste repositório e reaproveitadas aqui (não inventadas):

```text
PROJECT_ID = revenda-smart
REGION     = us-central1
SERVICE    = revendasmart-backend
```

Fonte: `docs/SECRET_MANAGER_CLOUD_RUN.md` (já existente neste repositório).

## Nomes canônicos de secret já usados por este repositório

| Env var (Cloud Run) | Secret Manager | Provedor |
| --- | --- | --- |
| `FIREBASE_PROJECT_ID` | `revendasmart-firebase-project-id` | Firebase / GCP |
| `FIREBASE_CLIENT_EMAIL` | `revendasmart-firebase-client-email` | Firebase / GCP |
| `FIREBASE_PRIVATE_KEY` | `revendasmart-firebase-private-key` | Firebase / GCP |
| `MERCADOPAGO_ACCESS_TOKEN` | `revendasmart-mercadopago-access-token` | Mercado Pago |
| `MERCADOPAGO_CLIENT_ID` | `revendasmart-mercadopago-client-id` | Mercado Pago |
| `MERCADOPAGO_CLIENT_SECRET` | `revendasmart-mercadopago-client-secret` | Mercado Pago |
| `MERCADOPAGO_TOKEN_ENCRYPTION_KEY` | `revendasmart-mercadopago-token-encryption-key` | Interno (não rotacionar agora — ver Seção I) |
| `MERCADOPAGO_WEBHOOK_SECRET` | `revendasmart-mercadopago-webhook-secret` | Mercado Pago |

Nunca invente um nome de secret diferente destes — eles já são os nomes reais usados pelo Cloud
Run em produção (`docs/SECRET_MANAGER_CLOUD_RUN.md`).

## Ferramentas seguras já existentes neste repositório

Reaproveitadas neste runbook, não recriadas:

- `scripts/security/verify-cloud-run-secrets.sh` — confirma se cada env sensível do Cloud Run está
  `secret` (Secret Manager), `plain` (texto puro — nunca deveria acontecer) ou `missing`.
- `scripts/security/update-secret-version.sh` — adiciona uma nova versão de um secret lendo o
  valor via **stdin**, nunca como argumento de linha de comando (o valor nunca aparece no
  histórico do shell nem em `ps`).

Novos, adicionados por este ticket (ver Seção F):

- `script/security-verify-firebase-admin.ts` (`npm run security:verify-firebase`)
- `script/security-verify-mercadopago.ts` (`npm run security:verify-mp`)

---

## A. Rotação da chave do Firebase Admin

**Console:** Google Cloud Console → IAM e administrador → Contas de serviço →
`firebase-adminsdk-fbsvc@revenda-smart.iam.gserviceaccount.com` → aba **Chaves**.

1. Anote (sem copiar o conteúdo) o ID da chave atualmente comprometida, só para referência de
   qual excluir depois.
2. **Não exclua a chave antiga ainda.**
3. Clique em **Adicionar chave → Criar nova chave → JSON**. O navegador baixa um arquivo JSON.
4. Salve esse arquivo **fora deste repositório**, em um local temporário e seguro (ex.: uma pasta
   fora de qualquer diretório do Git). Nunca o salve dentro de `revendasmart-ads-pro-03-fast/`.
5. O `client_email` do JSON novo será o mesmo de sempre (mesma service account) — isso é esperado,
   não é um sinal de erro.

Do JSON novo você precisa de três campos para a Seção B: `project_id`, `client_email`,
`private_key`.

## B. Atualizar o Google Secret Manager

PowerShell (preferencial — o operador está no Windows):

```powershell
gcloud auth login
gcloud config set project revenda-smart

# Confirme que o secret já existe (não recria, só descreve):
gcloud secrets describe revendasmart-firebase-private-key

# Leia o valor de um arquivo LOCAL fora do repositório (nunca digite o valor direto no comando):
Get-Content "C:\caminho\seguro\fora-do-repo\new-private-key.txt" -Raw |
  gcloud secrets versions add revendasmart-firebase-private-key --data-file=-
```

Se o `client_email`/`project_id` também mudaram (normalmente não mudam ao só girar a chave da
mesma service account — só atualize se realmente forem diferentes):

```powershell
Get-Content "C:\caminho\seguro\fora-do-repo\new-client-email.txt" -Raw |
  gcloud secrets versions add revendasmart-firebase-client-email --data-file=-
```

**Depois de adicionar a nova versão, apague o arquivo local:**

```powershell
Remove-Item "C:\caminho\seguro\fora-do-repo\new-private-key.txt" -Force
Remove-Item "C:\caminho\seguro\fora-do-repo\new-client-email.txt" -Force -ErrorAction SilentlyContinue
```

Bash equivalente (via Git Bash, já usado neste projeto — usa o script seguro já existente no
repositório em vez de reescrever o comando `gcloud` manualmente):

```bash
printf "%s" "$(cat /caminho/seguro/fora-do-repo/new-private-key.txt)" | \
  scripts/security/update-secret-version.sh revendasmart-firebase-private-key
```

## C. Nova revisão do Cloud Run e verificação

O Cloud Run resolve o valor do secret na inicialização da instância — uma nova versão do secret
sozinha não afeta revisões já em execução. É preciso criar uma nova revisão (ou reiniciar) para
que o backend carregue a versão nova.

```powershell
# Confirma como a revisão atual referencia os secrets (nomes apenas, nunca cole a saída completa
# em um relatório/chat — ela pode conter referências relevantes de configuração):
scripts/security/verify-cloud-run-secrets.sh --project revenda-smart --region us-central1 --service revendasmart-backend

# Cria uma nova revisão apontando explicitamente para :latest de cada secret (mesmo comando já
# documentado em docs/SECRET_MANAGER_CLOUD_RUN.md — reaproveitado aqui):
gcloud run services update revendasmart-backend `
  --project revenda-smart `
  --region us-central1 `
  --update-secrets=FIREBASE_PROJECT_ID=revendasmart-firebase-project-id:latest,FIREBASE_CLIENT_EMAIL=revendasmart-firebase-client-email:latest,FIREBASE_PRIVATE_KEY=revendasmart-firebase-private-key:latest
```

Execute somente em janela controlada (baixo tráfego, você observando os logs).

## D. Renovação do par Mercado Pago Access Token / Public Key

**Console:** Mercado Pago Developers → Suas integrações → aplicação do RevendaSmart →
Credenciais de produção.

> Renovar o par Public Key + Access Token renova **as duas** credenciais ao mesmo tempo — isso é
> esperado, não é um efeito colateral indesejado.

1. Selecione **Public Key + Access Token → ⋮ → Renovar → Renovar agora**.
2. Copie o novo Access Token apenas para um arquivo local temporário fora do repositório (mesmo
   padrão da Seção A) — nunca cole em chat, issue, PR ou commit.
3. Atualize o Secret Manager:

```powershell
Get-Content "C:\caminho\seguro\fora-do-repo\new-mp-access-token.txt" -Raw |
  gcloud secrets versions add revendasmart-mercadopago-access-token --data-file=-

Remove-Item "C:\caminho\seguro\fora-do-repo\new-mp-access-token.txt" -Force
```

4. Se algum ambiente usa a Public Key correspondente (verifique com `git grep -n
   "MERCADOPAGO_PUBLIC_KEY\|VITE_MERCADOPAGO_PUBLIC_KEY"` neste repositório antes de assumir que
   sim ou não), atualize-a também.
5. Nova revisão do Cloud Run apontando para a versão nova (mesmo padrão da Seção C, incluindo
   `MERCADOPAGO_ACCESS_TOKEN=revendasmart-mercadopago-access-token:latest`).

## E. Renovação do par Mercado Pago Client ID / Client Secret

Mesmo painel de credenciais de produção.

> Renovar o par Client ID + Client Secret renova **as duas** credenciais ao mesmo tempo.

1. Selecione **Client ID + Client Secret → Renovar**.
2. Salve os dois valores novos em arquivos locais temporários fora do repositório.
3. Atualize os dois secrets:

```powershell
Get-Content "C:\caminho\seguro\fora-do-repo\new-mp-client-id.txt" -Raw |
  gcloud secrets versions add revendasmart-mercadopago-client-id --data-file=-

Get-Content "C:\caminho\seguro\fora-do-repo\new-mp-client-secret.txt" -Raw |
  gcloud secrets versions add revendasmart-mercadopago-client-secret --data-file=-

Remove-Item "C:\caminho\seguro\fora-do-repo\new-mp-client-id.txt" -Force
Remove-Item "C:\caminho\seguro\fora-do-repo\new-mp-client-secret.txt" -Force
```

4. Nova revisão do Cloud Run (Seção C) incluindo também
   `MERCADOPAGO_CLIENT_ID=revendasmart-mercadopago-client-id:latest,MERCADOPAGO_CLIENT_SECRET=revendasmart-mercadopago-client-secret:latest`.

5. **Não mexa ainda** nos `accessToken`/`refreshToken` OAuth já armazenados dos lojistas
   conectados (`users/{uid}/mercadopago_connections/{connectionId}`) — eles continuam protegidos
   pela `MERCADOPAGO_TOKEN_ENCRYPTION_KEY` atual, que não é tocada nesta rodada (Seção I).

---

## F. Verificação pós-rotação

### F1 — Firebase Admin

```powershell
$env:FIREBASE_PROJECT_ID = "revenda-smart"
# defina FIREBASE_CLIENT_EMAIL e FIREBASE_PRIVATE_KEY no shell local a partir do arquivo temporário
# que você já vai apagar depois — nunca a partir de um valor colado direto no terminal history
npm run security:verify-firebase
```

Saída esperada:

```text
FIREBASE_ENV_PRESENT = YES
FIREBASE_ADMIN_INIT = PASS
FIRESTORE_READ = PASS
FIRESTORE_WRITE_DELETE = SKIPPED
```

Para também confirmar escrita real (opcional, cria e apaga um documento isolado em
`_ops_verification`, nunca em uma coleção de negócio):

```powershell
npm run security:verify-firebase -- --write-check
```

### F2 — Mercado Pago (config apenas, sem chamada de rede)

```powershell
npm run security:verify-mp
```

Saída esperada:

```text
MP_ACCESS_TOKEN_PRESENT = YES
MP_CLIENT_ID_PRESENT = YES
MP_CLIENT_SECRET_PRESENT = YES
MP_TOKEN_ENCRYPTION_KEY_PRESENT = YES
```

### F3 — Mercado Pago (autenticação real, opcional, read-only)

```powershell
npm run security:verify-mp -- --provider-check
```

Isso chama `GET https://api.mercadopago.com/users/me` (o mesmo endpoint que
`server/mercadopago-connections.ts` já usa em produção) com o Access Token novo — confirma que o
token autentica de verdade, sem criar pagamento, PIX, assinatura ou modificar nada. A resposta
nunca é impressa, só o status HTTP.

### F4 — Cloud Run / rede

```powershell
$BACKEND_URL = gcloud run services describe revendasmart-backend --project revenda-smart --region us-central1 --format="value(status.url)"
Invoke-WebRequest -Uri "$BACKEND_URL/health" -UseBasicParsing | Select-Object StatusCode
```

Esperado: `200`.

### F5 — OAuth Client ID/Secret (procedimento manual — não pode ser automatizado com segurança)

A validação real de um Client Secret exige um round-trip de autorização OAuth genuíno. **Não
simule isso** — use uma conta de teste do Mercado Pago:

1. `OAUTH_AUTHORIZE_URL_GENERATION` — na tela de "Conectar Mercado Pago" do app (ambiente de
   staging/local), gere a URL de autorização e confirme que ela usa o novo `MERCADOPAGO_CLIENT_ID`
   (visível como parâmetro `client_id` na própria URL gerada, o que é público por design).
2. `OAUTH_CALLBACK_STATE_VALIDATION` — complete o fluxo com uma conta de teste Mercado Pago;
   confirme que o callback é aceito (não retorna erro de `state` inválido).
3. `OAUTH_CODE_EXCHANGE` — confirme nos logs do backend (nunca no payload completo) que a troca do
   `code` por token teve sucesso (HTTP 200 do lado do Mercado Pago).
4. `TOKEN_STORAGE_ENCRYPTION` — confirme que o novo registro em `mercadopago_connections` tem os
   campos `accessToken`/`refreshToken` no formato `EncryptedToken` (ciphertext/iv/authTag), nunca
   texto plano.
5. `TOKEN_DECRYPTION` — confirme que a conexão de teste funciona normalmente (ex.: consegue gerar
   um link de pagamento) — isso prova implicitamente que `decryptToken` funcionou com a
   `MERCADOPAGO_TOKEN_ENCRYPTION_KEY` atual (não tocada nesta rodada).

**Nunca sobrescreva a conexão de um lojista real durante este teste** — use somente uma conta de
teste dedicada.

## G. Revogação da credencial antiga

**Só execute esta seção depois que TODAS as verificações da Seção F relevantes passarem.**

Firebase:

1. Google Cloud Console → Contas de serviço → `firebase-adminsdk-fbsvc@revenda-smart.iam.gserviceaccount.com` → Chaves.
2. Localize a chave antiga (o ID anotado na Seção A).
3. Exclua/revogue.
4. Rode `npm run security:verify-firebase` de novo — deve continuar `PASS` em tudo (agora usando
   só a chave nova).

Mercado Pago: a própria ação de "Renovar" já invalida o par antigo automaticamente — não há um
passo de revogação manual separado, mas confirme rodando `npm run security:verify-mp --
--provider-check` de novo depois da renovação para ter certeza de que o valor atualmente no
Secret Manager (o novo) é o que está realmente autenticando.

## H. Rollback

**Se o runtime novo falhar ANTES de revogar a credencial antiga (cenário seguro — é para isso que
a Seção G existe):**

```powershell
gcloud run revisions list --project revenda-smart --region us-central1 --service revendasmart-backend

gcloud run services update-traffic revendasmart-backend `
  --project revenda-smart --region us-central1 `
  --to-revisions REVISAO_ANTERIOR_SAUDAVEL=100
```

Investigue a causa antes de tentar de novo. A credencial antiga continua funcionando normalmente
até você chegar na Seção G — não há pressa destrutiva.

**Se a credencial antiga já foi revogada e o runtime novo falhar:**

- **Não tente reutilizar a credencial antiga** — ela já foi revogada no provedor, reativá-la (se
  possível) reabriria a mesma janela de exposição que este runbook existe para fechar.
- Gere uma credencial de substituição válida (repita a Seção A ou D/E conforme o provedor) e trate
  como uma nova rodada de rotação, não como uma correção emergencial da anterior.

## I. NÃO ROTACIONAR `MERCADOPAGO_TOKEN_ENCRYPTION_KEY` NESTA RODADA

```text
STATUS: MIGRATION_REQUIRED_BEFORE_ROTATION
```

Fatos já confirmados sobre esta chave (`server/mercadopago-crypto.ts`):

- Algoritmo: AES-256-GCM.
- Protege os `accessToken`/`refreshToken` OAuth **dos lojistas que conectaram sua própria conta
  Mercado Pago** — não o token central da plataforma.
- O ciphertext já persistido em `users/{uid}/mercadopago_connections/*` só pode ser decifrado com
  a chave EXATA que o criptografou.
- `EncryptedToken` não tem campo `keyVersion`/`keyId` — não existe suporte a múltiplas chaves
  simultâneas hoje.
- Não existe nenhuma migração/re-criptografia implementada.

**Rotacionar esta chave agora, sem migração, tornaria permanentemente ilegíveis os tokens de
TODOS os lojistas já conectados — forçando reconexão manual de todos eles.** Isso é uma mudança de
arquitetura separada (adicionar `keyVersion`, suportar decrypt com a chave antiga ou nova durante
uma janela de transição, rodar uma migração em lote, só então aposentar a chave antiga) — fora do
escopo desta rotação de contenção.

Não trocar o valor no Secret Manager. Não remover a chave antiga. Não pedir para lojistas
reconectarem. Não tentar re-criptografar documentos manualmente.

---

## Pendência de limpeza do repositório

```text
POST_ROTATION_REPO_CLEANUP_PENDING = YES
```

O arquivo `.replit` no HEAD atual ainda tem `FIREBASE_CLIENT_EMAIL` em texto plano (não é uma
credencial que autentica sozinha, mas é metadado sensível que não deveria estar versionado). Isso
será limpo em um ticket separado, **depois** que a rotação acima estiver confirmada — não faz
parte deste runbook de preparação.

## O que este runbook nunca faz

- Nunca imprime valor real de secret, token, chave privada ou client secret.
- Nunca cria pagamento, PIX, assinatura ou cobrança real.
- Nunca modifica configuração de webhook.
- Nunca reescreve histórico do Git nem faz `force push`.
- Nunca pede para colar um segredo em chat, issue, PR, commit ou relatório.
