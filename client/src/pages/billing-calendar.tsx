import { useState, useMemo } from "react";
import { Layout } from "@/components/layout";
import { getStored, STORAGE_KEYS, Installment, Client, initialClients } from "@/lib/mock-data";
import { format, isToday, isTomorrow, isBefore, isAfter, parseISO, startOfDay, addDays, ptBR } from "@/lib/date-utils";
import { Calendar as CalendarIcon, ChevronRight, AlertCircle, CheckCircle, Clock } from "lucide-react";
import { useLocation } from "wouter";
import { formatCurrency } from "@/lib/product-pricing";

export default function BillingCalendar() {
  const [billings] = useState<Installment[]>(() => getStored(STORAGE_KEYS.INSTALLMENTS, []));
  const [clients] = useState<Client[]>(() => getStored(STORAGE_KEYS.CLIENTS, initialClients));
  const [, setLocation] = useLocation();

  const getClient = (id: string) => clients.find(c => c.id === id);

  const groups = useMemo(() => {
    const today = startOfDay(new Date());
    const tomorrow = addDays(today, 1);
    
    const result = {
      atrasados: [] as Installment[],
      hoje: [] as Installment[],
      amanha: [] as Installment[],
      proximos: [] as Installment[]
    };

    billings.forEach(b => {
      if (!b.dueDate) return;
      try {
        const date = startOfDay(parseISO(b.dueDate));
        if (b.status === 'paid') return;

        if (isBefore(date, today)) {
          result.atrasados.push(b);
        } else if (isToday(date)) {
          result.hoje.push(b);
        } else if (isTomorrow(date)) {
          result.amanha.push(b);
        } else {
          result.proximos.push(b);
        }
      } catch (e) {
        console.error("Invalid date", b.dueDate);
      }
    });

    // Sort each group by date
    Object.keys(result).forEach(key => {
      result[key as keyof typeof result].sort((a, b) => 
        parseISO(a.dueDate).getTime() - parseISO(b.dueDate).getTime()
      );
    });

    return result;
  }, [billings]);

  const GroupSection = ({ title, items, icon: Icon, colorClass }: any) => {
    if (items.length === 0) return null;

    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 px-1">
          <Icon className={`w-4 h-4 ${colorClass}`} />
          <h2 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{title}</h2>
          <span className="ml-auto bg-secondary text-muted-foreground text-[10px] font-bold px-2 py-0.5 rounded-full">
            {items.length}
          </span>
        </div>
        <div className="space-y-3">
          {items.map((item: Installment) => {
            const client = getClient(item.clientId);
            return (
              <button
                key={item.id}
                onClick={() => setLocation(`/billings?id=${item.id}`)}
                className="w-full bg-white p-4 rounded-3xl border border-border/50 shadow-sm flex items-center gap-4 text-left active:scale-[0.98] transition-all"
              >
                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 ${item.status === 'partial' ? 'bg-blue-50 text-blue-500' : 'bg-secondary text-muted-foreground'}`}>
                  <Clock className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate">{client?.name || "Desconhecido"}</p>
                  <p className="text-[10px] text-muted-foreground font-medium uppercase">
                    {format(parseISO(item.dueDate), "dd 'de' MMMM", { locale: ptBR })}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-black text-foreground">{formatCurrency(item.amount - item.paidAmount)}</p>
                  {item.status === 'partial' && <p className="text-[9px] text-blue-500 font-bold uppercase">Parcial</p>}
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground/30" />
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <Layout title="Agenda">
      <div className="p-6 space-y-8 pb-32">
        <div className="bg-primary/5 p-6 rounded-[2.5rem] border border-primary/10 flex items-center gap-4">
          <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center text-primary">
            <CalendarIcon className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight">Agenda de Cobranças</h1>
            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Visualize seus recebíveis</p>
          </div>
        </div>

        <div className="space-y-8">
          <GroupSection 
            title="Atrasados" 
            items={groups.atrasados} 
            icon={AlertCircle} 
            colorClass="text-destructive" 
          />
          <GroupSection 
            title="Hoje" 
            items={groups.hoje} 
            icon={Clock} 
            colorClass="text-primary" 
          />
          <GroupSection 
            title="Amanhã" 
            items={groups.amanha} 
            icon={CalendarIcon} 
            colorClass="text-orange-500" 
          />
          <GroupSection 
            title="Próximos Dias" 
            items={groups.proximos} 
            icon={CalendarIcon} 
            colorClass="text-muted-foreground" 
          />

          {Object.values(groups).every(g => g.length === 0) && (
            <div className="rounded-[2rem] border border-dashed border-border/60 bg-white px-6 py-16 text-center flex flex-col items-center">
              <div className="w-20 h-20 bg-green-50 rounded-[2rem] flex items-center justify-center mb-4">
                <CheckCircle className="w-9 h-9 text-green-500/60" />
              </div>
              <p className="text-sm font-black text-foreground">Nenhuma cobrança pendente</p>
              <p className="mt-2 max-w-[260px] text-xs leading-relaxed text-muted-foreground">Tudo em dia por aqui. Quando houver parcelas a vencer, elas aparecerão neste calendário.</p>
              <button onClick={() => setLocation("/billings")} className="rs-pressable mt-5 rounded-2xl bg-primary px-5 py-3 text-xs font-black uppercase text-white">Criar cobrança</button>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
