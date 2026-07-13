export const APP_THEME_IDS = ["purple", "blue", "green", "rose", "red", "orange", "black", "oled", "turquoise", "gold"] as const;

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

export type StoreIdentitySettings = {
  name?: string;
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  icon?: string;
  slogan?: string;
  heroImageUrl?: string;
};

export type DesignTokenName =
  | "primary"
  | "secondary"
  | "accent"
  | "surface"
  | "surfaceSecondary"
  | "background"
  | "card"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "border"
  | "muted"
  | "textPrimary"
  | "textSecondary"
  | "shadow"
  | "radius"
  | "spacing"
  | "transition"
  | "duration";

export const DESIGN_TOKEN_NAMES: DesignTokenName[] = [
  "primary", "secondary", "accent", "surface", "surfaceSecondary",
  "background", "card", "success", "warning", "danger", "info",
  "border", "muted", "textPrimary", "textSecondary", "shadow",
  "radius", "spacing", "transition", "duration",
];

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
    id: "red",
    label: "Vermelho Comercial",
    description: "Energia de venda, destaque e urgência controlada.",
    primaryColor: "#dc2626",
    swatch: "from-red-500 to-rose-700",
    cssVariables: {
      "--background": "0 35% 98%",
      "--foreground": "0 28% 18%",
      "--card": "0 0% 100%",
      "--card-foreground": "0 28% 18%",
      "--popover": "0 0% 100%",
      "--popover-foreground": "0 28% 18%",
      "--primary": "0 72% 51%",
      "--secondary": "0 30% 94%",
      "--secondary-foreground": "0 28% 18%",
      "--muted": "0 24% 92%",
      "--muted-foreground": "0 14% 42%",
      "--accent": "0 46% 90%",
      "--accent-foreground": "0 28% 18%",
      "--border": "0 24% 88%",
      "--input": "0 24% 88%",
      "--ring": "0 72% 51%",
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
    label: "Grafite Executivo",
    description: "Visual sóbrio para operação, relatórios e gestão.",
    primaryColor: "#111827",
    swatch: "from-slate-700 to-zinc-950",
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
  {
    id: "oled",
    label: "Preto OLED",
    description: "Modo escuro real para uso noturno e telas OLED.",
    primaryColor: "#8b5cf6",
    swatch: "from-black via-zinc-950 to-violet-800",
    cssVariables: {
      "--background": "222 47% 4%",
      "--foreground": "210 40% 96%",
      "--card": "222 36% 7%",
      "--card-foreground": "210 40% 96%",
      "--popover": "222 36% 7%",
      "--popover-foreground": "210 40% 96%",
      "--primary": "258 90% 66%",
      "--secondary": "222 24% 13%",
      "--secondary-foreground": "210 40% 96%",
      "--muted": "222 22% 16%",
      "--muted-foreground": "217 16% 72%",
      "--accent": "258 36% 20%",
      "--accent-foreground": "210 40% 96%",
      "--border": "222 18% 18%",
      "--input": "222 18% 18%",
      "--ring": "258 90% 66%",
    },
  },
  {
    id: "turquoise",
    label: "Turquesa",
    description: "Leve, moderno e limpo para catálogos visuais.",
    primaryColor: "#0891b2",
    swatch: "from-cyan-400 to-teal-700",
    cssVariables: {
      "--background": "185 42% 97%",
      "--foreground": "190 34% 18%",
      "--card": "0 0% 100%",
      "--card-foreground": "190 34% 18%",
      "--popover": "0 0% 100%",
      "--popover-foreground": "190 34% 18%",
      "--primary": "192 91% 36%",
      "--secondary": "184 34% 93%",
      "--secondary-foreground": "190 34% 18%",
      "--muted": "184 28% 91%",
      "--muted-foreground": "190 14% 42%",
      "--accent": "184 44% 88%",
      "--accent-foreground": "190 34% 18%",
      "--border": "184 26% 86%",
      "--input": "184 26% 86%",
      "--ring": "192 91% 36%",
    },
  },
  {
    id: "gold",
    label: "Dourado Premium",
    description: "Aparência premium para consultoras e lojas boutique.",
    primaryColor: "#b45309",
    swatch: "from-amber-300 to-yellow-700",
    cssVariables: {
      "--background": "42 46% 97%",
      "--foreground": "32 32% 18%",
      "--card": "0 0% 100%",
      "--card-foreground": "32 32% 18%",
      "--popover": "0 0% 100%",
      "--popover-foreground": "32 32% 18%",
      "--primary": "32 95% 39%",
      "--secondary": "42 34% 92%",
      "--secondary-foreground": "32 32% 18%",
      "--muted": "42 28% 90%",
      "--muted-foreground": "32 14% 42%",
      "--accent": "42 50% 86%",
      "--accent-foreground": "32 32% 18%",
      "--border": "42 26% 84%",
      "--input": "42 26% 84%",
      "--ring": "32 95% 39%",
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

export function buildDesignSystemVariables(themeId: unknown, customizationPatch?: AppThemeCustomization): Record<string, string> {
  const theme = getAppTheme(themeId);
  const customization = resolveCustomization(customizationPatch, theme);
  const primaryHsl = hexToHsl(customization.primaryColor);
  const primaryColor = primaryHsl ? `hsl(${primaryHsl})` : "hsl(var(--primary))";

  return {
    "--rs-color-primary": primaryColor,
    "--rs-color-secondary": "hsl(var(--secondary))",
    "--rs-color-accent": "hsl(var(--accent))",
    "--rs-color-success": "hsl(var(--success))",
    "--rs-color-warning": "hsl(var(--warning))",
    "--rs-color-danger": "hsl(var(--destructive))",
    "--rs-color-info": "hsl(var(--info))",
    "--rs-background": "hsl(var(--background))",
    "--rs-surface": "hsl(var(--card))",
    "--rs-surface-elevated": "hsl(var(--popover))",
    "--rs-surface-secondary": "hsl(var(--secondary) / 0.62)",
    "--rs-card": "hsl(var(--card))",
    "--rs-border": "hsl(var(--border))",
    "--rs-border-subtle": "hsl(var(--border) / 0.62)",
    "--rs-muted": "hsl(var(--muted))",
    "--rs-text-primary": "hsl(var(--foreground))",
    "--rs-text-secondary": "hsl(var(--muted-foreground))",
    "--rs-input-bg": "hsl(var(--background) / 0.64)",
    "--rs-input-border": "hsl(var(--input))",
    "--rs-focus-ring": `${primaryColor}33`,
    "--rs-link": primaryColor,
    "--rs-badge-bg": "hsl(var(--primary) / 0.10)",
    "--rs-badge-text": primaryColor,
    "--rs-progress-bg": "hsl(var(--primary) / 0.16)",
    "--rs-progress-fill": primaryColor,
    "--rs-bottom-nav-bg": "hsl(var(--card) / 0.92)",
    "--rs-fab-bg": primaryColor,
    "--rs-skeleton-bg": "hsl(var(--primary) / 0.10)",
    "--rs-chart-1": primaryColor,
    "--rs-chart-2": "hsl(var(--accent-foreground) / 0.74)",
    "--rs-chart-3": "hsl(var(--muted-foreground) / 0.62)",
    "--rs-radius-base": "var(--radius)",
    "--rs-spacing-base": "1rem",
    "--rs-transition-standard": "cubic-bezier(0.2, 0.8, 0.2, 1)",
    "--rs-duration-fast": "150ms",
    "--rs-duration-normal": "220ms",
  };
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
  Object.entries(buildDesignSystemVariables(theme.id, customization)).forEach(([name, value]) => {
    root.style.setProperty(name, value);
  });
  root.style.setProperty("--rs-primary-hex", customization.primaryColor);
}
