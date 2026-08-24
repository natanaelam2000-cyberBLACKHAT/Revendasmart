/**
 * CATALOGO-CHECKOUT-01 — cobertura do fechamento de pedido com pagamento no catálogo público (barra
 * redundante removida, Pix manual com QR local, Cartão condicionado a Mercado Pago conectado, WhatsApp
 * preservado como fallback, e o novo endpoint de criação/atualização de pedido no servidor).
 *
 * Testes puros aqui (payload EMV, tipos/labels de pagamento). O que depende de Firestore real
 * (idempotência do endpoint, transições de status) é coberto por asserção de código-fonte, no mesmo
 * padrão já usado pelos demais `script/release-quality-0X-tests.ts` — sem levantar emulador à toa.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildPixEmvPayload, crc16Ccitt } from "../client/src/lib/pix-emv";
import {
  ORDER_PAYMENT_METHOD_IDS,
  ORDER_PAYMENT_PROVIDER_IDS,
  ORDER_PAYMENT_STATUS_IDS,
  resolveOrderPaymentMethod,
  resolveOrderPaymentStatus,
} from "../client/src/lib/orders";
import {
  computeOrderVisualSummaryLayout,
  ORDER_VISUAL_SUMMARY_FOOTER_HEIGHT,
  ORDER_VISUAL_SUMMARY_HEADER_HEIGHT,
  ORDER_VISUAL_SUMMARY_ROW_HEIGHT,
} from "../client/src/lib/order-visual-summary";
import { buildExternalReference, parseExternalReference } from "../shared/charges";

function read(path: string): string {
  return fs.readFileSync(path, "utf8");
}

function run(): void {
  // ===== Pix EMV payload =====

  // Vetor de referência público do CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, sem reflexão/xorout)
  // — os MESMOS parâmetros exigidos pelo padrão EMV/Pix. Confirma a implementação sem depender de um
  // payload Pix de terceiros que eu não teria como verificar de forma independente.
  assert.equal(crc16Ccitt("123456789"), "29B1", "CRC-16/CCITT-FALSE precisa bater com o vetor de referência público");

  const payload = buildPixEmvPayload({
    pixKey: "11999999999",
    merchantName: "Loja da Ana",
    merchantCity: "São Paulo",
    amount: 129.9,
    txId: "pedido123",
  });

  // Estrutura TLV básica: indicador de formato, GUI do Pix, moeda BRL, país BR.
  assert.match(payload, /^000201/, "payload precisa começar com o Payload Format Indicator (ID 00, valor 01)");
  assert.match(payload, /26\d{2}00\d{2}br\.gov\.bcb\.pix/, "Merchant Account Information precisa conter o GUI do Pix");
  assert.match(payload, /br\.gov\.bcb\.pix01\d{2}11999999999/, "chave Pix precisa estar no payload logo após o GUI, com o tamanho declarado (2 dígitos) antes do valor");
  assert.match(payload, /5303986/, "moeda precisa ser BRL (986)");
  assert.match(payload, /5802BR/, "país precisa ser BR");
  assert.match(payload, /5406129\.90/, "valor precisa ter 2 casas decimais");
  // Nome/cidade viram ASCII maiúsculo sem acento — exigência do padrão, não um bug de encoding.
  assert.match(payload, /59\d{2}LOJA DA ANA/, "nome do recebedor precisa estar em ASCII maiúsculo, sem acento");
  assert.match(payload, /60\d{2}SAO PAULO/, "cidade precisa estar em ASCII maiúsculo, sem acento");
  assert.match(payload, /6304[0-9A-F]{4}$/, "payload precisa terminar com o CRC de 4 dígitos hexadecimais maiúsculos");

  // O CRC no fim precisa ser exatamente o mesmo que recalcular sobre o restante do payload — round-trip
  // de auto-consistência (não valida contra terceiros, mas garante que o payload não foi montado com
  // um CRC "solto" que não corresponde ao conteúdo real).
  const withoutCrc = payload.slice(0, -4);
  assert.equal(payload.slice(-4), crc16Ccitt(withoutCrc), "CRC no fim do payload precisa corresponder ao conteúdo antes dele");

  // Sem valor: Pix "aberto" (o pagador digita o valor) — campo 54 precisa ficar ausente, não zerado.
  const openPayload = buildPixEmvPayload({ pixKey: "chave@exemplo.com", merchantName: "Loja", merchantCity: "Cidade" });
  assert.doesNotMatch(openPayload, /54\d{2}/, "sem amount, o payload não deve incluir o campo de valor fixo");

  // Nunca lança por cadastro incompleto — fallback seguro em vez de travar o fechamento do pedido.
  const fallbackPayload = buildPixEmvPayload({ pixKey: "x", merchantName: "", merchantCity: "" });
  assert.match(fallbackPayload, /59\d{2}LOJA/, "nome vazio cai num fallback, nunca quebra o payload");
  assert.match(fallbackPayload, /60\d{2}BRASIL/, "cidade vazia cai num fallback, nunca quebra o payload");

  // ===== Modelo de pagamento do pedido =====

  assert.deepEqual([...ORDER_PAYMENT_METHOD_IDS], ["pix", "card", "whatsapp"]);
  assert.deepEqual([...ORDER_PAYMENT_PROVIDER_IDS], ["manual_pix", "mercadopago", "manual_whatsapp"]);
  assert.equal(resolveOrderPaymentMethod("pix"), "pix");
  assert.equal(resolveOrderPaymentMethod("boleto"), undefined, "método desconhecido não pode virar um valor inventado");
  assert.equal(resolveOrderPaymentStatus("paid"), "paid");
  assert.equal(resolveOrderPaymentStatus("confirmed_by_ai"), undefined, "status desconhecido não pode virar um valor inventado");
  // "paid" só é alcançável por confirmação do lojista (server) ou webhook real — nunca pelo cliente
  // diretamente (ver mark-paid-by-customer, que só permite customer_reported_paid).
  assert.ok(ORDER_PAYMENT_STATUS_IDS.includes("customer_reported_paid"));
  assert.ok(ORDER_PAYMENT_STATUS_IDS.includes("paid"));

  // ===== Servidor: preço/estoque nunca vêm do cliente; idempotência; nunca marca "paid" no auto-relato =====

  const routesSource = read("server/routes.ts");
  const createOrderRouteStart = routesSource.indexOf('app.post("/api/public/catalog/:storeSlug/orders"');
  const createOrderRouteEnd = routesSource.indexOf('app.patch("/api/public/catalog/:storeSlug/orders/:orderId/mark-paid-by-customer"');
  assert.ok(createOrderRouteStart >= 0 && createOrderRouteEnd > createOrderRouteStart, "rota de criação de pedido público precisa existir");
  const createOrderRoute = routesSource.slice(createOrderRouteStart, createOrderRouteEnd);

  assert.match(createOrderRoute, /resolveEffectiveProductPrice\(product\)\.effectivePrice/, "preço precisa ser recalculado a partir do catálogo real, nunca aceito do corpo da requisição");
  assert.doesNotMatch(createOrderRoute, /unitPrice:\s*(requested|item|body)\./, "preço nunca pode vir direto do payload do cliente");
  // RELEASE-CHECKOUT-02 §1: idempotência trocou de query→write (com janela de corrida) para uma reserva
  // atômica via Firestore transaction — `reserveOrderCreation` é testado contra o emulador real em
  // script/firebase-emulator-tests.ts (duas tentativas concorrentes com o mesmo clientOrderId).
  assert.doesNotMatch(createOrderRoute, /ordersRef\.where\("clientOrderId"/, "idempotência não pode mais usar query→write — janela de corrida corrigida pela reserva atômica");
  assert.match(createOrderRoute, /await reserveOrderCreation\(db, uid, clientOrderId\)/, "criação precisa passar pela reserva atômica antes de gravar qualquer coisa");
  assert.match(createOrderRoute, /PUBLIC_ORDER_CLIENT_ORDER_ID_PATTERN\.test\(clientOrderId\)/, "clientOrderId vira ID de documento — precisa ser validado contra um charset seguro antes");
  assert.match(createOrderRoute, /reused: true/, "reenvio do mesmo clientOrderId precisa devolver o pedido já existente, não criar um segundo");
  assert.match(createOrderRoute, /ORDER_CREATE_IN_PROGRESS/, "concorrência real (duas tentativas ao mesmo tempo) precisa ser tratada explicitamente, não silenciosamente ignorada");
  assert.match(createOrderRoute, /releaseReservation\(\)/, "falha após reservar precisa liberar a reserva — senão um retry legítimo fica bloqueado para sempre");
  assert.match(createOrderRoute, /orderRef\.create\(order\)/, "escrita final do pedido usa create() (falha se já existir) como defesa extra, nunca set() silencioso");

  const markPaidRouteStart = createOrderRouteEnd;
  const markPaidRouteEnd = routesSource.indexOf('app.post("/api/orders/:orderId/confirm-payment"');
  assert.ok(markPaidRouteEnd > markPaidRouteStart, "rota de auto-relato de pagamento precisa existir");
  const markPaidRoute = routesSource.slice(markPaidRouteStart, markPaidRouteEnd);
  assert.doesNotMatch(markPaidRoute, /paymentStatus:\s*"paid"/, "auto-relato do cliente NUNCA pode marcar o pedido como \"paid\" — só customer_reported_paid");
  assert.match(markPaidRoute, /paymentStatus: "customer_reported_paid"/, "auto-relato só pode marcar customer_reported_paid");
  assert.match(markPaidRoute, /order\.clientOrderId !== clientOrderId/, "só quem tem o clientOrderId do pedido pode reportar pagamento dele");

  const confirmPaymentRouteStart = markPaidRouteEnd;
  const confirmPaymentRoute = routesSource.slice(confirmPaymentRouteStart, confirmPaymentRouteStart + 2000);
  assert.match(confirmPaymentRoute, /requireAuth/, "confirmação real de pagamento exige o lojista autenticado");
  assert.match(confirmPaymentRoute, /paymentStatus: "paid"/, "só a rota autenticada do lojista pode marcar \"paid\"");

  // ===== Client: fallback do WhatsApp nunca é removido; Pix não depende do pedido existir no servidor =====

  const publicCatalogPage = read("client/src/pages/public-catalog.tsx");
  assert.match(publicCatalogPage, /data-testid="button-send-order-whatsapp"/, "botão de WhatsApp precisa continuar existindo — nunca substituído pela seleção de pagamento");
  assert.match(publicCatalogPage, /const order = await tryCreateOrder\("whatsapp"\)/, "escolher WhatsApp tenta registrar o pedido, mas de forma best-effort");
  assert.match(publicCatalogPage, /setActiveOrder\(result\.ok \? result\.order \?\? null : null\);[\s\S]{0,40}setCheckoutStep\("pix"\)/, "tela de Pix abre mesmo se a criação do pedido falhar (order pode ser null)");
  // A chave/QR do Pix vêm de um estado local (`pixKey`) buscado sob demanda quando a tela de Pix abre
  // (LGPD §7 — GET /api/public/catalog/:storeSlug/pix-key, não mais em `store.pixKey`) — mesmo que a
  // criação do pedido falhe, `setCheckoutStep("pix")` roda incondicionalmente logo depois, então a
  // tela de pagamento nunca fica bloqueada por uma falha de rede na criação do pedido.
  const handleChoosePixBody = publicCatalogPage.slice(publicCatalogPage.indexOf("const handleChoosePix"), publicCatalogPage.indexOf("const handleChooseCard"));
  assert.match(handleChoosePixBody, /catch \(error\) \{[\s\S]*setCheckoutStep\("pix"\);/, "erro ao criar o pedido de Pix ainda precisa abrir a tela de Pix (QR é local)");

  // Barra "Ver pedido" redundante removida do catálogo público — o badge do cabeçalho já cobre a função.
  const catalogShowcase = read("client/src/components/catalog/CatalogShowcase.tsx");
  assert.doesNotMatch(catalogShowcase, /Ver pedido/, "barra flutuante redundante precisa ter sido removida");
  const catalogHeader = read("client/src/components/catalog/CatalogHeader.tsx");
  assert.match(catalogHeader, /data-testid="button-open-cart"/, "o testid do botão de abrir carrinho precisa ter migrado para o botão único do cabeçalho");

  // Cartão (RELEASE-CHECKOUT-03 §1/§3) pede a cobrança ao servidor e só redireciona — a preferência
  // Mercado Pago em si é sempre criada no servidor (createOrderMercadoPagoCharge em payments.ts).
  assert.doesNotMatch(publicCatalogPage, /MercadoPagoConfig|new Preference\(/, "catálogo público não pode criar preferência de pagamento diretamente no cliente");
  assert.match(publicCatalogPage, /const payment = await createPublicCatalogOrderMercadoPagoPayment\(storeSlug, order\.id\);/, "cartão precisa pedir a cobrança ao servidor pelo orderId real, não montar nada localmente");
  assert.match(publicCatalogPage, /window\.location\.href = payment\.paymentUrl;/, "cartão real redireciona para a página hospedada do Mercado Pago");
  assert.doesNotMatch(publicCatalogPage, /paymentStatus:\s*["']paid["']/, "o browser NUNCA pode marcar um pedido como pago diretamente (§4)");

  // ===== RELEASE-CHECKOUT-02 §2 — resumo visual do pedido no WhatsApp =====

  // A/B/C/D (WHATSAPP-ORDER-VISUAL-01 §13): layout escala linearmente com a contagem de itens — 1, 2,
  // 5 e 10 (matriz de teste do ticket, altura dinâmica em vez de fonte encolhendo — §4). Puro, sem
  // canvas: o desenho real (que depende de `document`/`Image`, indisponível em Node/tsx) é coberto por
  // asserção de código-fonte abaixo, mesmo padrão já usado para outro código de canvas neste repo (ver
  // "canvas/Image real execution requires a browser" em pro-ad-generation-ui-foundation-tests.ts).
  for (const itemCount of [1, 2, 5, 10]) {
    const layout = computeOrderVisualSummaryLayout(itemCount);
    assert.equal(
      layout.height,
      ORDER_VISUAL_SUMMARY_HEADER_HEIGHT + itemCount * ORDER_VISUAL_SUMMARY_ROW_HEIGHT + ORDER_VISUAL_SUMMARY_FOOTER_HEIGHT,
      `C: layout de ${itemCount} ${itemCount === 1 ? "item" : "itens"} precisa reservar espaço para todas as linhas`,
    );
  }
  assert.equal(computeOrderVisualSummaryLayout(0).height, ORDER_VISUAL_SUMMARY_HEADER_HEIGHT + ORDER_VISUAL_SUMMARY_FOOTER_HEIGHT, "carrinho vazio não quebra o cálculo de layout");
  assert.equal(computeOrderVisualSummaryLayout(-3).height, ORDER_VISUAL_SUMMARY_HEADER_HEIGHT + ORDER_VISUAL_SUMMARY_FOOTER_HEIGHT, "contagem negativa (não deveria acontecer) nunca produz altura negativa");

  const orderVisualSummarySource = read("client/src/lib/order-visual-summary.ts");
  // D: produto sem imagem / imagem quebrada — onerror resolve para null (nunca rejeita a Promise), e o
  // desenho trata null como placeholder "Sem imagem" em vez de derrubar o resumo inteiro.
  assert.match(orderVisualSummarySource, /img\.onerror = \(\) => resolve\(null\)/, "D: imagem quebrada precisa resolver para null, nunca rejeitar/lançar");
  assert.match(orderVisualSummarySource, /"Sem imagem"/, "D: item sem imagem (ou com imagem quebrada) precisa de um placeholder visível, não um buraco em branco");
  assert.match(orderVisualSummarySource, /Promise\.all\(\s*\n?\s*input\.items\.map/, "D: uma imagem lenta/quebrada não pode bloquear as outras — carregamento é em paralelo");
  // K: original preservado — só `drawImage` em modo contain (nunca recorte/distorção/reencode da
  // imagem original armazenada; o resumo é uma composição NOVA, não uma edição da foto do produto).
  assert.match(orderVisualSummarySource, /function fitContain/, "K: imagem do produto precisa ser desenhada em contain — nunca esticada/cortada");
  // G: nome longo trunca por LARGURA REAL medida (não por contagem de caracteres), com reticências —
  // nunca vaza da coluna nem corta ambíguo sem indicar que foi cortado.
  assert.match(orderVisualSummarySource, /function truncateToWidth/, "G: nome longo precisa de truncamento por largura medida");
  assert.match(orderVisualSummarySource, /truncateToWidth\(ctx, item\.name, textMaxWidth\)/, "G: nome do item precisa passar pelo truncamento antes de desenhar");
  assert.match(orderVisualSummarySource, /"…"/, "G: truncamento precisa indicar visualmente que o nome foi cortado");
  // P/Q: nenhuma chamada externa, nenhum provider de IA — só canvas local e a própria imagem do produto.
  assert.doesNotMatch(orderVisualSummarySource, /fetch\(|XMLHttpRequest|apiRequest|openai|anthropic|gemini/i, "P/Q: geração do resumo visual não pode fazer nenhuma chamada externa/IA — só desenha localmente");
  assert.doesNotMatch(orderVisualSummarySource, /clip\(|globalCompositeOperation/, "K: sem operações de recorte/composição avançada que poderiam alterar a foto original");

  // E: texto estruturado sempre presente — o resumo visual nunca substitui a mensagem de texto, os
  // dois são compartilhados juntos (texto vai como `text` do share; wa.me continua com o texto puro
  // no fallback).
  assert.match(publicCatalogPage, /const message = buildOrderMessage\(ORDER_PAYMENT_METHOD_LABELS\.whatsapp, order\?\.id\);/, "E: mensagem de texto estruturada precisa ser montada antes de qualquer tentativa de compartilhamento");
  assert.match(publicCatalogPage, /const visualHandled = await tryShareVisualOrder\(message, order\);/, "E: resumo visual recebe o MESMO texto e o pedido já criado (para usar valores persistidos, §6)");
  assert.match(publicCatalogPage, /if \(visualHandled\) \{ closeCart\(\); return; \}/, "E: só pula o wa.me quando um share sheet REAL tratou o envio");
  // §6 (WHATSAPP-ORDER-VISUAL-01): valores do resumo visual vêm do PEDIDO persistido quando ele existe
  // — nunca recalculados a partir do carrinho quando há uma fonte autoritativa disponível.
  const tryShareVisualOrderBody = publicCatalogPage.slice(publicCatalogPage.indexOf("const tryShareVisualOrder = async"), publicCatalogPage.indexOf("const handleChooseWhatsApp"));
  assert.match(tryShareVisualOrderBody, /order\s*\?\s*order\.items\.map/, "§6: com pedido criado, os itens do resumo vêm de order.items (server-side), não do carrinho");
  assert.match(tryShareVisualOrderBody, /item\.unitPrice \* item\.quantity/, "§6: subtotal usa o unitPrice já persistido no pedido");
  assert.match(tryShareVisualOrderBody, /order \? order\.total : cartTotal/, "§6: total do resumo vem de order.total quando o pedido existe");
  assert.match(publicCatalogPage, /const sent = openWhatsAppWithOrder\(revalidation\.whatsappNumber, ORDER_PAYMENT_METHOD_LABELS\.whatsapp, order\?\.id\);/, "E/F: fallback de texto puro via wa.me precisa continuar existindo, incondicionalmente alcançável");

  // Reaproveita o MESMO mecanismo de compartilhamento de Anúncios (Capacitor Share / Web Share API /
  // download+texto) — nenhum pipeline de compartilhamento paralelo foi criado para o catálogo.
  assert.match(publicCatalogPage, /import \{ isMarketingShareCancelledError, shareMarketingCard \} from "@\/lib\/marketing-share";/, "resumo visual precisa reusar shareMarketingCard, não inventar um segundo mecanismo de share");
  assert.doesNotMatch(publicCatalogPage, /@capacitor\/share|navigator\.share\(/, "chamada direta ao Capacitor Share / Web Share API não pode existir fora de marketing-share.ts — só via shareMarketingCard");

  // ===== RELEASE-CHECKOUT-03 §11 — checkout Mercado Pago self-service =====

  // K: buildExternalReference/parseExternalReference — a extensão para pedidos NUNCA pode mudar o
  // comportamento do formato já usado em produção pelo fluxo de venda (chamada legada de 3 args,
  // string crua de saleId). Testado diretamente (função pura), não só por asserção de texto.
  const legacyRef = buildExternalReference("uid123", "charge456", "sale789");
  assert.equal(legacyRef, "uid123_charge456_sale789", "K: formato legado (saleId cru) precisa continuar idêntico");
  const legacyParsed = parseExternalReference(legacyRef);
  assert.deepEqual(legacyParsed, { uid: "uid123", chargeId: "charge456", saleId: "sale789", orderId: null }, "K: parse do formato legado continua devolvendo saleId, orderId null");
  const legacyNoSaleRef = buildExternalReference("uid123", "charge456");
  assert.equal(legacyNoSaleRef, "uid123_charge456_noSale", "K: chamada sem saleId continua gerando noSale, igual antes");
  const orderRef = buildExternalReference("uid123", "charge456", { kind: "order", id: "order789" });
  assert.equal(orderRef, "uid123_charge456_order:order789", "novo formato de pedido usa o prefixo order:");
  const orderParsed = parseExternalReference(orderRef);
  assert.deepEqual(orderParsed, { uid: "uid123", chargeId: "charge456", saleId: null, orderId: "order789" }, "parse do formato de pedido devolve orderId, saleId null");

  const paymentsSource = read("server/payments.ts");
  const chargeFnStart = paymentsSource.indexOf("export async function createOrderMercadoPagoCharge");
  const chargeFnEnd = paymentsSource.indexOf("async function syncOrderPaymentStatusFromCharge");
  assert.ok(chargeFnStart >= 0 && chargeFnEnd > chargeFnStart, "createOrderMercadoPagoCharge precisa existir");
  const chargeFnBody = paymentsSource.slice(chargeFnStart, chargeFnEnd);

  // D: total nunca vem do body — só de `params.amount`, que o caller (routes.ts) preenche com
  // `order.total` já persistido no servidor.
  assert.match(chargeFnBody, /unit_price: params\.amount/, "D: valor cobrado precisa vir de params.amount (order.total server-side), nunca do corpo da requisição pública");
  assert.doesNotMatch(chargeFnBody, /req\.body|body\.amount/, "D: função de cobrança não pode ler body da requisição — só recebe parâmetros já validados");
  // E: sellerUid nunca vem do body — só de params.uid, que o caller resolve a partir do storeSlug.
  assert.match(chargeFnBody, /getValidMPAccessToken\(params\.uid, null\)/, "E: token MP resolvido a partir de params.uid (do storeSlug), nunca de um uid enviado pelo cliente");
  // C: vínculo explícito orderId no Charge persistido.
  assert.match(chargeFnBody, /orderId: params\.orderId/, "C: Charge precisa gravar o vínculo com orderId");
  // Token nunca sai do servidor.
  assert.doesNotMatch(chargeFnBody, /res\.json\([^)]*accessToken/, "token MP nunca pode ser devolvido na resposta");

  const routesSourceV3 = read("server/routes.ts");
  const mpRouteStart = routesSourceV3.indexOf('app.post("/api/public/catalog/:storeSlug/orders/:orderId/payment/mercadopago"');
  const mpRouteEnd = routesSourceV3.indexOf('app.get("/api/public/catalog/:storeSlug/orders/:orderId/status"');
  assert.ok(mpRouteStart >= 0 && mpRouteEnd > mpRouteStart, "rota pública de pagamento Mercado Pago precisa existir");
  const mpRoute = routesSourceV3.slice(mpRouteStart, mpRouteEnd);

  // A/B: cartão só é oferecido quando MP está conectado — mesma checagem de cardAvailable já usada na
  // criação do pedido.
  assert.match(mpRoute, /if \(!catalogSettings\.store\.cardAvailable\)/, "A/B: rota de pagamento precisa recusar quando a loja não tem Mercado Pago conectado");
  // D novamente, no nível da rota: total vem do pedido já carregado do Firestore, nunca do req.body.
  assert.match(mpRoute, /amount: order\.total/, "D: rota precisa passar order.total (já persistido), nunca um valor do corpo da requisição");
  assert.doesNotMatch(mpRoute, /req\.body\.amount|body\.amount|body\.total/, "D: rota de pagamento não pode ler amount/total do corpo da requisição pública");
  // F: idempotência atômica via reserva — mesma garantia já testada ao vivo contra o emulador.
  assert.match(mpRoute, /await reserveOrderCharge\(db, uid, orderId\)/, "F: criação de cobrança precisa passar pela reserva atômica antes de chamar o Mercado Pago");
  assert.match(mpRoute, /reused: true/, "F: reenvio devolve a cobrança já existente, nunca cria uma segunda");
  // J: falha do provider libera a reserva e preserva o pedido — nunca marca pago, nunca deixa a
  // reserva travada.
  assert.match(mpRoute, /await releaseOrderChargeReservation\(db, uid, orderId\);/, "J: falha ao criar a cobrança precisa liberar a reserva");
  assert.doesNotMatch(mpRoute, /orderRef\.set|order\.paymentStatus = /, "J: rota de criação de cobrança não pode escrever no pedido — só cria a cobrança, o webhook decide paymentStatus");

  const statusRouteStart = mpRouteEnd;
  const statusRoute = routesSourceV3.slice(statusRouteStart, statusRouteStart + 1600);
  assert.doesNotMatch(statusRoute, /orderRef\.set|orderRef\.update|paymentStatus:\s*["']paid["']/, "I: rota de status é somente leitura — nunca escreve/marca paid a partir de um GET");

  // G/H: webhook propaga paid para o pedido, e só quando ainda não estava paid (idempotente).
  const syncOrderFnStart = paymentsSource.indexOf("async function syncOrderPaymentStatusFromCharge");
  const syncOrderFnEnd = paymentsSource.indexOf("// ---", syncOrderFnStart);
  const syncOrderFnBody = paymentsSource.slice(syncOrderFnStart, syncOrderFnEnd);
  assert.match(syncOrderFnBody, /if \(snap\.data\(\)\?\.paymentStatus === "paid"\) return;/, "H: propagação para o pedido precisa ser um no-op quando já está paid — webhook repetido não reescreve");
  assert.match(syncOrderFnBody, /paymentStatus: "paid"/, "G: propagação real marca o pedido como paid");
  assert.match(paymentsSource, /if \(newStatus === "paid" && charge\.orderId\) \{\s*\n\s*await syncOrderPaymentStatusFromCharge\(uid, charge\.orderId\);/, "G: sync do pedido só dispara quando a charge realmente virou paid E tem orderId vinculado");

  // K: fluxo de venda (handleCreateLink) não foi tocado — assinatura e corpo continuam usando saleId.
  assert.match(paymentsSource, /const externalReference = buildExternalReference\(body\.uid, chargeId, body\.saleId\);/, "K: create-link do vendedor continua chamando buildExternalReference exatamente como antes");
  assert.match(paymentsSource, /if \(body && body\.saleId && String\(body\.saleId\)\.trim\(\) !== ""\) \{\s*\n\s*charge\.saleId = body\.saleId;/, "K: charge.saleId do fluxo de venda continua sendo gravado normalmente");

  // §12 — reforço estático do share nativo (sem device/emulator disponível neste ambiente — validação
  // ao vivo fica PENDING, não fabricada como PASS). MIME PNG explícito, cleanup do arquivo temporário
  // e reuso do MESMO pipeline nativo (Capacitor Share/@capacitor/filesystem) já herdados de
  // shareMarketingCard — nada disso é reimplementado aqui.
  assert.match(orderVisualSummarySource, /"image\/png"/, "resumo visual precisa gerar um blob PNG explícito (MIME correto)");
  const marketingShareSource = read("client/src/lib/marketing-share.ts");
  assert.match(marketingShareSource, /scheduleTemporaryFileCleanup/, "cleanup do arquivo temporário precisa existir no pipeline nativo reaproveitado");
  assert.match(marketingShareSource, /bridge\.deleteCacheFile\(path\)/, "arquivo temporário do share nativo precisa ser removido do cache do device depois do share");

  console.log("Checkout payment tests passed: pix-emv, order payment model, server order routes, public-catalog fallback, visual WhatsApp order, Mercado Pago self-service checkout.");
}

run();
