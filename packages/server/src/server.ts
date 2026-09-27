import cookie from "@fastify/cookie";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import {
  checkSyncRecord,
  replacesKept,
  type PullAnswer,
  type InviteAnswer,
  type InviteCheck,
  type PushAnswer,
  type SessionAnswer,
  type SignInProblem,
  type SyncedRecord,
  type SyncRecord,
} from "@gymlog/shared";
import { createInvite, hashOf, inviteUsable, newToken, openDatabase, signIn, type Identity } from "./accounts.ts";
import { records, sessions, users } from "./db/schema.ts";
import { vkId, type VkIdOptions } from "./vk-id.ts";

export interface ServerOptions {
  databaseUrl: string;
  host: string;
  /** 0 picks a free port. */
  port: number;
  /**
   * Sign-in by name alone in place of VK ID, for tests and local development; the rules of
   * Invites still hold. Never in production: anyone could sign in as anyone.
   */
  testSignIn: boolean;
  /** The app's registration with VK ID; without one, VK ID sign-in is unavailable. */
  vkId: VkIdOptions | null;
}

export interface RunningServer {
  /** Where the server listens, e.g. http://127.0.0.1:3000. */
  url: string;
  close(): Promise<void>;
}

/** The most records one push may carry, and one pull returns. */
export const BATCH_LIMIT = 500;

const SESSION_COOKIE = "gymlog_session";
/** Holds a VK ID sign-in under way, while the browser is at VK ID. */
const VK_SIGN_IN_COOKIE = "gymlog_vk_sign_in";
/** The longest a browser keeps a cookie. */
const SESSION_DAYS = 400;

/**
 * The server: sign-in and sync. It knows nothing of the domain beyond checking records and
 * who owns them; each user reads and writes only their own records.
 */
export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const database = await openDatabase(options.databaseUrl);
  const db = database.db;

  const app = Fastify();
  await app.register(cookie);

  /**
   * The signed-in user, from the session cookie. When there is none, or it isn't known, the
   * request is answered 401 and null is returned.
   */
  async function signedInUser(request: FastifyRequest, reply: FastifyReply): Promise<SessionAnswer | null> {
    const token = request.cookies[SESSION_COOKIE];
    const [session] = token
      ? await db
          .select({ userId: users.id, owner: users.owner })
          .from(sessions)
          .innerJoin(users, eq(users.id, sessions.userId))
          .where(eq(sessions.tokenHash, hashOf(token)))
      : [];
    if (!session) reply.code(401).send({ error: "Not signed in" });
    return session ?? null;
  }

  /** Signs the browser in as the user the provider vouched for, if the rules of Invites let them in. */
  async function startSession(reply: FastifyReply, identity: Identity, invite: string | null) {
    const outcome = await signIn(db, identity, invite);
    if ("refusal" in outcome) return outcome;
    const token = newToken();
    await db.insert(sessions).values({ tokenHash: hashOf(token), userId: outcome.userId });
    reply.setCookie(SESSION_COOKIE, token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: "auto",
      maxAge: SESSION_DAYS * 24 * 60 * 60,
    });
    return outcome;
  }

  app.get("/api/session", async (request, reply) => {
    const session = await signedInUser(request, reply);
    if (!session) return reply;
    return session;
  });

  if (options.testSignIn) {
    type TestSignIn = { Body: { name?: unknown; invite?: unknown } };
    app.post<TestSignIn>("/api/test-sign-in", async (request, reply) => {
      const { name, invite } = request.body ?? {};
      if (typeof name !== "string" || name.trim() === "") return reply.code(400).send({ error: "A name is needed" });
      if (invite !== undefined && typeof invite !== "string") return reply.code(400).send({ error: "invite is text" });
      const outcome = await startSession(reply, { provider: "test", subject: name.trim() }, invite ?? null);
      if ("refusal" in outcome) return reply.code(403).send({ error: "Sign-in refused", refusal: outcome.refusal });
      return outcome;
    });
  }

  app.post("/api/invites", async (request, reply): Promise<InviteAnswer | FastifyReply> => {
    const session = await signedInUser(request, reply);
    if (!session) return reply;
    if (!session.owner) return reply.code(403).send({ error: "Only the owner creates Invites" });
    return { invite: await createInvite(db, session.userId) };
  });

  // Before signing in, so the app can say at once that an Invite is used up.
  type CheckInvite = { Params: { invite: string } };
  app.get<CheckInvite>("/api/invites/:invite", async (request): Promise<InviteCheck> => {
    return { usable: await inviteUsable(db, request.params.invite) };
  });

  const vk = options.vkId && vkId(options.vkId);

  /**
   * Starts signing in with VK ID, through the Invite given, if any: sends the browser to VK ID,
   * remembering what checks its way back.
   */
  type VkStart = { Querystring: { invite?: string } };
  app.get<VkStart>("/api/vk/start", async (request, reply) => {
    if (!vk) return reply.redirect(signInProblemPath("unavailable"));
    const pending: PendingVkSignIn = { state: newToken(), codeVerifier: newToken(), invite: request.query.invite ?? null };
    reply.setCookie(VK_SIGN_IN_COOKIE, JSON.stringify(pending), {
      path: "/api/vk",
      httpOnly: true,
      // Sent along when VK ID sends the browser back, which is a plain link from another site.
      sameSite: "lax",
      secure: "auto",
      maxAge: 10 * 60,
    });
    return reply.redirect(vk.authorizeUrl(pending));
  });

  /** Where VK ID sends the browser back: signs it in, then opens the app, or says why it wasn't. */
  type VkCallback = { Querystring: { code?: string; state?: string; device_id?: string } };
  app.get<VkCallback>("/api/vk/callback", async (request, reply) => {
    const pending = pendingVkSignIn(request.cookies[VK_SIGN_IN_COOKIE]);
    reply.clearCookie(VK_SIGN_IN_COOKIE, { path: "/api/vk" });
    const { code, state, device_id: deviceId } = request.query;
    // A state that isn't the one this browser set off with is someone else's sign-in slipped in.
    if (!vk || !pending || !code || !deviceId || state !== pending.state) {
      return reply.redirect(signInProblemPath("failed"));
    }
    let subject: string;
    try {
      subject = await vk.userIdFor({ code, deviceId, state, codeVerifier: pending.codeVerifier });
    } catch (error) {
      console.error("VK ID sign-in failed", error);
      return reply.redirect(signInProblemPath("failed"));
    }
    const outcome = await startSession(reply, { provider: "vk", subject }, pending.invite);
    return reply.redirect("refusal" in outcome ? signInProblemPath(outcome.refusal) : "/");
  });

  type Push = { Body: { records?: unknown } };
  app.post<Push>("/api/sync/push", async (request, reply): Promise<PushAnswer | FastifyReply> => {
    const userId = (await signedInUser(request, reply))?.userId;
    if (!userId) return reply;
    const sent = request.body?.records;
    if (!Array.isArray(sent) || sent.length > BATCH_LIMIT) {
      return reply.code(400).send({ error: `records must be a list of at most ${BATCH_LIMIT}` });
    }
    const refused: PushAnswer["refused"] = [];
    const accepted: SyncRecord[] = [];
    for (const item of sent) {
      try {
        const record = checkSyncRecord(item);
        if (record.ownerId !== userId) throw new RangeError("The record's owner isn't the signed-in user");
        accepted.push(record);
      } catch (error) {
        refused.push({ id: idOf(item), reason: error instanceof RangeError ? error.message : String(error) });
      }
    }
    await db.transaction(async (tx) => {
      // One push at a time per user, so a device that has read up to a record's seq has
      // also seen every record of that user with a lower one.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
      const stored =
        accepted.length === 0
          ? []
          : await tx
              .select({ id: records.id, ownerId: records.ownerId, type: records.type, data: records.data })
              .from(records)
              .where(
                inArray(
                  records.id,
                  accepted.map((r) => r.id),
                ),
              );
      const storedById = new Map(stored.map((r) => [r.id, r]));
      for (const record of accepted) {
        const existing = storedById.get(record.id);
        // Records of another user, or another type, are only ever refused, never changed.
        if (existing && existing.ownerId !== userId) {
          refused.push({ id: record.id, reason: "The record's owner isn't the signed-in user" });
          continue;
        }
        if (existing && existing.type !== record.type) {
          refused.push({ id: record.id, reason: `The record is a ${existing.type}, not a ${record.type}` });
          continue;
        }
        // A change older than the one kept, or to a deleted record, is taken and dropped.
        if (existing && !replacesKept(record, existing.data as SyncedRecord)) continue;
        const { type, ownerId, ...data } = record;
        storedById.set(record.id, { id: record.id, ownerId, type, data });
        await tx
          .insert(records)
          .values({ id: record.id, ownerId, type, data })
          .onConflictDoUpdate({
            target: records.id,
            set: { data: sql`excluded.data`, seq: sql`nextval('record_seq')` },
            // The same record sent again changes nothing, so devices don't pull it again.
            setWhere: sql`${records.ownerId} = excluded.owner_id
              and ${records.type} = excluded.type
              and ${records.data} is distinct from excluded.data`,
          });
      }
    });
    return { refused };
  });

  type Pull = { Querystring: { after?: string } };
  app.get<Pull>("/api/sync/pull", async (request, reply): Promise<PullAnswer | FastifyReply> => {
    const userId = (await signedInUser(request, reply))?.userId;
    if (!userId) return reply;
    const after = Number(request.query.after ?? 0);
    if (!Number.isSafeInteger(after) || after < 0) return reply.code(400).send({ error: "after must be a cursor" });
    const rows = await db
      .select()
      .from(records)
      .where(and(eq(records.ownerId, userId), gt(records.seq, after)))
      .orderBy(asc(records.seq))
      .limit(BATCH_LIMIT);
    return {
      records: rows.map((row) => ({ ...(row.data as object), type: row.type, ownerId: row.ownerId }) as SyncRecord),
      cursor: rows.at(-1)?.seq ?? after,
      more: rows.length === BATCH_LIMIT,
    };
  });

  const address = await app.listen({ host: options.host, port: options.port });
  return {
    url: address,
    async close() {
      await app.close();
      await database.close();
    },
  };
}

/** A VK ID sign-in under way: what checks the browser's way back from VK ID, and the Invite it came with. */
interface PendingVkSignIn {
  state: string;
  codeVerifier: string;
  invite: string | null;
}

function pendingVkSignIn(cookie: string | undefined): PendingVkSignIn | null {
  try {
    const pending = JSON.parse(cookie ?? "") as Partial<PendingVkSignIn>;
    if (typeof pending.state !== "string" || typeof pending.codeVerifier !== "string") return null;
    return { state: pending.state, codeVerifier: pending.codeVerifier, invite: pending.invite ?? null };
  } catch {
    return null;
  }
}

/** The app's screen saying why signing in didn't work. */
function signInProblemPath(problem: SignInProblem): string {
  return `/#/sign-in/${problem}`;
}

function idOf(item: unknown): string | null {
  const id = (item as { id?: unknown } | null)?.id;
  return typeof id === "string" ? id : null;
}
