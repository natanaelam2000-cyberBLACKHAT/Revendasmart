import { useState } from "react";
import { useLocation, Link } from "wouter";
import { sendPasswordResetEmail, signInWithEmailAndPassword } from "firebase/auth";
import { getFirebaseAuth, getFirebaseError, logTelemetryEvent, setTelemetryUserId, trackAnalyticsEvent, setFirebaseAnalyticsUserId } from "@/lib/firebase";
import { getApiUrl } from "@/lib/api-config";
import { LogIn } from "lucide-react";

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
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 max-w-md mx-auto relative overflow-hidden">
      <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full blur-3xl -mr-32 -mt-32" />
      <div className="absolute bottom-0 left-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -ml-32 -mb-32" />
      
      <div className="w-full max-w-[292px] mb-7 relative z-10 rounded-[2rem] border border-white/70 bg-white/75 px-5 py-4 shadow-[0_18px_45px_rgba(79,70,229,0.12)] backdrop-blur-sm">
        <img src="/logo-revenda-smart.png" alt="Revenda Smart" className="mx-auto w-full h-auto object-contain mix-blend-multiply" width={292} height={110} decoding="async" fetchPriority="high" />
      </div>

      <div className="text-center mb-10">
        <h1 className="sr-only">Revenda Smart</h1>
        <p className="text-sm text-muted-foreground font-medium">Venda mais, controle melhor e cresça com inteligência</p>
      </div>

      <form onSubmit={handleLogin} className="w-full space-y-4 relative z-10">
        <div className="space-y-1.5">
          <label className="text-[10px] font-black text-muted-foreground uppercase px-1 tracking-widest">E-mail</label>
          <input 
            required
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            enterKeyHint="next"
            className="w-full bg-white border border-border rounded-2xl p-4 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all shadow-sm"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="seu@email.com"
            disabled={loading}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-black text-muted-foreground uppercase px-1 tracking-widest">Senha</label>
          <input 
            required
            type="password"
            autoComplete="current-password"
            enterKeyHint="done"
            className="w-full bg-white border border-border rounded-2xl p-4 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all shadow-sm"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            disabled={loading}
          />
        </div>

        {error && <p className="text-xs font-bold text-destructive text-center" data-testid="text-login-error">{error}</p>}
        {success && <p className="text-xs font-bold text-green-700 text-center" data-testid="text-login-success">{success}</p>}

        <button 
          type="submit"
          disabled={loading}
          className="w-full bg-primary text-white font-black py-4 rounded-[2rem] shadow-xl shadow-primary/20 flex items-center justify-center gap-2 uppercase tracking-[0.2em] text-xs active:scale-95 transition-all mt-6 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
              Entrando...
            </>
          ) : (
            <>
              <LogIn className="w-4 h-4" /> Entrar Agora
            </>
          )}
        </button>

        <button
          type="button"
          onClick={handlePasswordReset}
          disabled={loading || resetLoading}
          className="w-full text-sm font-bold text-primary underline underline-offset-4 disabled:opacity-50"
          data-testid="button-forgot-password"
        >
          {resetLoading ? "Enviando link..." : "Esqueci minha senha"}
        </button>

        {/* Demo button removed - login only via Firebase */}
        {/* <button 
          type="button"
          onClick={handleDemo}
          disabled={loading}
          className="w-full bg-secondary text-foreground font-black py-4 rounded-[2rem] border border-border flex items-center justify-center gap-2 uppercase tracking-[0.2em] text-xs active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Play className="w-4 h-4" /> Testar Demo
        </button> */}
      </form>

      <p className="mt-8 text-sm text-muted-foreground font-medium">
        Não tem conta? <Link href="/signup" className="text-primary font-bold">Criar conta</Link>
      </p>
    </div>
  );
}
