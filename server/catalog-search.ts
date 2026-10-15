import type { Express, NextFunction, Request, Response } from "express";
import { FieldPath } from "firebase-admin/firestore";
import type { Firestore, Query, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { getFirebaseAdmin } from "./firebase-admin-init";
import { logError } from "./logger";
import {
  buildProductSearchBackfillPatch,
  buildProductServerSearchPlan,
  getProductSearchIndexField,
  normalizeProductSearchText,
  sanitizeProductSearchPageSize,
} from "../client/src/lib/product-search";
import type { Product } from "../client/src/lib/mock-data";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;
const ORDER_BY_NAME = "name";
const ORDER_BY_NORMALIZED_NAME = "nameNormalized";

type CursorOrderByField = typeof ORDER_BY_NAME | typeof ORDER_BY_NORMALIZED_NAME;

type CatalogProductsCursor = {
  orderByField: CursorOrderByField;
  sortValue: string;
  id: string;
};

type SearchMode = "list" | "barcode_exact" | "token" | "name_prefix";

type SearchResponse = {
  items: Product[];
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
};

function normalizeCategoryFilter(value: unknown): { raw: string; normalized: string; active: boolean } {
  const raw = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  const normalized = normalizeProductSearchText(raw);
  return {
    raw,
    normalized,
    active: Boolean(raw) && normalized !== "todos",
  };
}

function parseLimit(value: unknown): number {
  const sanitized = sanitizeProductSearchPageSize(value);
  return Math.max(1, Math.min(MAX_LIMIT, sanitized || DEFAULT_LIMIT));
}

function encodeCursor(cursor: CatalogProductsCursor | null): string | null {
  if (!cursor) return null;
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(value: unknown): CatalogProductsCursor | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<CatalogProductsCursor>;
    if (
      (parsed.orderByField === ORDER_BY_NAME || parsed.orderByField === ORDER_BY_NORMALIZED_NAME)
      && typeof parsed.sortValue === "string"
      && typeof parsed.id === "string"
      && parsed.id.trim().length > 0
    ) {
      return {
        orderByField: parsed.orderByField,
        sortValue: parsed.sortValue,
        id: parsed.id,
      };
    }
  } catch {
    return null;
  }
  return null;
}

function materializeProduct(doc: QueryDocumentSnapshot): Product {
  const base = { ...(doc.data() ?? {}), id: doc.id } as Product;
  const patch = buildProductSearchBackfillPatch(base);
  return patch ? { ...base, ...patch } : base;
}

function nextCursorFromDocs(
  docs: QueryDocumentSnapshot[],
  orderByField: CursorOrderByField,
): string | null {
  const lastDoc = docs[docs.length - 1];
  if (!lastDoc) return null;
  const product = materializeProduct(lastDoc);
  const sortValue = orderByField === ORDER_BY_NORMALIZED_NAME
    ? getProductSearchIndexField(product, "nameNormalized", product.name)
    : String(lastDoc.get("name") ?? product.name ?? "");
  return encodeCursor({
    orderByField,
    sortValue,
    id: lastDoc.id,
  });
}

function baseProductsQuery(db: Firestore, uid: string): Query {
  return db.collection("users").doc(uid).collection("products");
}

async function searchTenantProducts(input: {
  uid: string;
  query?: unknown;
  category?: unknown;
  limit?: unknown;
  cursor?: unknown;
}): Promise<SearchResponse> {
  const db = getFirebaseAdmin().firestore();
  const limit = parseLimit(input.limit ?? DEFAULT_LIMIT);
  const category = normalizeCategoryFilter(input.category);
  const plan = buildProductServerSearchPlan({
    term: input.query,
    pageSize: limit,
    serverSearchEnabled: true,
  });
  const mode: SearchMode = plan.kind === "barcode_exact"
    ? "barcode_exact"
    : plan.kind === "token"
      ? "token"
      : plan.kind === "name_prefix"
        ? "name_prefix"
        : "list";
  const expectedOrderByField = mode === "list" ? ORDER_BY_NAME : ORDER_BY_NORMALIZED_NAME;
  const cursor = decodeCursor(input.cursor);
  if (cursor && cursor.orderByField !== expectedOrderByField) {
    return { items: [], nextCursor: null, hasMore: false, limit };
  }

  let firestoreQuery = baseProductsQuery(db, input.uid);

  if (mode === "list") {
    if (category.active) {
      firestoreQuery = firestoreQuery.where("category", "==", category.raw);
    }
    firestoreQuery = firestoreQuery.orderBy(ORDER_BY_NAME).orderBy(FieldPath.documentId()).limit(limit + 1);
    if (cursor) firestoreQuery = firestoreQuery.startAfter(cursor.sortValue, cursor.id);
  } else {
    if (category.active) {
      firestoreQuery = firestoreQuery.where("categoryNormalized", "==", category.normalized);
    }

    if (mode === "barcode_exact") {
      firestoreQuery = firestoreQuery.where("barcodeNormalized", "==", plan.normalizedTerm);
    } else if (mode === "token") {
      firestoreQuery = firestoreQuery.where("searchTokens", "array-contains", plan.searchToken || plan.normalizedTerm);
    }

    firestoreQuery = firestoreQuery.orderBy(ORDER_BY_NORMALIZED_NAME).orderBy(FieldPath.documentId());

    if (mode === "name_prefix") {
      firestoreQuery = firestoreQuery.startAt(plan.normalizedTerm).endAt(`${plan.normalizedTerm}\uf8ff`);
    }
    if (cursor) {
      firestoreQuery = firestoreQuery.startAfter(cursor.sortValue, cursor.id);
    }

    firestoreQuery = firestoreQuery.limit(limit + 1);
  }

  const snapshot = await firestoreQuery.get();
  const docs = snapshot.docs.slice(0, limit);
  const items = docs.map(materializeProduct);
  const hasMore = snapshot.docs.length > limit;
  return {
    items,
    nextCursor: hasMore ? nextCursorFromDocs(docs, expectedOrderByField) : null,
    hasMore,
    limit,
  };
}

export function registerCatalogSearchRoutes(
  app: Express,
  requireAuth: (req: Request, res: Response, next: NextFunction) => unknown,
) {
  app.get("/api/catalog/products", requireAuth, async (req: Request, res: Response) => {
    const uid = (req as Request & { firebaseUid?: string }).firebaseUid;
    if (!uid) {
      return res.status(401).json({ code: "UNAUTHENTICATED", message: "Sua sessão expirou. Entre novamente." });
    }

    try {
      const result = await searchTenantProducts({
        uid,
        query: req.query.q,
        category: req.query.category,
        limit: req.query.limit,
        cursor: req.query.cursor,
      });
      return res.json(result);
    } catch (error) {
      logError("catalog.search.failed", {
        uid,
        query: typeof req.query.q === "string" ? req.query.q.slice(0, 80) : "",
        category: typeof req.query.category === "string" ? req.query.category.slice(0, 80) : "",
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({
        code: "CATALOG_SEARCH_FAILED",
        message: "Não foi possível buscar produtos agora. Tente novamente.",
      });
    }
  });
}
