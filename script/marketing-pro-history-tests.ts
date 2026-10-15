/**
 * ADS-PRO-03 — H1-H18: histórico reproduzível do Anúncios Pro (persistência + identidade).
 *
 * `persistProAdHistory`/`ProAdGenerationPanel` tocam DOM real (fetch de token, upload, canvas) — não
 * executáveis em Node puro. Seguindo o mesmo padrão já usado no resto da suite para componentes React
 * (script/smoke-tests.ts, script/pro-ad-generation-ui-foundation-tests.ts), as garantias de FIAÇÃO/
 * SNAPSHOT/IMUTABILIDADE são verificadas por asserção de source text; a segurança real (H19-H21,
 * tenant isolation) roda contra o emulador de verdade em script/firebase-emulator-tests.ts.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const panelPath = path.join("client", "src", "components", "marketing", "ProAdGenerationPanel.tsx");
const panel = fs.readFileSync(panelPath, "utf8");
const historyHookPath = path.join("client", "src", "hooks", "useMarketingHistory.ts");
const historyHook = fs.readFileSync(historyHookPath, "utf8");
const cardPath = path.join("client", "src", "components", "marketing", "MarketingHistoryCard.tsx");
const card = fs.readFileSync(cardPath, "utf8");
const rules = fs.readFileSync("firestore.rules", "utf8");

function slice(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.ok(start > -1, `marcador de início não encontrado: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `marcador de fim não encontrado depois de "${startMarker}": ${endMarker}`);
  return source.slice(start, end);
}

const persistFn = slice(panel, "async function persistProAdHistory(", "type ProAdGenerationPanelProps");

// H1 — o schema Pro é reconhecido: os campos novos existem no tipo real, e o resolver client-side
// (firestore.rules) reconhece os mesmos nomes — se um deles ficar de fora, a escrita real falharia por
// permission-denied silencioso, o mesmo bug que motivou este ticket para o histórico clássico originalmente.
for (const field of ["mode?:", "composerVersion?:", "creativeFamily?:", "creativeConceptId?:", "format?:", "proBackground?:", "proCutout?:"]) {
  assert.ok(historyHook.includes(field), `H1: MarketingHistoryEntry precisa declarar ${field}`);
}
for (const field of ["'mode'", "'composerVersion'", "'creativeFamily'", "'creativeConceptId'", "'format'", "'proBackground'", "'proCutout'"]) {
  assert.ok(rules.includes(field), `H1: firestore.rules marketingHistoryAllowedFields precisa incluir ${field}`);
}
assert.match(rules, /function isValidProBackground\(/, "H1: precisa existir um validador dedicado para proBackground");
assert.match(rules, /function isValidProCutout\(/, "H1: precisa existir um validador dedicado para proCutout");

// H2 — o histórico clássico continua reconhecido: nenhum campo pré-existente foi removido do tipo nem
// da allowlist das Rules (ADS-PRO-03 §24: só mudanças aditivas compatíveis com schema).
for (const field of ["generatedText: string", "template: string", "price: string", "headline: string", "storeName: string", "primaryColor: string", "templateId?:", "themeId?:", "productAssetSnapshot?:"]) {
  assert.ok(historyHook.includes(field), `H2: campo clássico não pode ter sido removido de MarketingHistoryEntry: ${field}`);
}
for (const field of ["'template'", "'templateId'", "'themeId'", "'generatedText'", "'productAssetSnapshot'"]) {
  assert.ok(rules.includes(field), `H2: campo clássico não pode ter sido removido da allowlist: ${field}`);
}

// H3 — snapshot do produto: os campos vêm de productTruth (o que foi de fato renderizado), nunca
// recomputados de outra fonte dentro da própria função de persistência.
assert.match(persistFn, /productName: input\.productTruth\.name/, "H3: productName precisa vir do snapshot productTruth");
assert.match(persistFn, /productBrand: input\.productTruth\.brand/, "H3: productBrand precisa vir do snapshot productTruth");
assert.match(persistFn, /productVolume: input\.productTruth\.volume/, "H3: productVolume precisa vir do snapshot productTruth");

// H4 — snapshot de branding: vem do parâmetro `branding` recebido no momento da geração, nunca de um
// lookup próprio dentro da função.
assert.match(persistFn, /storeName: input\.branding\.storeName/, "H4: storeName precisa vir do snapshot branding");
assert.match(persistFn, /storeLogoUrl: input\.branding\.storeLogoUrl/, "H4: storeLogoUrl precisa vir do snapshot branding");
assert.match(persistFn, /primaryColor: input\.branding\.primaryColor/, "H4: primaryColor precisa vir do snapshot branding");

// H5 — identidade do cutout aprovado é persistida (referências, nunca bytes/base64).
assert.match(persistFn, /cutoutAssetId: input\.approvedCutoutSource\.cutoutAssetId/, "H5: cutoutAssetId precisa ser persistido");
assert.match(persistFn, /storagePath: input\.approvedCutoutSource\.storagePath/, "H5: storagePath do cutout precisa ser persistido");
assert.doesNotMatch(persistFn, /base64|inlineData/i, "H5/§21: nenhum byte/base64 do cutout pode ser persistido");

// H6 — backgroundId/version/family são persistidos a partir da identidade JÁ RESOLVIDA (nunca
// recalculados dentro da função de persistência).
assert.match(persistFn, /backgroundId: input\.identity\.background\.backgroundId/, "H6: backgroundId precisa ser persistido");
assert.match(persistFn, /backgroundVersion: input\.identity\.background\.backgroundVersion/, "H6: backgroundVersion precisa ser persistido");
assert.match(persistFn, /backgroundFamily: input\.identity\.background\.backgroundFamily/, "H6: backgroundFamily precisa ser persistido");
assert.doesNotMatch(persistFn, /resolveMarketingProBackground\(/, "H6/§18: persistProAdHistory nunca deve re-resolver um background — só usar a identidade já decidida");

// H7 — composerVersion é persistido a partir da identidade formal do composer canônico.
assert.match(persistFn, /composerVersion: input\.identity\.composerVersion/, "H7: composerVersion precisa ser persistido");
assert.match(panel, /MARKETING_PRO_COMPOSER_VERSION/, "H7: o painel precisa importar/usar a versão formal do composer");

// H8 — format e a identidade de template real (creativeFamily — ADS-PRO-01 §11 já provou que é ela,
// não PROFESSIONAL_LAYOUTS.productRect, quem controla o layout de fato) são persistidos.
assert.match(persistFn, /format: input\.identity\.format/, "H8: format precisa ser persistido");
assert.match(persistFn, /creativeFamily: input\.identity\.creativeFamily/, "H8: creativeFamily precisa ser persistido");
assert.match(persistFn, /creativeConceptId: input\.identity\.creativeConceptId/, "H8: creativeConceptId precisa ser persistido");

// H9/H10 — reprodutibilidade: persistProAdHistory nunca lê o Product/branding "ao vivo" de novo (ex.:
// via Firestore/hooks) — só os parâmetros recebidos, que são o snapshot do momento exato da geração.
// Uma mudança de preço/branding depois da geração não pode, portanto, mudar o que já foi persistido.
assert.doesNotMatch(persistFn, /getFirestore\(|getDoc\(|onSnapshot\(|useUserSettings\(|useProductsData\(/, "H9/H10: a função de persistência não pode re-consultar Product/UserSettings — só usar o snapshot recebido");

// H11/H12 — o histórico armazena a versão EXATA resolvida, nunca "a versão mais recente": nada no
// caminho de leitura (o card) resolve o background de novo a partir da library atual.
assert.doesNotMatch(card, /resolveMarketingProBackground|marketing-pro-background-library/, "H11/H12: MarketingHistoryCard não pode re-resolver background a partir da library atual — só ler o que já foi salvo");

// H13 — nunca persiste uma blob URL. imageUrl só pode vir da resposta do upload real (Storage), nunca
// de URL.createObjectURL (que é local/temporária, revogada quando o componente desmonta).
const imageUrlAssignments = [...persistFn.matchAll(/imageUrl:\s*([^,\n]+)/g)].map((m) => m[1].trim());
assert.equal(imageUrlAssignments.length, 1, "H13: imageUrl só pode ser atribuído uma vez dentro de persistProAdHistory");
assert.equal(imageUrlAssignments[0], "uploadResult.downloadUrl", "H13: imageUrl precisa vir exatamente de uploadResult.downloadUrl (Storage real), nunca de um blob local");
assert.doesNotMatch(persistFn, /URL\.createObjectURL/, "H13: persistProAdHistory nunca pode gerar/persistir uma blob URL");

// H14 — uma geração Pro cria UM registro de histórico: só uma chamada a recordAction dentro da função
// de persistência (nunca duas, nunca um loop).
const recordActionCalls = [...persistFn.matchAll(/input\.recordAction\(/g)];
assert.equal(recordActionCalls.length, 1, "H14: persistProAdHistory só pode chamar recordAction exatamente 1 vez");

// H15 — falha de geração não cria registro completo: a chamada de persistência só pode acontecer DEPOIS
// da checagem de pngBlob nulo (nunca antes, nunca em paralelo com a checagem de falha).
const nullCheckIndex = panel.indexOf('if (!pngBlob) {');
const persistCallIndex = panel.indexOf("await persistProAdHistory(");
assert.ok(nullCheckIndex > -1 && persistCallIndex > nullCheckIndex, "H15: a chamada de persistência precisa vir DEPOIS da checagem de pngBlob nulo, nunca antes");

// H16 — double submit/retry não duplica: o guard de concorrência (busyRef) continua incondicional, e o
// id do registro é gerado uma única vez por chamada de handleGenerate (nunca reaproveitado entre
// chamadas concorrentes, nunca um contador global mutável fora do escopo da função).
assert.match(panel, /if \(!approvedCutoutSource \|\| busyRef\.current\) return;/, "H16: o guard de double-click precisa continuar incondicional");
assert.match(panel, /const historyEntryId = createMarketingEntryId\(\);/, "H16: o id do registro precisa ser gerado localmente, uma vez por chamada de handleGenerate");

// H17 — a identidade REAL usada no ReadyArt é a mesma passada para a persistência — nunca duas
// identidades calculadas separadamente que poderiam divergir.
assert.match(panel, /persistProAdHistory\(\{ entryId: historyEntryId, pngBlob, product, productTruth, branding, identity, approvedCutoutSource, recordAction \}\)/, "H17: a persistência precisa receber exatamente a MESMA `identity` usada no ReadyArt, não uma recomputada");
assert.match(panel, /current: \{ generationId, previewUrl, pngBlob, identity, historyPersisted \}/, "H17: ReadyArt.identity precisa ser a mesma variável `identity` usada na persistência");

// H18 — o card de histórico sabe renderizar um registro Pro sem quebrar (nunca chama
// resolveMarketingTemplate para ele, que só entende MarketingTemplateId clássico).
assert.match(card, /const isPro = entry\.mode === "pro";/, "H18: o card precisa distinguir explicitamente um registro Pro");
assert.match(card, /const template = isPro \? null : resolveMarketingTemplate/, "H18: resolveMarketingTemplate nunca pode ser chamado para um registro Pro");
assert.match(card, /data-testid=\{`badge-history-pro-\$\{entry\.id\}`\}/, "H18: o card precisa renderizar um badge Pro identificável");

console.log("Marketing Pro history tests passed: H1-H18 (schema recognized, classic preserved, product/branding/cutout/background/composer/format snapshots frozen at generation time, no blob URL, single record per generation, no record on failure, identity shared with ReadyArt, card renders Pro records safely).");
