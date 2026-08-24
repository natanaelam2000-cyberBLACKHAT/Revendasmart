const GENDER_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "feminino", label: "Feminino" },
  { value: "masculino", label: "Masculino" },
  { value: "unisex", label: "Unissex" },
];

interface CatalogGenderFilterProps {
  selectedGender: string;
  onSelectGender: (gender: string) => void;
}

export function CatalogGenderFilter({ selectedGender, onSelectGender }: CatalogGenderFilterProps) {
  return (
    <div className="flex gap-1.5 overflow-x-auto hide-scrollbar px-4 sm:px-6" data-catalog-gender-filter>
      {GENDER_FILTER_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onSelectGender(option.value)}
          aria-pressed={selectedGender === option.value}
          className={`min-h-8 shrink-0 whitespace-nowrap rounded-full border px-3 text-[11px] font-bold transition-colors ${
            selectedGender === option.value ? "border-primary bg-primary/10 text-primary" : "border-slate-200 bg-white text-slate-500"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
