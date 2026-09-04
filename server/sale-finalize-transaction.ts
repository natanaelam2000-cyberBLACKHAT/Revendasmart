/**
 * RELEASE-QUALITY-05 §1 — extraído de `server/routes.ts` (`POST /api/sales/finalize`) para ser
 * testável isoladamente contra o emulador do Firestore, sem precisar subir o Express inteiro — mesma
 * motivação e mesmo padrão já usado em `public-catalog-order-idempotency.ts`. Nenhum comportamento foi
 * alterado nesta extração: é o mesmo corpo de transação, só movido de lugar.
 *
 * Garantia de concorrência: `db.runTransaction` lê todos os documentos envolvidos (venda, cliente,
 * produtos) atomicamente via `transaction.getAll`, e o Firestore reexecuta a transação inteira do zero
 * se qualquer um desses documentos mudar entre a leitura e o commit (optimistic concurrency control).
 * Duas vendas concorrentes do mesmo produto nunca decidem o estoque final "no escuro" uma da outra —
 * uma commita primeiro, a outra é automaticamente re-tentada e vê o estoque já atualizado. O
 * decremento em si usa `FieldValue.increment()` (delta atômico), nunca um valor absoluto recalculado
 * fora da garantia da transação.
 */
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { InvalidProductPriceError, resolveEffectiveProductPrice } from "../shared/product-pricing";

export interface SaleFinalizeInput {
  uid: string;
  saleId: string;
  clientId: string;
  products: { productId: string; quantity: number }[];
  paymentType: "avista" | "prazo";
  discountType: "percent" | "fixed";
  discountValue: number;
  downPayment: number;
  installmentCount: number;
  paymentMethod: unknown;
  downPaymentMethod: unknown;
}

export interface SaleFinalizeResult {
  saleId: string;
  subtotal: number;
  total: number;
  remainingBalance: number;
  installmentIds: string[];
  depletedProductIds: string[];
}

/**
 * Lança `Error` com uma das mensagens abaixo — o chamador (rota HTTP ou teste) mapeia para o código de
 * resposta apropriado, exatamente como a rota já fazia antes da extração:
 * SALE_ALREADY_EXISTS · CLIENT_NOT_FOUND · DOWN_PAYMENT_EXCEEDS_TOTAL ·
 * INSUFFICIENT_STOCK:<nome> · PRODUCT_NOT_FOUND:<id> · INVALID_PRODUCT_PRICE:<id> ·
 * PRODUCT_NOT_AVAILABLE:<id> (PLAN-IMPL-02B1 — produto preservado por downgrade de plano)
 */
export async function finalizeSaleTransaction(db: Firestore, input: SaleFinalizeInput): Promise<SaleFinalizeResult> {
  const { uid, saleId, clientId, paymentType, discountType, discountValue, downPayment, installmentCount, paymentMethod, downPaymentMethod } = input;

  const requestedProducts = new Map<string, number>();
  for (const item of input.products) {
    requestedProducts.set(item.productId, (requestedProducts.get(item.productId) ?? 0) + item.quantity);
  }

  const userRef = db.collection("users").doc(uid);
  const saleRef = userRef.collection("sales").doc(saleId);
  const clientRef = userRef.collection("clients").doc(clientId);
  const productEntries = Array.from(requestedProducts.entries()).map(([productId, quantity]) => ({
    productId,
    quantity,
    ref: userRef.collection("products").doc(productId),
  }));

  return db.runTransaction(async (transaction) => {
    const snapshots = await transaction.getAll(saleRef, clientRef, ...productEntries.map((item) => item.ref));
    const saleSnapshot = snapshots[0];
    const clientSnapshot = snapshots[1];
    const productSnapshots = snapshots.slice(2);

    if (saleSnapshot.exists) throw new Error("SALE_ALREADY_EXISTS");
    if (!clientSnapshot.exists) throw new Error("CLIENT_NOT_FOUND");

    let subtotalCents = 0;
    const saleProducts = productEntries.map((item, index) => {
      const snapshot = productSnapshots[index];
      if (!snapshot.exists) throw new Error(`PRODUCT_NOT_FOUND:${item.productId}`);
      const product = snapshot.data() ?? {};
      // PLAN-IMPL-02B1 §13 — produto preservado por downgrade de plano nunca entra numa venda NOVA;
      // vendas passadas que já o referenciam continuam intactas (esta transação só roda para vendas
      // novas — nenhuma venda existente é relida/alterada aqui). Checado ANTES do estoque: um produto
      // preservado é indisponível independente de ter estoque > 0.
      if (product.planAccessState === "preserved") {
        throw new Error(`PRODUCT_NOT_AVAILABLE:${item.productId}`);
      }
      const stock = Number(product.stock);
      if (!Number.isFinite(stock) || stock < item.quantity) {
        throw new Error(`INSUFFICIENT_STOCK:${String(product.name ?? item.productId)}`);
      }
      // Preço vem SEMPRE do produto relido aqui dentro da transação, nunca do que o cliente enviou.
      let priceCents: number;
      try {
        priceCents = resolveEffectiveProductPrice({
          salePrice: product.salePrice,
          promotionalPrice: product.promotionalPrice,
          discountPercent: product.discountPercent,
        }).effectivePriceCents;
      } catch (pricingError) {
        if (pricingError instanceof InvalidProductPriceError) {
          throw new Error(`INVALID_PRODUCT_PRICE:${item.productId}`);
        }
        throw pricingError;
      }
      subtotalCents += priceCents * item.quantity;
      return { productId: item.productId, quantity: item.quantity, price: priceCents / 100, stock };
    });

    const requestedDiscountCents = discountType === "percent"
      ? Math.round(subtotalCents * discountValue / 100)
      : Math.round(discountValue * 100);
    const discountCents = Math.min(subtotalCents, requestedDiscountCents);
    const totalCents = subtotalCents - discountCents;
    const downPaymentCents = Math.round(downPayment * 100);
    if (downPaymentCents > totalCents) throw new Error("DOWN_PAYMENT_EXCEEDS_TOTAL");
    const remainingCents = paymentType === "prazo" ? totalCents - downPaymentCents : 0;
    const now = new Date();
    const date = now.toISOString();

    const sale = {
      id: saleId,
      clientId,
      products: saleProducts.map((product) => ({
        productId: product.productId,
        quantity: product.quantity,
        price: product.price,
      })),
      subtotal: subtotalCents / 100,
      discountType,
      discountValue,
      discountAmount: discountCents / 100,
      total: totalCents / 100,
      totalPrice: totalCents / 100,
      paymentType,
      legacyPaymentType: paymentType === "avista" ? "cash" : "installments",
      paymentMethod: paymentType === "avista" ? paymentMethod ?? null : null,
      downPayment: paymentType === "prazo" ? downPaymentCents / 100 : 0,
      downPaymentMethod: paymentType === "prazo" && downPaymentCents > 0 ? downPaymentMethod ?? null : null,
      installments: paymentType === "prazo" ? installmentCount : 0,
      date,
    };
    transaction.create(saleRef, sale);

    // §2/§3: delta atômico, nunca um valor absoluto — ver comentário do módulo.
    for (const item of productEntries) {
      transaction.update(item.ref, {
        stock: FieldValue.increment(-item.quantity),
        lastSoldDate: date,
      });
    }

    // PLAN-IMPL-07A — mesmo padrão de Product.lastSoldDate acima, aplicado ao Client: a MESMA
    // transação que já lê e valida clientRef (linha ~67/73) também grava a recência da última compra
    // real, nunca uma segunda gravação/caminho separado. Habilita a detecção de "cliente inativo" via
    // uma query indexada e limitada por intervalo (where lastPurchaseAt < limiar), sem nunca carregar
    // todas as Sales/Clients do tenant em runtime.
    transaction.update(clientRef, { lastPurchaseAt: date });

    const installmentIds: string[] = [];
    if (remainingCents > 0) {
      const baseAmountCents = Math.floor(remainingCents / installmentCount);
      let allocatedCents = 0;
      for (let index = 0; index < installmentCount; index += 1) {
        const amountCents = index === installmentCount - 1
          ? remainingCents - allocatedCents
          : baseAmountCents;
        allocatedCents += amountCents;
        const installmentId = `${saleId}-${String(index + 1).padStart(2, "0")}`;
        const dueDate = new Date(now);
        const dueDay = dueDate.getUTCDate();
        dueDate.setUTCDate(1);
        dueDate.setUTCMonth(dueDate.getUTCMonth() + index + 1);
        const lastDayOfMonth = new Date(Date.UTC(
          dueDate.getUTCFullYear(), dueDate.getUTCMonth() + 1, 0,
        )).getUTCDate();
        dueDate.setUTCDate(Math.min(dueDay, lastDayOfMonth));
        transaction.create(userRef.collection("installments").doc(installmentId), {
          id: installmentId,
          saleId,
          clientId,
          amount: amountCents / 100,
          dueDate: dueDate.toISOString(),
          status: "pending",
          paidAmount: 0,
          installmentNumber: index + 1,
          totalInstallments: installmentCount,
          createdAt: date,
        });
        installmentIds.push(installmentId);
      }
    }

    return {
      saleId,
      subtotal: subtotalCents / 100,
      total: totalCents / 100,
      remainingBalance: remainingCents / 100,
      installmentIds,
      depletedProductIds: saleProducts
        .filter((product, index) => product.stock - productEntries[index].quantity === 0)
        .map((product) => product.productId),
    };
  });
}
