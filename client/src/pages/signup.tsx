import { useState } from "react";
import { useLocation, Link } from "wouter";
import { bootstrapUserData } from "@/lib/mock-data";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { getFirebaseAuth, getFirebaseError, logTelemetryEvent, setTelemetryUserId, trackAnalyticsEvent, setFirebaseAnalyticsUserId, logError } from "@/lib/firebase";
import { getApiUrl } from "@/lib/api-config";
import { UserPlus, ShoppingBag, Sparkles } from "lucide-react";

export default function Signup() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [storeName, setStoreName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Get Firebase Auth instance
      const auth = getFirebaseAuth();
      
      if (!auth) {
        const firebaseError = getFirebaseError();
        setError(firebaseError || "Erro ao configurar autenticação.");
        setLoading(false);
        return;
      }

      // Create user with Firebase Auth
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      
      // Track signup event (both telemetry and analytics)
      setTelemetryUserId(user.uid);
      logTelemetryEvent("user_signed_up", { provider: "email" }, user.uid);
      
      setFirebaseAnalyticsUserId(user.uid);
      trackAnalyticsEvent("sign_up", { method: "email" });

      // Handle referral attribution if captured from deep link
      const referralUid = localStorage.getItem("rs:referral_source");
      if (referralUid) {
        
        // 1. Log client-side application attempt
        logTelemetryEvent("referral_applied_client", { referralUid, stage: "signup_local", result: "success" }, user.uid).catch(() => {});
        
        try {
          // 2. Store in localStorage first (fallback if API fails)
          const settingsKey = `rs:${user.uid}:settings`;
          const existingSettings = localStorage.getItem(settingsKey);
          if (existingSettings) {
            const settings = JSON.parse(existingSettings);
            settings.referral_source = referralUid;
            settings.referral_applied_at = new Date().toISOString();
            localStorage.setItem(settingsKey, JSON.stringify(settings));
          }
          
          // 3. Call backend API to validate and persist referral in Firestore
          const token = await user.getIdToken();
          const settingsUrl = getApiUrl(`/api/user/settings/${user.uid}`);
          const apiResponse = await fetch(settingsUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({
              referral_source: referralUid,
              referral_applied_at: new Date().toISOString()
            })
          });

          if (apiResponse.ok) {
            const apiData = await apiResponse.json();
            logTelemetryEvent("referral_applied_backend", { 
              referralUid, 
              stage: "signup_api", 
              result: "success" 
            }, user.uid).catch(() => {});
          } else {
            const errorData = await apiResponse.json();
            console.warn("[signup] Backend referral validation failed:", errorData);
            
            // Log the specific failure reason
            const failureReason = errorData.referralValidation?.result || "error";
            
            // Special handling for "already_set" (immutability)
            if (failureReason === "already_set") {
              logTelemetryEvent("referral_already_set", { 
                referralUid, 
                existingReferralSource: errorData.referralValidation?.existingReferralSource || "unknown"
              }, user.uid).catch(() => {});
            } else {
              logTelemetryEvent("referral_rejected", { 
                referralUid, 
                reason: failureReason as any
              }, user.uid).catch(() => {});
            }
            
            logTelemetryEvent("referral_applied_backend", { 
              referralUid, 
              stage: "signup_api", 
              result: failureReason as any
            }, user.uid).catch(() => {});
          }
        } catch (e) {
          console.warn("[signup] Referral application error:", e);
          const errorMsg = e instanceof Error ? e.message : "Unknown error";
          logError("signup_referral_failed", errorMsg, { context: { referralUid }, userId: user.uid });
          logTelemetryEvent("referral_rejected", { 
            referralUid, 
            reason: "api_error"
          }, user.uid).catch(() => {});
        }
        
        // 4. Clear the captured referral from storage (whether successful or not)
        localStorage.removeItem("rs:referral_source");
      }

      // Save user ID to localStorage for session tracking
      try {
        localStorage.setItem("rs:session", user.uid);
      } catch (e) {
        console.warn("Failed to save session:", e);
      }

      // Bootstrap user data with store name from signup form
      try {
        bootstrapUserData(user.uid, email);
        // Save store name to localStorage settings
        const settingsKey = `rs:${user.uid}:settings`;
        const existingSettings = localStorage.getItem(settingsKey);
        if (existingSettings) {
          const settings = JSON.parse(existingSettings);
          settings.storeName = storeName || email.split('@')[0];
          localStorage.setItem(settingsKey, JSON.stringify(settings));
        }
      } catch (bootstrapErr) {
        logError("signup_bootstrap_failed", "Erro ao inicializar conta", {
          error: bootstrapErr instanceof Error ? bootstrapErr : new Error(String(bootstrapErr)),
        });
        // Don't throw — account is created, just warn but proceed to onboarding
        console.warn("Failed to bootstrap user data, but account was created:", bootstrapErr);
      }

      // Redirect to onboarding
      setLocation("/onboarding");
    } catch (err: unknown) {
      const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
      console.error("[signup] Firebase error:", err);
      
      if (code === "auth/email-already-in-use") {
        setError("Este email já está cadastrado");
      } else if (code === "auth/weak-password") {
        setError("Senha muito fraca. Use pelo menos 6 caracteres.");
      } else if (code === "auth/invalid-email") {
        setError("Email inválido");
      } else {
        setError("Erro ao criar conta. Tente novamente.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 max-w-md mx-auto relative overflow-hidden">
      <div className="absolute top-0 left-0 w-64 h-64 bg-primary/10 rounded-full blur-3xl -ml-32 -mt-32" />
      
      <div className="text-center mb-10">
        <h1 className="text-3xl font-black text-foreground mb-2">Criar Conta</h1>
        <p className="text-sm text-muted-foreground font-medium">Comece a gerenciar hoje mesmo</p>
      </div>

      <form onSubmit={handleSignup} className="w-full space-y-4 relative z-10">
        <div className="space-y-1.5">
          <label className="text-[10px] font-black text-muted-foreground uppercase px-1 tracking-widest">Nome da Loja</label>
          <input 
            required
            autoComplete="organization"
            enterKeyHint="next"
            className="w-full bg-white border border-border rounded-2xl p-4 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all shadow-sm"
            value={storeName}
            onChange={e => setStoreName(e.target.value)}
            placeholder="Ex: Maria Cosméticos"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-black text-muted-foreground uppercase px-1 tracking-widest">E-mail</label>
          <input 
            required
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            enterKeyHint="next"
            className="w-full bg-white border border-border rounded-2xl p-4 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all shadow-sm"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="seu@email.com"
            pattern="[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-black text-muted-foreground uppercase px-1 tracking-widest">Senha</label>
          <input 
            required
            type="password"
            autoComplete="new-password"
            enterKeyHint="done"
            className="w-full bg-white border border-border rounded-2xl p-4 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all shadow-sm"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Mínimo 6 caracteres"
          />
        </div>

        {error && <p className="text-xs font-bold text-destructive text-center">{error}</p>}

        <button 
          type="submit"
          disabled={loading}
          className="w-full bg-primary text-white font-black py-4 rounded-[2rem] shadow-xl shadow-primary/20 flex items-center justify-center gap-2 uppercase tracking-[0.2em] text-xs active:scale-95 transition-all mt-6 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
              Criando...
            </>
          ) : (
            <>
              <UserPlus className="w-4 h-4" /> Criar minha conta
            </>
          )}
        </button>
      </form>

      <p className="mt-8 text-sm text-muted-foreground font-medium">
        Já tem conta? <Link href="/login" className="text-primary font-bold">Entrar</Link>
      </p>
    </div>
  );
}
