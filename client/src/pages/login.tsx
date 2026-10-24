import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, Link } from "wouter";
import { sendPasswordResetEmail, signInWithEmailAndPassword } from "firebase/auth";
import { getFirebaseAuth, logTelemetryEvent, setTelemetryUserId, trackAnalyticsEvent, setFirebaseAnalyticsUserId } from "@/lib/firebase";
import { getApiUrl } from "@/lib/api-config";
import { AccountBootstrapError, getAccountFailureFeedback, requestAccountSettings, runBoundedAccountOperation, type AccountBootstrapUser } from "@/lib/account-bootstrap";
import { createAuthSdkGate, getPasswordResetFeedback, getSignInFeedback, PASSWORD_RESET_ACCEPTED_MESSAGE } from "@/lib/auth-feedback";
import "@/styles/login.css";
import { ArrowRight, CheckCircle2, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";

const REMEMBER_EMAIL_KEY = "rs:login:remembered-email";
// Survives this screen's unmount/remount while an uncancellable SDK call is pending.
const authSdkGate = createAuthSdkGate();
interface LoginOperation { generation: number; controller: AbortController; }

function getRememberedEmail() {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(REMEMBER_EMAIL_KEY) || "";
  } catch {
    return "";
  }
}

function setRememberedEmail(email: string, shouldRemember: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (shouldRemember && email) {
      window.localStorage.setItem(REMEMBER_EMAIL_KEY, email);
    } else {
      window.localStorage.removeItem(REMEMBER_EMAIL_KEY);
    }
  } catch {
    // Remembering the e-mail is convenience only and must never block login.
  }
}

export default function Login() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState(() => getRememberedEmail());
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberEmail, setRememberEmail] = useState(() => Boolean(getRememberedEmail()));
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const loginInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const operationRef = useRef<LoginOperation | null>(null);
  const [sdkPending, setSdkPending] = useState(() => authSdkGate.isPending());
  // ONBOARDING-ROUTING-SAFETY-01 — distingue "não sabemos ainda" de "onboarding incompleto": só existe
  // porque uma falha real (rede/servidor) na busca de settings NUNCA pode virar um redirecionamento para
  // /onboarding (isso trataria um usuário existente como conta nova). O servidor já devolve 200 com
  // onboarding_completed:false para uma conta genuinamente nova (settings ausente) — um response.ok===
  // false aqui é sempre uma falha real (401/403/500), nunca "conta nova"; só este flag habilita o CTA
  // "Tentar novamente", que só refaz a MESMA busca (o login com Firebase Auth já foi concluído).
  const [settingsError, setSettingsError] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [retryingSettings, setRetryingSettings] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    setSdkPending(authSdkGate.isPending());
    const unsubscribe = authSdkGate.subscribe((pending) => {
      if (mountedRef.current) setSdkPending(pending);
    });
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      operationRef.current?.controller.abort();
      operationRef.current = null;
      unsubscribe();
    };
  }, []);

  const isActive = useCallback((operation: LoginOperation) =>
    mountedRef.current && operationRef.current === operation
      && generationRef.current === operation.generation && !operation.controller.signal.aborted, []);

  const beginOperation = (): LoginOperation | null => {
    // Synchronous and shared by login, reset and settings retry (React state is not a lock).
    if (!mountedRef.current || operationRef.current || authSdkGate.isPending()) return null;
    const operation = { generation: ++generationRef.current, controller: new AbortController() };
    operationRef.current = operation;
    setError("");
    setSuccess("");
    setSettingsError(false);
    setSettingsMessage("");
    return operation;
  };

  const finishOperation = (operation: LoginOperation) => {
    if (!isActive(operation)) return;
    operationRef.current = null;
    operation.controller.abort();
    setLoading(false);
    setResetLoading(false);
    setRetryingSettings(false);
  };

  // Retry refetches the same authenticated account; failure or unknown data never means onboarding.
  const resolveOnboardingRoute = useCallback(async (operation: LoginOperation, user?: AccountBootstrapUser | null) => {
    const isCurrentUser = () => isActive(operation)
      && Boolean(user?.uid) && getFirebaseAuth()?.currentUser?.uid === user?.uid;
    try {
      if (!user || !isCurrentUser()) throw new AccountBootstrapError("auth", "token");
      const settings = await requestAccountSettings(user, {
        url: getApiUrl(`/api/user/settings/${encodeURIComponent(user.uid)}`),
        signal: operation.controller.signal,
        isCurrentUser,
      });
      if (!isCurrentUser()) return;
      // The shared helper accepts only a validated, explicit boolean (including new-account false).
      if (settings.onboarding_completed === true) setLocation("/");
      else if (settings.onboarding_completed === false) setLocation("/onboarding");
      else throw new AccountBootstrapError("invalid-response");
    } catch (error: unknown) {
      if (!isActive(operation)) return;
      const feedback = getAccountFailureFeedback(error);
      setSettingsError(true);
      setSettingsMessage(feedback.kind === "cancelled"
        ? "A sessão mudou durante o carregamento. Entre novamente para continuar."
        : feedback.message);
    }
  }, [isActive, setLocation]);

  const handleRetrySettings = async () => {
    const operation = beginOperation();
    if (!operation) return;
    setRetryingSettings(true);
    try {
      await resolveOnboardingRoute(operation, getFirebaseAuth()?.currentUser);
    } finally {
      finishOperation(operation);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    // A disabled button only updates after React renders. Two Enter/click events in the
    // same turn previously started two Firebase sign-ins and two settings requests.
    if (loginInFlightRef.current) return;
    const operation = beginOperation();
    if (!operation) return;
    loginInFlightRef.current = true;
    setLoading(true);

    try {
      const trimmedEmail = email.trim();
      const auth = getFirebaseAuth();
      if (!auth) throw new AccountBootstrapError("configuration", "auth");

      // Authenticate with Firebase Auth (real authentication - NOT mock data)
      const userCredential = await runBoundedAccountOperation(
        () => authSdkGate.run(() => signInWithEmailAndPassword(auth, trimmedEmail, password)),
        { signal: operation.controller.signal, phase: "auth" },
      );
      if (!isActive(operation)) return;
      const user = userCredential.user;
      if (auth.currentUser?.uid !== user.uid) throw new AccountBootstrapError("auth", "auth");
      const uid = user.uid;
      setRememberedEmail(trimmedEmail, rememberEmail);
      
      // Track login event (both telemetry and analytics)
      setTelemetryUserId(uid);
      logTelemetryEvent("user_logged_in", { provider: "email" }, uid);
      
      setFirebaseAnalyticsUserId(uid);
      trackAnalyticsEvent("login", { method: "email" });

      // Decide o destino (onboarding vs app) só depois de autenticado — nunca redireciona para
      // /onboarding a partir de uma falha real na busca de status (ver resolveOnboardingRoute acima).
      await resolveOnboardingRoute(operation, user);
    } catch (error: unknown) {
      if (isActive(operation)) setError(getSignInFeedback(error).message);
    } finally {
      loginInFlightRef.current = false;
      finishOperation(operation);
    }
  };

  const handlePasswordReset = async () => {
    const operation = beginOperation();
    if (!operation) return;
    setResetLoading(true);
    try {
      if (!email.trim()) {
        setError("Informe seu e-mail para redefinir a senha.");
        return;
      }
      const auth = getFirebaseAuth();
      if (!auth) throw new AccountBootstrapError("configuration", "reset");
      await runBoundedAccountOperation(
        () => authSdkGate.run(() => sendPasswordResetEmail(auth, email.trim())),
        { signal: operation.controller.signal, phase: "reset" },
      );
      if (isActive(operation)) setSuccess(PASSWORD_RESET_ACCEPTED_MESSAGE);
    } catch (error: unknown) {
      if (!isActive(operation)) return;
      const feedback = getPasswordResetFeedback(error);
      if (feedback.accepted) setSuccess(feedback.message);
      else setError(feedback.message);
    } finally {
      finishOperation(operation);
    }
  };

  const busy = loading || resetLoading || retryingSettings || sdkPending;

  // Demo mode disabled - login only via Firebase real authentication
  // const handleDemo = () => {
  //   loginDemo();
  //   setLocation("/");
  // };

  return (
    <main className="rs-login-page">
      <section className="rs-login-card" aria-label="Entrar no Revenda Smart">
        <div className="rs-login-hero" aria-describedby="rs-login-value-prop">
          <img
            src="/login-hero-approved.png"
            alt=""
            className="rs-login-hero-image"
            width={935}
            height={1236}
            decoding="async"
            fetchPriority="high"
            aria-hidden="true"
          />
          <div id="rs-login-value-prop" className="rs-login-sr-only">
            <h1>Sua revenda, do seu jeito, com controle total.</h1>
            <p>Personalize seu app, acompanhe tudo em tempo real e tome decisões com confiança para vender mais.</p>
            <ul>
              <li>App do seu jeito: personalize cores, logo e mensagens.</li>
              <li>Controle total da sua revenda: vendas, estoque, clientes e financeiro.</li>
              <li>Resultados em tempo real: acompanhe indicadores e evolua.</li>
              <li>Gestão inteligente: alertas, metas e oportunidades.</li>
              <li>Segurança e confiança: seus dados protegidos sempre.</li>
            </ul>
          </div>
        </div>

        <form onSubmit={handleLogin} className="rs-login-form" aria-label="Entrar no Revenda Smart">
          {(error || success) && (
            <div className="rs-login-message-area" aria-live="polite">
              {error && <p className="rs-login-alert rs-login-alert-error" data-testid="text-login-error">{error}</p>}
              {success && <p className="rs-login-alert rs-login-alert-success" data-testid="text-login-success">{success}</p>}
            </div>
          )}

          {settingsError && (
            <div className="rs-login-message-area" aria-live="polite">
              <p className="rs-login-alert rs-login-alert-error" data-testid="text-settings-error">
                {settingsMessage || "Não foi possível carregar sua conta. Tente novamente."}
              </p>
              <button
                type="button"
                onClick={handleRetrySettings}
                disabled={busy}
                className="rs-login-link-button"
                data-testid="button-retry-settings"
              >
                {retryingSettings ? "Tentando novamente..." : "Tentar novamente"}
              </button>
            </div>
          )}

          {sdkPending && !loading && !resetLoading && (
            <p className="rs-login-alert" role="status" data-testid="text-auth-pending">
              A solicitação anterior de autenticação ainda está em andamento. Aguarde sua conclusão antes de tentar novamente.
            </p>
          )}

          <label className="rs-login-field">
            <span className="rs-login-sr-only">E-mail</span>
            <Mail aria-hidden="true" />
            <input
              required
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              enterKeyHint="next"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="E-mail"
              disabled={busy}
              data-testid="input-login-email"
            />
          </label>

          <label className="rs-login-field">
            <span className="rs-login-sr-only">Senha</span>
            <LockKeyhole aria-hidden="true" />
            <input
              required
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              enterKeyHint="done"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Senha"
              disabled={busy}
              data-testid="input-login-password"
            />
            <button
              type="button"
              className="rs-login-eye"
              onClick={() => setShowPassword((current) => !current)}
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              disabled={busy}
            >
              {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            </button>
          </label>

          <div className="rs-login-actions-row">
            <label className="rs-login-remember">
              <input
                type="checkbox"
                checked={rememberEmail}
                disabled={busy}
                onChange={(event) => setRememberEmail(event.target.checked)}
              />
              <span aria-hidden="true"><CheckCircle2 /></span>
              Lembrar meus dados
            </label>
            <button
              type="button"
              onClick={handlePasswordReset}
              disabled={busy}
              className="rs-login-link-button"
              data-testid="button-forgot-password"
            >
              {resetLoading ? "Enviando..." : "Esqueci minha senha"}
            </button>
          </div>

          <button type="submit" disabled={busy} className="rs-login-submit">
            <span>{loading ? "Entrando..." : "Entrar agora"}</span>
            {loading ? <span className="rs-login-spinner" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
          </button>

          <p className="rs-login-signup">
            Não tem conta? <Link href="/signup">Criar conta</Link>
          </p>
          <p className="rs-login-signup">
            <Link href="/account-deletion">Solicitar exclusão de conta e dados</Link>
          </p>
        </form>
      </section>
    </main>
  );
}
