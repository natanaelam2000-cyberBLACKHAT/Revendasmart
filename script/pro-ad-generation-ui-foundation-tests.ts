/**
 * PRO-13UI — testes de fundação da UI de geração/preview final do Anúncios Pro
 * (`client/src/components/marketing/ProAdGenerationPanel.tsx` + a integração em
 * `CreativeConceptsSection.tsx`/`MarketingProPanel.tsx`).
 *
 * `ProAdGenerationPanel` usa `document.createElement`/`Image`/`canvas` — não existem em Node puro, então
 * (assim como o resto da suíte faz para telas que dependem de DOM real, ex.: o "Gerar fundo com IA" do
 * PRO-08, nunca coberto por execução real em `npm test`) estes testes são varredura estática de
 * código-fonte: provam que os estados/guards/contratos certos existem no texto do componente, sem tentar
 * executar canvas/Image fora de um browser real.
 */
import assert from "node:assert/strict";
import fs from "node:fs";

function run(): void {
  const panelSource = fs.readFileSync("client/src/components/marketing/ProAdGenerationPanel.tsx", "utf8");
  const sectionSource = fs.readFileSync("client/src/components/marketing/CreativeConceptsSection.tsx", "utf8");
  const marketingProPanelSource = fs.readFileSync("client/src/components/marketing/MarketingProPanel.tsx", "utf8");

  // A. Estados de geração modelados exatamente como pedido — nenhum estado paralelo inventado.
  assert.match(panelSource, /\{ readonly phase: "concept-selected" \}/);
  assert.match(panelSource, /\{ readonly phase: "generating"; readonly lastReady\?: ReadyArt \}/);
  assert.match(panelSource, /\{ readonly phase: "ready"; readonly current: ReadyArt; readonly previous\?: ReadyArt \}/);
  assert.match(panelSource, /\{ readonly phase: "failed"; readonly message: string; readonly lastReady\?: ReadyArt \}/);

  // B. Loading profissional: copy real do backlog, mas explicitamente marcado como ritmo de UX, não
  // etapas reais do backend (o backend não expõe progresso parcial).
  for (const mensagem of ["Preparando seu anúncio...", "Entendendo a direção visual...", "Criando o cenário...", "Montando seu produto..."]) {
    assert.ok(panelSource.includes(mensagem), `mensagem de loading ausente: ${mensagem}`);
  }
  assert.match(panelSource, /não expõe etapas reais/, "o comentário precisa deixar explícito que as mensagens são só ritmo de UX");

  // C. ADS-PRO-04 — o fluxo canônico agora suporta 4:5 e 1:1, com 4:5 como padrão local.
  assert.match(panelSource, /useState<Extract<MarketingProFormat, "portrait" \| "square">>\("portrait"\)/, "C: o formato padrão precisa ser portrait");
  assert.match(panelSource, /data-testid="button-pro-ad-format-portrait"/, "C: seletor 4:5 ausente");
  assert.match(panelSource, /data-testid="button-pro-ad-format-square"/, "C: seletor 1:1 ausente");
  assert.match(panelSource, /format: selectedFormat/g, "C: geração e identidade precisam propagar o formato escolhido");
  assert.match(panelSource, /style=\{\{ aspectRatio: previewAspectRatio \}\}/, "C: o preview precisa refletir o aspect ratio real, não um quadrado fixo");
  assert.match(panelSource, /object-contain/, "C: a arte nunca é cortada (object-contain, não object-cover)");

  // D. Comparação Anterior/Atual só aparece quando existe uma versão anterior de verdade.
  assert.match(panelSource, /\{state\.previous && \(/, "D: o toggle de comparação só renderiza com uma versão anterior real");
  assert.match(panelSource, /data-testid="button-pro-ad-view-previous"/);
  assert.match(panelSource, /data-testid="button-pro-ad-view-current"/);

  // E. Ações pedidas — todas presentes com testids estáveis.
  for (const testid of ["button-pro-ad-generate", "button-pro-ad-download", "button-pro-ad-regenerate", "button-pro-ad-choose-another", "button-pro-ad-back", "button-pro-ad-retry"]) {
    assert.match(panelSource, new RegExp(`data-testid="${testid}"`), `E: ação ausente (${testid})`);
  }
  // "Gerar novamente" não pode disparar double-click — mesmo guard usado no resto do painel Pro.
  // ADS-PRO-02: library-first — o guard incondicional só protege cutout ausente e double-click; flag
  // OFF/capability server-side ausente só bloqueiam quando o usuário optou pelo modo IA experimental
  // (o caminho library, padrão, nunca depende de nenhum dos dois — AI_UNAVAILABLE_BLOCKS_PRO_GENERATION = NO).
  assert.match(panelSource, /if \(!approvedCutoutSource \|\| busyRef\.current\) return;/, "E: geração é fail-closed contra cutout ausente e double-click, incondicionalmente");
  assert.match(panelSource, /if \(sourceMode === "ai" && \(!realBackgroundEnabled \|\| !serverCapabilityReady\)\) return;/, "E: flag OFF/capability ausente só bloqueiam o modo IA opt-in, nunca o caminho library padrão");
  assert.match(panelSource, /createMarketingProGenerationRequestId\(\)/, "E: cada geração via IA usa um generationRequestId novo, nunca reaproveitado");

  // F. Erro: mantém conceito selecionado (o componente inteiro só desmonta via onBackToConcepts,
  // nunca sozinho no catch), mantém a última arte pronta se existir, mensagem amigável, "Tentar
  // novamente", e nunca chama onBackToConcepts a partir do catch (nunca joga o usuário pro início).
  assert.match(panelSource, /lastReady\?: ReadyArt/);
  assert.match(panelSource, /state\.lastReady &&/, "F: a última arte pronta continua visível durante uma falha nova");
  // ADS-PRO-03: persistProAdHistory (função à parte, definida ANTES de handleGenerate no arquivo) ganhou
  // seu próprio "} catch {" — buscar a partir do início do arquivo pegaria o catch ERRADO. A busca agora
  // começa em "const handleGenerate = ", o marcador único da função que este teste realmente audita.
  const handleGenerateStart = panelSource.indexOf("const handleGenerate = ");
  assert.ok(handleGenerateStart > -1, "F: handleGenerate precisa existir");
  assert.doesNotMatch(
    panelSource.slice(panelSource.indexOf("} catch {", handleGenerateStart), panelSource.indexOf("} finally {", handleGenerateStart)),
    /onBackToConcepts/,
    "F: uma falha de geração nunca volta o usuário para a tela de conceitos sozinha",
  );

  // G. Bloqueio sem approvedCutout — mensagem exata pedida, nenhum fallback visual que troque o produto.
  assert.match(panelSource, /Prepare o recorte do produto antes de gerar o anúncio\./);
  assert.match(panelSource, /const noCutout = !approvedCutoutSource;/);
  assert.doesNotMatch(panelSource, /placeholder|mock-cutout|defaultCutout/i, "G: nenhum recorte falso substitui o produto quando falta approvedCutout");

  // H. Resumo do conceito escolhido: label + família + resumo curto — nunca o score técnico.
  assert.match(panelSource, /concept\.concept\.label/);
  assert.match(panelSource, /CONCEPT_FAMILY_LABELS\[concept\.concept\.creativeFamily\]/);
  assert.match(panelSource, /CONCEPT_FAMILY_SUMMARY\[concept\.concept\.creativeFamily\]/);
  assert.doesNotMatch(panelSource, /concept\.scores\.overallScore/, "H: o painel de geração não expõe o score técnico do conceito");

  // I. Dados do produto discretos — nome, preço, promoção se existir; nunca renderizados como a arte.
  assert.match(panelSource, /\{product\.name\}/);
  assert.match(panelSource, /formatCurrency\(product\.salePrice\)/);
  assert.match(panelSource, /hasPromotion/);

  // J. Export: liga o "Baixar PNG" a um download real (elemento <a> de verdade, nunca um botão que só
  // finge o download).
  assert.match(panelSource, /link\.download = `anuncio-\$\{product\.id\}\.png`;/);
  assert.match(panelSource, /document\.createElement\("a"\)/);
  assert.doesNotMatch(panelSource, /alert\("|window\.open\("about:blank"|TODO.*download/i, "J: nenhum download fingido");

  // K. Mobile — sem overflow horizontal, alvos de toque >= 44px, largura relativa.
  assert.match(panelSource, /min-h-11/);
  assert.doesNotMatch(panelSource, /overflow-x-(scroll|auto)/, "K: nenhum scroll horizontal introduzido");
  assert.doesNotMatch(panelSource, /w-\[\d{3,}px\]/, "K: nenhuma largura fixa grande");

  // L. Acessibilidade: botões reais (nunca <div onClick>), aria-busy durante geração, erro com role="alert".
  assert.doesNotMatch(panelSource, /<div[^>]*onClick=/, "L: nenhuma ação usa <div onClick>, só <button> reais");
  assert.match(panelSource, /aria-busy="true"/, "L: aria-busy durante a geração");
  assert.match(panelSource, /role="alert"/, "L: erro de geração é anunciado como alerta");
  assert.match(panelSource, /role="status"/, "L: bloqueio de cutout é anunciado como status");

  // M. Free nunca vê o fluxo — gate herdado do painel (proAdsEnabled) e propagado até o conceito
  // confirmado; nenhum caminho novo dribla esse gate.
  assert.match(marketingProPanelSource, /\{proAdsEnabled && selectedProduct && \([\s\S]*?<CreativeConceptsSection[\s\S]*?realBackgroundEnabled=\{realBackgroundEnabled\}/);
  assert.doesNotMatch(panelSource, /proAdsEnabled|canUseFeature|usePlan/, "M: o painel de geração não decide plano sozinho — herda do gate do painel Pro");

  // N. Integração real: CreativeConceptsSection só monta o painel de geração com um conceito confirmado,
  // some com a grade de conceitos enquanto isso, e devolve o approvedCutoutSource real recebido do painel.
  assert.match(sectionSource, /\{readyResult && confirmedConceptId && \(/, "N: o painel de geração só aparece com um conceito confirmado");
  assert.match(sectionSource, /\{readyResult && !confirmedConceptId && \(/, "N: a grade de conceitos some enquanto o painel de geração está visível");
  assert.match(sectionSource, /approvedCutoutSource=\{approvedCutoutSource\}/, "N: o approvedCutoutSource real é repassado ao painel de geração, nunca inventado");
  assert.match(sectionSource, /onBackToConcepts=\{\(\) => setConfirmedConceptId\(null\)\}/, "N: voltar/escolher outro reabre a grade real de conceitos");

  // O. Não toca nenhuma área proibida (provider/Gemini/safety gates/cost guard/ledger/rate limit/
  // persistência/contratos de provider) — só reaproveita os módulos client já existentes do PRO-08/09.
  // Varredura restrita às linhas de import (o texto explicativo dos comentários pode CITAR esses nomes
  // ao descrever o que não foi tocado, sem que isso signifique um import real).
  const forbidden = /marketing-pro-provider|marketing-pro-cost-guard|marketing-pro-usage-ledger|marketing-pro-rate-limit-firestore|marketing-pro-background-persistence|marketing-pro-semantic-gate|marketing-pro-safe-zone-gate|marketing-pro-image-binary-gate|firebase-admin|GEMINI_API_KEY|server\/marketing-pro/i;
  for (const fonte of [panelSource, sectionSource]) {
    const importLines = fonte.match(/^import .*$/gm) || [];
    assert.equal(
      importLines.some((line) => forbidden.test(line)),
      false,
      "O: nenhum import de área proibida (provider/gates/cost guard/ledger/rate limit/persistência/server)",
    );
  }

  // P. PRO-13 removeu o adapter temporário: envia id/família fechados e o backend deriva a spec.
  assert.doesNotMatch(panelSource, /TEMP_CONCEPT_FAMILY_TO_PROVIDER_STYLE|style:/, "P: o client não escolhe mais MarketingProStyle no fluxo por conceito");
  assert.match(panelSource, /creativeConceptId: concept\.concept\.id/);
  assert.match(panelSource, /creativeFamily: concept\.concept\.creativeFamily/);

  // Q. O preview e o histórico usam as dimensões canônicas do formato, sem schema novo nem rerender
  // divergente — a identidade persiste o mesmo selectedFormat mostrado no preview.
  assert.match(panelSource, /const previewDimensions = MARKETING_PRO_FORMAT_DIMENSIONS\[selectedFormat\];/, "Q: dimensões canônicas do formato ausentes no preview");
  assert.match(panelSource, /format: selectedFormat, creativeConceptId:/, "Q: a identidade persistida precisa carregar o formato escolhido");

  console.log("Pro Ad Generation UI Foundation: 17 invariants (A-Q) passed (static source verification — canvas/Image real execution requires a browser, not covered here).");
}

run();
