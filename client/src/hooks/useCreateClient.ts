import { useState } from "react";
import { collection, getCountFromServer, getFirestore } from "firebase/firestore";
import { getFirebaseAuth, logTelemetryEvent } from "@/lib/firebase";
import { notifySuccess } from "@/lib/notify";
import type { Client } from "@/lib/mock-data";
import { usePlan } from "@/providers/PlanProvider";
import { checkClientLimit } from "@/lib/plan-helpers";
import { buildLimitReachedCopy } from "@/lib/plan-paywall-copy";
import { apiRequest } from "@/lib/api-client";

interface CreateClientInput {
  name: string;
  phone: string;
}

/** Mesmo cadastro rápido de cliente já usado em Vendas — reaproveitado aqui para não duplicar a lógica em Pedidos. */
export function useCreateClient() {
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");
  const { activePlan } = usePlan();

  const createClient = async ({ name, phone }: CreateClientInput): Promise<Client | null> => {
    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();
    if (!trimmedName) {
      setError("Informe o nome do cliente.");
      return null;
    }
    const uid = getFirebaseAuth()?.currentUser?.uid;
    if (!uid) {
      setError("Sua sessão expirou. Entre novamente para cadastrar o cliente.");
      return null;
    }
    setIsCreating(true);
    setError("");
    try {
      // PLAN-IMPL-02A §5 — this "quick add" flow (used by NewOrderSheet.tsx) wrote directly to Firestore
      // with no plan-limit check, a fourth independent client-creation path with no enforcement at all.
      const clientCountSnapshot = await getCountFromServer(collection(getFirestore(), "users", uid, "clients"));
      if (!checkClientLimit(activePlan, clientCountSnapshot.data().count).allowed) {
        setError(buildLimitReachedCopy("clients", activePlan).title);
        return null;
      }
      const clientId = Math.random().toString(36).slice(2, 11);
      const clientData: Client = { id: clientId, name: trimmedName, phone: trimmedPhone };
      await apiRequest("/api/clients", { method: "POST", auth: true, body: { clientId, idempotencyKey: `client-create-${clientId}`, client: clientData } });
      notifySuccess("Cliente cadastrado.");
      logTelemetryEvent("client_created_from_order" as any, { clientId }, uid).catch(() => {});
      return clientData;
    } catch (err) {
      console.error("[useCreateClient] Failed to create client", err);
      setError("Não foi possível cadastrar o cliente. Tente novamente.");
      return null;
    } finally {
      setIsCreating(false);
    }
  };

  return { createClient, isCreating, error, setError };
}
