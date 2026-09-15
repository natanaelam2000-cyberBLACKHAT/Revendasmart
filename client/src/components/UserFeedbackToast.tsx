import { AlertCircle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { UserFeedbackPayload } from "@/lib/notify";
const styles = {
  success: { icon: CheckCircle2, label: "Sucesso", className: "border-green-200 bg-green-50 text-green-800" },
  error: { icon: XCircle, label: "Erro", className: "border-red-200 bg-red-50 text-red-800" },
  warning: { icon: AlertCircle, label: "Atenção", className: "border-amber-200 bg-amber-50 text-amber-800" },
  info: { icon: Info, label: "Informação", className: "border-blue-200 bg-blue-50 text-blue-800" },
};


export default function UserFeedbackToast({ feedback }: { feedback: UserFeedbackPayload }) {
  const visual = styles[feedback.type];
  const Icon = visual.icon;

  return (
    <div className="fixed left-1/2 top-[max(1rem,env(safe-area-inset-top))] z-[120] w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 pointer-events-none" aria-live="polite" aria-atomic="true">
      <div className={`rs-toast-enter pointer-events-auto flex items-start gap-3 rounded-2xl border px-4 py-3 shadow-xl backdrop-blur ${visual.className}`}>
        <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-black uppercase tracking-wider">{visual.label}</p>
          <p className="mt-0.5 text-sm font-bold leading-snug">{feedback.message}</p>
          {feedback.detail && <p className="mt-1 text-xs opacity-80">{feedback.detail}</p>}
        </div>
      </div>
    </div>
  );

}
