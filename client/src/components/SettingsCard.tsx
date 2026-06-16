import { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

interface SettingsCardProps {
  icon: ReactNode;
  title: string;
  description?: string;
  children?: ReactNode;
  onClick?: () => void;
  className?: string;
}

export const SettingsCard = ({ 
  icon, 
  title, 
  description, 
  children, 
  onClick,
  className = "" 
}: SettingsCardProps) => {
  const isClickable = !!onClick;

  return (
    <div 
      onClick={onClick}
      className={`bg-white border border-border/50 rounded-[1.5rem] p-4 transition-all ${
        isClickable ? 'cursor-pointer hover:shadow-md hover:border-primary/30 active:scale-[0.98]' : ''
      } ${className}`}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center flex-shrink-0 text-primary">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-xs font-black text-foreground uppercase tracking-wide">{title}</h3>
          {description && (
            <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
          )}
        </div>
        {isClickable && (
          <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        )}
      </div>
      {children && (
        <div className="mt-4 pt-4 border-t border-border/30">
          {children}
        </div>
      )}
    </div>
  );
};
