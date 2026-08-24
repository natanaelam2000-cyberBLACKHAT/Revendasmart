/**
 * script/grant-play-review-access.ts
 *
 * Concede acesso Premium a UMA conta dedicada à revisão do RevendaSmart pela Google Play (license
 * tester / revisor manual da loja), sem passar por nenhum fluxo de billing real — nunca cria
 * subscriptionId/purchaseToken fictício, nunca aciona Mercado Pago ou Google Play Billing, nunca
 * altera billingProvider para um provider inexistente.
 *
 * Fonte única de entitlement: `isPremiumActive()` (shared/monetization.ts). Este script só grava os
 * campos que essa função já sabe interpretar — `premiumSource: "play_review"`, `premiumActive: true`,
 * `currentPlan: "premium"`, `premiumExpiresAt: null` — nunca implementa uma segunda lógica de acesso.
 *
 * `premiumExpiresAt: null` é, por design de `isPremiumActive()`, "sem data de término conhecida" — o
 * mesmo estado usado por concessões de admin/recompensa, não "acesso sem controle": ainda passa por
 * TODAS as outras checagens da função (premiumBlocked, etc.), só nunca expira sozinho.
 *
 * `premiumOverride: true` reaproveita a MESMA proteção que já existe para concessões administrativas
 * em `server/subscriptions.ts` (`reconcilePremiumStatus`, prioridade 1: "ADMIN / RECOMPENSA — NUNCA
 * SOBRESCREVE") — o reconciliador do Mercado Pago já para ali antes de qualquer lógica de assinatura,
 * então esta conta nunca é rebaixada por um webhook ou sync-now, mesmo que um dia acabe tendo um
 * subscriptionId por engano.
 *
 * Uso:
 *   npx tsx script/grant-play-review-access.ts <email>
 *
 * Idempotente: rodar de novo com o mesmo e-mail reafirma exatamente os mesmos campos — nunca duplica,
 * nunca recria a conta, nunca altera campos não relacionados (referralCode, referralCount, etc. — o
 * write usa `{merge: true}`).
 *
 * Nunca imprime token/segredo — só UID e e-mail mascarados e o resultado.
 */
import { pathToFileURL } from "node:url";
import { initializeFirebaseAdmin, getFirebaseAdmin } from "../server/firebase-admin-init";

export const PLAY_REVIEW_PREMIUM_SOURCE = "play_review" as const;

export function maskEmailForLog(email: string): string {
  const [name, domain] = email.split("@");
  if (!name || !domain) return "***";
  return `${name.slice(0, 2)}***@${domain}`;
}

export function maskUidForLog(uid: string): string {
  if (uid.length <= 6) return "***";
  return `${uid.slice(0, 3)}…${uid.slice(-3)}`;
}

export class PlayReviewAccountNotFoundError extends Error {
  constructor(email: string) {
    super(`Nenhuma conta Firebase Auth encontrada para ${maskEmailForLog(email)}. Nenhuma alteração foi feita.`);
    this.name = "PlayReviewAccountNotFoundError";
  }
}

export interface GrantPlayReviewAccessResult {
  readonly uidMasked: string;
  readonly emailMasked: string;
  readonly outcome: "granted" | "reaffirmed";
}

/**
 * Resolve o UID pelo e-mail (Firebase Admin Auth) e grava o entitlement canônico de revisão em
 * `users/{uid}/planData/main`. O e-mail só serve para localizar o UID nesta operação administrativa —
 * nunca é gravado, comparado em runtime do app, nem persistido em nenhum campo.
 */
export async function grantPlayReviewAccess(email: string): Promise<GrantPlayReviewAccessResult> {
  const trimmedEmail = email.trim();
  if (!trimmedEmail || !trimmedEmail.includes("@")) {
    throw new Error("E-mail inválido.");
  }

  initializeFirebaseAdmin();
  const admin = getFirebaseAdmin();
  const auth = admin.auth();
  const db = admin.firestore();

  let uid: string;
  try {
    const userRecord = await auth.getUserByEmail(trimmedEmail);
    uid = userRecord.uid;
  } catch {
    throw new PlayReviewAccountNotFoundError(trimmedEmail);
  }

  const planRef = db.collection("users").doc(uid).collection("planData").doc("main");
  const existingSnap = await planRef.get();
  const existing = existingSnap.data();
  const outcome: GrantPlayReviewAccessResult["outcome"] =
    existing?.premiumSource === PLAY_REVIEW_PREMIUM_SOURCE && existing?.premiumActive === true
      ? "reaffirmed"
      : "granted";

  // Só os campos necessários ao entitlement canônico — nunca subscriptionId/purchaseToken/billingProvider
  // fictícios. Campos não relacionados (referralCode, referralCount, etc.) ficam intactos via `merge`.
  await planRef.set(
    {
      premiumSource: PLAY_REVIEW_PREMIUM_SOURCE,
      premiumActive: true,
      currentPlan: "premium",
      premiumExpiresAt: null,
      premiumOverride: true,
      premiumBlocked: false,
      ...(existing?.premiumStartedAt ? {} : { premiumStartedAt: admin.firestore.FieldValue.serverTimestamp() }),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return { uidMasked: maskUidForLog(uid), emailMasked: maskEmailForLog(trimmedEmail), outcome };
}

async function main(): Promise<void> {
  const email = process.argv[2]?.trim();
  if (!email) {
    console.error("Uso: npx tsx script/grant-play-review-access.ts <email>");
    process.exitCode = 1;
    return;
  }

  try {
    const result = await grantPlayReviewAccess(email);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const isDirectRun = (() => {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main();
}
