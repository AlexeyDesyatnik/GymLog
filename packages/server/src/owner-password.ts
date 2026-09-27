/**
 * The command for an owner who forgot their password: creates a one-time link through which
 * the owner sets a new one, and prints it. Other users get such links from the owner in the app.
 */
import { createOwnerPasswordReset, openDatabase } from "./accounts.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");
/** The address the app is opened at, e.g. https://gymlog.example.ru. */
const appUrl = process.env.APP_URL;
if (!appUrl) throw new Error("APP_URL is not set");

const database = await openDatabase(databaseUrl);
try {
  const reset = await createOwnerPasswordReset(database.db);
  const link = new URL(`/#/reset/${reset}`, appUrl).href;
  console.log(`The owner's link for a new password; open it and set one:\n${link}`);
} finally {
  await database.close();
}
