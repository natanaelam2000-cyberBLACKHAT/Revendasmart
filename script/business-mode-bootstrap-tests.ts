import assert from "node:assert/strict";
import fs from "node:fs";
import { resolveBusinessModeBootstrap } from "../shared/business-mode";

function read(path: string): string {
  return fs.readFileSync(path, "utf8");
}

function run(): void {
  assert.deepEqual(
    resolveBusinessModeBootstrap({ businessMode: undefined, loading: true, loaded: false }),
    { status: "loading", mode: null, resolved: false },
    "F1-1: undefined durante loading precisa permanecer neutro, nunca Products",
  );
  assert.deepEqual(
    resolveBusinessModeBootstrap({ businessMode: "services", loading: false, loaded: true }),
    { status: "known", mode: "services", resolved: true },
    "F1-2: SERVICES carregado resolve como services",
  );
  assert.deepEqual(
    resolveBusinessModeBootstrap({ businessMode: "products", loading: false, loaded: true }),
    { status: "known", mode: "products", resolved: true },
    "F1-3: PRODUCTS carregado resolve como products",
  );
  assert.deepEqual(
    resolveBusinessModeBootstrap({ businessMode: "both", loading: false, loaded: true }),
    { status: "known", mode: "both", resolved: true },
    "F1-4: BOTH carregado resolve como both",
  );
  assert.deepEqual(
    resolveBusinessModeBootstrap({ businessMode: undefined, loading: false, loaded: true }),
    { status: "legacy-missing", mode: "products", resolved: true },
    "F1-5: legacy carregado sem businessMode preserva Products só depois de loaded=true",
  );
  assert.deepEqual(
    resolveBusinessModeBootstrap({ businessMode: undefined, loading: false, loaded: false, error: "offline" }),
    { status: "error", mode: null, resolved: false },
    "F1-6: erro/offline sem dado carregado continua erro neutro",
  );
  assert.deepEqual(
    resolveBusinessModeBootstrap({ businessMode: undefined, loading: false, loaded: true, error: "offline" }),
    { status: "error", mode: null, resolved: false },
    "F1-7: erro/offline depois da tentativa não vira Products",
  );

  const hookSrc = read("client/src/hooks/useUserSettings.ts");
  assert.match(hookSrc, /setLoading\(true\);[\s\S]*setLoaded\(false\);[\s\S]*setError\(undefined\);[\s\S]*setSettings\(defaultSettings\);/, "F1-8: troca/refetch de usuário limpa settings antes da nova leitura para não reaproveitar ramo do UID anterior");
  assert.match(hookSrc, /businessModeResolution = resolveBusinessModeBootstrap\(\{[\s\S]*businessMode: settings\.businessMode,[\s\S]*loading,[\s\S]*loaded,[\s\S]*error,[\s\S]*\}\);/, "F1-9: useUserSettings expõe resolução central com loading/loaded/error");
  assert.match(hookSrc, /const patchListeners = new Map<string, Set<SettingsPatchListener>>\(\);/, "F1-9a: patches otimistas são particionados por UID");
  assert.match(hookSrc, /patchUserSettingsOptimistic\(patch: Partial<AppSettings>, targetUid: string \| null\)/, "F1-9b: dispatch de patch exige alvo de usuário explícito");
  assert.match(hookSrc, /const loadStatus: UserSettingsLoadStatus = error \? "error" : loading \|\| !loaded \? "loading" : "loaded";/, "F1-9c: loadStatus não chama ausência de usuário de loaded");

  const providerSrc = read("client/src/providers/UserSettingsProvider.tsx");
  assert.match(providerSrc, /businessModeResolution: BusinessModeResolution;/, "F1-10: provider expõe businessModeResolution para consumidores críticos");
  assert.match(providerSrc, /businessMode: businessModeResolution\.mode/, "F1-11: provider expõe modo nullable, sem inventar Products durante bootstrap");

  const layoutSrc = read("client/src/components/layout.tsx");
  assert.match(layoutSrc, /const navMode = businessModeResolution\.resolved \? businessModeResolution\.mode : null;/, "F1-13: Layout usa modo resolvido ou null");
  assert.match(layoutSrc, /navMode \? navForBusinessMode\(navMode\) : \{ primary: \[\], overflow: \[\] \}/, "F1-14: Layout renderiza navegação neutra antes do modo conhecido");
  assert.doesNotMatch(layoutSrc, /resolveBusinessMode\(settings\.businessMode\)/, "F1-15: Layout não pode voltar a resolver loading como Products");

  const dashboardSrc = read("client/src/pages/dashboard.tsx");
  assert.match(dashboardSrc, /const resolvedBusinessMode = businessModeResolution\.resolved \? businessModeResolution\.mode : null;/, "F1-16: Dashboard não decide serviços/produtos por settings cru durante bootstrap");
  assert.match(dashboardSrc, /businessModeResolution\.status === "error"/, "F1-17: erro de settings tem estado seguro e retry, não default Products");

  const catalogSrc = read("client/src/pages/catalog.tsx");
  assert.match(catalogSrc, /businessModeResolution\.status === "loading"/, "F1-18: Catálogo privado espera resolução do ramo");
  assert.match(catalogSrc, /businessModeResolution\.status === "error"/, "F1-19: Catálogo privado não vira Products em erro/offline");
  assert.match(catalogSrc, /businessModeResolution\.mode === "services"/, "F1-20: Catálogo usa modo resolvido para SERVICES");
  assert.doesNotMatch(catalogSrc, /resolveBusinessMode\(settings\.businessMode\)/, "F1-21: Catálogo não usa fallback legado durante bootstrap");

  const onboardingSrc = read("client/src/pages/onboarding.tsx");
  assert.match(onboardingSrc, /const \[businessMode, setBusinessMode\] = useState<BusinessMode \| null>\(null\);/, "F1-22: onboarding continua sem default Products");
  assert.match(onboardingSrc, /const \[selectedTypes, setSelectedTypes\] = useState<NichoId\[\]>\(\["Geral"\]\);/, "F1-23: nicho Geral continua separado de businessMode");
  assert.match(onboardingSrc, /\.\.\.\(businessMode \? \{ businessMode \} : \{\}\)/, "F1-24: onboarding só persiste businessMode quando escolhido");

  console.log("BUSINESS-MODE-BOOTSTRAP-F1 — safe bootstrap assertions passed.");
}

run();
