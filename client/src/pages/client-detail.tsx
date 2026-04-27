import { useState, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { getStored, STORAGE_KEYS, Client, Sale, Installment, initialClients, initialProducts, Product } from "@/lib/mock-data";
import { Layout } from "@/components/layout";
import { Phone, MessageSquare, ShoppingBag, Receipt, ChevronLeft, Calendar } from "lucide-react";
import { format, parseISO } from "date-fns";

export default function ClientDetail() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const [clients] = useState<Client[]>(() => getStored(STORAGE_KEYS.CLIENTS, initialClients));
  const [sales] = useState<Sale[]>(() => getStored(STORAGE_KEYS.SALES, []));
  const [billings] = useState<Installment[]>(() => getStored(STORAGE_KEYS.INSTALLMENTS, []));
  const [products] = useState<Product[]>(() => getStored(STORAGE_KEYS.PRODUCTS, initialProducts));

  const client = clients.find(c => c.id === id);
  
  const clientSales = useMemo(() => sales.filter(s => s.clientId === id), [sales, id]);
  const clientBillings = useMemo(() => billings.filter(b => b.clientId === id), [billings, id]);
  const totalDebt = useMemo(() => clientBillings.filter(b => b.status !== 'paid').reduce((a, b) => a + (b.amount - b.paidAmount), 0), [clientBillings]);

  if (!client) return <Layout>Cliente não encontrado</Layout>;

  const sendWhatsApp = (msg: string) => {
    window.open(`https://wa.me/${client.phone}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  return (
    <Layout>
      <div className="p-6 pb-32">
        <button onClick={() => setLocation("/clients")} className="flex items-center gap-2 text-muted-foreground mb-6 font-medium">
          <ChevronLeft className="w-4 h-4" /> Voltar
        </button>

        <div className="bg-white p-6 rounded-[2.5rem] border border-border/50 shadow-sm mb-6">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-16 h-16 bg-primary/10 rounded-3xl flex items-center justify-center text-primary text-2xl font-bold">
              {client.name.charAt(0)}
            </div>
            <div>
              <h2 className="text-xl font-bold">{client.name}</h2>
              <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                <Phone className="w-3 h-3" /> {client.phone}
              </p>
            </div>
          </div>
          {client.notes && <p className="text-xs text-muted-foreground italic mb-4 bg-secondary/30 p-3 rounded-2xl">"{client.notes}"</p>}
          
          <div className="grid grid-cols-2 gap-4">
            <button 
              onClick={() => sendWhatsApp(`Olá ${client.name}! Como estão seus produtos? Precisando de reposição? ✨`)}
              className="flex items-center justify-center gap-2 bg-[#25D366] text-white py-3 rounded-2xl text-xs font-bold"
            >
              <MessageSquare className="w-4 h-4" /> WhatsApp
            </button>
            <button 
              onClick={() => setLocation("/sale")}
              className="flex items-center justify-center gap-2 bg-primary text-white py-3 rounded-2xl text-xs font-bold"
            >
              <ShoppingBag className="w-4 h-4" /> Nova Venda
            </button>
          </div>
        </div>

        <div className="bg-destructive/5 border border-destructive/10 p-6 rounded-[2.5rem] mb-8">
          <p className="text-[10px] font-bold text-destructive uppercase tracking-widest mb-1">Saldo Devedor</p>
          <div className="flex items-end justify-between">
            <h3 className="text-3xl font-black text-destructive">R$ {totalDebt.toFixed(2)}</h3>
            <button 
              onClick={() => sendWhatsApp(`Olá ${client.name}, passando para lembrar do seu saldo pendente de R$ ${totalDebt.toFixed(2)}. Como podemos acertar? 😊`)}
              className="text-[10px] font-bold bg-destructive text-white px-3 py-1.5 rounded-full uppercase"
            >
              Cobrar
            </button>
          </div>
        </div>

        <div className="space-y-8">
          <div>
            <h3 className="text-sm font-bold flex items-center gap-2 mb-4">
              <Calendar className="w-4 h-4 text-primary" /> Histórico de Compras
            </h3>
            <div className="space-y-3">
              {clientSales.map(sale => (
                <div key={sale.id} className="bg-white p-4 rounded-3xl border border-border/40 shadow-sm">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase">{format(parseISO(sale.date), 'dd/MM/yyyy')}</span>
                    <span className="text-sm font-bold">R$ {sale.totalPrice.toFixed(2)}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {sale.products.map((p, i) => (
                      <span key={i} className="text-[10px] bg-secondary px-2 py-0.5 rounded-full">
                        {products.find(prod => prod.id === p.productId)?.name || 'Produto'} ({p.quantity}x)
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              {clientSales.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Nenhuma compra registrada.</p>}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
