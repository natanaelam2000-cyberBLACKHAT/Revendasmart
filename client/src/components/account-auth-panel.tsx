import { useRef, useState } from "react";
import type { User } from "firebase/auth";
import { authController } from "@/lib/auth-lifecycle";
import { authErrorMessage, type SocialProvider } from "@/lib/auth-policy";

export function AccountAuthPanel({ user }: { user: User | null }) {
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [message, setMessage] = useState("");
  const [verified, setVerified] = useState(user?.emailVerified ?? false);
  const [providers, setProviders] = useState(() => user?.providerData.map(p => p.providerId) ?? []);
  const [password, setPassword] = useState("");
  const [method, setMethod] = useState<SocialProvider | "password">(providers.includes("password") ? "password" : providers.includes("google.com") ? "google" : "facebook");
  if (!user) return null;
  async function run(action: () => Promise<unknown>, success: string) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setMessage("");
    try {
      await action();
      setVerified(user?.emailVerified ?? false);
      setProviders(user?.providerData.map(p => p.providerId) ?? []);
      setMessage(success);
    } catch (error) { setMessage(authErrorMessage(error)); }
    finally { working.current = false; setPassword(""); setBusy(false); }
  }
  return <section aria-label="Segurança da conta" className="rounded-3xl border bg-white p-5 space-y-3">
    <h3 className="font-semibold">Segurança da conta</h3>
    <p>{!user.email ? "Seu provedor não informou um e-mail. Use o acesso vinculado à sua conta." : verified ? "E-mail verificado" : "Seu e-mail ainda não foi verificado."}</p>
    {user.email && !verified && <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => run(() => authController.sendVerification(), "Confira sua caixa de entrada. Aguarde um minuto antes de reenviar.")} className="min-h-12 border rounded-xl px-3">Reenviar verificação</button>
      <button type="button" disabled={busy} onClick={() => run(() => authController.refreshVerification(), "Status de verificação atualizado.")} className="min-h-12 border rounded-xl px-3">Já verifiquei meu e-mail</button>
    </div>}
    <p className="text-sm">Vincular um acesso mantém seus dados nesta mesma conta. Não transfere dados de outras contas.</p>
    <label className="block text-sm">Confirmar identidade
      <select value={method} disabled={busy} onChange={event => setMethod(event.target.value as SocialProvider | "password")} className="min-h-12 border rounded-xl px-3 block">
        {providers.includes("password") && <option value="password">Senha</option>}
        {providers.includes("google.com") && <option value="google">Google</option>}
        {providers.includes("facebook.com") && <option value="facebook">Facebook</option>}
      </select>
    </label>
    {method === "password" && <label className="block text-sm">Senha atual<input type="password" autoComplete="current-password" disabled={busy} value={password} onChange={event => setPassword(event.target.value)} className="min-h-12 border rounded-xl px-3 block w-full" /></label>}
    <button type="button" disabled={busy || (method === "password" && !password)} onClick={() => run(() => authController.reauthenticate(method, password), "Identidade confirmada. Você pode vincular um acesso.")} className="min-h-12 border rounded-xl px-3">Confirmar identidade</button>
    <div className="flex flex-wrap gap-2">
      {(["google", "facebook"] as const).map(provider => <button key={provider} type="button" disabled={busy || providers.includes(`${provider}.com`)} onClick={() => run(() => authController.link(provider), "Acesso vinculado à sua conta.")} className="min-h-12 border rounded-xl px-3">
        {providers.includes(`${provider}.com`) ? "Vinculado: " : "Vincular "}{provider === "google" ? "Google" : "Facebook"}
      </button>)}
      {authController.pendingEmail && <button type="button" disabled={busy} onClick={() => run(() => authController.confirmPendingLink(), "Vinculação confirmada.")} className="min-h-12 border rounded-xl px-3">Confirmar vinculação pendente</button>}
    </div>
    {message && <p role="status">{message}</p>}
  </section>;
}
