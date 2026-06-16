import { ReactNode } from "react";
import { Package } from "lucide-react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}

export const EmptyState = ({ 
  icon = <Package className="w-12 h-12 text-muted-foreground/30" />, 
  title, 
  description, 
  action,
  className = "" 
}: EmptyStateProps) => {
  return (
    <div className={`flex flex-col items-center justify-center p-12 text-center bg-white rounded-[2rem] border border-dashed border-border/60 space-y-4 ${className}`}>
      <div className="w-20 h-20 bg-muted/50 rounded-3xl flex items-center justify-center mb-2">
        {icon}
      </div>
      <div className="max-w-xs space-y-2">
        <h3 className="font-bold text-foreground text-lg">{title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {description}
        </p>
      </div>
      {action && (
        <div className="pt-2 w-full max-w-[200px]">
          {action}
        </div>
      )}
    </div>
  );
};
