import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { and, asc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import {
  checkSyncRecord,
  exerciseNameKey,
  loginKey,
  SIGN_IN_LOCK_MINUTES,
  type UserSummary,
  type SignInRefusal,
} from "@gymlog/shared";
import { invites, logins, resetLinks, records, sessions, signInAttempts, users } from "./db/schema.ts";
import { hashPassword, NO_PASSWORD, passwordMatches } from "./passwords.ts";
import { STARTER_LIST } from "./starter-list.ts";

export type Database = NodePgDatabase;

/** The user signed in, or why not. */
export type SignInOutcome = { userId: string } | { refusal: SignInRefusal };

/** Wrong passwords in a row after which a login can't sign in for a while. */
const MAX_FAILURES = 5;
/** Attempts for a login quiet for a day are forgotten, so the table doesn't keep every login ever tried. */
const FORGET_ATTEMPTS_DAYS = 1;
/** How long a Reset link works, so a friend has time to open it. */
const RESET_DAYS = 7;

/** Connects to the database and brings its schema up to date. */
export async function openDatabase(databaseUrl: string): Promise<{ db: Database; close(): Promise<void> }> {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = drizzle({ client: pool });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  return { db, close: () => pool.end() };
}

/**
 * Makes a new User through a valid, unused Invite, with the Login and password chosen, and
 * uses the Invite up; the User's Exercise catalog starts from the Starter list. The Login
 * and password are checked by the caller.
 */
export async function signUp(
  db: Database,
  { invite: inviteToken, login, password }: { invite: string; login: string; password: string },
): Promise<SignInOutcome> {
  // Slow on purpose, so outside the transaction.
  const passwordHash = await hashPassword(password);
  const key = loginKey(login);
  return db.transaction(async (tx) => {
    // Serialised per login, so two people choosing one login at once can't both have it.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`login:${key}`}, 0))`);
    // Locked, so two people opening one Invite at once can't both become Users through it.
    const [invite] = await tx.select().from(invites).where(eq(invites.tokenHash, hashOf(inviteToken))).for("update");
    if (!invite || invite.usedBy) return { refusal: "inviteUnusable" };
    // GymLog has one Owner; an Owner's Invite left over once there is one makes nobody a User.
    if (invite.makesOwner && (await hasOwner(tx))) return { refusal: "inviteUnusable" };
    const [taken] = await tx.select().from(logins).where(eq(logins.loginKey, key));
    if (taken) return { refusal: "loginTaken" };
    const [user] = await tx.insert(users).values({ owner: invite.makesOwner }).returning();
    await tx.insert(logins).values({ userId: user!.id, login: login.trim(), loginKey: key, passwordHash });
    await tx
      .update(invites)
      .set({ usedBy: user!.id, usedAt: sql`now()` })
      .where(eq(invites.tokenHash, invite.tokenHash));
    // As synced records, so the Starter list reaches every device of the user's.
    await tx.insert(records).values(starterExercises(user!.id));
    return { userId: user!.id };
  });
}

/**
 * Signs in with a login and a password. An unknown login is refused just like a wrong
 * password, and takes as long. After MAX_FAILURES wrong passwords in a row the login is held
 * up for SIGN_IN_LOCK_MINUTES, right password or not; a quiet spell as long starts the count
 * afresh.
 */
export async function signIn(
  db: Database,
  { login, password }: { login: string; password: string },
): Promise<SignInOutcome> {
  const key = loginKey(login);
  // Counted before the password is checked, so attempts sent all at once can't slip past the count.
  const [attempt] = await db
    .insert(signInAttempts)
    .values({ loginKey: key, failures: 1 })
    .onConflictDoUpdate({
      target: signInAttempts.loginKey,
      set: {
        failures: sql`case
          when ${signInAttempts.lockedUntil} > now() then ${signInAttempts.failures}
          when ${signInAttempts.lastAttemptAt} < now() - make_interval(mins => ${SIGN_IN_LOCK_MINUTES}) then 1
          else ${signInAttempts.failures} + 1 end`,
        lastAttemptAt: sql`now()`,
      },
    })
    .returning({
      failures: signInAttempts.failures,
      locked: sql<boolean>`coalesce(${signInAttempts.lockedUntil} > now(), false)`,
    });
  if (attempt!.locked || attempt!.failures > MAX_FAILURES) return { refusal: "tooManyAttempts" };
  const [known] = await db.select().from(logins).where(eq(logins.loginKey, key));
  if (await passwordMatches(password, known?.passwordHash ?? NO_PASSWORD)) {
    await db.delete(signInAttempts).where(eq(signInAttempts.loginKey, key));
    return { userId: known!.userId };
  }
  if (attempt!.failures === MAX_FAILURES) {
    await db
      .update(signInAttempts)
      .set({ failures: 0, lockedUntil: sql`now() + make_interval(mins => ${SIGN_IN_LOCK_MINUTES})` })
      .where(eq(signInAttempts.loginKey, key));
  }
  await db
    .delete(signInAttempts)
    .where(
      and(
        lt(signInAttempts.lastAttemptAt, sql`now() - make_interval(days => ${FORGET_ATTEMPTS_DAYS})`),
        or(isNull(signInAttempts.lockedUntil), lt(signInAttempts.lockedUntil, sql`now()`)),
      ),
    );
  return { refusal: "wrongPassword" };
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

/** Whether an Invite can still make a User: it was made and nobody has used it. */
export async function inviteUsable(db: Database, token: string): Promise<boolean> {
  const [invite] = await db.select().from(invites).where(eq(invites.tokenHash, hashOf(token)));
  return invite !== undefined && invite.usedBy === null;
}

/**
 * The owner's own first Invite, for the server command that sets GymLog up: whoever creates an
 * User through it is the Owner. Returns its token, which goes into the Invite's link.
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

/** Every User who signs in with a Login, by Login, for the Owner. */
export async function listUsers(db: Database): Promise<UserSummary[]> {
  return db
    .select({
      userId: users.id,
      login: logins.login,
      owner: users.owner,
      hasPassword: sql<boolean>`${logins.passwordHash} is not null`,
    })
    .from(users)
    .innerJoin(logins, eq(logins.userId, users.id))
    .orderBy(asc(logins.loginKey));
}

/**
 * A new one-time link for this user to set a new password, as the owner gives one; returns its
 * token, or null when no User with a Login has this id.
 */
export async function createResetLink(db: Database, userId: string): Promise<string | null> {
  const [user] = await db.select().from(logins).where(eq(logins.userId, userId));
  if (!user) return null;
  const token = newToken();
  await db.insert(resetLinks).values({
    tokenHash: hashOf(token),
    userId,
    expiresAt: sql`now() + make_interval(days => ${RESET_DAYS})`,
  });
  return token;
}

/** A link for the owner's own new password, for the server command, when the owner forgot it. */
export async function createOwnerResetLink(db: Database): Promise<string> {
  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.owner, true)).limit(1);
  const token = owner && (await createResetLink(db, owner.id));
  if (!token) throw new Error("GymLog has no owner yet; the owner's Invite creates one");
  return token;
}

/** The login whose password this link sets, or null when the link is used, expired or was never made. */
export async function resetLinkLogin(db: Database, token: string): Promise<string | null> {
  const [link] = await db
    .select({ login: logins.login })
    .from(resetLinks)
    .innerJoin(logins, eq(logins.userId, resetLinks.userId))
    .where(usableResetLink(token));
  return link?.login ?? null;
}

/**
 * Sets a new password through a link from the owner, which that uses up. The user's sessions
 * all end, so a device someone else may hold is signed out; the password is checked by the caller.
 */
export async function setNewPassword(
  db: Database,
  { resetLink: token, password }: { resetLink: string; password: string },
): Promise<SignInOutcome> {
  const passwordHash = await hashPassword(password);
  return db.transaction(async (tx) => {
    const [link] = await tx.select().from(resetLinks).where(usableResetLink(token)).for("update");
    if (!link) return { refusal: "resetLinkUnusable" };
    const [user] = await tx
      .update(logins)
      .set({ passwordHash })
      .where(eq(logins.userId, link.userId))
      .returning();
    // Every link for this user's password ends with it, not just the one used.
    await tx
      .update(resetLinks)
      .set({ usedAt: sql`now()` })
      .where(and(eq(resetLinks.userId, link.userId), isNull(resetLinks.usedAt)));
    await tx.delete(sessions).where(eq(sessions.userId, link.userId));
    // Whoever was guessing the old password is no reason to keep the new one out.
    await tx.delete(signInAttempts).where(eq(signInAttempts.loginKey, user!.loginKey));
    return { userId: link.userId };
  });
}

function usableResetLink(token: string) {
  return and(
    eq(resetLinks.tokenHash, hashOf(token)),
    isNull(resetLinks.usedAt),
    gt(resetLinks.expiresAt, sql`now()`),
  );
}

/** A secret for a cookie or a link: long and random enough that nobody can guess it. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What is kept of a secret, so the database can't be used to sign in. */
export function hashOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
