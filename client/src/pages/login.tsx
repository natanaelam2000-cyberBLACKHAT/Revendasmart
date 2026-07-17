import { useState } from "react";
import { useLocation, Link } from "wouter";
import { sendPasswordResetEmail, signInWithEmailAndPassword } from "firebase/auth";
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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
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
      const userCredential = await signInWithEmailAndPassword(auth, trimmedEmail, password);
      const user = userCredential.user;
      const uid = user.uid;
      setRememberedEmail(trimmedEmail, rememberEmail);
      
      // Track login event (both telemetry and analytics)
      setTelemetryUserId(uid);
      logTelemetryEvent("user_logged_in", { provider: "email" }, uid);
      
      setFirebaseAnalyticsUserId(uid);
      trackAnalyticsEvent("login", { method: "email" });

      // Get ID token and fetch settings from Firestore
      try {
        const token = await user.getIdToken();
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const settingsUrl = getApiUrl(`/api/user/settings/${uid}`);
        const response = await fetch(settingsUrl, { headers });
        
        if (response.ok) {
          const data = await response.json();
          if (data.settings?.onboarding_completed === true) {
            setLocation("/");
          } else {
            setLocation("/onboarding");
          }
        } else {
          // Settings not found, go to onboarding
          setLocation("/onboarding");
        }
      } catch (settingsErr) {
        console.warn("[login] Failed to fetch settings, redirecting to onboarding:", settingsErr);
        setLocation("/onboarding");
      }
    } catch (err: any) {
      // Diagnóstico: log detalhado do erro do Firebase
      console.error("[login] Firebase auth error:", err);
      
      // User-friendly error messages
      if (err.code === "auth/user-not-found" || err.code === "auth/wrong-password") {
        setError("Email ou senha incorretos");
      } else if (err.code === "auth/invalid-email") {
        setError("Email inválido");
      } else if (err.code === "auth/too-many-requests") {
        setError("Muitas tentativas. Tente novamente mais tarde.");
      } else {
        setError("Erro ao fazer login. Tente novamente.");
      }
    } finally {
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

    setResetLoading(true);
    try {
      const auth = getFirebaseAuth();
      if (!auth) {
        setError(getFirebaseError() || "Autenticação indisponível no momento.");
        return;
      }

      await sendPasswordResetEmail(auth, email.trim());
      setSuccess("Enviamos um link para redefinir sua senha.");
    } catch (err: any) {
      const code = err?.code;
      if (code === "auth/invalid-email") {
        setError("E-mail inválido");
      } else if (code === "auth/user-not-found") {
        setSuccess("Enviamos um link para redefinir sua senha.");
      } else if (code === "auth/network-request-failed") {
        setError("Falha de rede. Tente novamente.");
      } else if (code === "auth/unauthorized-continue-uri" || code === "auth/invalid-continue-uri") {
        setError("Configuração de recuperação de senha ausente.");
      } else {
        setError("Não foi possível enviar o link agora. Tente novamente.");
      }
    } finally {
      setResetLoading(false);
    }
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
          {(error || success) && (
            <div className="rs-login-message-area" aria-live="polite">
              {error && <p className="rs-login-alert rs-login-alert-error" data-testid="text-login-error">{error}</p>}
              {success && <p className="rs-login-alert rs-login-alert-success" data-testid="text-login-success">{success}</p>}
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
        </form>
      </section>
    </main>
  );
}
