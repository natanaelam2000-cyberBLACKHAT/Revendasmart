import { Sparkles, Share2, Copy } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { usePlanData } from "@/hooks/usePlanData";
import { PLANS, type GlobalConfig } from "@shared/monetization";

export function PlanStatusBadge() {
  const { activePlan, hasPremiumAccess, referralCode, shareLink, referralCount, loading, globalConfig: rawGlobalConfig, isTester, isPremiumPlus, planData } = usePlanData();
  const globalConfig = rawGlobalConfig as GlobalConfig | null;
  const [copied, setCopied] = useState(false);
  const [, setLocation] = useLocation();
  const isOpenAccess = !!globalConfig?.premiumOpenAccess;
  // OWNER-ACCESS-02 §15 — só mostra "Gerenciar assinatura" quando existe uma assinatura PAGA de
  // verdade associada (Mercado Pago ou Google Play); Tester/Premium+ nunca geram cobrança, então não
  // há nada para "gerenciar" nesse sentido — mas se a MESMA conta também tiver uma assinatura paga
  // (ex.: já era Premium comercial antes de virar Tester), o botão continua aparecendo normalmente.
  const hasPaidSubscription = Boolean(planData?.subscriptionId || planData?.billingProvider);

  const handleCopyLink = () => {
    if (shareLink) {
      navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Fallback while loading
  if (loading) {
    return (
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-bold bg-gray-100 text-gray-700 animate-pulse">
          <span>Carregando...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Plan Badge — OWNER-ACCESS-02 §15: Tester usa um tom discreto (cinza), Premium+/Premium comercial
          continuam no destaque âmbar de sempre. */}
      <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-bold ${
        isTester
          ? 'bg-gray-100 text-gray-700'
          : hasPremiumAccess
            ? 'bg-amber-100 text-amber-700'
            : 'bg-gray-100 text-gray-700'
      }`} data-testid="badge-plan-status">
        {hasPremiumAccess && !isTester && <Sparkles className="w-3.5 h-3.5" />}
        <span>{isPremiumPlus ? 'Premium+' : isTester ? 'Tester' : hasPremiumAccess ? (isOpenAccess ? 'Premium temporariamente liberado' : 'Premium ativo') : 'Plano Grátis'}</span>
      </div>

      {/* Referral Info */}
      {!hasPremiumAccess && activePlan === PLANS.FREE && !isOpenAccess && (
        <>
          {/* Upgrade CTA */}
          <button
            onClick={() => setLocation("/subscribe")}
            className="w-full flex items-center justify-center gap-2 bg-amber-500 text-white text-xs font-bold px-3 py-2 rounded-xl active:scale-95 transition-all shadow-sm"
            data-testid="button-upgrade-premium"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Assinar Premium — R$ 19,90/mês
          </button>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2" data-testid="section-referral-info">
            <div className="text-xs font-bold text-blue-700">
              Ou indique e ganhe Premium! ({referralCount}/3)
            </div>
            
            {referralCode && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={referralCode}
                  readOnly
                  className="flex-1 text-xs px-2 py-1 bg-white border border-blue-200 rounded text-blue-600 font-mono"
                  data-testid="input-referral-code"
                />
                <button
                  onClick={handleCopyLink}
                  className="px-2 py-1 bg-blue-500 text-white rounded text-xs font-bold hover:bg-blue-600 active:scale-95 transition-all flex items-center gap-1"
                  data-testid="button-copy-referral"
                >
                  {copied ? '✓' : <Copy className="w-3 h-3" />}
                </button>
              </div>
            )}

            {shareLink && (
              <a
                href={shareLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-700 p-1 rounded hover:bg-blue-100 transition-colors"
                data-testid="link-share-referral"
              >
                <Share2 className="w-3 h-3" />
                Compartilhar Link
              </a>
            )}
          </div>
        </>
      )}

      {hasPremiumAccess && (
        <div className="space-y-2">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700 font-medium" data-testid="section-premium-active">
            ✓ {isPremiumPlus ? 'Você tem Premium+ com acesso a todos os recursos Premium!' : isTester ? 'Como testadora, você tem acesso a todos os recursos Premium!' : isOpenAccess ? 'Premium temporariamente liberado!' : 'Você tem acesso a todos os recursos Premium!'}
          </div>
          {/* OWNER-ACCESS-02 §15: sem assinatura paga associada, não há nada para "gerenciar" (Tester/
              Premium+ nunca geram cobrança) — botão só aparece quando existe billing real por trás. */}
          {hasPaidSubscription && (
            <button
              onClick={() => setLocation("/subscribe")}
              className="w-full text-xs text-muted-foreground border border-gray-100 rounded-lg p-2 active:scale-95 transition-all"
              data-testid="button-manage-subscription"
            >
              Gerenciar assinatura
            </button>
          )}
        </div>
      )}
    </div>
  );
}
