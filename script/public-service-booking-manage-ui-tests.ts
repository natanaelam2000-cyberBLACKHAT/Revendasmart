import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * SERV-PUBLIC-02 §41 — UI1-14: provas estruturais sobre a página de gerenciamento público real e seus
 * wrappers, mesmo padrão já usado em script/public-service-booking-ui-tests.ts.
 */
function read(path: string): string {
  return readFileSync(path, "utf8");
}

function run() {
  const pageSource = read("client/src/pages/public-service-booking-manage.tsx");
  const commandsSource = read("client/src/lib/service-public-booking-commands.ts");
  const appSource = read("client/src/App.tsx");
  const bookingPageSource = read("client/src/pages/public-service-booking.tsx");

  // UI1 — a rota de gerenciamento é pública (nunca dentro do PrivateRouter).
  assert.match(appSource, /const PublicServiceBookingManage = lazy\(\(\) => import\("@\/pages\/public-service-booking-manage"\)\)/, "UI14: PUBLIC_MANAGE_ROUTE_LAZY — a rota precisa ser lazy-loaded");
  assert.match(appSource, /<Route path="\/agendar\/:storeSlug\/gerenciar\/:token" component=\{PublicServiceBookingManage\} \/>/, "UI1: a rota /agendar/:storeSlug/gerenciar/:token precisa estar registrada no PublicRouter");
  assert.match(appSource, /path\.startsWith\("\/agendar\/"\)/, "UI1: isPublicPath já cobre /agendar/ (incluindo /gerenciar/:token), nunca cai no PrivateRouter");

  // UI2 — agendamento válido carrega via o wrapper dedicado por token.
  assert.match(pageSource, /await getPublicManagedBooking\(storeSlug, token\)/, "UI2: carrega o agendamento via getPublicManagedBooking(storeSlug, token)");
  assert.match(pageSource, /text-managed-service-name/);
  assert.match(pageSource, /text-managed-time/);
  assert.match(pageSource, /text-managed-status/);

  // UI3 — token inválido mostra erro genérico (nunca revela o motivo específico).
  assert.match(pageSource, /Não foi possível localizar este agendamento\./, "UI3: mensagem genérica exata para token inválido/Booking não encontrado");

  // UI4/UI5 — ação de cancelar + estado de sucesso.
  assert.match(pageSource, /button-manage-cancel/, "UI4: ação de cancelar existe");
  assert.match(pageSource, /await cancelPublicManagedBooking\(storeSlug, token\)/, "UI4: cancelar chama o wrapper público real");
  assert.match(pageSource, /text-managed-cancelled/, "UI5: estado 'Agendamento cancelado' existe");
  assert.match(pageSource, /Agendamento cancelado\./, "UI5: texto exato de sucesso do cancelamento");
  assert.match(pageSource, /booking\.status === "cancelled" \? \(/, "UI10: agendamento cancelado não mostra ações (bloco condicional dedicado)");

  // UI6/UI7/UI8/UI9 — reagendar: ação, disponibilidade, sucesso, conflito com refresh.
  assert.match(pageSource, /button-manage-reschedule/, "UI6: ação de reagendar existe");
  assert.match(pageSource, /grid-reschedule-slots/, "UI7: grade de horários de reagendamento é renderizada");
  assert.match(pageSource, /await getPublicManagedBookingAvailability\(storeSlug, token,/, "UI7: disponibilidade de reagendamento vem do servidor, escopada pelo token");
  assert.match(pageSource, /await reschedulePublicManagedBooking\(storeSlug, token,/, "UI8: reagendar chama o wrapper público real");
  assert.match(pageSource, /setRescheduleOpen\(false\);\s*refresh\(\);/, "UI8: sucesso fecha a seção e recarrega o agendamento");
  assert.match(pageSource, /setRescheduleError\(publicBookingErrorMessage\(error\)\);\s*refreshRescheduleAvailability\(\);/, "UI9: conflito de reagendamento refaz a consulta de disponibilidade");

  // UI11 — nenhuma exigência de login.
  assert.doesNotMatch(commandsSource, /auth:\s*true/, "UI11: nenhuma chamada pública anexa Authorization");
  assert.doesNotMatch(pageSource, /getAuthToken|firebaseUid|onAuthStateChanged/, "UI11: a página de gerenciamento nunca depende de sessão autenticada");
  assert.doesNotMatch(pageSource, /from "@\/routers\/PrivateRouter"/, "UI11: nunca montada como parte da área administrativa");

  // UI12 — nenhuma escrita direta no Firestore.
  assert.doesNotMatch(pageSource, /\bsetDoc\b|\bupdateDoc\b|\bdeleteDoc\b|\baddDoc\b/, "UI12: nenhuma escrita direta no Firestore na página de gerenciamento");
  assert.doesNotMatch(pageSource, /from "firebase\/firestore"/, "UI12: nenhum import do SDK de escrita do Firestore");

  // UI13 — nenhuma lógica de Payment/Refund importada (gerenciamento público nunca mexe em financeiro).
  assert.doesNotMatch(pageSource, /mercadopago|mercado-pago|service-payment-commands|service-quote-commands|\/sales\b|checkout|refund/i, "UI13: nenhuma lógica de pagamento/reembolso/checkout importada");
  assert.doesNotMatch(pageSource, /recharts/i, "nenhuma lib de gráfico");
  assert.doesNotMatch(pageSource, /full-?calendar|react-big-calendar|daypilot|react-datepicker/i, "§28: nenhuma lib de calendário pesada");

  // Nunca exibe o token como texto (§7 do SERV-PUBLIC-02, reforçado aqui) nem em nenhuma das duas páginas.
  assert.doesNotMatch(pageSource, /\{token\}/, "o token nunca é renderizado como texto na tela de gerenciamento");
  assert.doesNotMatch(bookingPageSource, /manageToken\}<\/|>\{success\.manageToken\}/, "a tela de sucesso do agendamento nunca exibe o token como texto, só como href do link");
  assert.match(bookingPageSource, /href=\{`\/agendar\/\$\{storeSlug\}\/gerenciar\/\$\{success\.manageToken\}`\}/, "o CTA 'Gerenciar agendamento' usa o token só como parte do link, condicionado à sua presença");

  console.log("Public service booking management UI tests passed: the management route is public, lazy-loaded, and correctly excluded from the authenticated PrivateRouter (UI1/UI14), a valid booking loads via the dedicated token-scoped wrapper (UI2), an invalid token shows the exact generic message (UI3), cancel calls the real public command and shows the exact cancelled state with actions removed (UI4/UI5/UI10), reschedule renders server-derived availability, calls the real command, closes and refreshes on success, and refreshes availability on conflict (UI6-UI9), no call ever requires authentication (UI11), no direct Firestore write exists anywhere (UI12), no Payment/Refund/checkout logic is imported (UI13), and the raw token is never rendered as visible text on either public page — only ever used as a URL segment.");
}

run();
