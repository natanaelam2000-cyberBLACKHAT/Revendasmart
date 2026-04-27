import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { getStored, STORAGE_KEYS, adminEmails, getCurrentUserId } from "@/lib/mock-data";
import { getCurrentFirebaseUser } from "@/lib/firebase";
import { Home, Package, BookOpen, CircleDollarSign, Users, Receipt, Settings, Megaphone, ShieldCheck, Calendar, MoreVertical, ShoppingCart } from "lucide-react";

interface LayoutProps {
  children: React.ReactNode;
  title?: string;
  hideBottomNav?: boolean;
}

export function Layout({ children, title, hideBottomNav = false }: LayoutProps) {
  const [location] = useLocation();
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  // Resolve current user email: Firebase Auth (real users) → localStorage fallback (demo)
  const currentUserEmail = useMemo(() => {
    try {
      const firebaseUser = getCurrentFirebaseUser();
      if (firebaseUser?.email) return firebaseUser.email;
      return null;
    } catch (e) { return null; }
  }, []);

  const mainNavItems = [
    { href: "/", icon: Home, label: "Início" },
    { href: "/products", icon: Package, label: "Produtos" },
    { href: "/catalog", icon: BookOpen, label: "Catálogo" },
    { href: "/marketing", icon: Megaphone, label: "Anúncio" },
  ];

  const moreNavItems = [
    { href: "/sale", icon: ShoppingCart, label: "Venda" },
    { href: "/clients", icon: Users, label: "Clientes" },
    { href: "/billings", icon: Receipt, label: "Cobrança" },
    { href: "/billing-calendar", icon: Calendar, label: "Agenda" },
    { href: "/settings", icon: Settings, label: "Ajustes" },
    { href: "/reports", icon: Receipt, label: "Relatórios" },
  ];

  if (currentUserEmail && adminEmails.includes(currentUserEmail)) {
    moreNavItems.push({ href: "/admin", icon: ShieldCheck, label: "Admin" });
  }

  const navItems = mainNavItems;

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
      <nav className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-lg border-t border-border p-2 px-1 flex justify-between items-center max-w-md mx-auto z-50 safe-area-bottom">
        {navItems.map((item) => {
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
        
        {/* More Menu */}
        <div className="relative">
          <button
            onClick={() => setShowMoreMenu(!showMoreMenu)}
            className={`flex flex-col items-center justify-center flex-1 py-2 px-1 rounded-2xl transition-all duration-300 cursor-pointer ${showMoreMenu ? 'text-primary' : 'text-muted-foreground'}`}
          >
            <MoreVertical className="w-5 h-5 mb-1" strokeWidth={2} />
            <span className={`text-[8px] font-bold uppercase tracking-tighter text-center ${showMoreMenu ? 'opacity-100' : 'opacity-60'}`}>
              Mais
            </span>
          </button>
          
          {/* More Menu Dropdown */}
          {showMoreMenu && (
            <div className="absolute bottom-full right-0 mb-2 bg-white border border-border rounded-2xl shadow-lg py-2 min-w-[140px] z-50">
              {moreNavItems.map((item) => {
                const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setShowMoreMenu(false)}
                  >
                    <div className={`flex items-center gap-2 px-4 py-2 text-sm transition-colors ${isActive ? 'text-primary bg-primary/5' : 'text-foreground hover:bg-muted'}`}>
                      <item.icon className="w-4 h-4" strokeWidth={2} />
                      <span className="font-medium">{item.label}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </nav>
      )}
    </div>
  );
}
