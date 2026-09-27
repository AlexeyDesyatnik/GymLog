/**
 * The one-off command that sets GymLog up: creates the owner's own first Invite and prints its
 * link. Whoever creates an account through it becomes the owner, who then creates Invites in
 * the app.
 */
import { createOwnerInvite, openDatabase } from "./accounts.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");
/** The address the app is opened at, e.g. https://gymlog.example.ru. */
const appUrl = process.env.APP_URL;
if (!appUrl) throw new Error("APP_URL is not set");

const database = await openDatabase(databaseUrl);
try {
  const invite = await createOwnerInvite(database.db);
  const link = new URL(`/#/invite/${invite}`, appUrl).href;
  console.log(`The owner's Invite; open it and choose a login and a password:\n${link}`);
} finally {
  await database.close();
}
