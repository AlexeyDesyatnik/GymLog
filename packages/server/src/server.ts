import cookie from "@fastify/cookie";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import {
  checkLogin,
  checkPassword,
  checkSyncRecord,
  isUuid,
  PASSWORD_MAX_LENGTH,
  replacesKept,
  type AccountSummary,
  type InviteAnswer,
  type InviteCheck,
  type PasswordResetAnswer,
  type PasswordResetCheck,
  type PullAnswer,
  type PushAnswer,
  type SessionAnswer,
  type SyncedRecord,
  type SyncRecord,
} from "@gymlog/shared";
import {
  createInvite,
  createPasswordReset,
  hashOf,
  inviteUsable,
  listAccounts,
  newToken,
  openDatabase,
  passwordResetLogin,
  resetPassword,
  signIn,
  signUp,
  type SignInOutcome,
} from "./accounts.ts";
import { records, sessions, users } from "./db/schema.ts";

export interface ServerOptions {
  databaseUrl: string;
  host: string;
  /** 0 picks a free port. */
  port: number;
}

export interface RunningServer {
  /** Where the server listens, e.g. http://127.0.0.1:3000. */
  url: string;
  close(): Promise<void>;
}

/** The most records one push may carry, and one pull returns. */
export const BATCH_LIMIT = 500;

const SESSION_COOKIE = "gymlog_session";
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

  /** The signed-in user, if they are the owner; otherwise the request is answered 401 or 403 and null is returned. */
  async function signedInOwner(request: FastifyRequest, reply: FastifyReply): Promise<SessionAnswer | null> {
    const session = await signedInUser(request, reply);
    if (session && !session.owner) reply.code(403).send({ error: "Only the owner may" });
    return session?.owner ? session : null;
  }

  /**
   * Answers an attempt to create an account, sign in or set a new password: signs the browser in
   * as the user, or says why not.
   */
  async function answerSignIn(reply: FastifyReply, outcome: SignInOutcome) {
    if ("refusal" in outcome) return reply.code(403).send({ error: "Sign-in refused", refusal: outcome.refusal });
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

  /** Answers 400 with the problem, when a value sent is refused by the shared rules. */
  function refusedValue(reply: FastifyReply, check: () => void): boolean {
    try {
      check();
      return false;
    } catch (error) {
      reply.code(400).send({ error: error instanceof RangeError ? error.message : String(error) });
      return true;
    }
  }

  app.get("/api/session", async (request, reply) => {
    const session = await signedInUser(request, reply);
    if (!session) return reply;
    return session;
  });

  type SignUp = { Body: { invite?: unknown; login?: unknown; password?: unknown } };
  app.post<SignUp>("/api/sign-up", async (request, reply) => {
    const { invite, login, password } = request.body ?? {};
    if (typeof invite !== "string") return reply.code(400).send({ error: "An Invite is needed" });
    if (refusedValue(reply, () => (checkLogin(login), checkPassword(password)))) return reply;
    return answerSignIn(reply, await signUp(db, { invite, login: login as string, password: password as string }));
  });

  type SignIn = { Body: { login?: unknown; password?: unknown } };
  app.post<SignIn>("/api/sign-in", async (request, reply) => {
    const { login, password } = request.body ?? {};
    if (refusedValue(reply, () => checkLogin(login))) return reply;
    // No other check: a password too short simply isn't the one kept.
    if (typeof password !== "string" || password.length > PASSWORD_MAX_LENGTH) {
      return reply.code(400).send({ error: "A password is needed" });
    }
    return answerSignIn(reply, await signIn(db, { login: login as string, password }));
  });

  app.post("/api/invites", async (request, reply): Promise<InviteAnswer | FastifyReply> => {
    const owner = await signedInOwner(request, reply);
    if (!owner) return reply;
    return { invite: await createInvite(db, owner.userId) };
  });

  // Before creating an account, so the app can say at once that an Invite is used up.
  type CheckInvite = { Params: { invite: string } };
  app.get<CheckInvite>("/api/invites/:invite", async (request): Promise<InviteCheck> => {
    return { usable: await inviteUsable(db, request.params.invite) };
  });

  app.get("/api/accounts", async (request, reply): Promise<AccountSummary[] | FastifyReply> => {
    if (!(await signedInOwner(request, reply))) return reply;
    return listAccounts(db);
  });

  type CreateReset = { Body: { userId?: unknown } };
  app.post<CreateReset>("/api/password-resets", async (request, reply): Promise<PasswordResetAnswer | FastifyReply> => {
    if (!(await signedInOwner(request, reply))) return reply;
    const { userId } = request.body ?? {};
    const reset = isUuid(userId) ? await createPasswordReset(db, userId) : null;
    if (!reset) return reply.code(404).send({ error: "No such account" });
    return { reset };
  });

  // Before setting the password, so the app can name the login, or say the link is used up.
  type CheckReset = { Params: { reset: string } };
  app.get<CheckReset>("/api/password-resets/:reset", async (request): Promise<PasswordResetCheck> => {
    return { login: await passwordResetLogin(db, request.params.reset) };
  });

  type Reset = { Params: { reset: string }; Body: { password?: unknown } };
  app.post<Reset>("/api/password-resets/:reset", async (request, reply) => {
    const { password } = request.body ?? {};
    if (refusedValue(reply, () => checkPassword(password))) return reply;
    return answerSignIn(reply, await resetPassword(db, { reset: request.params.reset, password: password as string }));
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

function idOf(item: unknown): string | null {
  const id = (item as { id?: unknown } | null)?.id;
  return typeof id === "string" ? id : null;
}
