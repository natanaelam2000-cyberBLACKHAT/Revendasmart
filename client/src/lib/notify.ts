export type FeedbackType = "success" | "error" | "warning" | "info";

export interface UserFeedbackPayload {
  type: FeedbackType;
  message: string;
  detail?: string;
  duration?: number;
}

const DEFAULT_DURATION = 3500;
const EVENT_NAME = "revendasmart:user-feedback";

const sanitizeMessage = (message: string, fallback: string) => {
  const clean = String(message || "").trim();
  if (!clean) return fallback;
  if (/http \d{3}|firebase|firestore|stack|token|undefined|null|\[object object\]/i.test(clean)) {
    return fallback;
  }
  return clean;
};

export const notify = (payload: UserFeedbackPayload) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<UserFeedbackPayload>(EVENT_NAME, {
    detail: { ...payload, duration: payload.duration ?? DEFAULT_DURATION }
  }));
};

export const notifySuccess = (message: string, detail?: string) => notify({ type: "success", message: sanitizeMessage(message, "Operação concluída."), detail });
export const notifyError = (message = "Ocorreu um erro temporário.", detail?: string) => notify({ type: "error", message: sanitizeMessage(message, "Ocorreu um erro temporário."), detail });
export const notifyWarning = (message: string, detail?: string) => notify({ type: "warning", message: sanitizeMessage(message, "Atenção necessária."), detail });
export const notifyInfo = (message: string, detail?: string) => notify({ type: "info", message: sanitizeMessage(message, "Informação atualizada."), detail });

export { EVENT_NAME as USER_FEEDBACK_EVENT };
