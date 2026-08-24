/**
 * RELEASE-QUALITY-05 — Offline Stock Conflict Safety.
 *
 * A prova pesada (concorrência real transacional contra o emulador do Firestore, cenários A-F do
 * ticket) vive em `script/firebase-emulator-tests.ts` ("Sale/stock concurrency tests"), rodada por
 * `npm run test:firebase`. Este arquivo cobre o que é verificável por asserção de código-fonte: edição
 * manual de estoque, modelo de conflito da fila offline, e UI de conflito sem texto cru do Firebase.
 */
import assert from "node:assert/strict";
import fs from "node:fs";

function read(path: string): string {
  return fs.readFileSync(path, "utf8");
}

function run(): void {
  // ===== §1/§2/§3 — servidor como autoridade, delta atômico =====
  const saleTransactionSource = read("server/sale-finalize-transaction.ts");
  assert.match(saleTransactionSource, /FieldValue\.increment\(-item\.quantity\)/, "decremento de estoque precisa ser um delta atômico (FieldValue.increment), nunca um valor absoluto");
  assert.doesNotMatch(saleTransactionSource, /stock:\s*saleProduct\.stock\s*-\s*item\.quantity/, "não pode voltar a escrever um valor absoluto recalculado fora da garantia atômica");
  assert.match(saleTransactionSource, /db\.runTransaction/, "toda a operação (ler estoque, validar, aplicar delta, gravar venda) precisa continuar na mesma transação");
  assert.match(saleTransactionSource, /if \(saleSnapshot\.exists\) throw new Error\("SALE_ALREADY_EXISTS"\);/, "replay do mesmo saleId precisa continuar sendo rejeitado ANTES de qualquer escrita de estoque");
  assert.match(saleTransactionSource, /if \(!Number\.isFinite\(stock\) \|\| stock < item\.quantity\)/, "validação de estoque insuficiente precisa continuar acontecendo dentro da transação, com o valor lido ali dentro");

  const routesSource = read("server/routes.ts");
  assert.match(routesSource, /finalizeSaleTransaction\(db, \{/, "a rota precisa continuar delegando para a mesma função transacional, não reimplementar a lógica inline");
  assert.doesNotMatch(routesSource, /transaction\.update\(item\.ref, \{\s*stock: FieldValue\.increment/, "a lógica de transação não pode ter sido duplicada de volta para dentro da rota");

  // ===== §8 — edição manual de estoque não é mais um valor absoluto cego =====
  const addProductSource = read("client/src/pages/add-product.tsx");
  assert.match(addProductSource, /originalStockAtLoadRef/, "precisa existir uma referência ao estoque no momento em que o formulário de edição carregou");
  assert.match(addProductSource, /attemptedPayload\.stock = increment\(stock - originalStockAtLoadRef\.current\)/, "salvar uma edição precisa gravar a DIFERENÇA que o vendedor digitou (increment), não o valor absoluto — senão sobrescreve um decremento de venda concorrente");
  assert.match(addProductSource, /if \(id && originalStockAtLoadRef\.current !== null\)/, "o delta só se aplica em EDIÇÃO de um produto existente — criação de produto novo não tem concorrência a proteger");

  // ===== §4/§5 — offline sale sync e idempotência (reforça o que já existia, sem enfraquecer) =====
  const offlineQueueSource = read("client/src/lib/offline-sales-queue.ts");
  assert.match(offlineQueueSource, /SALE_ALREADY_EXISTS/, "replay ainda precisa tratar SALE_ALREADY_EXISTS como sucesso, não erro");
  assert.doesNotMatch(offlineQueueSource, /stock\s*[-+]?=|decrementStock|updateStock/i, "a fila continua NUNCA decidindo/decrementando estoque no cliente — só o servidor faz isso");

  // ===== §7/§9 — conflito de negócio (estoque/produto mudou) nunca apaga a venda pendente silenciosamente =====
  assert.match(offlineQueueSource, /export type PendingSaleConflictReason = "INSUFFICIENT_STOCK" \| "PRODUCT_NOT_FOUND" \| "PRODUCT_CHANGED"/, "motivos de conflito precisam ser um conjunto pequeno e explícito, não inventado à toa");
  assert.match(offlineQueueSource, /status: "pending" \| "syncing" \| "failed" \| "conflict"/, "status da fila precisa incluir 'conflict', distinto de 'failed' genérico");
  assert.match(offlineQueueSource, /export async function markPendingSaleConflict/, "precisa existir uma função dedicada para marcar conflito (com motivo), não reaproveitar markPendingSaleFailed genérico");
  assert.match(offlineQueueSource, /function resolveConflictReason/, "precisa mapear os códigos que o servidor já distingue para um motivo de conflito, não inventar um novo vocabulário desconectado do backend");
  assert.match(offlineQueueSource, /if \(code === "INSUFFICIENT_STOCK"\) return "INSUFFICIENT_STOCK";/, "INSUFFICIENT_STOCK do servidor precisa virar conflito, não falha genérica");

  const pendingSalesSyncSource = read("client/src/hooks/usePendingSalesSync.ts");
  assert.match(pendingSalesSyncSource, /result\.outcome === "conflict"/, "o hook de sync precisa distinguir o outcome de conflito do outcome de falha genérica");
  assert.match(pendingSalesSyncSource, /await markPendingSaleConflict\(user\.uid, item\.id, result\.reason, result\.message\)/, "conflito precisa ser persistido com o motivo, não só uma mensagem genérica");
  assert.match(pendingSalesSyncSource, /conflictCount: docs\.filter/, "estado exposto pelo hook precisa incluir uma contagem de conflitos, separada de pendentes/sincronizando/falhas");
  assert.match(pendingSalesSyncSource, /retryPendingSale|cancelPendingSale/, "hook precisa expor ações de retry/cancelamento para a UI agir sobre um conflito, não só mostrar e travar");

  // Nunca apaga a venda pendente sozinho por causa de um conflito — só remoção EXPLÍCITA (cancelPendingSale)
  // ou sucesso real (removePendingSale em outcome synced/already-exists) podem apagar o documento.
  assert.doesNotMatch(
    pendingSalesSyncSource.match(/if \(result\.outcome === "conflict"\)[\s\S]{0,120}/)?.[0] ?? "",
    /removePendingSale/,
    "marcar conflito NUNCA pode remover a venda pendente — dado não pode sumir silenciosamente",
  );

  // ===== §10 — UI de conflito, sem texto cru do Firebase =====
  const connectivitySource = read("client/src/components/ConnectivityIndicator.tsx");
  assert.match(connectivitySource, /CONFLICT_REASON_TEXT/, "precisa existir um mapa de texto amigável por motivo de conflito");
  assert.match(connectivitySource, /Estoque insuficiente para sincronizar esta venda\./, "mensagem de estoque insuficiente precisa ser exatamente clara para o usuário, conforme pedido no ticket");
  assert.doesNotMatch(connectivitySource, /\{item\.errorMessage\}/, "a UI não pode renderizar a mensagem de erro crua do servidor — só o texto amigável mapeado por motivo");
  assert.match(connectivitySource, /Tentar novamente/, "UI de conflito precisa oferecer a ação de tentar novamente");
  assert.match(connectivitySource, /Cancelar/, "UI de conflito precisa oferecer a ação de cancelar a pendência");
  assert.doesNotMatch(connectivitySource, /alert\(|window\.confirm\(/, "nunca popup bloqueante, nem para conflito");

  // ===== §9 — firestore.rules aceita o novo status/motivo sem abrir a porta pra outra coisa =====
  const firestoreRules = read("firestore.rules");
  const pendingSalesBlock = firestoreRules.match(/match \/pendingSales\/\{saleId\} \{[\s\S]*?\n {6}\}/)?.[0] ?? "";
  assert.match(pendingSalesBlock, /'pending', 'syncing', 'failed', 'conflict'/, "regra precisa aceitar o novo status 'conflict'");
  assert.match(pendingSalesBlock, /conflictReason in \['INSUFFICIENT_STOCK', 'PRODUCT_NOT_FOUND', 'PRODUCT_CHANGED'\]/, "regra precisa validar que conflictReason só pode ser um dos motivos conhecidos — não um campo livre");
  assert.match(pendingSalesBlock, /request\.resource\.data\.payload == resource\.data\.payload/, "payload continua imutável — um conflito não pode virar oportunidade de reescrever a venda");

  // ===== §11 — tenant safety (reforço; a prova real é o teste do emulador em firebase-emulator-tests.ts) =====
  assert.match(offlineQueueSource, /"users", uid, PENDING_SALES_COLLECTION/, "pendingSales continua escrito sob o path do próprio uid — nunca cruza conta");
  const salesRuleBlock = firestoreRules.match(/match \/sales\/\{saleId\} \{[\s\S]*?\n {6}\}/)?.[0] ?? "";
  assert.match(salesRuleBlock, /allow create, update, delete: if false;/, "sales continua bloqueado para escrita direta do cliente (herdado da remediação anterior — não pode ter regredido)");

  console.log("RELEASE-QUALITY-05 tests passed: server delta authority, manual stock edit delta, offline sale conflict model, conflict UI without raw Firebase text, rules updated.");
}

run();
