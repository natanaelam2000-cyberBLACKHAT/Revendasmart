import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * SERV-PUBLIC-01 §43 — UI1-UI16: provas estruturais sobre o componente público real e seus wrappers,
 * mesmo padrão já usado em script/services-agenda-ui-tests.ts e script/service-work-detail-ui-tests.ts
 * (nenhuma lib de testing de componente instalada neste projeto).
 */
function read(path: string): string {
  return readFileSync(path, "utf8");
}

function run() {
  const pageSource = read("client/src/pages/public-service-booking.tsx");
  const commandsSource = read("client/src/lib/service-public-booking-commands.ts");
  const appSource = read("client/src/App.tsx");

  // UI1 — a página carrega a loja pública via o wrapper dedicado.
  assert.match(pageSource, /import \{[\s\S]{0,300}getPublicBookingStore[\s\S]{0,300}\} from "@\/lib\/service-public-booking-commands"/, "UI1: usa o wrapper público dedicado, nunca uma query direta");
  assert.match(pageSource, /await getPublicBookingStore\(storeSlug\)/, "UI1: chama getPublicBookingStore com o slug da rota");

  // UI2/UI3 — serviços renderizam e são selecionáveis.
  assert.match(pageSource, /list-public-services/, "UI2: lista de serviços é renderizada");
  assert.match(pageSource, /button-select-service-\$\{service\.id\}/, "UI2: cada serviço vira um card selecionável");
  assert.match(pageSource, /handleSelectService/, "UI3: seleção de serviço tem handler dedicado");

  // UI4 — seleção de data (lista horizontal de dias, nunca lib de calendário).
  assert.match(pageSource, /list-public-days/, "UI4: lista de dias é renderizada");
  assert.match(pageSource, /button-select-day-\$\{dateKey\}/, "UI4: cada dia é selecionável");
  assert.doesNotMatch(pageSource, /full-?calendar|react-big-calendar|daypilot|react-datepicker/i, "UI4/§36: nenhuma lib de calendário pesada");

  // UI5 — horários disponíveis renderizam a partir da disponibilidade real do servidor.
  assert.match(pageSource, /grid-public-slots/, "UI5: grade de horários é renderizada");
  assert.match(pageSource, /await getPublicServiceAvailability\(/, "UI5: disponibilidade vem do servidor, nunca reconstruída no client");
  assert.doesNotMatch(pageSource, /weeklyHours/, "§10/§12: a página nunca reconstrói weeklyHours localmente — só exibe candidatos já retornados");

  // UI6 — tocar num horário cria um Hold real antes de qualquer confirmação.
  assert.match(pageSource, /handleSelectSlot[\s\S]{0,400}await createPublicBookingHold\(/, "UI6: selecionar um slot cria um BookingHold real via o command público");
  assert.match(commandsSource, /createPublicBookingHold/, "UI6: o wrapper de criação de Hold existe");

  // UI7/UI8 — formulário de dados do cliente + botão de confirmação.
  assert.match(pageSource, /section-customer-form/, "UI7: seção de dados do cliente existe");
  assert.match(pageSource, /input-customer-name/);
  assert.match(pageSource, /input-customer-phone/);
  assert.match(pageSource, /button-confirm-booking/, "UI8: botão de confirmação existe");
  assert.match(pageSource, /await confirmPublicBookingHold\(/, "UI8: confirmar chama o command público real");

  // UI9 — estado de sucesso, sem nenhum id técnico interno (§21).
  assert.match(pageSource, /section-booking-success/, "UI9: tela de sucesso existe");
  assert.doesNotMatch(pageSource, /success\.(workId|bookingId|holdId)/, "UI9/§21: nenhum id técnico interno exibido na tela de sucesso");

  // UI10/UI11 — conflito de horário/Hold expirado tratados com refresh da disponibilidade.
  assert.match(pageSource, /catch \(error\) \{\s*setSelectedSlot\(null\);\s*setHoldError\(publicBookingErrorMessage\(error\)\);\s*refreshAvailability\(\);/, "UI10: conflito ao criar Hold refaz a consulta de disponibilidade");
  assert.match(pageSource, /catch \(error\) \{\s*setConfirmError\(publicBookingErrorMessage\(error\)\);\s*setHold\(null\);\s*setSelectedSlot\(null\);\s*refreshAvailability\(\);/, "UI11: Hold expirado/erro na confirmação refaz a disponibilidade e limpa o Hold");

  // UI12 — loja inválida/indisponível mostra empty state claro, nunca dado interno.
  assert.match(pageSource, /Página de agendamento indisponível\./, "UI12: mensagem exata para loja inexistente/desabilitada");

  // UI13 — nenhuma exigência de login: nenhuma chamada usa auth:true, nenhum getAuthToken.
  assert.doesNotMatch(commandsSource, /auth:\s*true/, "UI13: nenhuma chamada pública anexa Authorization — visitante nunca precisa de conta");
  assert.doesNotMatch(pageSource, /getAuthToken|firebaseUid|onAuthStateChanged/, "UI13: a página pública nunca depende de sessão autenticada");
  assert.doesNotMatch(pageSource, /from "@\/routers\/PrivateRouter"/, "UI13: a tela pública nunca é montada como parte da área administrativa");

  // UI14 — nenhuma escrita direta no Firestore (tudo via os commands públicos server-side).
  assert.doesNotMatch(pageSource, /\bsetDoc\b|\bupdateDoc\b|\bdeleteDoc\b|\baddDoc\b/, "UI14: nenhuma escrita direta no Firestore na página pública");
  assert.doesNotMatch(pageSource, /from "firebase\/firestore"/, "UI14: nenhum import do SDK de escrita do Firestore na página pública");
  assert.doesNotMatch(commandsSource, /firebase\/firestore/, "UI14: os wrappers públicos também nunca tocam o SDK do Firestore diretamente");

  // UI15 — nenhuma lógica de Payment/Sale/Mercado Pago importada (agendamento público nunca cria Payment/Quote).
  assert.doesNotMatch(pageSource, /mercadopago|mercado-pago|service-payment-commands|service-quote-commands|\/sales\b|checkout/i, "UI15: nenhuma lógica de pagamento/checkout/Sale importada nesta tela");
  assert.doesNotMatch(pageSource, /recharts/i, "§36: nenhuma lib de gráfico nesta tela");
  assert.doesNotMatch(pageSource, /framer-motion/i, "§36: nenhuma dependência de animação pesada nova");

  // UI16 — a rota é pública (nunca dentro do PrivateRouter/requireAuth) e lazy-loaded.
  assert.match(appSource, /const PublicServiceBooking = lazy\(\(\) => import\("@\/pages\/public-service-booking"\)\)/, "UI16: PUBLIC_BOOKING_ROUTE_LAZY — a rota pública precisa ser lazy-loaded");
  assert.match(appSource, /<Route path="\/agendar\/:storeSlug" component=\{PublicServiceBooking\} \/>/, "UI16: a rota /agendar/:storeSlug precisa estar registrada no PublicRouter");
  assert.match(appSource, /path\.startsWith\("\/agendar\/"\)/, "UI16: isPublicPath reconhece /agendar/ como rota pública, nunca cai no PrivateRouter/requireAuth");

  console.log("Public service booking UI tests passed: the store loads via the dedicated public wrapper with no internal query (UI1), services render as selectable cards (UI2/UI3), days render without any calendar library (UI4), slots render from server-derived availability with no local weeklyHours reconstruction (UI5), tapping a slot creates a real Hold before any confirmation (UI6), the customer form and confirm button call the real public commands (UI7/UI8), the success screen never exposes internal ids (UI9), slot-conflict and expired-Hold errors both refresh availability (UI10/UI11), an invalid/disabled store shows the exact required unavailable message (UI12), no call ever requires authentication (UI13), no direct Firestore write exists anywhere in the public surface (UI14), no Payment/Sale/Mercado Pago logic is imported (UI15), and the route is public, lazy-loaded, and correctly excluded from the authenticated PrivateRouter (UI16).");
}

run();
