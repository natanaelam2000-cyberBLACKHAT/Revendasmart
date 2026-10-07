import { authErrorCode, authFailure, type SocialProvider } from "./auth-policy";

export interface AuthIdentity {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  providerData: readonly { providerId: string }[];
}

export interface AuthAdapter<U extends AuthIdentity, C> {
  currentUser(): U | null;
  ready(): Promise<void>;
  emailLogin(email: string, password: string): Promise<U>;
  signup(email: string, password: string): Promise<U>;
  socialLogin(provider: SocialProvider): Promise<U>;
  socialLink(user: U, provider: SocialProvider): Promise<U>;
  linkCredential(user: U, credential: C): Promise<U>;
  collision(error: unknown, provider: SocialProvider): { email: string; credential: C } | null;
  verify(user: U): Promise<void>;
  reload(user: U): Promise<void>;
  token(user: U, force: boolean): Promise<string>;
  recent(user: U): Promise<boolean>;
  reset(email: string): Promise<void>;
  reauthenticate(user: U, provider: SocialProvider | "password", password?: string): Promise<void>;
  logout(): Promise<void>;
}

/** One authoritative session. Pending OAuth credentials are memory-only, short-lived and never merged. */
export class AuthController<U extends AuthIdentity, C> {
  private busy = false;
  private pending: { email: string; credential: C; expiresAt: number } | null = null;
  private verificationSentAt = new Map<string, number>();
  constructor(private adapter: AuthAdapter<U, C>, private now = Date.now) {}

  get pendingEmail(): string | null {
    if (this.pending && this.pending.expiresAt <= this.now()) this.pending = null;
    return this.pending?.email ?? null;
  }

  discardPendingLink(): void { this.pending = null; }

  private async run<T>(operation: () => Promise<T>, waitReady = true): Promise<T> {
    if (this.busy) throw authFailure("auth/operation-in-progress");
    this.busy = true;
    try { if (waitReady) await this.adapter.ready(); return await operation(); }
    finally { this.busy = false; }
  }

  login(email: string, password: string): Promise<U> {
    return this.run(() => this.adapter.emailLogin(email.trim(), password));
  }

  signup(email: string, password: string): Promise<U> {
    return this.run(() => this.adapter.signup(email.trim(), password));
  }

  social(provider: SocialProvider): Promise<U> {
    return this.run(async () => {
      try { return await this.adapter.socialLogin(provider); }
      catch (error) {
        if (authErrorCode(error) === "auth/account-exists-with-different-credential") {
          const collision = this.adapter.collision(error, provider);
          this.pending = collision ? { ...collision, expiresAt: this.now() + 5 * 60_000 } : null;
        }
        throw error;
      }
    });
  }

  link(provider: SocialProvider): Promise<U> {
    return this.run(async () => {
      const user = this.requireUser();
      const uid = user.uid;
      if (!await this.adapter.recent(user)) throw authFailure("auth/requires-recent-login");
      const linked = await this.adapter.socialLink(user, provider);
      this.assertSameUser(uid, linked);
      return linked;
    });
  }

  confirmPendingLink(): Promise<U> {
    return this.run(async () => {
      const user = this.requireUser();
      const uid = user.uid;
      if (!await this.adapter.recent(user)) throw authFailure("auth/requires-recent-login");
      const email = this.pendingEmail;
      const pending = this.pending;
      if (!pending || !email) throw authFailure("auth/re-authentication-required");
      if (user.email?.trim().toLowerCase() !== email.trim().toLowerCase()) throw authFailure("auth/email-mismatch");
      const linked = await this.adapter.linkCredential(user, pending.credential);
      this.assertSameUser(uid, linked);
      this.pending = null;
      return linked;
    });
  }

  sendVerification(): Promise<void> {
    return this.run(async () => {
      const user = this.requireUser();
      if (!user.email) throw authFailure("auth/missing-email");
      if (user.emailVerified) return;
      const last = this.verificationSentAt.get(user.uid);
      if (last !== undefined && this.now() - last < 60_000) throw authFailure("auth/verification-cooldown");
      await this.adapter.verify(user);
      this.verificationSentAt.set(user.uid, this.now());
    });
  }

  refreshVerification(): Promise<U> {
    return this.run(async () => {
      const user = this.requireUser();
      const uid = user.uid;
      await this.adapter.reload(user);
      this.assertSameUser(uid, this.requireUser());
      await this.adapter.token(user, true);
      return user;
    });
  }

  resetPassword(email: string): Promise<void> {
    return this.run(async () => {
      try { await this.adapter.reset(email.trim()); }
      catch (error) { if (authErrorCode(error) !== "auth/user-not-found") throw error; }
    });
  }

  reauthenticate(provider: SocialProvider | "password", password?: string): Promise<void> {
    return this.run(async () => {
      const user = this.requireUser();
      const uid = user.uid;
      await this.adapter.reauthenticate(user, provider, password);
      this.assertSameUser(uid, this.requireUser());
      await this.adapter.token(user, true);
    });
  }

  logout(): Promise<void> {
    return this.run(async () => {
      await this.adapter.logout();
      this.pending = null;
      this.verificationSentAt.clear();
    }, false);
  }

  private requireUser(): U {
    const user = this.adapter.currentUser();
    if (!user) throw authFailure("auth/re-authentication-required");
    return user;
  }

  private assertSameUser(expectedUid: string, actual: U): void {
    if (expectedUid !== actual.uid || this.adapter.currentUser()?.uid !== expectedUid) throw authFailure("auth/user-mismatch");
  }
}
