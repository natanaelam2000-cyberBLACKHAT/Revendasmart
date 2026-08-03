import type { ReactNode } from "react";
import { WandSparkles } from "lucide-react";
import {
  MARKETING_AD_THEME_IDS,
  MARKETING_AD_THEMES,
  MARKETING_TEMPLATES,
  type MarketingAdThemeId,
  type MarketingTemplateId,
} from "@/lib/marketing-ad";

type Props = {
  template: MarketingTemplateId;
  theme: MarketingAdThemeId;
  v2TemplatesEnabled: boolean;
  onTemplateChange: (template: MarketingTemplateId) => void;
  onThemeChange: (theme: MarketingAdThemeId) => void;
  onUseThemeAsDefault: () => void;
  extensionSlot?: ReactNode;
};

export function MarketingTemplateSelector({
  template,
  theme,
  v2TemplatesEnabled,
  onTemplateChange,
  onThemeChange,
  onUseThemeAsDefault,
  extensionSlot,
}: Props) {
  return (
    <section className="grid gap-5 rounded-[1.75rem] border border-border/60 bg-white p-4 shadow-sm sm:p-5" data-testid="marketing-template-selector">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[.18em] text-primary">2. Defina o visual</p>
        <h2 className="mt-1 text-base font-black">Template e tema</h2>
      </div>

      {v2TemplatesEnabled && (
        <div className="flex gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-blue-900">
          <WandSparkles className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
          <p className="text-xs leading-5">Novos templates visuais estão disponíveis no mesmo editor manual.</p>
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-bold text-muted-foreground">Template</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {Object.entries(MARKETING_TEMPLATES).map(([id, item]) => (
            <button
              key={id}
              type="button"
              onClick={() => onTemplateChange(id as MarketingTemplateId)}
              aria-pressed={template === id}
              className={[
                "flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border p-2 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                template === id ? "border-primary bg-primary/5 text-primary" : "border-border bg-white text-muted-foreground",
              ].join(" ")}
            >
              <span className="text-lg">{item.emoji}</span>
              <span className="text-[10px] font-bold leading-tight">{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-xs font-bold text-muted-foreground">Tema do card</p>
          <button type="button" onClick={onUseThemeAsDefault} className="rounded text-[10px] font-black text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">Usar como padrão</button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {MARKETING_AD_THEME_IDS.map((themeId) => {
            const item = MARKETING_AD_THEMES[themeId];
            return (
              <button
                key={themeId}
                type="button"
                onClick={() => onThemeChange(themeId)}
                aria-pressed={theme === themeId}
                className={[
                  "rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                  theme === themeId ? "border-primary bg-primary/5" : "border-border bg-white",
                ].join(" ")}
              >
                <div className="mb-2 h-9 rounded-lg" style={{ background: "linear-gradient(135deg,#fff 0%," + item.accent + "33 55%,#fff 100%)" }} />
                <p className="text-[11px] font-black">{item.label}</p>
              </button>
            );
          })}
        </div>
      </div>

      {extensionSlot}
    </section>
  );
}
