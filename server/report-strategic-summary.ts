/**
 * PLAN-IMPL-07B §10/§11/§22/§29 — seção estratégica de Relatórios (Premium): "o que fazer" resumido a
 * partir da MESMA autoridade canônica de oportunidades (PLAN-IMPL-07A, server/opportunity-engine.ts) —
 * nunca uma segunda detecção/engine paralela. Este arquivo só empacota computeOpportunities +
 * summarizeOpportunities atrás de uma rota própria, com o MESMO gate de entitlement server-side de
 * /api/opportunities (mesmo bar comercial: "oportunidades" e "leitura estratégica" são a mesma
 * capacidade Premium, só exibida em duas telas diferentes — Relatórios responde "o que aconteceu",
 * Oportunidades responde "o que fazer", §5).
 */
import type { Express, NextFunction, Request, Response } from "express";
import type { Firestore } from "firebase-admin/firestore";
import { computeOpportunities, summarizeOpportunities } from "./opportunity-engine";
import { hasAdvancedOpportunityAccess } from "../shared/opportunity-rules";
import type { PlanType } from "../shared/monetization";
import { getFirebaseAdmin } from "./firebase-admin-init";
import { isAdminUid } from "./admin-auth";
import { logError } from "./logger";

/**
 * §22/§23/§32 — mesma autoridade/mesmo fail-closed de registerOpportunityRoutes: entitlement resolvido
 * SEMPRE via effectivePlan (resolveServerPlan, trial-aware), nunca client-declarado; falha de
 * lifecycle nunca vira "assume Premium" nem "assume Free" — indisponível (503), leitura pura, nenhuma
 * mutação em jogo. O resultado real nunca é computado para quem não tem acesso e escondido depois —
 * o gate roda ANTES de computeOpportunities ser sequer chamado.
 */
export function registerReportStrategicSummaryRoutes(
  app: Express,
  requireAuth: (req: Request, res: Response, next: NextFunction) => void,
  resolveServerPlan: (db: Firestore, uid: string) => Promise<PlanType>,
): void {
  app.get("/api/reports/strategic-summary", requireAuth, async (req: Request, res: Response) => {
    const uid = (req as Request & { firebaseUid?: string }).firebaseUid;
    if (!uid) return res.status(401).json({ code: "UNAUTHORIZED", message: "Sessão inválida. Faça login novamente." });
    try {
      const db = getFirebaseAdmin().firestore();
      const admin = await isAdminUid(uid);
      if (!admin) {
        const effectivePlan = await resolveServerPlan(db, uid);
        if (!hasAdvancedOpportunityAccess(effectivePlan)) {
          return res.status(403).json({ code: "STRATEGIC_REPORT_PLAN_REQUIRED", message: "A leitura estratégica é um recurso do plano Premium." });
        }
      }
      const opportunities = await computeOpportunities(db, uid);
      const summary = summarizeOpportunities(opportunities);
      return res.status(200).json(summary);
    } catch (error) {
      logError("report_strategic_summary.route_failed", error, { requestId: req.requestId });
      return res.status(503).json({ code: "STRATEGIC_REPORT_UNAVAILABLE", message: "Não foi possível carregar este relatório. Tente novamente." });
    }
  });
}
