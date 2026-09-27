import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** The owner of GymLog, who alone creates Invites. */
  owner: boolean("owner").notNull().default(false),
});

/**
 * One-time links through which a new user gets an account. Only a hash of each Invite's token
 * is kept, like a session's.
 */
export const invites = pgTable("invites", {
  tokenHash: text("token_hash").primaryKey(),
  /** The owner who created it; null for the owner's own first Invite, made by the server command. */
  createdBy: uuid("created_by").references(() => users.id),
  /** The account it creates is the owner's. */
  makesOwner: boolean("makes_owner").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** The user whose account it created; null while it is unused. */
  usedBy: uuid("used_by").references(() => users.id),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

/**
 * How a user signs in: a login and a password (ADR 0007). The password is kept only as a slow
 * hash; it is missing on accounts from before passwords, until the owner's link sets one.
 */
export const logins = pgTable("logins", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  /** As the user typed it, for the owner's list of accounts. */
  login: text("login").notNull(),
  /** The login as it is matched, ignoring case and extra spaces; one per account. */
  loginKey: text("login_key").notNull().unique(),
  passwordHash: text("password_hash"),
});

/** Sign-in attempts per login, so guessing one is slowed down; kept for unknown logins too, so it tells nothing. */
export const signInAttempts = pgTable("sign_in_attempts", {
  loginKey: text("login_key").primaryKey(),
  /** Attempts since the last one that got in, the ones under way included. */
  failures: integer("failures").notNull().default(0),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  /** Until then the login can't sign in, whatever the password. */
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
});

/**
 * One-time links from the owner through which a user sets a new password. Only a hash of each
 * link's token is kept, like an Invite's.
 */
export const passwordResets = pgTable("password_resets", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

/** Signed-in browsers. Only a hash of each session's token is kept, so the table can't be used to sign in. */
export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Orders every write to records, so a device can ask for what changed after the last one it saw. */
export const recordSeq = pgSequence("record_seq");

/**
 * Every synced record of every user, whatever its type: the server checks records and their
 * owner but knows nothing else of the domain, so a new record type needs no new table.
 */
export const records = pgTable(
  "records",
  {
    /** Generated on the device. */
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    type: text("type").notNull(),
    /** Taken from record_seq on every write. */
    seq: bigint("seq", { mode: "number" })
      .notNull()
      .default(sql`nextval('record_seq')`),
    /** The record's own fields as the device sent them, without its type and owner. */
    data: jsonb("data").notNull(),
  },
  (t) => [index("records_owner_seq").on(t.ownerId, t.seq)],
);
