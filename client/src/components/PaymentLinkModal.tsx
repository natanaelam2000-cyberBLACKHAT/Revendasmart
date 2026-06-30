import { useState } from "react";
import { X, Loader2, Copy, Check } from "lucide-react";
import { getFirebaseAuth, logTelemetryEvent, trackAnalyticsEvent, measureOperation } from "@/lib/firebase";
import { getApiUrl } from "@/lib/api-config";
import { notifyError, notifySuccess } from "@/lib/notify";

interface Client {
  id: string;
  name: string;
  phone?: string;
}

interface PaymentLinkModalProps {
  clients: Client[];
  defaultClientId?: string;
  defaultSaleId?: string;
  defaultAmount?: number;
  onClose: () => void;
  onSuccess?: (chargeId: string, paymentUrl: string) => void;
}

export function PaymentLinkModal({
  clients,
  defaultClientId = "",
  defaultSaleId,
  defaultAmount,
  onClose,
  onSuccess,
}: PaymentLinkModalProps) {
  const [clientId, setClientId] = useState(defaultClientId);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState(defaultAmount ? String(defaultAmount) : "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ chargeId: string; paymentUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const amountNum = parseFloat(amount);
  const isFormValid = clientId && 
                      description.trim() && 
                      !isNaN(amountNum) && 
                      amountNum >= 1.0 && 
                      amountNum <= 999999;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!isFormValid) {
      const amountNum = parseFloat(amount);
      if (!clientId) {
        setError("Selecione um cliente.");
      } else if (!description.trim()) {
        setError("Adicione uma descrição.");
      } else if (isNaN(amountNum)) {
        setError("Valor deve ser um número.");
      } else if (amountNum < 1.0) {
        setError("Valor mínimo é R$ 1,00.");
      } else if (amountNum > 999999) {
        setError("Valor máximo é R$ 999.999,99.");
      } else {
        setError("Preencha todos os campos obrigatórios.");
      }
      return;
    }

    const auth = getFirebaseAuth();
    const user = auth?.currentUser;
    if (!user) {
      setError("Usuário não autenticado.");
      return;
    }

    setLoading(true);
    try {
      const resp = await measureOperation("payment_link_generation", async () => {
        const token = await user.getIdToken();
        return await fetch(getApiUrl("/api/payments/create-link"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            uid: user.uid,
            clientId,
            saleId: defaultSaleId,
            title: `Cobrança ${new Date().toLocaleDateString()}`,
            description: description.trim(),
            amount: parseFloat(amount),
          }),
        });
      });

      const data = await resp.json();
      if (!resp.ok) {
        const technicalMessage = typeof data?.message === "string" ? data.message : typeof data?.error === "string" ? data.error : "";
        const errMsg = data?.userMessage || data?.details ||
          (/Unsupported state|unable to authenticate|decrypt/i.test(technicalMessage)
            ? "A conexão com o Mercado Pago precisa ser renovada em Ajustes."
            : "Não foi possível gerar o link agora. Tente novamente.");
        throw new Error(errMsg);
      }

      setResult({ chargeId: data.chargeId, paymentUrl: data.paymentUrl });
      notifySuccess("Cobrança criada.");
      
      // Track payment link generated event (both telemetry and analytics)
      logTelemetryEvent("payment_link_generated", {
        chargeId: data.chargeId,
        amount: parseFloat(amount),
        clientId,
      }, user.uid);
      
      trackAnalyticsEvent("payment_link_created", {
        value: parseFloat(amount),
        currency: "BRL",
      });
      
      onSuccess?.(data.chargeId, data.paymentUrl);
    } catch (err) {
      const friendlyMsg = err instanceof Error ? err.message : "Não foi possível gerar o link.";
      setError(friendlyMsg);
      notifyError("Não foi possível gerar o link.");
    } finally {
      setLoading(false);
    }
  };

  const copyLink = async () => {
    if (!result?.paymentUrl) return;
    await navigator.clipboard.writeText(result.paymentUrl);
    notifySuccess("Link copiado.");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[70] flex items-end justify-center">
      <div className="bg-white w-full max-w-md rounded-t-3xl max-h-[calc(100dvh-1rem)] overflow-y-auto overscroll-contain flex flex-col animate-in slide-in-from-bottom-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {/* Header - Sticky */}
        <div className="sticky top-0 bg-white border-b border-border/30 p-6 flex items-center justify-between flex-shrink-0">
          <div>
            <h3 className="font-black text-lg">💳 Gerar Link</h3>
            <p className="text-xs text-muted-foreground font-bold uppercase">Mercado Pago</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-muted/20 flex items-center justify-center hover:bg-muted/30 transition-colors"
            data-testid="button-close-payment-modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col p-6 space-y-4">
          {/* Success State */}
          {result ? (
            <>
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl">
                <p className="font-black text-emerald-900 text-sm">✅ Link gerado.</p>
                <p className="text-xs text-emerald-700 break-all mt-2 font-mono bg-white p-2 rounded mt-2">
                  {result.paymentUrl}
                </p>
              </div>

              <button
                onClick={copyLink}
                className={`w-full py-3 rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all ${
                  copied
                    ? "bg-emerald-500 text-white"
                    : "bg-primary text-white hover:bg-primary/90"
                }`}
                data-testid="button-copy-payment-link"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4" /> Link copiado
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" /> Copiar link
                  </>
                )}
              </button>

              <button
                onClick={onClose}
                className="w-full py-2.5 bg-secondary text-foreground rounded-2xl font-bold text-sm hover:bg-secondary/80 transition-colors"
              >
                Fechar
              </button>
            </>
          ) : (
            /* Form State */
            <>
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-lg">
                  ⚠️ {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-3 flex-1 flex flex-col">
                {/* Cliente */}
                <div>
                  <label className="text-xs font-bold uppercase text-muted-foreground block mb-1.5">
                    Cliente *
                  </label>
                  <select
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    className="w-full px-3 py-2.5 border border-border rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
                    required
                    data-testid="select-payment-client"
                  >
                    <option value="">Selecionar cliente...</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Descrição */}
                <div>
                  <label className="text-xs font-bold uppercase text-muted-foreground block mb-1.5">
                    Descrição *
                  </label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Ex: Pedido de perfumes"
                    className="w-full px-3 py-2.5 border border-border rounded-lg text-sm font-medium placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                    required
                    data-testid="input-payment-description"
                  />
                </div>

                {/* Valor */}
                <div>
                  <label className="text-xs font-bold uppercase text-muted-foreground block mb-1.5">
                    Valor (R$) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0,00"
                    className="w-full px-3 py-2.5 border border-border rounded-lg text-sm font-medium placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                    required
                    data-testid="input-payment-amount"
                  />
                </div>

                {/* Spacer to push button to bottom */}
                <div className="flex-1" />

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={loading || !isFormValid}
                  className="w-full py-3 bg-primary text-white font-black text-sm rounded-2xl hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  data-testid="button-generate-payment-link"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Gerando...
                    </>
                  ) : (
                    "Gerar link"
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
