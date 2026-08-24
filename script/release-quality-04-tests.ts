/**
 * RELEASE-QUALITY-04 — Dark Mode + Offline-First.
 *
 * Puro onde dá (nenhum aqui depende de canvas/DOM/Firestore real); o resto é asserção de código-fonte,
 * mesmo padrão já usado nas demais rodadas desta série para o que só pode ser validado ao vivo num
 * browser real (documentado no relatório final, não fabricado aqui como PASS).
 */
import assert from "node:assert/strict";
import fs from "node:fs";

function read(path: string): string {
  return fs.readFileSync(path, "utf8");
}

function run(): void {
  // ===== FASE 1 — Dark Mode =====

  const indexCss = read("client/src/index.css");
  // B/C: bloco .dark existe com TODOS os tokens que o claro também define — nenhum token "esquecido"
  // no escuro (o que faria aquele elemento cair silenciosamente no valor do :root claro).
  const rootBlockMatch = indexCss.match(/:root\s*\{([\s\S]*?)\n\}/);
  const darkBlockMatch = indexCss.match(/\.dark\s*\{([\s\S]*?)\n\}/);
  assert.ok(rootBlockMatch && darkBlockMatch, ":root e .dark precisam existir em index.css");
  const rootTokenNames = Array.from((rootBlockMatch![1].match(/--[a-z-]+(?=:)/g) ?? []));
  const darkTokenNames = new Set(darkBlockMatch![1].match(/--[a-z-]+(?=:)/g) ?? []);
  const coreTokens = ["--background", "--foreground", "--card", "--card-foreground", "--popover", "--popover-foreground",
    "--primary", "--primary-foreground", "--secondary", "--secondary-foreground", "--muted", "--muted-foreground",
    "--accent", "--accent-foreground", "--destructive", "--destructive-foreground", "--border", "--input", "--ring",
    "--success", "--warning", "--info"];
  for (const token of coreTokens) {
    assert.ok(rootTokenNames.includes(token), `token ${token} precisa existir no :root claro`);
    assert.ok(darkTokenNames.has(token), `B/C: token ${token} precisa ter override em .dark — senão o escuro herda o valor claro por acidente`);
  }
  // G/H: a camada --rs-* (charts, cards, dialogs, sheets, inputs) deriva de hsl(var(--x)) dos tokens
  // acima — não precisa de override próprio, EXCETO --rs-input-bg (documentado no próprio CSS).
  assert.match(indexCss, /--rs-chart-1: hsl\(var\(--primary\)\)/, "G: chart tokens continuam derivando do token central, não hardcoded");
  assert.match(darkBlockMatch![1], /--rs-input-bg: hsl\(var\(--accent\)/, "H: --rs-input-bg precisa de override no escuro (fundo full-dark ficaria colado no card atrás)");
  // Cada token precisa ser um triplet HSL de verdade (ex.: "210 25% 8%"), não um hex cru — os hex que
  // aparecem no arquivo são só comentários de referência, nunca o valor do token em si.
  for (const token of coreTokens) {
    const valueMatch = darkBlockMatch![1].match(new RegExp(`${token.replace("-", "\\-")}:\\s*([^;]+);`));
    assert.ok(valueMatch, `${token} precisa ter um valor em .dark`);
    assert.match(valueMatch![1].trim(), /^\d+(\.\d+)? \d+% \d+%$/, `${token} precisa estar em HSL puro ("H S% L%"), não hex — valor atual: "${valueMatch![1].trim()}"`);
  }

  // ThemeProvider — reaproveita next-themes (já instalado), não escreve lógica de tema própria.
  const themeProviderSource = read("client/src/components/ThemeProvider.tsx");
  assert.match(themeProviderSource, /from "next-themes"/, "precisa reusar next-themes, não reinventar");
  assert.match(themeProviderSource, /attribute="class"/, "estratégia de classe precisa bater com @custom-variant dark (&:is(.dark *)) do index.css");
  assert.match(themeProviderSource, /defaultTheme="system"/, "A: padrão precisa ser system");
  assert.match(themeProviderSource, /enableSystem/, "E: precisa acompanhar prefers-color-scheme quando em system");
  assert.match(themeProviderSource, /storageKey=\{?APPEARANCE_THEME_STORAGE_KEY\}?/, "D: precisa persistir em localStorage com chave própria (next-themes cuida do resto)");

  const mainSource = read("client/src/main.tsx");
  assert.match(mainSource, /<ThemeProvider>/, "ThemeProvider precisa estar montado no boot do app");
  assert.match(mainSource, /installAndroidThemeSync\(\);/, "I: status bar Android precisa sincronizar no boot");

  // Settings: appearanceMode é campo NOVO, separado de appTheme (paleta de marca) — nunca confundidos.
  const mockDataSource = read("client/src/lib/mock-data.ts");
  assert.match(mockDataSource, /appearanceMode\?:\s*"system" \| "light" \| "dark"/, "AppSettings precisa do campo appearanceMode");
  const settingsSource = read("client/src/pages/settings.tsx");
  assert.match(settingsSource, /handleSelectAppearanceMode/, "settings.tsx precisa do seletor de aparência");
  assert.match(settingsSource, /setAppearanceTheme\(mode\)/, "troca precisa ser IMEDIATA via next-themes, não só salva no formulário");
  assert.match(settingsSource, /data-testid=\{`button-appearance-\$\{option\.id\}`\}/, "seletor de aparência precisa expor um testid por opção");
  for (const mode of ["system", "light", "dark"]) {
    assert.match(settingsSource, new RegExp(`id: "${mode}" as const`), `seletor de aparência precisa oferecer a opção ${mode}`);
  }

  // I: status bar Android — plugin instalado e usado só dentro de isNativePlatform() (nunca quebra web/PWA).
  const packageJson = JSON.parse(read("package.json")) as { dependencies?: Record<string, string> };
  assert.ok(packageJson.dependencies?.["@capacitor/status-bar"], "@capacitor/status-bar precisa estar instalado");
  const androidThemeSource = read("client/src/lib/android-theme.ts");
  assert.match(androidThemeSource, /Capacitor\.isNativePlatform\(\)/, "sync de status bar precisa checar plataforma nativa antes de tudo");
  assert.match(androidThemeSource, /if \(!Capacitor\.isNativePlatform\(\)\) return;/, "web/PWA precisa sair cedo, sem tentar carregar o plugin nativo");
  assert.match(androidThemeSource, /MutationObserver/, "precisa reagir à troca de classe .dark no <html>, não só ao boot");

  // §7 identidade visual preservada: light mode (:root) não foi tocado nos valores, só o .dark foi
  // adicionado — comparação com os valores conhecidos do claro original.
  assert.match(indexCss, /--primary: 355 48% 65%/, "§7: token claro original não pode ter mudado de valor");
  assert.match(indexCss, /--background: 348 29% 97%/, "§7: token claro original não pode ter mudado de valor");

  // ===== FASE 2/3/4 — Offline read/write/sync =====

  const firebaseSource = read("client/src/lib/firebase.ts");
  assert.match(firebaseSource, /persistentLocalCache\(\{ tabManager: persistentMultipleTabManager\(\) \}\)/, "J/K/L/M: persistência offline do Firestore precisa estar ligada");
  assert.match(firebaseSource, /initializeFirestoreWithOfflinePersistence\(app\);/, "init precisa rodar ANTES de qualquer getFirestore(app) no resto do boot");
  // A ordem importa: precisa vir antes de connectFirebaseEmulatorsOnce (que internamente chama getFirestore).
  const initOrder = firebaseSource.indexOf("initializeFirestoreWithOfflinePersistence(app);");
  const emulatorConnectOrder = firebaseSource.indexOf("connectFirebaseEmulatorsOnce(app, authInstance);");
  assert.ok(initOrder > 0 && emulatorConnectOrder > initOrder, "initializeFirestore precisa rodar ANTES do connector de emulador (que já faz getFirestore)");

  // Hooks de leitura continuam só onSnapshot — nenhum getDocs/getDoc que ignoraria o cache offline.
  for (const hookFile of ["client/src/hooks/useProductsData.ts", "client/src/hooks/useClientsLiteData.ts", "client/src/hooks/useSalesData.ts", "client/src/hooks/useOrdersData.ts"]) {
    const source = read(hookFile);
    assert.doesNotMatch(source, /\bgetDocs\(|\bgetDoc\(/, `K/L/M: ${hookFile} não pode usar leitura one-shot — só onSnapshot serve cache offline`);
  }

  // N/O/P: produtos/clientes continuam setDoc direto — sem mudança de código necessária, só a
  // persistência ligada acima já cobre a fila de escrita offline (verificado ao vivo no relatório).
  assert.match(read("client/src/pages/add-product.tsx"), /setDoc\(/, "criação/edição de produto precisa continuar via setDoc direto (fila offline do SDK)");

  // Vendas: fila explícita própria, escopo restrito a "avista" — nunca mistura com o fluxo de cobrança
  // (que é sempre online).
  const offlineQueueSource = read("client/src/lib/offline-sales-queue.ts");
  assert.match(offlineQueueSource, /paymentType: "avista";/, "fila de vendas offline só aceita avista — a prazo depende de cobrança online");
  assert.doesNotMatch(offlineQueueSource, /stock\s*[-+]?=|decrementStock|updateStock/i, "U: fila NUNCA decide/decrementa estoque no cliente — só o servidor (transaction) faz isso");
  assert.match(offlineQueueSource, /SALE_ALREADY_EXISTS/, "S: replay precisa tratar SALE_ALREADY_EXISTS (já existente no servidor) como sucesso, não duplicar");
  const pendingSalesSyncSource = read("client/src/hooks/usePendingSalesSync.ts");
  assert.match(pendingSalesSyncSource, /result\.outcome === "synced" \|\| result\.outcome === "already-exists"/, "S: sucesso OU já-existe limpam a fila igualmente");
  assert.match(pendingSalesSyncSource, /for \(const item of pending\)/, "F drain sequencial — nunca paralelo (evita duas tentativas concorrentes da mesma venda)");
  assert.match(pendingSalesSyncSource, /await user\.getIdToken\(true\)/, "sync precisa forçar renovação do token — um token em cache pode ter expirado durante o período offline, e isso não pode virar falha permanente");

  const firestoreRulesSource = read("firestore.rules");
  assert.match(firestoreRulesSource, /match \/pendingSales\/\{saleId\}/, "firestore.rules precisa ter uma regra explícita para pendingSales — sem ela, o catch-all nega a escrita e a venda offline é perdida silenciosamente ao sincronizar");
  assert.match(firestoreRulesSource, /request\.resource\.data\.payload == resource\.data\.payload/, "regra de update de pendingSales precisa impedir que o payload da venda seja reescrito depois de criado");

  const sellSource = read("client/src/pages/sell.tsx");
  assert.match(sellSource, /if \(!isOnline && paymentType === "installments"\)/, "V: venda a prazo offline precisa ser bloqueada com mensagem clara, nunca tentar sem rede");
  assert.match(sellSource, /if \(!isOnline && paymentType === "cash"\)/, "N: venda à vista offline precisa cair na fila, não em erro");
  assert.match(sellSource, /queuePendingSale\(uid,/, "N: precisa reusar a fila, não inventar uma segunda gravação");
  assert.match(sellSource, /isNetworkFailure\(err\) && paymentType === "cash"/, "queda de conexão NO MEIO da tentativa também precisa cair na fila (não só quando já começa offline) — inclui falhas de token do Firebase Auth, não só TypeError de fetch");
  const offlineQueueHelperSource = offlineQueueSource;
  assert.match(offlineQueueHelperSource, /export function isNetworkFailure/, "detecção de falha de rede precisa cobrir FirebaseError (ex.: auth/network-request-failed), não só TypeError");
  assert.doesNotMatch(sellSource, /await queuePendingSale\(/, "escrita da fila offline não pode ser aguardada antes de liberar a UI — a Promise do Firestore só resolve com o ack do servidor, e offline isso nunca chega");

  // §8 — isolamento por tenant: logout limpa o cache offline do Firestore, além do path por uid já
  // existente (defesa em profundidade, não o único mecanismo).
  assert.match(firebaseSource, /export async function clearFirestoreOfflineCache/, "T: função de limpeza de cache offline precisa existir");
  assert.match(firebaseSource, /await terminate\(db\);/, "T: precisa terminar a instância antes de limpar o IndexedDB");
  assert.match(firebaseSource, /await clearIndexedDbPersistence\(db\);/, "T: precisa limpar o IndexedDB de fato, não só desconectar");
  assert.match(settingsSource, /await clearFirestoreOfflineCache\(\);/, "T: logout normal precisa chamar a limpeza");
  const accountDeletionSource = read("client/src/pages/account-deletion.tsx");
  assert.match(accountDeletionSource, /await clearFirestoreOfflineCache\(\);/, "T: exclusão de conta também precisa limpar o cache offline");

  // §7 — indicador de conectividade discreto, sem popup, sem bloquear a tela.
  const connectivitySource = read("client/src/components/ConnectivityIndicator.tsx");
  for (const state of ["Offline", "Sincronizando...", "Tudo sincronizado", "Falha ao sincronizar"]) {
    assert.match(connectivitySource, new RegExp(state.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `indicador precisa cobrir o estado "${state}"`);
  }
  assert.doesNotMatch(connectivitySource, /alert\(|window\.confirm\(/, "nunca popup bloqueante para avisar sobre conectividade");
  assert.match(indexCss, /\.rs-connectivity-badge \{[\s\S]*?pointer-events: none;/, "badge de conectividade não pode bloquear toque no resto da tela");

  const privateRouterSource = read("client/src/routers/PrivateRouter.tsx");
  assert.match(privateRouterSource, /<ConnectivityIndicator \/>/, "indicador precisa estar montado globalmente, não só numa página");

  console.log("RELEASE-QUALITY-04 tests passed: dark mode tokens/provider/Android status bar, offline persistence/read/write/sales-queue/tenant-isolation/connectivity indicator.");
}

run();
