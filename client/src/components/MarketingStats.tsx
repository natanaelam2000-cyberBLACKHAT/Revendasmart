import type { MarketingHistoryEntry } from "@/hooks/useMarketingHistory";
export function MarketingStats({entries}:{entries:MarketingHistoryEntry[]}){
 const count=(action:string)=>entries.filter(item=>item.action===action).length;
 const shares=entries.filter(item=>item.action==="shared");
 const sharedCounts=shares.reduce<Record<string,number>>((acc,item)=>{acc[item.productName]=(acc[item.productName]||0)+1;return acc;},{});
 const mostShared=Object.entries(sharedCounts).sort((a,b)=>b[1]-a[1])[0]?.[0]||"Ainda sem dados";
 const stats=[["Cards gerados",count("generated")],["Cards baixados",count("downloaded")],["Compartilhamentos",count("shared")],["Anúncios copiados",count("copied")]];
 return <div className="space-y-3"><div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{stats.map(([label,value])=><div key={String(label)} className="rounded-2xl border border-border/50 bg-white p-4 shadow-sm"><p className="text-[9px] font-black uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-black text-primary">{value}</p></div>)}</div><div className="rounded-2xl border border-primary/10 bg-primary/5 p-4"><p className="text-[9px] font-black uppercase tracking-wider text-primary">Produto mais compartilhado</p><p className="mt-1 truncate text-sm font-black">{mostShared}</p></div></div>;
}
