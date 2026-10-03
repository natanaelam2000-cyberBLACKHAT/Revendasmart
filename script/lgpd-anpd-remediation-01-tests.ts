/**
 * REVENDASMART-LGPD-ANPD-REMEDIATION-01 — Adequação pré-Play Store baseada na auditoria
 * REVENDASMART-LGPD-ANPD-AUDIT-01. Puro onde dá; o resto é asserção de código-fonte, mesmo padrão já
 * usado no resto desta série (ex. release-quality-04-tests.ts).
 */
import assert from "node:assert/strict";
import fs from "node:fs";

function read(path: string): string {
  return fs.readFileSync(path, "utf8");
}

function fileExists(path: string): boolean {
  return fs.existsSync(path);
}

function run(): void {
  // ===== A/B — Política de Privacidade servida corretamente; rascunho antigo fora do ar =====
  const privacyPolicy = read("client/public/privacy-policy.md");
  assert.match(privacyPolicy, /Photoroom/, "Política precisa mencionar o Photoroom explicitamente");
  assert.doesNotMatch(
    privacyPolicy,
    /Photoroom.{0,400}não recebem imagens ou dados por meio do runtime de produção atual/s,
    "P0 corrigido: a política NUNCA pode mais afirmar que o Photoroom não recebe dados em produção — ele recebe",
  );
  assert.match(privacyPolicy, /remoção de fundo/i, "seção 3.3 precisa descrever o recurso real de remoção de fundo");
  assert.match(privacyPolicy, /transferência internacional/i, "política precisa mencionar transferência internacional (Fase 4)");

  assert.equal(fileExists("PRIVACY_POLICY.md"), false, "B: rascunho obsoleto não pode continuar na raiz do repo (deve estar em docs/archive)");
  const legacyDraft = read("docs/archive/LEGACY_DRAFT_DO_NOT_USE_PRIVACY_POLICY.md");
  assert.match(legacyDraft, /RASCUNHO OBSOLETO — NÃO USAR/, "arquivo arquivado precisa deixar claro que não é a política vigente");

  // Confirma que o servidor nunca serviu (e continua não servindo) o rascunho — só dist/public/*.md.
  const routesSource = read("server/routes.ts");
  assert.match(routesSource, /dist\/public\/privacy-policy\.md/, "rota pública precisa continuar servindo o arquivo de client\\public, não outro");
  assert.doesNotMatch(routesSource, /PRIVACY_POLICY\.md(?!\.)/, "nenhuma rota pode servir o rascunho obsoleto pelo nome antigo");

  // ===== C — Aviso de exposição pública da chave Pix + minimização =====
  const settingsSource = read("client/src/pages/settings.tsx");
  assert.match(settingsSource, /warning-pix-key-public/, "C: precisa existir um aviso visível na tela onde a chave Pix é cadastrada");
  assert.match(settingsSource, /fica visível publicamente/i, "aviso precisa deixar claro que a chave fica pública");

  const publicCatalogServer = read("server/public-catalog.ts");
  // \r?\n: o recorte precisa funcionar igual em checkouts LF e CRLF — com `\n` rígido, em CRLF o match
  // falhava, o recorte virava "" e a asserção abaixo passava sem verificar nada.
  const publicCatalogStoreSource = publicCatalogServer.match(/export function buildPublicCatalogStore[\s\S]*?\r?\n}\r?\n/)?.[0] ?? "";
  assert.ok(publicCatalogStoreSource.length > 0, "recorte de buildPublicCatalogStore não pode ser vazio (senão a asserção de Pix vira falso positivo)");
  assert.match(publicCatalogStoreSource, /pixAvailable:/, "recorte precisa conter o corpo real de buildPublicCatalogStore");
  // Ler settings.pixKey para derivar `pixAvailable: Boolean(...)` é permitido; o que não pode é o VALOR
  // virar campo do payload retornado — nem `pixKey: ...` nem o shorthand `pixKey,` / `pixKey }`.
  assert.doesNotMatch(
    publicCatalogStoreSource,
    /(?<![.\w$])["']?pixKey["']?\s*:/,
    "buildPublicCatalogStore não pode mais incluir o VALOR da chave Pix na carga pública inicial (campo pixKey: ...)",
  );
  assert.doesNotMatch(
    publicCatalogStoreSource,
    /(?<![.\w$])pixKey\s*[,}]/,
    "buildPublicCatalogStore não pode mais incluir o VALOR da chave Pix na carga pública inicial (shorthand pixKey)",
  );
  assert.match(publicCatalogServer, /pixAvailable: Boolean/, "store público precisa expor só um booleano, não o valor");
  assert.match(publicCatalogServer, /export function resolvePublicCatalogPixKey/, "precisa existir uma função dedicada para resolver o valor sob demanda");

  assert.match(routesSource, /\/api\/public\/catalog\/:storeSlug\/pix-key/, "precisa existir um endpoint dedicado para a chave Pix");
  assert.match(routesSource, /Cache-Control.{0,20}no-store/, "resposta da chave Pix não pode ser cacheada pela CDN");

  const publicCatalogClient = read("client/src/pages/public-catalog.tsx");
  assert.doesNotMatch(publicCatalogClient, /store\??\.pixKey/, "client não pode mais ler pixKey de `store` — o valor vem de um fetch dedicado");
  assert.match(publicCatalogClient, /pix-key/, "client precisa chamar o endpoint dedicado da chave Pix");
  assert.match(publicCatalogClient, /store\?\.pixAvailable/, "visibilidade do botão Pix precisa usar o booleano, não o valor");

  const sharedPublicCatalog = read("shared/public-catalog.ts");
  assert.match(sharedPublicCatalog, /pixAvailable: boolean/, "tipo compartilhado precisa refletir o novo campo booleano");
  assert.doesNotMatch(sharedPublicCatalog, /pixKey\?: string/, "tipo compartilhado não pode mais expor pixKey como campo público");

  // ===== D/E — Offline privacy / tenant isolation em dispositivo compartilhado =====
  const firebaseSource = read("client/src/lib/firebase.ts");
  assert.match(firebaseSource, /installOfflineCacheTenantIsolation/, "D/E: precisa existir um listener central de transição de uid, não só chamadas manuais em telas de logout");
  assert.match(firebaseSource, /onAuthStateChanged\(auth, \(user\) => \{/, "listener precisa reagir a QUALQUER transição de auth, inclusive sessão expirando sem logout manual");
  assert.match(firebaseSource, /lastKnownAuthUid !== undefined && lastKnownAuthUid !== null && lastKnownAuthUid !== currentUid/, "só deve limpar em uma transição real de usuário, nunca na primeira leitura de sessão");
  assert.match(firebaseSource, /clearAllImagesFromIndexedDb/, "transição de uid também precisa limpar o banco de imagens (não escopado por uid)");
  assert.match(firebaseSource, /export async function clearFirestoreOfflineCache\(\): Promise<boolean>/, "função de limpeza precisa reportar sucesso/falha (antes retornava void e engolia erro em silêncio)");
  assert.match(firebaseSource, /logError\("firestore_offline_cache_clear_failed"/, "falha ao limpar o cache precisa ficar visível nos logs de produção, não só console.warn");

  const mockDataSource = read("client/src/lib/mock-data.ts");
  assert.match(mockDataSource, /export const clearAllImagesFromIndexedDb/, "precisa existir uma função que limpe TODO o object store de imagens (não só as referenciadas localmente)");

  // ===== F/I — Exclusão de conta e fluxo de venda pelo backend continuam intactos =====
  const accountDeletionSource = read("server/account-deletion.ts");
  assert.match(accountDeletionSource, /recursiveDelete/, "F: exclusão de conta precisa continuar apagando a árvore inteira do Firestore");
  assert.match(accountDeletionSource, /bucket\.deleteFiles/, "F: exclusão de conta precisa continuar apagando o Storage");
  assert.match(accountDeletionSource, /auth\.deleteUser/, "F: exclusão de conta precisa continuar apagando o usuário do Firebase Auth");

  assert.match(routesSource, /\/api\/sales\/finalize/, "I: endpoint de finalização de venda pelo backend precisa continuar existindo");

  // ===== G — Fila de venda offline continua escopada por uid, sem PII crua =====
  const offlineQueueSource = read("client/src/lib/offline-sales-queue.ts");
  assert.match(offlineQueueSource, /"users", uid, PENDING_SALES_COLLECTION/, "G: pendingSales precisa continuar escrito sob o path do próprio uid");
  assert.doesNotMatch(offlineQueueSource, /clientName|clientPhone/, "G: payload da fila offline não deve carregar nome/telefone cru do cliente (só clientId)");

  // ===== H — Regra do Firestore para sales bloqueia escrita direta do cliente =====
  const firestoreRules = read("firestore.rules");
  const salesRuleBlock = firestoreRules.match(/match \/sales\/\{saleId\} \{[\s\S]*?\n {6}\}/)?.[0] ?? "";
  assert.match(salesRuleBlock, /allow create, update, delete: if false;/, "H: create direto do cliente em sales precisa estar bloqueado — só o backend (Admin SDK) grava");
  assert.match(salesRuleBlock, /allow read: if userOwnsResource\(uid\);/, "H: leitura pelo próprio dono continua permitida");

  const firebaseEmulatorTests = read("script/firebase-emulator-tests.ts");
  assert.match(firebaseEmulatorTests, /owner não cria venda diretamente pelo cliente/, "H: teste do emulador precisa cobrir a negação explicitamente");
  assert.match(firebaseEmulatorTests, /owner lê a própria venda criada pelo backend/, "H: teste do emulador precisa confirmar que leitura pelo dono continua funcionando");

  // ===== J — Rate limit distribuído para endpoints financeiros públicos =====
  const distributedRateLimitSource = read("server/public-rate-limit-firestore.ts");
  assert.match(distributedRateLimitSource, /export async function checkDistributedRateLimit/, "J: precisa existir um limitador Firestore-backed reutilizável");
  assert.match(distributedRateLimitSource, /db\.runTransaction/, "J: decisão de permitir/negar precisa ser transacional para valer entre instâncias do Cloud Run");
  assert.match(distributedRateLimitSource, /count >= max/, "J: precisa comparar contra o limite dentro da própria transação, nunca confiar em TTL");
  assert.match(routesSource, /checkDistributedRateLimit\(\s*getFirebaseAdmin\(\)\.firestore\(\),\s*distributedKey,/, "J: rota pública de pedido/pagamento precisa usar o limitador distribuído");
  assert.match(routesSource, /distributedKey = `order:/, "J: criação de pedido público precisa estar coberta pelo limitador distribuído");
  assert.match(routesSource, /distributedKey = `mp-charge:/, "J: criação de cobrança Mercado Pago pública precisa estar coberta pelo limitador distribuído");

  // ===== K — Sanitização de logs cobre cnpj/pix/clientname =====
  const loggerSource = read("server/logger.ts");
  assert.match(loggerSource, /cnpj/, "K: SENSITIVE_KEY_PATTERN precisa cobrir cnpj (só cpf/rg estavam cobertos antes)");
  assert.match(loggerSource, /pix/i, "K: SENSITIVE_KEY_PATTERN precisa cobrir chave pix por nome de campo");
  assert.match(loggerSource, /"clientname"/, "K: IDENTIFIER_KEYS precisa cobrir clientname — nome de cliente não era mascarado por padrão de chave");
  assert.match(loggerSource, /\\d\{2\}\\\.\?\\d\{3\}\\\.\?\\d\{3\}\\\/\?\\d\{4\}-\?\\d\{2\}/, "K: precisa existir uma regex de CNPJ (14 dígitos) além da de CPF já existente");

  const firestoreAuditSource = read("server/firestore-audit.ts");
  assert.doesNotMatch(firestoreAuditSource, /console\.log\(JSON\.stringify\(\{\s*id: c\.id,\s*name: c\.name,\s*phone: c\.phone/, "K: amostra de clientes não pode mais imprimir nome/telefone crus");
  assert.match(firestoreAuditSource, /maskPhone/, "K: script de auditoria precisa usar o helper de mascaramento já existente");

  const uidConsolidationSource = read("server/uid-consolidation.ts");
  assert.doesNotMatch(uidConsolidationSource, /Target email: \$\{TARGET_EMAIL\}/, "K: e-mail alvo não pode mais ser impresso cru");
  assert.match(uidConsolidationSource, /maskEmail\(TARGET_EMAIL\)/, "K: e-mail alvo precisa ser mascarado no log");

  // ===== L/M — Photoroom e Mercado Pago continuam operacionais (nada de funcional foi removido) =====
  assert.match(routesSource, /registerProductCutoutPhotoroomRoutes/, "L: rota do Photoroom precisa continuar registrada — esta remediação só ajusta documentação/privacidade, não desativa a feature");
  assert.match(routesSource, /registerPaymentRoutes/, "M: rotas de pagamento Mercado Pago precisam continuar registradas");
  assert.match(routesSource, /registerConnectionRoutes/, "M: rotas de conexão Mercado Pago precisam continuar registradas");

  // ===== N — Play Data Safety Matrix atualizada =====
  const playDataSafetyMatrix = read("docs/PLAY_DATA_SAFETY_MATRIX.md");
  assert.doesNotMatch(
    playDataSafetyMatrix,
    /\| Photoroom \| `SMOKE_ONLY`, `NOT_IN_PRODUCTION`/,
    "N: matriz não pode mais classificar o Photoroom como SMOKE_ONLY/NOT_IN_PRODUCTION",
  );
  assert.match(playDataSafetyMatrix, /Photoroom.{0,200}IMPLEMENTED/s, "N: matriz precisa refletir que o Photoroom está IMPLEMENTED em produção");

  // ===== Fase 2/3/4/5/6/12 — documentos de governança criados =====
  for (const docPath of [
    "docs/DATA_SUBJECT_REQUEST_PROCEDURE.md",
    "docs/DATA_RETENTION_REGISTER.md",
    "docs/INTERNATIONAL_DATA_TRANSFER_REGISTER.md",
    "docs/PRIVACY_INCIDENT_RESPONSE.md",
    "docs/DPO_SMALL_PROCESSING_AGENT_ASSESSMENT.md",
    "docs/TERMS_LEGAL_REVIEW_ITEMS.md",
  ]) {
    assert.equal(fileExists(docPath), true, `documento de governança precisa existir: ${docPath}`);
  }

  // Nenhum destes documentos pode fingir uma decisão jurídica definitiva que não foi tomada.
  const retentionRegister = read("docs/DATA_RETENTION_REGISTER.md");
  assert.match(retentionRegister, /decisão jurídica pendente/i, "matriz de retenção precisa deixar explícito o que ainda depende de decisão jurídica, não inventar prazos");

  const termsReviewItems = read("docs/TERMS_LEGAL_REVIEW_ITEMS.md");
  assert.match(termsReviewItems, /NEEDS_LEGAL_REVIEW_FOR_BRAZILIAN_CONSUMERS/, "item da cláusula de jurisdição precisa estar marcado explicitamente");
  assert.match(termsReviewItems, /não foi validada juridicamente/i, "proposta alternativa não pode ser apresentada como definitiva");
  // Fase 12 explicitamente pede para NÃO reescrever a cláusula vinculante sem revisão jurídica.
  assert.doesNotMatch(
    read("client/public/terms-of-service.md"),
    /República Federativa do Brasil/,
    "Fase 12: o documento vinculante servido aos usuários não deve ser reescrito unilateralmente — a proposta fica só no documento de revisão",
  );

  console.log("REVENDASMART-LGPD-ANPD-REMEDIATION-01 tests passed: privacy policy P0 fix, Pix minimization, offline tenant isolation, sales rule hardening, distributed rate limiting, log sanitization, governance docs.");
}

run();
