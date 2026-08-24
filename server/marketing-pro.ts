/**
 * RevendaSmart — Anúncios Pro backend contract (PRO-06A)
 *
 * Primeiro backend do Anúncios Pro. Prova o caminho completo:
 *
 *   cliente autenticado -> entitlement server-side -> generationRequestId idempotente
 *   -> documento autoritativo -> provider mock -> estado final persistido -> GET seguro.
 *
 * Deliberadamente FORA desta sprint: provider real, custo, crédito, Storage de arte, Cloud Tasks,
 * composição server-side. Ver os comentários "PRO-06B" abaixo para cada fronteira deixada pronta.
 *
 * Este módulo NÃO importa nada de client/src/ — zero dependência do backend na árvore do frontend.
 * O style/format que ele precisa validar vem de shared/marketing-pro-contract.ts, o subconjunto do
 * contrato do PRO-04 que é genuinamente compartilhável (sem DOM, sem React, sem browser API). O
 * resto do PRO-04 (presets, art direction, compositor) continua só no client, sem consumidor aqui.
 */

import type { Express, NextFunction, Request, Response } from "express";
import { getFirebaseAdmin } from "./firebase-admin-init";
import { logError, logInfo, logWarn } from "./logger";
import { isAdminUid } from "./admin-auth";
import { PLANS, canUseFeature, isPremiumActive, type PlanData, type PlanType } from "../shared/monetization";
import {
  MARKETING_PRO_FIELD_LIMITS,
  MARKETING_PRO_PRODUCT_ZONE,
  MARKETING_PRO_TEXT_ZONE,
  isMarketingProFormat,
  isMarketingProStyle,
  resolveMarketingProProductPlacement,
  resolveMarketingProCategory,
  type MarketingProFormat,
  type MarketingProStyle,
} from "../shared/marketing-pro-contract";
import {
  buildMarketingProBackgroundSpecFromConceptSelection,
  buildMarketingProProviderArtDirection,
  resolveMarketingProStyleForCreativeFamily,
} from "../shared/marketing-pro-art-direction";
import { isCreativeFamily, type CreativeFamily, type ProductTruth } from "../shared/marketing-pro-creative-intelligence";
import { buildProductUnderstandingFallback } from "../shared/marketing-pro-product-understanding";
import { PRODUCT_UNDERSTANDING_CACHE_COLLECTION, createRuntimeProductVisualAnalyzer, loadStorageImage, resolveOwnedProductImageSource, resolveProductUnderstanding } from "./marketing-pro-product-understanding";
import { isMarketingProProductUnderstandingEnabled } from "./marketing-pro-flags";
import { buildApprovedProductCutoutStoragePath, validateApprovedProductCutoutShape, type ApprovedProductCutout } from "../shared/approved-product-cutout";
import {
  createDeterministicMockProvider,
  type MarketingImageProvider,
  type MarketingProBackgroundInput,
  type MarketingProBackgroundResult,
  type MarketingProProviderErrorCode,
} from "./marketing-pro-provider";
import { evaluateMarketingProOutputQuality, type MarketingProQualityRejectionCode } from "./marketing-pro-quality";
import {
  readMarketingProCostLedgerState,
  decideMarketingProCostReservation,
  resolveMarketingProBackgroundBudgetUsd,
  MARKETING_PRO_BACKGROUND_LEDGER_COLLECTION,
  MARKETING_PRO_BACKGROUND_LEDGER_DOC_ID,
  MARKETING_PRO_OPERATION_CONSERVATIVE_COST_USD,
  MARKETING_PRO_SEMANTIC_INSPECTION_CONSERVATIVE_COST_USD,
} from "./marketing-pro-cost-guard";
import { persistMarketingProBackgroundAsset } from "./marketing-pro-background-persistence";
import type { MarketingProBackgroundAsset } from "../shared/approved-marketing-pro-background";
import {
  buildMarketingProRateLimitPlan,
  decideMarketingProRateLimitWindow,
  readWindowStateFromDocData,
  minuteBucketId,
  dayBucketId,
  MARKETING_PRO_RATE_LIMIT_COLLECTION,
  resolveMarketingProRateLimitPerMinute,
  resolveMarketingProRateLimitPerDay,
} from "./marketing-pro-rate-limit-firestore";
import {
  buildMarketingProUsageReservationWrite,
  markMarketingProUsageDispatched,
  markMarketingProUsageCommitted,
  markMarketingProUsagePotentiallyBilled,
  usdToMicroUsd,
  MARKETING_PRO_USAGE_COLLECTION,
} from "./marketing-pro-usage-ledger";
import { evaluateMarketingProSafeZoneGate } from "./marketing-pro-safe-zone-gate";
import { quarantineMarketingProSafeZoneRejectedBackground } from "./marketing-pro-safe-zone-debug";
import { evaluateMarketingProSemanticGateCached } from "./marketing-pro-semantic-gate";
import { MARKETING_PRO_SEMANTIC_MODEL, type MarketingProSemanticInspector } from "./marketing-pro-semantic-inspector-google";

// --- Contrato de ID: generationId === generationRequestId ---
//
// A auditoria apontou que criar dois identificadores (um vindo do cliente para idempotência, outro
// gerado pelo servidor como chave pública) seria complexidade sem necessidade nesta sprint: o cliente
// já PRECISA guardar o ID para fazer polling via GET, então usar o mesmo valor como chave do
// documento Firestore e como identificador público elimina uma tradução inteira sem perder nada.
//
// DIFERENÇA DELIBERADA do padrão de `saleId` em `sales/finalize`: lá o servidor tem um fallback
// `crypto.randomUUID()` porque o `saleId` é conveniência, não idempotência ativa por si — a venda tem
// outras defesas (transação + checagem de estoque). Aqui a idempotência É o mecanismo central: um
// fallback gerado no servidor faria um retry do MESMO clique do usuário (sem o cliente ainda saber
// que já tinha enviado) ganhar um ID diferente a cada vez, e o retry deixaria de ser idempotente. Por
// isso `generationRequestId` é OBRIGATÓRIO vindo do cliente — sem fallback.
export const MARKETING_PRO_GENERATION_ID_PATTERN = /^[a-zA-Z0-9_-]{6,80}$/;

export function isValidMarketingProGenerationId(value: unknown): value is string {
  return typeof value === "string" && MARKETING_PRO_GENERATION_ID_PATTERN.test(value);
}

// --- State machine do BACKEND — NÃO é a mesma do PRO-04 (client) ---
//
// O PRO-04 (client/src/lib/marketing-pro.ts) tem `idle|preparing|generating|compositing|ready|failed
// |cancelled`: estados de UX local, sem rede. Esta é a máquina do documento PERSISTIDO, mais simples
// de propósito — "cancelled" não existe aqui porque nesta sprint a execução é síncrona dentro da
// própria request (ver `runMarketingProGeneration`), então não há janela para o cliente cancelar uma
// geração em voo.
export type MarketingProBackendStatus = "accepted" | "processing" | "ready" | "failed";

const BACKEND_STATE_TRANSITIONS: Record<MarketingProBackendStatus, readonly MarketingProBackendStatus[]> = {
  accepted: ["processing"],
  processing: ["ready", "failed"],
  ready: [],
  failed: [],
};

export function canTransitionMarketingProBackendStatus(
  from: MarketingProBackendStatus,
  to: MarketingProBackendStatus,
): boolean {
  return BACKEND_STATE_TRANSITIONS[from].includes(to);
}

/**
 * Um documento pode falhar por três motivos de natureza diferente: o produto não existe (entrada
 * server-side inválida, ver §3/§4 do PRO-06B0.1 — resolvida ANTES de qualquer chamada ao provider), o
 * provider falhou tecnicamente (`MarketingProProviderErrorCode`), ou o provider respondeu "pronto" mas
 * a saída não passou no quality gate (`MarketingProQualityRejectionCode`, ver marketing-pro-quality.ts).
 * O documento não distingue estrutura entre os três — só registra QUAL código, de qualquer uma das
 * fontes.
 */
export type MarketingProGenerationErrorCode =
  | MarketingProProviderErrorCode
  | MarketingProQualityRejectionCode
  | "PRODUCT_NOT_FOUND"
  | "BUDGET_EXCEEDED"
  | "SAFE_ZONE_REJECTED"
  | "SEMANTIC_GATE_UNAVAILABLE"
  | "SEMANTIC_CONTENT_REJECTED"
  | "SEMANTIC_INVALID_OUTPUT"
  | "SEMANTIC_TIMEOUT"
  | "APPROVED_CUTOUT_REQUIRED";

// --- Documento persistido — schema mínimo (§6, PRO-06A) + attemptCount (§6, PRO-06B0) ---
//
// Deliberadamente SEM: crédito, provider real, prompt, token, base64, imagem, output URL, PII,
// preço, CTA, storeName. `productId` é uma referência opaca (mesmo id que o catálogo já usa), não
// dado comercial em si.
//
// `attemptCount`: PREPARA o schema para retry interno futuro (PRO-06B0 §6/§7) sem implementá-lo.
// Nesta sprint é SEMPRE 1 — não existe laço de retry ainda. É contagem de TENTATIVA INTERNA do MESMO
// generationId (mesmo provider, mesma intenção do usuário), nunca de "geração pedida de novo pelo
// usuário" (isso é sempre um generationRequestId novo, e portanto um documento novo) nem de crédito
// (consumo é decisão comercial futura e separada, ver §18 do enunciado desta sprint).
export interface MarketingProGenerationDoc {
  readonly generationId: string;
  readonly status: MarketingProBackendStatus;
  readonly style: MarketingProStyle;
  readonly format: MarketingProFormat;
  readonly productId: string;
  readonly creativeConceptId?: string;
  readonly creativeFamily?: CreativeFamily;
  /** Inteiro positivo, autoridade do backend. Documento legado sem o campo é lido como 1 (ver toGenerationDto). */
  readonly attemptCount?: number;
  readonly createdAt: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp;
  readonly updatedAt: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp;
  readonly errorCode?: MarketingProGenerationErrorCode;
  /** PRO-08: só presente quando um provider REAL gerou e persistiu um background com sucesso. */
  readonly background?: MarketingProBackgroundAsset;
}

/** DTO público devolvido ao cliente — mesmos campos do documento, nada interno a mais. */
export interface MarketingProGenerationDto {
  readonly generationId: string;
  readonly status: MarketingProBackendStatus;
  readonly style: MarketingProStyle;
  readonly format: MarketingProFormat;
  readonly productId: string;
  readonly creativeConceptId?: string;
  readonly creativeFamily?: CreativeFamily;
  readonly attemptCount: number;
  readonly errorCode?: MarketingProGenerationErrorCode;
  readonly background?: MarketingProBackgroundAsset;
}

/** Default lógico de leitura: 1. Documentos escritos antes deste campo existir continuam válidos. */
export const MARKETING_PRO_DEFAULT_ATTEMPT_COUNT = 1;

/**
 * Normalização defensiva — PRO-06B0.1 §15. Antes, `toGenerationDto` só tratava `undefined`/`null`
 * (`?? DEFAULT`); um documento corrompido externamente com `attemptCount: 0`, negativo, `NaN`,
 * `Infinity`, decimal ou string passava direto para o cliente sem correção, apesar do comentário do
 * campo dizer "inteiro positivo". Esta função é a única fonte de verdade de "o que é um attemptCount
 * válido" — qualquer coisa que não seja um inteiro positivo vira o default, nunca é repassada como está.
 */
export function normalizeMarketingProAttemptCount(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : MARKETING_PRO_DEFAULT_ATTEMPT_COUNT;
}

/** Exportada para ser testável diretamente com um documento legado (sem attemptCount), sem Firestore. */
export function toGenerationDto(doc: MarketingProGenerationDoc): MarketingProGenerationDto {
  return {
    generationId: doc.generationId,
    status: doc.status,
    style: doc.style,
    format: doc.format,
    productId: doc.productId,
    ...(doc.creativeConceptId ? { creativeConceptId: doc.creativeConceptId } : {}),
    ...(doc.creativeFamily ? { creativeFamily: doc.creativeFamily } : {}),
    attemptCount: normalizeMarketingProAttemptCount(doc.attemptCount),
    ...(doc.errorCode ? { errorCode: doc.errorCode } : {}),
    ...(doc.background ? { background: doc.background } : {}),
  };
}

// --- Validação de input (§7) ---
//
// Só o mínimo que o provider mock precisa: style e format, validados pelo ALLOWLIST que o PRO-04 já
// define (isMarketingProStyle/isMarketingProFormat) — reaproveitado, não reimplementado. `productId`
// é uma referência opaca do catálogo: valida forma (string não vazia, dentro do limite que o próprio
// PRO-04 já declara em MARKETING_PRO_FIELD_LIMITS), não significado.
//
// NÃO aceita MarketingProInput inteiro do frontend — nome do produto, preço, CTA, descrição e loja
// não têm lugar aqui porque o provider mock não os usa e o backend não é autoridade sobre eles (quem
// é, é o overlay comercial determinístico do próprio app).
export interface MarketingProGenerateRequestBody {
  readonly generationRequestId: unknown;
  readonly productId: unknown;
  readonly style: unknown;
  readonly format: unknown;
  readonly creativeConceptId?: unknown;
  readonly creativeFamily?: unknown;
}

export const MARKETING_PRO_CONCEPT_ID_PATTERN = /^[a-zA-Z0-9:_-]{1,120}$/;

export type MarketingProInputValidation =
  | { readonly valid: true; readonly generationId: string; readonly productId: string; readonly style: MarketingProStyle; readonly format: MarketingProFormat; readonly creativeConceptId?: string; readonly creativeFamily?: CreativeFamily }
  | { readonly valid: false; readonly issue: string };

export function validateMarketingProGenerateInput(body: MarketingProGenerateRequestBody): MarketingProInputValidation {
  if (!isValidMarketingProGenerationId(body.generationRequestId)) {
    return { valid: false, issue: "generationRequestId" };
  }
  const productId = typeof body.productId === "string" ? body.productId.trim() : "";
  if (!productId || productId.length > MARKETING_PRO_FIELD_LIMITS.productId) {
    return { valid: false, issue: "productId" };
  }
  if (!isMarketingProFormat(body.format)) {
    return { valid: false, issue: "format" };
  }
  const hasConcept = body.creativeConceptId !== undefined || body.creativeFamily !== undefined;
  if (hasConcept) {
    if (typeof body.creativeConceptId !== "string" || !MARKETING_PRO_CONCEPT_ID_PATTERN.test(body.creativeConceptId) || !isCreativeFamily(body.creativeFamily)) {
      return { valid: false, issue: "creativeConcept" };
    }
    return {
      valid: true,
      generationId: body.generationRequestId,
      productId,
      style: resolveMarketingProStyleForCreativeFamily(body.creativeFamily),
      format: body.format,
      creativeConceptId: body.creativeConceptId,
      creativeFamily: body.creativeFamily,
    };
  }
  if (!isMarketingProStyle(body.style)) return { valid: false, issue: "style" };
  return { valid: true, generationId: body.generationRequestId, productId, style: body.style, format: body.format };
}

// --- Decisão de idempotência — função PURA, sem Firestore (testável isoladamente) ---
//
// A atomicidade real vem de `runTransaction` (mesmo primitivo que `sales/finalize` já usa e este
// projeto já confia). Esta função só decide O QUE FAZER dado o que a transação leu: se o documento já
// existe, a resposta é o estado existente e o provider NUNCA é chamado — não importa se é a primeira
// releitura de um request concorrente perdedor ou um retry legítimo do cliente. Só quando o documento
// não existe é que uma nova geração é criada.
//
// CORREÇÃO OBRIGATÓRIA aplicada: um generationId que já terminou em "failed" NÃO reabre. O retorno é
// sempre o estado existente tal como está — reabrir exigiria decidir "isso é uma nova tentativa
// legítima ou um estado interno inconsistente?", e essa ambiguidade é exatamente o que a idempotência
// simples deveria evitar. Nova tentativa = novo generationRequestId, decisão do cliente.
export type MarketingProGenerationDecision =
  | { readonly action: "return-existing"; readonly doc: MarketingProGenerationDoc }
  | { readonly action: "create-new" };

export function decideMarketingProGenerationOutcome(existing: MarketingProGenerationDoc | null): MarketingProGenerationDecision {
  if (existing) return { action: "return-existing", doc: existing };
  return { action: "create-new" };
}

// --- Rate limit — instanciado isolado, não reutilizando mpConnectionRateLimit diretamente ---
//
// `mpConnectionRateLimit` (mercadopago-connections.ts) é uma factory de MIDDLEWARE: roda antes do
// handler, sem saber se a requisição vai bater num "já existe" idempotente. Aplicá-la como middleware
// aqui contaria RETRY de um generationRequestId já criado como uso novo de cota — exatamente o que a
// auditoria proibiu (§15 P0). Por isso este limitador é uma função simples chamada DENTRO do handler,
// só no branch "create-new", no mesmo padrão de Map-em-memória (sem Redis), mas sem forçar reuso que
// exigiria gambiarra na ordem de execução.
//
// LIMITE POR INSTÂNCIA, NÃO GLOBAL: este Map vive na memória de UM processo. Cloud Run pode escalar
// horizontalmente (múltiplas instâncias em paralelo, cada requisição roteada para uma delas), e cada
// instância tem o seu próprio Map — um UID cujas requisições caem em instâncias diferentes pode
// ultrapassar o limite nominal.
// Isto é proteção best-effort contra abuso trivial de UMA instância, não uma quota/autorização
// confiável em produção. Uma contagem realmente global exigiria estado compartilhado (Redis, contador
// no Firestore) — não construído aqui de propósito: é exatamente a complexidade que esta sprint evita
// (ver auditoria PRO-05, §22 "o que não precisa ser criado agora"). Fica para quando o volume real
// justificar.
// PRO-09 §10: este Map por-instância deixou de ser a AUTORIDADE de enforcement da rota real — substituído
// por `marketing-pro-rate-limit-firestore.ts` (distribuído, dentro da mesma transação de idempotência).
// A função abaixo continua exportada e testada isoladamente (não é dead code — é o limitador best-effort
// documentado desde o PRO-06A, mantido por se ainda ter valor como defesa extra de UMA instância antes
// mesmo de abrir uma transação Firestore); só não é mais chamada por `registerMarketingProRoutes`.
const MARKETING_PRO_RATE_LIMIT_WINDOW_MS = 60_000;
const MARKETING_PRO_RATE_LIMIT_MAX_KEYS = 10_000;
/** Config inicial conservadora, não regra comercial definitiva — ajustar quando houver uso real. */
export const MARKETING_PRO_DEFAULT_MAX_NEW_GENERATIONS_PER_MINUTE = 5;
const marketingProRateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function checkMarketingProNewGenerationRateLimit(uid: string, max: number, nowMs: number = Date.now()): boolean {
  const current = marketingProRateLimitMap.get(uid);
  if (!current || nowMs > current.resetAt) {
    if (marketingProRateLimitMap.size >= MARKETING_PRO_RATE_LIMIT_MAX_KEYS) {
      for (const [key, entry] of Array.from(marketingProRateLimitMap.entries())) {
        if (nowMs > entry.resetAt) marketingProRateLimitMap.delete(key);
      }
    }
    marketingProRateLimitMap.set(uid, { count: 1, resetAt: nowMs + MARKETING_PRO_RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (current.count >= max) return false;
  current.count += 1;
  return true;
}

/** Exposto só para os testes limparem o estado do Map entre casos — não é API de produto. */
export function resetMarketingProRateLimitStateForTests(): void {
  marketingProRateLimitMap.clear();
}

// --- Erro estruturado — equivalente local a errorResponse(), que é privada em server/routes.ts ---
const MARKETING_PRO_ERROR_MESSAGES = {
  UNAUTHORIZED: "Sessão inválida. Faça login novamente.",
  PRO_ADS_REQUIRED: "Anúncios Pro requer o plano Premium.",
  INVALID_INPUT: "Confira os dados enviados e tente novamente.",
  GENERATION_NOT_FOUND: "Geração não encontrada.",
  GENERATION_FAILED: "Não foi possível concluir a geração.",
  RATE_LIMITED: "Muitas gerações em pouco tempo. Aguarde um momento.",
  ENTITLEMENT_CHECK_FAILED: "Não foi possível verificar seu plano. Tente novamente.",
  PRODUCT_NOT_FOUND: "Produto não encontrado.",
  BUDGET_EXCEEDED: "O gerador de fundos com IA está indisponível no momento. Tente novamente mais tarde.",
  BUDGET_STATE_CORRUPTED: "O gerador de fundos com IA está indisponível no momento. Tente novamente mais tarde.",
  APPROVED_CUTOUT_REQUIRED: "Prepare o recorte do produto antes de gerar o anúncio.",
} as const;

export type MarketingProErrorCode = keyof typeof MARKETING_PRO_ERROR_MESSAGES;

function sendMarketingProError(res: Response, status: number, code: MarketingProErrorCode): void {
  res.status(status).json({ code, message: MARKETING_PRO_ERROR_MESSAGES[code] });
}

// --- Entitlement server-side (§5) — backend é a autoridade, PlanProvider do client não é ---
//
// Fonte de verdade: users/{uid}/planData/main, lido via Admin SDK — o MESMO documento que
// GET /api/plan/data/:userId já lê, e os MESMOS helpers do contrato central
// (isPremiumActive + canUseFeature(plan, "proAds")) que o PRO-01 já definiu. Nenhum "if (premium)"
// solto: a decisão inteira passa pelo contrato compartilhado.
//
// LIMITAÇÃO DOCUMENTADA: o runtime atual só distingue "free" e "premium" (PlanType não tem "pro").
// Não é possível hoje diferenciar server-side um plano "Pro" de um "Premium" porque esse terceiro
// plano não existe em lugar nenhum do runtime — só no vocabulário de produto. Por isso o gate aqui é
// canUseFeature(plan, "proAds"), que hoje resolve para: free -> nega, premium -> permite. É a MESMA
// ponte que o PRO-01 já validou para a UI; nenhum plano foi inventado a partir de dado inexistente.
/**
 * Decisão pura de entitlement — separada do middleware para ser testável sem mockar Firestore.
 * É exatamente o que o PRO-01 já validou para a UI (isPremiumActive + canUseFeature(..., "proAds")),
 * só que aqui é o BACKEND quem decide, a partir do planData lido por Admin SDK.
 */
export function resolveMarketingProEntitlement(planData: PlanData | null): { readonly allowed: boolean; readonly plan: PlanType } {
  const plan: PlanType = isPremiumActive(planData) ? PLANS.PREMIUM : PLANS.FREE;
  return { allowed: canUseFeature(plan, "proAds"), plan };
}

/** Exportado (PRO-10B) para o Perfil Criativo (`server/marketing-pro-creative-profile.ts`) reaproveitar
 * a MESMA checagem — nunca uma segunda implementação divergente de "o que é Premium para Anúncios Pro".
 *
 * RELEASE V1 §4.2: Anúncios Pro ainda está em desenvolvimento — nesta release, NENHUM plano comercial
 * (nem Premium) libera acesso, só admin/dev autorizado (mesma custom claim `admin` de
 * `server/admin-auth.ts`, reaproveitada — nenhum mecanismo novo). A checagem de plano Premium abaixo
 * continua intacta (não apagada) porque é a autoridade que volta a valer quando Anúncios Pro sair do
 * modo experimental — só precisa remover o gate de admin daqui embaixo nesse dia. */
export async function requireProAdsEntitlement(req: Request, res: Response, next: NextFunction): Promise<void> {
  const uid = (req as any).firebaseUid as string;
  try {
    // §4.2: admin/dev tem acesso de teste independente de plano comercial — não é um benefício Premium,
    // é uma permissão de desenvolvimento. Continua computando o entitlement de plano (nunca removido)
    // só para o log de auditoria; ele NUNCA é a autoridade sozinho enquanto Anúncios Pro é admin-only.
    const isAdmin = await isAdminUid(uid);
    if (isAdmin) {
      next();
      return;
    }

    const admin = getFirebaseAdmin();
    const db = admin.firestore();
    const snapshot = await db.collection("users").doc(uid).collection("planData").doc("main").get();
    const planData = snapshot.exists ? (snapshot.data() as PlanData) : null;
    const entitlement = resolveMarketingProEntitlement(planData);
    logWarn("marketing_pro.entitlement_denied", { requestId: req.requestId, reason: "admin_only_in_v1", plan: entitlement.plan });
    sendMarketingProError(res, 403, "PRO_ADS_REQUIRED");
  } catch (error) {
    logError("marketing_pro.entitlement_check_failed", error, { requestId: req.requestId });
    sendMarketingProError(res, 500, "ENTITLEMENT_CHECK_FAILED");
  }
}

// --- Execução do provider (§13) ---
//
// PRODUÇÃO com provider lento NÃO deve usar 202 + void generateAsync(): perde o resultado se o
// processo Cloud Run reciclar no meio (ver auditoria PRO-05, cenário 7 de queda de processo).
// PRO-06B decidirá entre request síncrono com timeout maior ou Cloud Tasks; aqui a chamada é
// aguardada dentro da própria request, com um teto de tempo defensivo mesmo sendo mock.
export const MARKETING_PRO_DEFAULT_PROVIDER_TIMEOUT_MS = 25_000;

export async function runProviderWithTimeout(
  provider: MarketingImageProvider,
  input: MarketingProBackgroundInput,
  timeoutMs: number,
): Promise<MarketingProBackgroundResult> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<{ status: "failed"; errorCode: "GENERATION_TIMEOUT" }>((resolve) => {
    timer = setTimeout(() => resolve({ status: "failed", errorCode: "GENERATION_TIMEOUT" }), timeoutMs);
  });
  try {
    return await Promise.race([provider.generateBackground(input), timeout]);
  } catch {
    return { status: "failed", errorCode: "GENERATION_FAILED" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Decisão final — P0 extraído como função pura (PRO-06B0.1 §12/§13, achado P1-4 da auditoria). Antes,
 * esta lógica estava inline no handler Express e só era provada por regex sobre o texto do arquivo,
 * nunca chamando a decisão de verdade com um `{result, quality}` construído. Agora é uma função
 * testável isoladamente, no mesmo espírito de `decideMarketingProGenerationOutcome`.
 *
 * Regras (nenhum outro caminho retorna "ready"):
 *   provider failed                       -> failed
 *   provider success + quality reprovado  -> failed
 *   provider success + quality aprovado   -> ready
 */
export interface MarketingProGenerationFinalState {
  readonly status: "ready" | "failed";
  readonly errorCode?: MarketingProGenerationErrorCode;
}

export function resolveMarketingProGenerationFinalState(
  result: MarketingProBackgroundResult,
  format: MarketingProFormat,
): MarketingProGenerationFinalState {
  if (result.status === "failed") {
    return { status: "failed", errorCode: result.errorCode };
  }
  const quality = evaluateMarketingProOutputQuality(result.output, format);
  if (quality.accepted) {
    return { status: "ready" };
  }
  return { status: "failed", errorCode: quality.rejectionCode };
}

export interface RegisterMarketingProRoutesOptions {
  /** Injeção de provider para testes (success/failure/timeout controlados, sem rede real). */
  readonly provider?: MarketingImageProvider;
  readonly providerTimeoutMs?: number;
  /**
   * PRO-09: superseded pelo rate limit distribuído (`marketing-pro-rate-limit-firestore.ts`,
   * `MARKETING_PRO_RATE_LIMIT_PER_MINUTE`/`_PER_DAY`), dentro da mesma transação de idempotência —
   * não configurável mais por esta opção. Mantida como campo aceito (nunca lançar em runtime por uma
   * opção antiga) mas sem efeito nenhum; ver `checkMarketingProNewGenerationRateLimit` para o limitador
   * legado que ainda existe, testado, mas não é mais chamado pela rota.
   */
  readonly maxNewGenerationsPerMinute?: number;
  /**
   * PRO-08: true só quando `provider` é um provider REAL (nunca o mock) — liga a reserva de custo
   * (hard stop, `server/marketing-pro-cost-guard.ts`) ANTES de chamar o provider, e a persistência do
   * background gerado depois. O mock nunca custa nada de verdade e nunca produz `asset` bytes — passar
   * `true` com o mock não quebra nada (a reserva só consome orçamento à toa), mas quem registra as rotas
   * (`server/routes.ts`) é responsável por só ligar isto junto com um provider real de verdade.
   */
  readonly requireCostReservation?: boolean;
  /** Inspetor injetável: em produção recebe apenas os bytes do background; em testes evita rede real. */
  readonly semanticInspector?: MarketingProSemanticInspector;
}

export function registerMarketingProRoutes(
  app: Express,
  requireAuth: (req: Request, res: Response, next: NextFunction) => void,
  options: RegisterMarketingProRoutesOptions = {},
): void {
  const provider = options.provider ?? createDeterministicMockProvider();
  const providerTimeoutMs = options.providerTimeoutMs ?? MARKETING_PRO_DEFAULT_PROVIDER_TIMEOUT_MS;
  const requireCostReservation = options.requireCostReservation ?? false;

  app.get("/api/marketing/pro/capability", requireAuth, requireProAdsEntitlement, async (_req: Request, res: Response) => {
    res.status(200).json({
      realBackgroundAvailable: requireCostReservation,
      semanticGateReady: true,
      provider: requireCostReservation ? provider.id ?? "unknown" : "mock",
      model: requireCostReservation ? provider.model ?? "unknown" : null,
    });
  });

  app.post("/api/marketing/pro/generate", requireAuth, requireProAdsEntitlement, async (req: Request, res: Response) => {
    // uid vem SOMENTE do token — nunca de body/query/params. Sem requireOwnership: não há :userId
    // na URL para comparar, o escopo já é o token.
    const uid = (req as any).firebaseUid as string;
    const body = (req.body ?? {}) as MarketingProGenerateRequestBody;
    const validation = validateMarketingProGenerateInput(body);
    if (!validation.valid) {
      logWarn("marketing_pro.invalid_input", { requestId: req.requestId, issue: validation.issue });
      sendMarketingProError(res, 400, "INVALID_INPUT");
      return;
    }
    const { generationId, productId, style, format, creativeConceptId, creativeFamily } = validation;

    try {
      const admin = getFirebaseAdmin();
      const db = admin.firestore();
      const generationRef = db.collection("users").doc(uid).collection("marketingProGenerations").doc(generationId);

      const existingGenerationSnap = await generationRef.get();
      if (existingGenerationSnap.exists) {
        const existingDoc = existingGenerationSnap.data() as MarketingProGenerationDoc;
        logInfo("marketing_pro.request_accepted", { requestId: req.requestId, generationId, status: existingDoc.status, replay: true });
        res.status(200).json(toGenerationDto(existingDoc));
        return;
      }

      // Produto/cutout são pré-dispatch: validar antes de rate-limit/budget/usage evita reserva presa
      // quando a operação nunca poderia chamar provider.
      const productSnap = await db.collection("users").doc(uid).collection("products").doc(productId).get();
      if (!productSnap.exists) {
        logWarn("marketing_pro.product_not_found", { requestId: req.requestId, generationId });
        sendMarketingProError(res, 404, "PRODUCT_NOT_FOUND");
        return;
      }
      const productData = productSnap.data() as Record<string, unknown>;
      const category = resolveMarketingProCategory(productData.category);
      let approvedCutout: ApprovedProductCutout | undefined;
      if (creativeConceptId && creativeFamily) {
        const cutoutValidation = validateApprovedProductCutoutShape(productData.approvedCutout);
        const candidate = productData.approvedCutout as ApprovedProductCutout | undefined;
        const ownsCanonicalAsset = cutoutValidation.accepted && candidate?.storagePath === buildApprovedProductCutoutStoragePath(uid, productId);
        if (!ownsCanonicalAsset || !candidate) {
          sendMarketingProError(res, 409, "APPROVED_CUTOUT_REQUIRED");
          return;
        }
        approvedCutout = candidate;
      }

      // PRO-09 §10: rate limit distribuído — dois documentos por uid (`minute_<bucket>`/`day_<date>`,
      // `users/{uid}/marketingProRateLimits/...`). PRO-09 §9: budget agregado + usage record por operação
      // (`marketingProUsage/{operationId}`, só quando `requireCostReservation`, ou seja, provider real).
      // TUDO isto entra na MESMA transação da idempotência (§10, "idealmente"): idempotência, rate limit,
      // reserva de orçamento e criação do usage record são decididos e escritos atomicamente — nenhuma
      // combinação de requests concorrentes consegue ultrapassar rate limit/orçamento por uma corrida
      // entre transações separadas. Firestore exige TODAS as leituras antes de QUALQUER escrita dentro de
      // uma transação — por isso a função abaixo lê tudo primeiro, decide, e só then escreve.
      const nowMs = Date.now();
      const rateLimitPlan = buildMarketingProRateLimitPlan(uid, nowMs);
      const minuteRef = db.collection("users").doc(uid).collection(MARKETING_PRO_RATE_LIMIT_COLLECTION).doc(minuteBucketId(nowMs));
      const dayRef = db.collection("users").doc(uid).collection(MARKETING_PRO_RATE_LIMIT_COLLECTION).doc(dayBucketId(nowMs));
      const budgetLedgerRef = db.collection(MARKETING_PRO_BACKGROUND_LEDGER_COLLECTION).doc(MARKETING_PRO_BACKGROUND_LEDGER_DOC_ID);
      const usageRef = db.collection(MARKETING_PRO_USAGE_COLLECTION).doc(generationId);

      type TransactionOutcome =
        | { readonly action: "return-existing"; readonly doc: MarketingProGenerationDoc }
        | { readonly action: "create-new" }
        | { readonly action: "rate-limited"; readonly window: "minute" | "day" }
        | { readonly action: "budget-corrupted" }
        | { readonly action: "budget-exceeded" };

      const outcome = await db.runTransaction(async (tx): Promise<TransactionOutcome> => {
        // --- LEITURAS (todas antes de qualquer escrita) ---
        const generationSnap = await tx.get(generationRef);
        const existing = generationSnap.exists ? (generationSnap.data() as MarketingProGenerationDoc) : null;
        const decision = decideMarketingProGenerationOutcome(existing);
        if (decision.action === "return-existing") {
          return { action: "return-existing", doc: decision.doc };
        }

        const minuteSnap = await tx.get(minuteRef);
        const daySnap = await tx.get(dayRef);
        const minuteState = readWindowStateFromDocData(minuteSnap.exists ? (minuteSnap.data() as Record<string, unknown>) : null);
        const dayState = readWindowStateFromDocData(daySnap.exists ? (daySnap.data() as Record<string, unknown>) : null);
        const minuteDecision = decideMarketingProRateLimitWindow(minuteState, resolveMarketingProRateLimitPerMinute());
        if (!minuteDecision.allowed) return { action: "rate-limited", window: "minute" };
        const dayDecision = decideMarketingProRateLimitWindow(dayState, resolveMarketingProRateLimitPerDay());
        if (!dayDecision.allowed) return { action: "rate-limited", window: "day" };

        let budgetNewReservedUsd: number | undefined;
        if (requireCostReservation) {
          const ledgerSnap = await tx.get(budgetLedgerRef);
          const ledgerState = readMarketingProCostLedgerState(ledgerSnap.exists, ledgerSnap.exists ? (ledgerSnap.data() as { reservedUsd?: unknown }) : null);
          if (ledgerState.kind === "corrupted") return { action: "budget-corrupted" };
          const currentReservedUsd = ledgerState.kind === "valid" ? ledgerState.reservedUsd : 0;
          const budgetDecision = decideMarketingProCostReservation(currentReservedUsd, MARKETING_PRO_OPERATION_CONSERVATIVE_COST_USD, resolveMarketingProBackgroundBudgetUsd());
          if (!budgetDecision.allowed) return { action: "budget-exceeded" };
          budgetNewReservedUsd = budgetDecision.newReservedUsd;
        }

        // --- ESCRITAS (só depois de todas as leituras acima) ---
        const doc: MarketingProGenerationDoc = {
          generationId,
          status: "accepted",
          style,
          format,
          productId,
          ...(creativeConceptId ? { creativeConceptId } : {}),
          ...(creativeFamily ? { creativeFamily } : {}),
          attemptCount: MARKETING_PRO_DEFAULT_ATTEMPT_COUNT,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        tx.set(generationRef, doc);
        tx.set(minuteRef, { count: minuteDecision.nextCount, windowStartAt: nowMs, expiresAt: rateLimitPlan.minuteExpiresAtMs, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        tx.set(dayRef, { count: dayDecision.nextCount, windowStartAt: nowMs, expiresAt: rateLimitPlan.dayExpiresAtMs, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        if (requireCostReservation && budgetNewReservedUsd !== undefined) {
          tx.set(budgetLedgerRef, { reservedUsd: budgetNewReservedUsd, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
          tx.set(usageRef, buildMarketingProUsageReservationWrite({
            operationId: generationId,
            uid,
            generationRequestId: generationId,
            provider: provider.id ?? "unknown",
            model: provider.model ?? "unknown",
            inspectionProvider: "google",
            inspectionModel: MARKETING_PRO_SEMANTIC_MODEL,
            inspectionReservedCostMicroUsd: usdToMicroUsd(MARKETING_PRO_SEMANTIC_INSPECTION_CONSERVATIVE_COST_USD),
            reservedCostMicroUsd: usdToMicroUsd(MARKETING_PRO_OPERATION_CONSERVATIVE_COST_USD),
          }, admin));
        }
        return { action: "create-new" };
      });

      if (outcome.action === "return-existing") {
        logInfo("marketing_pro.request_accepted", { requestId: req.requestId, generationId, status: outcome.doc.status, replay: true });
        res.status(200).json(toGenerationDto(outcome.doc));
        return;
      }
      if (outcome.action === "rate-limited") {
        logWarn("marketing_pro.rate_limited", { requestId: req.requestId, generationId, window: outcome.window });
        sendMarketingProError(res, 429, "RATE_LIMITED");
        return;
      }
      if (outcome.action === "budget-corrupted") {
        logError("marketing_pro.budget_state_corrupted", "budget ledger corrupted", { requestId: req.requestId, generationId });
        sendMarketingProError(res, 500, "BUDGET_STATE_CORRUPTED");
        return;
      }
      if (outcome.action === "budget-exceeded") {
        logWarn("marketing_pro.budget_exceeded", { requestId: req.requestId, generationId });
        sendMarketingProError(res, 402, "BUDGET_EXCEEDED");
        return;
      }

      logInfo("marketing_pro.request_accepted", { requestId: req.requestId, generationId, replay: false });

      // Identidade visual (§5): só a cor primária da loja, lida da MESMA coleção que
      // server/public-catalog.ts já usa como fonte de verdade (`user_settings/{uid}`). Nada além disso
      // (nome, logo, WhatsApp, endereço) é lido aqui — a palette validada descarta qualquer valor que
      // não seja um hex #RRGGBB, então um dado ausente/mal formatado só cai no fallback do estilo.
      const settingsSnap = await db.collection("user_settings").doc(uid).get();
      const settingsData = settingsSnap.exists ? (settingsSnap.data() as Record<string, unknown> | undefined) : undefined;
      const storeIdentity = settingsData?.storeIdentity as Record<string, unknown> | undefined;
      const primaryColor = settingsData?.primaryColor ?? storeIdentity?.primaryColor;

      // accepted -> processing (transição real, validada pelo helper — não um pulo direto).
      if (!canTransitionMarketingProBackendStatus("accepted", "processing")) {
        throw new Error("invalid_state_transition:accepted->processing");
      }
      await generationRef.update({ status: "processing" satisfies MarketingProBackendStatus, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      logInfo("marketing_pro.generation_started", { requestId: req.requestId, generationId });

      const truth: ProductTruth = {
        productId,
        name: typeof productData.name === "string" && productData.name.trim() ? productData.name.trim() : "Produto",
        category: typeof productData.category === "string" ? productData.category : undefined,
        color: typeof (productData.extras as Record<string, unknown> | undefined)?.color === "string" ? String((productData.extras as Record<string, unknown>).color) : undefined,
        ...(approvedCutout ? { approvedCutout } : {}),
      };
      const source = resolveOwnedProductImageSource(uid, productId, truth) || undefined;
      const analyzer = createRuntimeProductVisualAnalyzer();
      const productUnderstandingResult = await resolveProductUnderstanding({
        enabled: isMarketingProProductUnderstandingEnabled(),
        truth,
        source,
        analyzer,
        loadImage: loadStorageImage,
        readCache: async (key) => {
          const snapshot = await db.collection("users").doc(uid).collection("products").doc(productId).collection(PRODUCT_UNDERSTANDING_CACHE_COLLECTION).doc(key).get();
          return snapshot.exists ? snapshot.data() || null : null;
        },
        reserveAnalysis: async (key) => {
          const ref = db.collection("users").doc(uid).collection("products").doc(productId).collection(PRODUCT_UNDERSTANDING_CACHE_COLLECTION).doc(key);
          return await db.runTransaction(async (tx) => {
            const snapshot = await tx.get(ref);
            const data = snapshot.exists ? snapshot.data() : undefined;
            const leaseExpiresAtMs = Number(data?.leaseExpiresAtMs);
            if (data?.status === "processing" && Number.isFinite(leaseExpiresAtMs) && leaseExpiresAtMs > Date.now()) return false;
            tx.set(ref, { status: "processing", analyzerVersion: analyzer?.id || null, leaseExpiresAtMs: Date.now() + 30_000, createdAt: new Date().toISOString() });
            return true;
          });
        },
        writeCache: async (key, value) => {
          await db.collection("users").doc(uid).collection("products").doc(productId).collection(PRODUCT_UNDERSTANDING_CACHE_COLLECTION).doc(key).set(value);
        },
      });
      const productUnderstanding = productUnderstandingResult.visualUnderstanding || buildProductUnderstandingFallback({ truth, sourceImageAssetId: approvedCutout?.sourceAssetId }).visualUnderstanding;
      const providerInput = creativeConceptId && creativeFamily
        ? buildMarketingProBackgroundSpecFromConceptSelection({ creativeConceptId, creativeFamily, category, format, productUnderstanding, primaryColor })
        : buildMarketingProProviderArtDirection({ category, style, format, primaryColor });

      // §9: reserved -> dispatched, JUSTO antes da chamada real ao provider — depois deste ponto,
      // NENHUM caminho de falha pode mais tratar a operação como "sem custo" (ver marks abaixo).
      if (requireCostReservation) await markMarketingProUsageDispatched(db, admin, generationId);
      const started = Date.now();
      const result = await runProviderWithTimeout(provider, providerInput, providerTimeoutMs);
      const durationMs = Date.now() - started;

      // GUARDRAIL (§3 do PRO-06B0 / P1-4 da auditoria): "ready" só é alcançável através da função pura
      // `resolveMarketingProGenerationFinalState`, testada isoladamente com result+quality reais — não
      // mais uma decisão inline provada só por regex sobre o texto deste arquivo.
      let finalState = resolveMarketingProGenerationFinalState(result, format);
      if (finalState.status === "failed" && finalState.errorCode && result.status === "ready") {
        logWarn("marketing_pro.quality_rejected", { requestId: req.requestId, generationId, rejectionCode: finalState.errorCode });
      }

      // PRO-09 §6/§7: gate de safe-zone (quantitativo, real) e gate semântico (hoje sempre indisponível
      // — ver marketing-pro-semantic-gate.ts) rodam DEPOIS do quality gate técnico e ANTES de qualquer
      // persistência. Só se aplicam ao caminho de provider REAL (`result.asset` só existe ali).
      if (finalState.status === "ready" && result.status === "ready" && result.asset) {
        const productZone = resolveMarketingProProductPlacement({ format, creativeFamily, productUnderstanding }).rect;
        const safeZone = evaluateMarketingProSafeZoneGate({
          bytes: result.asset.bytes,
          mimeType: result.asset.mimeType,
          productZone,
          textZones: [
            { name: "primaryText", rect: MARKETING_PRO_TEXT_ZONE[format].primaryText },
            { name: "secondaryText", rect: MARKETING_PRO_TEXT_ZONE[format].secondaryText },
            { name: "callToAction", rect: MARKETING_PRO_TEXT_ZONE[format].callToAction },
          ],
        });
        if (!safeZone.accepted) {
          finalState = { status: "failed", errorCode: "SAFE_ZONE_REJECTED" };
          await quarantineMarketingProSafeZoneRejectedBackground({
            uid,
            generationId,
            productId,
            backgroundBytes: result.asset.bytes,
            mimeType: result.asset.mimeType,
            rejectionCode: safeZone.rejectionCode,
            rejectedZone: safeZone.zone,
            metricsReport: safeZone.metricsReport,
            ...(approvedCutout ? {
              loadCutoutBytes: async () => {
                const [bytes] = await admin.storage().bucket(process.env.FIREBASE_STORAGE_BUCKET?.trim() || undefined).file(approvedCutout.storagePath).download();
                return bytes;
              },
            } : {}),
          });
          logWarn("marketing_pro.safe_zone_rejected", {
            requestId: req.requestId,
            generationId,
            rejectionCode: safeZone.rejectionCode,
            zone: safeZone.zone,
            productZoneMetrics: safeZone.metricsReport?.productZone.metrics,
            productZoneViolations: safeZone.metricsReport?.productZone.violations,
            textZoneMetrics: safeZone.metricsReport?.textZones.map((zone) => ({ name: zone.name, metrics: zone.metrics, violations: zone.violations })),
            thresholds: safeZone.metricsReport?.thresholds,
          });
        } else {
          const semantic = await evaluateMarketingProSemanticGateCached(db, result.asset.bytes, result.asset.mimeType, options.semanticInspector);
          if (!semantic.accepted) {
            finalState = { status: "failed", errorCode: semantic.rejectionCode };
            await quarantineMarketingProSafeZoneRejectedBackground({
              uid,
              generationId,
              productId,
              backgroundBytes: result.asset.bytes,
              mimeType: result.asset.mimeType,
              rejectionCode: semantic.rejectionCode,
              semanticMetadata: semantic.metadata,
              semanticReason: semantic.rejectionCode,
              metricsReport: safeZone.metricsReport,
              ...(approvedCutout ? {
                loadCutoutBytes: async () => {
                  const [bytes] = await admin.storage().bucket(process.env.FIREBASE_STORAGE_BUCKET?.trim() || undefined).file(approvedCutout.storagePath).download();
                  return bytes;
                },
              } : {}),
            });
            logWarn("marketing_pro.semantic_gate_rejected", { requestId: req.requestId, generationId, rejectionCode: semantic.rejectionCode });
          }
        }
      }

      // §7/§8 do PRO-08, §9 do PRO-09: só um provider REAL devolve `asset` (bytes reais) — o mock nunca
      // preenche esse campo. Persistir só acontece depois que TODOS os gates acima aprovaram
      // (`finalState.status === "ready"`); uma falha de persistência derruba a geração para `failed`
      // (nunca fica "ready" sem um asset gravado de verdade).
      let background: MarketingProBackgroundAsset | undefined;
      if (finalState.status === "ready" && result.status === "ready" && result.asset) {
        const persisted = await persistMarketingProBackgroundAsset({
          uid,
          generationId,
          asset: result.asset,
          provider: provider.id ?? "unknown",
          model: provider.model ?? "unknown",
          style,
          format,
          sourceProductId: productId,
          costReservationUsd: MARKETING_PRO_OPERATION_CONSERVATIVE_COST_USD,
        });
        if (persisted.ok) {
          background = persisted.background;
        } else {
          finalState = { status: "failed", errorCode: "GENERATION_FAILED" };
          await quarantineMarketingProSafeZoneRejectedBackground({
            uid,
            generationId,
            productId,
            backgroundBytes: result.asset.bytes,
            mimeType: result.asset.mimeType,
            rejectionCode: "PERSISTENCE_FAILED",
            persistenceReason: persisted.reason,
            ...(approvedCutout ? {
              loadCutoutBytes: async () => {
                const [bytes] = await admin.storage().bucket(process.env.FIREBASE_STORAGE_BUCKET?.trim() || undefined).file(approvedCutout.storagePath).download();
                return bytes;
              },
            } : {}),
          });
          logWarn("marketing_pro.background_persist_failed", { requestId: req.requestId, generationId, reason: persisted.reason });
        }
      }

      // §9: NUNCA "liberado como sem custo" depois do dispatch — `committed` só no caminho 100% feliz
      // (persistido de verdade); qualquer outro desfecho pós-dispatch vira `potentiallyBilled`.
      if (requireCostReservation) {
        if (finalState.status === "ready" && background) {
          await markMarketingProUsageCommitted(db, admin, generationId, usdToMicroUsd(MARKETING_PRO_OPERATION_CONSERVATIVE_COST_USD));
        } else {
          await markMarketingProUsagePotentiallyBilled(db, admin, generationId);
        }
      }

      if (!canTransitionMarketingProBackendStatus("processing", finalState.status)) {
        throw new Error(`invalid_state_transition:processing->${finalState.status}`);
      }
      await generationRef.update({
        status: finalState.status,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(finalState.errorCode ? { errorCode: finalState.errorCode } : {}),
        ...(background ? { background } : {}),
      });

      if (finalState.status === "ready") {
        logInfo("marketing_pro.ready", { requestId: req.requestId, generationId, durationMs });
      } else {
        logWarn("marketing_pro.failed", { requestId: req.requestId, generationId, durationMs, errorCode: finalState.errorCode });
      }

      const finalSnap = await generationRef.get();
      res.status(200).json(toGenerationDto(finalSnap.data() as MarketingProGenerationDoc));
    } catch (error) {
      logError("marketing_pro.generation_unhandled_error", error, { requestId: req.requestId, generationId });
      sendMarketingProError(res, 500, "GENERATION_FAILED");
    }
  });

  app.get("/api/marketing/pro/generations/:generationId", requireAuth, async (req: Request, res: Response) => {
    const uid = (req as any).firebaseUid as string;
    const generationId = req.params.generationId;
    if (!isValidMarketingProGenerationId(generationId)) {
      sendMarketingProError(res, 400, "INVALID_INPUT");
      return;
    }
    try {
      const admin = getFirebaseAdmin();
      const db = admin.firestore();
      // O path já inclui o uid do TOKEN, não um parâmetro da URL: a geração de outro usuário nunca
      // está neste caminho, então não existe consulta capaz de vazar entre UIDs.
      const snap = await db.collection("users").doc(uid).collection("marketingProGenerations").doc(generationId).get();
      if (!snap.exists) {
        sendMarketingProError(res, 404, "GENERATION_NOT_FOUND");
        return;
      }
      res.status(200).json(toGenerationDto(snap.data() as MarketingProGenerationDoc));
    } catch (error) {
      logError("marketing_pro.get_generation_failed", error, { requestId: req.requestId, generationId });
      sendMarketingProError(res, 500, "GENERATION_FAILED");
    }
  });
}
