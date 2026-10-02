import { FieldValue } from "firebase-admin/firestore";
import { assertReferralProgramEnabledInTransaction } from "./referral-program";

const PUBLIC_CATALOG_SLUGS_COLLECTION = "public_catalog_slugs";
const LEGACY_SLUG_FIELDS = ["catalogSlug", "catalog_slug", "userSlug", "slug"] as const;
const PLACEHOLDER_STORE_NAMES = new Set(["minha-revenda", "minha-loja"]);
const PLACEHOLDER_CATALOG_SLUGS = new Set(["minha-revenda", "minha-loja"]);
const MAX_SLUG_COLLISION_ATTEMPTS = 50;

export class ReferralSourceConflictError extends Error {
  constructor() {
    super("REFERRAL_SOURCE_ALREADY_SET");
    this.name = "ReferralSourceConflictError";
  }
}

// RELEASE-02: nenhum destes pode chegar ao Firestore vindo do body do cliente — allowlist por exclusão
// (blocklist), normalizada (case/underscore-insensível) para pegar tanto aliases camelCase quanto
// snake_case do mesmo campo perigoso. `onboarding_completed`/`onboarding_completed_at` e os demais
// campos onboarding_* NÃO entram aqui de propósito: são estado de UX legítimo que o próprio usuário
// controla (qual tela mostrar), e o fluxo real de onboarding já os grava por este mesmo endpoint — a
// correção para eles não impedir farming de referral fica na ELEGIBILIDADE do referral
// (isReferralAccountOldEnough, server/routes.ts), não aqui.
const SERVER_OWNED_SETTINGS_KEYS = new Set([
  "uid",
  "userid",
  "ownerid",
  "owneruid",
  "tenantid",
  "tenantuid",
  "catalogowner",
  "catalogownerid",
  "catalogowneruid",
  "role",
  "roles",
  "admin",
  "isadmin",
  "plan",
  "currentplan",
  "premium",
  "premiumactive",
  "premiumexpiresat",
  "premiumstartedat",
  "premiumsource",
  "subscriptionid",
  "subscriptionstatus",
  "paymentstatus",
  "autorenew",
  "referralreward",
  "referralrewardgranted",
  "rewardgranted",
  "rewardeligibleconversions",
  "rewardgrantedcount",
  "rewardeligibilityupdatedat",
  "rewardlastgrantedat",
  "rewardlastgrantedcount",
  "rewardlastgrantedreason",
  "rewardlastgrantedby",
  "referralconversions",
  "referredusers",
  "lastreferralconversionat",
  "referralappliedat",
  "referralappliedby",
  "referralimmutable",
]);

function normalizeServerOwnedKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

export function normalizeCatalogSlug(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function isPlaceholderCatalogSlug(value: unknown): boolean {
  const slug = normalizeCatalogSlug(value);
  return !slug || PLACEHOLDER_CATALOG_SLUGS.has(slug);
}

function isPlaceholderStoreName(value: unknown): boolean {
  const slug = normalizeCatalogSlug(value);
  return !slug || PLACEHOLDER_STORE_NAMES.has(slug);
}

function deriveCatalogSlugBase(settings: Record<string, unknown>, ownerUid: string): string {
  const storeName = typeof settings.storeName === "string" ? settings.storeName : "";
  if (!isPlaceholderStoreName(storeName)) {
    const slug = normalizeCatalogSlug(storeName);
    if (slug) return slug.slice(0, 72);
  }
  return `catalogo-${ownerUid.slice(0, 8).toLowerCase()}`;
}

export function sanitizePublicSettingsPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) =>
    !SERVER_OWNED_SETTINGS_KEYS.has(normalizeServerOwnedKey(key))));
}

function requestedSlug(payload: Record<string, unknown>): { provided: boolean; slug: string | null } {
  const canonicalFields = ["catalogSlug", "catalog_slug"] as const;
  const fields = canonicalFields.some((field) => Object.prototype.hasOwnProperty.call(payload, field))
    ? canonicalFields
    : (["userSlug", "slug"] as const);
  const supplied = fields
    .filter((field) => Object.prototype.hasOwnProperty.call(payload, field))
    .map((field) => normalizeCatalogSlug(payload[field]));
  if (supplied.length === 0) return { provided: false, slug: null };
  const unique = Array.from(new Set(supplied));
  if (unique.length !== 1 || !unique[0] || unique[0].length > 80) {
    throw new InvalidCatalogSlugError();
  }
  return { provided: true, slug: unique[0] };
}

function storedSlug(settings: Record<string, unknown>): string | null {
  for (const field of LEGACY_SLUG_FIELDS) {
    const slug = normalizeCatalogSlug(settings[field]);
    if (slug) return slug;
  }
  return null;
}

function storedRealSlug(settings: Record<string, unknown>): string | null {
  const slug = storedSlug(settings);
  return slug && !isPlaceholderCatalogSlug(slug) ? slug : null;
}

export class CatalogSlugConflictError extends Error {
  constructor() {
    super("CATALOG_SLUG_TAKEN");
    this.name = "CatalogSlugConflictError";
  }
}

export class InvalidCatalogSlugError extends Error {
  constructor() {
    super("INVALID_CATALOG_SLUG");
    this.name = "InvalidCatalogSlugError";
  }
}

/**
 * HOTFIX-P0-B — antes, um slug que resolvia com sucesso mas estava com enablePublicCatalog:false
 * (ou disablePublicCatalog:true) virava exatamente o mesmo `return null` de "esse slug não resolve
 * para ninguém", e as duas coisas terminavam na MESMA mensagem "não foi encontrado ou está
 * desativado pelo consultor" — inclusive para visitantes de lojas que nunca foram desativadas e só
 * bateram num erro técnico intermediário. Um erro dedicado deixa quem chama (loadPublicCatalog em
 * server/routes.ts) responder com um código diferente de "não existe", e o cliente (public-catalog.tsx)
 * finalmente mostrar as duas causas como o que realmente são.
 */
export class PublicCatalogDeactivatedError extends Error {
  constructor() {
    super("PUBLIC_CATALOG_DEACTIVATED");
    this.name = "PublicCatalogDeactivatedError";
  }
}

async function findLegacyOwners(transaction: any, settingsRef: any, slug: string): Promise<Set<string>> {
  const owners = new Set<string>();
  for (const field of LEGACY_SLUG_FIELDS) {
    const snapshot = await transaction.get(settingsRef.where(field, "==", slug).limit(2));
    for (const doc of snapshot.docs) owners.add(doc.id);
  }
  return owners;
}

export async function persistUserSettingsWithCatalogOwnership(input: {
  db: any;
  ownerUid: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const { db, ownerUid } = input;
  const safePayload = sanitizePublicSettingsPayload(input.payload);
  const requested = requestedSlug(safePayload);
  const settingsRef = db.collection("user_settings").doc(ownerUid);

  await db.runTransaction(async (transaction: any) => {
    const currentDoc = await transaction.get(settingsRef);
    if (typeof safePayload.referral_source === "string" && safePayload.referral_source.length > 0) {
      await assertReferralProgramEnabledInTransaction(transaction, db);
    }
    const currentSettings = currentDoc.data() ?? {};
    const currentReferralSource = currentSettings.referral_source;
    const requestedReferralSource = safePayload.referral_source;
    if (typeof currentReferralSource === "string" && currentReferralSource.length > 0 &&
        typeof requestedReferralSource === "string" && requestedReferralSource !== currentReferralSource) {
      throw new ReferralSourceConflictError();
    }
    const previousSlug = storedSlug(currentSettings);
    const effectiveSlug = requested.provided ? requested.slug : previousSlug;

    let targetReservation: any = null;
    let previousReservation: any = null;
    let targetRef: any = null;
    let previousRef: any = null;

    if (effectiveSlug) {
      targetRef = db.collection(PUBLIC_CATALOG_SLUGS_COLLECTION).doc(effectiveSlug);
      targetReservation = await transaction.get(targetRef);
      const reservedOwner = targetReservation.exists ? targetReservation.data()?.ownerUid : null;
      if (targetReservation.exists && reservedOwner !== ownerUid) throw new CatalogSlugConflictError();

      const legacyOwners = await findLegacyOwners(transaction, db.collection("user_settings"), effectiveSlug);
      if (Array.from(legacyOwners).some((legacyOwner) => legacyOwner !== ownerUid)) {
        throw new CatalogSlugConflictError();
      }

      if (previousSlug && previousSlug !== effectiveSlug) {
        previousRef = db.collection(PUBLIC_CATALOG_SLUGS_COLLECTION).doc(previousSlug);
        previousReservation = await transaction.get(previousRef);
      }
    }

    const settingsUpdate: Record<string, unknown> = {
      ...safePayload,
      uid: FieldValue.delete(),
      ownerId: FieldValue.delete(),
      ownerUid: FieldValue.delete(),
      userId: FieldValue.delete(),
      tenantId: FieldValue.delete(),
      tenantUid: FieldValue.delete(),
      catalogOwnerUid: FieldValue.delete(),
    };

    if (effectiveSlug) {
      settingsUpdate.catalogSlug = effectiveSlug;
      settingsUpdate.catalog_slug = effectiveSlug;
      settingsUpdate.userSlug = FieldValue.delete();
      settingsUpdate.slug = FieldValue.delete();
      transaction.set(targetRef, {
        ownerUid,
        slug: effectiveSlug,
        updatedAt: FieldValue.serverTimestamp(),
        ...(targetReservation.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      }, { merge: true });
    }

    if (previousRef && previousReservation?.exists && previousReservation.data()?.ownerUid === ownerUid) {
      transaction.delete(previousRef);
    }

    transaction.set(settingsRef, settingsUpdate, { merge: true });
  });
}

export async function ensurePublicCatalogSlug(input: {
  db: any;
  ownerUid: string;
}): Promise<{ slug: string; created: boolean }> {
  const { db, ownerUid } = input;
  const settingsRef = db.collection("user_settings").doc(ownerUid);

  return db.runTransaction(async (transaction: any) => {
    const settingsDoc = await transaction.get(settingsRef);
    const settings = settingsDoc.data() ?? {};
    const existingRealSlug = storedRealSlug(settings);

    if (existingRealSlug) {
      const existingRef = db.collection(PUBLIC_CATALOG_SLUGS_COLLECTION).doc(existingRealSlug);
      const existingReservation = await transaction.get(existingRef);
      const reservedOwner = existingReservation.exists ? existingReservation.data()?.ownerUid : null;
      if (existingReservation.exists && reservedOwner !== ownerUid) throw new CatalogSlugConflictError();

      transaction.set(existingRef, {
        ownerUid,
        slug: existingRealSlug,
        updatedAt: FieldValue.serverTimestamp(),
        ...(existingReservation.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      }, { merge: true });
      transaction.set(settingsRef, {
        catalogSlug: existingRealSlug,
        catalog_slug: existingRealSlug,
        enablePublicCatalog: true,
        userSlug: FieldValue.delete(),
        slug: FieldValue.delete(),
      }, { merge: true });
      return { slug: existingRealSlug, created: !existingReservation.exists };
    }

    const previousSlug = storedSlug(settings);
    const baseSlug = deriveCatalogSlugBase(settings, ownerUid);
    let selectedSlug: string | null = null;
    let selectedRef: any = null;
    let selectedReservation: any = null;

    for (let index = 0; index < MAX_SLUG_COLLISION_ATTEMPTS; index += 1) {
      const suffix = index === 0 ? "" : `-${index + 1}`;
      const candidate = `${baseSlug.slice(0, 80 - suffix.length)}${suffix}`;
      const candidateRef = db.collection(PUBLIC_CATALOG_SLUGS_COLLECTION).doc(candidate);
      const candidateReservation = await transaction.get(candidateRef);
      const reservedOwner = candidateReservation.exists ? candidateReservation.data()?.ownerUid : null;
      if (candidateReservation.exists && reservedOwner !== ownerUid) continue;

      const legacyOwners = await findLegacyOwners(transaction, db.collection("user_settings"), candidate);
      if (Array.from(legacyOwners).some((legacyOwner) => legacyOwner !== ownerUid)) continue;

      selectedSlug = candidate;
      selectedRef = candidateRef;
      selectedReservation = candidateReservation;
      break;
    }

    if (!selectedSlug || !selectedRef) throw new CatalogSlugConflictError();

    let previousRef: any = null;
    let previousReservation: any = null;
    if (previousSlug && previousSlug !== selectedSlug) {
      previousRef = db.collection(PUBLIC_CATALOG_SLUGS_COLLECTION).doc(previousSlug);
      previousReservation = await transaction.get(previousRef);
    }

    transaction.set(selectedRef, {
      ownerUid,
      slug: selectedSlug,
      updatedAt: FieldValue.serverTimestamp(),
      ...(selectedReservation?.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    }, { merge: true });
    if (previousRef && previousReservation?.exists && previousReservation.data()?.ownerUid === ownerUid) {
      transaction.delete(previousRef);
    }
    transaction.set(settingsRef, {
      catalogSlug: selectedSlug,
      catalog_slug: selectedSlug,
      enablePublicCatalog: true,
      userSlug: FieldValue.delete(),
      slug: FieldValue.delete(),
    }, { merge: true });

    return { slug: selectedSlug, created: true };
  });
}

async function findUniqueLegacySettingsDoc(settingsRef: any, rawSlug: string, normalizedSlug: string) {
  const matches = new Map<string, any>();
  const candidates = Array.from(new Set([rawSlug.trim(), normalizedSlug].filter(Boolean)));
  for (const field of LEGACY_SLUG_FIELDS) {
    for (const candidate of candidates) {
      const snapshot = await settingsRef.where(field, "==", candidate).limit(2).get();
      for (const doc of snapshot.docs) matches.set(doc.id, doc);
      if (matches.size > 1) return null;
    }
  }
  return matches.size === 1 ? matches.values().next().value : null;
}

export async function resolvePublicCatalogSettingsDoc(db: any, rawSlug: string) {
  const slug = normalizeCatalogSlug(rawSlug);
  if (!slug) return null;

  const reservation = await db.collection(PUBLIC_CATALOG_SLUGS_COLLECTION).doc(slug).get();
  if (reservation.exists) {
    const ownerUid = reservation.data()?.ownerUid;
    if (typeof ownerUid !== "string" || !ownerUid) return null;
    const settingsDoc = await db.collection("user_settings").doc(ownerUid).get();
    if (!settingsDoc.exists || storedSlug(settingsDoc.data() ?? {}) !== slug) return null;
    return settingsDoc;
  }

  return findUniqueLegacySettingsDoc(db.collection("user_settings"), rawSlug, slug);
}
