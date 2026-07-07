import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface ConfirmActionDialogProps {
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: string;
  description: ReactNode;
  cancelLabel?: string;
  confirmLabel?: string;
  onConfirm: () => void | Promise<void>;
  destructive?: boolean;
  disabled?: boolean;
}

export function ConfirmActionDialog({
  trigger,
  open,
  onOpenChange,
  title = "Confirmar exclusão",
  description,
  cancelLabel = "Cancelar",
  confirmLabel = "Remover",
  onConfirm,
  destructive = true,
  disabled = false,
}: ConfirmActionDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {trigger ? <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger> : null}
      <AlertDialogContent className="rs-dialog-enter w-[calc(100vw-1.5rem)] max-w-sm rounded-[2rem] border-0 bg-white p-5 shadow-2xl sm:rounded-[2rem] max-h-[calc(100dvh-1.5rem)] overflow-y-auto overscroll-contain pb-[max(1.5rem,calc(env(safe-area-inset-bottom)+1rem))]">
        <AlertDialogHeader className="text-left">
          <AlertDialogTitle className="text-xl font-black text-foreground">{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="text-sm leading-relaxed text-muted-foreground">{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="sticky bottom-0 -mx-5 -mb-5 mt-3 flex-col-reverse gap-3 bg-white/95 px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur sm:flex-col-reverse sm:space-x-0">
          <AlertDialogCancel className="rs-pressable mt-0 h-12 rounded-2xl border-border bg-secondary text-sm font-black text-foreground">
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={disabled}
            onClick={onConfirm}
            className={`rs-pressable h-12 rounded-2xl text-sm font-black shadow-none disabled:opacity-60 ${
              destructive ? "bg-red-600 text-white hover:bg-red-700" : "bg-primary text-white"
            }`}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
