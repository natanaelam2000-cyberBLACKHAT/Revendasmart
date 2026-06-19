import { useMemo } from "react";
import { Link, useLocation } from "wouter";
import { getCurrentFirebaseUser } from "@/lib/firebase";
import { Home, Package, BookOpen, Megaphone, User, ShoppingCart } from "lucide-react";
interface LayoutProps { children: React.ReactNode; title?: string; hideBottomNav?: boolean; }
export function Layout({ children, title, hideBottomNav = false }: LayoutProps) {
  const [location] = useLocation();
  const email = useMemo(() => { try { return getCurrentFirebaseUser()?.email || null; } catch { return null; } }, []);
  const items = [{href:"/",icon:Home,label:"Início"},{href:"/products",icon:Package,label:"Produtos"},{href:"/sale",icon:ShoppingCart,label:"Vendas"},{href:"/catalog",icon:BookOpen,label:"Catálogo"},{href:"/marketing",icon:Megaphone,label:"Anúncios"},{href:"/settings",icon:User,label:"Conta"}];
  const active=(href:string)=>href==="/"?location==="/":location.startsWith(href)||(href==="/settings"&&location==="/subscribe");
  return <div className="min-h-screen bg-slate-50 text-foreground">
    {!hideBottomNav&&<aside className="hidden lg:flex fixed inset-y-0 left-0 z-50 w-64 flex-col bg-white border-r border-border/60 px-5 py-7">
      <Link href="/"><div className="flex items-center gap-3 px-2 mb-9 cursor-pointer"><div className="w-11 h-11 rounded-2xl bg-primary text-white flex items-center justify-center font-black shadow-lg shadow-primary/20">R</div><div><p className="font-black text-lg leading-none">RevendaSmart</p><p className="text-[10px] text-muted-foreground mt-1">Gestão para revendedoras</p></div></div></Link>
      <nav className="space-y-2">{items.map(item=><Link key={item.href} href={item.href}><div className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl cursor-pointer transition-colors ${active(item.href)?"bg-primary text-white shadow-md shadow-primary/15":"text-muted-foreground hover:bg-secondary/60 hover:text-foreground"}`}><item.icon className="w-5 h-5"/><span className="text-sm font-bold">{item.label}</span></div></Link>)}</nav>
      <div className="mt-auto flex items-center gap-3 p-3 rounded-2xl bg-secondary/40"><div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center text-sm font-black">{email?.charAt(0).toUpperCase()||"U"}</div><div className="min-w-0"><p className="text-xs font-bold truncate">{email?.split("@")[0]||"Usuário"}</p><p className="text-[9px] text-muted-foreground truncate">{email||""}</p></div></div>
    </aside>}
    <div className={!hideBottomNav?"lg:pl-64":""}><div className="min-h-screen w-full max-w-[1200px] mx-auto bg-background lg:bg-transparent pb-24 lg:pb-8">{title&&<header className="px-4 sm:px-6 lg:px-8 pt-6 pb-4 bg-white/95 lg:bg-transparent sticky top-0 z-40 border-b lg:border-b-0 border-border/50 backdrop-blur"><h1 className="text-xl lg:text-2xl font-black">{title}</h1></header>}<main className="min-w-0">{children}</main></div></div>
    {!hideBottomNav&&<nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-xl border-t border-border/70 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-8px_30px_rgba(15,23,42,0.08)]"><div className="max-w-xl mx-auto grid grid-cols-6 gap-0.5">{items.map(item=><Link key={item.href} href={item.href}><div className={`min-w-0 flex flex-col items-center justify-center gap-1 py-2 rounded-xl cursor-pointer ${active(item.href)?"text-primary bg-primary/5":"text-muted-foreground"}`}><item.icon className="w-5 h-5"/><span className="text-[10px] font-bold leading-none truncate w-full text-center">{item.label}</span></div></Link>)}</div></nav>}
  </div>;
}