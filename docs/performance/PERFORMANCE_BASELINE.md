# Performance Baseline - Revenda Smart

Baseline capturada em: 2026-07-12T17:44:49Z

> A baseline vem de `dist/public/assets` após o build local disponível no momento da geração. Se os hashes mudarem, compare por prefixo lógico do chunk.

## Maiores assets atuais

|name|type|sizeKb|gzipKb|
|---|---|---|---|
|vendor-scanner-C7vpVcnG.js|js|405.9|106.44|
|vendor-recharts-Dp5QVh74.js|js|326.05|81.6|
|vendor-firebase-core-BZg4FsNH.js|js|194.25|62.13|
|vendor-react-core-Bf_F8Trc.js|js|188.51|58.95|
|vendor-firebase-firestore-fusaW9k3.js|js|187.58|55.91|
|index-BoZ3C5CW.css|css|159.92|23.65|
|vendor-misc-Dkv2sgbk.js|js|158.1|53.43|
|vendor-firebase-auth-EBtqAJAy.js|js|74.77|22.05|
|vendor-firebase-observability-BYXHtFzS.js|js|52.55|15.92|
|dashboard-DzmCy0w-.js|js|44.21|11.52|
|settings-Bkj6tbp9.js|js|41.98|11.07|
|vendor-radix-ATDsa0Wq.js|js|33.84|11.52|
|vendor-date-fns-DuwTxBLw.js|js|31.63|8.89|
|vendor-ui-DZiiT1zZ.js|js|27.5|8.73|
|billings-4UZ3po23.js|js|27.42|7.96|
|add-product-BdW9iShG.js|js|26.44|7.65|
|vendor-lucide-C-9ZyYs-.js|js|25.01|8.54|
|index-BcQOz7WY.js|js|24.62|7.94|
|reports-D4nRqKTc.js|js|24.18|7.08|
|marketing-BZe7BpyZ.js|js|23.17|7.81|
|vendor-firebase-storage-CKWwT4xz.js|js|21.73|7.88|
|public-catalog-DWakgUPC.js|js|21.14|6.53|
|PrivateRouter-DGwxf1Qf.js|js|20.21|7.05|
|onboarding-C3FAxOEv.js|js|19.57|6.46|
|admin-D66xT0wF.js|js|18.3|4.82|
|sell-W4bPCFX5.js|js|16.98|5.27|
|client-detail-B13SmedT.js|js|16.63|4.99|
|products-Dy5PPba0.js|js|16.56|5.43|
|subscribe-DmNGLTCc.js|js|16.07|4.59|
|vendor-qrcode-Dx0Nn8Ts.js|js|16.06|5.97|

## Observações

- As novas skills são arquivos de governança e não entram no bundle.
- O budget checker valida assets gerados por `npm run build`.
- O scanner continua o maior vendor chunk conhecido e deve permanecer lazy.


## Observações de governança

- Esta baseline é um ponto de controle local, não uma promessa de performance real em todos os aparelhos.
- Mudanças acima de 10% em chunks críticos devem atualizar este documento com justificativa.
- Scanner e Recharts precisam continuar lazy para não voltar ao bundle inicial.
- Lighthouse/Core Web Vitals reais devem ser medidos somente em ambiente autorizado, nunca por automação contra produção sem aprovação.
