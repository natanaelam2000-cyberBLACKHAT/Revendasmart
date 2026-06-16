import { useState, useEffect } from "react";
import { Product, getImage } from "@/lib/mock-data";
import { Package } from "lucide-react";

interface ProductImageCardProps {
  product: Product | any;
  size?: "sm" | "md" | "lg" | "full" | "vitrine";
  objectFit?: "cover" | "contain";
  showFallback?: boolean;
  className?: string;
}

const resolveProductImage = async (product: Product | any): Promise<string | null> => {
  if (product?.imageUrl && String(product.imageUrl).trim()) {
    return product.imageUrl;
  }
  if (product?.image && String(product.image).trim()) {
    return product.image;
  }
  if (product?.imageId) {
    try {
      const data = await getImage(product.imageId);
      if (data) return data;
    } catch (e) {
      console.error("[ProductImageCard] Error loading from IndexedDB:", e);
    }
  }
  return null;
};

export const ProductImageCard = ({
  product,
  size = "md",
  objectFit = "contain",
  showFallback = true,
  className = ""
}: ProductImageCardProps) => {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    resolveProductImage(product).then(setSrc);
  }, [product?.id, product?.imageUrl, product?.image, product?.imageId]);

  // Tamanhos e aspect ratios adaptados por tipo de produto
  const sizeConfig = {
    sm: { container: "w-12 h-12", aspectRatio: "aspect-square", fallback: "w-4 h-4" },
    md: { container: "w-16 h-16", aspectRatio: "aspect-square", fallback: "w-6 h-6" },
    lg: { container: "w-24 h-24", aspectRatio: "aspect-square", fallback: "w-8 h-8" },
    full: { container: "w-full h-full", aspectRatio: "aspect-square", fallback: "w-8 h-8" },
    vitrine: { container: "w-full", aspectRatio: "aspect-square", fallback: "w-8 h-8" }
  };

  const config = sizeConfig[size];

  // Detectar tipo de produto para otimizar exibição
  const productType = product?.productType?.toLowerCase() || "";
  const productName = (product?.name || "").toLowerCase();
  const category = (product?.category || "").toLowerCase();

  const isVertical = productType.includes("roupa") || category.includes("roupa") || productName.includes("vestido") || productName.includes("calça");
  const isHorizontal = productType.includes("bolsa") || category.includes("bolsa") || productName.includes("bolsa");
  const isSmall = productType.includes("cosmético") || productType.includes("perfume") || category.includes("cosmético") || category.includes("perfume") || productName.includes("perfume");
  const isTransparent = product?.image?.includes(".png") || product?.imageUrl?.includes(".png");

  return (
    <div
      className={`${config.container} ${config.aspectRatio} rounded-[1.5rem] bg-gradient-to-br from-[#F8F9FA] to-[#F1F3F5] overflow-hidden flex-shrink-0 relative flex items-center justify-center border border-border/20 ${className}`}
      style={{
        background: isTransparent ? "linear-gradient(135deg, #F8F9FA 0%, #F1F3F5 100%)" : "linear-gradient(135deg, #F8F9FA 0%, #F1F3F5 100%)"
      }}
    >
      {src ? (
        <img
          src={src}
          className={`${
            objectFit === "contain" ? "object-contain" : "object-cover"
          } w-full h-full p-2 mix-blend-multiply`}
          alt={product?.name || "Produto"}
          loading="lazy"
        />
      ) : showFallback ? (
        <div className="flex flex-col items-center justify-center gap-1">
          <Package className={`${config.fallback} opacity-20`} />
          <span className="text-[8px] font-black text-muted-foreground/20 uppercase">Sem Imagem</span>
        </div>
      ) : null}
    </div>
  );
};
