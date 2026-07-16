import { useState } from "react";
import { useLocation, Link } from "wouter";
import { sendPasswordResetEmail, signInWithEmailAndPassword } from "firebase/auth";
import { getFirebaseAuth, getFirebaseError, logTelemetryEvent, setTelemetryUserId, trackAnalyticsEvent, setFirebaseAnalyticsUserId } from "@/lib/firebase";
import { getApiUrl } from "@/lib/api-config";
import { BarChart3, CheckCircle2, LogIn, ShieldCheck, Sparkles, TrendingUp } from "lucide-react";

export default function Login() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
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
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      const uid = user.uid;
      
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
    <main className="min-h-screen overflow-hidden bg-[#160b2e] text-white lg:grid lg:grid-cols-[1.05fr_.95fr]">
      <section className="relative hidden min-h-screen flex-col justify-between overflow-hidden p-10 lg:flex">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(245,194,87,.28),transparent_28%),radial-gradient(circle_at_82%_14%,rgba(125,92,255,.32),transparent_30%),linear-gradient(135deg,#221044,#120821)]" />
        <div className="absolute -bottom-24 -left-20 h-80 w-80 rounded-full bg-[#7c3aed]/30 blur-3xl" />
        <div className="absolute right-10 top-24 h-72 w-72 rounded-full bg-[#f6c76a]/20 blur-3xl" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-2xl shadow-black/20">
            <img src="/logo-revenda-smart.png" alt="Revenda Smart" className="h-10 w-10 object-contain" width={40} height={40} decoding="async" fetchPriority="high" />
          </div>
          <div>
            <p className="text-sm font-black uppercase tracking-[0.22em] text-[#f6c76a]">Revenda Smart</p>
            <p className="text-xs font-semibold text-white/62">Controle premium para sua revenda</p>
          </div>
        </div>

        <div className="relative z-10 max-w-xl space-y-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-[#f6c76a] backdrop-blur">
            <Sparkles className="h-4 w-4" /> Gestão, vendas e catálogo em um só lugar
          </div>
          <div className="space-y-5">
            <h1 className="text-5xl font-black leading-[.95] tracking-[-0.06em]">Sua revenda organizada com aparência de negócio grande.</h1>
            <p className="max-w-lg text-lg font-medium leading-8 text-white/72">Cadastre produtos, controle vendas, acompanhe clientes e divulgue sua loja com mais confiança — sem perder a simplicidade do dia a dia.</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: BarChart3, label: "Controle", value: "Dashboard" },
              { icon: TrendingUp, label: "Crescimento", value: "Vendas" },
              { icon: ShieldCheck, label: "Segurança", value: "Firebase" },
            ].map((item) => (
              <div key={item.label} className="rounded-3xl border border-white/12 bg-white/10 p-4 shadow-2xl shadow-black/10 backdrop-blur">
                <item.icon className="mb-4 h-5 w-5 text-[#f6c76a]" />
                <p className="text-xs font-bold text-white/55">{item.label}</p>
                <p className="mt-1 text-sm font-black">{item.value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 flex items-center gap-3 text-sm font-semibold text-white/68">
          <CheckCircle2 className="h-5 w-5 text-[#f6c76a]" /> Experiência pensada para Android, PWA e uso real em loja.
        </div>
      </section>

      <section className="relative flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#fbf8ff,#f3edff)] p-5 text-slate-950 lg:bg-white">
        <div className="absolute inset-x-0 top-0 h-64 bg-[radial-gradient(circle_at_50%_0%,rgba(124,58,237,.18),transparent_65%)] lg:hidden" />
        <div className="relative z-10 w-full max-w-md">
          <div className="mb-7 rounded-[2rem] border border-white/80 bg-white/85 p-5 text-center shadow-[0_24px_70px_rgba(79,70,229,.16)] backdrop-blur">
            <img src="/logo-revenda-smart.png" alt="Revenda Smart" className="mx-auto h-auto w-full max-w-[240px] object-contain mix-blend-multiply" width={240} height={90} decoding="async" fetchPriority="high" />
            <p className="mt-3 text-sm font-semibold text-slate-500">Entre para continuar cuidando da sua loja.</p>
          </div>

          <form onSubmit={handleLogin} className="rounded-[2rem] border border-white bg-white p-5 shadow-[0_24px_70px_rgba(15,23,42,.10)] sm:p-6">
            <div className="mb-5">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-primary">Acesso seguro</p>
              <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-950">Bem-vindo de volta</h2>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="px-1 text-[10px] font-black uppercase tracking-widest text-slate-500">E-mail</label>
                <input required type="email" inputMode="email" autoComplete="username" autoCapitalize="none" enterKeyHint="next" className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-950 shadow-inner outline-none transition-all focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10" value={email} onChange={e => setEmail(e.target.value)} placeholder="seu@email.com" disabled={loading} />
              </div>

              <div className="space-y-1.5">
                <label className="px-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Senha</label>
                <input required type="password" autoComplete="current-password" enterKeyHint="done" className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-950 shadow-inner outline-none transition-all focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" disabled={loading} />
              </div>
            </div>

            {error && <p className="mt-4 rounded-2xl bg-red-50 p-3 text-center text-xs font-bold text-destructive" data-testid="text-login-error">{error}</p>}
            {success && <p className="mt-4 rounded-2xl bg-green-50 p-3 text-center text-xs font-bold text-green-700" data-testid="text-login-success">{success}</p>}

            <button type="submit" disabled={loading} className="rs-pressable mt-6 flex w-full items-center justify-center gap-2 rounded-[2rem] bg-primary py-4 text-xs font-black uppercase tracking-[0.2em] text-white shadow-xl shadow-primary/20 transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50">
              {loading ? (
                <>
                  <div className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  Entrando...
                </>
              ) : (
                <>
                  <LogIn className="h-4 w-4" /> Entrar Agora
                </>
              )}
            </button>

            <button type="button" onClick={handlePasswordReset} disabled={loading || resetLoading} className="mt-4 w-full text-sm font-bold text-primary underline underline-offset-4 disabled:opacity-50" data-testid="button-forgot-password">
              {resetLoading ? "Enviando link..." : "Esqueci minha senha"}
            </button>
          </form>

          <p className="mt-7 text-center text-sm font-medium text-slate-500">
            Não tem conta? <Link href="/signup" className="font-black text-primary">Criar conta</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
