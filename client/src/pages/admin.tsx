import { useState, useMemo } from "react";
import { Layout } from "@/components/layout";
import { 
  APP_VERSION, getCurrentUserId, getUsers
} from "@/lib/mock-data";
import { useDashboardData } from "@/hooks/useDashboardData";
import { useLocation } from "wouter";
import { getFirebaseAuth, logError } from "@/lib/firebase";
import { 
  ShieldCheck, Package, Users, CircleDollarSign, Receipt, 
  AlertTriangle, Activity, Database, Clock, ChevronRight, ToggleLeft, ToggleRight, Gift
} from "lucide-react";
import { format, subDays, isSameDay } from "@/lib/date-utils";
import { getApiUrl } from "@/lib/api-config";

export default function AdminMetrics() {
  const [, setLocation] = useLocation();
  const auth = getFirebaseAuth();
  const user = auth?.currentUser;
  
  // Get dashboard data from Firestore
  const { products, sales, clients, loading: dashboardLoading } = useDashboardData();
  
  // Reward grant form state
  const [grantTargetUserId, setGrantTargetUserId] = useState("");
  const [grantCount, setGrantCount] = useState("");
  const [grantReason, setGrantReason] = useState("");
  const [grantLoading, setGrantLoading] = useState(false);
  const [grantMessage, setGrantMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [globalConfigLoading, setGlobalConfigLoading] = useState(false);
  const [globalConfigMessage, setGlobalConfigMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [premiumOpenAccess, setPremiumOpenAccess] = useState(false);
  const [premiumOpenAccessUntil, setPremiumOpenAccessUntil] = useState("");
  const [premiumOpenAccessMessage, setPremiumOpenAccessMessage] = useState("");
  const [premiumTargetUserEmail, setPremiumTargetUserEmail] = useState("");
  const [premiumExpiresAt, setPremiumExpiresAt] = useState("");
  const [premiumManualReason, setPremiumManualReason] = useState("");
  const [premiumManualLoading, setPremiumManualLoading] = useState(false);
  const [premiumManualMessage, setPremiumManualMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const readJsonResponse = async (response: Response) => {
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    if (!contentType.includes("application/json")) {
      throw new Error(`Resposta inválida do servidor (${response.status}).`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("Resposta inválida do servidor.");
    }
  };

  const currentUser = useMemo(() => {
    if (!user) return null;
    try {
      const id = getCurrentUserId();
      return getUsers().find(u => u.id === id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      logError("admin_current_user_load_failed", msg, {
        userId: user.uid,
        severity: "warning",
      });
      return null;
    }
  }, [user]);

  // NOTE: Admin access is validated server-side via Firebase custom claims.
  // Frontend removes admin UI from view if user lacks claim.
  // No hardcoded email check here—backend is source of truth.
  useMemo(() => {
    if (!user) {
      setLocation("/login");
    }
  }, [currentUser, setLocation]);

  const stats = useMemo(() => {
    try {
      if (!products || !sales || !clients) return null;

      const today = new Date();
      
      // Calculate overdue charges from sales
      const overdueSales = sales.filter((s: any) => {
        if (s.status === 'paid' || s.status === 'completed') return false;
        if (!s.dueDate) return false;
        try {
          return new Date(s.dueDate) < today;
        } catch (e) { return false; }
      });

      // Last 7 days activity
      const last7Days = Array.from({ length: 7 }, (_, i) => {
        const date = subDays(new Date(), i);
        const daySales = sales.filter((s: any) => {
          try {
            const saleDate = new Date(s.date || s.createdAt || 0);
            return isSameDay(saleDate, date);
          } catch (e) { return false; }
        });
        return {
          date: format(date, 'dd/MM'),
          count: daySales.length,
          total: daySales.reduce((sum: number, s: any) => sum + (s.totalPrice || s.total || 0), 0)
        };
      });

      return {
        products: products.length,
        clients: clients.length,
        sales: sales.length,
        billings: sales.length,
        overdue: overdueSales.length,
        storeName: currentUser?.storeName || "Sem nome",
        userId: user?.uid || "N/A",
        activity: last7Days
      };
    } catch (e) {
      console.error("[AdminMetrics] Error calculating stats:", e);
      return null;
    }
  }, [products, sales, clients, currentUser, user]);

  const handleLoadGlobalConfig = async () => {
    try {
      const token = await auth?.currentUser?.getIdToken();
      if (!token) return;
      const response = await fetch(getApiUrl("/api/admin/global-config"), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await readJsonResponse(response);
      if (response.ok && data.config) {
        setPremiumOpenAccess(!!data.config.premiumOpenAccess);
        setPremiumOpenAccessUntil(data.config.premiumOpenAccessUntil ? String(data.config.premiumOpenAccessUntil).slice(0, 16) : "");
        setPremiumOpenAccessMessage(data.config.premiumOpenAccessMessage || "");
      }
 } catch (e) {
  console.error(e);
}
  };

  const handleSaveGlobalConfig = async () => {
    setGlobalConfigLoading(true);
    setGlobalConfigMessage(null);
    try {
      const token = await auth?.currentUser?.getIdToken();
      if (!token) throw new Error("Sem autenticação");
      const response = await fetch(getApiUrl("/api/admin/global-config"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          premiumOpenAccess,
          premiumOpenAccessUntil: premiumOpenAccessUntil ? new Date(premiumOpenAccessUntil).toISOString() : null,
          premiumOpenAccessMessage: premiumOpenAccessMessage || null,
        }),
      });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.message || "Erro ao salvar configuração global");
      setGlobalConfigMessage({ type: "success", text: "Configuração global salva com sucesso" });
    } catch (err) {
      setGlobalConfigMessage({ type: "error", text: err instanceof Error ? err.message : "Erro desconhecido" });
    } finally {
      setGlobalConfigLoading(false);
    }
  };

  const handleGrantPremiumManual = async () => {
    if (!premiumTargetUserEmail.trim()) {
      setPremiumManualMessage({ type: "error", text: "Informe o e-mail do usuário" });
      return;
    }
    setPremiumManualLoading(true);
    setPremiumManualMessage(null);
    try {
      const token = await auth?.currentUser?.getIdToken();
      if (!token) throw new Error("Sem autenticação");
      const response = await fetch(getApiUrl("/api/admin/premium-grant"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          targetUserEmail: premiumTargetUserEmail.trim(),
          premiumExpiresAt: premiumExpiresAt ? new Date(premiumExpiresAt).toISOString() : null,
          reason: premiumManualReason || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Erro ao conceder premium");
      setPremiumManualMessage({ type: "success", text: "Premium manual concedido com sucesso" });
    } catch (err) {
      setPremiumManualMessage({ type: "error", text: err instanceof Error ? err.message : "Erro desconhecido" });
    } finally {
      setPremiumManualLoading(false);
    }
  };

  const handleRevokePremiumManual = async () => {
    if (!premiumTargetUserEmail.trim()) {
      setPremiumManualMessage({ type: "error", text: "Informe o e-mail do usuário" });
      return;
    }
    setPremiumManualLoading(true);
    setPremiumManualMessage(null);
    try {
      const token = await auth?.currentUser?.getIdToken();
      if (!token) throw new Error("Sem autenticação");
      const response = await fetch(getApiUrl("/api/admin/premium-revoke"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ targetUserEmail: premiumTargetUserEmail.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Erro ao remover premium");
      setPremiumManualMessage({ type: "success", text: "Premium manual removido com sucesso" });
    } catch (err) {
      setPremiumManualMessage({ type: "error", text: err instanceof Error ? err.message : "Erro desconhecido" });
    } finally {
      setPremiumManualLoading(false);
    }
  };

  if (dashboardLoading) {
    return (
      <Layout title="Painel Admin">
        <div className="p-6 min-h-screen flex items-center justify-center bg-background">
          <div className="text-center space-y-4">
            <div className="w-12 h-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin mx-auto"></div>
            <p className="text-muted-foreground">Carregando painel...</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (!stats) {
    return (
      <Layout title="Painel Admin">
        <div className="p-6 text-center">
          <p className="text-destructive font-bold mb-2">Erro ao carregar painel</p>
          <p className="text-muted-foreground text-sm">Tente recarregar a página</p>
        </div>
      </Layout>
    );
  }

  const openAccessStateLabel = premiumOpenAccess
    ? (premiumOpenAccessUntil ? "Ativo com validade" : "Ativo sem expiração")
    : "Desligado";

  const handleGrantReward = async () => {
    // Validate inputs
    if (!grantTargetUserId.trim() || !grantCount || !grantReason.trim()) {
      setGrantMessage({ type: "error", text: "Preencha todos os campos" });
      return;
    }

    const count = parseInt(grantCount, 10);
    if (isNaN(count) || count <= 0) {
      setGrantMessage({ type: "error", text: "Quantidade deve ser um número positivo" });
      return;
    }

    setGrantLoading(true);
    setGrantMessage(null);

    try {
      const token = await auth?.currentUser?.getIdToken();
      if (!token) throw new Error("Sem autenticação");

      const response = await fetch(
        `${import.meta.env.VITE_API_BASE_URL || ""}/api/rewards/grant/${grantTargetUserId}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({ count, reason: grantReason }),
        }
      );

      const data = await response.json();

      if (response.ok) {
        setGrantMessage({ 
          type: "success", 
          text: `${count} recompensa(s) concedida(s) com sucesso para ${grantTargetUserId}` 
        });
        // Reset form
        setGrantTargetUserId("");
        setGrantCount("");
        setGrantReason("");
        setTimeout(() => setGrantMessage(null), 5000);
      } else {
        setGrantMessage({ 
          type: "error", 
          text: data.message || "Erro ao conceder recompensa" 
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      setGrantMessage({ type: "error", text: msg });
    } finally {
      setGrantLoading(false);
    }
  };

  return (
    <Layout title="Painel Admin">
      <div className="p-6 pb-32 space-y-6 bg-background min-h-full">
        <div className="bg-primary/10 p-4 rounded-3xl border border-primary/20 flex items-center gap-3">
          <ShieldCheck className="w-6 h-6 text-primary" />
          <div>
            <p className="text-[10px] font-black text-primary uppercase tracking-widest">Acesso Restrito</p>
            <p className="text-xs font-bold">{currentUser?.email}</p>
          </div>
        </div>

        <div className="bg-amber-50 p-6 rounded-[2.5rem] border border-amber-100 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black text-amber-900 uppercase tracking-widest">Liberação Global Premium</p>
              <p className="text-xs text-amber-700 font-medium">{openAccessStateLabel}</p>
            </div>
            <button
              onClick={() => setPremiumOpenAccess((v) => !v)}
              className="flex items-center gap-2 text-amber-700 font-bold text-sm"
              data-testid="button-toggle-open-access"
            >
              {premiumOpenAccess ? <ToggleRight className="w-6 h-6" /> : <ToggleLeft className="w-6 h-6" />}
            </button>
          </div>
          <div className="space-y-3">
            <input
              type="datetime-local"
              value={premiumOpenAccessUntil}
              onChange={(e) => setPremiumOpenAccessUntil(e.target.value)}
              className="w-full bg-white border border-amber-200 rounded-xl p-3 text-[11px] focus:ring-2 focus:ring-amber-400 outline-none"
              data-testid="input-open-access-until"
            />
            <textarea
              value={premiumOpenAccessMessage}
              onChange={(e) => setPremiumOpenAccessMessage(e.target.value)}
              className="w-full bg-white border border-amber-200 rounded-xl p-3 text-[11px] focus:ring-2 focus:ring-amber-400 outline-none"
              rows={3}
              placeholder="Mensagem opcional"
              data-testid="input-open-access-message"
            />
            <button
              onClick={handleSaveGlobalConfig}
              disabled={globalConfigLoading}
              className="w-full bg-amber-600 text-white font-black py-3 rounded-2xl uppercase text-[10px] active:scale-95 transition-all disabled:opacity-50"
              data-testid="button-save-open-access"
            >
              {globalConfigLoading ? "Salvando..." : "Salvar liberação global"}
            </button>
            <button
              onClick={handleLoadGlobalConfig}
              className="w-full text-amber-700 font-bold text-xs underline"
              data-testid="button-load-open-access"
            >
              Atualizar estado
            </button>
          </div>
          {globalConfigMessage && (
            <p className={`text-xs font-bold ${globalConfigMessage.type === "success" ? "text-green-700" : "text-red-700"}`} data-testid={`text-open-access-message-${globalConfigMessage.type}`}>
              {globalConfigMessage.text}
            </p>
          )}
        </div>

        <div className="bg-white p-6 rounded-[2.5rem] border border-border/50 shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <Gift className="w-4 h-4 text-primary" />
            <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Premium manual por usuário</h3>
          </div>
          <input
            type="email"
            placeholder="E-mail do usuário"
            value={premiumTargetUserEmail}
            onChange={(e) => setPremiumTargetUserEmail(e.target.value)}
            className="w-full bg-secondary/40 border border-border rounded-xl p-3 text-[11px] outline-none"
            data-testid="input-manual-premium-user"
          />
          <input
            type="datetime-local"
            value={premiumExpiresAt}
            onChange={(e) => setPremiumExpiresAt(e.target.value)}
            className="w-full bg-secondary/40 border border-border rounded-xl p-3 text-[11px] outline-none"
            data-testid="input-manual-premium-expires"
          />
          <input
            type="text"
            placeholder="Motivo opcional"
            value={premiumManualReason}
            onChange={(e) => setPremiumManualReason(e.target.value)}
            className="w-full bg-secondary/40 border border-border rounded-xl p-3 text-[11px] outline-none"
            data-testid="input-manual-premium-reason"
          />
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={handleGrantPremiumManual}
              disabled={premiumManualLoading}
              className="bg-amber-600 text-white font-black py-3 rounded-2xl text-[10px] uppercase disabled:opacity-50"
              data-testid="button-grant-manual-premium"
            >
              Conceder premium
            </button>
            <button
              onClick={handleRevokePremiumManual}
              disabled={premiumManualLoading}
              className="bg-gray-900 text-white font-black py-3 rounded-2xl text-[10px] uppercase disabled:opacity-50"
              data-testid="button-revoke-manual-premium"
            >
              Remover premium
            </button>
          </div>
          {premiumManualMessage && (
            <p className={`text-xs font-bold ${premiumManualMessage.type === "success" ? "text-green-700" : "text-red-700"}`} data-testid={`text-manual-premium-message-${premiumManualMessage.type}`}>
              {premiumManualMessage.text}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <MetricCard icon={Package} label="Produtos" value={stats.products} color="blue" />
          <MetricCard icon={Users} label="Clientes" value={stats.clients} color="purple" />
          <MetricCard icon={CircleDollarSign} label="Vendas" value={stats.sales} color="green" />
          <MetricCard icon={Receipt} label="Cobranças" value={stats.billings} color="orange" />
        </div>

        <div className="bg-destructive/5 p-6 rounded-[2.5rem] border border-destructive/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-destructive/10 rounded-2xl flex items-center justify-center text-destructive">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <p className="text-[10px] font-black text-destructive uppercase tracking-widest">Inadimplência</p>
              <p className="text-xl font-black text-destructive">{stats.overdue} Pendentes</p>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-[2.5rem] border border-border/50 shadow-sm space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-primary" />
            <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Atividade 7 Dias</h3>
          </div>
          <div className="space-y-3">
            {stats.activity.map((day, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                <span className="text-xs font-bold text-muted-foreground">{day.date}</span>
                <div className="flex items-center gap-4">
                  <span className="text-[10px] font-black bg-secondary px-2 py-1 rounded-lg uppercase">{day.count} vendas</span>
                  <span className="text-xs font-black text-primary">R$ {day.total.toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Reward Granting Section */}
        <div className="bg-amber-50 p-6 rounded-[2.5rem] border border-amber-100 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <CircleDollarSign className="w-4 h-4 text-amber-700" />
            <h3 className="text-[10px] font-black text-amber-900 uppercase tracking-widest">Conceder Recompensa</h3>
          </div>
          
          {grantMessage && (
            <div className={`p-4 rounded-xl text-[10px] font-bold border flex items-start gap-3 ${
              grantMessage.type === "success" 
                ? "bg-green-50 text-green-900 border-green-200" 
                : "bg-red-50 text-red-900 border-red-200"
            }`} data-testid={`admin-grant-message-${grantMessage.type}`}>
              <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-white text-[8px] font-black ${
                grantMessage.type === "success" ? "bg-green-600" : "bg-red-600"
              }`}>
                {grantMessage.type === "success" ? "✓" : "!"}
              </div>
              <p className="flex-1">{grantMessage.text}</p>
            </div>
          )}

          <div className="space-y-3">
            <div>
              <label className="text-[10px] font-bold text-amber-900 uppercase tracking-wider block mb-2">User ID do Beneficiário</label>
              <input
                type="text"
                placeholder="Cole o UID do usuário"
                value={grantTargetUserId}
                onChange={(e) => setGrantTargetUserId(e.target.value)}
                className="w-full bg-white border border-amber-200 rounded-xl p-3 text-[11px] focus:ring-2 focus:ring-amber-400 outline-none placeholder-amber-300/50"
                disabled={grantLoading}
                data-testid="input-grant-target-userid"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-amber-900 uppercase tracking-wider block mb-2">Quantidade</label>
                <input
                  type="number"
                  placeholder="1"
                  value={grantCount}
                  onChange={(e) => setGrantCount(e.target.value)}
                  className="w-full bg-white border border-amber-200 rounded-xl p-3 text-[11px] focus:ring-2 focus:ring-amber-400 outline-none"
                  min="1"
                  disabled={grantLoading}
                  data-testid="input-grant-count"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-amber-900 uppercase tracking-wider block mb-2">Motivo</label>
                <select
                  value={grantReason}
                  onChange={(e) => setGrantReason(e.target.value)}
                  className="w-full bg-white border border-amber-200 rounded-xl p-3 text-[11px] focus:ring-2 focus:ring-amber-400 outline-none"
                  disabled={grantLoading}
                  data-testid="select-grant-reason"
                >
                  <option value="">Selecione</option>
                  <option value="Indicações verificadas">Verificadas</option>
                  <option value="Programa de crescimento">Crescimento</option>
                  <option value="Compensação">Compensação</option>
                  <option value="Bônus especial">Bônus especial</option>
                  <option value="Outro">Outro</option>
                </select>
              </div>
            </div>

            <button
              onClick={handleGrantReward}
              disabled={grantLoading || !grantTargetUserId || !grantCount || !grantReason}
              className="w-full bg-amber-600 text-white font-black py-3 rounded-2xl uppercase text-[10px] active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              data-testid="button-grant-reward"
            >
              {grantLoading ? (
                <>
                  <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  Concedendo...
                </>
              ) : (
                "💾 Conceder Recompensa"
              )}
            </button>
          </div>
        </div>

        <button
          onClick={() => setLocation("/billings")}
          className="w-full bg-gradient-to-r from-orange-500 to-orange-600 text-white p-6 rounded-[2.5rem] border border-orange-400/30 shadow-md hover:shadow-lg active:scale-95 transition-all flex items-center justify-between group"
          data-testid="button-admin-manage-charges"
        >
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center group-hover:bg-white/30 transition-colors">
              <Receipt className="w-6 h-6" />
            </div>
            <div className="text-left">
              <p className="text-[10px] font-black uppercase tracking-widest opacity-90">Ação Rápida</p>
              <p className="text-xs font-black">Gerenciar Cobranças</p>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
        </button>

        <div className="bg-secondary/30 p-6 rounded-[2.5rem] space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <Database className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Info do Sistema</h3>
          </div>
          <div className="grid grid-cols-1 gap-2 text-[10px] font-bold uppercase text-muted-foreground/70">
            <div className="flex justify-between"><span>Versão</span> <span className="text-primary">{APP_VERSION}</span></div>
            <div className="flex justify-between"><span>User ID</span> <span>{stats.userId}</span></div>
            <div className="flex justify-between"><span>Loja</span> <span>{stats.storeName}</span></div>
          </div>
        </div>
      </div>
    </Layout>
  );
}

function MetricCard({ icon: Icon, label, value, color }: any) {
  const colors: any = {
    blue: "bg-blue-50 text-blue-600 border-blue-100",
    purple: "bg-purple-50 text-purple-600 border-purple-100",
    green: "bg-green-50 text-green-600 border-green-100",
    orange: "bg-orange-50 text-orange-600 border-orange-100",
  };
  return (
    <div className={`p-5 rounded-[2rem] border ${colors[color]} space-y-2 shadow-sm`}>
      <Icon className="w-5 h-5 opacity-70" />
      <div>
        <p className="text-[8px] font-black uppercase tracking-wider opacity-60">{label}</p>
        <p className="text-xl font-black leading-none">{value}</p>
      </div>
    </div>
  );
}
