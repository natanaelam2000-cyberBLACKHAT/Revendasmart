import type { Sale } from "@/lib/mock-data";

/**
 * RELEASE-26: fonte única de "última venda por cliente" / "cliente inativo há N dias".
 *
 * Antes só existia dentro de home-dashboard-view-model.ts (para o número do card de Prioridades
 * "N cliente(s) sem comprar há mais de 60 dias"). O card agora leva para /clients com um filtro que
 * precisa aplicar EXATAMENTE o mesmo critério — se as duas fontes divergissem, o número do card nunca
 * bateria com o resultado do filtro.
 */
const DAY_MS = 86_400_000;
export const INACTIVE_CLIENT_THRESHOLD_DAYS = 60;

function parseSafeDate(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Mapa clientId -> data da venda mais recente. Vendas sem data válida ou sem clientId são ignoradas. */
export function buildLastSaleByClientId(sales: Sale[]): Map<string, Date> {
  const lastSaleByClientId = new Map<string, Date>();
  for (const sale of sales) {
    if (!sale.clientId) continue;
    const parsedDate = parseSafeDate(sale.date);
    if (!parsedDate) continue;
    const current = lastSaleByClientId.get(sale.clientId);
    if (!current || parsedDate > current) lastSaleByClientId.set(sale.clientId, parsedDate);
  }
  return lastSaleByClientId;
}

/**
 * Cliente sem NENHUMA venda registrada nunca é "inativo" por este critério — inatividade pressupõe
 * atividade anterior. Isso preserva o comportamento já existente no card de Prioridades.
 */
export function isClientInactive(
  lastSale: Date | undefined,
  referenceDate: Date,
  thresholdDays: number = INACTIVE_CLIENT_THRESHOLD_DAYS,
): boolean {
  return Boolean(lastSale && Math.floor((referenceDate.getTime() - lastSale.getTime()) / DAY_MS) >= thresholdDays);
}
