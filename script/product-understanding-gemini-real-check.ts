/** PRO-11B — no máximo uma chamada real, somente análise do PNG de fixture; zero geração de imagem. */
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { GeminiProductVisualAnalyzer, GEMINI_PRODUCT_VISUAL_MODEL } from "../server/marketing-pro-product-visual-analyzer-google";
import { generateProductTestPng } from "../tests/e2e/support/png";

loadDotenv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

async function main(): Promise<void> {
  if (!process.env.GEMINI_API_KEY?.trim() && !process.env.GOOGLE_API_KEY?.trim()) {
    console.log("REAL_CALL_SKIPPED=credential_unavailable");
    return;
  }
  const analyzer = new GeminiProductVisualAnalyzer();
  const startedAt = Date.now();
  try {
    const output = await analyzer.analyzeProductVisual({
      image: { assetId: "fixture:pro-11b:red-product-v1", mimeType: "image/png", bytes: generateProductTestPng(64, 64, [210, 20, 35]) },
      trustedContext: { category: "cosmeticos", color: "vermelho" },
    });
    console.log(JSON.stringify({
      model: GEMINI_PRODUCT_VISUAL_MODEL,
      latencyMs: Date.now() - startedAt,
      outputValid: true,
      confidence: output.confidence,
      recommendedFamilies: output.inferred.recommendedCreativeFamilies || [],
      avoidFamilies: output.inferred.avoidCreativeFamilies || [],
      imageGenerationCalls: 0,
    }));
  } catch (error) {
    console.log(JSON.stringify({
      model: GEMINI_PRODUCT_VISUAL_MODEL,
      latencyMs: Date.now() - startedAt,
      outputValid: false,
      errorCode: error && typeof error === "object" && "code" in error ? String(error.code) : "UNKNOWN",
      imageGenerationCalls: 0,
    }));
    process.exitCode = 1;
  }
}

main();
