/**
 * PRO-10B — Perfil Criativo (SellerCreativeProfile) server-owned, item 4 (o mais fraco) da hierarquia
 * de decisão do Creative Intelligence (`shared/marketing-pro-creative-intelligence.ts`,
 * CREATIVE_DECISION_PRIORITY: product_truth > commercial_coherence > campaign_objective >
 * seller_preferences). Este módulo NUNCA decide o que vai no anúncio — só guarda a preferência
 * declarada pelo vendedor, que `buildCreativeBrief` (contrato central) consome como UM dos quatro
 * insumos, nunca como autoridade final.
 *
 * Reaproveita deliberadamente o mesmo padrão de `server/marketing-pro.ts`: uid SEMPRE do token
 * (`req.firebaseUid`), nunca do body/params — não existe `:userId` na URL, então não há como um uid de
 * outro usuário aparecer aqui. Mesma entitlement (`requireProAdsEntitlement`, reexportada de lá — não
 * uma segunda implementação). Path Firestore `users/{uid}/marketingProfile/creative`, no mesmo estilo de
 * `users/{uid}/planData/main` — tenant-scoped por construção, nunca uma coleção global.
 */
import type { Express, NextFunction, Request, Response } from "express";
import { getFirebaseAdmin } from "./firebase-admin-init";
import { logError, logInfo, logWarn } from "./logger";
import { requireProAdsEntitlement } from "./marketing-pro";
import {
  CREATIVE_INTELLIGENCE_CONTRACT_VERSION,
  validateSellerCreativeProfile,
  type CreativeFamily,
  type SellerCreativePreferences,
  type SellerCreativeProfile,
} from "../shared/marketing-pro-creative-intelligence";

// --- Allowlists de runtime (§13) ---
//
// `shared/marketing-pro-creative-intelligence.ts` declara os enums só como UNION TYPES (apagados em
// runtime) — não exporta um array de valores. Duplicar os literais aqui como um array de RUNTIME é a
// única forma de validar o CONTEÚDO desses campos no servidor sem tocar o contrato central (proibido
// nesta tarefa). Cada array abaixo precisa continuar em sincronia com o type correspondente — se o
// contrato ganhar um valor novo, este arquivo precisa ser atualizado para aceitá-lo.
const CREATIVE_FAMILY_VALUES: readonly CreativeFamily[] = ["luxury", "editorial", "modern", "minimal", "sensory", "fresh-premium", "fresh-sport", "fresh-commercial"];
const INFORMATION_DENSITY_VALUES = ["low", "balanced", "high"] as const;
const PRODUCT_EMPHASIS_VALUES = ["subtle", "balanced", "hero"] as const;
const PRICE_EMPHASIS_VALUES = ["subtle", "standard", "highlight"] as const;
const PROMOTION_INTENSITY_VALUES = ["low", "balanced", "high"] as const;
const TYPOGRAPHY_PREFERENCE_VALUES = ["clean", "editorial", "expressive"] as const;
const COMPOSITION_PREFERENCE_VALUES = ["minimal", "balanced", "dynamic"] as const;

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

/** §13: limites de tamanho — o onboarding produz um objeto pequeno; nada aqui deveria chegar perto disto. */
const LIMITS = {
  maxColorTendencies: 8,
  maxColorTendencyLength: 40,
  maxCreativeFamilyArrayLength: CREATIVE_FAMILY_VALUES.length,
  maxSerializedBytes: 20 * 1024,
  /** §5: o onboarding tem exatamente 5 etapas — nenhuma resposta válida além dessas 5 chega aqui. Um
   * Learning Loop futuro que precise de sampleCount maior teria seu PRÓPRIO endpoint/validação. */
  maxOnboardingSampleCount: 5,
  /** §5: "não fingir confiança alta" — teto conservador para um perfil que é só bootstrap. */
  maxBootstrapConfidence: 0.5,
} as const;

const ALLOWED_PREFERENCES_KEYS = new Set<keyof SellerCreativePreferences>([
  "visualStyles", "informationDensity", "productEmphasis", "priceEmphasis", "promotionIntensity",
  "typographyPreference", "compositionPreference", "colorTendencies", "preferredCreativeFamilies", "dislikedCreativeFamilies",
]);
const ALLOWED_PROFILE_KEYS = new Set<keyof SellerCreativeProfile>(["version", "globalPreferences", "categoryPreferences", "confidence", "sampleCount", "updatedAt"]);

export type CreativeProfileValidationIssue =
  | "INVALID_SHAPE"
  | "UNKNOWN_FIELD"
  | "INVALID_VERSION"
  | "INVALID_GLOBAL_PREFERENCES"
  | "INVALID_ENUM_VALUE"
  | "ARRAY_TOO_LARGE"
  | "STRING_TOO_LONG"
  | "CATEGORY_PREFERENCES_NOT_ALLOWED"
  | "CONFIDENCE_TOO_HIGH"
  | "SAMPLE_COUNT_TOO_HIGH"
  | "PAYLOAD_TOO_LARGE";

export type ValidateCreativeProfileSaveResult =
  | { readonly valid: true; readonly preferences: SellerCreativePreferences; readonly confidence: number; readonly sampleCount: number }
  | { readonly valid: false; readonly issue: CreativeProfileValidationIssue };

function validatePreferences(value: unknown): SellerCreativePreferences | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ALLOWED_PREFERENCES_KEYS.has(key as keyof SellerCreativePreferences)) return null;
  }
  const preferences: Record<string, unknown> = {};

  if (record.informationDensity !== undefined) {
    if (!isOneOf(record.informationDensity, INFORMATION_DENSITY_VALUES)) return null;
    preferences.informationDensity = record.informationDensity;
  }
  if (record.productEmphasis !== undefined) {
    if (!isOneOf(record.productEmphasis, PRODUCT_EMPHASIS_VALUES)) return null;
    preferences.productEmphasis = record.productEmphasis;
  }
  if (record.priceEmphasis !== undefined) {
    if (!isOneOf(record.priceEmphasis, PRICE_EMPHASIS_VALUES)) return null;
    preferences.priceEmphasis = record.priceEmphasis;
  }
  if (record.promotionIntensity !== undefined) {
    if (!isOneOf(record.promotionIntensity, PROMOTION_INTENSITY_VALUES)) return null;
    preferences.promotionIntensity = record.promotionIntensity;
  }
  if (record.typographyPreference !== undefined) {
    if (!isOneOf(record.typographyPreference, TYPOGRAPHY_PREFERENCE_VALUES)) return null;
    preferences.typographyPreference = record.typographyPreference;
  }
  if (record.compositionPreference !== undefined) {
    if (!isOneOf(record.compositionPreference, COMPOSITION_PREFERENCE_VALUES)) return null;
    preferences.compositionPreference = record.compositionPreference;
  }
  for (const familyField of ["visualStyles", "preferredCreativeFamilies", "dislikedCreativeFamilies"] as const) {
    const raw = record[familyField];
    if (raw === undefined) continue;
    if (!Array.isArray(raw) || raw.length > LIMITS.maxCreativeFamilyArrayLength) return null;
    if (!raw.every((item) => isOneOf(item, CREATIVE_FAMILY_VALUES))) return null;
    preferences[familyField] = raw;
  }
  if (record.colorTendencies !== undefined) {
    const raw = record.colorTendencies;
    if (!Array.isArray(raw) || raw.length > LIMITS.maxColorTendencies) return null;
    if (!raw.every((item) => typeof item === "string" && item.trim().length > 0 && item.length <= LIMITS.maxColorTendencyLength)) return null;
    preferences.colorTendencies = raw;
  }

  return preferences as SellerCreativePreferences;
}

/**
 * Único ponto de validação de um SAVE de Perfil Criativo — fail closed (§13: "bloquear campos extras
 * desconhecidos"). Devolve `preferences`/`confidence`/`sampleCount` já validados; `version`/
 * `categoryPreferences`/`updatedAt` NUNCA vêm do body — são sempre o valor canônico do servidor (ver
 * `persistCreativeProfile` abaixo), então nem chegam a ser devolvidos aqui.
 */
export function validateCreativeProfileSavePayload(body: unknown): ValidateCreativeProfileSaveResult {
  if (JSON.stringify(body ?? {}).length > LIMITS.maxSerializedBytes) return { valid: false, issue: "PAYLOAD_TOO_LARGE" };
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { valid: false, issue: "INVALID_SHAPE" };
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ALLOWED_PROFILE_KEYS.has(key as keyof SellerCreativeProfile)) return { valid: false, issue: "UNKNOWN_FIELD" };
  }

  if (record.version !== CREATIVE_INTELLIGENCE_CONTRACT_VERSION) return { valid: false, issue: "INVALID_VERSION" };

  // §6: o onboarding só alimenta GLOBAL preferences — categoryPreferences começa (e permanece) vazio
  // até o Learning Loop existir (fora de escopo desta tarefa).
  if (record.categoryPreferences !== undefined && Object.keys(record.categoryPreferences as object || {}).length > 0) {
    return { valid: false, issue: "CATEGORY_PREFERENCES_NOT_ALLOWED" };
  }

  const preferences = validatePreferences(record.globalPreferences);
  if (!preferences) return { valid: false, issue: "INVALID_GLOBAL_PREFERENCES" };

  const confidence = record.confidence;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return { valid: false, issue: "INVALID_GLOBAL_PREFERENCES" };
  if (confidence > LIMITS.maxBootstrapConfidence) return { valid: false, issue: "CONFIDENCE_TOO_HIGH" };

  const sampleCount = record.sampleCount;
  if (typeof sampleCount !== "number" || !Number.isInteger(sampleCount) || sampleCount < 0) return { valid: false, issue: "INVALID_GLOBAL_PREFERENCES" };
  if (sampleCount > LIMITS.maxOnboardingSampleCount) return { valid: false, issue: "SAMPLE_COUNT_TOO_HIGH" };

  return { valid: true, preferences, confidence, sampleCount };
}

const CREATIVE_PROFILE_ERROR_MESSAGES = {
  UNAUTHORIZED: "Sessão inválida. Faça login novamente.",
  PRO_ADS_REQUIRED: "Anúncios Pro requer o plano Premium.",
  INVALID_INPUT: "Confira os dados enviados e tente novamente.",
  ENTITLEMENT_CHECK_FAILED: "Não foi possível verificar seu plano. Tente novamente.",
  PROFILE_LOAD_FAILED: "Não foi possível carregar seu perfil criativo agora.",
  PROFILE_SAVE_FAILED: "Não foi possível salvar seu perfil criativo agora.",
  PROFILE_RESET_FAILED: "Não foi possível redefinir seu perfil criativo agora.",
} as const;

type CreativeProfileErrorCode = keyof typeof CREATIVE_PROFILE_ERROR_MESSAGES;

function sendCreativeProfileError(res: Response, status: number, code: CreativeProfileErrorCode): void {
  res.status(status).json({ code, message: CREATIVE_PROFILE_ERROR_MESSAGES[code] });
}

function creativeProfileRef(db: FirebaseFirestore.Firestore, uid: string) {
  return db.collection("users").doc(uid).collection("marketingProfile").doc("creative");
}

export function registerCreativeProfileRoutes(
  app: Express,
  requireAuth: (req: Request, res: Response, next: NextFunction) => void,
): void {
  app.get("/api/marketing/pro/creative-profile", requireAuth, requireProAdsEntitlement, async (req: Request, res: Response) => {
    const uid = (req as any).firebaseUid as string;
    try {
      const admin = getFirebaseAdmin();
      const db = admin.firestore();
      const snap = await creativeProfileRef(db, uid).get();
      if (!snap.exists) {
        res.status(200).json({ profile: null });
        return;
      }
      const data = snap.data();
      const validation = validateSellerCreativeProfile(data);
      if (!validation.valid) {
        // Documento corrompido/de uma versão futura incompatível — nunca devolve um objeto inválido
        // pro client tratar como se fosse um SellerCreativeProfile de verdade.
        logError("marketing_pro.creative_profile_corrupted", validation.errors.join(", "), { requestId: req.requestId });
        res.status(200).json({ profile: null });
        return;
      }
      res.status(200).json({ profile: data as SellerCreativeProfile });
    } catch (error) {
      logError("marketing_pro.creative_profile_load_failed", error, { requestId: req.requestId });
      sendCreativeProfileError(res, 500, "PROFILE_LOAD_FAILED");
    }
  });

  app.post("/api/marketing/pro/creative-profile", requireAuth, requireProAdsEntitlement, async (req: Request, res: Response) => {
    const uid = (req as any).firebaseUid as string;
    const validation = validateCreativeProfileSavePayload(req.body);
    if (!validation.valid) {
      logWarn("marketing_pro.creative_profile_invalid_input", { requestId: req.requestId, issue: validation.issue });
      sendCreativeProfileError(res, 400, "INVALID_INPUT");
      return;
    }
    try {
      const admin = getFirebaseAdmin();
      const db = admin.firestore();
      // version/categoryPreferences/updatedAt NUNCA vêm do client — sempre o valor canônico do servidor
      // (§6/§13: onboarding nunca escreve categoryPreferences; updatedAt é sempre o relógio do servidor,
      // nunca confiável vindo do client).
      const profile: SellerCreativeProfile = {
        version: CREATIVE_INTELLIGENCE_CONTRACT_VERSION,
        globalPreferences: validation.preferences,
        confidence: validation.confidence,
        sampleCount: validation.sampleCount,
        updatedAt: new Date().toISOString(),
      };
      await creativeProfileRef(db, uid).set(profile);
      logInfo("marketing_pro.creative_profile_saved", { requestId: req.requestId, sampleCount: validation.sampleCount });
      res.status(200).json({ profile });
    } catch (error) {
      logError("marketing_pro.creative_profile_save_failed", error, { requestId: req.requestId });
      sendCreativeProfileError(res, 500, "PROFILE_SAVE_FAILED");
    }
  });

  // RESET (§4/§10): endpoint existe para apagar o perfil por completo, mas o cliente do onboarding NUNCA
  // o chama automaticamente ao "refazer" — refazer só reabre o wizard; o perfil anterior só é substituído
  // quando o novo é efetivamente concluído e salvo via POST (§10: "não apagar perfil server-side até
  // conclusão; se usuário cancelar, perfil anterior permanece").
  app.delete("/api/marketing/pro/creative-profile", requireAuth, requireProAdsEntitlement, async (req: Request, res: Response) => {
    const uid = (req as any).firebaseUid as string;
    try {
      const admin = getFirebaseAdmin();
      const db = admin.firestore();
      await creativeProfileRef(db, uid).delete();
      logInfo("marketing_pro.creative_profile_reset", { requestId: req.requestId });
      res.status(200).json({ deleted: true });
    } catch (error) {
      logError("marketing_pro.creative_profile_reset_failed", error, { requestId: req.requestId });
      sendCreativeProfileError(res, 500, "PROFILE_RESET_FAILED");
    }
  });
}
