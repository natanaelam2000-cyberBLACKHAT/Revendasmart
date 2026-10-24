import { doc, getFirestore, runTransaction } from "firebase/firestore";

type InstallmentPaymentCommand = { kind: "full" } | {
  kind: "partial"; amount: number; expectedPaidAmount: number;
};

function cents(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0
    || !Number.isSafeInteger(Math.round(value * 100))) throw new Error("Valor de pagamento inválido.");
  return Math.round(value * 100);
}

/** Re-read payment state inside the transaction. A partial command is fenced by
 * the balance the user saw: a duplicate or concurrent command must reload rather
 * than add the same payment twice or overwrite a newer full payment. */
export async function payInstallment(
  uid: string, installmentId: string, command: InstallmentPaymentCommand,
  isCurrent: () => boolean,
): Promise<{ applied: boolean; paidAmount: number }> {
  const ref = doc(getFirestore(), "users", uid, "installments", installmentId);
  return runTransaction(getFirestore(), async transaction => {
    if (!isCurrent()) throw new Error("Sua sessão mudou. Entre novamente.");
    const snapshot = await transaction.get(ref);
    if (!isCurrent()) throw new Error("Sua sessão mudou. Entre novamente.");
    if (!snapshot.exists()) throw new Error("Parcela não encontrada.");
    const current = snapshot.data();
    const total = cents(current.amount);
    const paid = cents(current.paidAmount);
    if (paid > total) throw new Error("Valor de pagamento inválido.");
    if (current.status === "paid" || paid === total) return { applied: false, paidAmount: paid / 100 };
    let next = total;
    if (command.kind === "partial") {
      if (cents(command.expectedPaidAmount) !== paid) throw new Error("A parcela mudou. Atualize a lista antes de registrar outro pagamento.");
      const delta = cents(command.amount);
      if (delta <= 0 || paid + delta > total) throw new Error("Valor de pagamento inválido.");
      next = paid + delta;
    }
    transaction.update(ref, { paidAmount: next / 100, status: next === total ? "paid" : "partial" });
    return { applied: true, paidAmount: next / 100 };
  });
}
