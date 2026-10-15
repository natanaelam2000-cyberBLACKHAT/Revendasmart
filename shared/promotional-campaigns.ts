/**
 * PROMOTIONAL-CAMPAIGNS-01 — domínio do módulo "Sorteios Promocionais" (admin-only, MVP). Compras já
 * registradas em vendas geram direitos ("entries") para o cliente escolher números de uma campanha; a
 * campanha NUNCA vende números nem processa pagamento. A autorização explícita do administrador
 * prevalece; participantes legados usam as vendas finalizadas no RevendaSmart. Funções puras aqui não tocam Firestore (testáveis isoladamente); o
 * servidor (`server/promotional-campaigns.ts`) é a única autoridade que decide `qualifyingSpend` a
 * partir das vendas reais — o cliente nunca envia esse valor como verdade.
 */

export type PromotionalCampaignStatus = "draft" | "active" | "paused" | "finished";

/** Toda campanha NOVA começa em 1 — não existe número 00/0 (PROMOTIONAL-CAMPAIGNS-02). */
export const DEFAULT_NUMBER_START = 1;
export const DEFAULT_NUMBER_COUNT = 100;
/**
 * Limite técnico, não de domínio: sem paginação/virtualização na grade pública
 * (`sorteio-publico.tsx` renderiza `numberCount` botões de uma vez), 2000 é uma margem confortável
 * acima do maior cenário exigido em teste (500) sem payload/DOM excessivos num dispositivo mobile.
 * Pode subir no futuro sem migração — é só um teto de validação de input, não estrutura de dados.
 */
export const MAX_CAMPAIGN_NUMBERS = 2000;

/** Valida `numberCount`: inteiro, > 0, <= MAX_CAMPAIGN_NUMBERS. Retorna null se inválido. */
export function validateNumberCount(value: unknown): number | null {
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num)) return null;
  if (num <= 0 || num > MAX_CAMPAIGN_NUMBERS) return null;
  return num;
}

export type PromotionalAllocationMode = "customer_choice" | "automatic";

export type PromotionalNumberStatus = "available" | "selected" | "claimed";

export interface PromotionalCampaign {
  readonly id: string;
  readonly ownerId: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly prizeName: string;
  readonly prizeImageUrl: string | null;
  readonly status: PromotionalCampaignStatus;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly drawAt: string | null;
  readonly spendPerEntry: number;
  readonly numberStart: number;
  readonly numberEnd: number;
  readonly allocationMode: PromotionalAllocationMode;
  /** Reservado para uma fase futura — nenhum algoritmo de sorteio é implementado neste MVP. */
  readonly winningNumber: number | null;
  readonly resultSource: string | null;
  readonly finishedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PromotionalNumber {
  readonly number: number;
  readonly status: PromotionalNumberStatus;
  readonly customerId: string | null;
  readonly claimedAt: string | null;
}

export interface PromotionalParticipant {
  readonly customerId: string;
  /**
   * Quantidade liberada explicitamente pelo administrador para este cliente.
   * Ausente em participantes legados: nesse caso o limite continua vindo das vendas qualificadas.
   */
  readonly assignedNumberCount?: number;
  readonly entriesClaimed: number;
  readonly claimedNumbers: readonly number[];
  readonly updatedAt: string;
}

export interface PromotionalAccessToken {
  readonly id: string;
  readonly customerId: string;
  readonly tokenHash: string;
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
}

export interface PromotionalEntitlement {
  readonly qualifyingSpend: number;
  readonly entriesEarned: number;
  readonly entriesAlreadyClaimed: number;
  readonly entriesAvailable: number;
  readonly amountUntilNextEntry: number;
}

export interface PromotionalClaimRequest {
  readonly token: string;
  readonly numbers: readonly number[];
}

export type PromotionalClaimDenyReason =
  | "INVALID_TOKEN"
  | "REVOKED_TOKEN"
  | "EXPIRED_TOKEN"
  | "CAMPAIGN_NOT_FOUND"
  | "CAMPAIGN_NOT_ACTIVE"
  | "OUTSIDE_CAMPAIGN_PERIOD"
  | "NO_NUMBERS_SELECTED"
  | "DUPLICATE_NUMBER_IN_PAYLOAD"
  | "NUMBER_OUT_OF_RANGE"
  | "EXCEEDS_AVAILABLE_ENTRIES"
  | "NUMBER_ALREADY_CLAIMED";

export interface PromotionalClaimResponse {
  readonly ok: boolean;
  readonly claimedNumbers?: readonly number[];
  readonly denyReason?: PromotionalClaimDenyReason;
  readonly conflictingNumber?: number;
}

/** floor(qualifyingSpend / spendPerEntry) — nunca arredonda para cima, nunca concede fração de direito. */
export function calculateEarnedEntries(qualifyingSpend: number, spendPerEntry: number): number {
  if (!Number.isFinite(qualifyingSpend) || qualifyingSpend <= 0) return 0;
  if (!Number.isFinite(spendPerEntry) || spendPerEntry <= 0) return 0;
  return Math.floor(qualifyingSpend / spendPerEntry);
}

/** Direitos conquistados menos os já usados (nunca negativo — um claim nunca pode "ficar devendo"). */
export function calculateAvailableEntries(entriesEarned: number, entriesAlreadyClaimed: number): number {
  return Math.max(0, entriesEarned - entriesAlreadyClaimed);
}

/** Quanto falta gastar para o PRÓXIMO direito (a "sobra lógica" do §8 do ticket). */
export function calculateAmountUntilNextEntry(qualifyingSpend: number, spendPerEntry: number): number {
  if (!Number.isFinite(spendPerEntry) || spendPerEntry <= 0) return 0;
  const remainder = qualifyingSpend % spendPerEntry;
  if (remainder === 0 && qualifyingSpend > 0) return 0;
  const missing = spendPerEntry - remainder;
  return Math.round(missing * 100) / 100;
}

export function calculateEntitlement(
  qualifyingSpend: number,
  spendPerEntry: number,
  entriesAlreadyClaimed: number,
  assignedNumberCount: number | null = null,
): PromotionalEntitlement {
  // Uma concessão explícita do admin substitui o cálculo por valor gasto. `null` mantém o contrato
  // legado para participantes criados antes da quantidade por cliente existir.
  const entriesEarned = assignedNumberCount === null ? calculateEarnedEntries(qualifyingSpend, spendPerEntry)
    : Number.isSafeInteger(assignedNumberCount) && assignedNumberCount >= 0 ? assignedNumberCount : 0;
  const entriesAvailable = calculateAvailableEntries(entriesEarned, entriesAlreadyClaimed);
  return {
    qualifyingSpend,
    entriesEarned,
    entriesAlreadyClaimed,
    entriesAvailable,
    amountUntilNextEntry: calculateAmountUntilNextEntry(qualifyingSpend, spendPerEntry),
  };
}

/** "0" -> "00", "7" -> "07", "100" -> "100" — sempre 2 dígitos mínimos; internamente é sempre integer. */
export function formatCampaignNumber(value: number): string {
  return String(Math.trunc(value)).padStart(2, "0");
}

export function isPromotionalCampaignStatus(value: unknown): value is PromotionalCampaignStatus {
  return value === "draft" || value === "active" || value === "paused" || value === "finished";
}

export function isPromotionalAllocationMode(value: unknown): value is PromotionalAllocationMode {
  return value === "customer_choice" || value === "automatic";
}

/**
 * Valida um payload de claim ANTES de qualquer leitura ao Firestore (formato/duplicidade/range) — a
 * validação de "quantos direitos o cliente tem" e "o número já foi escolhido por outra pessoa" exige
 * dados do servidor e é feita à parte, dentro da transação (`server/promotional-campaigns.ts`).
 */
export function validateClaimPayloadShape(input: {
  readonly numbers: readonly number[];
  readonly numberStart: number;
  readonly numberEnd: number;
  readonly entriesAvailable: number;
}): PromotionalClaimDenyReason | null {
  const { numbers, numberStart, numberEnd, entriesAvailable } = input;
  if (numbers.length === 0) return "NO_NUMBERS_SELECTED";
  const seen = new Set<number>();
  for (const raw of numbers) {
    if (!Number.isSafeInteger(raw)) return "NUMBER_OUT_OF_RANGE";
    const value = raw;
    if (seen.has(value)) return "DUPLICATE_NUMBER_IN_PAYLOAD";
    seen.add(value);
    if (value < numberStart || value > numberEnd) return "NUMBER_OUT_OF_RANGE";
  }
  if (numbers.length > entriesAvailable) return "EXCEEDS_AVAILABLE_ENTRIES";
  return null;
}

export function isCampaignPubliclyClaimable(campaign: Pick<PromotionalCampaign, "status" | "startsAt" | "endsAt">, now: Date = new Date()): boolean {
  if (campaign.status !== "active") return false;
  const nowMs = now.getTime();
  const startsMs = Date.parse(campaign.startsAt);
  const endsMs = Date.parse(campaign.endsAt);
  if (!Number.isFinite(startsMs) || !Number.isFinite(endsMs)) return false;
  return nowMs >= startsMs && nowMs <= endsMs;
}

export function generateCampaignSlug(title: string, suffix: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base ? `${base}-${suffix}` : suffix;
}
