import { useEffect, useRef } from "react";
import { pushDismissible } from "@/lib/android-back-button";

/**
 * RELEASE-QUALITY-02 §3 — registra um overlay controlado (sheet/modal/full-screen picker) na pilha
 * global de "voltar deve fechar isto primeiro". `onDismiss` deve ser a MESMA função que o próprio botão
 * de fechar do overlay já usa — o hardware back nunca inventa um jeito novo de fechar.
 *
 * Uso: `useDismissibleOnBack(isOpen, () => setIsOpen(false))` dentro do componente dono do estado.
 */
export function useDismissibleOnBack(isOpen: boolean, onDismiss: () => void): void {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!isOpen) return;
    return pushDismissible(() => onDismissRef.current());
  }, [isOpen]);
}
