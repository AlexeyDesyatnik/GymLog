import type {
  AccountSummary,
  InviteAnswer,
  InviteCheck,
  PasswordResetAnswer,
  PasswordResetCheck,
} from "@gymlog/shared";
import { serverApi } from "./api.ts";
import type { Sync, SyncOptions } from "./sync.ts";

/**
 * The user's account on the server (ADR 0007): creating it through an Invite, signing in with
 * a login and a password, and what the owner does for others. Every call that signs this
 * device in syncs right after; a refusal rejects with SignInRefused.
 */
export interface Account {
  /** Creates an account through this Invite with the login and password chosen, and signs this device in. */
  signUp(invite: string, login: string, password: string): Promise<void>;
  /** Signs this device in with a login and a password. */
  signIn(login: string, password: string): Promise<void>;
  /** Whether an Invite can still give someone an account: it was made and nobody has used it. */
  inviteUsable(invite: string): Promise<boolean>;
  /** Creates an Invite and returns its token, for its link. Only the owner may. */
  createInvite(): Promise<string>;
  /** Every account, by login. Only the owner may see them. */
  accounts(): Promise<AccountSummary[]>;
  /** Creates a one-time link for this user to set a new password, and returns its token. Only the owner may. */
  createPasswordReset(userId: string): Promise<string>;
  /** The login whose password this link sets, or null when the link is used, expired or was never made. */
  passwordResetLogin(reset: string): Promise<string | null>;
  /** Sets a new password through the owner's link, which ends the user's other sessions, and signs this device in. */
  resetPassword(reset: string, password: string): Promise<void>;
}

export function openAccount(options: SyncOptions | undefined, sync: Sync): Account {
  const api = options ? serverApi(options) : () => Promise.reject(new Error("There is no server to sign in to"));

  /** Once signed in, the records here and on the server get in step. */
  async function signedIn(signingIn: Promise<unknown>): Promise<void> {
    await signingIn;
    await sync.now();
  }

  return {
    signUp: (invite, login, password) => signedIn(api("/api/sign-up", { invite, login, password })),
    signIn: (login, password) => signedIn(api("/api/sign-in", { login, password })),
    async inviteUsable(invite) {
      return (await api<InviteCheck>(`/api/invites/${encodeURIComponent(invite)}`)).usable;
    },
    async createInvite() {
      return (await api<InviteAnswer>("/api/invites", {})).invite;
    },
    accounts: () => api<AccountSummary[]>("/api/accounts"),
    async createPasswordReset(userId) {
      return (await api<PasswordResetAnswer>("/api/password-resets", { userId })).reset;
    },
    async passwordResetLogin(reset) {
      return (await api<PasswordResetCheck>(`/api/password-resets/${encodeURIComponent(reset)}`)).login;
    },
    resetPassword: (reset, password) =>
      signedIn(api(`/api/password-resets/${encodeURIComponent(reset)}`, { password })),
  };
}
