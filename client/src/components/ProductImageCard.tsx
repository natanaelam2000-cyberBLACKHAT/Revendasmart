import { useState, useEffect } from "react";
import { Product, getImage } from "@/lib/mock-data";
import { Package } from "lucide-react";

interface ProductImageCardProps {
  product: Product | any;
  size?: "sm" | "md" | "lg" | "full";
  objectFit?: "cover" | "contain";
  showFallback?: boolean;
}

/**
 * RESTORED: Original working image resolution logic from Products.tsx
 * This is the exact function that worked before the refactoring
 */
const resolveProductImage = async (product: Product | any): Promise<string | null> => {
  // Priority 1: imageUrl (Firebase Storage - always preferred)
  if (product?.imageUrl && String(product.imageUrl).trim()) {
    return product.imageUrl;
  }
  
  // Priority 2: image (alternative field name)
  if (product?.image && String(product.image).trim()) {
    return product.image;
  }
  
  // Priority 3: imageId (IndexedDB - legacy)
  if (product?.imageId) {
    try {
      const data = await getImage(product.imageId);
      if (data) return data;
    } catch (e) {
      console.error("[ProductImageCard] Error loading from IndexedDB:", e);
    }
  }
  
  // No image available
  return null;
};

export const ProductImageCard = ({
  product,
  size = "md",
  objectFit = "cover",
  showFallback = true
}: ProductImageCardProps) => {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    // Use the exact pattern that worked: call async function and use .then()
    resolveProductImage(product).then(setSrc);
  }, [product?.id, product?.imageUrl, product?.image, product?.imageId]);

  const sizeClasses = {
    sm: "w-12 h-12",
    md: "w-16 h-16",
    lg: "w-24 h-24",
    full: "w-full h-full"
  };

  const fallbackClasses = {
    sm: "w-4 h-4",
    md: "w-6 h-6",
    lg: "w-8 h-8",
    full: "w-8 h-8"
  };

  return (
    <div
      className={`${sizeClasses[size]} rounded-2xl bg-secondary/50 overflow-hidden flex-shrink-0 relative ${
        size === "full" ? "flex items-center justify-center" : ""
      }`}
    >
      {src ? (
        <img
          src={src}
          className={`w-full h-full object-${objectFit} mix-blend-multiply`}
          alt={product?.name || "Produto"}
        />
      ) : showFallback ? (
        <Package
          className={`${fallbackClasses[size]} absolute inset-0 m-auto opacity-20`}
        />
      ) : null}
    </div>
  );
};
