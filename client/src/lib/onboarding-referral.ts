import { getFirebaseAuth } from './firebase';
import { getApiUrl } from './api-config';
export const syncReferralCompletion = async (responseData: any, uid: string | null) => {
    const auth = getFirebaseAuth();
    const currentUser = auth?.currentUser;
    if (!currentUser || !uid) return;

    const urlParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    const refCode = urlParams.get("ref");
    const refUID = sessionStorage.getItem("referrer_uid")
      || (typeof responseData?.settings?.referral_source === "string" ? responseData.settings.referral_source : null);

    if (!refUID) return;

    try {
      const referralToken = await currentUser.getIdToken();
      const referralHeaders = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${referralToken}`,
      };

      const trackResponse = await fetch(getApiUrl("/api/referral/track-event"), {
        method: "POST",
        headers: referralHeaders,
        body: JSON.stringify({
          referrerUID: refUID,
          event: "onboarding_completed",
          refCode: refCode || null,
        }),
      });

      if (trackResponse.status === 401 || trackResponse.status === 403) return;
      if (!trackResponse.ok && trackResponse.status !== 409) {
        console.warn("[onboarding] Não foi possível registrar a indicação.");
        return;
      }

      const validateResponse = await fetch(getApiUrl("/api/referral/validate-referral"), {
        method: "POST",
        headers: referralHeaders,
        body: JSON.stringify({ referrerUID: refUID }),
      });

      if (validateResponse.status === 401 || validateResponse.status === 403) return;
      if (!validateResponse.ok && validateResponse.status !== 409) {
        console.warn("[onboarding] Não foi possível validar a indicação.");
      }
    } catch {
      console.warn("[onboarding] A indicação não pôde ser sincronizada agora.");
    }
  };

