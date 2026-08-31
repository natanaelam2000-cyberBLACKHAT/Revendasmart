/** ADS-PRO-02 — BG1-BG10: biblioteca canônica de backgrounds do Anúncios Pro. Puro, sem DOM, sem rede,
 * sem provider — o registry e o resolver são TypeScript comum, testáveis diretamente em Node. */
import assert from "node:assert/strict";
import {
  MARKETING_PRO_BACKGROUND_LIBRARY,
  resolveMarketingProBackground,
  renderMarketingProBackgroundSource,
} from "../shared/marketing-pro-background-library";
import { isMarketingProFormat, MARKETING_PRO_CATEGORY_VALUES } from "../shared/marketing-pro-contract";
import { isCreativeFamily } from "../shared/marketing-pro-creative-intelligence";

// BG1 — ids únicos.
const ids = MARKETING_PRO_BACKGROUND_LIBRARY.map((asset) => asset.id);
assert.equal(new Set(ids).size, ids.length, "BG1: todo backgroundId deve ser único");
assert.ok(ids.length >= 12, `BG1: seed V1 precisa ter >= 12 backgrounds (achou ${ids.length})`);

// BG2 — toda entrada tem family válida (reaproveita CreativeFamily existente, nenhuma taxonomia nova).
for (const asset of MARKETING_PRO_BACKGROUND_LIBRARY) {
  assert.ok(isCreativeFamily(asset.family), `BG2: ${asset.id} tem family inválida (${asset.family})`);
}
const families = new Set(MARKETING_PRO_BACKGROUND_LIBRARY.map((asset) => asset.family));
assert.ok(families.size >= 3, `BG2: seed V1 precisa cobrir >= 3 famílias (achou ${families.size})`);

// BG3 — toda entrada tem version (inteiro positivo).
for (const asset of MARKETING_PRO_BACKGROUND_LIBRARY) {
  assert.ok(Number.isInteger(asset.version) && asset.version > 0, `BG3: ${asset.id} precisa de version inteira > 0`);
}

// BG4 — toda entrada declara pelo menos um formato suportado válido.
for (const asset of MARKETING_PRO_BACKGROUND_LIBRARY) {
  assert.ok(asset.formats.length > 0, `BG4: ${asset.id} precisa declarar ao menos 1 formato`);
  for (const format of asset.formats) assert.ok(isMarketingProFormat(format), `BG4: ${asset.id} declara formato inválido (${format})`);
}
// Arquitetura pronta para portrait mesmo com o fluxo real ainda restrito a square (ADS-PRO-02 §20/§21).
assert.ok(MARKETING_PRO_BACKGROUND_LIBRARY.every((asset) => asset.formats.includes("square")), "todos os assets do seed suportam square");
assert.ok(MARKETING_PRO_BACKGROUND_LIBRARY.some((asset) => asset.formats.includes("portrait")), "arquitetura precisa suportar portrait para expansão futura");

// BG5 — resolver é determinístico: mesma entrada, mesma saída (comparação estrutural profunda).
const inputA = { creativeFamily: "luxury" as const, category: "beauty" as const, format: "square" as const, seed: "product-bg-det-1" };
const resultA1 = resolveMarketingProBackground(inputA);
const resultA2 = resolveMarketingProBackground({ ...inputA });
assert.deepEqual(resultA1, resultA2, "BG5: mesma entrada precisa produzir exatamente a mesma saída");

// BG6 — mesmo seed => mesmo background, mesmo chamando em instantes/ordens diferentes.
const seedShared = "product-bg-same-seed-42";
const first = resolveMarketingProBackground({ creativeFamily: "modern", format: "square", seed: seedShared });
for (let i = 0; i < 5; i += 1) {
  const again = resolveMarketingProBackground({ creativeFamily: "modern", format: "square", seed: seedShared });
  assert.equal(again.backgroundId, first.backgroundId, "BG6: mesmo seed precisa sempre resolver o mesmo backgroundId");
}

// BG7 — variantIndex explícito produz alternativa determinística (nunca Math.random/Date.now).
const variant0 = resolveMarketingProBackground({ creativeFamily: "luxury", category: "general", format: "square", seed: "product-variant-x", variantIndex: 0 });
const variant1 = resolveMarketingProBackground({ creativeFamily: "luxury", category: "general", format: "square", seed: "product-variant-x", variantIndex: 1 });
assert.notEqual(variant1.backgroundId, variant0.backgroundId, "BG7: variantIndex diferente precisa produzir background diferente quando há >1 candidato");
const variant0Again = resolveMarketingProBackground({ creativeFamily: "luxury", category: "general", format: "square", seed: "product-variant-x", variantIndex: 0 });
assert.equal(variant0Again.backgroundId, variant0.backgroundId, "BG7: o mesmo variantIndex precisa continuar determinístico");
// Wrap-around: com 3 candidatos luxury/general/square, variantIndex 3 volta ao mesmo de variantIndex 0.
const variant3 = resolveMarketingProBackground({ creativeFamily: "luxury", category: "general", format: "square", seed: "product-variant-x", variantIndex: 3 });
assert.equal(variant3.backgroundId, variant0.backgroundId, "BG7: variantIndex deve dar a volta de forma determinística (módulo), nunca lançar");

// BG8 — categoria sem match dentro da family cai para a mesma family com category relaxada (nunca lança,
// nunca cai direto para a family genérica quando a family pedida já tem candidatos noutra categoria).
// "modern" no seed V1 nunca declara a categoria "food".
assert.ok(MARKETING_PRO_BACKGROUND_LIBRARY.filter((a) => a.family === "modern").every((a) => !a.categories.includes("food")), "pré-condição do teste: nenhum asset modern deveria ter categoria food");
const unknownCategoryResolved = resolveMarketingProBackground({ creativeFamily: "modern", category: "food", format: "square", seed: "product-bg8" });
assert.equal(unknownCategoryResolved.backgroundFamily, "modern", "BG8: categoria sem match ainda deve preferir a family pedida (relaxa category antes de relaxar family)");

// BG9 — backgroundId explícito que não existe (ou não suporta o formato) cai deterministicamente para a
// resolução normal por family/category/format, nunca lança e nunca quebra.
const unsupportedIdResolved = resolveMarketingProBackground({ creativeFamily: "editorial", category: "general", format: "square", seed: "product-bg9", backgroundId: "does-not-exist-in-library" });
assert.equal(unsupportedIdResolved.backgroundFamily, "editorial", "BG9: id inexistente cai para a resolução normal por family, sem lançar");
assert.notEqual(unsupportedIdResolved.backgroundId, "does-not-exist-in-library");
// Um id que existe mas não suporta o formato pedido também deve cair para o fallback normal, nunca lançar.
const wrongFormatAsset = MARKETING_PRO_BACKGROUND_LIBRARY[0];
const unsupportedFormatResolved = resolveMarketingProBackground({ creativeFamily: wrongFormatAsset.family, format: "story", seed: "product-bg9-format", backgroundId: wrongFormatAsset.id });
assert.ok(unsupportedFormatResolved.asset.formats.includes("story"), "BG9: fallback precisa respeitar o formato pedido mesmo quando o id explícito não suporta");
// Explicit id válido é honrado diretamente (sem passar pelo hash de seed).
const validIdResolved = resolveMarketingProBackground({ creativeFamily: wrongFormatAsset.family, format: "square", seed: "irrelevante-quando-id-existe", backgroundId: wrongFormatAsset.id });
assert.equal(validIdResolved.backgroundId, wrongFormatAsset.id, "BG9/§11: backgroundId explícito válido deve ser honrado diretamente");

// BG10 — nenhum asset carrega metadado que pareça o próprio produto anunciado (§8), em nenhum campo textual.
const forbidden = ["perfume", "celular", "caixa", "frasco", "roupa", "calcado", "calçado", "pessoa", "mao", "mão", "logo", "preco", "preço", "texto", "placeholder", "produto"];
const serialized = JSON.stringify(MARKETING_PRO_BACKGROUND_LIBRARY).toLowerCase();
for (const word of forbidden) {
  assert.ok(!serialized.includes(word), `BG10: metadado da library não pode mencionar "${word}"`);
}

// Sanidade extra: multi-categoria real (§28) — beauty/perfume, tech/cellphone e generic todos resolvem
// sem exceção e sem hardcode de categoria específica no resolver.
for (const category of MARKETING_PRO_CATEGORY_VALUES) {
  for (const family of [...families]) {
    const resolved = resolveMarketingProBackground({ creativeFamily: family, category, format: "square", seed: `multi-cat-${category}-${family}` });
    assert.ok(resolved.asset, `resolver precisa sempre devolver um asset para family=${family} category=${category}`);
  }
}

// renderMarketingProBackgroundSource produz uma data URI SVG válida e determinística — o composer
// canônico continua recebendo exatamente `backgroundImageSrc: string`, sem mudança no renderer.
const anyAsset = MARKETING_PRO_BACKGROUND_LIBRARY[0];
const src1 = renderMarketingProBackgroundSource(anyAsset, "square");
const src2 = renderMarketingProBackgroundSource(anyAsset, "square");
assert.equal(src1, src2, "renderMarketingProBackgroundSource precisa ser determinístico para o mesmo asset+formato");
assert.match(src1, /^data:image\/svg\+xml;charset=utf-8,/, "GENERATED_DETERMINISTIC precisa virar uma data URI SVG, nunca uma requisição de rede");
const decodedSvg = decodeURIComponent(src1.replace(/^data:image\/svg\+xml;charset=utf-8,/, ""));
assert.match(decodedSvg, /<svg[^>]*width="1080"[^>]*height="1080"/, "formato square precisa gerar SVG 1080x1080");
for (const word of forbidden) assert.ok(!decodedSvg.toLowerCase().includes(word), `SVG gerado não pode mencionar "${word}"`);

console.log(`Marketing Pro background library tests passed: BG1-BG10, ${ids.length} backgrounds across ${families.size} families, deterministic resolver, zero forbidden product-like metadata.`);
