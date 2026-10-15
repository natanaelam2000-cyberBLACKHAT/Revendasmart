/**
 * ADS-PRO-03C — Persistência Autoritativa do Creative Profile V1
 *
 * Camada de persistência segura, fail-safe e tenant-scoped para o
 * AdsProCreativeProfileV1 ({ schemaVersion: 1, preferredStyles: [...] }).
 *
 * Princípios e Garantias Arquiteturais:
 * 1. Path Canônico: `users/{uid}/adsPro/creativeProfile`.
 *    - Subdocumento dedicado sob `users/{uid}`.
 *    - Totalmente isolado de `user_settings` (zero risco para storeName, catalogSlug, businessMode, onboarding).
 *    - Totalmente isolado do SellerCreativeProfile legado do PRO-10B (`users/{uid}/marketingProfile/creative`).
 * 2. Validação Rigorosa:
 *    - Toda escrita valida o payload contra `parseAdsProCreativeProfile`.
 *    - Toda leitura trata os dados do Firestore como `unknown` e valida via `parseAdsProCreativeProfile`.
 * 3. Falha Segura (Fail-Safe):
 *    - Documento ausente retorna `null` (nenhum fallback artificial como modern/minimal é inventado).
 *    - Documento corrompido ou schema desconhecido lança AdsProCreativeProfileError com código estável ADS_PRO_CREATIVE_PROFILE_INVALID.
 * 4. Tenant Isolation e Segurança:
 *    - UID derivado do contexto autenticado (`getAuth().currentUser?.uid` ou options.uid).
 *    - Protegido por Firestore Security Rules com enforcement de ownership (`request.auth.uid == uid`) e shape estrito.
 * 5. Zero PII e Zero Dados Efêmeros:
 *    - Nunca persiste quiz answers, scores, breakdown, tie-breaks, category, intent, format, entityKind ou PII.
 */

import { getAuth } from "firebase/auth";
import {
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  setDoc,
  type Firestore,
} from "firebase/firestore";
import {
  parseAdsProCreativeProfile,
  type AdsProCreativeProfileV1,
  type CreativeProfileValidationError,
} from "@shared/ads-pro/creative-profile";

/** Coleção dedicada para o Ads Pro sob o namespace do usuário. */
export const ADS_PRO_PROFILE_COLLECTION = "adsPro";

/** ID canônico único do documento do perfil criativo. */
export const ADS_PRO_PROFILE_DOC_ID = "creativeProfile";

/** Retorna o caminho absoluto do documento de perfil no Firestore. */
export function getAdsProCreativeProfileDocPath(uid: string): string {
  return `users/${uid}/${ADS_PRO_PROFILE_COLLECTION}/${ADS_PRO_PROFILE_DOC_ID}`;
}

export type AdsProCreativeProfileErrorCode =
  | "UNAUTHENTICATED"
  | "PERMISSION_DENIED"
  | "ADS_PRO_CREATIVE_PROFILE_INVALID"
  | "PERSISTENCE_FAILED";

/**
 * Erro tipado e padronizado da camada de persistência do Creative Profile.
 */
export class AdsProCreativeProfileError extends Error {
  constructor(
    public readonly code: AdsProCreativeProfileErrorCode,
    message: string,
    public readonly details?: readonly CreativeProfileValidationError[] | unknown
  ) {
    super(message);
    this.name = "AdsProCreativeProfileError";
  }
}

/** Adaptador de persistência para desacoplamento e suporte a testes unitários determinísticos. */
export interface AdsProFirestoreAdapter {
  getDoc(path: string): Promise<{ exists: boolean; data?: unknown }>;
  setDoc(path: string, data: unknown): Promise<void>;
  deleteDoc(path: string): Promise<void>;
}

/** Opções opcionais para injeção de dependências em testes e execuções no emulador. */
export interface AdsProPersistenceOptions {
  /** Instância do Firestore (padrão: getFirestore()). */
  readonly db?: Firestore;
  /** Adaptador de persistência customizado ou in-memory (para testes unitários). */
  readonly adapter?: AdsProFirestoreAdapter;
  /** UID explícito somente quando um adapter de teste é fornecido; em produção vem exclusivamente da autenticação. */
  readonly uid?: string;
}

/** Resolve o UID autenticado. */
function resolveAuthUid(options?: AdsProPersistenceOptions): string {
  let authenticatedUid: string | undefined;
  try {
    authenticatedUid = getAuth()?.currentUser?.uid;
  } catch {
    authenticatedUid = undefined;
  }

  const explicitUid = options?.uid;
  if (options?.adapter && explicitUid) {
    if (typeof explicitUid !== "string" || explicitUid.trim() === "") {
      throw new AdsProCreativeProfileError(
        "UNAUTHENTICATED",
        "Usuário não autenticado para acessar o Creative Profile do Ads Pro."
      );
    }
    return explicitUid;
  }

  if (!authenticatedUid || typeof authenticatedUid !== "string" || authenticatedUid.trim() === "") {
    throw new AdsProCreativeProfileError(
      "UNAUTHENTICATED",
      "Usuário não autenticado para acessar o Creative Profile do Ads Pro."
    );
  }

  if (explicitUid && explicitUid !== authenticatedUid) {
    throw new AdsProCreativeProfileError(
      "PERMISSION_DENIED",
      "O UID informado não corresponde ao usuário autenticado."
    );
  }

  return authenticatedUid;
}

/** Resolve a instância do Firestore caso nenhum adaptador seja fornecido. */
function resolveFirestoreDb(options?: AdsProPersistenceOptions): Firestore {
  let db = options?.db;
  if (!db) {
    try {
      db = getFirestore();
    } catch (err: unknown) {
      throw new AdsProCreativeProfileError(
        "PERSISTENCE_FAILED",
        `Instância do Firestore não disponível: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  return db;
}

/**
 * Salva de forma autoritativa e idempotente o AdsProCreativeProfileV1 no Firestore.
 *
 * - Valida rigorosamente a entrada com parseAdsProCreativeProfile antes de qualquer escrita.
 * - Rejeita estilos inválidos, desconhecidos ou duplicados.
 * - Rejeita campos extras, quiz answers, scores, intents ou metadados de campanha.
 * - Persiste exclusivamente { schemaVersion: 1, preferredStyles: [...] }.
 */
export async function saveAdsProCreativeProfile(
  profileInput: unknown,
  options?: AdsProPersistenceOptions
): Promise<AdsProCreativeProfileV1> {
  const parseResult = parseAdsProCreativeProfile(profileInput);
  if (!parseResult.ok) {
    const errorMessages = parseResult.errors.map((e) => e.message).join("; ");
    throw new AdsProCreativeProfileError(
      "ADS_PRO_CREATIVE_PROFILE_INVALID",
      `Falha na validação do Creative Profile antes da escrita: ${errorMessages}`,
      parseResult.errors
    );
  }

  const uid = resolveAuthUid(options);
  const docPath = getAdsProCreativeProfileDocPath(uid);

  // Payload mínimo, canônico e sem contaminação
  const canonicalPayload = {
    schemaVersion: parseResult.value.schemaVersion,
    preferredStyles: [...parseResult.value.preferredStyles],
  };

  try {
    if (options?.adapter) {
      await options.adapter.setDoc(docPath, canonicalPayload);
    } else {
      const db = resolveFirestoreDb(options);
      const targetDocRef = doc(
        db,
        "users",
        uid,
        ADS_PRO_PROFILE_COLLECTION,
        ADS_PRO_PROFILE_DOC_ID
      );
      await setDoc(targetDocRef, canonicalPayload);
    }
  } catch (err: unknown) {
    if (err instanceof AdsProCreativeProfileError) {
      throw err;
    }
    const errorMsg = err instanceof Error ? err.message : String(err);
    const isPermissionError =
      errorMsg.includes("permission-denied") ||
      (typeof err === "object" && err !== null && (err as { code?: string }).code === "permission-denied");

    if (isPermissionError) {
      throw new AdsProCreativeProfileError(
        "PERMISSION_DENIED",
        `Permissão negada ao salvar Creative Profile para o usuário ${uid}.`,
        err
      );
    }
    throw new AdsProCreativeProfileError(
      "PERSISTENCE_FAILED",
      `Erro ao persistir Creative Profile: ${errorMsg}`,
      err
    );
  }

  return parseResult.value;
}

/**
 * Carrega de forma autoritativa o AdsProCreativeProfileV1 do Firestore.
 *
 * - Trata os dados lidos como `unknown`.
 * - Se o documento não existir, retorna `null` (ausência legítima de perfil configurado).
 * - Se o documento existir, valida através de `parseAdsProCreativeProfile`.
 * - Se corrompido, schema incompatível ou com campos estranhos, lança AdsProCreativeProfileError.
 * - Nunca inventa fallback defaults (como 'modern' ou 'minimal').
 * - Preserva estritamente a ordem das preferências e congela o resultado retornado.
 */
export async function getAdsProCreativeProfile(
  options?: AdsProPersistenceOptions
): Promise<AdsProCreativeProfileV1 | null> {
  const uid = resolveAuthUid(options);
  const docPath = getAdsProCreativeProfileDocPath(uid);

  let rawData: unknown;
  let exists = false;

  try {
    if (options?.adapter) {
      const snap = await options.adapter.getDoc(docPath);
      exists = snap.exists;
      rawData = snap.data;
    } else {
      const db = resolveFirestoreDb(options);
      const targetDocRef = doc(
        db,
        "users",
        uid,
        ADS_PRO_PROFILE_COLLECTION,
        ADS_PRO_PROFILE_DOC_ID
      );
      const snap = await getDoc(targetDocRef);
      exists = snap.exists();
      rawData = snap.data();
    }
  } catch (err: unknown) {
    if (err instanceof AdsProCreativeProfileError) {
      throw err;
    }
    const errorMsg = err instanceof Error ? err.message : String(err);
    const isPermissionError =
      errorMsg.includes("permission-denied") ||
      (typeof err === "object" && err !== null && (err as { code?: string }).code === "permission-denied");

    if (isPermissionError) {
      throw new AdsProCreativeProfileError(
        "PERMISSION_DENIED",
        `Permissão negada ao ler Creative Profile para o usuário ${uid}.`,
        err
      );
    }
    throw new AdsProCreativeProfileError(
      "PERSISTENCE_FAILED",
      `Erro ao carregar Creative Profile: ${errorMsg}`,
      err
    );
  }

  if (!exists) {
    return null;
  }

  const parseResult = parseAdsProCreativeProfile(rawData);

  if (!parseResult.ok) {
    const errorMessages = parseResult.errors.map((e) => e.message).join("; ");
    throw new AdsProCreativeProfileError(
      "ADS_PRO_CREATIVE_PROFILE_INVALID",
      `Documento do Creative Profile persistido é inválido ou corrompido: ${errorMessages}`,
      parseResult.errors
    );
  }

  return parseResult.value;
}

/**
 * Redefine (apaga) o documento do Creative Profile do usuário no Firestore.
 *
 * - A remoção do documento faz com que futuras leituras retornem `null` (documento ausente).
 * - Distingue-se semanticamente de salvar um perfil com `preferredStyles: []` (perfil configurado explicitamente neutro).
 */
export async function clearAdsProCreativeProfile(
  options?: AdsProPersistenceOptions
): Promise<void> {
  const uid = resolveAuthUid(options);
  const docPath = getAdsProCreativeProfileDocPath(uid);

  try {
    if (options?.adapter) {
      await options.adapter.deleteDoc(docPath);
    } else {
      const db = resolveFirestoreDb(options);
      const targetDocRef = doc(
        db,
        "users",
        uid,
        ADS_PRO_PROFILE_COLLECTION,
        ADS_PRO_PROFILE_DOC_ID
      );
      await deleteDoc(targetDocRef);
    }
  } catch (err: unknown) {
    if (err instanceof AdsProCreativeProfileError) {
      throw err;
    }
    const errorMsg = err instanceof Error ? err.message : String(err);
    const isPermissionError =
      errorMsg.includes("permission-denied") ||
      (typeof err === "object" && err !== null && (err as { code?: string }).code === "permission-denied");

    if (isPermissionError) {
      throw new AdsProCreativeProfileError(
        "PERMISSION_DENIED",
        `Permissão negada ao limpar Creative Profile para o usuário ${uid}.`,
        err
      );
    }
    throw new AdsProCreativeProfileError(
      "PERSISTENCE_FAILED",
      `Erro ao limpar Creative Profile: ${errorMsg}`,
      err
    );
  }
}
