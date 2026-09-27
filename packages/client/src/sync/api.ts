import type { SignInRefusal } from "@gymlog/shared";
import type { SyncOptions } from "./sync.ts";

/**
 * A request unanswered for this long is given up, as on a connection that stalled in the gym;
 * until it is, no other sync can start.
 */
const TIMEOUT_MS = 20_000;

/** The server refused the session: nobody is signed in on this device. */
export class SignedOut extends Error {}

/** The server wouldn't create the account, sign in or set the password; the refusal says why. */
export class SignInRefused extends Error {
  constructor(readonly refusal: SignInRefusal) {
    super(`Sign-in refused: ${refusal}`);
    this.name = "SignInRefused";
  }
}

/** Sends a request to the server: a GET, or a POST of the body as JSON; resolves with the answer. */
export type Api = <T>(path: string, body?: unknown) => Promise<T>;

/**
 * Requests to the server as this device. Rejects with SignedOut when nobody is signed in, with
 * SignInRefused when a sign-in is refused, and with an Error saying what went wrong otherwise.
 */
export function serverApi(options: SyncOptions): Api {
  return async <T>(path: string, body?: unknown): Promise<T> => {
    const request = options.fetch ?? fetch;
    const response = await request(`${options.url}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
    });
    if (response.status === 401) throw new SignedOut();
    if (!response.ok) {
      const text = await response.text();
      const refusal = response.status === 403 ? refusalIn(text) : undefined;
      throw refusal ? new SignInRefused(refusal) : new Error(`${path}: ${response.status} ${text}`);
    }
    return (await response.json()) as T;
  };
}

/** The reason in the server's answer refusing a sign-in, if it is one. */
function refusalIn(answer: string): SignInRefusal | undefined {
  try {
    return (JSON.parse(answer) as { refusal?: SignInRefusal }).refusal;
  } catch {
    return undefined;
  }
}
