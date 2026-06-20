# RevendaSmart staging

This runbook prepares an isolated QA environment. Never reuse the production
project `revenda-smart`, production URLs, production Firebase users, production
data or Mercado Pago production credentials.

## Target topology

- Firebase/GCP project: `revenda-smart-staging-<unique-suffix>`.
- Cloud Run service: `revendasmart-backend-staging`.
- Vercel: separate project such as `revendasmart-staging`.
- Mercado Pago: separate test application, test seller and test buyer.
- QA user: `homologacao@revendasmart.test`.
- Store/slug: `Loja QA RevendaSmart` / `loja-qa-revendasmart`.

## Included files

- `.env.staging.example`: configuration contract without real credentials.
- `firebase.staging.json`: Firestore rules/indexes and Storage rules.
- `storage.rules`: public catalog images, owner-only mutations.
- `vercel.staging.template.json`: crawler rewrite for the staging backend.
- `scripts/staging/guard-staging.sh`: rejects production identifiers.
- `scripts/staging/deploy-*.sh`: explicit staging-only deploy commands.

## 1. Provision the Google Cloud/Firebase project

Review before execution:

```bash
export STAGING_PROJECT_ID="revenda-smart-staging-CHANGE_ME"
export STAGING_REGION="us-central1"
export BILLING_ACCOUNT_ID="CHANGE_ME"

gcloud projects create "$STAGING_PROJECT_ID" --name="RevendaSmart Staging"
gcloud billing projects link "$STAGING_PROJECT_ID" \
  --billing-account="$BILLING_ACCOUNT_ID"

gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  firestore.googleapis.com \
  firebaserules.googleapis.com \
  firebase.googleapis.com \
  identitytoolkit.googleapis.com \
  storage.googleapis.com \
  --project="$STAGING_PROJECT_ID"

npx --yes firebase-tools@latest projects:addfirebase "$STAGING_PROJECT_ID"

gcloud firestore databases create \
  --project="$STAGING_PROJECT_ID" \
  --location="$STAGING_REGION" \
  --type=firestore-native
```

In Firebase Console for staging:

1. Enable Authentication > Email/Password.
2. Initialize Storage in the staging project.
3. Create a Web app named `RevendaSmart Staging`.
4. Copy that app's SDK values to `.env.staging`.
5. Add only the Vercel staging domain to authorized domains.

Do not import production users or Firestore data.

## 2. Firebase Admin identity

```bash
gcloud iam service-accounts create revendasmart-staging-backend \
  --project="$STAGING_PROJECT_ID" \
  --display-name="RevendaSmart staging backend"

export STAGING_SA="revendasmart-staging-backend@$STAGING_PROJECT_ID.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding "$STAGING_PROJECT_ID" \
  --member="serviceAccount:$STAGING_SA" \
  --role="roles/datastore.user"

gcloud projects add-iam-policy-binding "$STAGING_PROJECT_ID" \
  --member="serviceAccount:$STAGING_SA" \
  --role="roles/firebaseauth.admin"

gcloud projects add-iam-policy-binding "$STAGING_PROJECT_ID" \
  --member="serviceAccount:$STAGING_SA" \
  --role="roles/storage.objectAdmin"
```

The current backend expects `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY`.
Generate a staging-only service account key, add its fields to staging Secret
Manager, then securely delete the JSON. Never commit it.

## 3. Mercado Pago test configuration

Create a separate Mercado Pago test application:

1. Create test seller and test buyer accounts in the same country.
2. Use only test credentials and test access tokens.
3. OAuth redirect:
   `https://<staging-backend>/api/mercadopago/callback`.
4. Payment webhook:
   `https://<staging-backend>/api/payments/webhook`.
5. Premium webhook:
   `https://<staging-backend>/api/app-subscription/webhook`.
6. Enable the payment/preapproval events used by the app.
7. Store the test webhook signature secret only in staging Secret Manager.

Generate a staging-only encryption key:

```bash
openssl rand -hex 32
```

## 4. Create staging secrets

Create the secret names listed in `.env.staging`. Add values through stdin or
the console so values do not enter shell history.

```bash
for secret in \
  revendasmart-staging-firebase-client-email \
  revendasmart-staging-firebase-private-key \
  revendasmart-staging-mp-access-token \
  revendasmart-staging-mp-client-id \
  revendasmart-staging-mp-client-secret \
  revendasmart-staging-mp-token-encryption-key \
  revendasmart-staging-mp-webhook-secret
do
  gcloud secrets create "$secret" \
    --replication-policy=automatic \
    --project="$STAGING_PROJECT_ID"
done
```

Grant the Cloud Run runtime identity Secret Accessor only for these staging
secrets.

Add one value/version to every created secret. Use stdin or the console; do not
put secret values directly in command arguments:

```bash
read -rs SECRET_VALUE
printf '%s' "$SECRET_VALUE" | gcloud secrets versions add \
  revendasmart-staging-mp-access-token \
  --data-file=- \
  --project="$STAGING_PROJECT_ID"
unset SECRET_VALUE
```

Repeat for each secret. Then grant the dedicated runtime identity access:

```bash
for secret in \
  revendasmart-staging-firebase-client-email \
  revendasmart-staging-firebase-private-key \
  revendasmart-staging-mp-access-token \
  revendasmart-staging-mp-client-id \
  revendasmart-staging-mp-client-secret \
  revendasmart-staging-mp-token-encryption-key \
  revendasmart-staging-mp-webhook-secret
do
  gcloud secrets add-iam-policy-binding "$secret" \
    --member="serviceAccount:$STAGING_SA" \
    --role="roles/secretmanager.secretAccessor" \
    --project="$STAGING_PROJECT_ID"
done
```

## 5. Local configuration

```bash
cp .env.staging.example .env.staging
chmod 600 .env.staging
```

Replace every `CHANGE_ME`. The guard rejects production project IDs, service
names, URLs and `NODE_ENV` values.

## 6. Deploy staging

Run only after explicit approval:

```bash
bash scripts/staging/deploy-firebase-staging.sh
bash scripts/staging/deploy-cloud-run-staging.sh
```

For the first Cloud Run bootstrap only, set `STAGING_BACKEND_URL`,
`APP_BASE_URL`, `VITE_API_BASE_URL` and `MERCADOPAGO_REDIRECT_URI` to
`https://staging.invalid`. Run the Cloud Run staging script once, then obtain
the real URL:

```bash
gcloud run services describe revendasmart-backend-staging \
  --region="$STAGING_REGION" \
  --project="$STAGING_PROJECT_ID" \
  --format='value(status.url)'
```

Replace all temporary URLs in `.env.staging` with that real URL, configure
Mercado Pago test OAuth/webhooks, and run the Cloud Run staging script again.
Do not exercise payment endpoints during the temporary-URL bootstrap.

Create and link a separate Vercel project:

```bash
npx --yes vercel@latest link --project revendasmart-staging
bash scripts/staging/deploy-vercel-staging.sh
```

The script creates a Preview deployment and intentionally omits `--prod`.

## 7. QA user

Create `homologacao@revendasmart.test` only in Firebase Auth staging. Store its
random password in the team password manager.

Complete onboarding with:

- store: `Loja QA RevendaSmart`;
- slug: `loja-qa-revendasmart`;
- catalog enabled;
- team-controlled test WhatsApp;
- no production logo, clients, products or payment data.

Expected paths use only the QA staging UID:

```text
users/{qaUid}/products
users/{qaUid}/clients
users/{qaUid}/sales
users/{qaUid}/installments
users/{qaUid}/charges
users/{qaUid}/marketingHistory
users/{qaUid}/planData/main
users/{qaUid}/mercadopago_connections
user_settings/{qaUid}
mercadopago_oauth_states/{nonce}
```

## 8. Post-deploy checklist

- [ ] `/health` returns 200.
- [ ] Service/project names are staging.
- [ ] `NODE_ENV=staging`.
- [ ] Frontend points only to staging Firebase and backend.
- [ ] Signup/login creates users only in staging.
- [ ] Firestore writes appear only in staging.
- [ ] Product/logo uploads use the staging bucket.
- [ ] `/u/loja-qa-revendasmart` opens without login.
- [ ] Unauthorized users cannot read clients, sales, charges or installments.
- [ ] OAuth stores only the test seller connection.
- [ ] Checkout visibly uses the Mercado Pago test environment.
- [ ] Test buyer can approve a test payment.
- [ ] Webhook changes the staging charge to `paid`.
- [ ] Invalid/expired Premium webhook signatures are rejected.
- [ ] No production project, UID, URL or credential appears in configuration.

## 9. Rollback

Cloud Run:

```bash
gcloud run revisions list \
  --service=revendasmart-backend-staging \
  --region="$STAGING_REGION" \
  --project="$STAGING_PROJECT_ID"

gcloud run services update-traffic revendasmart-backend-staging \
  --to-revisions="<PREVIOUS_REVISION>=100" \
  --region="$STAGING_REGION" \
  --project="$STAGING_PROJECT_ID"
```

Firebase: redeploy the previous Git revision with `firebase.staging.json`.

Vercel: restore the previous deployment/alias in the separate staging project.

Emergency shutdown:

```bash
gcloud run services update revendasmart-backend-staging \
  --no-allow-unauthenticated \
  --region="$STAGING_REGION" \
  --project="$STAGING_PROJECT_ID"
```

Export required QA evidence before deleting any staging resource.


## Official references

- Cloud Run source deploy: https://cloud.google.com/run/docs/deploying-source-code
- Firebase CLI: https://firebase.google.com/docs/cli
- Firebase Storage rules: https://firebase.google.com/docs/storage/security
- Vercel CLI deploy: https://vercel.com/docs/cli/deploy
- Mercado Pago test accounts: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/test/accounts
- Mercado Pago Webhooks: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
