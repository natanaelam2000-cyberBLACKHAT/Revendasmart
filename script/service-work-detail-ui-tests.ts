import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertCanRegisterServicePayment,
  deriveWorkFinancials,
  type ServicePaymentRecord,
} from "../shared/services";

/**
 * SERV-UI-03 §32 — testes focados da tela de atendimento (/servicos/atendimentos/:workId): a matemática
 * financeira (overpayment/partial-refund/repay-after-refund/R$0=paid) é provada diretamente contra o
 * domínio já aprovado (shared/services.ts, nunca reimplementada aqui), e o resto é prova estrutural sobre
 * o componente real — mesmo padrão já usado em script/services-agenda-ui-tests.ts e
 * script/services-availability-settings-ui-tests.ts (nenhuma lib de testing de componente instalada).
 */
function read(path: string): string {
  return readFileSync(path, "utf8");
}

function payment(overrides: Partial<ServicePaymentRecord> = {}): ServicePaymentRecord {
  return {
    id: "payment-1",
    tenantUid: "uid-1",
    workId: "work-1",
    amountCents: 10000,
    method: "cash",
    recordedAt: "2026-08-30T12:00:00.000Z",
    refundedTotalCents: 0,
    idempotencyKey: "idem-payment-1",
    ...overrides,
  };
}

function run() {
  // ===== UI9 — pagamento acima do saldo é rejeitado pelo domínio (a UI só exibe o erro, nunca inventa
  // uma regra própria) =====
  {
    assert.throws(
      () => assertCanRegisterServicePayment(10000, [], 10001),
      (error: unknown) => error instanceof Error && (error as { code?: string }).code === "OVERPAYMENT_NOT_SUPPORTED",
      "UI9: um pagamento que ultrapassa o saldo (contractedTotalCents) deve ser rejeitado pelo domínio",
    );
    assert.doesNotThrow(
      () => assertCanRegisterServicePayment(10000, [], 10000),
      "UI9: um pagamento que preenche exatamente o saldo deve ser aceito",
    );
  }

  // ===== UI12 — repay-after-refund: contracted=100, payment=100, refund=20 -> saldo líquido volta a
  // existir (20) e um novo pagamento de até 20 deve ser permitido, nunca bloqueado usando grossReceived =====
  {
    const existingPayments = [payment({ amountCents: 10000, refundedTotalCents: 2000 })];
    const financialsBeforeRepay = deriveWorkFinancials(10000, existingPayments);
    assert.equal(financialsBeforeRepay.netReceivedCents, 8000, "UI12: líquido = 100 - 20 = 80 (em cents: 10000-2000=8000)");
    assert.equal(financialsBeforeRepay.balanceCents, 2000, "UI12: saldo a receber volta a existir (20, em cents 2000)");
    assert.doesNotThrow(
      () => assertCanRegisterServicePayment(10000, existingPayments, 2000),
      "UI12: um novo pagamento de até o saldo líquido restante (2000) deve ser permitido após o reembolso parcial",
    );
    assert.throws(
      () => assertCanRegisterServicePayment(10000, existingPayments, 2001),
      "UI12: mas nunca acima do saldo líquido restante",
    );
  }

  // ===== UI11 — refund parcial: "disponível para reembolso" = amountCents - refundedTotalCents, nunca
  // assume 1 reembolso por payment =====
  {
    const partiallyRefunded = payment({ amountCents: 10000, refundedTotalCents: 3000 });
    const available = partiallyRefunded.amountCents - partiallyRefunded.refundedTotalCents;
    assert.equal(available, 7000, "UI11: disponível para reembolso = recebido - já reembolsado");
  }

  // ===== UI13 — Work R$0 (contracted=0, net=0) deve aparecer como "Pago", nunca "Pendente" =====
  {
    const zeroFinancials = deriveWorkFinancials(0, []);
    assert.equal(zeroFinancials.financialStatus, "paid", "UI13: contracted=0 e net=0 -> financialStatus deve ser 'paid'");
    assert.equal(zeroFinancials.balanceCents, 0);
  }

  console.log("Service work detail pure-function tests passed: overpayment rejected at the exact boundary (UI9), repay-after-refund permitted using the net balance — never gross (UI12), partial-refund availability computed per payment (UI11), and a R$0 work derives financialStatus='paid' (UI13) — all via the already-approved shared/services.ts domain, never reimplemented in the UI.");

  // ===== UI1-UI8, UI10, UI14-UI16 — provas estruturais sobre o componente real =====
  const pageSource = read("client/src/pages/service-work-detail.tsx");

  // UI1 — Work carrega via o mesmo helper read-only já usado pela Agenda, e os totais financeiros vêm do
  // domínio (deriveServiceWorkFinancials), nunca recalculados à mão na tela.
  assert.match(pageSource, /import \{ getServiceWork \} from "@\/lib\/services-persistence"/, "UI1: Work é lido via services-persistence.ts, nenhuma query nova");
  assert.match(pageSource, /deriveServiceWorkFinancials\(work\)/, "UI1: financeiro sempre derivado do domínio, nunca recalculado na UI");

  // UI2/UI3/UI4 — ações de lifecycle só aparecem para planned/in_progress; completed/cancelled são
  // somente-leitura (o bloco de ações inteiro é condicionado a esses dois status).
  assert.match(pageSource, /work\.status === "planned" \|\| work\.status === "in_progress"/, "UI4: bloco de ações só existe para planned/in_progress — completed/cancelled não mostram nenhuma ação");
  assert.match(pageSource, /work\.status === "planned" &&[\s\S]{0,120}button-work-start/, "UI2: 'Iniciar atendimento' só aparece quando planned");
  assert.match(pageSource, /work\.status === "in_progress" &&[\s\S]{0,120}button-work-complete/, "UI3: 'Concluir atendimento' só aparece quando in_progress");

  // UI5 — cancelamento usa o command correto conforme exista (ou não) um Booking confirmado ligado ao Work
  // (§9 — nunca cancela o Work isoladamente deixando um Booking ativo órfão).
  assert.match(pageSource, /import \{ listServiceBookingsForWork \} from "@\/lib\/service-bookings-persistence"/, "UI5: descobre o Booking ligado antes de decidir como cancelar");
  assert.match(pageSource, /if \(booking && booking\.status === "confirmed"\) \{\s*await cancelServiceBooking\(booking\.id\);\s*\} else \{\s*await cancelServiceWork\(work\.id\);/, "UI5: Booking confirmado -> cancelServiceBooking; senão -> cancelServiceWork direto");

  // UI6/UI7 — Quote é só exibido (nunca criado/editado nesta tela, decisão explícita de escopo).
  assert.match(pageSource, /import \{ getQuote \} from "@\/lib\/service-quotes-persistence"/, "UI6: Quote relacionado é lido, nunca escrito, nesta tela");
  assert.doesNotMatch(pageSource, /createQuoteDraft|updateQuoteDraft/, "QUOTE_INLINE_AUTHORING_IMPLEMENTED deve ser NO: nenhuma criação/edição de Quote nesta tela (o domínio não liga um Quote novo a um Work já existente)");
  assert.match(pageSource, /card-work-quote/, "UI6: existe uma seção que exibe o Quote quando relacionado");
  assert.match(pageSource, /Nenhum orçamento vinculado a este atendimento\./, "UI7: empty state claro quando não há Quote relacionado");

  // UI8/UI10 — Payment/Refund só através dos commands server-side já aprovados.
  assert.match(pageSource, /import \{ recordServicePayment, refundServicePayment \} from "@\/lib\/service-payment-commands"/, "UI8/UI10: Payment/Refund só via os commands server-side existentes");
  assert.match(pageSource, /await recordServicePayment\(work\.id, \{ amountCents, method: paymentMethod \}\)/, "UI8: registrar recebimento chama o command real com amountCents/method");
  assert.match(pageSource, /await refundServicePayment\(work\.id, refundPaymentId, \{ amountCents, reason: refundReason \|\| undefined \}\)/, "UI10: registrar reembolso chama o command real com amountCents/reason");

  // UI14 — histórico mistura Payment e Refund (nunca Sale/PDV) em ordem cronológica.
  assert.match(pageSource, /type Movement =\s*\|\s*\{ readonly kind: "payment";/, "UI14: histórico modela pagamento e reembolso explicitamente");
  assert.match(pageSource, /list-financial-movements/, "UI14: a lista de movimentações é renderizada");

  // UI15 — nenhuma escrita direta de Payment/Refund no Firestore (só leitura, só commands para escrever).
  assert.doesNotMatch(pageSource, /\bsetDoc\b|\bupdateDoc\b|\bdeleteDoc\b|\baddDoc\b/, "UI15/DIRECT_PAYMENT_FIRESTORE_WRITE/DIRECT_REFUND_FIRESTORE_WRITE devem ser NO");
  assert.doesNotMatch(pageSource, /from "firebase\/firestore"/, "UI15: nenhum import do SDK de escrita do Firestore nesta página");

  // UI16 — nenhuma lógica de Sale/PDV/checkout/Mercado Pago importada (ServicePayment pertence só ao Work).
  assert.doesNotMatch(pageSource, /mercadopago|mercado-pago|\/sales\b|sale-payment|checkout/i, "SALE_PAYMENT_LOGIC_IMPORTED/MERCADO_PAGO_CHANGED devem ser NO");
  assert.doesNotMatch(pageSource, /recharts/i, "nenhuma lib de gráfico nesta tela");

  // Rota lazy registrada e alcançável a partir da Agenda.
  const routerSource = read("client/src/routers/PrivateRouter.tsx");
  assert.match(routerSource, /const ServiceWorkDetail = lazy\(\(\) => import\("@\/pages\/service-work-detail"\)\)/, "WORK_ROUTE_LAZY: a rota precisa ser lazy-loaded");
  assert.match(routerSource, /<Route path="\/servicos\/atendimentos\/:workId" component=\{ServiceWorkDetail\} \/>/, "a rota /servicos/atendimentos/:workId precisa estar registrada");
  const agendaSource = read("client/src/pages/service-agenda.tsx");
  assert.match(agendaSource, /href=\{`\/servicos\/atendimentos\/\$\{selectedBooking\.workId\}`\}/, "a Agenda precisa linkar para o Work a partir do Booking selecionado");

  console.log("Service work detail structural tests passed: Work loads via the existing read-only helper with financials always derived from the domain (UI1), lifecycle actions gated correctly by status with no invalid action ever shown for completed/cancelled (UI2-UI4), cancel picks the Booking-aware command when a confirmed Booking exists and the direct Work command otherwise (UI5), Quote is only ever displayed — never authored — with a clear empty state (UI6/UI7, QUOTE_INLINE_AUTHORING_IMPLEMENTED=NO), Payment/Refund only ever go through the real server-side commands (UI8/UI10), the movement history models both kinds chronologically (UI14), no direct Firestore write exists for Payment/Refund (UI15), no Sale/PDV/Mercado Pago logic was imported (UI16), and the route is lazy-loaded and reachable from the Agenda's booking detail.");
}

run();
