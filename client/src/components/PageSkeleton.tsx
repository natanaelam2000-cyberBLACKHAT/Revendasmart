import { Skeleton } from "@/components/ui/skeleton";

type Props = {
  variant?: "dashboard" | "cards" | "list" | "publicCatalog" | "products" | "settings";
  count?: number;
};

const shimmer = "motion-reduce:animate-none";

function ProductCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/50 bg-white shadow-sm" aria-hidden="true">
      <Skeleton className={`aspect-square w-full rounded-none ${shimmer}`} />
      <div className="p-3 space-y-2">
        <Skeleton className={`h-3 w-16 ${shimmer}`} />
        <Skeleton className={`h-4 w-full ${shimmer}`} />
        <Skeleton className={`h-3 w-2/3 ${shimmer}`} />
        <div className="grid grid-cols-2 gap-2 pt-1">
          <Skeleton className={`h-3 w-full ${shimmer}`} />
          <Skeleton className={`h-3 w-full ${shimmer}`} />
          <Skeleton className={`h-3 w-full ${shimmer}`} />
          <Skeleton className={`h-3 w-full ${shimmer}`} />
        </div>
        <Skeleton className={`h-10 w-full rounded-xl ${shimmer}`} />
      </div>
    </div>
  );
}

export function PageSkeleton({ variant = "list", count = 6 }: Props) {
  if (variant === "publicCatalog") {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900" aria-label="Carregando catálogo" aria-busy="true" role="status">
        <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex items-center gap-4">
            <Skeleton className={`w-12 h-12 rounded-2xl shrink-0 ${shimmer}`} aria-hidden="true" />
            <div className="min-w-0 flex-1 space-y-2" aria-hidden="true">
              <Skeleton className={`h-6 w-48 max-w-[70%] ${shimmer}`} />
              <Skeleton className={`h-3 w-32 ${shimmer}`} />
            </div>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="flex gap-2 overflow-hidden pb-4" aria-hidden="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className={`h-11 w-24 shrink-0 rounded-full ${shimmer}`} />
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col" aria-hidden="true">
                <Skeleton className={`aspect-[4/5] w-full rounded-none ${shimmer}`} />
                <div className="p-3 sm:p-4 flex-1 flex flex-col space-y-2">
                  <Skeleton className={`h-3 w-20 ${shimmer}`} />
                  <Skeleton className={`h-4 w-full ${shimmer}`} />
                  <Skeleton className={`h-4 w-4/5 ${shimmer}`} />
                  <Skeleton className={`h-3 w-24 ${shimmer}`} />
                  <Skeleton className={`h-6 w-28 mt-3 ${shimmer}`} />
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>
    );
  }

  if (variant === "products") {
    return (
      <div className="min-h-full bg-slate-50 pb-28 lg:pb-8" aria-label="Carregando produtos" aria-busy="true" role="status">
        <div className="bg-white border-b border-border/50">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 lg:py-7 space-y-4">
            <div className="flex items-center justify-between gap-4" aria-hidden="true">
              <div className="space-y-2 flex-1">
                <Skeleton className={`h-3 w-20 ${shimmer}`} />
                <Skeleton className={`h-8 w-56 max-w-[70%] ${shimmer}`} />
                <Skeleton className={`h-4 w-64 max-w-full ${shimmer}`} />
              </div>
              <Skeleton className={`h-11 w-32 rounded-xl shrink-0 ${shimmer}`} />
            </div>
            <div className="flex flex-col lg:flex-row gap-3 lg:items-center" aria-hidden="true">
              <Skeleton className={`h-12 flex-1 rounded-xl ${shimmer}`} />
              <div className="flex gap-2">
                <Skeleton className={`h-9 w-32 rounded-full ${shimmer}`} />
                <Skeleton className={`h-9 w-28 rounded-full ${shimmer}`} />
              </div>
            </div>
            <div className="flex gap-2 overflow-hidden" aria-hidden="true">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className={`h-9 w-24 shrink-0 rounded-2xl ${shimmer}`} />
              ))}
            </div>
          </div>
        </div>
        <div className="max-w-6xl mx-auto p-4 sm:p-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
            {Array.from({ length: count }).map((_, i) => <ProductCardSkeleton key={i} />)}
          </div>
        </div>
      </div>
    );
  }

  if (variant === "settings") {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-10" aria-label="Carregando configurações" aria-busy="true" role="status">
        <section className="bg-gradient-to-br from-primary/70 to-primary/50 text-white rounded-[2rem] p-6 lg:p-8 shadow-xl shadow-primary/10 mb-6">
          <div className="flex items-center gap-4" aria-hidden="true">
            <Skeleton className={`w-14 h-14 rounded-2xl bg-white/25 shrink-0 ${shimmer}`} />
            <div className="space-y-2 flex-1">
              <Skeleton className={`h-4 w-28 bg-white/25 ${shimmer}`} />
              <Skeleton className={`h-8 w-56 max-w-[75%] bg-white/25 ${shimmer}`} />
              <Skeleton className={`h-4 w-48 bg-white/25 ${shimmer}`} />
            </div>
          </div>
        </section>
        <div className="bg-white rounded-[2rem] border border-border/60 shadow-sm overflow-hidden divide-y divide-border/50">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="w-full flex items-center gap-4 p-4 sm:p-5" aria-hidden="true">
              <Skeleton className={`w-11 h-11 rounded-2xl shrink-0 ${shimmer}`} />
              <div className="flex-1 min-w-0 space-y-2">
                <Skeleton className={`h-4 w-40 max-w-[70%] ${shimmer}`} />
                <Skeleton className={`h-3 w-64 max-w-full ${shimmer}`} />
              </div>
              <Skeleton className={`w-5 h-5 rounded-full shrink-0 ${shimmer}`} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === "dashboard") {
    return (
      <div className="p-4 sm:p-6 lg:p-8 space-y-5" aria-label="Carregando conteúdo" aria-busy="true" role="status">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border/50 bg-white p-4 space-y-3" aria-hidden="true">
              <Skeleton className={`h-3 w-20 ${shimmer}`} />
              <Skeleton className={`h-7 w-28 ${shimmer}`} />
            </div>
          ))}
        </div>
        <div className="grid lg:grid-cols-2 gap-4" aria-hidden="true">
          <Skeleton className={`h-44 rounded-2xl ${shimmer}`} />
          <Skeleton className={`h-44 rounded-2xl ${shimmer}`} />
        </div>
      </div>
    );
  }

  if (variant === "cards") {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 p-4 sm:p-6" aria-label="Carregando produtos" aria-busy="true" role="status">
        {Array.from({ length: count }).map((_, i) => <ProductCardSkeleton key={i} />)}
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-3" aria-label="Carregando lista" aria-busy="true" role="status">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-2xl border border-border/50 bg-white p-3" aria-hidden="true">
          <Skeleton className={`h-14 w-14 shrink-0 rounded-xl ${shimmer}`} />
          <div className="flex-1 space-y-2">
            <Skeleton className={`h-4 w-2/3 ${shimmer}`} />
            <Skeleton className={`h-3 w-1/2 ${shimmer}`} />
          </div>
          <Skeleton className={`h-8 w-16 rounded-xl ${shimmer}`} />
        </div>
      ))}
    </div>
  );
}
