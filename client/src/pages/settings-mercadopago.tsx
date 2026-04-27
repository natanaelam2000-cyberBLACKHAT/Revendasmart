import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import {
  Link2, CheckCircle, XCircle, AlertCircle, RefreshCw,
  ExternalLink, Shield, Clock, Star, Trash2, ChevronLeft
} from "lucide-react";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  useMPConnections,
  startMPOAuth,
  revokeMPConnection,
  setDefaultMPConnection,
  type MPConnectionSafeView,
} from "@/hooks/useMPConnections";

const STATUS_LABELS: Record<string, string> = {
  active:  "Ativa",
  revoked: "Revogada",
  expired: "Expirada",
};

const STATUS_COLORS: Record<string, string> = {
  active:  "bg-green-100 text-green-700",
  revoked: "bg-gray-100 text-gray-500",
  expired: "bg-red-100 text-red-700",
};

export default function SettingsMercadoPago() {
  const [, setLocation] = useLocation();
  const { connections, loading, error } = useMPConnections();
  const [connecting, setConnecting] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Read OAuth callback status from URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status");
    if (status === "success") {
      setFeedback({ type: "success", message: "Conta Mercado Pago conectada com sucesso!" });
      window.history.replaceState({}, "", window.location.pathname);
    } else if (status === "denied") {
      setFeedback({ type: "error", message: "Autorização negada pelo Mercado Pago." });
      window.history.replaceState({}, "", window.location.pathname);
    } else if (status === "error") {
      const reason = params.get("reason") ?? "unknown";
      setFeedback({ type: "error", message: `Erro na conexão: ${reason}` });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    setFeedback(null);
    try {
      const result = await startMPOAuth();
      if (result?.authUrl) {
        window.location.href = result.authUrl;
      } else {
        setFeedback({ type: "error", message: "Erro ao iniciar conexão. Verifique a configuração." });
      }
    } catch {
      setFeedback({ type: "error", message: "Erro inesperado ao iniciar conexão." });
    } finally {
      setConnecting(false);
    }
  };

  const handleRevoke = async (conn: MPConnectionSafeView) => {
    if (!confirm(`Deseja desconectar a conta ${conn.accountEmail}?\nIsso não apagará o histórico.`)) {
      return;
    }
    setActionLoading(conn.id);
    try {
      const ok = await revokeMPConnection(conn.id);
      if (ok) {
        setFeedback({ type: "success", message: "Conta desconectada com sucesso." });
      } else {
        setFeedback({ type: "error", message: "Erro ao desconectar conta." });
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleSetDefault = async (conn: MPConnectionSafeView) => {
    setActionLoading(conn.id);
    try {
      const ok = await setDefaultMPConnection(conn.id);
      if (ok) {
        setFeedback({ type: "success", message: "Conta padrão atualizada." });
      } else {
        setFeedback({ type: "error", message: "Erro ao definir conta padrão." });
      }
    } finally {
      setActionLoading(null);
    }
  };

  const isExpiringSoon = (conn: MPConnectionSafeView): boolean => {
    const expiresAt = new Date(conn.accessTokenExpiresAt).getTime();
    return expiresAt - Date.now() < 60 * 60 * 1000; // Less than 1 hour
  };

  if (loading) {
    return (
      <Layout title="Mercado Pago">
        <div className="flex flex-col items-center justify-center py-12">
          <div className="w-12 h-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
          <p className="text-muted-foreground mt-4 text-sm">Carregando conexões...</p>
        </div>
      </Layout>
    );
  }

  const activeConnections = connections.filter((c) => c.status === "active");
  const revokedConnections = connections.filter((c) => c.status !== "active");

  return (
    <Layout title="Mercado Pago">
      <div className="p-6 max-w-lg mx-auto">
        {/* Back button */}
        <button
          data-testid="button-back-mp-settings"
          onClick={() => setLocation("/settings")}
          className="flex items-center gap-2 text-muted-foreground text-xs font-bold uppercase mb-6 active:opacity-70"
        >
          <ChevronLeft className="w-4 h-4" /> Voltar
        </button>

        {/* Header */}
        <div className="mb-6">
          <h1 className="font-black text-xl">Minha Conta MP</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Conecte sua conta Mercado Pago para receber os pagamentos diretamente.
          </p>
        </div>

        {/* Feedback banner */}
        {feedback && (
          <div
            className={`mb-4 p-4 rounded-2xl flex items-center gap-3 text-sm ${
              feedback.type === "success"
                ? "bg-green-50 border border-green-200 text-green-800"
                : "bg-red-50 border border-red-200 text-red-800"
            }`}
          >
            {feedback.type === "success" ? (
              <CheckCircle className="w-5 h-5 flex-shrink-0 text-green-600" />
            ) : (
              <AlertCircle className="w-5 h-5 flex-shrink-0 text-red-600" />
            )}
            <span className="font-medium">{feedback.message}</span>
          </div>
        )}

        {/* Security info */}
        <div className="mb-5 p-4 bg-blue-50 border border-blue-200 rounded-2xl flex items-start gap-3">
          <Shield className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-blue-800">Conexão segura</p>
            <p className="text-[11px] text-blue-700 mt-0.5">
              Seus tokens são criptografados (AES-256-GCM) e nunca expostos. 
              Você pode revogar a qualquer momento.
            </p>
          </div>
        </div>

        {/* Connect button */}
        <button
          data-testid="button-connect-mercadopago"
          onClick={handleConnect}
          disabled={connecting}
          className={`w-full py-4 rounded-2xl flex items-center justify-center gap-3 font-black text-sm mb-6 transition-all ${
            connecting
              ? "bg-secondary text-muted-foreground cursor-not-allowed"
              : "bg-[#009EE3] text-white shadow-md hover:bg-[#0083BB]"
          }`}
        >
          {connecting ? (
            <><RefreshCw className="w-4 h-4 animate-spin" /> Conectando...</>
          ) : (
            <><Link2 className="w-4 h-4" /> Conectar conta Mercado Pago</>
          )}
        </button>

        {/* Active connections */}
        {activeConnections.length > 0 && (
          <div className="mb-6">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-3">
              Contas Ativas ({activeConnections.length})
            </p>
            <div className="space-y-3">
              {activeConnections.map((conn) => (
                <div
                  key={conn.id}
                  data-testid={`card-connection-${conn.id}`}
                  className={`bg-white rounded-[2rem] p-5 border shadow-sm ${
                    conn.isDefault ? "border-primary/40" : "border-border/50"
                  }`}
                >
                  {/* Connection header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-sm truncate">{conn.accountEmail}</p>
                        {conn.isDefault && (
                          <span className="flex items-center gap-1 bg-primary/10 text-primary text-[9px] font-black px-2 py-0.5 rounded-full uppercase">
                            <Star className="w-2.5 h-2.5" /> Padrão
                          </span>
                        )}
                      </div>
                      {conn.accountName && (
                        <p className="text-[11px] text-muted-foreground mt-0.5">{conn.accountName}</p>
                      )}
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        ID: {conn.merchantId}
                      </p>
                    </div>
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ml-2 ${STATUS_COLORS[conn.status]}`}>
                      {STATUS_LABELS[conn.status]}
                    </span>
                  </div>

                  {/* Token expiry warning */}
                  {isExpiringSoon(conn) && (
                    <div className="flex items-center gap-2 mb-3 p-2 bg-amber-50 border border-amber-200 rounded-xl">
                      <Clock className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
                      <p className="text-[10px] text-amber-700 font-bold">
                        Token expira em breve — será renovado automaticamente
                      </p>
                    </div>
                  )}

                  {/* Metadata */}
                  <div className="flex gap-4 mb-4">
                    <div>
                      <p className="text-[9px] font-black uppercase text-muted-foreground">Conectado</p>
                      <p className="text-[11px] font-bold">
                        {format(parseISO(conn.connectedAt), "dd/MM/yyyy")}
                      </p>
                    </div>
                    {conn.lastUsedAt && (
                      <div>
                        <p className="text-[9px] font-black uppercase text-muted-foreground">Último uso</p>
                        <p className="text-[11px] font-bold">
                          {formatDistanceToNow(parseISO(conn.lastUsedAt), { addSuffix: true, locale: ptBR })}
                        </p>
                      </div>
                    )}
                    <div>
                      <p className="text-[9px] font-black uppercase text-muted-foreground">Ambiente</p>
                      <p className={`text-[11px] font-bold ${conn.environment === "production" ? "text-green-700" : "text-amber-700"}`}>
                        {conn.environment === "production" ? "Produção" : "Sandbox"}
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    {!conn.isDefault && (
                      <button
                        data-testid={`button-set-default-${conn.id}`}
                        onClick={() => handleSetDefault(conn)}
                        disabled={actionLoading === conn.id}
                        className="flex items-center gap-1.5 text-[10px] font-black px-3 py-1.5 rounded-xl uppercase bg-primary/10 text-primary disabled:opacity-50"
                      >
                        <Star className="w-3 h-3" />
                        {actionLoading === conn.id ? "..." : "Definir padrão"}
                      </button>
                    )}
                    <button
                      data-testid={`button-revoke-${conn.id}`}
                      onClick={() => handleRevoke(conn)}
                      disabled={actionLoading === conn.id}
                      className="flex items-center gap-1.5 text-[10px] font-black px-3 py-1.5 rounded-xl uppercase bg-red-50 text-red-600 disabled:opacity-50"
                    >
                      <Trash2 className="w-3 h-3" />
                      {actionLoading === conn.id ? "..." : "Desconectar"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {activeConnections.length === 0 && revokedConnections.length === 0 && (
          <div className="py-10 flex flex-col items-center text-center">
            <div className="w-16 h-16 bg-secondary rounded-[2rem] flex items-center justify-center mb-4">
              <Link2 className="w-7 h-7 text-muted-foreground/40" />
            </div>
            <p className="font-bold text-sm text-muted-foreground">Nenhuma conta conectada</p>
            <p className="text-[11px] text-muted-foreground/70 mt-1 max-w-[220px]">
              Conecte sua conta Mercado Pago para receber os pagamentos diretamente.
            </p>
          </div>
        )}

        {/* Revoked connections (audit history) */}
        {revokedConnections.length > 0 && (
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-3">
              Histórico ({revokedConnections.length})
            </p>
            <div className="space-y-2">
              {revokedConnections.map((conn) => (
                <div
                  key={conn.id}
                  data-testid={`card-revoked-connection-${conn.id}`}
                  className="bg-secondary/30 rounded-2xl p-4 border border-border/30"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold text-xs text-muted-foreground">{conn.accountEmail}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        ID: {conn.merchantId}
                      </p>
                      {conn.revokedAt && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          Desconectada em {format(parseISO(conn.revokedAt), "dd/MM/yyyy")}
                        </p>
                      )}
                    </div>
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${STATUS_COLORS[conn.status]}`}>
                      {STATUS_LABELS[conn.status]}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
