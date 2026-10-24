import type { Request, Response } from "express";

type SettingsDocument = {
  exists: boolean;
  data(): Record<string, unknown> | undefined;
};

export type FirebaseAdminForSettingsRead = {
  firestore(): {
    collection(name: string): {
      doc(id: string): {
        get(): Promise<SettingsDocument>;
      };
    };
  };
};

type ErrorResponder = (
  res: Response,
  statusCode: number,
  errorType: string,
  message: string,
  context: Record<string, unknown>,
) => unknown;

export function createGetUserSettingsHandler(dependencies: {
  getFirebaseAdmin: () => FirebaseAdminForSettingsRead;
  errorResponse: ErrorResponder;
}) {
  return async function getUserSettings(req: Request, res: Response): Promise<unknown> {
    const rawUserId = req.params.userId;
    const userId = Array.isArray(rawUserId) ? rawUserId[0] : rawUserId;
    try {
      if (!userId) {
        return res.status(400).json({ error: "userId required" });
      }

      const settingsDoc = await dependencies.getFirebaseAdmin()
        .firestore()
        .collection("user_settings")
        .doc(userId)
        .get();
      const settings = settingsDoc.exists ? settingsDoc.data() : {};
      return res.json({
        onboarding_completed: settings?.onboarding_completed === true,
        settings,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return dependencies.errorResponse(
        res,
        500,
        "SETTINGS_LOAD_FAILED",
        message,
        { userId, errorName: error instanceof Error ? error.name : "UnknownError" },
      );
    }
  };
}
