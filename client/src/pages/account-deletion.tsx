import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { ApiError, apiRequest, buildApiErrorDisplayMessage } from "@/lib/api-client";
import { clearDeletedAccountLocalData } from "@/lib/account-deletion-local";
import { clearTelemetryUserId, clearUserContext, getFirebaseAuth, clearFirestoreOfflineCache } from "@/lib/firebase";
import { queryClient } from "@/lib/queryClient";

const CONFIRMATION = "EXCLUIR MINHA CONTA";
const SUPPORT_EMAIL = "revendasmart.suporte@gmail.com";

export default function AccountDeletionPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // RELEASE-03B §4: o servidor recusa a exclusão (409) enquanto existir assinatura ativa ou conexão
  // Mercado Pago. Guardamos o código para transformar isso numa instrução acionável, em vez de só um
  // texto de erro — e para distinguir "bloqueio" (o usuário precisa agir) de "falha recuperável"
  // (basta tentar de novo).
  const [blockedReason, setBlockedReason] = useState<"ACTIVE_SUBSCRIPTION" | "ACTIVE_MERCADOPAGO_CONNECTION" | null>(null);
  const [failed, setFailed] = useState(false);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) { setAuthReady(true); return; }
    return onAuthStateChanged(auth, (nextUser) => { setUser(nextUser); setAuthReady(true); });
  }, []);

  async function deleteAccount() {
    if (!user || confirmation !== CONFIRMATION) return;
    setLoading(true);
    setError("");
    setBlockedReason(null);
    setFailed(false);
    const uid = user.uid;
    try {
      await apiRequest("/api/account", { method: "DELETE", auth: true, timeoutMs: 120_000 });
      await clearDeletedAccountLocalData(uid);
      await clearFirestoreOfflineCache();
      queryClient.clear();
      clearUserContext();
      clearTelemetryUserId();
      const auth = getFirebaseAuth();
      if (auth) await signOut(auth).catch(() => undefined);
      setCompleted(true);
      setUser(null);
    } catch (cause) {
      if (cause instanceof ApiError && (cause.code === "ACTIVE_SUBSCRIPTION" || cause.code === "ACTIVE_MERCADOPAGO_CONNECTION")) {
        setBlockedReason(cause.code);
      } else {
        setFailed(true);
      }
      setError(buildApiErrorDisplayMessage(cause, "Não foi possível excluir a conta."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
      <section className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
        <Link href={user ? "/settings" : "/login"} className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>
        <h1 className="text-3xl font-bold">Exclusão de conta e dados</h1>
        <p className="mt-3 text-slate-600">Este fluxo remove sua conta do RevendaSmart, catálogo público, dados operacionais e arquivos associados. A ação é irreversível.</p>

        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="flex gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><div>
            <p className="font-semibold">Antes de continuar</p>
            <p className="mt-1">Assinaturas ativas precisam ser canceladas e conexões Mercado Pago precisam ser desconectadas. Registros mantidos diretamente por provedores externos seguem as políticas e obrigações deles.</p>
          </div></div>
        </div>

        {!authReady ? <Loader2 className="mx-auto mt-10 h-6 w-6 animate-spin" /> : completed ? (
          <div data-testid="card-account-deletion-completed" role="status" className="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950">
            <p className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-5 w-5" aria-hidden="true" /> Conta excluída</p>
            <p className="mt-2 text-sm">Sua sessão e os dados locais vinculados à conta foram removidos.</p>
            <Link href="/login" className="mt-4 inline-block font-semibold underline">Ir para o login</Link>
          </div>
        ) : user ? (
          <div className="mt-8 space-y-5">
            <p className="text-sm text-slate-700">Para confirmar, digite exatamente <strong>{CONFIRMATION}</strong>.</p>
            {/* a11y: label associado por `htmlFor`/`id`; o erro é anunciado (role="alert") E associado
                ao campo por `aria-describedby`, para que leitores de tela leiam a mensagem ao focar. */}
            <label htmlFor="account-deletion-confirmation" className="block text-sm font-medium">Confirmação</label>
            <input
              id="account-deletion-confirmation"
              data-testid="input-account-deletion-confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              disabled={loading}
              autoComplete="off"
              aria-invalid={Boolean(error) || undefined}
              aria-describedby={error ? "account-deletion-error" : "account-deletion-hint"}
              className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2"
            />
            <p id="account-deletion-hint" className="text-xs text-slate-600">
              O botão só é liberado quando o texto digitado for exatamente igual à frase de confirmação.
            </p>

            {error && (
              <p
                id="account-deletion-error"
                role="alert"
                data-testid="text-account-deletion-error"
                className="rounded-xl bg-red-50 p-3 text-sm text-red-800"
              >
                {error}
              </p>
            )}

            {/* §4: bloqueio é instrução, não beco sem saída — leva exatamente para onde resolver. */}
            {blockedReason && (
              <div data-testid="card-account-deletion-blocked" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                <p className="font-semibold">Resolva isto antes de excluir</p>
                {blockedReason === "ACTIVE_SUBSCRIPTION" ? (
                  <p className="mt-1">
                    Você ainda tem uma assinatura ativa.{" "}
                    <Link href="/subscribe" data-testid="link-account-deletion-subscription" className="font-semibold underline">
                      Cancelar assinatura
                    </Link>
                  </p>
                ) : (
                  <p className="mt-1">
                    Sua conta Mercado Pago ainda está conectada.{" "}
                    <Link href="/settings/mercadopago" data-testid="link-account-deletion-mercadopago" className="font-semibold underline">
                      Desconectar Mercado Pago
                    </Link>
                  </p>
                )}
                <p className="mt-2 text-xs">Depois de resolver, volte aqui e tente novamente.</p>
              </div>
            )}

            <button
              type="button"
              data-testid="button-account-deletion-submit"
              onClick={deleteAccount}
              disabled={loading || confirmation !== CONFIRMATION}
              aria-busy={loading || undefined}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-red-700 px-5 py-3 font-semibold text-white transition-colors hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {loading
                ? "Excluindo sua conta..."
                : failed
                  ? "Tentar novamente"
                  : "Excluir permanentemente minha conta"}
            </button>
          </div>
        ) : (
          <div className="mt-8 space-y-4 text-slate-700">
            <p><Link href="/login" className="font-semibold text-blue-700 underline">Entre na sua conta</Link> para usar a exclusão automática.</p>
            <p className="text-sm">Se não conseguir entrar, envie a solicitação a partir do e-mail cadastrado para <a className="font-semibold underline" href={`mailto:${SUPPORT_EMAIL}?subject=Solicitação%20de%20exclusão%20de%20conta`}>{SUPPORT_EMAIL}</a>. A exclusão só ocorrerá após verificação de identidade; informar apenas um endereço de e-mail não autoriza a exclusão.</p>
          </div>
        )}

        <p className="mt-8 text-xs text-slate-500">Dados financeiros ou transacionais mantidos por terceiros podem estar sujeitos às políticas do respectivo provedor. A política de retenção legal interna ainda requer decisão formal.</p>
      </section>
    </main>
  );
}
