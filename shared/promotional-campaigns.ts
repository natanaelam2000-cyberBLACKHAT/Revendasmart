/**
 * PROMOTIONAL-CAMPAIGNS-01 — domínio do módulo "Sorteios Promocionais" (admin-only, MVP). Compras já
 * registradas em vendas geram direitos ("entries") para o cliente escolher números de uma campanha; a
 * campanha NUNCA vende números nem processa pagamento — o direito nasce exclusivamente de vendas já
 * finalizadas no RevendaSmart. Funções puras aqui não tocam Firestore (testáveis isoladamente); o
 * servidor (`server/promotional-campaigns.ts`) é a única autoridade que decide `qualifyingSpend` a
 * partir das vendas reais — o cliente nunca envia esse valor como verdade.
 */

/**
 * PROMOTIONAL-CAMPAIGNS-SECURE-DRAW-06 — "entries_closed" e "drawn" são novos estados intermediários
 * entre "paused"/"active" e "finished": encerrar participações NUNCA escolhe vencedor (§3), e realizar o
 * sorteio NUNCA é reversível por uma simples troca de status (§10/§11) — por isso ambos só são atingíveis
 * pelas rotas dedicadas `close-entries`/`draw`, nunca pelo PATCH genérico de status. "finished" continua
 * existindo para compatibilidade com o fluxo legado (campanhas que nunca usarão o motor de apuração).
 */
export type PromotionalCampaignStatus = "draft" | "active" | "paused" | "entries_closed" | "drawn" | "finished";

/**
 * PROMOTIONAL-CAMPAIGNS-MANUAL-INTERNAL-05 — Sorteios Promocionais é admin-only hoje, então toda
 * campanha nasce com policy INTERNAL_ADMIN (direitos de vendas registradas + concessão manual interna).
 * Se o recurso for liberado a usuários comuns no futuro, campanhas públicas nascerão com
 * REGISTERED_SALES_ONLY (só vendas registradas, concessão manual bloqueada mesmo no backend) — um único
 * motor de entitlement, a policy é que decide quais fontes contam, nunca dois sistemas separados.
 */
export type EntitlementPolicy = "INTERNAL_ADMIN" | "REGISTERED_SALES_ONLY";

export function isEntitlementPolicy(value: unknown): value is EntitlementPolicy {
  return value === "INTERNAL_ADMIN" || value === "REGISTERED_SALES_ONLY";
}

export type EntitlementEventType = "MANUAL_INTERNAL_GRANT" | "MANUAL_INTERNAL_ADJUSTMENT";

/** Motivos rápidos para a UI — não burocrático, `note` livre cobre o resto. */
export const MANUAL_GRANT_REASONS = [
  "external_magazine_sale",
  "unregistered_purchase",
  "courtesy",
  "manual_adjustment",
  "other",
] as const;
export type ManualGrantReason = typeof MANUAL_GRANT_REASONS[number];

export function isManualGrantReason(value: unknown): value is ManualGrantReason {
  return (MANUAL_GRANT_REASONS as readonly string[]).includes(value as string);
}

export const MANUAL_GRANT_REASON_LABELS: Record<ManualGrantReason, string> = {
  external_magazine_sale: "Venda externa / revista",
  unregistered_purchase: "Compra não registrada",
  courtesy: "Cortesia",
  manual_adjustment: "Ajuste manual",
  other: "Outro",
};

/**
 * Evento IMUTÁVEL de auditoria — nunca editado nem apagado. Uma correção posterior soma um NOVO evento
 * compensatório (amount negativo), preservando o histórico completo. A soma dos `amount` de todos os
 * eventos de um participante é `manualInternalEntries`. Vendas registradas não geram evento aqui — a
 * própria coleção `sales` já é a fonte de auditoria dessa origem, recalculada fresca a cada leitura.
 */
export interface EntitlementEvent {
  readonly id: string;
  readonly customerId: string;
  readonly type: EntitlementEventType;
  readonly amount: number;
  readonly reason: ManualGrantReason | null;
  readonly note: string | null;
  readonly createdAt: string;
  readonly createdBy: string;
}

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
  /** PROMOTIONAL-CAMPAIGNS-MANUAL-INTERNAL-05 — ausente em campanhas criadas antes desta feature; nesse
   * caso o servidor trata como INTERNAL_ADMIN (era o único modo existente). */
  readonly entitlementPolicy: EntitlementPolicy;
  /** Reservado para uma fase futura — nenhum algoritmo de sorteio é implementado neste MVP. */
  readonly winningNumber: number | null;
  readonly resultSource: string | null;
  readonly finishedAt: string | null;
  /** PROMOTIONAL-CAMPAIGNS-SECURE-DRAW-06 — quando as participações foram encerradas (`close-entries`).
   * `null` em campanhas que nunca passaram por esse estado (inclui todas as campanhas anteriores a esta
   * feature). */
  readonly entriesClosedAt: string | null;
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
  /**
   * PROMOTIONAL-CAMPAIGNS-LINK-SELECTION-LIMIT-04 — quantos dos direitos JÁ EXISTENTES do cliente este
   * link específico pode consumir (nunca cria direitos novos). `null` = link legado, criado antes desta
   * feature — sem teto próprio, capado só pelo saldo global (comportamento idêntico ao anterior).
   */
  readonly selectionLimit: number | null;
  /** Quantos números já foram confirmados especificamente através DESTE token (nunca reseta). */
  readonly claimedThroughToken: number;
}

export interface PromotionalEntitlement {
  readonly qualifyingSpend: number;
  /** Total = automaticEntries + manualInternalEntries (mantém o significado histórico do campo). */
  readonly entriesEarned: number;
  readonly entriesAlreadyClaimed: number;
  readonly entriesAvailable: number;
  readonly amountUntilNextEntry: number;
  /** floor(qualifyingSpend / spendPerEntry) — sempre derivado de vendas reais, nunca da policy. */
  readonly automaticEntries: number;
  /** Soma dos EntitlementEvent do participante; sempre 0 sob policy REGISTERED_SALES_ONLY. */
  readonly manualInternalEntries: number;
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

/**
 * PROMOTIONAL-CAMPAIGNS-LINK-SELECTION-LIMIT-04 — valida `selectionLimit` ao gerar um link: inteiro,
 * 1 <= valor <= direitos disponíveis do cliente NO MOMENTO da criação. Nunca cria direitos — só decide
 * quantos dos já existentes este link específico poderá consumir. Retorna null se inválido.
 */
export function validateSelectionLimit(value: unknown, entriesAvailable: number): number | null {
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num)) return null;
  if (num < 1 || num > entriesAvailable) return null;
  return num;
}

/** Quantos deste token específico ainda podem ser usados. `null` = link legado, sem teto próprio. */
export function calculateTokenRemaining(selectionLimit: number | null, claimedThroughToken: number): number | null {
  if (selectionLimit === null) return null;
  return Math.max(0, selectionLimit - claimedThroughToken);
}

/**
 * O teto real de uma claim através de um token específico: o menor valor entre o saldo GLOBAL do
 * cliente (pode ter mudado desde a criação do link) e o que resta do teto próprio do token. Nunca
 * confia isoladamente em um dos dois — protege contra múltiplos links somados excederem o saldo real.
 */
export function calculateMaxSelectable(entriesAvailable: number, tokenRemaining: number | null): number {
  return tokenRemaining === null ? entriesAvailable : Math.min(entriesAvailable, tokenRemaining);
}

/** Entitlement puramente automático (manualInternalEntries=0) — usado onde concessão manual não se aplica. */
export function calculateEntitlement(qualifyingSpend: number, spendPerEntry: number, entriesAlreadyClaimed: number): PromotionalEntitlement {
  const automaticEntries = calculateEarnedEntries(qualifyingSpend, spendPerEntry);
  const entriesAvailable = calculateAvailableEntries(automaticEntries, entriesAlreadyClaimed);
  return {
    qualifyingSpend,
    entriesEarned: automaticEntries,
    entriesAlreadyClaimed,
    entriesAvailable,
    amountUntilNextEntry: calculateAmountUntilNextEntry(qualifyingSpend, spendPerEntry),
    automaticEntries,
    manualInternalEntries: 0,
  };
}

/**
 * PROMOTIONAL-CAMPAIGNS-MANUAL-INTERNAL-05 — entitlement ciente de policy: sob INTERNAL_ADMIN, soma
 * concessões manuais aos direitos automáticos; sob REGISTERED_SALES_ONLY, ignora qualquer
 * manualInternalEntries (defesa em profundidade — a rota de concessão já bloqueia a origem, isto
 * garante que mesmo um evento remanescente nunca conta sob a policy pública).
 */
export function calculateEntitlementWithManualGrants(input: {
  readonly qualifyingSpend: number;
  readonly spendPerEntry: number;
  readonly manualInternalEntries: number;
  readonly entriesAlreadyClaimed: number;
  readonly policy: EntitlementPolicy;
}): PromotionalEntitlement {
  const { qualifyingSpend, spendPerEntry, entriesAlreadyClaimed, policy } = input;
  const automaticEntries = calculateEarnedEntries(qualifyingSpend, spendPerEntry);
  const manualInternalEntries = policy === "INTERNAL_ADMIN" ? Math.max(0, input.manualInternalEntries) : 0;
  const entriesEarned = automaticEntries + manualInternalEntries;
  const entriesAvailable = calculateAvailableEntries(entriesEarned, entriesAlreadyClaimed);
  return {
    qualifyingSpend,
    entriesEarned,
    entriesAlreadyClaimed,
    entriesAvailable,
    amountUntilNextEntry: calculateAmountUntilNextEntry(qualifyingSpend, spendPerEntry),
    automaticEntries,
    manualInternalEntries,
  };
}

/** Valida a quantidade de uma concessão manual: inteiro > 0 (correções usam eventos negativos à parte). */
export function validateManualGrantQuantity(value: unknown): number | null {
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num)) return null;
  if (num <= 0) return null;
  return num;
}

/** "0" -> "00", "7" -> "07", "100" -> "100" — sempre 2 dígitos mínimos; internamente é sempre integer. */
export function formatCampaignNumber(value: number): string {
  return String(Math.trunc(value)).padStart(2, "0");
}

export function isPromotionalCampaignStatus(value: unknown): value is PromotionalCampaignStatus {
  return (
    value === "draft" || value === "active" || value === "paused" ||
    value === "entries_closed" || value === "drawn" || value === "finished"
  );
}

/** Encerrar participações só faz sentido enquanto a campanha ainda aceita claims. */
export function isCampaignClosable(status: PromotionalCampaignStatus): boolean {
  return status === "active" || status === "paused";
}

/**
 * Só pode sortear depois de encerrar — nunca a partir de active/paused/draft.
 *
 * LEGACY-FINISHED-DRAW-06B — "finished" também é elegível: campanhas encerradas pelo botão/fluxo antigo
 * (anterior ao SECURE-DRAW-06) chegam a esse status sem nunca ter passado por "entries_closed", e sem
 * nenhum resultado oficial persistido. O botão "Finalizar" atalho foi removido da UI (não é mais possível
 * criar NOVAS campanhas nesse estado sem apuração), mas isto preserva o acesso à apuração para as que já
 * existem. O chamador (server) só invoca esta função DEPOIS de confirmar que nenhum draw oficial já
 * existe — aqui só se decide "esse status é compatível com apuração", nunca "já foi sorteado ou não".
 */
export function isCampaignDrawable(status: PromotionalCampaignStatus): boolean {
  return status === "entries_closed" || status === "finished";
}

/**
 * PROMOTIONAL-CAMPAIGNS-SECURE-DRAW-06 — cada número CLAIMED vira exatamente uma entrada elegível na
 * apuração; a origem do direito (venda registrada ou concessão manual interna) já decidiu no momento do
 * claim se o número podia ser escolhido — a apuração só olha para o que já está claimed, nunca reconsulta
 * a origem (§5/§22). Ordenado por número crescente para nunca depender da ordem de retorno do Firestore
 * (§17) — pré-requisito para `eligibleSetHash` ser determinístico.
 */
export interface EligibleEntry {
  readonly number: number;
  readonly clientId: string;
}

export function buildEligibleEntries(claimedNumbers: readonly { number: number; customerId: string }[]): EligibleEntry[] {
  return claimedNumbers
    .map((entry) => ({ number: entry.number, clientId: entry.customerId }))
    .sort((a, b) => a.number - b.number);
}

/**
 * Serialização canônica do conjunto elegível — entrada de `computeEligibleSetHash` (SHA-256, calculado no
 * servidor com `node:crypto`; esta função fica no shared/pure porque não depende de Node). Reordena
 * sempre por número, então o hash nunca muda por causa da ordem de leitura do Firestore — só muda se o
 * CONJUNTO em si mudar.
 */
export function canonicalEligibleSetString(entries: readonly EligibleEntry[]): string {
  return [...entries]
    .sort((a, b) => a.number - b.number)
    .map((entry) => `${entry.number}:${entry.clientId}`)
    .join("|");
}

export function countDistinctParticipants(entries: readonly EligibleEntry[]): number {
  return new Set(entries.map((entry) => entry.clientId)).size;
}

/** Resultado oficial da apuração — persistido uma única vez por campanha (§8/§10), nunca editado depois. */
export interface OfficialDrawResult {
  readonly drawId: string;
  readonly campaignId: string;
  readonly campaignOwnerId: string;
  readonly closedAt: string | null;
  readonly drawnAt: string;
  readonly eligibleNumberCount: number;
  readonly participantCount: number;
  readonly algorithm: string;
  readonly algorithmVersion: number;
  readonly eligibleSetHash: string;
  readonly winningNumber: number;
  readonly winningClientId: string;
  readonly winnerDisplayNameSnapshot: string;
  readonly prizeNameSnapshot: string;
  readonly prizeImageUrlSnapshot: string | null;
  readonly createdBy: string;
}

/**
 * SECURE-DRAW-VISUAL-07 — só decide QUAIS números aparecem decorativamente girando no globo; NUNCA
 * decide o vencedor (§2 — Math.random/pseudoaleatoriedade aqui é puramente visual). `winningNumber`
 * SEMPRE está incluído no conjunto retornado, porque a bolinha revelada no final precisa corresponder a
 * um número realmente renderizado (§7/§20). `randomFn` é injetável só para tornar a função testável sem
 * depender de Math.random real.
 */
export function buildDrawAnimationBalls(
  numberStart: number,
  numberEnd: number,
  winningNumber: number,
  maxBalls: number,
  randomFn: () => number = Math.random,
): number[] {
  const range = Math.max(1, numberEnd - numberStart + 1);
  const count = Math.min(Math.max(1, maxBalls), range);
  const set = new Set<number>([winningNumber]);
  let guard = 0;
  while (set.size < count && guard < count * 20) {
    set.add(numberStart + Math.floor(randomFn() * range));
    guard += 1;
  }
  return Array.from(set);
}

export type DrawAnimationMode = "new" | "replay";

/**
 * Em modo "replay" o resultado já é conhecido de antemão — a apresentação nunca chama /draw de novo
 * (§11/§12). Em modo "new" a apresentação só conhece o resultado depois que o backend responde (§1) —
 * por isso começa null aqui, nunca o `existingDraw` (que é ignorado/null nesse modo).
 */
export function resolveInitialDrawAnimationResult(mode: DrawAnimationMode, existingDraw: OfficialDrawResult | null): OfficialDrawResult | null {
  return mode === "replay" ? existingDraw : null;
}

/** §5 — timing padrão (~10.6s de countdown a revelação completa, dentro dos 8–11s sugeridos). */
export const DRAW_ANIMATION_PHASE_MS = { countdown: 3000, spinning: 4000, decelerating: 1600, revealNumber: 1200, revealWinner: 1200 } as const;
/** §15 — prefers-reduced-motion: pula o giro contínuo (spinning/decelerating = 0), mantém uma contagem
 * curta até o resultado, nunca impede o uso do recurso. */
export const DRAW_ANIMATION_REDUCED_PHASE_MS = { countdown: 900, spinning: 0, decelerating: 0, revealNumber: 500, revealWinner: 500 } as const;

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
    const value = Math.trunc(raw);
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
