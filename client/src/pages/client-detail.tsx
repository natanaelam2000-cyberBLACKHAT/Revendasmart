import { useState, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { Installment } from "@/lib/mock-data";
import { useProductsData } from "@/hooks/useProductsData";
import { useClientDetailData } from "@/hooks/useClientDetailData";
import { Layout } from "@/components/layout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { Activity, AlertTriangle, BarChart3, Calendar, ChevronLeft, Clock, Heart, MessageSquare, Phone, ShoppingBag, Star, UserRound } from "lucide-react";
import { format } from "date-fns";
import { calculateClientCrmMetrics, filterClientSales, type ClientClassificationTone, type ClientPreferenceItem } from "@/lib/client-metrics";

const currency = (value: number) => `R$ ${value.toFixed(2)}`;
const formatDate = (date: Date | null) => date ? format(date, "dd/MM/yyyy") : "Sem registro";

const classificationClasses: Record<ClientClassificationTone, string> = {
  blue: "bg-blue-50 text-blue-700 border-blue-100",
  green: "bg-green-50 text-green-700 border-green-100",
  purple: "bg-purple-50 text-purple-700 border-purple-100",
  amber: "bg-amber-50 text-amber-700 border-amber-100",
};

const behaviorClasses = {
  blue: "bg-blue-50 text-blue-700 border-blue-100",
  green: "bg-green-50 text-green-700 border-green-100",
  purple: "bg-purple-50 text-purple-700 border-purple-100",
  amber: "bg-amber-50 text-amber-700 border-amber-100",
};

function MetricCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-white rounded-3xl border border-border/50 p-4 shadow-sm min-h-[104px]">
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{label}</p>
      <p className="mt-2 text-lg font-black text-foreground leading-tight">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground leading-snug">{hint}</p>}
    </div>
  );
}

function PreferenceList({ title, items }: { title: string; items: ClientPreferenceItem[] }) {
  return (
    <div className="bg-white rounded-[2rem] border border-border/50 p-5 shadow-sm">
      <h3 className="text-sm font-bold flex items-center gap-2 mb-4"><Heart className="w-4 h-4 text-primary" /> {title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">Ainda não há dados suficientes.</p>
      ) : (
        <div className="space-y-3">
          {items.map(item => (
            <div key={item.label} className="flex items-center justify-between gap-3 rounded-2xl bg-secondary/30 px-3 py-2">
              <div className="min-w-0"><p className="text-xs font-bold truncate">{item.label}</p><p className="text-[10px] text-muted-foreground">{item.quantity} unidade(s)</p></div>
              <p className="text-xs font-black text-primary whitespace-nowrap">{currency(item.revenue)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BehaviorSummary({ items }: { items: Array<{ title: string; description: string; tone: keyof typeof behaviorClasses }> }) {
  return (
    <div className="bg-white rounded-[2rem] border border-border/50 p-5 shadow-sm mb-8">
      <h3 className="text-sm font-bold flex items-center gap-2 mb-4"><Activity className="w-4 h-4 text-primary" /> Resumo de comportamento</h3>
      <div className="grid sm:grid-cols-2 gap-3">
        {items.map(item => (
          <div key={item.title} className={`rounded-2xl border px-4 py-3 ${behaviorClasses[item.tone]}`}>
            <p className="text-xs font-black">{item.title}</p>
            <p className="mt-1 text-[11px] font-semibold opacity-80">{item.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ClientDetail() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { client, sales, loading: clientDataLoading } = useClientDetailData(id);
  const { products, loading: productsLoading } = useProductsData();
  const [billings] = useState<Installment[]>([]);

  const productById = useMemo(() => new Map(products.map(product => [product.id, product])), [products]);
  const clientSales = useMemo(() => filterClientSales(sales, id), [sales, id]);
  const crm = useMemo(() => calculateClientCrmMetrics(clientSales, productById), [clientSales, productById]);
  const clientBillings = useMemo(() => billings.filter(b => b.clientId === id), [billings, id]);
  const totalDebt = useMemo(() => clientBillings.filter(b => b.status !== "paid").reduce((a, b) => a + (b.amount - b.paidAmount), 0), [clientBillings]);
  const maxMonthlyEvolutionTotal = useMemo(() => Math.max(...crm.monthlyEvolution.map(month => month.total), 1), [crm.monthlyEvolution]);

  if (clientDataLoading || productsLoading) return <Layout><PageSkeleton variant="list" count={3} /></Layout>;
  if (!client) return (
    <Layout>
      <div className="px-4 sm:px-6 lg:px-8 py-6 pb-32 max-w-4xl mx-auto">
        <EmptyState icon={<UserRound className="w-12 h-12 text-muted-foreground/30" />} title="Cliente não encontrado" description="Não encontramos esse cadastro. Volte para a lista e confira os clientes disponíveis." action={<button onClick={() => setLocation("/clients")} className="rs-pressable w-full rounded-2xl bg-primary px-5 py-3 text-xs font-bold uppercase text-white">Voltar para clientes</button>} />
      </div>
    </Layout>
  );

  const sendWhatsApp = (msg: string) => window.open(`https://wa.me/${client.phone}?text=${encodeURIComponent(msg)}`, "_blank");

  return (
    <Layout>
      <div className="px-4 sm:px-6 lg:px-8 py-6 pb-32 max-w-5xl mx-auto">
        <button onClick={() => setLocation("/clients")} className="flex items-center gap-2 text-muted-foreground mb-6 font-medium"><ChevronLeft className="w-4 h-4" /> Voltar</button>

        <div className="bg-white p-6 rounded-[2.5rem] border border-border/50 shadow-sm mb-6">
          <div className="flex items-start gap-4 mb-4">
            <div className="w-16 h-16 bg-primary/10 rounded-3xl flex items-center justify-center text-primary text-2xl font-bold shrink-0">{client.name.charAt(0)}</div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
                <h2 className="text-xl font-bold truncate">{client.name}</h2>
                <span className={`w-fit rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-wide ${classificationClasses[crm.classification.tone]}`}>{crm.classification.label}</span>
              </div>
              <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1"><Phone className="w-3 h-3" /> {client.phone}</p>
              <p className="text-xs text-muted-foreground mt-2">{crm.classification.description}</p>
            </div>
          </div>
          {client.notes && <p className="text-xs text-muted-foreground italic mb-4 bg-secondary/30 p-3 rounded-2xl">"{client.notes}"</p>}
          <div className="grid grid-cols-2 gap-4">
            <button onClick={() => sendWhatsApp(`Olá ${client.name}! Como estão seus produtos? Precisando de reposição? ✨`)} className="rs-pressable flex min-h-12 items-center justify-center gap-2 bg-[#25D366] text-white py-3 rounded-2xl text-xs font-bold"><MessageSquare className="w-4 h-4" /> WhatsApp</button>
            <button onClick={() => setLocation("/sale")} className="rs-pressable flex min-h-12 items-center justify-center gap-2 bg-primary text-white py-3 rounded-2xl text-xs font-bold"><ShoppingBag className="w-4 h-4" /> Nova Venda</button>
          </div>
        </div>

        {crm.classification.isInactive && (
          <div className="mb-6 rounded-[2rem] border border-amber-200 bg-amber-50 p-5 text-amber-900 shadow-sm">
            <div className="flex items-start gap-3"><AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" /><div><p className="text-sm font-black">Cliente inativo</p><p className="text-xs leading-relaxed mt-1">Este cliente está sem comprar há mais de 60 dias. Vale chamar no WhatsApp com uma oferta ou reposição.</p></div></div>
          </div>
        )}

        <section className="bg-white rounded-[2rem] border border-border/50 p-5 shadow-sm mb-6">
          <div className="mb-4 flex items-center gap-2"><Star className="w-4 h-4 text-primary" /><h3 className="text-sm font-black">Resumo do cliente</h3></div>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <MetricCard label="Cliente desde" value={formatDate(crm.summary.firstPurchaseDate)} />
            <MetricCard label="Última compra" value={formatDate(crm.summary.lastPurchaseDate)} />
            <MetricCard label="Ticket médio" value={currency(crm.summary.averageTicket)} />
            <MetricCard label="Total gasto" value={currency(crm.summary.totalSpent)} />
            <MetricCard label="Compras" value={String(crm.summary.purchaseCount)} />
          </div>
        </section>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <MetricCard label="Total gasto" value={currency(crm.summary.totalSpent)} />
          <MetricCard label="Ticket médio" value={currency(crm.summary.averageTicket)} />
          <MetricCard label="Compras" value={String(crm.summary.purchaseCount)} />
          <MetricCard label="Dias sem comprar" value={crm.summary.daysWithoutPurchase === null ? "Sem histórico" : String(crm.summary.daysWithoutPurchase)} />
          <MetricCard label="Primeira compra" value={formatDate(crm.summary.firstPurchaseDate)} />
          <MetricCard label="Última compra" value={formatDate(crm.summary.lastPurchaseDate)} />
          <MetricCard label="Maior compra" value={crm.summary.biggestPurchase ? currency(crm.summary.biggestPurchase.totalPrice) : "Sem registro"} />
          <MetricCard label="Menor compra" value={crm.summary.smallestPurchase ? currency(crm.summary.smallestPurchase.totalPrice) : "Sem registro"} />
        </div>

        <div className="bg-destructive/5 border border-destructive/10 p-6 rounded-[2.5rem] mb-8">
          <p className="text-[10px] font-bold text-destructive uppercase tracking-widest mb-1">Saldo Devedor</p>
          <div className="flex items-end justify-between gap-4"><h3 className="text-3xl font-black text-destructive">{currency(totalDebt)}</h3><button onClick={() => sendWhatsApp(`Olá ${client.name}, passando para lembrar do seu saldo pendente de ${currency(totalDebt)}. Como podemos acertar? 😊`)} className="rs-pressable text-[10px] font-bold bg-destructive text-white px-3 py-2 rounded-full uppercase">Cobrar</button></div>
        </div>

        <div className="grid lg:grid-cols-3 gap-5 mb-8"><PreferenceList title="Produtos favoritos" items={crm.favoriteProducts} /><PreferenceList title="Categorias favoritas" items={crm.favoriteCategories} /><PreferenceList title="Marcas favoritas" items={crm.favoriteBrands} /></div>

        <BehaviorSummary items={crm.behaviorSummary} />

        <div className="bg-white rounded-[2rem] border border-border/50 p-5 shadow-sm mb-8">
          <h3 className="text-sm font-bold flex items-center gap-2 mb-4"><BarChart3 className="w-4 h-4 text-primary" /> Evolução mensal</h3>
          {crm.monthlyEvolution.length === 0 ? <p className="text-xs text-muted-foreground">Ainda não há compras suficientes para montar a evolução.</p> : (
            <div className="space-y-3">
              {crm.monthlyEvolution.map(item => {
                const width = Math.max(8, Math.round((item.total / maxMonthlyEvolutionTotal) * 100));
                return <div key={item.monthKey}><div className="mb-1 flex items-center justify-between text-xs"><span className="font-bold capitalize">{item.monthLabel}</span><span className="text-muted-foreground">{currency(item.total)} · {item.purchases} compra(s)</span></div><div className="h-2 rounded-full bg-secondary overflow-hidden"><div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} /></div></div>;
              })}
            </div>
          )}
        </div>

        <div className="space-y-8">
          <div>
            <h3 className="text-sm font-bold flex items-center gap-2 mb-4"><Calendar className="w-4 h-4 text-primary" /> Timeline de Compras</h3>
            <div className="space-y-5">
              {crm.timelineByMonth.map((group) => (
                <div key={group.monthKey} className="space-y-3">
                  <div className="sticky top-16 z-10 w-fit rounded-full bg-primary/10 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-primary backdrop-blur capitalize">{group.monthLabel}</div>
                  {group.items.map((item, index) => (
                    <div key={item.sale.id} className="bg-white p-4 rounded-3xl border border-border/40 shadow-sm">
                      <div className="flex justify-between items-start gap-3 mb-3"><div><span className="text-[10px] font-bold text-muted-foreground uppercase">{item.date ? format(item.date, "dd 'de' MMMM 'de' yyyy") : "Data indisponível"}</span><p className="mt-1 text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> Compra #{crm.timeline.length - index}</p></div><span className="text-base font-black text-primary">{currency(item.sale.totalPrice)}</span></div>
                      <div className="flex flex-wrap gap-1.5">{item.products.map(product => <span key={`${item.sale.id}-${product.productId}`} className="text-[10px] bg-secondary px-2 py-1 rounded-full">{product.name} ({product.quantity}x)</span>)}</div>
                    </div>
                  ))}
                </div>
              ))}
              {crm.timeline.length === 0 && <EmptyState icon={<Calendar className="w-12 h-12 text-muted-foreground/30" />} title="Nenhuma compra registrada" description="Quando este cliente comprar, o histórico aparecerá aqui com os produtos e valores." action={<button onClick={() => setLocation("/sale")} className="rs-pressable w-full rounded-2xl bg-primary px-5 py-3 text-xs font-bold uppercase text-white">Registrar venda</button>} className="py-10" />}
            </div>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard label="Perfil" value={crm.classification.label} hint="Classificação automática" />
          <MetricCard label="Preferência" value={crm.favoriteCategories[0]?.label || "Sem dados"} hint="Categoria mais comprada" />
          <MetricCard label="Marca top" value={crm.favoriteBrands[0]?.label || "Sem dados"} hint="Marca mais comprada" />
          <MetricCard label="Melhor compra" value={crm.summary.biggestPurchase ? currency(crm.summary.biggestPurchase.totalPrice) : "Sem dados"} hint="Maior pedido registrado" />
        </div>
      </div>
    </Layout>
  );
}
