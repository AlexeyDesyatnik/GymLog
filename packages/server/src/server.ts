import { relative, sep } from "node:path";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import {
  checkLogin,
  checkPassword,
  checkSyncRecord,
  isUuid,
  PASSWORD_MAX_LENGTH,
  replacesKept,
  type UserSummary,
  type InviteAnswer,
  type InviteCheck,
  type ResetLinkAnswer,
  type ResetLinkCheck,
  type PullAnswer,
  type PushAnswer,
  type SessionAnswer,
  type SyncedRecord,
  type SyncRecord,
} from "@gymlog/shared";
import {
  createInvite,
  createResetLink,
  hashOf,
  inviteUsable,
  listUsers,
  newToken,
  openDatabase,
  resetLinkLogin,
  setNewPassword,
  signIn,
  signUp,
  type Database,
  type SignInOutcome,
} from "./users.ts";
import { records, sessions, users } from "./db/schema.ts";

export interface ServerOptions {
  databaseUrl: string;
  host: string;
  /** 0 picks a free port. */
  port: number;
  /**
   * The built app (`npm run build`), served alongside /api in production, so the two are one
   * site. In development Vite serves the app instead.
   */
  clientDir?: string;
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

  // Browsers reach the server through a proxy that says how they reached it: Caddy over HTTPS in
  // production, from the Docker network, and Vite in development, from this computer. Only those
  // are believed, so session cookies are Secure behind HTTPS.
  const app = Fastify({ trustProxy: ["loopback", "uniquelocal"] });
  await app.register(cookie);
  const clientDir = options.clientDir;
  if (clientDir) {
    await app.register(fastifyStatic, {
      root: clientDir,
      // Each version's scripts and styles have names of their own and never change; everything
      // else, the service worker above all, is checked anew so a new version gets installed.
      cacheControl: false,
      setHeaders(reply, path) {
        const unchanging = relative(clientDir, path).startsWith(`assets${sep}`);
        reply.header("cache-control", unchanging ? "public, max-age=31536000, immutable" : "no-cache");
      },
    });
  }

  /**
   * Once the server is closing, an answer to a request already under way ends its connection.
   * Kept alive, that connection would hold close() up for the keep-alive timeout (72 s): closing
   * ends only the connections idle at that moment.
   */
  let closing = false;
  app.addHook("preClose", async () => {
    closing = true;
  });
  app.addHook("onSend", async (_request, reply) => {
    if (closing) reply.header("connection", "close");
  });

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
   * Answers an attempt to use an Invite, sign in or set a new password: signs the browser in
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

  // Before the Invite is used, so the app can say at once that it is used up.
  type CheckInvite = { Params: { invite: string } };
  app.get<CheckInvite>("/api/invites/:invite", async (request): Promise<InviteCheck> => {
    return { usable: await inviteUsable(db, request.params.invite) };
  });

  app.get("/api/users", async (request, reply): Promise<UserSummary[] | FastifyReply> => {
    if (!(await signedInOwner(request, reply))) return reply;
    return listUsers(db);
  });

  type CreateResetLink = { Body: { userId?: unknown } };
  app.post<CreateResetLink>("/api/reset-links", async (request, reply): Promise<ResetLinkAnswer | FastifyReply> => {
    if (!(await signedInOwner(request, reply))) return reply;
    const { userId } = request.body ?? {};
    const resetLink = isUuid(userId) ? await createResetLink(db, userId) : null;
    if (!resetLink) return reply.code(404).send({ error: "No such User" });
    return { resetLink };
  });

  // Before setting the password, so the app can name the login, or say the link is used up.
  type CheckResetLink = { Params: { resetLink: string } };
  app.get<CheckResetLink>("/api/reset-links/:resetLink", async (request): Promise<ResetLinkCheck> => {
    return { login: await resetLinkLogin(db, request.params.resetLink) };
  });

  type UseResetLink = { Params: { resetLink: string }; Body: { password?: unknown } };
  app.post<UseResetLink>("/api/reset-links/:resetLink", async (request, reply) => {
    const { password } = request.body ?? {};
    if (refusedValue(reply, () => checkPassword(password))) return reply;
    const { resetLink } = request.params;
    return answerSignIn(reply, await setNewPassword(db, { resetLink, password: password as string }));
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
    // On one connection, so the identity is that of the database the records come from.
    const { rows, identity } = await db.transaction(async (tx) => ({
      rows: await tx
        .select()
        .from(records)
        .where(and(eq(records.ownerId, userId), gt(records.seq, after)))
        .orderBy(asc(records.seq))
        .limit(BATCH_LIMIT),
      identity: await databaseIdentity(tx),
    }));
    return {
      records: rows.map((row) => ({ ...(row.data as object), type: row.type, ownerId: row.ownerId }) as SyncRecord),
      cursor: rows.at(-1)?.seq ?? after,
      more: rows.length === BATCH_LIMIT,
      databaseIdentity: identity,
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

/**
 * Which database this is: the PostgreSQL cluster's system identifier and the database's OID.
 * Restoring a dump makes the database anew, so the identity changes by itself and a restore can't
 * forget to change it. Deploys and restarts keep it; anything else that makes the database or the
 * cluster anew changes it too, which only costs devices sending everything once more.
 */
async function databaseIdentity(db: Pick<Database, "execute">): Promise<string> {
  const { rows } = await db.execute<{ identity: string }>(sql`select
    (select system_identifier from pg_control_system())::text || '/' ||
    (select oid from pg_database where datname = current_database())::text as identity`);
  return rows[0]!.identity;
}

function idOf(item: unknown): string | null {
  const id = (item as { id?: unknown } | null)?.id;
  return typeof id === "string" ? id : null;
}
