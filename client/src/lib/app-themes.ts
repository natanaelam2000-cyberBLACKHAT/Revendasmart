export const APP_THEME_IDS = ["purple", "blue", "green", "rose", "orange", "black"] as const;

export type AppThemeId = typeof APP_THEME_IDS[number];
export type ButtonTone = "solid" | "soft" | "gradient";
export type CardTone = "clean" | "tinted" | "glass";
export type ShadowIntensity = "none" | "soft" | "medium" | "strong";
export type RadiusScale = "compact" | "rounded" | "pill";
export type MotionPreference = "normal" | "smooth";

export type AppThemeCustomization = {
  primaryColor?: string;
  buttonTone?: ButtonTone;
  cardTone?: CardTone;
  shadowIntensity?: ShadowIntensity;
  radius?: RadiusScale;
  motion?: MotionPreference;
};

type AppTheme = {
  id: AppThemeId;
  label: string;
  description: string;
  primaryColor: string;
  swatch: string;
  cssVariables: Record<string, string>;
};

export const DEFAULT_APP_THEME_ID: AppThemeId = "purple";

export const BUTTON_TONES: Array<{ id: ButtonTone; label: string; description: string }> = [
  { id: "solid", label: "Sólido", description: "Botões fortes e diretos." },
  { id: "soft", label: "Suave", description: "Botões mais leves e discretos." },
  { id: "gradient", label: "Gradiente", description: "Destaque premium em ações principais." },
];

export const CARD_TONES: Array<{ id: CardTone; label: string; description: string }> = [
  { id: "clean", label: "Claro", description: "Cards brancos e limpos." },
  { id: "tinted", label: "Levemente colorido", description: "Cards com tom da marca." },
  { id: "glass", label: "Premium leve", description: "Cards claros com transparência sutil." },
];

export const SHADOW_LEVELS: Array<{ id: ShadowIntensity; label: string }> = [
  { id: "none", label: "Sem sombra" },
  { id: "soft", label: "Suave" },
  { id: "medium", label: "Normal" },
  { id: "strong", label: "Marcante" },
];

export const RADIUS_LEVELS: Array<{ id: RadiusScale; label: string }> = [
  { id: "compact", label: "Compacta" },
  { id: "rounded", label: "Arredondada" },
  { id: "pill", label: "Mais redonda" },
];

export const MOTION_LEVELS: Array<{ id: MotionPreference; label: string }> = [
  { id: "normal", label: "Normal" },
  { id: "smooth", label: "Suave" },
];

export const APP_THEMES: AppTheme[] = [
  {
    id: "purple",
    label: "Tema Roxo",
    description: "Identidade premium da Revenda Smart.",
    primaryColor: "#6d5dfc",
    swatch: "from-blue-500 to-violet-600",
    cssVariables: {
      "--background": "252 44% 98%",
      "--foreground": "236 24% 20%",
      "--card": "0 0% 100%",
      "--card-foreground": "236 24% 20%",
      "--popover": "0 0% 100%",
      "--popover-foreground": "236 24% 20%",
      "--primary": "256 76% 57%",
      "--secondary": "252 32% 94%",
      "--secondary-foreground": "236 24% 20%",
      "--muted": "252 26% 92%",
      "--muted-foreground": "238 12% 43%",
      "--accent": "256 42% 90%",
      "--accent-foreground": "236 24% 20%",
      "--border": "252 25% 88%",
      "--input": "252 25% 88%",
      "--ring": "256 76% 57%",
    },
  },
  {
    id: "blue",
    label: "Tema Azul",
    description: "Profissional para gestão e controle.",
    primaryColor: "#2563eb",
    swatch: "from-sky-500 to-blue-700",
    cssVariables: {
      "--background": "210 40% 98%",
      "--foreground": "222 36% 18%",
      "--card": "0 0% 100%",
      "--card-foreground": "222 36% 18%",
      "--popover": "0 0% 100%",
      "--popover-foreground": "222 36% 18%",
      "--primary": "217 91% 55%",
      "--secondary": "214 36% 94%",
      "--secondary-foreground": "222 36% 18%",
      "--muted": "214 30% 92%",
      "--muted-foreground": "215 16% 42%",
      "--accent": "213 52% 90%",
      "--accent-foreground": "222 36% 18%",
      "--border": "214 28% 88%",
      "--input": "214 28% 88%",
      "--ring": "217 91% 55%",
    },
  },
  {
    id: "green",
    label: "Tema Verde",
    description: "Vendas, crescimento e fluxo de caixa.",
    primaryColor: "#059669",
    swatch: "from-emerald-500 to-green-700",
    cssVariables: {
      "--background": "150 35% 97%",
      "--foreground": "160 28% 18%",
      "--card": "0 0% 100%",
      "--card-foreground": "160 28% 18%",
      "--popover": "0 0% 100%",
      "--popover-foreground": "160 28% 18%",
      "--primary": "158 64% 40%",
      "--secondary": "150 28% 93%",
      "--secondary-foreground": "160 28% 18%",
      "--muted": "150 22% 91%",
      "--muted-foreground": "158 14% 38%",
      "--accent": "151 38% 88%",
      "--accent-foreground": "160 28% 18%",
      "--border": "150 22% 86%",
      "--input": "150 22% 86%",
      "--ring": "158 64% 40%",
    },
  },
  {
    id: "rose",
    label: "Tema Rosa",
    description: "Beleza, cuidado e atendimento próximo.",
    primaryColor: "#db2777",
    swatch: "from-pink-500 to-rose-600",
    cssVariables: {
      "--background": "348 29% 97%",
      "--foreground": "352 11% 26%",
      "--card": "0 0% 100%",
      "--card-foreground": "352 11% 26%",
      "--popover": "0 0% 100%",
      "--popover-foreground": "352 11% 26%",
      "--primary": "335 72% 58%",
      "--secondary": "354 30% 94%",
      "--secondary-foreground": "352 11% 26%",
      "--muted": "354 20% 92%",
      "--muted-foreground": "352 10% 45%",
      "--accent": "354 30% 90%",
      "--accent-foreground": "352 11% 26%",
      "--border": "354 20% 90%",
      "--input": "354 20% 90%",
      "--ring": "335 72% 58%",
    },
  },
  {
    id: "orange",
    label: "Tema Laranja",
    description: "Energia comercial sem perder elegância.",
    primaryColor: "#f97316",
    swatch: "from-orange-400 to-amber-600",
    cssVariables: {
      "--background": "35 40% 97%",
      "--foreground": "28 30% 20%",
      "--card": "0 0% 100%",
      "--card-foreground": "28 30% 20%",
      "--popover": "0 0% 100%",
      "--popover-foreground": "28 30% 20%",
      "--primary": "25 95% 53%",
      "--secondary": "35 34% 93%",
      "--secondary-foreground": "28 30% 20%",
      "--muted": "35 28% 91%",
      "--muted-foreground": "28 14% 42%",
      "--accent": "32 46% 88%",
      "--accent-foreground": "28 30% 20%",
      "--border": "35 24% 86%",
      "--input": "35 24% 86%",
      "--ring": "25 95% 53%",
    },
  },
  {
    id: "black",
    label: "Tema Escuro Premium",
    description: "Visual sóbrio com contraste e presença.",
    primaryColor: "#111827",
    swatch: "from-slate-950 to-zinc-700",
    cssVariables: {
      "--background": "220 18% 97%",
      "--foreground": "224 28% 18%",
      "--card": "0 0% 100%",
      "--card-foreground": "224 28% 18%",
      "--popover": "0 0% 100%",
      "--popover-foreground": "224 28% 18%",
      "--primary": "224 28% 18%",
      "--secondary": "220 18% 92%",
      "--secondary-foreground": "224 28% 18%",
      "--muted": "220 14% 90%",
      "--muted-foreground": "220 9% 40%",
      "--accent": "220 16% 88%",
      "--accent-foreground": "224 28% 18%",
      "--border": "220 14% 86%",
      "--input": "220 14% 86%",
      "--ring": "224 28% 18%",
    },
  },
];

export function resolveAppThemeId(value: unknown): AppThemeId {
  return APP_THEME_IDS.includes(value as AppThemeId) ? value as AppThemeId : DEFAULT_APP_THEME_ID;
}

export function getAppTheme(value: unknown): AppTheme {
  const themeId = resolveAppThemeId(value);
  return APP_THEMES.find((theme) => theme.id === themeId) || APP_THEMES[0];
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

function hexToHsl(hex: string): string | null {
  const raw = hex.replace("#", "");
  const r = Number.parseInt(raw.slice(0, 2), 16) / 255;
  const g = Number.parseInt(raw.slice(2, 4), 16) / 255;
  const b = Number.parseInt(raw.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function resolveCustomization(value: unknown, theme: AppTheme): Required<AppThemeCustomization> {
  const customization = (value && typeof value === "object") ? value as AppThemeCustomization : {};
  return {
    primaryColor: isHexColor(customization.primaryColor) ? customization.primaryColor : theme.primaryColor,
    buttonTone: BUTTON_TONES.some((item) => item.id === customization.buttonTone) ? customization.buttonTone as ButtonTone : "solid",
    cardTone: CARD_TONES.some((item) => item.id === customization.cardTone) ? customization.cardTone as CardTone : "clean",
    shadowIntensity: SHADOW_LEVELS.some((item) => item.id === customization.shadowIntensity) ? customization.shadowIntensity as ShadowIntensity : "medium",
    radius: RADIUS_LEVELS.some((item) => item.id === customization.radius) ? customization.radius as RadiusScale : "rounded",
    motion: MOTION_LEVELS.some((item) => item.id === customization.motion) ? customization.motion as MotionPreference : "normal",
  };
}

export function buildAppThemeCustomization(themeId: unknown, patch?: AppThemeCustomization): Required<AppThemeCustomization> {
  const theme = getAppTheme(themeId);
  return resolveCustomization({ primaryColor: patch?.primaryColor || theme.primaryColor, ...patch }, theme);
}

export function applyAppTheme(settingsOrTheme: unknown, maybeCustomization?: AppThemeCustomization): void {
  if (typeof document === "undefined") return;
  const rawSettings = settingsOrTheme && typeof settingsOrTheme === "object" ? settingsOrTheme as { appTheme?: unknown; appThemeCustomization?: unknown } : null;
  const theme = getAppTheme(rawSettings ? rawSettings.appTheme : settingsOrTheme);
  const customization = resolveCustomization(rawSettings ? rawSettings.appThemeCustomization : maybeCustomization, theme);
  const root = document.documentElement;
  const primaryHsl = hexToHsl(customization.primaryColor);

  root.dataset.appTheme = theme.id;
  root.dataset.rsButtonTone = customization.buttonTone;
  root.dataset.rsCardTone = customization.cardTone;
  root.dataset.rsShadow = customization.shadowIntensity;
  root.dataset.rsRadius = customization.radius;
  root.dataset.rsMotion = customization.motion;

  Object.entries(theme.cssVariables).forEach(([name, color]) => {
    root.style.setProperty(name, color);
  });
  if (primaryHsl) {
    root.style.setProperty("--primary", primaryHsl);
    root.style.setProperty("--ring", primaryHsl);
  }
  root.style.setProperty("--rs-primary-hex", customization.primaryColor);
}
