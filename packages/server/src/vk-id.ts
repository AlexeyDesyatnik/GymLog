import { createHash } from "node:crypto";

/** The GymLog app registered with VK ID. */
export interface VkIdOptions {
  /** The app's ID from its registration with VK ID. */
  clientId: string;
  /** Where VK ID sends the browser back: this server's /api/vk/callback, as registered with VK ID. */
  redirectUrl: string;
}

/**
 * Sign-in with VK ID (OAuth 2.1 with PKCE), the only sign-in in production (ADR 0002). The
 * server keeps no VK token: all it needs is the VK user id, which then stands for the person.
 */
export interface VkId {
  /** Where the browser goes to sign in with VK ID; VK ID sends it back to the redirect URL with a code. */
  authorizeUrl(sign: { state: string; codeVerifier: string }): string;
  /** The VK user id vouched for by the code VK ID sent the browser back with. */
  userIdFor(callback: { code: string; deviceId: string; state: string; codeVerifier: string }): Promise<string>;
}

const VK_ID = "https://id.vk.ru";

export function vkId({ clientId, redirectUrl }: VkIdOptions): VkId {
  return {
    authorizeUrl({ state, codeVerifier }) {
      const url = new URL("/authorize", VK_ID);
      url.search = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUrl,
        state,
        code_challenge: createHash("sha256").update(codeVerifier).digest("base64url"),
        code_challenge_method: "S256",
        // The least VK ID gives; GymLog asks for nothing of the person but who they are.
        scope: "vkid.personal_info",
      }).toString();
      return url.href;
    },

    async userIdFor({ code, deviceId, state, codeVerifier }) {
      const response = await fetch(new URL("/oauth2/auth", VK_ID), {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          code_verifier: codeVerifier,
          client_id: clientId,
          device_id: deviceId,
          redirect_uri: redirectUrl,
          state,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const answer = (await response.json()) as { user_id?: unknown; error?: string; error_description?: string };
      if (!response.ok || answer.error || answer.user_id === undefined) {
        throw new Error(`VK ID refused the code: ${response.status} ${answer.error} ${answer.error_description}`);
      }
      return String(answer.user_id);
    },
  };
}
