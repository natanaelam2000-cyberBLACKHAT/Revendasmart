/**
 * RevendaSmart — Charges: Shared types for payment integration
 *
 * This file is the single source of truth for the charges data model.
 * Designed to support:
 *   - one_time  (current MVP: Mercado Pago payment links)
 *   - subscription (future: recurring billing plans)
 *
 * Firestore path: users/{uid}/charges/{chargeId}
 */

// ---------------------------------------------------------------------------
// Charge mode
// ---------------------------------------------------------------------------
export type ChargeMode = "one_time" | "subscription";

// ---------------------------------------------------------------------------
// Internal status (provider-agnostic, used in UI and business logic)
// ---------------------------------------------------------------------------
export type ChargeStatus =
  | "pending"      // Aguardando pagamento
  | "paid"         // Pagamento aprovado
  | "in_process"   // Em análise ou mediação
  | "authorized"   // Autorizado (não capturado)
  | "failed"       // Recusado / erro
  | "cancelled"    // Cancelado pelo usuário ou app
  | "refunded"     // Reembolsado
  | "expired"      // Prazo expirado
  | "paused";      // FUTURO: assinatura pausada

// ---------------------------------------------------------------------------
// Status mapping: MercadoPago raw → internal ChargeStatus
// ---------------------------------------------------------------------------
export const MP_STATUS_MAP: Record<string, ChargeStatus> = {
  pending:      "pending",
  approved:     "paid",
  authorized:   "authorized",
  in_process:   "in_process",
  in_mediation: "in_process",
  rejected:     "failed",
  cancelled:    "cancelled",
  refunded:     "refunded",
  charged_back: "refunded",
  expired:      "expired",
};

/** Resolve internal status from raw MP status string */
export function resolveChargeStatus(mpRawStatus: string): ChargeStatus {
  return MP_STATUS_MAP[mpRawStatus] ?? "pending";
}

// ---------------------------------------------------------------------------
// Payment provider
// ---------------------------------------------------------------------------
export type ChargeProvider = "mercadopago";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
export type ChargeEnvironment = "sandbox" | "production";

/** Detect environment from MP access token prefix */
export function detectEnvironment(accessToken: string): ChargeEnvironment {
  return accessToken.startsWith("TEST-") ? "sandbox" : "production";
}

// ---------------------------------------------------------------------------
// Core Charge document (Firestore: users/{uid}/charges/{chargeId})
// ---------------------------------------------------------------------------
export interface Charge {
  // ── Identity ──────────────────────────────────────────────────────────────
  id: string;                          // Firestore doc ID (= chargeId)
  uid: string;                         // Firebase Auth UID of the reseller

  // ── Provider ──────────────────────────────────────────────────────────────
  provider: ChargeProvider;            // "mercadopago"
  mode: ChargeMode;                    // "one_time" | "subscription"
  environment: ChargeEnvironment;      // "sandbox" | "production"

  // ── Status ────────────────────────────────────────────────────────────────
  status: ChargeStatus;                // Internal app status
  providerRawStatus: string;           // Raw status string from provider

  // ── Financial ─────────────────────────────────────────────────────────────
  amount: number;                      // Amount in major currency units (R$ 99.90)
  currency: string;                    // ISO 4217, default "BRL"

  // ── Relationships ─────────────────────────────────────────────────────────
  clientId: string;                    // Ref → users/{uid}/clients/{clientId}
  clientName?: string;                 // Optional snapshot for read performance/new documents
  clientPhone?: string;                // Optional snapshot for read performance/new documents
  saleId?: string;                     // Ref → users/{uid}/sales/{saleId} (optional)
  // RELEASE-CHECKOUT-03: link to a public-catalog order (checkout §5). Mutually exclusive with saleId
  // in practice (a charge pays either an internal sale or a public order, never both), but both fields
  // stay optional/independent — no shared/renamed field, so the existing saleId flow is untouched.
  orderId?: string;                    // Ref → users/{uid}/orders/{orderId} (optional)

  // ── Content ───────────────────────────────────────────────────────────────
  title: string;                       // Payment title shown to payer
  description?: string;                // Optional description

  // ── Payment link (one_time) ───────────────────────────────────────────────
  paymentUrl: string;                  // MP init_point URL
  preferenceId?: string;               // MP Preference ID

  // ── Provider IDs ──────────────────────────────────────────────────────────
  mercadoPagoPaymentId?: string;       // MP Payment ID (after completion)
  externalReference: string;           // Our stable reference sent to MP

  // ── Subscription (FUTURE) ─────────────────────────────────────────────────
  subscriptionId?: string;             // MP Subscription ID
  planId?: string;                     // Internal plan ID
  billingCycle?: "monthly" | "quarterly" | "yearly";
  billingType?: "recurring" | "one_time";
  nextChargeAt?: string;               // ISO 8601

  // ── Timestamps ────────────────────────────────────────────────────────────
  createdAt: string;                   // ISO 8601
  updatedAt: string;                   // ISO 8601
  paidAt?: string;                     // ISO 8601 — when status became "paid"
  cancelledAt?: string;
  refundedAt?: string;

  // ── Webhook tracking ──────────────────────────────────────────────────────
  webhookLastEvent?: string;           // Event type (e.g. "payment.updated")
  webhookLastEventId?: string;         // Event ID from MP (idempotency key)
  webhookLastProcessedAt?: string;     // ISO 8601

  // ── Audit / Metadata ──────────────────────────────────────────────────────
  metadata?: Record<string, unknown>;  // Any extra data from caller

  // ── Caminho B: per-revendedor connection ──────────────────────────────────
  // null → charge was generated with central platform account (MVP mode)
  // string → charge was generated with revendedor's own connected MP account
  mpConnectionId?: string | null;
  tokenSource?: "central" | "revendedor";  // Which account was used
}

// ---------------------------------------------------------------------------
// Input payload for creating a payment link (POST /api/payments/create-link)
// ---------------------------------------------------------------------------
export interface CreatePaymentLinkInput {
  uid: string;
  clientId: string;
  saleId?: string;
  title: string;
  description?: string;
  amount: number;
  quantity?: number;
  metadata?: Record<string, unknown>;
  // Caminho B: optional — if null uses central platform account
  mpConnectionId?: string;
}

// ---------------------------------------------------------------------------
// Webhook payload shapes (Mercado Pago)
// ---------------------------------------------------------------------------
export interface MPWebhookPayload {
  id?: string | number;
  action?: string;
  type?: string;
  data?: {
    id?: string | number;
  };
  user_id?: string | number;
  live_mode?: boolean;
  api_version?: string;
  date_created?: string;
}

// ---------------------------------------------------------------------------
// externalReference builder
// Format: {uid}_{chargeId}_{saleId|noSale}                (existing sale flow, unchanged)
//      or {uid}_{chargeId}_order:{orderId}                (RELEASE-CHECKOUT-03: public catalog order)
// Allows webhook to identify uid + chargeId (+ sale/order, when present) without DB lookup.
// The "order:" prefix is a NEW variant — every externalReference already persisted in production for
// sales keeps parsing exactly as before (bare saleId or "noSale", never prefixed), so no historical
// charge/webhook replay breaks.
// ---------------------------------------------------------------------------
export type ExternalReferenceTarget =
  | { kind: "sale"; id: string }
  | { kind: "order"; id: string }
  | undefined;

export function buildExternalReference(
  uid: string,
  chargeId: string,
  target?: ExternalReferenceTarget | string,
): string {
  // Aceita a chamada legada `buildExternalReference(uid, chargeId, saleId?: string)` sem mudar nenhum
  // call site existente do fluxo de venda — só a rota nova de pedido do catálogo passa o objeto tipado.
  let refSegment: string;
  if (typeof target === "string") {
    refSegment = target;
  } else if (!target) {
    refSegment = "noSale";
  } else if (target.kind === "sale") {
    refSegment = target.id;
  } else {
    refSegment = `order:${target.id}`;
  }
  return `${uid}_${chargeId}_${refSegment}`;
}

/** Parse externalReference back to components */
export function parseExternalReference(
  ref: string
): { uid: string; chargeId: string; saleId: string | null; orderId: string | null } | null {
  const parts = ref.split("_");
  if (parts.length < 3) return null;
  // uid may contain no underscores; chargeId is the second segment; rest is saleId/order:orderId
  // Firebase UIDs: 28 chars alphanumeric — no underscores, safe to split on _
  const uid = parts[0];
  const chargeId = parts[1];
  const refSegment = parts.slice(2).join("_");
  if (refSegment.startsWith("order:")) {
    const orderId = refSegment.slice("order:".length);
    return { uid, chargeId, saleId: null, orderId: orderId || null };
  }
  return {
    uid,
    chargeId,
    saleId: refSegment === "noSale" ? null : refSegment,
    orderId: null,
  };
}
