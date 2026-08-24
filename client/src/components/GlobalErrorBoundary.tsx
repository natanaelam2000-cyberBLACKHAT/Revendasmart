import React from "react";
import { reportClientDiagnostic } from "@/lib/client-diagnostics";

interface GlobalErrorBoundaryState {
  readonly hasError: boolean;
}

export class GlobalErrorBoundary extends React.Component<React.PropsWithChildren, GlobalErrorBoundaryState> {
  state: GlobalErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): GlobalErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    void reportClientDiagnostic({
      domain: "REACT",
      event: "react_render_error",
      result: "failure",
      severity: "error",
      error,
      context: { componentStack: errorInfo.componentStack },
    });
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleGoHome = (): void => {
    window.location.href = "/";
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center font-sans" data-testid="global-error-boundary">
        <div className="w-20 h-20 bg-destructive/10 rounded-full flex items-center justify-center mb-6" aria-hidden="true">
          <span className="text-4xl">!</span>
        </div>
        <h1 className="text-xl font-bold mb-2">Ocorreu um erro temporario.</h1>
        <p className="text-sm mb-8 text-muted-foreground">Nao foi possivel concluir esta acao. Tente novamente em instantes.</p>
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <button onClick={this.handleReload} className="w-full bg-primary text-white px-6 py-4 rounded-2xl font-bold shadow-lg active:scale-95 transition-all">
            Tentar novamente
          </button>
          <button onClick={this.handleGoHome} className="w-full bg-secondary text-foreground px-6 py-4 rounded-2xl font-bold active:scale-95 transition-all">
            Voltar ao inicio
          </button>
        </div>
      </div>
    );
  }
}
