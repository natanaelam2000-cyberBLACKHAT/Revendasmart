interface AccountHeroProps {
  displayName: string;
  logoUrl?: string;
}

export function AccountHero({ displayName, logoUrl }: AccountHeroProps) {
  const initial = (displayName || "R").charAt(0).toLocaleUpperCase("pt-BR");

  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-border/60 bg-white p-5 shadow-sm mb-6 sm:p-6">
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1.5 bg-primary" />
      <div className="flex items-center gap-4 pl-2">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-primary/10 text-2xl font-black text-primary">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" width={56} height={56} />
          ) : (
            initial
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">Revenda Smart</p>
          <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight text-foreground lg:text-3xl">Olá, {displayName}!</h1>
          <p className="mt-1 text-sm text-muted-foreground">Gerencie sua conta e sua loja.</p>
        </div>
      </div>
    </section>
  );
}
