import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import pg from "pg";
import { checkSyncRecord, type PullAnswer, type PushAnswer, type SyncRecord } from "@gymlog/shared";
import { identities, records, sessions, users } from "./db/schema.ts";

export interface ServerOptions {
  databaseUrl: string;
  host: string;
  /** 0 picks a free port. */
  port: number;
  /**
   * Sign-in by name alone, for tests and local development. Never in production: anyone
   * could sign in as anyone.
   */
  testSignIn: boolean;
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
  const pool = new pg.Pool({ connectionString: options.databaseUrl });
  const db = drizzle({ client: pool });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });

  const app = Fastify();
  await app.register(cookie);

  /**
   * The signed-in user, from the session cookie. When there is none, or it isn't known, the
   * request is answered 401 and null is returned.
   */
  async function signedInUser(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    const token = request.cookies[SESSION_COOKIE];
    const [session] = token ? await db.select().from(sessions).where(eq(sessions.tokenHash, hashOf(token))) : [];
    if (!session) reply.code(401).send({ error: "Not signed in" });
    return session?.userId ?? null;
  }

  app.get("/api/session", async (request, reply) => {
    const userId = await signedInUser(request, reply);
    if (!userId) return reply;
    return { userId };
  });

  if (options.testSignIn) {
    app.post<{ Body: { name?: unknown } }>("/api/test-sign-in", async (request, reply) => {
      const name = request.body?.name;
      if (typeof name !== "string" || name.trim() === "") return reply.code(400).send({ error: "A name is needed" });
      const userId = await db.transaction(async (tx) => {
        const identity = { provider: "test", subject: name.trim() };
        // Serialised per name, so two first sign-ins at once make one user.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${identity.subject}, 0))`);
        const [known] = await tx
          .select()
          .from(identities)
          .where(and(eq(identities.provider, identity.provider), eq(identities.subject, identity.subject)));
        if (known) return known.userId;
        const [user] = await tx.insert(users).values({}).returning();
        await tx.insert(identities).values({ ...identity, userId: user!.id });
        return user!.id;
      });
      const token = randomBytes(32).toString("base64url");
      await db.insert(sessions).values({ tokenHash: hashOf(token), userId });
      reply.setCookie(SESSION_COOKIE, token, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: "auto",
        maxAge: SESSION_DAYS * 24 * 60 * 60,
      });
      return { userId };
    });
  }

  type Push = { Body: { records?: unknown } };
  app.post<Push>("/api/sync/push", async (request, reply): Promise<PushAnswer | FastifyReply> => {
    const userId = await signedInUser(request, reply);
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
              .select({ id: records.id, ownerId: records.ownerId, type: records.type })
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
        const { type, ownerId, ...data } = record;
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
    const userId = await signedInUser(request, reply);
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
      await pool.end();
    },
  };
}

function hashOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function idOf(item: unknown): string | null {
  const id = (item as { id?: unknown } | null)?.id;
  return typeof id === "string" ? id : null;
}
