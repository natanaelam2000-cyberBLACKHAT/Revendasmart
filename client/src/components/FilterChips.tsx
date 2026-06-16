interface FilterChipsProps {
  options: string[];
  selected: string;
  onSelect: (option: string) => void;
  className?: string;
}

export const FilterChips = ({ options, selected, onSelect, className = "" }: FilterChipsProps) => {
  return (
    <div className={`flex gap-2 overflow-x-auto hide-scrollbar pb-2 -mx-6 px-6 ${className}`}>
      {options.map((option) => (
        <button
          key={option}
          onClick={() => onSelect(option)}
          className={`px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap shadow-sm border ${
            selected === option 
              ? "bg-primary text-white border-primary shadow-primary/20 scale-105" 
              : "bg-white text-muted-foreground border-border/50 hover:border-primary/30"
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
};
