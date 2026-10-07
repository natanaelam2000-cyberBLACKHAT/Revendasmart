import { useCallback, useRef, useState } from "react";
import { useLocation, Link } from "wouter";
import { authController } from "@/lib/auth-lifecycle";
import { authErrorMessage, type SocialProvider } from "@/lib/auth-policy";
import { getFirebaseAuth, getFirebaseError, logTelemetryEvent, setTelemetryUserId, trackAnalyticsEvent, setFirebaseAnalyticsUserId } from "@/lib/firebase";
import { getApiUrl } from "@/lib/api-config";
import "@/styles/login.css";
import { ArrowRight, CheckCircle2, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";

const REMEMBER_EMAIL_KEY = "rs:login:remembered-email";

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
  const submitting = useRef(false);
  // ONBOARDING-ROUTING-SAFETY-01 — distingue "não sabemos ainda" de "onboarding incompleto": só existe
  // porque uma falha real (rede/servidor) na busca de settings NUNCA pode virar um redirecionamento para
  // /onboarding (isso trataria um usuário existente como conta nova). O servidor já devolve 200 com
  // onboarding_completed:false para uma conta genuinamente nova (settings ausente) — um response.ok===
  // false aqui é sempre uma falha real (401/403/500), nunca "conta nova"; só este flag habilita o CTA
  // "Tentar novamente", que só refaz a MESMA busca (o login com Firebase Auth já foi concluído).
  const [settingsError, setSettingsError] = useState(false);
  const [retryingSettings, setRetryingSettings] = useState(false);

  // Busca o status de onboarding do usuário JÁ autenticado e decide o destino — usada tanto no fluxo de
  // login quanto no retry manual (nunca re-autentica: getFirebaseAuth()?.currentUser já é o suficiente).
  const resolveOnboardingRoute = useCallback(async () => {
    const auth = getFirebaseAuth();
    const user = auth?.currentUser;
    if (!user) {
      setSettingsError(true);
      return;
    }
    try {
      const token = await user.getIdToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const settingsUrl = getApiUrl(`/api/user/settings/${user.uid}`);
      const response = await fetch(settingsUrl, { headers });

      if (response.ok) {
        const data = await response.json();
        setSettingsError(false);
        if (data.settings?.onboarding_completed === true) {
          setLocation("/");
        } else {
          setLocation("/onboarding");
        }
        return;
      }
      // Não-OK aqui é SEMPRE uma falha real (401/403/500) — o servidor já responde 200 com
      // onboarding_completed:false para uma conta nova sem settings ainda, então isto nunca significa
      // "conta nova". Nunca redireciona para /onboarding a partir daqui.
      console.warn("[login] Settings request returned non-OK status:", response.status);
      setSettingsError(true);
    } catch (settingsErr) {
      console.warn("[login] Failed to fetch settings:", settingsErr);
      setSettingsError(true);
    }
  }, [setLocation]);

  const handleRetrySettings = async () => {
    if (retryingSettings) return;
    setRetryingSettings(true);
    try {
      await resolveOnboardingRoute();
    } finally {
      setRetryingSettings(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setError("");
    setLoading(true);

    try {
      const trimmedEmail = email.trim();
      // Get Firebase Auth instance (safe lazy initialization)
      const auth = getFirebaseAuth();
      
      // Check for Firebase initialization errors
      if (!auth) {
        const firebaseError = getFirebaseError();
        setError(firebaseError || "Erro ao configurar autenticação. Tente novamente mais tarde.");
        setLoading(false);
        return;
      }

      // Authenticate with Firebase Auth (real authentication - NOT mock data)
      const user = await authController.login(trimmedEmail, password);
      const uid = user.uid;
      setRememberedEmail(trimmedEmail, rememberEmail);
      
      // Track login event (both telemetry and analytics)
      setTelemetryUserId(uid);
      logTelemetryEvent("user_logged_in", { provider: "email" }, uid);
      
      setFirebaseAnalyticsUserId(uid);
      trackAnalyticsEvent("login", { method: "email" });

      // Decide o destino (onboarding vs app) só depois de autenticado — nunca redireciona para
      // /onboarding a partir de uma falha real na busca de status (ver resolveOnboardingRoute acima).
      await resolveOnboardingRoute();
    } catch (err: unknown) {
      setError(authErrorMessage(err));
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  const handlePasswordReset = async () => {
    setError("");
    setSuccess("");

    if (!email.trim()) {
      setError("Informe seu e-mail para redefinir a senha");
      return;
    }

    if (submitting.current) return;
    submitting.current = true;
    setResetLoading(true);
    try {
      const auth = getFirebaseAuth();
      if (!auth) {
        setError(getFirebaseError() || "Autenticação indisponível no momento.");
        return;
      }

      await authController.resetPassword(email);
      setSuccess("Se houver uma conta para este e-mail, enviaremos as instruções para redefinir sua senha.");
    } catch (err: unknown) {
      setError(authErrorMessage(err));
    } finally {
      submitting.current = false;
      setResetLoading(false);
    }
  };

  const handleSocial = async (provider: SocialProvider) => {
    if (submitting.current) return;
    submitting.current = true;
    setError("");
    setLoading(true);
    try {
      const user = await authController.social(provider);
      setTelemetryUserId(user.uid);
      setFirebaseAnalyticsUserId(user.uid);
      trackAnalyticsEvent("login", { method: provider });
      await resolveOnboardingRoute();
    } catch (cause) { setError(authErrorMessage(cause)); }
    finally { submitting.current = false; setLoading(false); }
  };
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
          <div className="flex flex-wrap gap-2 mb-4" aria-label="Outras formas de entrar">
            <button type="button" className="min-h-12 rounded-xl border px-4" disabled={loading || resetLoading} onClick={() => handleSocial("google")}>Entrar com Google</button>
            <button type="button" className="min-h-12 rounded-xl border px-4" disabled={loading || resetLoading} onClick={() => handleSocial("facebook")}>Entrar com Facebook</button>
          </div>
          {(error || success) && (
            <div className="rs-login-message-area" aria-live="polite">
              {error && <p className="rs-login-alert rs-login-alert-error" data-testid="text-login-error">{error}</p>}
              {success && <p className="rs-login-alert rs-login-alert-success" data-testid="text-login-success">{success}</p>}
            </div>
          )}

          {settingsError && (
            <div className="rs-login-message-area" aria-live="polite">
              <p className="rs-login-alert rs-login-alert-error" data-testid="text-settings-error">
                Não foi possível carregar sua conta. Tente novamente.
              </p>
              <button
                type="button"
                onClick={handleRetrySettings}
                disabled={retryingSettings}
                className="rs-login-link-button"
                data-testid="button-retry-settings"
              >
                {retryingSettings ? "Tentando novamente..." : "Tentar novamente"}
              </button>
            </div>
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
              disabled={loading}
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
              disabled={loading}
              data-testid="input-login-password"
            />
            <button
              type="button"
              className="rs-login-eye"
              onClick={() => setShowPassword((current) => !current)}
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              disabled={loading}
            >
              {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            </button>
          </label>

          <div className="rs-login-actions-row">
            <label className="rs-login-remember">
              <input
                type="checkbox"
                checked={rememberEmail}
                onChange={(event) => setRememberEmail(event.target.checked)}
              />
              <span aria-hidden="true"><CheckCircle2 /></span>
              Lembrar meus dados
            </label>
            <button
              type="button"
              onClick={handlePasswordReset}
              disabled={loading || resetLoading}
              className="rs-login-link-button"
              data-testid="button-forgot-password"
            >
              {resetLoading ? "Enviando..." : "Esqueci minha senha"}
            </button>
          </div>

          <button type="submit" disabled={loading} className="rs-login-submit">
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
