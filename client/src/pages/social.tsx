import { useState } from "react";
import { Layout } from "@/components/layout";
import { initialProducts, Product, getStored, saveStored, STORAGE_KEYS, ScheduledPost } from "@/lib/mock-data";
import { Calendar, Share2, Instagram, Facebook, MessageSquare, Plus, Trash2, Tag, Gift, Sparkles, Heart } from "lucide-react";
import { format, parseISO } from "date-fns";

export default function Social() {
  const [products] = useState<Product[]>(() => getStored(STORAGE_KEYS.PRODUCTS, initialProducts));
  const [posts, setPosts] = useState<ScheduledPost[]>(() => getStored(STORAGE_KEYS.POSTS, []));
  const [showAdd, setShowAdd] = useState(false);
  const [showMarketing, setShowMarketing] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [marketingType, setMarketingType] = useState<'promo' | 'kit' | 'new' | 'tip' | 'last'>('promo');
  
  const [newPost, setNewPost] = useState({
    productId: '',
    content: '',
    scheduledDate: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    platform: 'whatsapp' as const
  });

  const marketingTemplates = {
    promo: { label: 'Promoção', icon: Tag, text: (p: Product) => `🔥 PROMOÇÃO IMPERDÍVEL!\n\n${p.name} de R$ ${p.salePrice.toFixed(2)} por apenas R$ ${(p.salePrice * 0.85).toFixed(2)}! 😱\n\nGaranta o seu antes que acabe!` },
    last: { label: 'Últimas Unidades', icon: Alerter, text: (p: Product) => `🚨 CORRE QUE ESTÁ ACABANDO!\n\nÚltimas unidades de ${p.name} em estoque. Apenas R$ ${p.salePrice.toFixed(2)}. ⏳` },
    kit: { label: 'Kit Especial', icon: Gift, text: (p: Product) => `🎁 MONTE SEU KIT!\n\n${p.name} + Sabonete Especial por um preço incrível. Fale comigo e monte seu presente! 🎀` },
    new: { label: 'Novidade', icon: Sparkles, text: (p: Product) => `✨ CHEGOU NOVIDADE!\n\nAcabamos de receber o novo ${p.name}. Você vai amar a fragrância! 🌸` },
    tip: { label: 'Dica de Beleza', icon: Heart, text: (p: Product) => `💡 DICA DE HOJE:\n\nSabia que o ${p.name} dura muito mais se aplicado logo após o banho? Aproveite que tenho a pronta entrega! 🧴` }
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPost.productId) return;
    const product = products.find(p => p.id === newPost.productId);
    const post: ScheduledPost = {
      id: Math.random().toString(36).substr(2, 9),
      productId: newPost.productId,
      content: newPost.content || `Olha essa novidade! 💖\n\n${product?.name}\nPor apenas R$ ${product?.salePrice.toFixed(2)}\n\nPeça o seu agora! ✨`,
      scheduledDate: new Date(newPost.scheduledDate).toISOString(),
      platform: newPost.platform,
      status: 'pending'
    };
    const updated = [post, ...posts];
    setPosts(updated);
    saveStored(STORAGE_KEYS.POSTS, updated);
    setShowAdd(false);
  };

  const handlePostNow = (content: string) => {
    window.open(`https://wa.me/?text=${encodeURIComponent(content)}`, '_blank');
  };

  return (
    <Layout title="Marketing & Social">
      <div className="p-6 pb-32">
        <div className="grid grid-cols-2 gap-4 mb-8">
          <button onClick={() => setShowAdd(true)} className="bg-primary text-white p-6 rounded-[2rem] shadow-lg shadow-primary/20 flex flex-col items-center gap-2 active:scale-95 transition-all">
            <Calendar className="w-8 h-8" />
            <span className="text-[10px] font-black uppercase">Agendar Post</span>
          </button>
          <button onClick={() => setShowMarketing(true)} className="bg-foreground text-white p-6 rounded-[2rem] shadow-xl flex flex-col items-center gap-2 active:scale-95 transition-all">
            <Sparkles className="w-8 h-8 text-primary" />
            <span className="text-[10px] font-black uppercase">Criar Promo</span>
          </button>
        </div>

        <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-4">Agenda de Posts</h3>
        <div className="space-y-4">
          {posts.filter(p => p.status === 'pending').map(post => {
            const product = products.find(p => p.id === post.productId);
            return (
              <div key={post.id} className="bg-white p-4 rounded-3xl border border-border/50 shadow-sm">
                <div className="flex gap-4 mb-4">
                  <div className="w-16 h-16 bg-secondary rounded-2xl overflow-hidden">
                    <img src={product?.imageUrl} className="w-full h-full object-cover mix-blend-multiply" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[9px] font-black text-primary uppercase mb-1">{format(parseISO(post.scheduledDate), 'dd/MM HH:mm')}</p>
                    <p className="text-xs font-medium line-clamp-2">{post.content}</p>
                  </div>
                </div>
                <button onClick={() => handlePostNow(post.content)} className="w-full bg-secondary text-primary font-black py-3 rounded-2xl text-[10px] uppercase tracking-wider flex items-center justify-center gap-2">
                   <Share2 className="w-4 h-4" /> Postar Agora
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {showMarketing && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-md mx-auto rounded-t-[2.5rem] p-8 animate-in slide-in-from-bottom-10">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">Gerador de Promo</h2>
              <button onClick={() => setShowMarketing(false)} className="text-sm font-medium text-muted-foreground">Fechar</button>
            </div>
            
            <div className="space-y-6">
              <select 
                className="w-full bg-secondary/50 border-none rounded-2xl p-4 text-sm"
                onChange={e => setSelectedProduct(products.find(p => p.id === e.target.value) || null)}
              >
                <option value="">Selecione o produto...</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>

              <div className="grid grid-cols-5 gap-2">
                {Object.entries(marketingTemplates).map(([key, t]) => (
                  <button 
                    key={key} 
                    onClick={() => setMarketingType(key as any)}
                    className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${marketingType === key ? 'bg-primary text-white' : 'bg-secondary text-muted-foreground'}`}
                  >
                    <t.icon className="w-4 h-4" />
                    <span className="text-[8px] font-bold text-center leading-tight uppercase">{t.label}</span>
                  </button>
                ))}
              </div>

              {selectedProduct && (
                <div className="bg-white border-2 border-primary/20 rounded-[2rem] p-6 relative overflow-hidden group">
                   <div className="absolute top-4 right-4 bg-primary text-white text-[10px] font-black px-3 py-1 rounded-full uppercase shadow-lg z-10">
                      {marketingTemplates[marketingType].label}
                   </div>
                   <div className="w-40 h-40 bg-secondary/30 rounded-3xl mx-auto mb-4 overflow-hidden p-4">
                      <img src={selectedProduct.imageUrl} className="w-full h-full object-contain mix-blend-multiply" />
                   </div>
                   <div className="text-center">
                      <h4 className="font-bold text-lg leading-tight mb-2">{selectedProduct.name}</h4>
                      <p className="text-2xl font-black text-primary">R$ {marketingType === 'promo' ? (selectedProduct.salePrice * 0.85).toFixed(2) : selectedProduct.salePrice.toFixed(2)}</p>
                   </div>
                </div>
              )}

              <button 
                disabled={!selectedProduct}
                onClick={() => handlePostNow(marketingTemplates[marketingType].text(selectedProduct!))}
                className="w-full bg-primary text-white font-black py-4 rounded-2xl shadow-lg disabled:opacity-50 uppercase tracking-widest text-xs"
              >
                Compartilhar no WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end animate-in fade-in duration-300">
           <div className="bg-white w-full max-w-md mx-auto rounded-t-[2.5rem] p-8 animate-in slide-in-from-bottom-10 max-h-[85vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold">Agendar Post</h2>
                <button onClick={() => setShowAdd(false)} className="text-sm font-medium text-muted-foreground">Fechar</button>
              </div>
              <form onSubmit={handleAdd} className="space-y-4">
                <select required className="w-full bg-secondary/50 border-none rounded-2xl p-4 text-sm" value={newPost.productId} onChange={e => setNewPost({...newPost, productId: e.target.value})}>
                  <option value="">Produto...</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input type="datetime-local" className="w-full bg-secondary/50 border-none rounded-2xl p-4 text-sm" value={newPost.scheduledDate} onChange={e => setNewPost({...newPost, scheduledDate: e.target.value})} />
                <textarea placeholder="Texto do post..." className="w-full bg-secondary/50 border-none rounded-2xl p-4 text-sm h-32" value={newPost.content} onChange={e => setNewPost({...newPost, content: e.target.value})} />
                <button type="submit" className="w-full bg-primary text-white font-black py-4 rounded-2xl shadow-lg uppercase">Salvar Agenda</button>
              </form>
           </div>
        </div>
      )}
    </Layout>
  );
}

function Alerter(props: any) {
  return <AlertCircle {...props} />;
}
import { AlertCircle } from "lucide-react";
