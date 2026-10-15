/**
 * PLAN-IMPL-02B2 — comandos server-authoritative para o dono escolher explicitamente QUAIS Products/
 * Services existentes ficam "active" quando o total excede o limite do plano atual (§7/§8 do ticket).
 * Nunca confia no client para plano/limite/tenantUid/contagem — resolve tudo fresco aqui dentro, reusando
 * a mesma resolução de plano de PLAN-IMPL-02A2 (resolveServerPlan) e a mesma estratégia segura de escrita
 * de PLAN-IMPL-02B1 (fetchAllDocs/applyDomainChanges, server/plan-access-reconciliation.ts) — nenhuma
 * segunda implementação incompatível.
 *
 * NUNCA cria/apaga documento algum, nunca toca stock/salePrice/images/sales/histórico — só alterna
 * `planAccessState` em documentos JÁ existentes e marca `planAccessSelectionSource: "user"` nos que o
 * dono escolheu manter ativos (a memória que faz esta escolha sobreviver a um futuro replay automático de
 * `reconcilePlanAccess`, §12 do ticket).
 */
import type { Express, NextFunction, Request, Response } from "express";
import type { Firestore } from "firebase-admin/firestore";
import { getFirebaseAdmin } from "./firebase-admin-init";
import { logWarn } from "./logger";
import { resolveServerPlan } from "./plan-authoritative-mutations";
import { applyDomainChanges, fetchAllDocs, type DomainName, type PlannedChange } from "./plan-access-reconciliation";
import { PLAN_CONFIG, UNLIMITED, resolvePlanAccessState, type PlanType } from "../shared/monetization";

export type PlanAccessSelectionErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_INPUT"
  | "UNKNOWN_PRODUCT_ID"
  | "UNKNOWN_SERVICE_ID"
  | "TOO_MANY_SELECTED";

export class PlanAccessSelectionError extends Error {
  readonly code: PlanAccessSelectionErrorCode;
  readonly status: number;

  constructor(code: PlanAccessSelectionErrorCode, message: string, status = 400) {
    super(message);
    this.name = "PlanAccessSelectionError";
    this.code = code;
    this.status = status;
  }
}

export type PlanAccessSelectionResult = {
  readonly total: number;
  readonly active: number;
  readonly preserved: number;
  readonly limit: number;
};

/** Teto de sanidade bem acima do maior limite real (Premium: 2000 produtos) — só para rejeitar um
 * payload absurdo antes de qualquer leitura no Firestore, nunca uma segunda autoridade de limite (essa
 * continua sendo `PLAN_CONFIG[plan].limits`, verificada abaixo). */
const MAX_SELECTED_IDS = 5000;

function assertSelectedIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new PlanAccessSelectionError("INVALID_INPUT", "selectedIds deve ser uma lista.");
  }
  if (value.length > MAX_SELECTED_IDS) {
    throw new PlanAccessSelectionError("INVALID_INPUT", "Lista de seleção excede o tamanho permitido.");
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(item)) {
      throw new PlanAccessSelectionError("INVALID_INPUT", "Um dos ids selecionados é inválido.");
    }
    if (!seen.has(item)) {
      seen.add(item);
      ids.push(item);
    }
  }
  return ids;
}

/**
 * §7-§9/§29 do ticket: valida autenticação (chamador), plano efetivo atual (nunca o que o client alega),
 * que TODO id selecionado pertence de fato ao tenant (senão REJEITA a seleção inteira — nunca ignora
 * silenciosamente um id de outro tenant ou inexistente), e que a contagem selecionada cabe no limite
 * canônico. Só então aplica: selecionados -> active (+ planAccessSelectionSource: "user"); os demais,
 * já possuídos pelo tenant -> preserved (sem tocar selectionSource — um item nunca escolhido pelo dono
 * não precisa de memória de exclusão permanente, ver server/plan-access-reconciliation.ts).
 */
async function applySelection(
  db: Firestore,
  uid: string,
  domain: DomainName,
  limit: number,
  selectedIds: readonly string[],
  unknownIdErrorCode: "UNKNOWN_PRODUCT_ID" | "UNKNOWN_SERVICE_ID",
): Promise<PlanAccessSelectionResult> {
  if (limit !== UNLIMITED && selectedIds.length > limit) {
    throw new PlanAccessSelectionError(
      "TOO_MANY_SELECTED",
      `Você selecionou mais itens do que seu plano atual permite (limite: ${limit}).`,
      403,
    );
  }

  const docs = await fetchAllDocs(db, uid, domain);
  const ownedIds = new Set(docs.map((doc) => doc.id));
  for (const id of selectedIds) {
    if (!ownedIds.has(id)) {
      throw new PlanAccessSelectionError(unknownIdErrorCode, "Um dos itens selecionados não pertence a você.", 403);
    }
  }

  const selectedSet = new Set(selectedIds);
  const changes: PlannedChange[] = [];
  for (const doc of docs) {
    const currentState = resolvePlanAccessState(doc.data.planAccessState);
    if (selectedSet.has(doc.id)) {
      if (currentState !== "active" || doc.data.planAccessSelectionSource !== "user") {
        changes.push({ id: doc.id, target: "active", extra: { planAccessSelectionSource: "user" } });
      }
    } else if (currentState !== "preserved") {
      changes.push({ id: doc.id, target: "preserved" });
    }
  }

  await applyDomainChanges(db, uid, domain, changes);

  const total = docs.length;
  const activeCount = selectedIds.length;
  return { total, active: activeCount, preserved: total - activeCount, limit };
}

export async function setActiveProductSelection(db: Firestore, uid: string, selectedIdsInput: unknown): Promise<PlanAccessSelectionResult> {
  const selectedIds = assertSelectedIds(selectedIdsInput);
  const plan: PlanType = await resolveServerPlan(db, uid);
  return applySelection(db, uid, "products", PLAN_CONFIG[plan].limits.products, selectedIds, "UNKNOWN_PRODUCT_ID");
}

export async function setActiveServiceSelection(db: Firestore, uid: string, selectedIdsInput: unknown): Promise<PlanAccessSelectionResult> {
  const selectedIds = assertSelectedIds(selectedIdsInput);
  const plan: PlanType = await resolveServerPlan(db, uid);
  return applySelection(db, uid, "services", PLAN_CONFIG[plan].limits.services, selectedIds, "UNKNOWN_SERVICE_ID");
}

function sendSelectionError(res: Response, error: unknown): void {
  if (error instanceof PlanAccessSelectionError) {
    res.status(error.status).json({ code: error.code, message: error.message });
    return;
  }
  logWarn("plan_access_selection.failed", { message: error instanceof Error ? error.message : String(error) });
  res.status(500).json({ code: "SELECTION_FAILED", message: "Não foi possível atualizar seus itens ativos agora. Tente novamente." });
}

export function registerPlanAccessSelectionRoutes(
  app: Express,
  requireAuth: (req: Request, res: Response, next: NextFunction) => void,
): void {
  app.post("/api/plan-access/products/selection", requireAuth, async (req: Request, res: Response) => {
    const uid = (req as Request & { firebaseUid?: string }).firebaseUid;
    if (!uid) return res.status(401).json({ code: "UNAUTHORIZED", message: "Sessão inválida. Faça login novamente." });
    try {
      const result = await setActiveProductSelection(getFirebaseAdmin().firestore(), uid, req.body?.selectedIds);
      return res.status(200).json(result);
    } catch (error) {
      return sendSelectionError(res, error);
    }
  });

  app.post("/api/plan-access/services/selection", requireAuth, async (req: Request, res: Response) => {
    const uid = (req as Request & { firebaseUid?: string }).firebaseUid;
    if (!uid) return res.status(401).json({ code: "UNAUTHORIZED", message: "Sessão inválida. Faça login novamente." });
    try {
      const result = await setActiveServiceSelection(getFirebaseAdmin().firestore(), uid, req.body?.selectedIds);
      return res.status(200).json(result);
    } catch (error) {
      return sendSelectionError(res, error);
    }
  });
}
