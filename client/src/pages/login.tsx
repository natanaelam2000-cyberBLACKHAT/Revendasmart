import { useState } from "react";
import { useLocation, Link } from "wouter";
import { sendPasswordResetEmail, signInWithEmailAndPassword } from "firebase/auth";
import { getFirebaseAuth, getFirebaseError, logTelemetryEvent, setTelemetryUserId, trackAnalyticsEvent, setFirebaseAnalyticsUserId } from "@/lib/firebase";
import { getApiUrl } from "@/lib/api-config";
import "@/styles/login.css";
import {
  ArrowRight,
  BarChart3,
  Bell,
  CheckCircle2,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  Palette,
  ShieldCheck,
  Smartphone,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";

const REMEMBER_EMAIL_KEY = "rs:login:remembered-email";

const loginBenefits = [
  { icon: Smartphone, title: "App do seu jeito", description: "Personalize cores, logo e mensagens" },
  { icon: BarChart3, title: "Controle total da sua revenda", description: "Vendas, estoque, clientes e financeiro" },
  { icon: TrendingUp, title: "Resultados em tempo real", description: "Acompanhe indicadores e evolua" },
  { icon: Bell, title: "Gestão inteligente", description: "Alertas, metas e oportunidades" },
  { icon: ShieldCheck, title: "Segurança e confiança", description: "Seus dados protegidos sempre" },
];

const panelItems = [
  { icon: BarChart3, label: "Meu painel" },
  { icon: Target, label: "Metas" },
  { icon: Users, label: "Clientes" },
  { icon: Palette, label: "Produtos" },
  { icon: ShieldCheck, label: "Preferências" },
];

const kpis = [
  { label: "Faturamento hoje", value: "R$ 58.750,00", trend: "+18%", tone: "purple" },
  { label: "Pedidos", value: "1.248", trend: "+18%", tone: "gold" },
  { label: "Conversão", value: "21,8%", trend: "+3,2%", tone: "purple" },
  { label: "Clientes ativos", value: "856", trend: "+12%", tone: "gold" },
];

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
    <main className="rs-login-shell">
      <section className="rs-login-stage" aria-label="Revenda Smart acesso">
        <div className="rs-login-orbit rs-login-orbit-one" aria-hidden="true" />
        <div className="rs-login-orbit rs-login-orbit-two" aria-hidden="true" />

        <header className="rs-login-brand" aria-label="Revenda Smart">
          <img
            src="/logo-revenda-smart-symbol.png"
            alt=""
            className="rs-login-brand-symbol"
            width={58}
            height={58}
            decoding="async"
            fetchPriority="high"
          />
          <img
            src="/logo-revenda-smart.png"
            alt="Revenda Smart"
            className="rs-login-brand-wordmark"
            width={220}
            height={74}
            decoding="async"
            fetchPriority="high"
          />
        </header>

        <div className="rs-login-hero-grid">
          <div className="rs-login-copy">
            <h1>
              Sua revenda,
              <span>do seu jeito,</span>
              com controle total.
            </h1>
            <div className="rs-login-title-stroke" aria-hidden="true" />
            <p>
              Personalize seu app, acompanhe tudo em tempo real e tome decisões com confiança para vender mais.
            </p>
          </div>

          <div className="rs-login-dashboard-preview" aria-label="Prévia do painel Revenda Smart">
            <div className="rs-login-human-card" aria-hidden="true">
              <div className="rs-login-avatar">A</div>
              <div>
                <strong>Olá, Ana!</strong>
                <span>Revenda Açaí</span>
              </div>
              <div className="rs-login-star">★</div>
              <ul>
                {panelItems.map((item) => (
                  <li key={item.label}>
                    <item.icon aria-hidden="true" />
                    <span>{item.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="rs-login-benefits" aria-label="Benefícios do Revenda Smart">
          {loginBenefits.map((benefit) => (
            <article key={benefit.title} className="rs-login-benefit">
              <div className="rs-login-benefit-icon">
                <benefit.icon aria-hidden="true" />
              </div>
              <div>
                <h2>{benefit.title}</h2>
                <p>{benefit.description}</p>
              </div>
            </article>
          ))}
        </div>

        <div className="rs-login-kpis" aria-label="Indicadores de exemplo do Revenda Smart">
          {kpis.map((kpi) => (
            <div className="rs-login-kpi" key={kpi.label}>
              <span>{kpi.label}</span>
              <strong>{kpi.value}</strong>
              <small>{kpi.trend}</small>
              <svg viewBox="0 0 92 26" aria-hidden="true" focusable="false">
                <polyline
                  points={kpi.tone === "gold" ? "2,18 18,14 34,17 50,9 68,13 90,5" : "2,19 18,12 34,14 50,8 68,11 90,3"}
                />
              </svg>
            </div>
          ))}
          <div className="rs-login-panel-cta" aria-hidden="true">
            <BarChart3 />
            <span>Ver painel completo</span>
          </div>
        </div>

        <form onSubmit={handleLogin} className="rs-login-form" aria-label="Entrar no Revenda Smart">
          <label className="rs-login-field">
            <span className="sr-only">E-mail</span>
            <Mail aria-hidden="true" />
            <input
              required
              type="email"
              inputMode="email"
              autoComplete="username"
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
            <span className="sr-only">Senha</span>
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

          <div className="rs-login-form-row">
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

          {error && <p className="rs-login-alert rs-login-alert-error" data-testid="text-login-error">{error}</p>}
          {success && <p className="rs-login-alert rs-login-alert-success" data-testid="text-login-success">{success}</p>}

          <button type="submit" disabled={loading} className="rs-login-submit">
            <span>{loading ? "Entrando..." : "Entrar agora"}</span>
            {loading ? <span className="rs-login-spinner" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
          </button>
        </form>

        <p className="rs-login-signup">
          Não tem conta? <Link href="/signup">Criar conta</Link>
        </p>
      </section>
    </main>
  );
}
