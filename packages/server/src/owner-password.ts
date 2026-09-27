/**
 * The command for an Owner who forgot their password: creates a Reset link for the Owner and
 * prints it. Other Users get Reset links from the Owner in the app.
 */
import { createOwnerResetLink, openDatabase } from "./users.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");
/** The address the app is opened at, e.g. https://gymlog.example.ru. */
const appUrl = process.env.APP_URL;
if (!appUrl) throw new Error("APP_URL is not set");

const database = await openDatabase(databaseUrl);
try {
  const resetLink = await createOwnerResetLink(database.db);
  const link = new URL(`/#/reset/${resetLink}`, appUrl).href;
  console.log(`The Owner's Reset link; open it and set a new password:\n${link}`);
} finally {
  await database.close();
}
