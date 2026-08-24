/**
 * PRO-10B — I/O do Perfil Criativo (SellerCreativeProfile) contra o servidor
 * (`server/marketing-pro-creative-profile.ts`). Substitui a persistência 100% local do PRO-10A
 * (`localStorage` como fonte de verdade) — agora o servidor é CANÔNICO (§11: "Não usar localStorage
 * como authority... server profile é canônico").
 *
 * O cache local que este módulo mantém é estritamente um FALLBACK de exibição para quando o GET falha
 * (§12: "se GET falhar: não apagar profile local existente. mostrar fallback seguro") — nunca a fonte
 * de decisão de gating (Free/Premium, abrir onboarding automaticamente, etc.). Ele só é escrito depois
 * de uma leitura/escrita bem-sucedida no servidor, nunca especulativamente.
 */
import { apiRequest } from "@/lib/api-client";
import type { SellerCreativeProfile } from "@shared/marketing-pro-creative-intelligence";

export async function getCreativeProfile(): Promise<SellerCreativeProfile | null> {
  const result = await apiRequest<{ profile: SellerCreativeProfile | null }>("/api/marketing/pro/creative-profile", { auth: true });
  return result.profile;
}

export async function saveCreativeProfile(profile: SellerCreativeProfile): Promise<SellerCreativeProfile> {
  const result = await apiRequest<{ profile: SellerCreativeProfile }>("/api/marketing/pro/creative-profile", {
    method: "POST",
    auth: true,
    body: profile,
  });
  return result.profile;
}

/** Disponível para uma futura ação explícita de "apagar meu perfil" — NUNCA chamado automaticamente
 * pelo fluxo de "Refazer teste de estilo" (§10: refazer não pode apagar o perfil antes da conclusão). */
export async function resetCreativeProfile(): Promise<void> {
  await apiRequest("/api/marketing/pro/creative-profile", { method: "DELETE", auth: true });
}

// --- Cache local — fallback de exibição, nunca autoridade (§11/§12) ---

function cacheKey(uid: string): string {
  return `revendasmart:creative-profile-cache:v1:${uid}`;
}

export interface CreativeProfileCacheEntry {
  readonly profile: SellerCreativeProfile | null;
  readonly cachedAt: string;
}

/** Escrito só depois de um GET/SAVE bem-sucedido — nunca antes de confirmar o estado real do servidor. */
export function cacheCreativeProfileLocally(uid: string, profile: SellerCreativeProfile | null): void {
  try {
    const entry: CreativeProfileCacheEntry = { profile, cachedAt: new Date().toISOString() };
    window.localStorage.setItem(cacheKey(uid), JSON.stringify(entry));
  } catch {
    // Storage indisponível (modo privado, quota) — degrada para "sem cache", nunca quebra o fluxo.
  }
}

/** `null` = nunca cacheado (ou storage corrompido/indisponível — fail-safe, nunca inventa um perfil). */
export function readCachedCreativeProfile(uid: string): CreativeProfileCacheEntry | null {
  try {
    const raw = window.localStorage.getItem(cacheKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CreativeProfileCacheEntry>;
    if (typeof parsed.cachedAt !== "string") return null;
    return { profile: parsed.profile ?? null, cachedAt: parsed.cachedAt };
  } catch {
    return null;
  }
}

// --- Memória de "pulei o onboarding" (§9: "pode receber convite discreto depois, sem loop irritante") ---
//
// Puramente local, não é o perfil e não é enviada ao servidor — só evita reabrir o onboarding sozinho
// TODA vez que a página recarrega depois que o usuário já disse "pular por enquanto" uma vez. O convite
// discreto continua disponível manualmente (botão "Descobrir meu estilo" no card de entrada).
function skippedKey(uid: string): string {
  return `revendasmart:creative-profile-skipped:v1:${uid}`;
}

export function markCreativeProfileOnboardingSkipped(uid: string): void {
  try {
    window.localStorage.setItem(skippedKey(uid), "1");
  } catch {
    // sem storage -> pode reabrir de novo na próxima carga; não é uma falha crítica.
  }
}

export function wasCreativeProfileOnboardingSkipped(uid: string): boolean {
  try {
    return window.localStorage.getItem(skippedKey(uid)) === "1";
  } catch {
    return false;
  }
}
