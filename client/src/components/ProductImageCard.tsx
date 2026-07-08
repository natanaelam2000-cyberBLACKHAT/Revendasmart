import { memo, useEffect, useState } from "react";
import { Product, getImage } from "@/lib/mock-data";
import { ImageOff } from "lucide-react";

interface Props { product: Product | any; size?: "sm"|"md"|"lg"|"full"|"vitrine"; objectFit?: "cover"|"contain"; showFallback?: boolean; className?: string; }
const resolveImage = async (product:any) => {
  for (const value of [product?.imageUrl, product?.photoUrl, product?.image, product?.photo]) if (typeof value === "string" && value.trim()) return value.trim();
  if (product?.imageId) try { return await getImage(product.imageId); } catch { return null; }
  return null;
};
const ProductImageCardComponent = ({product,size="md",objectFit="contain",showFallback=true,className=""}:Props) => {
  const [src,setSrc]=useState<string|null>(null);
  const [failed,setFailed]=useState(false);
  const [resolving,setResolving]=useState(true);
  useEffect(()=>{
    let active=true;
    setSrc(null); setFailed(false); setResolving(true);
    resolveImage(product).then(value=>{if(active){setSrc(value||null);setResolving(false)}});
    return()=>{active=false};
  },[product?.id,product?.imageUrl,product?.photoUrl,product?.image,product?.photo,product?.imageId]);
  const sizes={sm:"w-12 h-12",md:"w-16 h-16",lg:"w-24 h-24",full:"w-full h-full",vitrine:"w-full"};
  return <div className={`${sizes[size]} aspect-square rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100 overflow-hidden relative flex items-center justify-center border border-border/20 ${className}`}>
    {resolving ? <div className="absolute inset-0 animate-pulse bg-slate-100" aria-hidden="true" /> : src&&!failed ? <img src={src} onError={()=>setFailed(true)} className={`w-full h-full ${objectFit==="contain"?"object-contain p-2":"object-cover"}`} alt={product?.name||"Produto"} loading="lazy" decoding="async" draggable={false} width={320} height={320} sizes="(max-width: 768px) 50vw, 320px" /> : showFallback ? <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-slate-50 to-slate-100 text-slate-300"><div className="w-10 h-10 rounded-2xl bg-white shadow-sm flex items-center justify-center"><ImageOff className="w-5 h-5"/></div><span className="text-[9px] font-bold uppercase tracking-wider">Sem foto</span></div> : null}
  </div>;
};
export const ProductImageCard = memo(ProductImageCardComponent);
