export class OnboardingSaveError extends Error {
  constructor(public code: string, public status?: number, public errorId?: string) {
    super(`Onboarding save failed: ${code}${status ? ` (HTTP ${status})` : ''}`);
    this.name = 'OnboardingSaveError';
  }
}
