import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { and, eq, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { checkSyncRecord, exerciseNameKey, type SignInRefusal } from "@gymlog/shared";
import { identities, invites, records, users } from "./db/schema.ts";
import { STARTER_LIST } from "./starter-list.ts";

export type Database = NodePgDatabase;

/** Connects to the database and brings its schema up to date. */
export async function openDatabase(databaseUrl: string): Promise<{ db: Database; close(): Promise<void> }> {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = drizzle({ client: pool });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  return { db, close: () => pool.end() };
}

/** Someone as a sign-in provider knows them: VK ID and the VK user id, or the test sign-in and a name. */
export interface Identity {
  provider: "vk" | "test";
  subject: string;
}

/**
 * Signs in whoever the provider vouched for. A known identity is its user's, and needs no
 * Invite. An unknown one gets an account only through a valid, unused Invite, which that uses
 * up, and the account's Exercise catalog starts from the Starter list; without one it is refused.
 */
export async function signIn(
  db: Database,
  identity: Identity,
  inviteToken: string | null,
): Promise<{ userId: string } | { refusal: SignInRefusal }> {
  return db.transaction(async (tx) => {
    // Serialised per identity, so two first sign-ins at once make one user.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${identity.provider}:${identity.subject}`}, 0))`,
    );
    const [known] = await tx
      .select()
      .from(identities)
      .where(and(eq(identities.provider, identity.provider), eq(identities.subject, identity.subject)));
    if (known) return { userId: known.userId };
    if (!inviteToken) return { refusal: "noInvite" };
    // Locked, so two people opening one Invite at once can't both get an account through it.
    const [invite] = await tx.select().from(invites).where(eq(invites.tokenHash, hashOf(inviteToken))).for("update");
    if (!invite || invite.usedBy) return { refusal: "inviteUnusable" };
    // GymLog has one owner; an owner's Invite left over once there is one gives nobody an account.
    if (invite.makesOwner && (await hasOwner(tx))) return { refusal: "inviteUnusable" };
    const [user] = await tx.insert(users).values({ owner: invite.makesOwner }).returning();
    await tx.insert(identities).values({ ...identity, userId: user!.id });
    await tx
      .update(invites)
      .set({ usedBy: user!.id, usedAt: sql`now()` })
      .where(eq(invites.tokenHash, invite.tokenHash));
    // As synced records, so the Starter list reaches every device of the user's.
    await tx.insert(records).values(starterExercises(user!.id));
    return { userId: user!.id };
  });
}

/** The Starter list as the Exercise records of a new user's catalog, in rows of the records table. */
function starterExercises(ownerId: string) {
  const now = Date.now();
  return STARTER_LIST.map(({ primaryName, alternativeName }) => {
    const { type, ownerId: _, ...data } = checkSyncRecord({
      type: "exercise",
      ownerId,
      id: randomUUID(),
      updatedAt: now,
      deleted: false,
      primaryName,
      alternativeNames: [alternativeName],
      nameKeys: [exerciseNameKey(primaryName), exerciseNameKey(alternativeName)],
    });
    return { id: data.id, ownerId, type, data };
  });
}

/** A new Invite from the owner; returns its token, which goes into the Invite's link. */
export async function createInvite(db: Database, ownerId: string): Promise<string> {
  return insertInvite(db, { createdBy: ownerId });
}

/** Whether an Invite can still give someone an account: it was made and nobody has used it. */
export async function inviteUsable(db: Database, token: string): Promise<boolean> {
  const [invite] = await db.select().from(invites).where(eq(invites.tokenHash, hashOf(token)));
  return invite !== undefined && invite.usedBy === null;
}

/**
 * The owner's own first Invite, for the server command that sets GymLog up: whoever signs in
 * through it becomes the owner. Returns its token, which goes into the Invite's link.
 */
export async function createOwnerInvite(db: Database): Promise<string> {
  if (await hasOwner(db)) throw new Error("GymLog already has an owner, who creates Invites in the app");
  return insertInvite(db, { makesOwner: true });
}

async function insertInvite(db: Database, invite: { createdBy?: string; makesOwner?: boolean }): Promise<string> {
  const token = newToken();
  await db.insert(invites).values({ tokenHash: hashOf(token), ...invite });
  return token;
}

async function hasOwner(db: Pick<Database, "select">): Promise<boolean> {
  return (await db.select({ id: users.id }).from(users).where(eq(users.owner, true)).limit(1)).length > 0;
}

/** A secret for a cookie or a link: long and random enough that nobody can guess it. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What is kept of a secret, so the database can't be used to sign in. */
export function hashOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
