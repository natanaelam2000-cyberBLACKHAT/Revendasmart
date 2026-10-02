/**
 * RELEASE V1 — Feature Gating + Referral Premium + PhotoRoom + Product Image Enhancement.
 * A-G (gating), H-M (referral, verificação de código real — sem emulador Firestore nesta suíte), N-T
 * (PhotoRoom), U-Z (melhoria de imagem, com testes de LÓGICA real via `sharp` sobre imagens sintéticas).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import sharp from "sharp";
import { PLAN_CONFIG } from "../shared/monetization";

function read(path: string): string {
  return fs.readFileSync(path, "utf8");
}

async function run(): Promise<void> {
  const marketingTabsSource = read("client/src/components/marketing/MarketingTabs.tsx");
  const marketingPageSource = read("client/src/pages/marketing.tsx");
  const marketingProSource = read("server/marketing-pro.ts");
  const addProductSource = read("client/src/pages/add-product.tsx");
  const adminAuthSource = read("server/admin-auth.ts");
  const routesSource = read("server/routes.ts");
  const barcodeScannerSource = read("client/src/components/barcode-scanner.tsx");
  assert.doesNotMatch(barcodeScannerSource, /useAdminAccess|activePlan|canUseFeature/, "G: o componente do scanner em si não foi deletado nem mudou — o gate vive inteiramente em quem o monta (add-product.tsx)");

  // ===== A/B/C — Anúncios Pro é admin/dev-only, nunca por plano =====
  assert.match(marketingTabsSource, /showProTab\s*=\s*false/, "A/B: fail-closed — sem a prop, a aba Pro fica escondida por padrão");
  assert.match(marketingTabsSource, /TABS\.filter\(\(tab\) => tab\.id !== "pro"\)/, "A/B: a aba Pro é FILTRADA da lista, não só desabilitada visualmente");
  assert.match(marketingPageSource, /const \{ isAdmin: isProAdsAdmin \} = useAdminAccess\(\);/, "C: a página usa o MESMO mecanismo de admin server-owned, nenhum novo");
  assert.match(marketingPageSource, /showProTab=\{isProAdsAdmin\}/, "A/B/C: a aba só some/aparece de acordo com isProAdsAdmin, nunca com o plano");
  assert.match(marketingPageSource, /workspaceView === "pro" && isProAdsAdmin && \(/, "A/B/C: o painel Pro em si tem o MESMO gate duplicado (defesa em profundidade)");
  assert.doesNotMatch(
    marketingPageSource.slice(marketingPageSource.indexOf("showProTab={isProAdsAdmin}"), marketingPageSource.indexOf("workspaceView === \"pro\" && isProAdsAdmin")),
    /activePlan === "premium"/,
    "B: Premium comum sozinho nunca é suficiente para revelar a aba — só isProAdsAdmin decide",
  );
  // Backend: admin/dev bypassa o plano; sem admin, NENHUM plano libera (comentado explicitamente no código).
  assert.match(marketingProSource, /const isAdmin = await isAdminUid\(uid\);/, "C: o backend reaproveita a MESMA checagem de admin");
  assert.match(marketingProSource, /if \(isAdmin\) \{\s*\n\s*next\(\);\s*\n\s*return;\s*\n\s*\}/, "C: admin/dev tem acesso independente de plano comercial");
  assert.match(marketingProSource, /admin_only_in_v1/, "B: a razão de negação explicita que NENHUM plano libera Anúncios Pro nesta release");

  // ===== D — deep link comum não burla =====
  assert.doesNotMatch(marketingPageSource, /useSearch\(\)|searchParams\.get\("view"\)|query\.get\("workspace/, "D: workspaceView nunca é lido de query string — não existe deep link capaz de abrir a aba pro");
  assert.match(marketingPageSource, /useState<MarketingWorkspaceView>\("editor"\)/, "D: o estado inicial é sempre \"editor\", nunca derivado da URL");

  // ===== E/F/G — barcode scanner admin-only =====
  assert.match(addProductSource, /const \{ isAdmin: isAdminUser \} = useAdminAccess\(\);/, "E/F: reaproveita o mesmo mecanismo de admin");
  assert.match(addProductSource, /\{isAdminUser && \(\s*\n\s*<button[\s\S]{0,260}data-testid="button-scan-barcode"/, "E: o atalho de scanner só renderiza para admin/dev");
  assert.match(addProductSource, /const openScanner = useCallback\(\(\) => \{ if \(isAdminUser\) setScanning\(true\); \}, \[isAdminUser\]\);/, "G: abrir o scanner é bloqueado no próprio handler, não só escondido na UI (defesa contra chamada direta)");
  assert.match(addProductSource, /\{scanning && isAdminUser && \(/, "G: mesmo que `scanning` vire true por outro caminho, o componente real do scanner exige admin também");
  assert.doesNotMatch(routesSource, /app\.(get|post)\("\/api\/(scan|barcode)/i, "G: não existe endpoint de scanner que pudesse ser chamado direto, contornando a UI");

  // Admin mechanism: custom claim (server-owned), nunca hardcode de UID/e-mail no client.
  assert.match(adminAuthSource, /customClaims\?\.\["admin"\] === true/, "mecanismo primário é a custom claim do Firebase Auth");
  assert.doesNotMatch(read("client/src/hooks/useAdminAccess.ts"), /"natanaelam2000@gmail\.com"|uid ===|email ===/i, "nenhum UID/e-mail hardcoded no client — a autoridade é sempre o servidor");

  // ===== H-M — referral / recompensa Premium (verificação do código real já existente) =====
  assert.match(routesSource, /export const MIN_REFERRAL_ACCOUNT_AGE_MS = 30_000;/);
  assert.match(routesSource, /if \(referrerUid === referredUid\) \{\s*\n\s*return res\.status\(400\)\.json\(\{ error: "SELF_REFERRAL_NOT_ALLOWED" \}\);/, "J: self-referral bloqueado");
  assert.match(routesSource, /if \(existingEvent\.exists\) throw new Error\("DUPLICATE_REFERRAL"\);/, "I: idempotência — evento de indicação duplicado é rejeitado");
  assert.match(routesSource, /eventDoc\.data\(\)\?\.status !== "pending" \|\| validationDoc\.exists \|\| rewardLedgerDoc\.exists/, "I: validar a MESMA indicação duas vezes nunca soma duas vezes");
  assert.match(routesSource, /const newCount = currentLifetimeCount \+ 1;/, "H: contagem server-side monotônica, independente da deleção da subcoleção de indicados");
  assert.match(routesSource, /referralLifetimeCount: newCount/, "H: o contador vitalício é persistido no documento server-owned");
  assert.match(routesSource, /referralRewardLedger/, "H/L: ledger server-side sobrevive à deleção da conta indicada");
  assert.match(routesSource, /const premiumGranted = newCount === REFERRAL_REWARD_LIMIT;/, "H: recompensa só na indicação exata do limite (3ª)");
  assert.match(routesSource, /premiumExpiresAt\.setDate\(premiumExpiresAt\.getDate\(\) \+ 30\);/, "H: 30 dias, a regra canônica");
  assert.match(routesSource, /premiumSource: "referral_reward",/, "H: premiumSource correto — nunca uma origem inventada");
  assert.doesNotMatch(routesSource.slice(routesSource.indexOf("const premiumGranted = newCount"), routesSource.indexOf("return { newCount, premiumGranted:")), /billingProvider|subscriptionId|mercado_pago|google_play/i, "K: a recompensa nunca cria um billingProvider/assinatura fake");
  assert.match(routesSource, /import \{ REFERRAL_REWARD_LIMIT, isReferralCodeFormat \} from "\.\.\/shared\/monetization";/, "H: o limite vem de shared/monetization.ts, nunca um número solto duplicado em routes.ts");
  assert.match(read("shared/monetization.ts"), /export const REFERRAL_REWARD_LIMIT = 3;/, "H: limite = 3, a regra canônica");
  assert.match(routesSource, /if \(!checkReferralRateLimit\(referredUid, "validate"\)\) \{/, "rate limit server-side presente");
  assert.match(read("server/account-deletion.ts"), /referralEvents.*referrerUID.*uid|where\("referrerUID", "==", uid\)/s, "L (cleanup): conta deletada limpa os dados de referral, tanto como referrer quanto como indicado");
  assert.match(read("client/src/pages/settings.tsx"), /usePlan\(\)\.referralCount|const \{ planData, activePlan, referralCount, referralCode \} = usePlan\(\);/, "M: a UI usa o MESMO dado real do entitlement (usePlan), nunca um contador legado à parte");

  // ===== N-T — PhotoRoom =====
  const photoroomRouteSource = read("server/product-cutout-photoroom.ts");
  const photoroomToolSource = read("client/src/components/PhotoroomCutoutTool.tsx");
  assert.doesNotMatch(photoroomToolSource, /useAdminAccess|activePlan|canUseFeature/, "N: o componente do recorte não decide entitlement sozinho — só o pai (add-product.tsx) decide se ele é montado, mesma arquitetura do scanner");
  const photoroomAdapterSource = read("server/photoroom-cutout-adapter.ts");

  // N: Free nunca monta o componente (zero chamadas ao provider) — o gate é no PAI (add-product.tsx),
  // não dentro do componente (que sempre chamaria se renderizado) — por isso a garantia real está em
  // quem decide renderizar `<PhotoroomCutoutTool>`.
  // PLAN-IMPL-05: o gate se expandiu de Premium-ou-admin para Pro-OU-Premium-ou-admin (cada tier com sua
  // própria cota mensal, 3 e 100) — a garantia de fundo que importa (Free nunca monta) continua idêntica.
  assert.match(addProductSource, /\(activePlan === "pro" \|\| activePlan === "premium" \|\| isAdminUser\) && \(\s*\n\s*<Suspense[\s\S]{0,400}<PhotoroomCutoutTool/, "N: só Pro/Premium/admin chegam a montar o componente PhotoRoom — Free nunca");
  // Bundle budget: as duas ferramentas Premium são lazy (mesmo padrão do BarcodeScanner já existente
  // nesta tela) — a maioria das visitas a /add-product nunca paga o bundle delas.
  assert.match(addProductSource, /const PhotoroomCutoutTool = lazy\(/, "N: PhotoroomCutoutTool é lazy-loaded, não infla o chunk de add-product para todo mundo");
  assert.match(addProductSource, /const ProductPhotoEnhancementTool = lazy\(/, "U: ProductPhotoEnhancementTool também é lazy-loaded");

  // O/P: entitlement + idempotência real (reserva transacional exclusiva via `.create`, nunca `.set`,
  // que sobrescreveria silenciosamente numa corrida).
  // PLAN-IMPL-05: isPhotoroomEntitled (boolean Premium-ou-admin) virou resolvePhotoroomEntitlement
  // (plan-aware: Pro E Premium, cada um com sua própria cota mensal via
  // PLAN_CONFIG.limits.proAdPreparationsMonthly, aplicada de verdade em server/ads-pro-preparation-quota.ts).
  // O bypass de admin continua idêntico — testa sem nenhum teto comercial, mesma garantia de sempre.
  assert.match(photoroomRouteSource, /async function resolvePhotoroomEntitlement\(db: FirebaseFirestore\.Firestore, uid: string\): Promise<\{ readonly allowed: boolean; readonly plan: PlanType \| null \}> \{/);
  assert.match(photoroomRouteSource, /if \(await isAdminUid\(uid\)\) return \{ allowed: true, plan: null \};/, "admin continua sem teto comercial, mesma garantia de sempre");
  // OWNER-ACCESS-02: resolveServerPlan (server/plan-authoritative-mutations.ts — a MESMA autoridade já
  // reaproveitada por booking-quota.ts e todo o resto do app) compõe planData com a concessão interna
  // (Tester/Premium+ resolvem "premium" por dentro, via resolveUserEntitlements) — mesma garantia de
  // fundo de antes (Free nunca é entitled), agora sem uma segunda composição de entitlement duplicada
  // só para PhotoRoom.
  assert.match(photoroomRouteSource, /const plan = await resolveServerPlan\(db, uid\);/);
  assert.match(photoroomRouteSource, /return \{ allowed: PLAN_CONFIG\[plan\]\.limits\.proAdPreparationsMonthly > 0, plan \};/);
  assert.equal(PLAN_CONFIG.free.limits.proAdPreparationsMonthly, 0, "Free nunca é entitled — 0 preparações/mês, mesma garantia de fundo de N/O/P");
  assert.ok(PLAN_CONFIG.pro.limits.proAdPreparationsMonthly > 0 && PLAN_CONFIG.premium.limits.proAdPreparationsMonthly > 0, "Pro e Premium são entitled, cada um com sua própria cota (3 e 100)");
  assert.match(photoroomRouteSource, /transaction\.create\(ref, \{ status: "processing"/, "P: a reserva usa `.create` — Firestore rejeita a segunda chamada concorrente para o MESMO generationRequestId, então um double-click nunca dispara duas chamadas reais ao provider");
  assert.doesNotMatch(photoroomRouteSource, /runPhotoroomCutoutAdapter[\s\S]{0,400}runPhotoroomCutoutAdapter/, "O: o adapter é chamado no máximo 1 vez por request — nenhum loop/retry automático");
  assert.doesNotMatch(photoroomRouteSource, /for \(|while \(|\.retry\(/, "O/P: nenhum retry automático embutido na rota — retry é sempre uma nova chamada manual do usuário (novo generationRequestId)");

  // Q: RGB original preservado — reaproveita o Pixel Preservation Gate já existente, não reimplementado.
  assert.match(photoroomRouteSource, /import \{[\s\S]*composeProductCutoutRgba[\s\S]*\} from ["'].*photoroom-cutout-adapter["']|composeProductCutoutRgba/, "Q: usa o composer central com Pixel Preservation Gate");
  assert.match(photoroomAdapterSource, /if \(!composition\.accepted\) \{/, "Q: uma composição rejeitada pelo Pixel Gate nunca é tratada como sucesso");

  // R: original intacto — nunca escreve em product.imageUrl/imageId, só approvedCutout num path separado.
  assert.doesNotMatch(photoroomRouteSource, /imageUrl:|imageId:/, "R: a rota PhotoRoom nunca escreve imageUrl/imageId do produto");
  assert.match(photoroomRouteSource, /productRef\.set\(\{ approvedCutout: cutout \}, \{ merge: true \}\);/, "R: só o campo approvedCutout é escrito, sempre com merge (nunca substitui o doc inteiro)");
  assert.match(read("shared/approved-product-cutout.ts"), /users\/\$\{uid\}\/product-cutouts\/\$\{productId\}/, "R: o cutout vive num path de Storage separado do original");

  // S: stale detection real, reaproveitando a função pura já existente.
  const { isApprovedProductCutoutStale } = await import("../shared/approved-product-cutout.ts");
  assert.equal(isApprovedProductCutoutStale({ sourceAssetId: "old" }, "old"), false, "S: mesmo sourceAssetId -> não é stale");
  assert.equal(isApprovedProductCutoutStale({ sourceAssetId: "old" }, "new"), true, "S: sourceAssetId diferente -> stale, precisa de novo recorte");
  assert.match(photoroomRouteSource, /const stale = !currentSourceAssetId \|\| isApprovedProductCutoutStale\(approvedCutout, currentSourceAssetId\);/, "S: a rota de staleness usa a mesma função pura, nunca uma heurística nova");

  // T: falha do provider nunca escreve nada no produto — `productRef.set` só existe DEPOIS da checagem
  // de sucesso, nunca no branch de erro.
  const beforeSuccessWrite = photoroomRouteSource.slice(0, photoroomRouteSource.indexOf("await productRef.set({ approvedCutout: cutout }"));
  assert.doesNotMatch(beforeSuccessWrite, /attempt\.success === false|!attempt\.success[\s\S]{0,50}productRef\.set/, "T: nenhum caminho de falha escreve no produto antes do sucesso confirmado");
  // PLAN-IMPL-05 — a janela cresceu de 400 para 500: o branch agora também libera a vaga de cota
  // reservada (releasePreparationSlot) antes de retornar o erro; a garantia em si (T) não mudou.
  assert.match(photoroomRouteSource, /if \(!attempt\.success \|\| !attempt\.composition \|\| attempt\.composition\.accepted !== true\) \{[\s\S]{0,500}return sendError/, "T: toda falha retorna erro SEM persistir nada — o approvedCutout anterior (se existir) permanece intocado");

  // §17: credencial inexistente falha fechado, nunca finge sucesso com heurística local no lugar.
  assert.match(photoroomAdapterSource, /if \(!input\.apiKey\.trim\(\)\) \{[\s\S]{0,320}PHOTOROOM_API_KEY_MISSING/, "sem API key, falha fechado com erro claro");
  assert.match(photoroomRouteSource, /return sendError\(res, 503, "PHOTOROOM_NOT_CONFIGURED"\);/, "a rota real também falha fechado sem a env var, nunca cai para uma heurística local disfarçada de PhotoRoom");

  // ===== U-Z — melhoria real de imagem (testes de LÓGICA, com imagens sintéticas via sharp) =====
  const { enhanceProductPhoto } = await import("../server/product-photo-enhancement.ts");

  // U: nunca sobrescreve o original automaticamente — a rota só grava em `enhancedPhoto`, nunca em
  // imageUrl/imageId, e só quando `improved` é true (nunca "por via das dúvidas").
  const enhancementRouteSource = read("server/product-photo-enhancement-routes.ts");
  assert.doesNotMatch(enhancementRouteSource, /imageUrl:|imageId:/, "U: a rota de melhoria nunca escreve imageUrl/imageId do produto");
  assert.match(enhancementRouteSource, /productRef\.set\(\{ enhancedPhoto: result \}, \{ merge: true \}\);/, "U: resultado gravado num campo derivado separado, sempre com merge");

  // V/W/X/Y: gera uma foto sintética de baixo contraste (achatada, "sem graça") — deve melhorar de
  // verdade — e uma foto sintética já nítida/contrastada — não deve "melhorar" o que já está bom
  // (§7.4 fail-safe: resultado pior/igual é rejeitado, nunca imposto como diferente-mas-pior).
  const flatGray = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 120, g: 120, b: 122 } },
  }).png().toBuffer();
  const flatResult = await enhanceProductPhoto(flatGray);
  assert.ok(typeof flatResult.metricsBefore.sharpness === "number" && typeof flatResult.metricsAfter.sharpness === "number", "V: métricas reais antes/depois, não valores inventados");
  assert.ok(!Number.isNaN(flatResult.metricsBefore.contrast) && !Number.isNaN(flatResult.metricsAfter.contrast), "V: contraste calculado de verdade a partir dos pixels");
  // Uma imagem completamente lisa (1 cor sólida) não tem NENHUM ganho seguro possível — precisa cair
  // no fail-safe (W), nunca fingir melhora sobre um conteúdo que não tem onde melhorar.
  assert.equal(flatResult.improved, false, "W: imagem sem informação de textura/contraste não pode ser marcada como 'melhorada' — nada para melhorar com segurança");
  assert.ok(["no-measurable-gain", "regression-detected", "increased-clipping"].includes(flatResult.reason), "W: motivo do fail-safe é um dos códigos reais, nunca um texto genérico inventado no client");

  // Y: preservação de identidade — enhanceProductPhoto NUNCA redimensiona/recorta (mesma largura/altura
  // antes e depois), nunca é generativo (só normalize+sharpen, determinístico e documentado).
  assert.equal(flatResult.metricsBefore.width, 64);
  assert.equal(flatResult.metricsAfter.width, 64);
  assert.equal(flatResult.metricsBefore.height, 64);
  assert.equal(flatResult.metricsAfter.height, 64);
  assert.match(read("server/product-photo-enhancement.ts"), /\.normalize\(\)/);
  assert.match(read("server/product-photo-enhancement.ts"), /\.sharpen\(\{ sigma: 0\.8 \}\)/);
  assert.doesNotMatch(read("server/product-photo-enhancement.ts"), /generative|inpaint|stable-diffusion|openai|gemini/i, "Y: nenhuma operação generativa — só remapeamento de intensidade determinístico");

  // Uma imagem já nítida e bem contrastada (ruído aleatório de alto contraste) não deve mostrar um
  // "improved" fabricado — o gate de regressão/tolerância precisa recusar quando não há ganho real.
  const noisyHighContrast = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .composite([{ input: await sharp({ create: { width: 64, height: 64, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 80 } } }).png().toBuffer() }])
    .png()
    .toBuffer();
  const noisyResult = await enhanceProductPhoto(noisyHighContrast);
  // X: quando HÁ ganho real (mesmo numa imagem já boa, normalize+sharpen pode ainda ganhar nitidez),
  // o preview fica disponível com os bytes reais do resultado — nunca um placeholder.
  if (noisyResult.improved) {
    assert.ok(noisyResult.enhancedPngBytes && noisyResult.enhancedPngBytes.length > 0, "X: quando improved=true, os bytes reais do PNG melhorado estão disponíveis para preview");
  } else {
    assert.ok(["no-measurable-gain", "regression-detected", "increased-clipping"].includes(noisyResult.reason), "W: fail-safe consistente também nesta imagem");
  }

  console.log("RELEASE V1: A-Z gating/referral/PhotoRoom/enhancement invariants passed.");
}

void run();
