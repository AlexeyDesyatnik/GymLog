import type {
  UserSummary,
  InviteAnswer,
  InviteCheck,
  ResetLinkAnswer,
  ResetLinkCheck,
} from "@gymlog/shared";
import { serverApi } from "./api.ts";
import type { Sync, SyncOptions } from "./sync.ts";

/**
 * Who gets in (ADR 0007): becoming a User through an Invite, signing in with a Login and a
 * password, and what the Owner does for other Users. Every call that signs this
 * device in syncs right after; a refusal rejects with SignInRefused.
 */
export interface Access {
  /** Uses this Invite to become a User with the Login and password chosen, and signs this device in. */
  signUp(invite: string, login: string, password: string): Promise<void>;
  /** Signs this device in with a login and a password. */
  signIn(login: string, password: string): Promise<void>;
  /** Whether an Invite can still make a User: it was made and nobody has used it. */
  inviteUsable(invite: string): Promise<boolean>;
  /** Creates an Invite and returns its token, for its link. Only the Owner may. */
  createInvite(): Promise<string>;
  /** Every User, by Login. Only the Owner may see them. */
  users(): Promise<UserSummary[]>;
  /** Creates a Reset link for this User and returns its token. Only the Owner may. */
  createResetLink(userId: string): Promise<string>;
  /** The Login whose password this Reset link sets, or null when it is used, expired or was never made. */
  resetLinkLogin(resetLink: string): Promise<string | null>;
  /** Sets a new password through a Reset link, which ends the User's other sessions, and signs this device in. */
  setNewPassword(resetLink: string, password: string): Promise<void>;
}

export function openAccess(options: SyncOptions | undefined, sync: Sync): Access {
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
    users: () => api<UserSummary[]>("/api/users"),
    async createResetLink(userId) {
      return (await api<ResetLinkAnswer>("/api/reset-links", { userId })).resetLink;
    },
    async resetLinkLogin(resetLink) {
      return (await api<ResetLinkCheck>(`/api/reset-links/${encodeURIComponent(resetLink)}`)).login;
    },
    setNewPassword: (resetLink, password) =>
      signedIn(api(`/api/reset-links/${encodeURIComponent(resetLink)}`, { password })),
  };
}
