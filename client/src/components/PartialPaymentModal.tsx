import { useState } from "react";
import { X } from "lucide-react";

interface PartialPaymentModalProps {
  billingId: string;
  remainingAmount: number;
  clientName: string;
  onSubmit: (amount: number) => void;
  onClose: () => void;
}

export function PartialPaymentModal({
  billingId,
  remainingAmount,
  clientName,
  onSubmit,
  onClose,
}: PartialPaymentModalProps) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const parsedAmount = parseFloat(amount);

    // Validation
    if (!amount.trim()) {
      setError("Digite o valor pago.");
      return;
    }

    if (isNaN(parsedAmount)) {
      setError("Valor deve ser um número.");
      return;
    }

    if (parsedAmount <= 0) {
      setError("Valor deve ser maior que zero.");
      return;
    }

    if (parsedAmount > remainingAmount) {
      setError(`Valor não pode ser maior que R$ ${remainingAmount.toFixed(2)}`);
      return;
    }

    onSubmit(parsedAmount);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-sm w-full shadow-xl animate-in scale-95">
        {/* Header */}
        <div className="border-b border-border/30 p-6 flex items-center justify-between">
          <div>
            <h3 className="font-black text-lg">💰 Pagamento Parcial</h3>
            <p className="text-xs text-muted-foreground font-bold uppercase mt-1">{clientName}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-muted/20 flex items-center justify-center hover:bg-muted/30 transition-colors"
            data-testid="button-close-partial-payment"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="text-xs font-bold uppercase text-muted-foreground block mb-2">
              Saldo Pendente
            </label>
            <p className="text-2xl font-black text-primary">R$ {remainingAmount.toFixed(2)}</p>
          </div>

          <div>
            <label className="text-xs font-bold uppercase text-muted-foreground block mb-2">
              Valor Recebido *
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              max={remainingAmount}
              placeholder="0,00"
              className="w-full px-4 py-3 border border-border rounded-2xl text-lg font-bold focus:outline-none focus:ring-2 focus:ring-primary/30"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setError("");
              }}
              data-testid="input-partial-payment-amount"
            />
            <p className="text-xs text-muted-foreground mt-2">
              Máximo: R$ {remainingAmount.toFixed(2)}
            </p>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-lg">
              ⚠️ {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 bg-secondary text-foreground rounded-2xl font-bold text-sm hover:bg-secondary/80 transition-colors"
              data-testid="button-cancel-partial-payment"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-1 py-3 bg-primary text-white rounded-2xl font-bold text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0}
              data-testid="button-submit-partial-payment"
            >
              Confirmar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
