interface CatalogCategoryRailProps {
  categories: string[];
  selectedCategory: string;
  onSelectCategory: (category: string) => void;
}

export function CatalogCategoryRail({ categories, selectedCategory, onSelectCategory }: CatalogCategoryRailProps) {
  return (
    <section className="space-y-2" data-catalog-category-rail>
      <h2 className="px-4 text-base font-bold tracking-tight text-slate-950 sm:px-6">Categorias</h2>
      <div className="overflow-x-auto hide-scrollbar snap-x snap-mandatory">
        <div className="flex gap-2 px-4 sm:px-6">
          <button
            type="button"
            onClick={() => onSelectCategory("todos")}
            aria-pressed={selectedCategory === "todos"}
            className={`min-h-10 shrink-0 snap-start whitespace-nowrap rounded-full px-4 text-xs font-bold transition-colors ${selectedCategory === "todos" ? "bg-primary text-white" : "bg-slate-100 text-slate-600"}`}
          >
            Todos
          </button>
          {categories.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => onSelectCategory(category)}
              aria-pressed={selectedCategory === category}
              className={`min-h-10 shrink-0 snap-start whitespace-nowrap rounded-full px-4 text-xs font-bold transition-colors ${selectedCategory === category ? "bg-primary text-white" : "bg-slate-100 text-slate-600"}`}
            >
              {category}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
