import { useState } from "react";
import { Search, ShieldCheck, UserCheck, UserX, Crown, XCircle } from "lucide-react";
import { apiRequest, buildApiErrorDisplayMessage } from "@/lib/api-client";
import { getFirebaseAuth } from "@/lib/firebase";
import { notifyError, notifySuccess } from "@/lib/notify";

/**
 * REVENDASMART-OWNER-ACCESS-02 §9 — seção "Administração", só renderizada pela página que já confirmou
 * `useAdminAccess().isAdmin` (settings.tsx). Mesmo assim, toda mutação aqui passa de novo por
 * `requireAdmin` no servidor (server/admin-grants.ts) — esconder a UI nunca é a autoridade real.
 *
 * Isolado em componente próprio (lazy-loaded pela página) para não inflar o bundle de `settings` para
 * os 99% dos usuários que nunca são admin.
 */
type LookupResult = {
  uid: string;
  email: string | null;
  role: "admin" | "user";
  benefitGrant: "none" | "tester" | "premium_plus";
  commercialPlan: string;
  hasPremiumAccess: boolean;
  premiumExpiresAt: unknown;
  reason: string | null;
};

async function authedRequest<T>(path: string, options: Parameters<typeof apiRequest>[1] = {}): Promise<T> {
  const user = getFirebaseAuth()?.currentUser;
  if (!user) throw new Error("Sessão inválida.");
  return apiRequest<T>(path, { ...options, auth: true, getAuthToken: () => user.getIdToken() });
}

function formatExpiresAt(value: unknown): string | null {
  if (!value) return null;
  const candidate = value as { _seconds?: number; seconds?: number };
  const seconds = typeof candidate?._seconds === "number" ? candidate._seconds : typeof candidate?.seconds === "number" ? candidate.seconds : null;
  const date = seconds !== null ? new Date(seconds * 1000) : new Date(value as string);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("pt-BR", { year: "numeric", month: "long", day: "numeric" });
}

export function AdminGrantsPanel() {
  const [email, setEmail] = useState("");
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [mutating, setMutating] = useState<string | null>(null);
  const [testerCount, setTesterCount] = useState<number | null>(null);

  const loadTesterCount = async () => {
    try {
      const data = await authedRequest<{ count: number }>("/api/admin/testers/count");
      setTesterCount(data.count);
    } catch {
      // Referência operacional — falha aqui não bloqueia o resto do painel.
    }
  };

  const handleSearch = async () => {
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes("@")) {
      notifyError("Informe um e-mail válido.");
      return;
    }
    setSearching(true);
    setNotFound(false);
    setResult(null);
    try {
      const data = await authedRequest<LookupResult>(`/api/admin/users/lookup?email=${encodeURIComponent(trimmed)}`);
      setResult(data);
      void loadTesterCount();
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes("not_found")) {
        setNotFound(true);
      } else {
        notifyError(buildApiErrorDisplayMessage(error, "Não foi possível buscar este usuário."));
      }
    } finally {
      setSearching(false);
    }
  };

  const applyAction = async (action: "GRANT_TESTER" | "REVOKE_TESTER" | "GRANT_PREMIUM_PLUS" | "REVOKE_PREMIUM_PLUS") => {
    if (!result) return;
    setMutating(action);
    try {
      const response = await authedRequest<{ benefitGrant: LookupResult["benefitGrant"] }>(`/api/admin/grants/${result.uid}`, {
        method: "POST",
        body: { action },
      });
      setResult({ ...result, benefitGrant: response.benefitGrant, hasPremiumAccess: response.benefitGrant !== "none" || result.hasPremiumAccess });
      notifySuccess("Concessão atualizada.");
      void loadTesterCount();
    } catch (error) {
      notifyError(buildApiErrorDisplayMessage(error, "Não foi possível atualizar a concessão."));
    } finally {
      setMutating(null);
    }
  };

  const expiresLabel = result ? formatExpiresAt(result.premiumExpiresAt) : null;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-black text-primary uppercase tracking-wider">Administração</p>
        <h2 className="text-2xl font-black mt-1">Contas internas</h2>
        <p className="text-sm text-muted-foreground mt-1">Buscar usuário e gerenciar Tester/Premium+.</p>
      </div>

      {testerCount !== null && (
        <div className="rounded-2xl border border-border/60 bg-secondary/30 px-4 py-3 text-xs font-bold text-foreground" data-testid="text-tester-count">
          Testers atuais: {testerCount} / 14
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void handleSearch(); }}
          placeholder="email@exemplo.com"
          className="flex-1 rounded-2xl border border-border bg-card px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
          data-testid="input-admin-search-email"
        />
        <button
          type="button"
          onClick={() => void handleSearch()}
          disabled={searching}
          className="rounded-2xl bg-primary px-4 text-white disabled:opacity-60"
          data-testid="button-admin-search"
        >
          <Search className="h-4 w-4" />
        </button>
      </div>

      {notFound && (
        <p className="text-xs font-semibold text-muted-foreground">Nenhuma conta encontrada com este e-mail.</p>
      )}

      {result && (
        <div className="rounded-[1.5rem] border border-border/60 bg-card p-5 space-y-4" data-testid="panel-admin-user-result">
          <div className="space-y-1">
            <p className="text-sm font-black text-foreground">{result.email}</p>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">UID: {result.uid}</p>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-xl bg-secondary/40 p-3">
              <p className="font-bold uppercase tracking-wider text-muted-foreground text-[9px]">Papel</p>
              <p className="mt-1 font-black flex items-center gap-1">{result.role === "admin" && <ShieldCheck className="h-3.5 w-3.5 text-primary" />} {result.role === "admin" ? "Admin" : "Usuário"}</p>
            </div>
            <div className="rounded-xl bg-secondary/40 p-3">
              <p className="font-bold uppercase tracking-wider text-muted-foreground text-[9px]">Benefício interno</p>
              <p className="mt-1 font-black">{result.benefitGrant === "tester" ? "Tester" : result.benefitGrant === "premium_plus" ? "Premium+" : "Nenhum"}</p>
            </div>
            <div className="rounded-xl bg-secondary/40 p-3">
              <p className="font-bold uppercase tracking-wider text-muted-foreground text-[9px]">Plano comercial</p>
              <p className="mt-1 font-black capitalize">{result.commercialPlan}</p>
            </div>
            <div className="rounded-xl bg-secondary/40 p-3">
              <p className="font-bold uppercase tracking-wider text-muted-foreground text-[9px]">Expiração</p>
              <p className="mt-1 font-black">{expiresLabel || "—"}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-2 border-t border-border/40">
            {result.benefitGrant === "tester" ? (
              <button type="button" onClick={() => void applyAction("REVOKE_TESTER")} disabled={mutating !== null} className="flex items-center gap-1.5 rounded-xl bg-secondary px-3 py-2 text-[11px] font-bold text-foreground disabled:opacity-60" data-testid="button-revoke-tester">
                <UserX className="h-3.5 w-3.5" /> Remover Tester
              </button>
            ) : (
              <button type="button" onClick={() => void applyAction("GRANT_TESTER")} disabled={mutating !== null} className="flex items-center gap-1.5 rounded-xl bg-primary/10 px-3 py-2 text-[11px] font-bold text-primary disabled:opacity-60" data-testid="button-grant-tester">
                <UserCheck className="h-3.5 w-3.5" /> Tornar Tester
              </button>
            )}
            {result.benefitGrant === "premium_plus" ? (
              <button type="button" onClick={() => void applyAction("REVOKE_PREMIUM_PLUS")} disabled={mutating !== null} className="flex items-center gap-1.5 rounded-xl bg-secondary px-3 py-2 text-[11px] font-bold text-foreground disabled:opacity-60" data-testid="button-revoke-premium-plus">
                <XCircle className="h-3.5 w-3.5" /> Remover Premium+
              </button>
            ) : (
              <button type="button" onClick={() => void applyAction("GRANT_PREMIUM_PLUS")} disabled={mutating !== null} className="flex items-center gap-1.5 rounded-xl bg-amber-100 px-3 py-2 text-[11px] font-bold text-amber-700 disabled:opacity-60" data-testid="button-grant-premium-plus">
                <Crown className="h-3.5 w-3.5" /> Conceder Premium+
              </button>
            )}
          </div>
          {(result.benefitGrant === "tester" || result.benefitGrant === "premium_plus") && (
            <p className="text-[10px] text-muted-foreground">Tester e Premium+ são exclusivos entre si — conceder um substitui o outro automaticamente.</p>
          )}
        </div>
      )}
    </div>
  );
}
