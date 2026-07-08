import { memo, useEffect, useState } from "react";
import { Product, getImage } from "@/lib/mock-data";
import { ImageOff } from "lucide-react";

type ProductImageLike = Partial<Product> & {
  thumbnailUrl?: string;
  photoUrl?: string;
  image?: string;
  photo?: string;
};

interface Props { product: ProductImageLike | null | undefined; size?: "sm"|"md"|"lg"|"full"|"vitrine"; objectFit?: "cover"|"contain"; showFallback?: boolean; className?: string; }

const indexedImageCache = new Map<string, string | null>();

const uniqueUrls = (values: unknown[]) => {
  const seen = new Set<string>();
  return values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map(value => value.trim())
    .filter(value => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
};

const resolveImages = async (product: ProductImageLike | null | undefined): Promise<string[]> => {
  const urls = uniqueUrls([product?.thumbnailUrl, product?.imageUrl, product?.photoUrl, product?.image, product?.photo]);
  if (product?.imageId) {
    const cacheKey = String(product.imageId);
    try {
      const stored = indexedImageCache.has(cacheKey) ? indexedImageCache.get(cacheKey) : await getImage(cacheKey);
      indexedImageCache.set(cacheKey, stored || null);
      if (stored) urls.push(stored);
    } catch {
      indexedImageCache.set(cacheKey, null);
    }
  }
  return uniqueUrls(urls);
};

const ProductImageCardComponent = ({product,size="md",objectFit="contain",showFallback=true,className=""}:Props) => {
  const [sources,setSources]=useState<string[]>([]);
  const [srcIndex,setSrcIndex]=useState(0);
  const [failed,setFailed]=useState(false);
  const [resolving,setResolving]=useState(true);

  useEffect(()=>{
    let active=true;
    setSources([]); setSrcIndex(0); setFailed(false); setResolving(true);
    resolveImages(product).then(value=>{if(active){setSources(value);setResolving(false)}});
    return()=>{active=false};
  },[product?.id,product?.thumbnailUrl,product?.imageUrl,product?.photoUrl,product?.image,product?.photo,product?.imageId]);

  const sizes={sm:"w-12 h-12",md:"w-16 h-16",lg:"w-24 h-24",full:"w-full h-full",vitrine:"w-full"};
  const src = sources[srcIndex] || null;
  const handleImageError = () => {
    if (srcIndex < sources.length - 1) {
      setSrcIndex(current => current + 1);
      return;
    }
    setFailed(true);
  };

  return <div className={`${sizes[size]} aspect-square rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100 overflow-hidden relative flex items-center justify-center border border-border/20 ${className}`}>
    {resolving ? <div className="absolute inset-0 animate-pulse bg-slate-100" aria-hidden="true" /> : src&&!failed ? <img src={src} onError={handleImageError} className={`w-full h-full ${objectFit==="contain"?"object-contain p-2":"object-cover"}`} alt={product?.name||"Produto"} loading="lazy" decoding="async" draggable={false} width={320} height={320} sizes="(max-width: 768px) 50vw, 320px" /> : showFallback ? <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-slate-50 to-slate-100 text-slate-300"><div className="w-10 h-10 rounded-2xl bg-white shadow-sm flex items-center justify-center"><ImageOff className="w-5 h-5"/></div><span className="text-[9px] font-bold uppercase tracking-wider">Sem foto</span></div> : null}
  </div>;
};
export const ProductImageCard = memo(ProductImageCardComponent);
