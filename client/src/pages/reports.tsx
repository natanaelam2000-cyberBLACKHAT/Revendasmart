import { useState, useMemo } from "react";
import { Layout } from "@/components/layout";
import { getStored, initialProducts, STORAGE_KEYS, Product, Client, initialClients } from "@/lib/mock-data";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, LineChart, Line, Legend
} from "recharts";
import { TrendingUp, Users, AlertCircle, ArrowUpRight, ArrowDownRight, DollarSign } from "lucide-react";
import { differenceInDays, parseISO, format } from "date-fns";

export default function Reports() {
  const [products] = useState<Product[]>(() => getStored(STORAGE_KEYS.PRODUCTS, initialProducts));
  const [clients] = useState<Client[]>(() => getStored(STORAGE_KEYS.CLIENTS, initialClients));
  const [billings] = useState<any[]>(() => getStored(STORAGE_KEYS.INSTALLMENTS, []));

  // 1. Inadimplência & Aging
  const agingData = useMemo(() => {
    const now = new Date();
    const categories = {
      'Em dia': 0,
      'Atraso < 15d': 0,
      'Atraso 15-30d': 0,
      'Atraso > 30d': 0
    };

    billings.forEach(b => {
      if (b.status === 'paid') return;
      const dueDate = parseISO(b.dueDate);
      const diff = differenceInDays(now, dueDate);

      if (diff <= 0) categories['Em dia'] += b.amount;
      else if (diff < 15) categories['Atraso < 15d'] += b.amount;
      else if (diff <= 30) categories['Atraso 15-30d'] += b.amount;
      else categories['Atraso > 30d'] += b.amount;
    });

    return Object.entries(categories).map(([name, value]) => ({ name, value }));
  }, [billings]);

  // 2. Ranking Clientes (por volume de dívida/compras)
  const clientRanking = useMemo(() => {
    const map: Record<string, number> = {};
    billings.forEach(b => {
      map[b.clientId] = (map[b.clientId] || 0) + b.amount;
    });
    return Object.entries(map)
      .map(([id, total]) => ({
        name: clients.find(c => c.id === id)?.name || 'Desconhecido',
        total
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [billings, clients]);

  // 3. Margem por Produto
  const marginData = useMemo(() => {
    return products.map(p => ({
      name: p.name.substring(0, 15) + '...',
      margin: ((p.salePrice - p.costPrice) / p.salePrice) * 100
    })).sort((a, b) => b.margin - a.margin).slice(0, 5);
  }, [products]);

  const COLORS = ['#ec4899', '#f43f5e', '#fb7185', '#fda4af', '#e11d48'];

  return (
    <Layout title="Relatórios Avançados">
      <div className="p-6 space-y-8">
        {/* Quick Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white p-4 rounded-3xl border border-border/50 shadow-sm">
            <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Inadimplência</p>
            <div className="flex items-end gap-2">
              <span className="text-xl font-black text-destructive">
                R$ {agingData.filter(d => d.name !== 'Em dia').reduce((a, b) => a + b.value, 0).toFixed(0)}
              </span>
              <span className="text-[10px] text-destructive flex items-center mb-1 font-bold">
                <ArrowUpRight className="w-3 h-3" /> 12%
              </span>
            </div>
          </div>
          <div className="bg-white p-4 rounded-3xl border border-border/50 shadow-sm">
            <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Margem Média</p>
            <div className="flex items-end gap-2">
              <span className="text-xl font-black text-green-600">38%</span>
              <span className="text-[10px] text-green-600 flex items-center mb-1 font-bold">
                <ArrowDownRight className="w-3 h-3" /> 2%
              </span>
            </div>
          </div>
        </div>

        {/* Aging de Cobrança */}
        <div className="bg-white p-6 rounded-[2.5rem] border border-border/50 shadow-sm">
          <h3 className="text-sm font-bold mb-6 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-primary" /> Aging de Cobrança
          </h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={agingData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {agingData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend verticalAlign="bottom" height={36} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Ranking Clientes */}
        <div className="bg-white p-6 rounded-[2.5rem] border border-border/50 shadow-sm">
          <h3 className="text-sm font-bold mb-6 flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" /> Ranking de Compras (R$)
          </h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={clientRanking} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" width={80} style={{ fontSize: '10px' }} />
                <Tooltip />
                <Bar dataKey="total" fill="#ec4899" radius={[0, 10, 10, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Margem por Produto */}
        <div className="bg-white p-6 rounded-[2.5rem] border border-border/50 shadow-sm">
          <h3 className="text-sm font-bold mb-6 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" /> Top Margem (%)
          </h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={marginData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" hide />
                <YAxis style={{ fontSize: '10px' }} />
                <Tooltip />
                <Line type="monotone" dataKey="margin" stroke="#ec4899" strokeWidth={3} dot={{ r: 6, fill: '#ec4899' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </Layout>
  );
}
