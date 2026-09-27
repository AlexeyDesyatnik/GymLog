import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  jsonb,
  pgSequence,
  pgTable,
  primaryKey,
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
 * How a user signs in: a provider and the user's id there. VK ID is the provider "vk" with the
 * VK user id; the test sign-in is the provider "test" with the name typed.
 */
export const identities = pgTable(
  "identities",
  {
    provider: text("provider").notNull(),
    subject: text("subject").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.provider, t.subject] })],
);

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
