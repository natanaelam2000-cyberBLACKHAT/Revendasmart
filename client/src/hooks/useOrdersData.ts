import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, getFirestore, onSnapshot, setDoc } from "firebase/firestore";
import { getFirebaseAuth, logTelemetryEvent } from "@/lib/firebase";
import { apiRequest } from "@/lib/api-client";
import {
  calculateOrderTotal,
  normalizeOrderPhone,
  resolveOrderPaymentMethod,
  resolveOrderPaymentStatus,
  resolveOrderStatus,
  type Order,
  type OrderItem,
  type OrderStatus,
} from "@/lib/orders";

interface CreateOrderInput {
  clientId: string;
  clientName: string;
  items: OrderItem[];
  expectedDate?: string;
  notes?: string;
  /** Snapshots opcionais, gravados só na criação (ver Order.clientPhone/storeName). */
  clientPhone?: string;
  storeName?: string;
}

interface OrdersData {
  orders: Order[];
  loading: boolean;
  error?: string;
  createOrder: (input: CreateOrderInput) => Promise<Order>;
  updateOrderStatus: (orderId: string, status: OrderStatus) => Promise<void>;
  /** Único caminho que transiciona paymentStatus para "paid" no app do lojista — sempre via servidor
   * (Admin SDK), nunca por escrita direta do cliente no Firestore (a Rule de orders não permite mexer
   * em paymentStatus — ver `firestore.rules` `isValidOrderUpdate`). */
  confirmOrderPayment: (orderId: string) => Promise<void>;
}

function mapOrderDoc(id: string, data: Record<string, unknown>): Order {
  return {
    id,
    clientId: String(data.clientId || ""),
    clientName: String(data.clientName || ""),
    status: resolveOrderStatus(data.status),
    items: Array.isArray(data.items) ? data.items as OrderItem[] : [],
    total: Number(data.total) || 0,
    createdAt: String(data.createdAt || ""),
    updatedAt: String(data.updatedAt || ""),
    expectedDate: typeof data.expectedDate === "string" ? data.expectedDate : undefined,
    notes: typeof data.notes === "string" ? data.notes : undefined,
    // Pedidos criados antes destes snapshots existirem simplesmente não têm os campos.
    clientPhone: typeof data.clientPhone === "string" ? data.clientPhone : undefined,
    storeName: typeof data.storeName === "string" ? data.storeName : undefined,
    // Só presentes em pedidos originados do checkout do catálogo público — pedidos manuais (criados
    // pelo lojista aqui no app) nunca gravam estes campos.
    paymentMethod: resolveOrderPaymentMethod(data.paymentMethod),
    paymentProvider: typeof data.paymentProvider === "string" ? data.paymentProvider as Order["paymentProvider"] : undefined,
    paymentStatus: resolveOrderPaymentStatus(data.paymentStatus),
    clientOrderId: typeof data.clientOrderId === "string" ? data.clientOrderId : undefined,
  };
}

/**
 * A subcoleção `users/{uid}/orders` tem regras dedicadas em firestore.rules (isValidOrderCreate/
 * isValidOrderUpdate) — create/read só funcionam depois que essas regras forem publicadas com
 * `firebase deploy --only firestore:rules`. Update do cliente só pode alterar status/updatedAt.
 */
export function useOrdersData(): OrdersData {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setLoading(false);
      setError("Firebase not initialized");
      return;
    }

    let unsubscribeOrders: (() => void) | undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeOrders?.();

      if (!user) {
        setOrders([]);
        setLoading(false);
        setError("Not authenticated");
        return;
      }

      setLoading(true);
      unsubscribeOrders = onSnapshot(
        collection(getFirestore(), "users", user.uid, "orders"),
        (snapshot) => {
          const data = snapshot.docs
            .map((docSnap) => mapOrderDoc(docSnap.id, docSnap.data()))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          setOrders(data);
          setError(undefined);
          setLoading(false);
        },
        (err) => {
          console.error("[useOrdersData] Orders error:", err);
          setOrders([]);
          setError("Failed to load orders");
          setLoading(false);
        }
      );
    });

    return () => {
      unsubscribeOrders?.();
      unsubscribeAuth();
    };
  }, []);

  const createOrder = useCallback(async (input: CreateOrderInput): Promise<Order> => {
    const auth = getFirebaseAuth();
    const uid = auth?.currentUser?.uid;
    if (!uid) throw new Error("Sua sessão expirou. Entre novamente para criar o pedido.");

    const orderId = Math.random().toString(36).slice(2, 11);
    // Mesmo valor nos dois campos: a Rule de create exige createdAt == updatedAt para provar que o
    // documento acabou de nascer e não é uma edição disfarçada de criação.
    const now = new Date().toISOString();
    const clientPhone = normalizeOrderPhone(input.clientPhone);
    const storeName = typeof input.storeName === "string" ? input.storeName.trim() : "";
    const order: Order = {
      id: orderId,
      clientId: input.clientId,
      clientName: input.clientName,
      status: "new",
      items: input.items,
      total: calculateOrderTotal(input.items),
      createdAt: now,
      updatedAt: now,
      ...(input.expectedDate ? { expectedDate: input.expectedDate } : {}),
      ...(input.notes ? { notes: input.notes } : {}),
      // Snapshots só entram quando têm valor real — string vazia viraria um campo inútil no documento
      // e um telefone inválido é descartado por normalizeOrderPhone em vez de gravado torto.
      ...(clientPhone ? { clientPhone } : {}),
      ...(storeName ? { storeName } : {}),
    };

    // O SDK do Firestore rejeita campos com valor undefined (setDoc lança em runtime) — expectedDate/
    // notes têm que ficar totalmente ausentes do documento quando não preenchidos, nunca "presentes
    // com undefined". Isso também deixa o payload real batendo exatamente com o que a Rule valida.
    await setDoc(doc(getFirestore(), "users", uid, "orders", orderId), order);
    logTelemetryEvent("order_created" as any, { orderId, itemCount: order.items.length }, uid).catch(() => {});
    return order;
  }, []);

  const updateOrderStatus = useCallback(async (orderId: string, status: OrderStatus): Promise<void> => {
    const auth = getFirebaseAuth();
    const uid = auth?.currentUser?.uid;
    if (!uid) throw new Error("Sua sessão expirou. Entre novamente.");

    await setDoc(
      doc(getFirestore(), "users", uid, "orders", orderId),
      { status, updatedAt: new Date().toISOString() },
      { merge: true }
    );
    logTelemetryEvent("order_status_updated" as any, { orderId, status }, uid).catch(() => {});
  }, []);

  const confirmOrderPayment = useCallback(async (orderId: string): Promise<void> => {
    await apiRequest(`/api/orders/${encodeURIComponent(orderId)}/confirm-payment`, { method: "POST", auth: true });
  }, []);

  return { orders, loading, error, createOrder, updateOrderStatus, confirmOrderPayment };
}
