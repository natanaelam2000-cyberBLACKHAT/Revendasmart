import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { USER_FEEDBACK_EVENT, type UserFeedbackPayload } from "@/lib/notify";

function FeedbackFallback({ feedback }: { feedback: UserFeedbackPayload }) {
  return <div role="status" className="fixed top-4 left-4 right-4 z-[120] rounded-xl bg-background p-3 text-foreground">{feedback.message}{feedback.detail && <p>{feedback.detail}</p>}</div>;
}

// A first offline feedback must remain readable even if the presentation chunk cannot load.
const UserFeedbackToast = lazy(() => import("./UserFeedbackToast").catch(() => ({ default: FeedbackFallback })));

interface FeedbackItem extends UserFeedbackPayload {
  id: number;
}

export function UserFeedbackHost() {
  const [feedback, setFeedback] = useState<FeedbackItem | null>(null);
  const lastFeedback = useRef<{ key: string; at: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onFeedback = (event: Event) => {
      const payload = (event as CustomEvent<UserFeedbackPayload>).detail;
      if (!payload?.message) return;

      const key = `${payload.type}:${payload.message}:${payload.detail || ""}`;
      const now = Date.now();
      if (lastFeedback.current?.key === key && now - lastFeedback.current.at < 900) return;
      lastFeedback.current = { key, at: now };

      if (timerRef.current) clearTimeout(timerRef.current);
      setFeedback({ ...payload, id: now });
      timerRef.current = setTimeout(() => setFeedback(null), payload.duration ?? 3500);
    };

    window.addEventListener(USER_FEEDBACK_EVENT, onFeedback);
    return () => {
      window.removeEventListener(USER_FEEDBACK_EVENT, onFeedback);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!feedback) return null;

  return <Suspense fallback={<FeedbackFallback feedback={feedback} />}>
    <UserFeedbackToast feedback={feedback} />
  </Suspense>;
}
