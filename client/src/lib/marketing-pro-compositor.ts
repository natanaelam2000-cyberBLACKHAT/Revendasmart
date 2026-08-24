/**
 * PRO-05 — compositor local do primeiro vertical slice Premium.
 *
 * A camada de fundo abaixo e deterministica. Ela demonstra a fronteira entre
 * direcao visual e dados comerciais sem chamar IA, gravar assets ou debitar
 * creditos. O produto original continua protegido e e sempre desenhado com
 * contain, sem crop.
 */

import {
  MARKETING_PRO_FORMATS,
  buildMarketingProArtDirection,
  buildMarketingProComposition,
  type MarketingProArtDirection,
  prepareMarketingProInput,
  type MarketingProComposition,
  type MarketingProError,
  type MarketingProFormat,
  type MarketingProInput,
  type MarketingProInputDraft,
  type MarketingProRect,
  type MarketingProStyle,
} from "./marketing-pro";

export interface MarketingProDecoration {
  readonly id: string;
  readonly rect: MarketingProRect;
  readonly fill: string;
  readonly opacity: number;
  readonly borderRadius: string;
  readonly kind: "halo" | "shape" | "line";
}

export interface MarketingProVisualProfile {
  readonly style: MarketingProStyle;
  readonly category: string;
  readonly label: string;
  readonly backgroundCss: string;
  readonly surfaceCss: string;
  readonly foreground: string;
  readonly mutedForeground: string;
  readonly accent: string;
  readonly palette: readonly string[];
  readonly decorations: readonly MarketingProDecoration[];
}

export interface MarketingProPreviewModel {
  readonly input: MarketingProInput;
  readonly composition: MarketingProComposition;
  readonly format: (typeof MARKETING_PRO_FORMATS)["portrait"];
  readonly profile: MarketingProVisualProfile;
}

export type MarketingProPreviewPreparationResult =
  | { readonly state: "ready"; readonly model: MarketingProPreviewModel }
  | { readonly state: "failed"; readonly error: MarketingProError };

const STYLE_VISUALS: Record<MarketingProStyle, Omit<MarketingProVisualProfile, "style" | "category" | "label" | "accent" | "palette">> = {
  luxury: {
    backgroundCss: "linear-gradient(145deg, #0d1022 0%, #2c1b59 55%, #090b18 100%)",
    surfaceCss: "linear-gradient(145deg, rgba(255,255,255,.18), rgba(255,255,255,.04))",
    foreground: "#ffffff",
    mutedForeground: "#ded8f4",
    decorations: [
      { id: "luxury-top-line", rect: { x: 0.04, y: 0.01, width: 0.25, height: 0.012 }, fill: "#f4d58d", opacity: 0.9, borderRadius: "999px", kind: "line" },
      { id: "luxury-right-halo", rect: { x: 0.94, y: 0.2, width: 0.035, height: 0.3 }, fill: "#c4b5fd", opacity: 0.34, borderRadius: "999px", kind: "halo" },
      { id: "luxury-bottom-shape", rect: { x: 0.03, y: 0.94, width: 0.28, height: 0.035 }, fill: "#f4d58d", opacity: 0.58, borderRadius: "999px", kind: "shape" },
    ],
  },
  editorial: {
    backgroundCss: "linear-gradient(135deg, #f6efe5 0%, #eee4d8 52%, #d9d1c7 100%)",
    surfaceCss: "linear-gradient(145deg, rgba(255,255,255,.82), rgba(255,255,255,.26))",
    foreground: "#211d2b",
    mutedForeground: "#665f70",
    decorations: [
      { id: "editorial-top-line", rect: { x: 0.05, y: 0.012, width: 0.2, height: 0.01 }, fill: "#8c6b4f", opacity: 0.72, borderRadius: "999px", kind: "line" },
      { id: "editorial-right-shape", rect: { x: 0.95, y: 0.24, width: 0.025, height: 0.2 }, fill: "#bfa88c", opacity: 0.72, borderRadius: "999px", kind: "shape" },
      { id: "editorial-bottom-line", rect: { x: 0.05, y: 0.95, width: 0.22, height: 0.01 }, fill: "#8c6b4f", opacity: 0.64, borderRadius: "999px", kind: "line" },
    ],
  },
  minimal: {
    backgroundCss: "linear-gradient(180deg, #fbfdff 0%, #eef3f7 100%)",
    surfaceCss: "linear-gradient(145deg, rgba(255,255,255,.94), rgba(255,255,255,.58))",
    foreground: "#18212b",
    mutedForeground: "#607080",
    decorations: [
      { id: "minimal-top-line", rect: { x: 0.06, y: 0.014, width: 0.16, height: 0.009 }, fill: "#6b879e", opacity: 0.52, borderRadius: "999px", kind: "line" },
      { id: "minimal-right-shape", rect: { x: 0.955, y: 0.28, width: 0.02, height: 0.16 }, fill: "#c9d7e2", opacity: 0.86, borderRadius: "999px", kind: "shape" },
      { id: "minimal-bottom-shape", rect: { x: 0.06, y: 0.95, width: 0.16, height: 0.012 }, fill: "#6b879e", opacity: 0.44, borderRadius: "999px", kind: "line" },
    ],
  },
  sensory: {
    backgroundCss: "linear-gradient(135deg, #fff0f1 0%, #f2e2ff 52%, #dcecff 100%)",
    surfaceCss: "linear-gradient(145deg, rgba(255,255,255,.58), rgba(255,255,255,.2))",
    foreground: "#321e3a",
    mutedForeground: "#725b79",
    decorations: [
      { id: "sensory-top-halo", rect: { x: 0.03, y: 0.0, width: 0.24, height: 0.025 }, fill: "#f6a6bb", opacity: 0.68, borderRadius: "999px", kind: "halo" },
      { id: "sensory-right-halo", rect: { x: 0.945, y: 0.2, width: 0.03, height: 0.28 }, fill: "#b79be8", opacity: 0.48, borderRadius: "999px", kind: "halo" },
      { id: "sensory-bottom-shape", rect: { x: 0.04, y: 0.945, width: 0.26, height: 0.04 }, fill: "#f7b6c9", opacity: 0.56, borderRadius: "999px", kind: "shape" },
    ],
  },
  modern: {
    backgroundCss: "linear-gradient(135deg, #0b202a 0%, #0e5360 55%, #102c3b 100%)",
    surfaceCss: "linear-gradient(145deg, rgba(255,255,255,.16), rgba(255,255,255,.04))",
    foreground: "#ffffff",
    mutedForeground: "#c8e4e9",
    decorations: [
      { id: "modern-top-line", rect: { x: 0.04, y: 0.012, width: 0.28, height: 0.012 }, fill: "#5eead4", opacity: 0.86, borderRadius: "999px", kind: "line" },
      { id: "modern-right-shape", rect: { x: 0.95, y: 0.22, width: 0.025, height: 0.34 }, fill: "#67e8f9", opacity: 0.42, borderRadius: "999px", kind: "shape" },
      { id: "modern-bottom-shape", rect: { x: 0.04, y: 0.945, width: 0.3, height: 0.035 }, fill: "#5eead4", opacity: 0.55, borderRadius: "999px", kind: "shape" },
    ],
  },
};

const STYLE_LABELS: Record<MarketingProStyle, string> = {
  luxury: "Luxo",
  editorial: "Editorial",
  minimal: "Minimalista",
  sensory: "Sensorial",
  modern: "Moderno",
};

function resolveAccent(input: MarketingProInput, artDirection: MarketingProArtDirection): string {
  return input.store.primaryColor || artDirection.palette[0] || "#6d5dfc";
}

export function buildMarketingProVisualProfile(input: MarketingProInput, artDirection = buildMarketingProArtDirection(input)): MarketingProVisualProfile {
  const base = STYLE_VISUALS[input.style];
  return {
    style: input.style,
    category: artDirection.category,
    label: STYLE_LABELS[input.style],
    accent: resolveAccent(input, artDirection),
    palette: artDirection.palette,
    ...base,
  };
}

export function rectsIntersect(first: MarketingProRect, second: MarketingProRect): boolean {
  return first.x < second.x + second.width
    && first.x + first.width > second.x
    && first.y < second.y + second.height
    && first.y + first.height > second.y;
}

export function getMarketingProSafeZoneRects(format: MarketingProFormat = "portrait"): readonly MarketingProRect[] {
  const zones = MARKETING_PRO_FORMATS[format].safeZones;
  return [zones.store, zones.product, zones.productName, zones.price, zones.benefits, zones.cta];
}

export function validateMarketingProPreviewGeometry(model: MarketingProPreviewModel): { valid: boolean; issues: readonly string[] } {
  const issues: string[] = [];
  if (model.format.id !== "portrait" || model.format.width !== 1080 || model.format.height !== 1350) {
    issues.push("format.4:5");
  }
  if (!model.composition.protectedProductLayer.preserveOriginal) issues.push("product.preserveOriginal");
  if (model.composition.protectedProductLayer.allowCrop) issues.push("product.allowCrop");
  for (const decoration of model.profile.decorations) {
    if (getMarketingProSafeZoneRects("portrait").some((zone) => rectsIntersect(decoration.rect, zone))) {
      issues.push(`decoration.${decoration.id}`);
    }
  }
  return { valid: issues.length === 0, issues };
}

export function buildMarketingProPreviewModel(input: MarketingProInput): MarketingProPreviewModel {
  if (input.format !== "portrait") {
    throw new Error("PRO-05 supports only the portrait 4:5 format");
  }
  const composition = buildMarketingProComposition(input);
  return {
    input,
    composition,
    format: MARKETING_PRO_FORMATS.portrait,
    profile: buildMarketingProVisualProfile(input, composition.artDirection),
  };
}

export function prepareMarketingProPreview(draft: MarketingProInputDraft): MarketingProPreviewPreparationResult {
  const prepared = prepareMarketingProInput(draft);
  if (prepared.state === "failed") return prepared;
  if (prepared.input.format !== "portrait") {
    return { state: "failed", error: { code: "unsupported_format", message: "Este formato ainda nao esta disponivel.", retryable: false } };
  }
  return { state: "ready", model: buildMarketingProPreviewModel(prepared.input) };
}
