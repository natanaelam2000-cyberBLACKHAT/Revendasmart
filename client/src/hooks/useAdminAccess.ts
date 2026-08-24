import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { apiRequest } from "@/lib/api-client";
import { getFirebaseAuth } from "@/lib/firebase";

/**
 * RELEASE V1 §4.1 — único jeito do client saber se o usuário logado é admin/dev, para ESCONDER (não só
 * bloquear no backend) Anúncios Pro e o scanner de código de barras. Autoridade real continua sendo o
 * servidor: `GET /api/admin/status` só responde 200 quando `requireAdmin` (custom claim Firebase Auth)
 * aprova — este hook nunca decide sozinho, só espelha a resposta. Fail-closed: qualquer coisa que não
 * seja um 200 explícito (403, rede fora do ar, sessão expirada) deixa `isAdmin=false`.
 */
interface AdminAccessState {
  readonly isAdmin: boolean;
  readonly loading: boolean;
}

async function fetchIsAdmin(user: User): Promise<boolean> {
  try {
    const result = await apiRequest<{ isAdmin: boolean }>("/api/admin/status", {
      auth: true,
      getAuthToken: () => user.getIdToken(),
    });
    return result.isAdmin === true;
  } catch {
    // 403 (não-admin) é o caminho normal para a grande maioria dos usuários — nunca loga como erro,
    // e qualquer outra falha (rede, 401, 500) também cai em "não é admin" (fail-closed).
    return false;
  }
}

export function useAdminAccess(): AdminAccessState {
  const [state, setState] = useState<AdminAccessState>({ isAdmin: false, loading: true });
  const requestIdRef = useRef(0);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setState({ isAdmin: false, loading: false });
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      const requestId = ++requestIdRef.current;
      if (!user) {
        setState({ isAdmin: false, loading: false });
        return;
      }
      setState((current) => ({ ...current, loading: true }));
      void fetchIsAdmin(user).then((isAdmin) => {
        // Ignora respostas de uma troca de usuário anterior que chegou atrasada.
        if (requestIdRef.current !== requestId) return;
        setState({ isAdmin, loading: false });
      });
    });

    return () => unsubscribe();
  }, []);

  return state;
}
