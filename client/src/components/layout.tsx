import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { adminEmails } from "@/lib/mock-data";
import { getCurrentFirebaseUser, getFirebaseAuth } from "@/lib/firebase";
import {
  Home, Package, BookOpen, Megaphone,
  User, CreditCard, Store, KeyRound, Share2,
  Settings, HelpCircle, LogOut, X, ChevronRight,
} from "lucide-react";

interface LayoutProps {
  children: React.ReactNode;
  title?: string;
  hideBottomNav?: boolean;
}

export function Layout({ children, title, hideBottomNav = false }: LayoutProps) {
  const [location, setLocation] = useLocation();
  const [showAccountMenu, setShowAccountMenu] = useState(false);

  const currentUserEmail = useMemo(() => {
    try {
      const firebaseUser = getCurrentFirebaseUser();
      if (firebaseUser?.email) return firebaseUser.email;
      return null;
    } catch (e) { return null; }
  }, []);

  const userInitial = currentUserEmail
    ? currentUserEmail.charAt(0).toUpperCase()
    : "U";

  const mainNavItems = [
    { href: "/", icon: Home, label: "Início" },
    { href: "/products", icon: Package, label: "Produtos" },
    { href: "/catalog", icon: BookOpen, label: "Catálogo" },
    { href: "/marketing", icon: Megaphone, label: "Anúncio" },
  ];

  const handleLogout = async () => {
    try {
      const auth = getFirebaseAuth();
      if (auth) await auth.signOut();
    } catch (e) {
      console.error("Logout error:", e);
    }
    setShowAccountMenu(false);
    setLocation("/login");
  };

  const go = (path: string) => {
    setShowAccountMenu(false);
    setLocation(path);
  };

  const accountSections = [
    {
      items: [
        {
          label: "Minha Conta",
          desc: "Perfil e dados pessoais",
          icon: User,
          iconBg: "bg-primary/10 text-primary",
          action: () => go("/settings?tab=profile"),
        },
        {
          label: "Minha Assinatura",
          desc: "Plano e faturamento",
          icon: CreditCard,
          iconBg: "bg-sky-100 text-sky-600",
          action: () => go("/subscribe"),
        },
      ],
    },
    {
      items: [
        {
          label: "Minha Loja",
          desc: "Nome, logo e informações",
          icon: Store,
          iconBg: "bg-violet-100 text-violet-600",
          action: () => go("/settings?tab=profile"),
        },
        {
          label: "Chave Pix",
          desc: "Para recebimento dos pedidos",
          icon: KeyRound,
          iconBg: "bg-green-100 text-green-600",
          action: () => go("/settings?tab=profile"),
        },
        {
          label: "Compartilhar Catálogo",
          desc: "Link e QR Code do catálogo",
          icon: Share2,
          iconBg: "bg-blue-100 text-blue-600",
          action: () => go("/settings?tab=catalog_config"),
        },
      ],
    },
    {
      items: [
        {
          label: "Preferências",
          desc: "Notificações e ajustes",
          icon: Settings,
          iconBg: "bg-gray-100 text-gray-600",
          action: () => go("/settings"),
        },
        {
          label: "Suporte",
          desc: "Ajuda, FAQ e contato",
          icon: HelpCircle,
          iconBg: "bg-amber-100 text-amber-600",
          action: () => go("/settings?tab=help"),
        },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-background pb-24 max-w-md mx-auto relative shadow-2xl overflow-hidden flex flex-col">
      {title && (
        <header className="px-6 pt-10 pb-4 bg-white sticky top-0 z-40 border-b border-border/50">
          <h1 className="text-xl font-bold">{title}</h1>
        </header>
      )}
      <main className="flex-1 overflow-y-auto overflow-x-hidden">
        {children}
      </main>

      {!hideBottomNav && (
        <>
          {/* ── BOTTOM NAV ─────────────────────────────────── */}
          <nav className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-lg border-t border-border p-2 px-1 flex justify-between items-center max-w-md mx-auto z-50 safe-area-bottom">
            {mainNavItems.map((item) => {
              const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
              return (
                <Link key={item.href} href={item.href}>
                  <div className={`flex flex-col items-center justify-center flex-1 py-2 rounded-2xl transition-all duration-300 cursor-pointer ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
                    <item.icon className={`w-5 h-5 mb-1 ${isActive ? 'fill-primary/10' : ''}`} strokeWidth={isActive ? 2.5 : 2} />
                    <span className={`text-[8px] font-bold uppercase tracking-tighter text-center ${isActive ? 'opacity-100' : 'opacity-60'}`}>
                      {item.label}
                    </span>
                  </div>
                </Link>
              );
            })}

            {/* Account button */}
            <button
              onClick={() => setShowAccountMenu(true)}
              className={`flex flex-col items-center justify-center flex-1 py-2 px-1 rounded-2xl transition-all duration-300 cursor-pointer ${showAccountMenu ? 'text-primary' : 'text-muted-foreground'}`}
            >
              <div className={`w-6 h-6 mb-0.5 rounded-full flex items-center justify-center text-[9px] font-black ${showAccountMenu ? 'bg-primary text-white' : 'bg-muted text-muted-foreground'}`}>
                {userInitial}
              </div>
              <span className={`text-[8px] font-bold uppercase tracking-tighter text-center ${showAccountMenu ? 'opacity-100' : 'opacity-60'}`}>
                Conta
              </span>
            </button>
          </nav>

          {/* ── ACCOUNT BOTTOM SHEET ───────────────────────── */}
          {showAccountMenu && (
            <>
              {/* Backdrop */}
              <div
                className="fixed inset-0 bg-black/40 z-50 animate-in fade-in duration-200"
                onClick={() => setShowAccountMenu(false)}
              />

              {/* Sheet */}
              <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-[#F8F8F8] rounded-t-[2rem] z-50 shadow-2xl animate-in slide-in-from-bottom-4 duration-300 max-h-[88vh] overflow-y-auto">

                {/* Drag handle */}
                <div className="flex justify-center pt-3 pb-1">
                  <div className="w-10 h-1 rounded-full bg-border/60" />
                </div>

                {/* Header — identidade do usuário */}
                <div className="flex items-center justify-between px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center text-white font-black text-lg shadow-md shadow-primary/20">
                      {userInitial}
                    </div>
                    <div>
                      <p className="text-sm font-black text-foreground leading-tight">
                        {currentUserEmail ? currentUserEmail.split("@")[0] : "Usuário"}
                      </p>
                      <p className="text-[10px] text-muted-foreground/70 truncate max-w-[180px]">
                        {currentUserEmail || ""}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowAccountMenu(false)}
                    className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground hover:bg-muted/80 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Menu sections */}
                <div className="px-4 pb-6 space-y-3">
                  {accountSections.map((section, si) => (
                    <div
                      key={si}
                      className="bg-white rounded-[1.5rem] border border-border/40 shadow-sm overflow-hidden divide-y divide-border/30"
                    >
                      {section.items.map((item) => (
                        <button
                          key={item.label}
                          onClick={item.action}
                          className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-secondary/30 active:bg-secondary/50 transition-colors text-left"
                        >
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${item.iconBg}`}>
                            <item.icon className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-foreground leading-tight">{item.label}</p>
                            <p className="text-[10px] text-muted-foreground/70 mt-0.5">{item.desc}</p>
                          </div>
                          <ChevronRight className="w-4 h-4 text-muted-foreground/40 flex-shrink-0" />
                        </button>
                      ))}
                    </div>
                  ))}

                  {/* Sair — destacado */}
                  <div className="bg-white rounded-[1.5rem] border border-border/40 shadow-sm overflow-hidden">
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-red-50 active:bg-red-100 transition-colors text-left"
                    >
                      <div className="w-9 h-9 rounded-xl bg-red-100 text-red-600 flex items-center justify-center flex-shrink-0">
                        <LogOut className="w-4 h-4" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-bold text-red-600 leading-tight">Sair</p>
                        <p className="text-[10px] text-red-400/80 mt-0.5">Encerrar sessão</p>
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
