/**
 * RELEASE-QUALITY-03 — fecha o backlog de P1 restantes explicitamente listado no documento de
 * continuação: cobertura completa de Android back (overlays customizados + primitivos Radix
 * compartilhados), touch targets críticos, erros de fetch visíveis em Catálogo/Relatórios, e loading
 * consistente nas duas telas billing-adjacent.
 */
import assert from "node:assert/strict";
import fs from "node:fs";

function read(path: string): string {
  return fs.readFileSync(path, "utf8");
}

function run(): void {
  // ===== P1-01 — cobertura completa de Android back =====

  // Overlays customizados (não-Radix) que abrem/fecham por conta própria.
  const clientPickerSheetSource = read("client/src/components/sell/ClientPickerSheet.tsx");
  assert.match(clientPickerSheetSource, /useDismissibleOnBack\(open, onClose\);/, "P1-01: ClientPickerSheet se registra sozinho — cobre sell.tsx E NewOrderSheet com uma wiring só");

  const newOrderSheetSource = read("client/src/components/orders/NewOrderSheet.tsx");
  assert.match(newOrderSheetSource, /useDismissibleOnBack\(open, onClose\);/, "P1-01: NewOrderSheet fecha com o back");
  assert.match(newOrderSheetSource, /useDismissibleOnBack\(showNewClientModal, \(\) => setShowNewClientModal\(false\)\);/, "P1-01: modal aninhado de novo cliente fecha primeiro (LIFO)");

  const orderDetailsSheetSource = read("client/src/components/orders/OrderDetailsSheet.tsx");
  assert.match(orderDetailsSheetSource, /useDismissibleOnBack\(Boolean\(order\), onClose\);/, "P1-01: OrderDetailsSheet fecha com o back");

  const orderStatusSheetSource = read("client/src/components/orders/OrderStatusSheet.tsx");
  assert.match(orderStatusSheetSource, /useDismissibleOnBack\(open, onClose\);/, "P1-01: OrderStatusSheet fecha com o back");

  const barcodeScannerSource = read("client/src/components/barcode-scanner.tsx");
  assert.match(barcodeScannerSource, /useDismissibleOnBack\(true, onClose\);/, "P1-01: scanner de câmera fecha com o back em vez de deixar a câmera presa");

  const clientsSource = read("client/src/pages/clients.tsx");
  assert.match(clientsSource, /useDismissibleOnBack\(showAdd, \(\) => setShowAdd\(false\)\);/, "P1-01: modal de novo/editar cliente fecha com o back");

  const productsSource = read("client/src/pages/products.tsx");
  assert.match(productsSource, /useDismissibleOnBack\(deleteConfirm\.show, \(\) => setDeleteConfirm\(\{ show: false \}\)\);/, "P1-01: confirmação de exclusão de produto fecha com o back");

  // Primitivos Radix compartilhados — leverage máximo: qualquer consumer existente ou futuro herda o
  // comportamento sem precisar de wiring próprio.
  const dialogSource = read("client/src/components/ui/dialog.tsx");
  assert.match(dialogSource, /useDismissibleOnBack\(true, \(\) => hiddenCloseRef\.current\?\.click\(\)\);/, "P1-01: DialogContent registra e reaproveita o MESMO DialogPrimitive.Close visível");
  assert.match(dialogSource, /ref=\{hiddenCloseRef\}/, "P1-01: o ref está realmente ligado ao botão de fechar real, não a um elemento novo");

  const alertDialogSource = read("client/src/components/ui/alert-dialog.tsx");
  assert.match(alertDialogSource, /useDismissibleOnBack\(true, \(\) => hiddenCancelRef\.current\?\.click\(\)\);/, "P1-01: AlertDialogContent registra um Cancel oculto (mesma semântica do Escape)");
  assert.match(alertDialogSource, /AlertDialogPrimitive\.Cancel ref=\{hiddenCancelRef\}[^/]*className="sr-only"/, "P1-01: o Cancel oculto nunca é visível nem entra no tab order");

  const sheetSource = read("client/src/components/ui/sheet.tsx");
  assert.match(sheetSource, /useDismissibleOnBack\(true, \(\) => closeRef\.current\?\.click\(\)\);/, "P1-01: SheetContent reaproveita o MESMO X visível");
  assert.match(sheetSource, /SheetPrimitive\.Close ref=\{closeRef\}/, "P1-01: o ref está ligado ao Close real da sheet");

  // Áreas explicitamente fora de escopo desta rodada continuam intocadas (Catálogo comercial / Billing)
  // — o onboarding ativo do Ads Pro é exceção: ele precisa registrar o Android Back como parte desta
  // correção de overlay mobile.
  const creativeProfileOnboardingSource = read("client/src/components/marketing/CreativeProfileOnboarding.tsx");
  assert.match(creativeProfileOnboardingSource, /useDismissibleOnBack\(true, handleDismiss\)/, "P1-01: onboarding Ads Pro fecha com o Android Back");
  for (const arquivoExcluido of [
    "client/src/components/marketing/MarketingHistoryCard.tsx",
    "client/src/components/catalog/CatalogProductDetails.tsx",
    "client/src/components/catalog/ShareCatalogSheet.tsx",
    "client/src/components/PartialPaymentModal.tsx",
    "client/src/components/PaymentLinkModal.tsx",
  ]) {
    assert.doesNotMatch(read(arquivoExcluido), /useDismissibleOnBack/, `P1-01: ${arquivoExcluido} é Marketing Pro/Catálogo comercial/Billing — fora de escopo, não deve ter sido tocado`);
  }

  // ===== P1-02 — touch targets críticos =====
  assert.match(clientsSource, /min-h-11 min-w-11 rounded-xl bg-primary\/10 text-primary/, "P1-02: botão de editar cliente cresceu de 36px para 44px de área de toque");
  assert.match(clientsSource, /min-h-11 min-w-11 rounded-xl bg-red-50 text-red-600/, "P1-02: botão de excluir cliente cresceu de 36px para 44px de área de toque");
  assert.doesNotMatch(clientsSource, /w-9 h-9 rounded-xl bg-(primary\/10 text-primary|red-50 text-red-600)/, "P1-02: as classes antigas de 36px não sobraram duplicadas");

  const sellSourceP3 = read("client/src/pages/sell.tsx");
  assert.match(sellSourceP3, /min-h-11 min-w-11 items-center justify-center rounded-full bg-secondary" aria-label="Fechar resumo"/, "P1-02: fechar do resumo da venda cresceu de 32px para 44px");
  assert.match(sellSourceP3, /min-h-11 min-w-11 items-center justify-center rounded-full bg-secondary" aria-label="Fechar"/, "P1-02: fechar do modal de novo cliente cresceu de 36px para 44px");
  assert.doesNotMatch(sellSourceP3, /h-8 w-8 items-center justify-center rounded-full bg-secondary|h-9 w-9 items-center justify-center rounded-full bg-secondary/, "P1-02: as classes antigas pequenas não sobraram duplicadas em sell.tsx");
  assert.match(clientPickerSheetSource, /min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full bg-secondary/, "P1-02: fechar do ClientPickerSheet cresceu de 32px para 44px");

  // Ícone visual continua pequeno — só a ÁREA clicável cresceu (a instrução explícita era não inflar o ícone).
  for (const fonte of [clientsSource, sellSourceP3, clientPickerSheetSource]) {
    assert.match(fonte, /<X className="h-4 w-4" \/>|<Pencil className="w-4 h-4" \/>|<Trash2 className="w-4 h-4" \/>/, "P1-02: ícone continua no tamanho visual original (h-4 w-4)");
  }

  // ===== P1-03 — erros de fetch visíveis em Catálogo e Relatórios =====
  const catalogSource = read("client/src/pages/catalog.tsx");
  assert.match(catalogSource, /error: productsError,[\s\S]*\} = useCatalogProductsData\(\{/, "P1-03: catalog.tsx passou a ler o error de useCatalogProductsData");
  assert.match(catalogSource, /error: salesError \} = useSalesData\(\);/, "P1-03: catalog.tsx passou a ler o error de useSalesData");
  assert.match(catalogSource, /const blockingError = salesError \|\| \(products\.length === 0 \? productsError : ""\);/, "P1-03: catalog.tsx tem um branch de erro dedicado, separado do loading e do empty state");
  assert.match(catalogSource, /if \(blockingError\) \{/, "P1-03: catalog.tsx intercepta erro bloqueante antes do render normal");
  assert.match(catalogSource, /Não foi possível carregar o catálogo\./, "P1-03: mensagem curta e específica da tela, não genérica");
  assert.match(catalogSource, /Tentar novamente/, "P1-03: erro de catálogo oferece retry");

  const reportsSource = read("client/src/pages/reports.tsx");
  assert.match(reportsSource, /error: productsError \} = useProductsData\(\);/, "P1-03: reports.tsx passou a ler o error de useProductsData");
  assert.match(reportsSource, /error: salesError \} = useSalesData\(\);/, "P1-03: reports.tsx passou a ler o error de useSalesData");
  assert.match(reportsSource, /error: clientsError \} = useClientsLiteData\(\);/, "P1-03: reports.tsx passou a ler o error de useClientsLiteData");
  assert.match(reportsSource, /if \(dataError\) \{/, "P1-03: reports.tsx tem um branch de erro dedicado, separado do loading");
  assert.match(reportsSource, /Não foi possível carregar seus relatórios\./, "P1-03: mensagem curta e específica da tela, não genérica");
  // O erro precisa vir ANTES do render normal dos gráficos — nunca mostrar charts vazios quando houve falha real.
  assert.ok(reportsSource.indexOf("if (dataError)") < reportsSource.indexOf("calculateFinancialSummary") === false, "P1-03: o branch de erro está declarado depois dos cálculos (não os bloqueia), mas antes do render dos gráficos");
  assert.ok(reportsSource.indexOf("if (dataError)") < reportsSource.lastIndexOf("return ("), "P1-03: o branch de erro intercepta antes do render final da tela");

  // ===== P1-04 — loading consistente nas telas billing-adjacent =====
  const settingsMercadoPagoSource = read("client/src/pages/settings-mercadopago.tsx");
  assert.match(settingsMercadoPagoSource, /<PageSkeleton variant="settings" \/>/, "P1-04: settings-mercadopago.tsx usa o PageSkeleton compartilhado, não um spinner solto");
  assert.doesNotMatch(settingsMercadoPagoSource, /border-4 border-primary\/20 border-t-primary animate-spin/, "P1-04: o spinner genérico antigo foi removido, não duplicado");

  const subscribeSource = read("client/src/pages/subscribe.tsx");
  assert.match(subscribeSource, /if \(planLoading\) \{\s*\n\s*return \(\s*\n\s*<Layout title="Premium">\s*\n\s*<PageSkeleton variant="settings" \/>/, "P1-04: o loading inicial de plano usa PageSkeleton");
  // O spinner de "redirecionando para o Mercado Pago" é um estado de TRANSIÇÃO real (não uma espera de
  // dados) — continua um spinner de propósito, não um regression do fix.
  assert.match(subscribeSource, /Abrindo o Mercado Pago\.\.\./, "P1-04: o estado de redirecionamento (não é loading de dado) continua intacto");

  console.log("RELEASE-QUALITY-03: P1-01 through P1-04 invariants passed.");
}

run();
