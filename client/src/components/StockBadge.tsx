import { Badge } from "@/components/ui/badge";

interface StockBadgeProps {
  stock: number;
  lowStockThreshold?: number;
  className?: string;
}

export const StockBadge = ({ stock, lowStockThreshold = 3, className = "" }: StockBadgeProps) => {
  if (stock === 0) {
    return (
      <Badge variant="outline" className={`bg-red-50 text-red-700 border-red-200 gap-1.5 font-bold ${className}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse" />
        🔴 Sem Estoque
      </Badge>
    );
  }

  if (stock <= lowStockThreshold) {
    return (
      <Badge variant="outline" className={`bg-yellow-50 text-yellow-700 border-yellow-200 gap-1.5 font-bold ${className}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-600" />
        🟡 Estoque Baixo ({stock})
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className={`bg-green-50 text-green-700 border-green-200 gap-1.5 font-bold ${className}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-green-600" />
      🟢 Estoque OK ({stock})
    </Badge>
  );
};
