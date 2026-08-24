import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";

interface AccountMenuItemProps {
  icon: LucideIcon;
  iconClassName: string;
  title: string;
  subtitle: string;
  onClick?: () => void;
  disabled?: boolean;
  badge?: string;
  tone?: "default" | "danger";
  testId?: string;
}

export function AccountMenuItem({ icon: Icon, iconClassName, title, subtitle, onClick, disabled, badge, tone = "default", testId }: AccountMenuItemProps) {
  const isDanger = tone === "danger";
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-disabled={disabled}
      data-testid={testId}
      className={`w-full flex items-center gap-4 p-4 sm:p-5 text-left transition-colors ${
        disabled ? "cursor-default opacity-60" : isDanger ? "hover:bg-red-50 active:bg-red-100" : "hover:bg-slate-50 active:bg-slate-100"
      }`}
    >
      <div className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 ${iconClassName}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm sm:text-base font-bold ${isDanger ? "text-red-600" : ""}`}>{title}</p>
        <p className={`text-xs mt-0.5 ${isDanger ? "text-red-500/70" : "text-muted-foreground"}`}>{subtitle}</p>
      </div>
      {badge ? (
        <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{badge}</span>
      ) : (
        <ChevronRight className={`w-5 h-5 flex-shrink-0 ${isDanger ? "text-red-300" : "text-muted-foreground/50"}`} />
      )}
    </button>
  );
}
