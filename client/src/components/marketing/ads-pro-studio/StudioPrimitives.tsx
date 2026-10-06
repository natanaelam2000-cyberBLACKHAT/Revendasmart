import type { ReactNode } from "react";

/**
 * ADS-PRO-FINAL — primitivas visuais do estúdio (mesma linguagem do restante do Marketing: cantos 2xl,
 * texto xs/black, alvos de toque >= 44px). Só apresentação: nenhuma regra de negócio mora aqui.
 */

export function StudioChip({
  selected,
  onClick,
  children,
  testId,
  disabled,
  title,
}: {
  readonly selected: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
  readonly testId?: string;
  readonly disabled?: boolean;
  readonly title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      title={title}
      onClick={onClick}
      data-testid={testId}
      className={`min-h-11 shrink-0 rounded-full border px-4 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:border-primary/50"}`}
    >
      {children}
    </button>
  );
}

export function StudioSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  onReset,
  format,
  testId,
  disabled,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly onChange: (value: number) => void;
  readonly onReset?: () => void;
  readonly format?: (value: number) => string;
  readonly testId?: string;
  readonly disabled?: boolean;
}) {
  const id = `studio-slider-${testId ?? label}`;
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-[11px] font-bold text-foreground">{label}</label>
        <span className="flex items-center gap-2">
          <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{format ? format(value) : value.toFixed(2)}</span>
          {onReset && (
            <button type="button" onClick={onReset} disabled={disabled} className="min-h-8 rounded-md px-1.5 text-[10px] font-bold text-primary underline-offset-2 hover:underline disabled:opacity-40" aria-label={`Redefinir ${label}`}>
              redefinir
            </button>
          )}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        data-testid={testId}
        className="mt-1 block h-11 w-full accent-primary disabled:opacity-50"
      />
    </div>
  );
}

export function StudioBanner({ tone, children, testId }: { readonly tone: "info" | "success" | "warning" | "error"; readonly children: ReactNode; readonly testId?: string }) {
  const classes = {
    info: "border-border/60 bg-background text-muted-foreground",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    warning: "border-amber-200 bg-amber-50 text-amber-800",
    error: "border-red-200 bg-red-50 text-red-700",
  }[tone];
  return (
    <p className={`rounded-xl border px-3 py-2 text-xs font-semibold leading-snug ${classes}`} role={tone === "error" ? "alert" : "status"} aria-live="polite" data-testid={testId}>
      {children}
    </p>
  );
}

export function StudioPrimaryButton({
  children,
  onClick,
  disabled,
  testId,
  busy,
  tone = "primary",
}: {
  readonly children: ReactNode;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly testId?: string;
  readonly busy?: boolean;
  readonly tone?: "primary" | "outline";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      data-testid={testId}
      className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-xs font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 ${tone === "primary" ? "bg-primary text-primary-foreground shadow-sm hover:brightness-105" : "border border-primary/30 bg-white text-primary hover:bg-primary/5"}`}
    >
      {children}
    </button>
  );
}

export function StudioField({ label, children, hint }: { readonly label: string; readonly children: ReactNode; readonly hint?: string }) {
  return (
    <label className="block min-w-0 text-[11px] font-bold text-foreground">
      {label}
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-[10px] font-medium text-muted-foreground">{hint}</span>}
    </label>
  );
}

export const studioInputClass =
  "min-h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-semibold text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-primary";
