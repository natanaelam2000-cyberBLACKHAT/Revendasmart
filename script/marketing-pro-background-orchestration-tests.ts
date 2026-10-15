/**
 * ADS-PRO-02 — OR1-OR6: orquestração library-first/IA-opcional em ProAdGenerationPanel.
 *
 * `composeMarketingProProfessionalAdPreview`/`ProAdGenerationPanel` tocam DOM real (canvas, Image,
 * document) — não executáveis em Node puro. Seguindo o mesmo padrão já usado no resto da suite para
 * componentes React (ex.: script/smoke-tests.ts contra catalog.tsx), as garantias de FIAÇÃO/CONTROLE DE
 * FLUXO são verificadas por asserção de source text; as garantias de LÓGICA PURA (resolver/renderer da
 * library) são exercidas de verdade, chamando as funções reais — nada aqui é mockado.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { resolveMarketingProBackground, renderMarketingProBackgroundSource } from "../shared/marketing-pro-background-library";

const panelPath = path.join("client", "src", "components", "marketing", "ProAdGenerationPanel.tsx");
const panel = fs.readFileSync(panelPath, "utf8");

// OR1 — o caminho padrão nunca chama Gemini: sourceMode nasce "library", e a única chamada a
// generateMarketingProBackgroundAndWait no arquivo inteiro vive dentro do ramo `sourceMode === "ai"`.
assert.match(panel, /useState<"library" \| "ai">\("library"\)/, "OR1: sourceMode precisa nascer \"library\" por padrão");
const aiBranchStart = panel.indexOf('if (sourceMode === "ai") {');
assert.ok(aiBranchStart > -1, "OR1: precisa existir um ramo explícito `if (sourceMode === \"ai\")`");
const aiBranchEnd = panel.indexOf("} else {", aiBranchStart);
assert.ok(aiBranchEnd > aiBranchStart, "OR1: o ramo ai precisa ter um else (o ramo library) logo em seguida");
const generateCallSites = [...panel.matchAll(/generateMarketingProBackgroundAndWait\(/g)].map((m) => m.index!);
assert.equal(generateCallSites.length, 1, "OR1: generateMarketingProBackgroundAndWait só pode ser chamado em 1 lugar no arquivo");
assert.ok(generateCallSites[0] > aiBranchStart && generateCallSites[0] < aiBranchEnd, "OR1: a única chamada a generateMarketingProBackgroundAndWait precisa estar dentro do ramo ai, nunca fora dele");

// OR2 — capability de IA indisponível não bloqueia a geração Pro: o guard-clause de handleGenerate não
// pode mais depender de realBackgroundEnabled/serverCapabilityReady incondicionalmente, e os antigos
// blocos que travavam o painel inteiro (flag-off / server-capability-off) precisam ter sido removidos.
assert.match(panel, /if \(!approvedCutoutSource \|\| busyRef\.current\) return;/, "OR2: o guard-clause principal só pode depender do cutout aprovado, nunca de capability de IA");
assert.match(panel, /if \(sourceMode === "ai" && \(!realBackgroundEnabled \|\| !serverCapabilityReady\)\) return;/, "OR2: a checagem de capability precisa estar isolada ao modo ai");
assert.doesNotMatch(panel, /data-testid="text-pro-ad-flag-off"/, "OR2: o bloqueio antigo de painel inteiro por flag precisa ter sido removido");
assert.doesNotMatch(panel, /data-testid="text-pro-ad-server-capability-off"/, "OR2: o bloqueio antigo de painel inteiro por capability precisa ter sido removido");
assert.doesNotMatch(panel, /!realBackgroundEnabled \? \(/, "OR2: não pode existir mais nenhum ternário que trave o painel pela flag de IA");

// OR3 — erro/indisponibilidade de IA não contamina o caminho library: o estado "failed" é tratado por
// código comum (não há um branch de erro exclusivo do modo ai que desabilite o modo library depois), e
// nada persiste sourceMode como "travado" em ai após uma falha.
assert.match(panel, /catch \{\s*setState\(\(current\) => \(\{ phase: "failed"/, "OR3: o catch de falha precisa ser um único bloco comum a ambos os modos");
assert.doesNotMatch(panel, /setSourceMode\("ai"\)/, "OR3: nada além do próprio usuário (via checkbox) pode forçar sourceMode para \"ai\"");

// OR4 — o composer canônico recebe o background resolvido pela library, e SÓ o canônico é usado (nenhum
// outro composer é importado neste arquivo).
assert.match(panel, /composeLibraryBackground\(/, "OR4: o ramo library precisa passar pelo helper que resolve+compõe");
assert.match(panel, /backgroundImageSrc,\s*cutoutImageSrc: input\.cutoutImageSrc,/, "OR4: composeLibraryBackground precisa repassar backgroundImageSrc+cutoutImageSrc ao composer canônico");
const composerImports = [...panel.matchAll(/from "@\/lib\/marketing-pro-real-background-composer"/g)];
assert.equal(composerImports.length, 1, "OR4/§18: só pode existir 1 import do composer canônico neste arquivo");
assert.doesNotMatch(panel, /marketing-pro-creative-v2/, "OR4/§18: o painel de geração real não pode importar o Composer V2 (não-canônico)");
assert.doesNotMatch(panel, /marketing-pro-compositor/, "OR4/§18: o painel de geração real não pode importar o compositor de prévia de estilo (não-canônico)");
// A função real: mesmo family+category+format+seed resolvido aqui produz um backgroundImageSrc válido —
// exatamente o que o composer canônico já aceita hoje (string), sem precisar mudar a assinatura dele.
const resolved = resolveMarketingProBackground({ creativeFamily: "modern", category: "electronics", format: "square", seed: "or4-integration-check" });
const backgroundImageSrc = renderMarketingProBackgroundSource(resolved.asset, "square");
assert.equal(typeof backgroundImageSrc, "string", "OR4: backgroundImageSrc precisa ser string (contrato do composer canônico já existente, sem mudança)");

// OR5 — preview e download usam o MESMO blob: só existe 1 chamada a canvasToPngBlob por geração, e
// handleDownload lê o mesmo `.previewUrl` que a tag <img> de prévia usa — nunca um segundo render.
const pngBlobCallSites = [...panel.matchAll(/canvasToPngBlob\(canvas\)/g)];
assert.equal(pngBlobCallSites.length, 1, "OR5: canvasToPngBlob só pode ser chamado 1 vez por geração (preview e export vêm do mesmo blob)");
assert.match(panel, /link\.href = art\.previewUrl;/, "OR5: o download precisa usar o mesmo previewUrl do estado, nunca gerar um canvas novo");
assert.match(panel, /src=\{displayedArt\.previewUrl\}/, "OR5: a prévia <img> precisa usar o mesmo previewUrl armazenado no estado");

// OR6 — o cutout aprovado é passado intacto em ambos os modos: derivado 1 única vez de
// approvedCutoutSource, nunca recomputado/editado por modo.
const cutoutAssignSites = [...panel.matchAll(/approvedCutoutSource\.downloadUrl \|\| approvedCutoutSource\.storagePath/g)];
assert.equal(cutoutAssignSites.length, 1, "OR6: cutoutImageSrc precisa ser derivado uma única vez, reaproveitado por ambos os modos (ai e library)");
assert.match(panel, /const cutoutImageSrc = approvedCutoutSource\.downloadUrl \|\| approvedCutoutSource\.storagePath;/, "OR6: cutoutImageSrc precisa vir só do cutout já aprovado, nunca de outra fonte");

// §27/AP10 — falha ao carregar um background não deixa a arte quebrada: composeLibraryBackground tenta
// de novo com outro asset (excludeIds) antes de desistir, nunca uma única tentativa cega.
assert.match(panel, /for \(let attempt = 0; attempt < 2; attempt \+= 1\) \{/, "§27: composeLibraryBackground precisa tentar mais de um asset antes de desistir");
assert.match(panel, /excludeIds: attempted/, "§27: a segunda tentativa precisa excluir o asset que já falhou, nunca repetir o mesmo");

// §17 — call count de IA no caminho padrão: nenhuma chamada de rede de IA acontece a menos que o usuário
// tenha marcado o checkbox experimental (já provado estruturalmente acima em OR1/OR2).
console.log("Marketing Pro background orchestration tests passed: OR1-OR6, default path never calls Gemini, canonical composer only, preview/export parity, cutout passed untouched.");
