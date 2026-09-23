import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { getCurrentFirebaseUser } from "@/lib/firebase";
import { Home, Package, BookOpen, Megaphone, User, ShoppingCart, CalendarClock, Users, ClipboardList, MoreHorizontal } from "lucide-react";
import { useUserSettings } from "@/providers/UserSettingsProvider";
import { resolveBusinessMode, type BusinessMode } from "@shared/business-mode";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface LayoutProps {
  children: React.ReactNode;
  title?: string;
  hideBottomNav?: boolean;
}

type NavItem = { href: string; icon: typeof Home; label: string };

const PRODUCTS_ITEMS: NavItem[] = [{href:"/",icon:Home,label:"Início"},{href:"/products",icon:Package,label:"Produtos"},{href:"/sale",icon:ShoppingCart,label:"Vendas"},{href:"/catalog",icon:BookOpen,label:"Catálogo"},{href:"/marketing",icon:Megaphone,label:"Anúncios"},{href:"/settings",icon:User,label:"Conta"}];

/**
 * HOTFIX-P0-D (rodada 2) — antes, SERVICES reaproveitava os mesmos 6 slots de PRODUCTS (Início/
 * Serviços->agenda/Horários/Catálogo/Anúncios/Conta), sem Clientes nem Atendimentos como destino de
 * primeiro nível, e sem uma tela própria para a LISTA de serviços (só a agenda). Lista exigida pelo
 * ticket: Início/Agenda/Serviços/Clientes/Atendimentos/Anúncios/Conta. "Horários" sai do nível
 * principal (continua a 1 toque, dentro de Agenda -> "Configurar horários", client/src/pages/
 * service-agenda.tsx) para abrir espaço; os 3 destinos menos frequentes (Atendimentos/Anúncios/Conta)
 * ficam no hub "Mais" no mobile (nav de 5 colunas) e aparecem soltos na sidebar de desktop, que tem
 * espaço de sobra.
 */
const SERVICES_PRIMARY: NavItem[] = [{href:"/",icon:Home,label:"Início"},{href:"/servicos/agenda",icon:CalendarClock,label:"Agenda"},{href:"/servicos",icon:BookOpen,label:"Serviços"},{href:"/clients",icon:Users,label:"Clientes"}];
const SERVICES_OVERFLOW: NavItem[] = [{href:"/servicos/atendimentos",icon:ClipboardList,label:"Atendimentos"},{href:"/marketing",icon:Megaphone,label:"Anúncios"},{href:"/settings",icon:User,label:"Conta"}];

/**
 * HOTFIX-P0-D (rodada 2) — antes, HYBRID herdava a navegação de PRODUCTS sem nenhum acesso direto a
 * Serviços (só um banner do dashboard, que desaparece assim que o primeiro produto é cadastrado — o
 * requisito "Serviços nunca escondido" não valia). Agora Produtos E Serviços são os dois primeiros
 * slots depois de Início, sempre visíveis, e Vendas/Agenda ficam propositalmente SEPARADOS (nunca uma
 * lista fundida) dentro de "Mais" — mesmo requisito do ticket.
 */
const HYBRID_PRIMARY: NavItem[] = [{href:"/",icon:Home,label:"Início"},{href:"/products",icon:Package,label:"Produtos"},{href:"/servicos",icon:BookOpen,label:"Serviços"},{href:"/clients",icon:Users,label:"Clientes"}];
const HYBRID_OVERFLOW: NavItem[] = [{href:"/sale",icon:ShoppingCart,label:"Vendas"},{href:"/servicos/agenda",icon:CalendarClock,label:"Agenda"},{href:"/servicos/atendimentos",icon:ClipboardList,label:"Atendimentos"},{href:"/catalog",icon:BookOpen,label:"Catálogo"},{href:"/marketing",icon:Megaphone,label:"Anúncios"},{href:"/settings",icon:User,label:"Conta"}];

function navForBusinessMode(mode: BusinessMode): { primary: NavItem[]; overflow: NavItem[] } {
  if (mode === "services") return { primary: SERVICES_PRIMARY, overflow: SERVICES_OVERFLOW };
  if (mode === "both") return { primary: HYBRID_PRIMARY, overflow: HYBRID_OVERFLOW };
  return { primary: PRODUCTS_ITEMS, overflow: [] };
}

export function Layout({ children, title, hideBottomNav = false }: LayoutProps) {
  const [location] = useLocation();
  const { settings } = useUserSettings();
  const { primary, overflow } = useMemo(() => navForBusinessMode(resolveBusinessMode(settings.businessMode)), [settings.businessMode]);
  const [moreOpen, setMoreOpen] = useState(false);
  const email = useMemo(() => {
    try {
      return getCurrentFirebaseUser()?.email || null;
    } catch {
      return null;
    }
  }, []);

  const active = (href: string) => href === "/"
    ? location === "/"
    : location.startsWith(href) || (href === "/settings" && location === "/subscribe");

  const isOverflowActive = overflow.some((item) => active(item.href));
  const bottomNavColumns = primary.length + (overflow.length > 0 ? 1 : 0);

  return (
    <div className="rs-app-shell bg-background text-foreground">
      {!hideBottomNav && (
        <aside className="rs-sidebar-safe hidden lg:flex fixed inset-y-0 left-0 z-50 w-64 flex-col bg-white border-r border-border/60 px-5 py-7">
          <Link href="/">
            <div className="flex items-center gap-3 px-2 mb-9 cursor-pointer">
              <div className="w-11 h-11 rounded-2xl bg-primary text-white flex items-center justify-center font-black shadow-lg shadow-primary/20">R</div>
              <div>
                <p className="font-black text-lg leading-none">Revenda Smart</p>
                <p className="text-[10px] text-muted-foreground mt-1">Gestão para revendedoras</p>
              </div>
            </div>
          </Link>

          <nav className="space-y-2">
            {[...primary, ...overflow].map((item) => {
              const isActive = active(item.href);
              return (
                <Link key={item.href} href={item.href}>
                  <div className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl cursor-pointer transition-colors ${isActive ? "bg-primary text-white shadow-md shadow-primary/15" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"}`}>
                    <item.icon className="w-5 h-5" />
                    <span className="text-sm font-bold">{item.label}</span>
                  </div>
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto flex items-center gap-3 p-3 rounded-2xl bg-secondary/40">
            <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center text-sm font-black">{email?.charAt(0).toUpperCase() || "U"}</div>
            <div className="min-w-0">
              <p className="text-xs font-bold truncate">{email?.split("@")[0] || "Usuário"}</p>
              <p className="text-[9px] text-muted-foreground truncate">{email || ""}</p>
            </div>
          </div>
        </aside>
      )}

      <div className={!hideBottomNav ? "lg:pl-64" : ""}>
        <div className="rs-app-frame bg-background lg:bg-transparent">
          {title && (
            <header className="rs-safe-x rs-app-header pb-4 bg-white/95 lg:bg-transparent sticky top-0 z-40 border-b lg:border-b-0 border-border/50 backdrop-blur">
              <h1 className="text-xl lg:text-2xl font-black">{title}</h1>
            </header>
          )}
          <main className="min-w-0">{children}</main>
        </div>
      </div>

      {!hideBottomNav && (
        <nav
          className="rs-bottom-nav-edge lg:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-border/70 bg-white/95 shadow-[0_-10px_34px_rgba(15,23,42,0.10)] backdrop-blur-xl"
          aria-label="Navegação principal"
        >
          <div className="mx-auto grid max-w-xl gap-1" style={{ gridTemplateColumns: `repeat(${bottomNavColumns}, minmax(0, 1fr))` }}>
            {primary.map((item) => {
              const isActive = active(item.href);
              return (
                <Link key={item.href} href={item.href}>
                  <div
                    aria-current={isActive ? "page" : undefined}
                    className={`rs-pressable group relative flex min-h-[52px] min-w-0 flex-col items-center justify-center rounded-2xl px-0.5 py-1.5 text-center touch-manipulation outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${isActive ? "bg-primary/10 text-primary shadow-sm" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"}`}
                  >
                    <span className={`mb-0.5 flex h-7 w-7 items-center justify-center rounded-xl transition-[transform,background-color,box-shadow,color] duration-180 motion-reduce:transition-none ${isActive ? "bg-white text-primary shadow-sm ring-1 ring-primary/10 scale-105" : "bg-transparent group-hover:bg-accent"}`}>
                      <item.icon className={`transition-all duration-200 ${isActive ? "h-5 w-5" : "h-[18px] w-[18px]"}`} aria-hidden="true" />
                    </span>
                    <span className={`block w-full whitespace-nowrap text-center text-[9px] font-black leading-none tracking-[-0.02em] transition-colors duration-200 min-[390px]:text-[10px] ${isActive ? "text-primary" : "text-muted-foreground"}`}>
                      {item.label}
                    </span>
                    {isActive && <span className="absolute bottom-1 h-1 w-4 rounded-full bg-primary/70" aria-hidden="true" />}
                  </div>
                </Link>
              );
            })}
            {overflow.length > 0 && (
              <button
                type="button"
                onClick={() => setMoreOpen(true)}
                aria-current={isOverflowActive ? "page" : undefined}
                data-testid="button-nav-more"
                className={`rs-pressable group relative flex min-h-[52px] min-w-0 flex-col items-center justify-center rounded-2xl px-0.5 py-1.5 text-center touch-manipulation outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${isOverflowActive ? "bg-primary/10 text-primary shadow-sm" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"}`}
              >
                <span className={`mb-0.5 flex h-7 w-7 items-center justify-center rounded-xl transition-[transform,background-color,box-shadow,color] duration-180 motion-reduce:transition-none ${isOverflowActive ? "bg-white text-primary shadow-sm ring-1 ring-primary/10 scale-105" : "bg-transparent group-hover:bg-accent"}`}>
                  <MoreHorizontal className={`transition-all duration-200 ${isOverflowActive ? "h-5 w-5" : "h-[18px] w-[18px]"}`} aria-hidden="true" />
                </span>
                <span className={`block w-full whitespace-nowrap text-center text-[9px] font-black leading-none tracking-[-0.02em] transition-colors duration-200 min-[390px]:text-[10px] ${isOverflowActive ? "text-primary" : "text-muted-foreground"}`}>
                  Mais
                </span>
                {isOverflowActive && <span className="absolute bottom-1 h-1 w-4 rounded-full bg-primary/70" aria-hidden="true" />}
              </button>
            )}
          </div>
        </nav>
      )}

      {overflow.length > 0 && (
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetContent side="bottom" className="rounded-t-[2rem] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <SheetHeader>
              <SheetTitle>Mais opções</SheetTitle>
            </SheetHeader>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {overflow.map((item) => {
                const isActive = active(item.href);
                return (
                  <Link key={item.href} href={item.href}>
                    <a
                      onClick={() => setMoreOpen(false)}
                      className={`flex flex-col items-center gap-2 rounded-2xl border px-2 py-4 text-center ${isActive ? "border-primary/30 bg-primary/10 text-primary" : "border-border/60 bg-white text-muted-foreground"}`}
                      data-testid={`link-more-${item.href}`}
                    >
                      <item.icon className="h-5 w-5" />
                      <span className="text-[11px] font-bold">{item.label}</span>
                    </a>
                  </Link>
                );
              })}
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
